const express = require("express");
const fs = require("fs");
const path = require("path");
const { ensureTempInputCsvExists } = require("../utils/tempInputCsv");
const { resolveModelScope } = require("../utils/modelScope");
const { spawnPython, appendDependencyHint } = require("../utils/pythonRuntime");

const router = express.Router();

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_SVM_SEQ_PATH = path.join(ROOT_DIR, "svm_tier_1_sequence.pkl");
const DEFAULT_SVM_STAT_PATH = path.join(ROOT_DIR, "svm_tier_2_statistical.pkl");
const DEFAULT_LSTM_PATH = path.join(ROOT_DIR, "ml", "lstm_classifier.pt");
const DEFAULT_MIN_SAMPLES = 30;
const TRAIN_TIMEOUT_MS = 10 * 60 * 1000;

let trainingInProgress = false;
let lastTrainStatus = "idle";
let lastTrainAt = null;
let lastTrainError = null;

function toIsoOrNull(statPath) {
  try {
    if (!fs.existsSync(statPath)) {
      return null;
    }
    return fs.statSync(statPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function countCsvRows(csvPath) {
  if (!fs.existsSync(csvPath)) {
    return 0;
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return Math.max(0, lines.length - 1);
}

function readInputRowCount(accountNo) {
  const inputPath = ensureTempInputCsvExists({ accountNo });
  const scope = resolveModelScope(accountNo);
  return {
    inputPath,
    rowCount: countCsvRows(inputPath),
    historyPath: scope.historyPath,
    historyRowCount: countCsvRows(scope.historyPath),
  };
}

function toScopedOrDefault(artifactPath, fallbackPath) {
  return fs.existsSync(artifactPath) ? artifactPath : fallbackPath;
}

function getModelArtifacts(accountNo) {
  const scope = resolveModelScope(accountNo);
  const svmSeqPath = toScopedOrDefault(scope.svmSeqPath, DEFAULT_SVM_SEQ_PATH);
  const svmStatPath = toScopedOrDefault(scope.svmStatPath, DEFAULT_SVM_STAT_PATH);
  const lstmPath = toScopedOrDefault(scope.lstmPath, DEFAULT_LSTM_PATH);

  return {
    scopeId: scope.scopeId,
    svmSeqPath,
    svmSeqModifiedAt: toIsoOrNull(svmSeqPath),
    svmStatPath,
    svmStatModifiedAt: toIsoOrNull(svmStatPath),
    lstmPath,
    lstmModifiedAt: toIsoOrNull(lstmPath),
  };
}

router.get("/status", (req, res) => {
  const accountNo = req.query?.accountNo || req.headers["x-account-no"];
  const { rowCount, inputPath, historyPath, historyRowCount } = readInputRowCount(
    accountNo
  );
  return res.status(200).json({
    trainingInProgress,
    lastTrainStatus,
    lastTrainAt,
    lastTrainError,
    inputPath,
    inputRowCount: rowCount,
    historyPath,
    historyRowCount,
    artifacts: getModelArtifacts(accountNo),
  });
});

router.post("/bootstrap", (req, res) => {
  const accountNo = req.body?.accountNo || req.headers["x-account-no"];
  const scope = resolveModelScope(accountNo);
  const minSamplesRaw = Number(req.body?.minSamples);
  const minSamples = Number.isFinite(minSamplesRaw)
    ? Math.max(10, Math.floor(minSamplesRaw))
    : DEFAULT_MIN_SAMPLES;

  if (trainingInProgress) {
    return res.status(409).json({
      message: "Model retraining is already in progress.",
      trainingInProgress: true,
    });
  }

  const { rowCount, inputPath, historyPath, historyRowCount } = readInputRowCount(
    accountNo
  );
  const effectiveRowCount = Math.max(rowCount, historyRowCount);
  if (effectiveRowCount < minSamples) {
    return res.status(400).json({
      message: `Need at least ${minSamples} rows in temp/history CSV before retraining.`,
      inputRowCount: rowCount,
      inputPath,
      historyRowCount,
      historyPath,
      scopeId: scope.scopeId,
    });
  }

  trainingInProgress = true;
  lastTrainStatus = "training";
  lastTrainError = null;

  const child = spawnPython(
    [
      "ml/retrain_tiered_from_live_session.py",
      "--input",
      inputPath,
      "--reference",
      scope.referencePath,
      "--history",
      historyPath,
      "--svm-seq",
      scope.svmSeqPath,
      "--svm-stat",
      scope.svmStatPath,
      "--lstm",
      scope.lstmPath,
      "--profiles-root",
      path.join(ROOT_DIR, "ml", "user_profiles"),
      "--scope-id",
      scope.scopeId,
    ],
    {
      cwd: ROOT_DIR,
    }
  );

  let stdout = "";
  let stderr = "";
  let hasResponded = false;

  const timeoutId = setTimeout(() => {
    child.kill("SIGTERM");
  }, TRAIN_TIMEOUT_MS);

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("error", (error) => {
    if (hasResponded) {
      return;
    }
    hasResponded = true;
    clearTimeout(timeoutId);
    trainingInProgress = false;
    lastTrainStatus = "failed";
    lastTrainError = `Failed to start Python process: ${error.message}`;
    return res.status(500).json({
      message: "Model retraining failed.",
      error: lastTrainError,
    });
  });

  child.on("close", (code) => {
    if (hasResponded) {
      return;
    }
    hasResponded = true;
    clearTimeout(timeoutId);
    trainingInProgress = false;

    if (code !== 0) {
      lastTrainStatus = "failed";
      lastTrainError = appendDependencyHint(
        (stderr || stdout || `Exited with code ${code}`).trim()
      );
      console.error(`[model-bootstrap] failed: ${lastTrainError}`);
      return res.status(500).json({
        message: "Model retraining failed.",
        code,
        error: lastTrainError,
      });
    }

    lastTrainStatus = "ready";
    lastTrainAt = new Date().toISOString();
    lastTrainError = null;
    console.log(`[model-bootstrap] success at ${lastTrainAt}`);
    return res.status(200).json({
      message: "Model retraining completed.",
      trainedAt: lastTrainAt,
      inputRowCount: rowCount,
      historyRowCount,
      artifacts: getModelArtifacts(accountNo),
      output: stdout.trim(),
      scopeId: scope.scopeId,
    });
  });
});

module.exports = router;

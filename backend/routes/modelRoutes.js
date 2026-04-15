const express = require("express");
const fs = require("fs");
const path = require("path");
const { ensureTempInputCsvExists, writeHistoryCsvFromSession } = require("../utils/tempInputCsv");
const { resolveModelScope } = require("../utils/modelScope");
const { resolveModelArtifacts } = require("../utils/modelArtifacts");
const { spawnPython, appendDependencyHint } = require("../utils/pythonRuntime");

const router = express.Router();

const ROOT_DIR = path.join(__dirname, "..");
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

function getModelArtifacts(accountNo) {
  const artifacts = resolveModelArtifacts(accountNo, {
    strictScope: Boolean(accountNo),
  });

  return {
    scopeId: artifacts.scopeId,
    strictScope: artifacts.strictScope,
    svmSeqPath: artifacts.svmSeqPath || null,
    svmSeqModifiedAt: toIsoOrNull(artifacts.svmSeqPath),
    svmStatPath: artifacts.svmStatPath || null,
    svmStatModifiedAt: toIsoOrNull(artifacts.svmStatPath),
    lstmPath: artifacts.lstmPath || null,
    lstmModifiedAt: toIsoOrNull(artifacts.lstmPath),
    missingArtifacts: artifacts.missing,
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
  const trainingSession = req.body?.trainingSession;
  const minSamplesRaw = Number(req.body?.minSamples);
  const minSamples = Number.isFinite(minSamplesRaw)
    ? Math.max(10, Math.floor(minSamplesRaw))
    : DEFAULT_MIN_SAMPLES;
  const enforceQualityGate = req.body?.enforceQualityGate === true;
  const rebuildFromScratch = req.body?.rebuildFromScratch === true;
  const minHardNegativesRaw = Number(req.body?.minHardNegatives);
  const minHardNegatives = Number.isFinite(minHardNegativesRaw)
    ? Math.max(0, Math.floor(minHardNegativesRaw))
    : 3;
  const minLstmBalancedAccuracyRaw = Number(req.body?.minLstmBalancedAccuracy);
  const minLstmBalancedAccuracy = Number.isFinite(minLstmBalancedAccuracyRaw)
    ? Math.max(0, Math.min(1, minLstmBalancedAccuracyRaw))
    : 0.7;
  const removedArtifacts = [];

  if (trainingInProgress) {
    return res.status(409).json({
      message: "Model retraining is already in progress.",
      trainingInProgress: true,
    });
  }

  if (Array.isArray(trainingSession) && trainingSession.length > 0) {
    const uploaded = writeHistoryCsvFromSession(trainingSession, { accountNo });
    console.log(
      `[model-bootstrap] history refreshed from mobile Model.csv with ${uploaded.rowCount} rows at ${uploaded.historyPath}`
    );
  }

  const { rowCount, inputPath, historyPath, historyRowCount } = readInputRowCount(accountNo);
  const effectiveRowCount = Math.max(historyRowCount, rowCount);
  if (effectiveRowCount < minSamples) {
    return res.status(400).json({
      message: `Need at least ${minSamples} rows in uploaded Model.csv/history before retraining.`,
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

  if (rebuildFromScratch) {
    const removablePaths = [
      scope.svmSeqPath,
      scope.svmStatPath,
      scope.lstmPath,
      scope.referencePath,
    ];
    for (const candidate of removablePaths) {
      try {
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
          removedArtifacts.push(candidate);
        }
      } catch (error) {
        console.warn(`[model-bootstrap] failed to remove stale artifact ${candidate}: ${error.message}`);
      }
    }
    console.log(
      `[model-bootstrap] rebuildFromScratch enabled for scope=${scope.scopeId}. Removed ${removedArtifacts.length} stale artifacts.`
    );
  }

  const bootstrapArgs = [
    "ml/retrain_tiered_from_live_session.py",
    "--input",
    historyPath,
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
    "--min-hard-negatives",
    String(minHardNegatives),
    "--min-lstm-balanced-accuracy",
    String(minLstmBalancedAccuracy),
  ];
  if (enforceQualityGate) {
    bootstrapArgs.push("--enforce-quality-gate");
  }

  const child = spawnPython(bootstrapArgs, {
    cwd: ROOT_DIR,
  });

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
      inputRowCount: historyRowCount,
      historyRowCount,
      rebuildFromScratch,
      removedArtifacts,
      qualityGate: {
        enforced: enforceQualityGate,
        minHardNegatives,
        minLstmBalancedAccuracy,
      },
      artifacts: getModelArtifacts(accountNo),
      output: stdout.trim(),
      scopeId: scope.scopeId,
    });
  });
});

module.exports = router;

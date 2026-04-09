const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ensureTempInputCsvExists, TEMP_INPUT_PATH } = require("../utils/tempInputCsv");

const router = express.Router();

const ROOT_DIR = path.join(__dirname, "..");
const SVM_SEQ_PATH = path.join(ROOT_DIR, "svm_tier_1_sequence.pkl");
const SVM_STAT_PATH = path.join(ROOT_DIR, "svm_tier_2_statistical.pkl");
const LSTM_PATH = path.join(ROOT_DIR, "ml", "lstm_classifier.pt");
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

function readInputRowCount() {
  ensureTempInputCsvExists();
  const raw = fs.readFileSync(TEMP_INPUT_PATH, "utf8");
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Remove header row.
  return Math.max(0, lines.length - 1);
}

function getModelArtifacts() {
  return {
    svmSeqPath: SVM_SEQ_PATH,
    svmSeqModifiedAt: toIsoOrNull(SVM_SEQ_PATH),
    svmStatPath: SVM_STAT_PATH,
    svmStatModifiedAt: toIsoOrNull(SVM_STAT_PATH),
    lstmPath: LSTM_PATH,
    lstmModifiedAt: toIsoOrNull(LSTM_PATH),
  };
}

router.get("/status", (_, res) => {
  const rowCount = readInputRowCount();
  return res.status(200).json({
    trainingInProgress,
    lastTrainStatus,
    lastTrainAt,
    lastTrainError,
    inputPath: TEMP_INPUT_PATH,
    inputRowCount: rowCount,
    artifacts: getModelArtifacts(),
  });
});

router.post("/bootstrap", (req, res) => {
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

  const rowCount = readInputRowCount();
  if (rowCount < minSamples) {
    return res.status(400).json({
      message: `Need at least ${minSamples} rows in temp_input.csv before retraining.`,
      inputRowCount: rowCount,
      inputPath: TEMP_INPUT_PATH,
    });
  }

  trainingInProgress = true;
  lastTrainStatus = "training";
  lastTrainError = null;

  const child = spawn("python", ["ml/retrain_tiered_from_live_session.py"], {
    cwd: ROOT_DIR,
  });

  let stdout = "";
  let stderr = "";

  const timeoutId = setTimeout(() => {
    child.kill("SIGTERM");
  }, TRAIN_TIMEOUT_MS);

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    clearTimeout(timeoutId);
    trainingInProgress = false;

    if (code !== 0) {
      lastTrainStatus = "failed";
      lastTrainError = (stderr || stdout || `Exited with code ${code}`).trim();
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
      artifacts: getModelArtifacts(),
      output: stdout.trim(),
    });
  });
});

module.exports = router;

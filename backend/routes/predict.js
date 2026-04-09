const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const { writeTempInputCsv } = require("../utils/tempInputCsv");

const router = express.Router();

router.post("/", async (req, res) => {
  const { normalizedSession, rowCount, inputPath } = writeTempInputCsv(req.body.session);

  if (!normalizedSession.length) {
    console.warn("[predict] skipped prediction: empty session");
    return res.status(400).json({ message: "Session data is required." });
  }

  console.log(
    `[predict] received ${rowCount} rows and updated temp_input.csv at ${inputPath}`
  );

  const py = spawn("python", ["ml/predict_tiered.py"], {
    cwd: path.join(__dirname, ".."),
  });

  let output = "";
  let errorOutput = "";

  py.stdout.on("data", (data) => {
    output += data.toString();
  });

  py.stderr.on("data", (data) => {
    const message = data.toString();
    errorOutput += message;
    console.error("predict error:", message);
  });

  py.on("close", (code) => {
    if (code !== 0) {
      console.error(
        `[predict] python exited with code ${code}. ${errorOutput.trim() || "No stderr output."}`
      );
      return res.status(500).json({
        message: "Model prediction failed.",
        detail: errorOutput.trim() || `Predict script exited with code ${code}`,
      });
    }

    const [svm1Str, svm2Str, lstmStr] = output.trim().split(",");
    const svm1_score = parseFloat(svm1Str);
    const svm2_score = parseFloat(svm2Str);
    const lstm_score = parseFloat(lstmStr);

    if (
      !Number.isFinite(svm1_score) ||
      !Number.isFinite(svm2_score) ||
      !Number.isFinite(lstm_score)
    ) {
      console.error(`[predict] invalid score output: ${output.trim() || "<empty>"}`);
      return res.status(500).json({
        message: "Model prediction returned invalid scores.",
        detail: output.trim() || errorOutput.trim() || "No score output received.",
      });
    }

    const svm_mean = (svm1_score + svm2_score) / 2;
    const svm_agreement = Math.max(0, 1 - Math.abs(svm1_score - svm2_score));
    const svm_reliability = Math.max(0, Math.min(1, (svm_agreement - 0.2) / 0.8));
    const svm_weight = 0.25 * svm_reliability;
    const lstm_weight = 1 - svm_weight;
    const fused_score = lstm_score * lstm_weight + svm_mean * svm_weight;

    let risk = "low";
    if ((lstm_score < 0.25 && fused_score < 0.35) || fused_score < 0.3) {
      risk = "high";
    } else if (fused_score < 0.45) {
      risk = "medium";
    } else if (fused_score < 0.55) {
      risk = "low-medium";
    }

    console.log(
      `[predict] scores svm1=${svm1_score.toFixed(4)} svm2=${svm2_score.toFixed(4)} lstm=${lstm_score.toFixed(4)} fused=${fused_score.toFixed(4)} risk=${risk}`
    );

    return res.json({ svm1_score, svm2_score, lstm_score, fused_score, risk });
  });
});

module.exports = router;

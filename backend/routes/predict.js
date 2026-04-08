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

  const py = spawn("python", ["ml/predict_multi.py"], {
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

    let risk = "low";
    if (lstm_score < 0.4) {
      risk = "high";
    } else if (svm1_score < 0.4 && svm2_score < 0.4) {
      risk = "medium";
    } else if (svm1_score < 0.4) {
      risk = "low-medium";
    }

    console.log(
      `[predict] scores svm1=${svm1_score.toFixed(4)} svm2=${svm2_score.toFixed(4)} lstm=${lstm_score.toFixed(4)} risk=${risk}`
    );

    return res.json({ svm1_score, svm2_score, lstm_score, risk });
  });
});

module.exports = router;

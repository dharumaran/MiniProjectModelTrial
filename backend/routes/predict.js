const express = require("express");
const path = require("path");
const { writeTempInputCsv } = require("../utils/tempInputCsv");
const { resolveModelArtifacts } = require("../utils/modelArtifacts");
const { spawnPython, appendDependencyHint } = require("../utils/pythonRuntime");

const router = express.Router();

router.post("/", async (req, res) => {
  const accountNo = req.body?.accountNo || req.headers["x-account-no"];
  const { normalizedSession, rowCount, inputPath, scopeId } = writeTempInputCsv(
    req.body.session,
    { accountNo }
  );

  if (!normalizedSession.length) {
    console.warn("[predict] skipped prediction: empty session");
    return res.status(400).json({ message: "Session data is required." });
  }

  console.log(
    `[predict] scope=${scopeId} received ${rowCount} rows and updated temp_input.csv at ${inputPath}`
  );

  const artifacts = resolveModelArtifacts(accountNo);
  if (artifacts.missing.length) {
    return res.status(503).json({
      message: "Model artifacts are missing. Run /api/model/bootstrap to train models.",
      missingArtifacts: artifacts.missing,
      scope: scopeId,
    });
  }

  const py = spawnPython(
    [
      "ml/predict_tiered.py",
      "--temp-input",
      inputPath,
      "--svm-seq",
      artifacts.svmSeqPath,
      "--svm-stat",
      artifacts.svmStatPath,
      "--lstm",
      artifacts.lstmPath,
    ],
    {
      cwd: path.join(__dirname, ".."),
    }
  );

  let output = "";
  let errorOutput = "";
  let hasResponded = false;

  py.stdout.on("data", (data) => {
    output += data.toString();
  });

  py.stderr.on("data", (data) => {
    const message = data.toString();
    errorOutput += message;
    console.error("predict error:", message);
  });

  py.on("error", (error) => {
    if (hasResponded) {
      return;
    }
    hasResponded = true;
    return res.status(500).json({
      message: "Model prediction failed.",
      detail: `Failed to start Python process: ${error.message}`,
    });
  });

  py.on("close", (code) => {
    if (hasResponded) {
      return;
    }
    hasResponded = true;
    if (code !== 0) {
      console.error(
        `[predict] python exited with code ${code}. ${errorOutput.trim() || "No stderr output."}`
      );
      return res.status(500).json({
        message: "Model prediction failed.",
        detail: appendDependencyHint(
          errorOutput.trim() || `Predict script exited with code ${code}`
        ),
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
    } else if (fused_score < 0.4 || (lstm_score < 0.45 && fused_score < 0.5)) {
      // Escalate to medium-high when confidence drops significantly but not to hard high.
      risk = "medium-high";
    } else if (fused_score < 0.55 || (lstm_score < 0.6 && fused_score < 0.62)) {
      // Treat uncertain windows as medium when fused confidence is modest,
      // especially if LSTM drops, which is common during user-switch events.
      risk = "medium";
    } else if (fused_score < 0.65) {
      risk = "low-medium";
    }

    console.log(
      `[predict] scope=${scopeId} scores svm1=${svm1_score.toFixed(4)} svm2=${svm2_score.toFixed(4)} lstm=${lstm_score.toFixed(4)} fused=${fused_score.toFixed(4)} risk=${risk}`
    );

    return res.json({ svm1_score, svm2_score, lstm_score, fused_score, risk, scope: scopeId });
  });
});

module.exports = router;

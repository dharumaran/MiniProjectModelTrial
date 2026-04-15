const express = require("express");
const path = require("path");
const { writeTempInputCsv } = require("../utils/tempInputCsv");
const { resolveModelArtifacts } = require("../utils/modelArtifacts");
const { spawnPython, appendDependencyHint } = require("../utils/pythonRuntime");

const router = express.Router();

function parseScoreLine(rawOutput) {
  const lines = String(rawOutput || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // The predictor may print verbose diagnostics before the final CSV line.
  const csvLine = [...lines]
    .reverse()
    .find((line) => /^-?\d*\.?\d+(?:e[+-]?\d+)?,-?\d*\.?\d+(?:e[+-]?\d+)?,-?\d*\.?\d+(?:e[+-]?\d+)?,[01]$/i.test(line));

  if (!csvLine) {
    return null;
  }

  const [svm1Str, svm2Str, lstmStr, lstmUsedStr] = csvLine.split(",");
  const svm1_score = Number.parseFloat(svm1Str);
  const svm2_score = Number.parseFloat(svm2Str);
  const lstm_score = Number.parseFloat(lstmStr);
  const lstm_used = Number.parseInt(lstmUsedStr, 10) === 1;

  if (
    !Number.isFinite(svm1_score) ||
    !Number.isFinite(svm2_score) ||
    !Number.isFinite(lstm_score)
  ) {
    return null;
  }

  return { svm1_score, svm2_score, lstm_score, lstm_used, csvLine };
}

router.post("/", async (req, res) => {
  const accountNo = req.body?.accountNo || req.headers["x-account-no"];
  const { rowCount, inputPath, scopeId } = writeTempInputCsv(
    req.body.session,
    { accountNo }
  );

  if (!rowCount) {
    console.warn("[predict] skipped prediction: empty session");
    return res.status(400).json({ message: "Session data is required." });
  }

  console.log(
    `[predict] scope=${scopeId} received ${rowCount} rows and updated temp_input.csv at ${inputPath}`
  );

  const artifacts = resolveModelArtifacts(accountNo, {
    // For authenticated sessions, force account-scoped artifacts only.
    strictScope: Boolean(accountNo),
  });
  if (artifacts.missing.length) {
    return res.status(503).json({
      message: artifacts.strictScope
        ? "Scoped model artifacts are missing for this account. Run /api/model/bootstrap with rebuildFromScratch=true."
        : "Model artifacts are missing. Run /api/model/bootstrap to train models.",
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

    const parsed = parseScoreLine(output);
    if (!parsed) {
      console.error(`[predict] invalid score output: ${output.trim() || "<empty>"}`);
      return res.status(500).json({
        message: "Model prediction returned invalid scores.",
        detail: output.trim() || errorOutput.trim() || "No score output received.",
      });
    }
    const { svm1_score, svm2_score, lstm_score, lstm_used } = parsed;

    const svm_mean = (svm1_score + svm2_score) / 2;
    const svm_min = Math.min(svm1_score, svm2_score);
    const svm_gap = Math.abs(svm1_score - svm2_score);
    
    // IMPROVED RISK SCORING WITH CASCADE LOGIC
    // If lstm_used is false, LSTM wasn't engaged (cascade determined both SVMs agreed)
    let fused_score;
    
    if (!lstm_used) {
      // Balanced SVM-only fusion for genuine-user usability.
      fused_score = svm_min * 0.45 + svm_mean * 0.55;
      console.log(
        `[predict] Cascade: LSTM skipped - balanced SVM fusion min=${svm_min.toFixed(4)} mean=${svm_mean.toFixed(4)} fused=${fused_score.toFixed(4)}`
      );
    } else {
      // Cascade: LSTM was used because both SVMs detected suspicion.
      // Use fixed ensemble weights tuned for stronger sequence-model influence.
      const svm1_weight = 0.15;
      const svm2_weight = 0.15;
      const lstm_weight = 0.70;
      fused_score =
        svm1_score * svm1_weight +
        svm2_score * svm2_weight +
        lstm_score * lstm_weight;
      console.log(
        `[predict] Cascade: LSTM engaged - fixed weights SVM1=${svm1_weight.toFixed(2)}, SVM2=${svm2_weight.toFixed(2)}, LSTM=${lstm_weight.toFixed(2)}`
      );
    }

    let risk = "low";
    let action = "allow";  // Default action
    
    // Risk levels with actions
    // (score=1.0 is genuine/safe, 0.0 is intruder/threat)
    if (fused_score < 0.40) {
      risk = "high";
      action = "logout";  // 🚨 Probable intruder detected
    } else if (fused_score < 0.50) {
      risk = "medium-high";
      action = "reauth";  // ⚠️ Require reauthentication (MFA/PIN)
    } else if (fused_score < 0.60) {
      risk = "medium";
      action = "reauth";  // ⚠️ Require reauthentication
    } else if (fused_score < 0.72) {
      risk = "low-medium";
      action = "monitor";  // 👀 Accept but log activity
    } else {
      risk = "low";
      action = "allow";  // ✅ Normal operation
    }

    // Additional safeguards: prevent low-risk classification when SVM signals are weak/inconsistent.
    if (risk === "low" && (svm_min < 0.62 || svm_gap > 0.25)) {
      risk = "low-medium";
      action = "monitor";
    }
    if ((risk === "low" || risk === "low-medium") && svm_min < 0.50) {
      risk = "medium";
      action = "reauth";
    }
    // Anti-spike guard: when LSTM is confidently genuine, avoid medium jumps
    // unless both SVM signals are clearly suspicious.
    if (
      lstm_used &&
      lstm_score >= 0.70 &&
      fused_score >= 0.60 &&
      (risk === "medium" || risk === "medium-high")
    ) {
      const strongSvmIntruderSignal = svm1_score < 0.45 && svm2_score < 0.45;
      if (!strongSvmIntruderSignal) {
        risk = "low-medium";
        action = "monitor";
      }
    }
    if (
      lstm_used &&
      lstm_score >= 0.78 &&
      fused_score >= 0.66 &&
      svm_gap <= 0.18 &&
      risk !== "high"
    ) {
      risk = "low";
      action = "allow";
    }
    // Genuine-override for high-confidence SVM agreement when LSTM was not needed.
    if (!lstm_used && svm_min >= 0.78 && svm_gap <= 0.12) {
      risk = "low";
      action = "allow";
    }

    console.log(
      `[predict] scope=${scopeId} scores svm1=${svm1_score.toFixed(4)} svm2=${svm2_score.toFixed(4)} lstm=${lstm_score.toFixed(4)} fused=${fused_score.toFixed(4)} risk=${risk} action=${action}`
    );

    return res.json({ 
      svm1_score, 
      svm2_score, 
      lstm_score, 
      lstm_used,
      fused_score, 
      risk, 
      action,  // Tell frontend what to do
      scope: scopeId 
    });
  });
});

module.exports = router;

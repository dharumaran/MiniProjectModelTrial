const express = require("express");
const router = express.Router();
const { spawn } = require("child_process");

router.post("/", async (req, res) => {
  const session = req.body.session;

  // Save session to CSV
  const fs = require("fs");
  const path = "ml/temp_input.csv";
  const header = "X,Y,Pressure,Duration,Orientation,Size\n";
  const rows = session.map(
    (row) =>
      `${row.accelX},${row.accelY},${row.touchPressure},${row.duration},0,0`
  );

  fs.writeFileSync(path, header + rows.join("\n"));

  // Run predict_svm.py
  const py = spawn("python", ["ml/predict_svm.py"]);
  let output = "";

  py.stdout.on("data", (data) => (output += data.toString()));
  py.stderr.on("data", (err) => console.error("❌", err.toString()));

  py.on("close", (code) => {
    const score = parseFloat(output.trim());
    let risk = "low";
    if (score < 0.4) risk = "high";
    else if (score < 0.65) risk = "medium";

    return res.json({ score, risk });
  });
});

module.exports = router;

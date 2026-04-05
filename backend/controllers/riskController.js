const { spawn } = require("child_process");
const fs = require("fs");

exports.verifySession = async (req, res) => {
  const session = req.body.session;
  fs.writeFileSync("ml-engine/temp_session.json", JSON.stringify(session));

  const py = spawn("python", ["ml-engine/verify.py"]);

  py.stdout.on("data", (data) => {
    const riskScore = parseFloat(data.toString());
    let level = "low";
    if (riskScore > 0.65) level = "high";
    else if (riskScore > 0.35) level = "medium";

    return res.json({ riskScore, level });
  });

  py.stderr.on("data", (data) => {
    console.error(data.toString());
    res.status(500).send("Error running model");
  });
};

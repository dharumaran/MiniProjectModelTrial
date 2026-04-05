const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Route to save the behavior data to a CSV file
router.post("/behavior", async (req, res) => {
  const { session } = req.body;

  // Prepare CSV headers and rows
  const featureHeaders = "X,Y,Pressure,Duration,Orientation,Size\n";
  const rows = session.map(
    (d) =>
      `${d.X},${d.Y},${d.Pressure || 0.5},${d.Duration || 120},${
        d.Orientation || 0
      },${d.Size || 0.5}`
  );

  const csvData = featureHeaders + rows.join("\n");

  // Path to the CSV file where the behavior data will be saved
  const inputPath = path.join(__dirname, "../ml/temp_input.csv");

  // Write to the file
  fs.writeFileSync(inputPath, csvData, (err) => {
    if (err) {
      return res.status(500).json({ message: "Error saving data" });
    }
    return res.status(200).json({ message: "Data saved successfully!" });
  });

  return res.status(200).json({ message: "Behavior data saved successfully!" });
});

module.exports = router;

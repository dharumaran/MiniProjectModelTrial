const express = require("express");
const { writeTempInputCsv, ensureTempInputCsvExists } = require("../utils/tempInputCsv");

const router = express.Router();

router.post("/behavior", async (req, res) => {
  try {
    const { rowCount, inputPath } = writeTempInputCsv(req.body.session);
    ensureTempInputCsvExists();

    if (!rowCount) {
      console.warn("[record-session] session received with no rows; header file ensured");
      return res.status(200).json({
        message: "No session rows received. temp_input.csv header is ready.",
        rowCount: 0,
        inputPath,
      });
    }

    console.log(
      `[record-session] temp_input.csv updated with ${rowCount} rows at ${inputPath}`
    );

    return res.status(200).json({
      message: "Behavior data saved successfully.",
      rowCount,
      inputPath,
    });
  } catch (error) {
    console.error("[record-session] failed to update temp_input.csv", error);
    return res.status(500).json({
      message: "Error saving data.",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

module.exports = router;

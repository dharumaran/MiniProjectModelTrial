const express = require("express");
const { writeTempInputCsv, ensureTempInputCsvExists } = require("../utils/tempInputCsv");
const { registerUser } = require("../utils/userRegistry");
const { registerUserAccount, ensureUsersAccountsCsvExists } = require("../utils/modelCsvLoader");

const router = express.Router();

router.post("/behavior", async (req, res) => {
  try {
    const accountNo = req.body?.accountNo || req.headers["x-account-no"];
    const bankName = req.body?.bankName || req.headers["x-bank-name"] || "Unknown";
    
    // Register/update user in the registry
    const userEntry = registerUser(accountNo);
    
    // Also register in users_accounts.csv for bank account tracking
    ensureUsersAccountsCsvExists();
    registerUserAccount(userEntry.userId, accountNo, bankName, "active");
    
    const { rowCount, inputPath, scopeId } = writeTempInputCsv(req.body.session, {
      accountNo,
    });
    ensureTempInputCsvExists({ accountNo });

    if (!rowCount) {
      console.warn("[record-session] session received with no rows; header file ensured");
      return res.status(200).json({
        message: "No session rows received. Behavior tracking is ready.",
        rowCount: 0,
        inputPath,
        scopeId,
        userId: userEntry.userId,
      });
    }

    console.log(
      `[record-session] Behavior data updated with ${rowCount} rows for user ${userEntry.userId}`
    );

    return res.status(200).json({
      message: "Behavior data saved successfully.",
      rowCount,
      inputPath,
      scopeId,
      userId: userEntry.userId,
      bankName,
    });
  } catch (error) {
    console.error("[record-session] failed to save behavior data", error);
    return res.status(500).json({
      message: "Error saving data.",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

module.exports = router;

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  MODEL_CSV_BACKEND_PATH,
  registerUserAccount,
  ensureUsersAccountsCsvExists,
} = require("../utils/modelCsvLoader");
const { registerUser } = require("../utils/userRegistry");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Upload/sync Model.csv from mobile export to backend
 * POST /ml/sync-model-csv
 * Body: { accountNo, bankName?, csvContent }
 * or File upload with form data
 */
router.post("/sync-model-csv", upload.single("modelCsv"), async (req, res) => {
  try {
    const accountNo = req.body?.accountNo || req.headers["x-account-no"];
    const bankName = req.body?.bankName || req.headers["x-bank-name"] || "Unknown";

    if (!accountNo) {
      return res.status(400).json({
        message: "Missing accountNo",
      });
    }

    let csvContent;
    if (req.file) {
      // File was uploaded
      csvContent = req.file.buffer.toString("utf8");
    } else if (req.body.csvContent) {
      // CSV content in body
      csvContent = req.body.csvContent;
    } else {
      return res.status(400).json({
        message: "No CSV content provided. Use file upload or csvContent in body.",
      });
    }

    // Register user
    const userEntry = registerUser(accountNo);
    ensureUsersAccountsCsvExists();
    registerUserAccount(userEntry.userId, accountNo, bankName, "active");

    // Ensure backend directory exists
    const backendDir = path.dirname(MODEL_CSV_BACKEND_PATH);
    if (!fs.existsSync(backendDir)) {
      fs.mkdirSync(backendDir, { recursive: true });
    }

    // Write to backend Model.csv
    fs.writeFileSync(MODEL_CSV_BACKEND_PATH, csvContent, "utf8");

    // Count rows for response
    const lines = csvContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const rowCount = Math.max(0, lines.length - 1); // Subtract header

    console.log(
      `[ml/sync] Model.csv synced for user ${userEntry.userId}: ${rowCount} rows written to ${MODEL_CSV_BACKEND_PATH}`
    );

    return res.status(200).json({
      message: "Model.csv synced successfully to backend.",
      userId: userEntry.userId,
      accountNo,
      bankName,
      rowCount,
      backendPath: MODEL_CSV_BACKEND_PATH,
      bytesWritten: csvContent.length,
    });
  } catch (error) {
    console.error("[ml/sync] Failed to sync Model.csv:", error);
    return res.status(500).json({
      message: "Error syncing Model.csv",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Get Model.csv stats
 * GET /ml/model-csv-stats
 */
router.get("/model-csv-stats", async (req, res) => {
  try {
    if (!fs.existsSync(MODEL_CSV_BACKEND_PATH)) {
      return res.status(404).json({
        message: "Model.csv not found in backend",
        path: MODEL_CSV_BACKEND_PATH,
      });
    }

    const content = fs.readFileSync(MODEL_CSV_BACKEND_PATH, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const header = lines[0];
    const rowCount = lines.length - 1;
    const fileSizeBytes = content.length;

    // Parse header to detect columns
    const columns = header.split(",");
    const hasUserId = columns.some((col) =>
      ["user_id", "userid", "UserId"].includes(col)
    );

    // Count unique users if user_id column exists
    let uniqueUsers = 0;
    if (hasUserId) {
      const userIdIndex = columns.findIndex((col) =>
        ["user_id", "userid", "UserId"].includes(col)
      );
      const userIds = new Set();
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        if (values[userIdIndex]) {
          userIds.add(values[userIdIndex].trim());
        }
      }
      uniqueUsers = userIds.size;
    }

    return res.status(200).json({
      message: "Model.csv stats retrieved",
      path: MODEL_CSV_BACKEND_PATH,
      rowCount,
      fileSizeBytes,
      fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
      columns,
      hasUserIdColumn: hasUserId,
      uniqueUsers,
      lastModified: new Date(fs.statSync(MODEL_CSV_BACKEND_PATH).mtimeMs).toISOString(),
    });
  } catch (error) {
    console.error("[ml/sync] Failed to get Model.csv stats:", error);
    return res.status(500).json({
      message: "Error retrieving stats",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

module.exports = router;

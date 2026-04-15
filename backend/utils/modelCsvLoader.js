const fs = require("fs");
const path = require("path");
const { resolveModelScope } = require("./modelScope");

/**
 * Paths for data management
 */
const MODEL_CSV_BACKEND_PATH = path.join(__dirname, "../ml/user_profiles/shared/Model.csv");
const USERS_ACCOUNTS_PATH = path.join(__dirname, "../ml/user_profiles/shared/users_accounts.csv");
const USERS_ACCOUNTS_HEADER = "UserId,AccountNo,BankName,Status\n";

/**
 * Ensure users_accounts.csv exists with proper header
 */
function ensureUsersAccountsCsvExists() {
  const directory = path.dirname(USERS_ACCOUNTS_PATH);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(USERS_ACCOUNTS_PATH)) {
    fs.writeFileSync(USERS_ACCOUNTS_PATH, USERS_ACCOUNTS_HEADER, "utf8");
    return;
  }

  const content = fs.readFileSync(USERS_ACCOUNTS_PATH, "utf8");
  if (!content.startsWith(USERS_ACCOUNTS_HEADER)) {
    fs.writeFileSync(USERS_ACCOUNTS_PATH, `${USERS_ACCOUNTS_HEADER}${content}`, "utf8");
  }
}

/**
 * Register a user account with bank details
 */
function registerUserAccount(userId, accountNo, bankName = "Unknown", status = "active") {
  ensureUsersAccountsCsvExists();
  const content = fs.readFileSync(USERS_ACCOUNTS_PATH, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("UserId"));

  // Check if user already exists
  const existingIndex = lines.findIndex((line) => line.startsWith(userId + ","));

  const now = new Date().toISOString();
  const newLine = `${userId},${accountNo},${bankName},${status}`;

  if (existingIndex >= 0) {
    lines[existingIndex] = newLine;
  } else {
    lines.push(newLine);
  }

  fs.writeFileSync(USERS_ACCOUNTS_PATH, USERS_ACCOUNTS_HEADER + lines.join("\n") + "\n", "utf8");
}

/**
 * Get all registered user accounts
 */
function getAllUserAccounts() {
  ensureUsersAccountsCsvExists();
  const content = fs.readFileSync(USERS_ACCOUNTS_PATH, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("UserId"));

  const users = {};
  lines.forEach((line) => {
    const [userId, accountNo, bankName, status] = line.split(",");
    if (userId) {
      users[userId] = {
        userId,
        accountNo,
        bankName,
        status,
      };
    }
  });

  return users;
}

/**
 * Read Model.csv from backend and return data grouped by user
 */
function readModelCsvByUser(options = {}) {
  const modelPath = options.modelPath || MODEL_CSV_BACKEND_PATH;

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model.csv not found at ${modelPath}`);
  }

  const content = fs.readFileSync(modelPath, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("Model.csv is empty or missing data rows");
  }

  // Parse header
  const header = lines[0].split(",");
  const userIdIndex = header.findIndex((h) => h.toLowerCase() === "user_id" || h.toLowerCase() === "userid");
  
  if (userIdIndex === -1) {
    throw new Error("Model.csv missing user_id or userId column");
  }

  // Group data by user
  const userGroups = {};
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const userId = (values[userIdIndex] || "unknown").trim();
    
    if (!userGroups[userId]) {
      userGroups[userId] = [];
    }
    
    userGroups[userId].push(lines[i]);
  }

  return {
    header,
    userGroups,
    totalRows: lines.length - 1,
    totalUsers: Object.keys(userGroups).length,
  };
}

/**
 * Export model data for specific user to a CSV in the backend
 */
function exportUserModelCsv(userId, options = {}) {
  const { userGroups, header } = readModelCsvByUser(options);
  
  if (!userGroups[userId]) {
    throw new Error(`No data found for user ${userId}`);
  }

  const scope = resolveModelScope(userId);
  const outputPath = options.outputPath || scope.tempInputPath;
  
  // Ensure directory exists
  const directory = path.dirname(outputPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  // Write to user-specific CSV
  const csvContent = header.join(",") + "\n" + userGroups[userId].join("\n") + "\n";
  fs.writeFileSync(outputPath, csvContent, "utf8");

  return {
    userId,
    rowCount: userGroups[userId].length,
    outputPath,
    header,
  };
}

/**
 * Get feature data for all users from Model.csv
 * Returns data in format suitable for multi-user model training
 */
function getModelCsvFeatureData(options = {}) {
  const { userGroups, header } = readModelCsvByUser(options);
  const featureData = {};

  Object.entries(userGroups).forEach(([userId, rows]) => {
    const userData = rows.map((row) => {
      const values = row.split(",");
      return {
        original: row,
        values: values,
      };
    });

    featureData[userId] = {
      rows: userData,
      count: userData.length,
    };
  });

  return {
    header,
    featureData,
    userSummary: Object.entries(featureData).reduce((acc, [userId, data]) => {
      acc[userId] = data.count;
      return acc;
    }, {}),
  };
}

/**
 * Copy Model.csv from mobile export location (if different from backend)
 */
function syncModelCsvFromMobileExport(sourceModelPath, options = {}) {
  const targetPath = options.targetPath || MODEL_CSV_BACKEND_PATH;

  if (!fs.existsSync(sourceModelPath)) {
    throw new Error(`Source Model.csv not found at ${sourceModelPath}`);
  }

  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Read source
  const content = fs.readFileSync(sourceModelPath, "utf8");

  // Write to backend location
  fs.writeFileSync(targetPath, content, "utf8");

  return {
    sourceModelPath,
    targetPath,
    bytesTransferred: content.length,
  };
}

module.exports = {
  ensureUsersAccountsCsvExists,
  registerUserAccount,
  getAllUserAccounts,
  readModelCsvByUser,
  exportUserModelCsv,
  getModelCsvFeatureData,
  syncModelCsvFromMobileExport,
  MODEL_CSV_BACKEND_PATH,
  USERS_ACCOUNTS_PATH,
};

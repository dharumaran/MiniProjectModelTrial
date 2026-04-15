#!/usr/bin/env node
/**
 * Model Training Management CLI
 * 
 * Usage:
 * node train-models.js --command train --user-id BANK123 --enforce-quality-gate
 * node train-models.js --command stats
 * node train-models.js --command list-users
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  readModelCsvByUser,
  getAllUserAccounts,
  exportUserModelCsv,
  MODEL_CSV_BACKEND_PATH,
} = require("./utils/modelCsvLoader");

const ML_DIR = path.join(__dirname, "backend/ml");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

async function getModelCsvStats() {
  try {
    if (!fs.existsSync(MODEL_CSV_BACKEND_PATH)) {
      log(`\n❌ Model.csv not found at ${MODEL_CSV_BACKEND_PATH}`, "red");
      return;
    }

    const stats = readModelCsvByUser();
    const fileStats = fs.statSync(MODEL_CSV_BACKEND_PATH);

    log("\n📊 Model.csv Statistics", "bright");
    log("═".repeat(50), "cyan");
    log(`Path: ${MODEL_CSV_BACKEND_PATH}`);
    log(`Size: ${formatBytes(fileStats.size)}`);
    log(`Last Modified: ${new Date(fileStats.mtime).toISOString()}`);
    log(`Total Rows: ${stats.totalRows}`);
    log(`Total Users: ${stats.totalUsers}`);
    log(`Columns: ${stats.header.join(", ")}`);

    log("\n📈 User Data Distribution:", "cyan");
    Object.entries(stats.userGroups).forEach(([userId, rows]) => {
      const pct = ((rows.length / stats.totalRows) * 100).toFixed(1);
      log(`  ${userId}: ${rows.length} rows (${pct}%)`);
    });

    log("\n✅ Done\n", "green");
  } catch (error) {
    log(`\n❌ Error getting stats: ${error.message}`, "red");
  }
}

async function listRegisteredUsers() {
  try {
    const users = getAllUserAccounts();

    if (Object.keys(users).length === 0) {
      log("\n⚠️  No registered users found", "yellow");
      return;
    }

    log("\n👥 Registered User Accounts", "bright");
    log("═".repeat(80), "cyan");
    log(
      `${"UserId".padEnd(25)} ${"AccountNo".padEnd(25)} ${"Bank".padEnd(20)} Status`
    );
    log("─".repeat(80), "cyan");

    Object.values(users).forEach((user) => {
      log(
        `${user.userId.padEnd(25)} ${user.accountNo.padEnd(25)} ${user.bankName.padEnd(20)} ${user.status}`
      );
    });

    log(`\n✅ Total Users: ${Object.keys(users).length}\n`, "green");
  } catch (error) {
    log(`\n❌ Error listing users: ${error.message}`, "red");
  }
}

async function trainModel(userId, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(ML_DIR, "retrain_from_model_csv.py"),
      "--model-csv",
      MODEL_CSV_BACKEND_PATH,
    ];

    if (userId) {
      args.push("--user-id", userId);
      args.push("--scope-id", userId);
    }

    if (options.enforceQualityGate) {
      args.push("--enforce-quality-gate");
    }

    if (options.minAccuracy) {
      args.push("--min-lstm-balanced-accuracy", options.minAccuracy.toString());
    }

    log(`\n🚀 Starting model training...`, "cyan");
    log(`   Model CSV: ${MODEL_CSV_BACKEND_PATH}`);
    if (userId) {
      log(`   User ID: ${userId}`);
    }
    log(`   Quality Gate: ${options.enforceQualityGate ? "Enabled" : "Disabled"}`);
    log(`   Min Accuracy: ${options.minAccuracy || "0.60"}`);
    log("═".repeat(70) + "\n");

    const python = spawn("python", args, {
      cwd: ML_DIR,
      stdio: "inherit",
    });

    python.on("close", (code) => {
      log("\n" + "═".repeat(70), "cyan");
      if (code === 0) {
        log(
          `\n✅ Training completed successfully${
            userId ? ` for user ${userId}` : " (all users)"
          }\n`,
          "green"
        );
        resolve(true);
      } else {
        log(
          `\n❌ Training failed with exit code ${code}${
            userId ? ` for user ${userId}` : ""
          }\n`,
          "red"
        );
        reject(new Error(`Training process exited with code ${code}`));
      }
    });

    python.on("error", (err) => {
      log(`\n❌ Error spawning Python process: ${err.message}\n`, "red");
      reject(err);
    });
  });
}

async function trainAllUsers(options = {}) {
  try {
    const stats = readModelCsvByUser();

    if (stats.totalUsers === 0) {
      log("\n⚠️  No users found in Model.csv", "yellow");
      return;
    }

    log(
      `\n🔄 Training models for ${stats.totalUsers} users...`,
      "cyan"
    );

    const users = Object.keys(stats.userGroups);
    const results = {
      succeeded: [],
      failed: [],
    };

    for (const userId of users) {
      try {
        await trainModel(userId, options);
        results.succeeded.push(userId);
      } catch (error) {
        log(`⚠️  Training failed for user ${userId}: ${error.message}`, "yellow");
        results.failed.push({ userId, error: error.message });
      }
    }

    log("\n📋 Training Summary", "bright");
    log("═".repeat(50), "cyan");
    log(`✅ Succeeded: ${results.succeeded.length}`, "green");
    results.succeeded.forEach((uid) => log(`   - ${uid}`));

    if (results.failed.length > 0) {
      log(`❌ Failed: ${results.failed.length}`, "red");
      results.failed.forEach((item) => log(`   - ${item.userId}: ${item.error}`));
    }

    log("\n✅ Batch training completed\n", "green");
  } catch (error) {
    log(`\n❌ Error during batch training: ${error.message}`, "red");
  }
}

async function exportUserData(userId) {
  try {
    const result = exportUserModelCsv(userId);

    log(`\n✅ User data exported for ${userId}`, "green");
    log("═".repeat(50), "cyan");
    log(`Path: ${result.outputPath}`);
    log(`Rows: ${result.rowCount}`);
    log(`Columns: ${result.header.join(", ")}`);
    log(`\n✅ Done\n`, "green");
  } catch (error) {
    log(`\n❌ Error exporting user data: ${error.message}`, "red");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  let command = "help";
  let userId = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--command") {
      command = args[++i];
    } else if (args[i] === "--user-id") {
      userId = args[++i];
    } else if (args[i] === "--enforce-quality-gate") {
      options.enforceQualityGate = true;
    } else if (args[i] === "--min-accuracy") {
      options.minAccuracy = parseFloat(args[++i]);
    }
  }

  log("\n" + "═".repeat(70), "bright");
  log("🧠 Model Training Management CLI", "bright");
  log("═".repeat(70) + "\n");

  try {
    switch (command) {
      case "stats":
        await getModelCsvStats();
        break;

      case "list-users":
        await listRegisteredUsers();
        break;

      case "train":
        if (!userId) {
          log("❌ Error: --user-id is required for train command", "red");
          log("   Example: node train-models.js --command train --user-id BANK123\n");
          process.exit(1);
        }
        await trainModel(userId, options);
        break;

      case "train-all":
        await trainAllUsers(options);
        break;

      case "export":
        if (!userId) {
          log("❌ Error: --user-id is required for export command", "red");
          process.exit(1);
        }
        await exportUserData(userId);
        break;

      case "help":
      default:
        log("📖 Available Commands:\n", "bright");
        log("  stats", "cyan");
        log("    Show Model.csv statistics and user distribution");
        log("");
        log("  list-users", "cyan");
        log("    List all registered user accounts");
        log("");
        log("  train [--user-id USER] [--enforce-quality-gate] [--min-accuracy 0.75]", "cyan");
        log("    Train model for specific user");
        log("");
        log("  train-all [--enforce-quality-gate] [--min-accuracy 0.75]", "cyan");
        log("    Train models for all users in Model.csv");
        log("");
        log("  export [--user-id USER]", "cyan");
        log("    Export data for specific user");
        log("");
        log("  help", "cyan");
        log("    Show this help message");
        log("");
        log("📝 Examples:\n", "bright");
        log("  # Get stats", "yellow");
        log("  node train-models.js --command stats\n");
        log("  # Train specific user", "yellow");
        log("  node train-models.js --command train --user-id BANK123 --enforce-quality-gate\n");
        log("  # Train all users", "yellow");
        log("  node train-models.js --command train-all --enforce-quality-gate\n");
        log("  # Export user data", "yellow");
        log("  node train-models.js --command export --user-id BANK123\n");
    }
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, "red");
    process.exit(1);
  }
}

main();

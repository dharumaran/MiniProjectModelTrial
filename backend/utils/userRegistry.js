const fs = require("fs");
const path = require("path");

const USER_PROFILES_ROOT = path.join(__dirname, "../ml/user_profiles");
const USERS_REGISTRY_PATH = path.join(USER_PROFILES_ROOT, "shared/users_registry.csv");
const USERS_REGISTRY_HEADER = "UserId,AccountNo,FirstSeen,LastSeen,TotalSessions\n";

/**
 * Sanitize account number to create a unique user ID
 */
function sanitizeAccountNo(accountNo) {
  const raw = String(accountNo || "").trim();
  if (!raw) {
    return "unknown_user";
  }
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "unknown_user";
}

/**
 * Ensure users registry CSV exists with proper header
 */
function ensureUsersRegistryExists() {
  const directory = path.dirname(USERS_REGISTRY_PATH);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(USERS_REGISTRY_PATH)) {
    fs.writeFileSync(USERS_REGISTRY_PATH, USERS_REGISTRY_HEADER, "utf8");
    return;
  }

  const content = fs.readFileSync(USERS_REGISTRY_PATH, "utf8");
  if (!content.startsWith(USERS_REGISTRY_HEADER)) {
    fs.writeFileSync(USERS_REGISTRY_PATH, `${USERS_REGISTRY_HEADER}${content}`, "utf8");
  }
}

/**
 * Get all registered users
 */
function getRegisteredUsers() {
  ensureUsersRegistryExists();
  const content = fs.readFileSync(USERS_REGISTRY_PATH, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("UserId"));

  const users = {};
  lines.forEach((line) => {
    const [userId, accountNo, firstSeen, lastSeen, totalSessions] = line.split(",");
    if (userId) {
      users[userId] = {
        userId,
        accountNo,
        firstSeen,
        lastSeen,
        totalSessions: parseInt(totalSessions, 10) || 0,
      };
    }
  });

  return users;
}

/**
 * Register or update a user in the registry
 */
function registerUser(accountNo) {
  ensureUsersRegistryExists();
  const userId = sanitizeAccountNo(accountNo);
  const now = new Date().toISOString();

  const users = getRegisteredUsers();

  if (users[userId]) {
    // Update existing user
    users[userId].lastSeen = now;
    users[userId].totalSessions = (users[userId].totalSessions || 0) + 1;
  } else {
    // Add new user
    users[userId] = {
      userId,
      accountNo,
      firstSeen: now,
      lastSeen: now,
      totalSessions: 1,
    };
  }

  // Rewrite registry
  const lines = [USERS_REGISTRY_HEADER];
  Object.values(users).forEach((user) => {
    lines.push(`${user.userId},${user.accountNo},${user.firstSeen},${user.lastSeen},${user.totalSessions}`);
  });

  fs.writeFileSync(USERS_REGISTRY_PATH, lines.join("\n"), "utf8");

  return users[userId];
}

/**
 * Get user by account number
 */
function getUserByAccountNo(accountNo) {
  const userId = sanitizeAccountNo(accountNo);
  const users = getRegisteredUsers();
  return users[userId] || null;
}

module.exports = {
  sanitizeAccountNo,
  ensureUsersRegistryExists,
  getRegisteredUsers,
  registerUser,
  getUserByAccountNo,
  USERS_REGISTRY_PATH,
};

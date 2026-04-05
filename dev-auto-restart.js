const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend-app");

const WATCH_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".env",
  ".md",
]);

let backendProcess = null;
let frontendProcess = null;
let restartTimer = null;
let restarting = false;

function isIgnoredPath(filePath = "") {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return (
    normalizedPath.includes("/node_modules/") ||
    normalizedPath.includes("/.git/") ||
    normalizedPath.includes("/.expo/") ||
    normalizedPath.includes("/dist/") ||
    normalizedPath.includes("/build/")
  );
}

function shouldReactToChange(filePath = "") {
  if (!filePath || isIgnoredPath(filePath)) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  return WATCH_EXTENSIONS.has(extension);
}

function spawnCommand(name, cwd, command, args) {
  const child = spawn(command, args, {
    cwd,
    shell: true,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    if (!restarting && code !== 0) {
      console.log(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

function killProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: true,
        stdio: "ignore",
      });
      killer.on("exit", () => resolve());
      return;
    }

    child.kill("SIGTERM");
    resolve();
  });
}

async function startServers() {
  console.log("[dev-auto] starting backend and frontend...");
  backendProcess = spawnCommand("backend", backendDir, "npm", ["run", "dev"]);
  frontendProcess = spawnCommand("frontend", frontendDir, "npm", ["run", "start"]);
}

async function restartServers(reason) {
  if (restarting) {
    return;
  }
  restarting = true;
  console.log(`[dev-auto] restarting both servers (${reason})...`);

  await Promise.all([killProcessTree(backendProcess), killProcessTree(frontendProcess)]);

  backendProcess = null;
  frontendProcess = null;
  await startServers();
  restarting = false;
}

function scheduleRestart(reason) {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    void restartServers(reason);
  }, 500);
}

function createWatcher(targetDir, label) {
  const watcher = fs.watch(
    targetDir,
    { recursive: true },
    (_, fileNameBuffer) => {
      const relative = String(fileNameBuffer || "");
      const absolute = path.join(targetDir, relative);
      if (!shouldReactToChange(absolute)) {
        return;
      }
      scheduleRestart(`${label}: ${relative}`);
    }
  );

  watcher.on("error", (error) => {
    console.error(`[dev-auto] watcher error in ${label}:`, error.message);
  });

  return watcher;
}

async function shutdown() {
  restarting = true;
  await Promise.all([killProcessTree(backendProcess), killProcessTree(frontendProcess)]);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

void startServers();
createWatcher(backendDir, "backend");
createWatcher(frontendDir, "frontend");

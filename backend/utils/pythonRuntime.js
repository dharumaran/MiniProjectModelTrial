const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function isWindows() {
  return process.platform === "win32";
}

function getProjectRoot() {
  return path.join(__dirname, "..");
}

function getCandidateRuntimes() {
  const projectRoot = getProjectRoot();
  const candidates = [];

  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim()) {
    candidates.push({
      command: process.env.PYTHON_BIN.trim(),
      args: [],
      label: "PYTHON_BIN",
    });
  }

  const venvPython = isWindows()
    ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, ".venv", "bin", "python");

  if (fs.existsSync(venvPython)) {
    candidates.push({
      command: venvPython,
      args: [],
      label: ".venv",
    });
  }

  candidates.push({ command: "python", args: [], label: "python" });

  if (isWindows()) {
    candidates.push({ command: "py", args: ["-3"], label: "py -3" });
  }

  return candidates;
}

function chooseRuntime() {
  return getCandidateRuntimes()[0];
}

function spawnPython(scriptArgs, options = {}) {
  const runtime = chooseRuntime();
  return spawn(runtime.command, [...runtime.args, ...scriptArgs], options);
}

function buildMissingModuleHint(moduleName = "required Python package") {
  const projectRoot = getProjectRoot();
  const requirementsPath = path.join(projectRoot, "requirements.txt");
  const runtime = chooseRuntime();

  const quotedCommand = runtime.command.includes(" ")
    ? `\"${runtime.command}\"`
    : runtime.command;
  const installCmd = `${quotedCommand} -m pip install -r \"${requirementsPath}\"`;

  return `Missing Python dependency: ${moduleName}. Install backend dependencies with: ${installCmd}`;
}

function appendDependencyHint(rawError) {
  if (!rawError || !rawError.includes("ModuleNotFoundError")) {
    return rawError;
  }

  const match = rawError.match(/No module named ['\"]([^'\"]+)['\"]/);
  const moduleName = match?.[1] || "required Python package";
  const hint = buildMissingModuleHint(moduleName);

  if (rawError.includes(hint)) {
    return rawError;
  }

  return `${rawError.trim()}\n${hint}`;
}

module.exports = {
  spawnPython,
  appendDependencyHint,
  chooseRuntime,
};

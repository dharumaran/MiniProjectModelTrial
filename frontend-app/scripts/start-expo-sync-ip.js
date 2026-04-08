#!/usr/bin/env node

const os = require("os");
const { execFileSync, spawn } = require("child_process");

function isPrivateIpv4(ip) {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function getIpv4FromDefaultRouteWindows() {
  try {
    const psCommand =
      "$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' " +
      "| Sort-Object RouteMetric, ifMetric | Select-Object -First 1; " +
      "if ($null -ne $route) { " +
      "(Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 " +
      "| Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' } " +
      "| Select-Object -First 1 -ExpandProperty IPAddress) }";

    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );

    const ip = output.trim();
    return ip || null;
  } catch {
    return null;
  }
}

function getFallbackIpv4() {
  const interfaces = os.networkInterfaces();
  for (const networkInterface of Object.values(interfaces)) {
    for (const details of networkInterface || []) {
      if (
        details &&
        details.family === "IPv4" &&
        !details.internal &&
        !details.address.startsWith("169.254.") &&
        isPrivateIpv4(details.address)
      ) {
        return details.address;
      }
    }
  }
  return null;
}

function getCurrentIp() {
  if (process.platform === "win32") {
    return getIpv4FromDefaultRouteWindows() || getFallbackIpv4();
  }
  return getFallbackIpv4();
}

const scriptArgs = process.argv.slice(2);
const mode = scriptArgs[0] || "--lan";
const extraArgs = scriptArgs.slice(1);

const ip = getCurrentIp();
const env = { ...process.env };

if (ip) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;
  env.EXPO_PUBLIC_API_BASE_URL = `http://${ip}:5000/api`;
  console.log(`[sync-ip] Metro host: ${ip}`);
  console.log(`[sync-ip] API base URL: ${env.EXPO_PUBLIC_API_BASE_URL}`);
} else {
  console.log("[sync-ip] Could not detect an active private IPv4. Starting Expo without forced host.");
}

const expoArgs = ["expo", "start", mode, ...extraArgs];

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npx", ...expoArgs], {
        shell: false,
        stdio: "inherit",
        env,
      })
    : spawn("npx", expoArgs, {
        shell: false,
        stdio: "inherit",
        env,
      });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});


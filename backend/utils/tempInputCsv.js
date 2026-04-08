const fs = require("fs");
const path = require("path");

const TEMP_INPUT_PATH = path.join(__dirname, "../ml/temp_input.csv");
const HEADER = "X,Y,Pressure,Duration,Orientation,Size\n";

function ensureTempInputCsvExists() {
  const directory = path.dirname(TEMP_INPUT_PATH);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(TEMP_INPUT_PATH)) {
    fs.writeFileSync(TEMP_INPUT_PATH, HEADER, "utf8");
    return;
  }

  const content = fs.readFileSync(TEMP_INPUT_PATH, "utf8");
  if (!content.startsWith(HEADER)) {
    fs.writeFileSync(TEMP_INPUT_PATH, `${HEADER}${content}`, "utf8");
  }
}

function clamp01(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric < 0) {
    return 0;
  }

  if (numeric > 1) {
    return 1;
  }

  return numeric;
}

function normalizeByRange(value, min, max, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) {
    return fallback;
  }

  return clamp01((numeric - min) / range, fallback);
}

function isFeatureRow(row) {
  return (
    row &&
    ["X", "Y", "Pressure", "Duration", "Orientation", "Size"].every((key) =>
      Object.prototype.hasOwnProperty.call(row, key)
    )
  );
}

function normalizeSession(session) {
  const safeSession = Array.isArray(session) ? session : [];
  if (!safeSession.length) {
    return [];
  }

  if (safeSession.every(isFeatureRow)) {
    return safeSession.map((row) => ({
      X: clamp01(row.X, 0.5),
      Y: clamp01(row.Y, 0.5),
      Pressure: clamp01(row.Pressure, 0.5),
      Duration: clamp01(row.Duration, 0),
      Orientation: clamp01(row.Orientation, 0.5),
      Size: clamp01(row.Size, 0.5),
    }));
  }

  const pressureValues = safeSession
    .map((row) => Number(row.touchPressure))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const minPressure = pressureValues.length ? Math.min(...pressureValues) : 0;
  const maxPressure = pressureValues.length ? Math.max(...pressureValues) : 1;
  const parsed = safeSession.map((row) => ({
    x: Number(row.accelX),
    y: Number(row.accelY),
    duration: Number(row.duration),
    pressure: Number(row.touchPressure),
  }));

  const steps = parsed.map((current, index) => {
    const previous = index > 0 ? parsed[index - 1] : null;
    const x = Number.isFinite(current.x) ? current.x : 0;
    const y = Number.isFinite(current.y) ? current.y : 0;
    const previousX = previous && Number.isFinite(previous.x) ? previous.x : x;
    const previousY = previous && Number.isFinite(previous.y) ? previous.y : y;
    const dx = x - previousX;
    const dy = y - previousY;
    const deltaDistance = Math.sqrt(dx * dx + dy * dy);

    const rawDuration = Number.isFinite(current.duration) ? current.duration : 0;
    const previousDuration =
      previous && Number.isFinite(previous.duration) ? previous.duration : 0;
    const deltaDuration =
      rawDuration > previousDuration ? rawDuration - previousDuration : rawDuration;
    const safeDeltaDuration = Math.max(deltaDuration, 1);
    const velocity = deltaDistance / safeDeltaDuration;

    return {
      dx,
      dy,
      deltaDistance,
      deltaDuration: safeDeltaDuration,
      velocity,
      pressure: current.pressure,
    };
  });

  const absDxMax = Math.max(
    ...steps.map((step) => Math.abs(step.dx)).filter((value) => Number.isFinite(value)),
    1
  );
  const absDyMax = Math.max(
    ...steps.map((step) => Math.abs(step.dy)).filter((value) => Number.isFinite(value)),
    1
  );
  const maxDeltaDuration = Math.max(
    ...steps.map((step) => step.deltaDuration).filter((value) => Number.isFinite(value)),
    1
  );
  const maxVelocity = Math.max(
    ...steps.map((step) => step.velocity).filter((value) => Number.isFinite(value)),
    1e-6
  );
  const totalDistance = steps.reduce(
    (accumulator, step) =>
      accumulator + (Number.isFinite(step.deltaDistance) ? step.deltaDistance : 0),
    0
  );
  let distancePrefix = 0;

  return steps.map((step, index) => {
    const pressure =
      maxPressure > 1
        ? normalizeByRange(step.pressure, minPressure, maxPressure)
        : clamp01(step.pressure, 0.5);
    const x = clamp01((step.dx / absDxMax + 1) / 2, 0.5);
    const y = clamp01((step.dy / absDyMax + 1) / 2, 0.5);
    const duration = clamp01(step.deltaDuration / maxDeltaDuration, 0);
    const orientation = clamp01(step.velocity / maxVelocity, 0.5);
    distancePrefix += Number.isFinite(step.deltaDistance) ? step.deltaDistance : 0;
    const size =
      totalDistance > 0
        ? clamp01(distancePrefix / totalDistance, 0.5)
        : clamp01((index + 1) / Math.max(steps.length, 1), 0.5);

    return {
      X: x,
      Y: y,
      Pressure: pressure,
      Duration: duration,
      Orientation: orientation,
      Size: size,
    };
  });
}

function writeTempInputCsv(session) {
  ensureTempInputCsvExists();

  const normalizedSession = normalizeSession(session);
  if (!normalizedSession.length) {
    return { normalizedSession, rowCount: 0, inputPath: TEMP_INPUT_PATH };
  }

  const rows = normalizedSession.map(
    (row) =>
      `${row.X},${row.Y},${row.Pressure},${row.Duration},${row.Orientation},${row.Size}`
  );

  fs.writeFileSync(TEMP_INPUT_PATH, HEADER + rows.join("\n"), "utf8");

  return {
    normalizedSession,
    rowCount: normalizedSession.length,
    inputPath: TEMP_INPUT_PATH,
  };
}

module.exports = {
  TEMP_INPUT_PATH,
  ensureTempInputCsvExists,
  normalizeSession,
  writeTempInputCsv,
};

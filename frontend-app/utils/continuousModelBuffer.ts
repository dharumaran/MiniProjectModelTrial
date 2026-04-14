export interface ContinuousModelEvent {
  accelX: number;
  accelY: number;
  touchPressure: number;
  duration: number;
}

const listeners = new Set<() => void>();
let events: ContinuousModelEvent[] = [];
let gestureStartTimestamp: number | null = null;
let totalSamples = 0;
let initializedFromCsv = false;
const MAX_WINDOW_SAMPLES = 120;

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      result.push(value);
      value = "";
      continue;
    }

    value += character;
  }

  result.push(value);
  return result;
}

function parseTouchEventsFromBehaviorCsv(raw: string) {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  const indexByName = new Map<string, number>();
  header.forEach((name, index) => {
    indexByName.set(name, index);
  });

  const sensorTypeIndex = indexByName.get("sensor_type");
  const pageXIndex = indexByName.get("page_x");
  const pageYIndex = indexByName.get("page_y");
  const actionIndex = indexByName.get("touch_action");
  const timestampIndex = indexByName.get("timestamp");

  if (
    sensorTypeIndex === undefined ||
    pageXIndex === undefined ||
    pageYIndex === undefined ||
    actionIndex === undefined ||
    timestampIndex === undefined
  ) {
    return [];
  }

  let localGestureStart: number | null = null;
  const restored: ContinuousModelEvent[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const cols = parseCsvLine(lines[index]);
    if (cols[sensorTypeIndex] !== "touch") {
      continue;
    }

    const action = cols[actionIndex] as "start" | "move" | "end";
    const pageX = Number(cols[pageXIndex]);
    const pageY = Number(cols[pageYIndex]);
    const timestamp = Number(cols[timestampIndex]);

    if (!Number.isFinite(pageX) || !Number.isFinite(pageY) || !Number.isFinite(timestamp)) {
      continue;
    }

    if (action === "start" || localGestureStart === null) {
      localGestureStart = timestamp;
    }

    const duration = Math.max(1, timestamp - localGestureStart);
    restored.push({
      accelX: pageX,
      accelY: pageY,
      touchPressure: 0.5,
      duration,
    });

    if (action === "end") {
      localGestureStart = null;
    }
  }

  return restored;
}

export async function readTouchEventsFromBehaviorCsv(options?: { maxSamples?: number }) {
  try {
    const { getBehaviorCsvPath } = await import("./behaviorCsvLogger");
    const FileSystem = await import("expo-file-system/legacy");
    const csvPath = await getBehaviorCsvPath();
    const raw = await FileSystem.readAsStringAsync(csvPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const restored = parseTouchEventsFromBehaviorCsv(raw);
    if (!restored.length) {
      return [];
    }
    const maxSamples = Math.max(1, Number(options?.maxSamples || restored.length));
    return restored.slice(-maxSamples);
  } catch {
    return [];
  }
}

export async function initializeContinuousModelBuffer() {
  if (initializedFromCsv) {
    return;
  }

  initializedFromCsv = true;

  try {
    const restored = await readTouchEventsFromBehaviorCsv();
    if (!restored.length) {
      return;
    }

    events = restored.slice(-MAX_WINDOW_SAMPLES);
    totalSamples = restored.length;
    emitChange();
  } catch {
    // Keep continuous scoring alive when CSV is unavailable.
  }
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function subscribeToContinuousModelBuffer(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getContinuousModelEvents() {
  return events;
}

export function getContinuousModelTotalSamples() {
  return totalSamples;
}

export function recordContinuousTouchSnapshot(payload: {
  action: "start" | "move" | "end";
  pageX: number;
  pageY: number;
  pressure?: number;
}) {
  const now = Date.now();

  if (payload.action === "start" || gestureStartTimestamp === null) {
    gestureStartTimestamp = now;
  }

  const duration = Math.max(1, now - gestureStartTimestamp);

  events = [
    ...events,
    {
      accelX: payload.pageX,
      accelY: payload.pageY,
      touchPressure: payload.pressure ?? 0.5,
      duration,
    },
  ].slice(-MAX_WINDOW_SAMPLES);
  totalSamples += 1;

  if (payload.action === "end") {
    gestureStartTimestamp = null;
  }

  emitChange();
}

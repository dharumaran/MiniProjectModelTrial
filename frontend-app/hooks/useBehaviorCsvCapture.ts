import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { getSession } from "../utils/session";
import {
  appendBehaviorCsvRow,
  flushBehaviorCsvRows,
  forceSyncPublicMirror,
  getBehaviorCsvPath,
  getPublicBehaviorCsvPath,
  initBehaviorCsvFile,
} from "../utils/behaviorCsvLogger";

type SensorXYZ = {
  x: number;
  y: number;
  z: number;
};

type SensorType = "accelerometer" | "gyroscope" | "touch";

type TouchPayload = {
  action: "start" | "move" | "end";
  touchX: number;
  touchY: number;
  pageX: number;
  pageY: number;
};

const SENSOR_INTERVAL_MS = 100;
const FLUSH_INTERVAL_MS = 1000;

let captureReady = false;
let activeSessionId = "";
let activeUserId = "unknown_user";

/** Track how many sensor rows are buffered per session for diagnostics. */
let sensorRowsBuffered = 0;

function createSessionId() {
  return `sess-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function writeSensorRow(
  sensorType: SensorType,
  data: {
    x?: number;
    y?: number;
    z?: number;
    touchX?: number;
    touchY?: number;
    pageX?: number;
    pageY?: number;
    touchAction?: string;
  }
) {
  if (!captureReady || !activeSessionId) {
    return;
  }

  sensorRowsBuffered++;

  void appendBehaviorCsvRow({
    timestamp: Date.now(),
    userId: activeUserId,
    sessionId: activeSessionId,
    sensorType,
    x: data.x,
    y: data.y,
    z: data.z,
    touchX: data.touchX,
    touchY: data.touchY,
    pageX: data.pageX,
    pageY: data.pageY,
    touchAction: data.touchAction,
  }).catch(() => {
    // Ignore single-row write failures so capture continues.
  });
}

export function recordTouchSnapshot(payload: TouchPayload) {
  writeSensorRow("touch", {
    touchX: payload.touchX,
    touchY: payload.touchY,
    pageX: payload.pageX,
    pageY: payload.pageY,
    touchAction: payload.action,
  });

  if (payload.action === "end") {
    void flushBehaviorCsvRows().catch(() => {
      // Keep capture resilient even when immediate touch flush fails.
    });
  }
}

export default function useBehaviorCsvCapture() {
  const userIdRef = useRef("unknown_user");
  const sessionIdRef = useRef(createSessionId());
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const gyroSubRef = useRef<{ remove: () => void } | null>(null);
  const isCapturingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let flushInterval: ReturnType<typeof setInterval> | null = null;

    const stopCapture = () => {
      if (!isCapturingRef.current) {
        return;
      }

      accelSubRef.current?.remove();
      accelSubRef.current = null;
      gyroSubRef.current?.remove();
      gyroSubRef.current = null;
      isCapturingRef.current = false;
      captureReady = false;
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }

      console.log(
        `[BehaviorCSV] Stopping capture. Rows buffered this session: ${sensorRowsBuffered}`
      );

      // Flush remaining rows, then force-sync the public mirror
      void flushBehaviorCsvRows()
        .then(() => forceSyncPublicMirror())
        .catch(() => {
          // Ignore flush failures during app shutdown transitions.
        });
    };

    const startCapture = (newSession: boolean) => {
      if (isCapturingRef.current) {
        return;
      }

      if (newSession) {
        sessionIdRef.current = createSessionId();
        sensorRowsBuffered = 0;
      }

      activeSessionId = sessionIdRef.current;
      activeUserId = userIdRef.current;
      captureReady = true;

      console.log(
        `[BehaviorCSV] Starting capture. User: ${activeUserId}, Session: ${activeSessionId}`
      );

      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);

      accelSubRef.current = Accelerometer.addListener((data: SensorXYZ) => {
        writeSensorRow("accelerometer", data);
      });

      gyroSubRef.current = Gyroscope.addListener((data: SensorXYZ) => {
        writeSensorRow("gyroscope", data);
      });

      isCapturingRef.current = true;

      flushInterval = setInterval(() => {
        void flushBehaviorCsvRows().catch(() => {
          // Ignore periodic flush failures and keep capture running.
        });
      }, FLUSH_INTERVAL_MS);
    };

    const setup = async () => {
      const session = await getSession();
      const resolvedUserId =
        session?.user?.id ||
        session?.user?.accountNo ||
        session?.user?.phone ||
        "unknown_user";

      if (mounted) {
        userIdRef.current = resolvedUserId;
      }

      await initBehaviorCsvFile();
      const csvPath = await getBehaviorCsvPath();
      const publicCsvPath = await getPublicBehaviorCsvPath();
      console.log("Behavior CSV app path:", csvPath);
      console.log("Behavior CSV public path:", publicCsvPath);
      startCapture(true);
    };

    void setup();

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        startCapture(true);
        return;
      }

      stopCapture();
    });

    return () => {
      mounted = false;
      appStateSubscription.remove();
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      stopCapture();
      void flushBehaviorCsvRows().catch(() => {
        // Ignore final cleanup flush failures.
      });
    };
  }, []);
}

import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { getSession } from "../utils/session";
import {
  appendBehaviorCsvRow,
  getBehaviorCsvPath,
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

let captureReady = false;
let activeSessionId = "";
let activeUserId = "unknown_user";

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
}

export default function useBehaviorCsvCapture() {
  const userIdRef = useRef("unknown_user");
  const sessionIdRef = useRef(createSessionId());
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const gyroSubRef = useRef<{ remove: () => void } | null>(null);
  const isCapturingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

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
    };

    const startCapture = (newSession: boolean) => {
      if (isCapturingRef.current) {
        return;
      }

      if (newSession) {
        sessionIdRef.current = createSessionId();
      }

      activeSessionId = sessionIdRef.current;
      activeUserId = userIdRef.current;
      captureReady = true;

      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);

      accelSubRef.current = Accelerometer.addListener((data: SensorXYZ) => {
        writeSensorRow("accelerometer", data);
      });

      gyroSubRef.current = Gyroscope.addListener((data: SensorXYZ) => {
        writeSensorRow("gyroscope", data);
      });

      isCapturingRef.current = true;
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
      console.log("Behavior CSV path:", csvPath);
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
      stopCapture();
    };
  }, []);
}

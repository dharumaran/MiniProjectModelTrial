import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiFetch, getCurrentApiBaseUrl } from "../utils/api";
import {
  getContinuousModelEvents,
  getContinuousModelTotalSamples,
  subscribeToContinuousModelBuffer,
} from "../utils/continuousModelBuffer";

interface RecordSessionResponse {
  message: string;
  rowCount: number;
  inputPath: string;
}

const MIN_SAMPLES = 12;
const POLL_INTERVAL_MS = 1000;
const SAMPLE_STEP_TRIGGER = 10;
const TIME_TRIGGER_MS = 5000;

export default function useContinuousTempInputSync() {
  const events = useSyncExternalStore(
    subscribeToContinuousModelBuffer,
    getContinuousModelEvents,
    getContinuousModelEvents
  );
  const eventsRef = useRef(events);
  const requestInFlightRef = useRef(false);
  const lastSyncedTotalRef = useRef(0);
  const lastSyncedAtRef = useRef(0);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentEvents = eventsRef.current;
      const totalSamples = getContinuousModelTotalSamples();
      const newSamplesSinceLastSync = totalSamples - lastSyncedTotalRef.current;
      const now = Date.now();
      const msSinceLastSync =
        lastSyncedAtRef.current === 0 ? Number.MAX_SAFE_INTEGER : now - lastSyncedAtRef.current;
      const shouldSyncBySamples = newSamplesSinceLastSync >= SAMPLE_STEP_TRIGGER;
      const shouldSyncByTime = msSinceLastSync >= TIME_TRIGGER_MS;

      if (
        requestInFlightRef.current ||
        currentEvents.length < MIN_SAMPLES ||
        (!shouldSyncBySamples && !shouldSyncByTime)
      ) {
        return;
      }

      requestInFlightRef.current = true;
      if (__DEV__) {
        console.log(
          "[behavior-sync] syncing temp_input.csv",
          JSON.stringify({
            sampleWindow: currentEvents.length,
            totalSamples,
            apiBaseUrl: getCurrentApiBaseUrl(),
          })
        );
      }

      void apiFetch<RecordSessionResponse>("/record-session/behavior", {
        method: "POST",
        body: JSON.stringify({ session: currentEvents }),
      })
        .then((response) => {
          lastSyncedTotalRef.current = totalSamples;
          lastSyncedAtRef.current = Date.now();
          if (__DEV__) {
            console.log(
              "[behavior-sync] temp_input.csv updated",
              JSON.stringify({
                rowCount: response.rowCount,
                inputPath: response.inputPath,
              })
            );
          }
        })
        .catch((error) => {
          if (__DEV__) {
            console.warn(
              "[behavior-sync] temp_input.csv sync failed",
              error instanceof Error ? error.message : error
            );
          }
        })
        .finally(() => {
          requestInFlightRef.current = false;
        });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);
}

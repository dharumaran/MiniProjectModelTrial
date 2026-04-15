import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiFetch, getCurrentApiBaseUrl } from "../utils/api";
import { getSession } from "../utils/session";
import {
  getContinuousModelEvents,
  getContinuousModelTotalSamples,
  initializeContinuousModelBuffer,
  subscribeToContinuousModelBuffer,
} from "../utils/continuousModelBuffer";
import {
  markModelConfidenceChecking,
  resetModelConfidenceStatus,
  setModelConfidence,
  setModelConfidenceSampleCount,
} from "../utils/modelConfidenceStore";
import {
  getModelBootstrapState,
  subscribeToModelBootstrapStore,
} from "../utils/modelBootstrapStore";

interface ModelConfidenceResponse {
  svm1_score: number;
  svm2_score: number;
  lstm_score: number;
  lstm_used?: boolean;
  risk: string;
}

const MIN_SAMPLES = 8;
const POLL_INTERVAL_MS = 500;
const SAMPLE_STEP_TRIGGER = 4;
const TIME_TRIGGER_MS = 2500;

export default function useContinuousModelScoring() {
  const events = useSyncExternalStore(
    subscribeToContinuousModelBuffer,
    getContinuousModelEvents,
    getContinuousModelEvents
  );
  const bootstrapState = useSyncExternalStore(
    subscribeToModelBootstrapStore,
    getModelBootstrapState,
    getModelBootstrapState
  );
  const requestInFlightRef = useRef(false);
  const eventsRef = useRef(events);
  const lastSentTotalRef = useRef(0);
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    setModelConfidenceSampleCount(events.length, getContinuousModelTotalSamples());
  }, [events.length]);

  useEffect(() => {
    void initializeContinuousModelBuffer();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentEvents = eventsRef.current;
      const totalSamples = getContinuousModelTotalSamples();
      const newSamplesSinceLastSend = totalSamples - lastSentTotalRef.current;
      const now = Date.now();
      const msSinceLastSend =
        lastSentAtRef.current === 0 ? Number.MAX_SAFE_INTEGER : now - lastSentAtRef.current;
      const shouldSendBySamples = newSamplesSinceLastSend >= SAMPLE_STEP_TRIGGER;
      const shouldSendByTime = msSinceLastSend >= TIME_TRIGGER_MS;
      const shouldSend = shouldSendBySamples || shouldSendByTime;

      if (
        requestInFlightRef.current ||
        bootstrapState.phase !== "ready" ||
        currentEvents.length < MIN_SAMPLES ||
        !shouldSend
      ) {
        if (__DEV__ && bootstrapState.phase !== "ready") {
          console.log(
            "[predict] waiting for model bootstrap",
            JSON.stringify({
              phase: bootstrapState.phase,
              detail: bootstrapState.message,
            })
          );
        }
        return;
      }

      requestInFlightRef.current = true;
      markModelConfidenceChecking();
      if (__DEV__) {
        console.log(
          "[predict] sending continuous scoring request",
          JSON.stringify({
            sampleWindow: currentEvents.length,
            totalSamples,
            apiBaseUrl: getCurrentApiBaseUrl(),
          })
        );
      }
      void getSession()
        .then((session) =>
          apiFetch<ModelConfidenceResponse>("/predict", {
            method: "POST",
            body: JSON.stringify({
              session: currentEvents,
              accountNo: session?.user?.accountNo || undefined,
            }),
          })
        )
        .then((response) => {
          lastSentTotalRef.current = totalSamples;
          lastSentAtRef.current = Date.now();
          if (__DEV__) {
            console.log(
              "[predict] scoring response received",
              JSON.stringify({
                svm1_score: response.svm1_score,
                svm2_score: response.svm2_score,
                lstm_score: response.lstm_score,
                lstm_used: response.lstm_used,
                risk: response.risk,
              })
            );
          }
          setModelConfidence(response);
        })
        .catch((error) => {
          // Keep this visible while tuning continuous auth in dev.
          console.warn(
            "[predict] continuous model scoring failed:",
            error instanceof Error ? error.message : error
          );
          resetModelConfidenceStatus();
        })
        .finally(() => {
          requestInFlightRef.current = false;
        });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [bootstrapState.message, bootstrapState.phase]);
}

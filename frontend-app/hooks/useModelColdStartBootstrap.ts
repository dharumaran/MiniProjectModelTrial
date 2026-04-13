import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiFetch, getCurrentApiBaseUrl } from "../utils/api";
import { getSession } from "../utils/session";
import {
  getContinuousModelTotalSamples,
  subscribeToContinuousModelBuffer,
} from "../utils/continuousModelBuffer";
import {
  getModelBootstrapState,
  setModelBootstrapState,
  subscribeToModelBootstrapStore,
} from "../utils/modelBootstrapStore";

interface ModelBootstrapResponse {
  message: string;
  trainedAt: string;
  inputRowCount: number;
}

const COLD_START_MS = 20000;
const MIN_BOOTSTRAP_SAMPLES = 30;
const CHECK_INTERVAL_MS = 1000;
const RETRY_BACKOFF_MS = 30000;

export default function useModelColdStartBootstrap() {
  const totalSamples = useSyncExternalStore(
    subscribeToContinuousModelBuffer,
    getContinuousModelTotalSamples,
    getContinuousModelTotalSamples
  );
  const bootstrapState = useSyncExternalStore(
    subscribeToModelBootstrapStore,
    getModelBootstrapState,
    getModelBootstrapState
  );
  const startedAtRef = useRef(Date.now());
  const requestInFlightRef = useRef(false);
  const lastFailureAtRef = useRef(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (bootstrapState.phase === "ready" || requestInFlightRef.current) {
        return;
      }

      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed < COLD_START_MS || totalSamples < MIN_BOOTSTRAP_SAMPLES) {
        const secondsLeft = Math.max(0, Math.ceil((COLD_START_MS - elapsed) / 1000));
        setModelBootstrapState({
          phase: "warming",
          message: `Collecting baseline behavior (${totalSamples} samples, ${secondsLeft}s warmup left)`,
        });
        return;
      }

      if (
        bootstrapState.phase === "failed" &&
        Date.now() - lastFailureAtRef.current < RETRY_BACKOFF_MS
      ) {
        return;
      }

      requestInFlightRef.current = true;
      setModelBootstrapState({
        phase: "training",
        message: "Training model from device behavior CSV...",
      });

      if (__DEV__) {
        console.log(
          "[model-bootstrap] starting retrain",
          JSON.stringify({
            totalSamples,
            minSamples: MIN_BOOTSTRAP_SAMPLES,
            apiBaseUrl: getCurrentApiBaseUrl(),
          })
        );
      }

      void getSession()
        .then((session) =>
          apiFetch<ModelBootstrapResponse>("/model/bootstrap", {
            method: "POST",
            body: JSON.stringify({
              minSamples: MIN_BOOTSTRAP_SAMPLES,
              accountNo: session?.user?.accountNo || undefined,
            }),
          })
        )
        .then((response) => {
          setModelBootstrapState({
            phase: "ready",
            message: `Model ready (trained at ${response.trainedAt})`,
          });
          if (__DEV__) {
            console.log(
              "[model-bootstrap] retrain complete",
              JSON.stringify({
                inputRowCount: response.inputRowCount,
                trainedAt: response.trainedAt,
              })
            );
          }
        })
        .catch((error) => {
          lastFailureAtRef.current = Date.now();
          setModelBootstrapState({
            phase: "failed",
            message: `Bootstrap failed: ${error instanceof Error ? error.message : "unknown error"}`,
          });
          console.warn(
            "[model-bootstrap] retrain failed",
            error instanceof Error ? error.message : error
          );
        })
        .finally(() => {
          requestInFlightRef.current = false;
        });
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [bootstrapState.phase, totalSamples]);
}

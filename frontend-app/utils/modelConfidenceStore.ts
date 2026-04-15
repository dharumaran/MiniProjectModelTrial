export interface ModelConfidenceSnapshot {
  svm1_score: number | null;
  svm2_score: number | null;
  lstm_score: number | null;
  lstm_used: boolean | null;
  risk: string | null;
  sampleCount: number;
  totalSamples: number;
  status: "idle" | "collecting" | "checking" | "ready";
  updatedAt: number | null;
}

const initialSnapshot: ModelConfidenceSnapshot = {
  svm1_score: null,
  svm2_score: null,
  lstm_score: null,
  lstm_used: null,
  risk: null,
  sampleCount: 0,
  totalSamples: 0,
  status: "idle",
  updatedAt: null,
};

let snapshot: ModelConfidenceSnapshot = initialSnapshot;

const listeners = new Set<() => void>();
const EMA_ALPHA = 0.5;
const MIN_RELIABLE_SAMPLES = 40;

function clamp01(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function calibrateScore(score: number) {
  // Pull extreme outputs toward center to reduce false low/high spikes.
  const clamped = clamp01(score);
  return clamp01(0.12 + clamped * 0.76);
}

function blendBySampleReliability(score: number, sampleCount: number) {
  const reliability = clamp01(sampleCount / MIN_RELIABLE_SAMPLES, 0);
  return clamp01(0.5 + (score - 0.5) * reliability);
}

function smoothAgainstPrevious(score: number, previous: number | null) {
  const previousScore = previous === null ? score : clamp01(previous);
  return clamp01(previousScore * (1 - EMA_ALPHA) + score * EMA_ALPHA);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function subscribeToModelConfidence(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getModelConfidenceSnapshot() {
  return snapshot;
}

export function markModelConfidenceChecking() {
  snapshot = {
    ...snapshot,
    status: "checking",
  };
  emitChange();
}

export function setModelConfidenceSampleCount(
  sampleCount: number,
  totalSamples = sampleCount
) {
  snapshot = {
    ...snapshot,
    sampleCount,
    totalSamples,
    status:
      sampleCount > 0 && snapshot.updatedAt === null && snapshot.status !== "checking"
        ? "collecting"
        : snapshot.status,
  };
  emitChange();
}

export function setModelConfidence(
  next: Pick<
    ModelConfidenceSnapshot,
    "svm1_score" | "svm2_score" | "lstm_score" | "lstm_used" | "risk"
  >
) {
  const calibratedSvm1 = smoothAgainstPrevious(
    blendBySampleReliability(
      calibrateScore(next.svm1_score ?? 0.5),
      snapshot.sampleCount
    ),
    snapshot.svm1_score
  );
  const calibratedSvm2 = smoothAgainstPrevious(
    blendBySampleReliability(
      calibrateScore(next.svm2_score ?? 0.5),
      snapshot.sampleCount
    ),
    snapshot.svm2_score
  );
  const isLstmUsed = next.lstm_used !== false;
  const calibratedLstm = isLstmUsed
    ? smoothAgainstPrevious(
        blendBySampleReliability(
          calibrateScore(next.lstm_score ?? 0.5),
          snapshot.sampleCount
        ),
        snapshot.lstm_score
      )
    : 0;

  snapshot = {
    svm1_score: calibratedSvm1,
    svm2_score: calibratedSvm2,
    lstm_score: calibratedLstm,
    lstm_used: next.lstm_used ?? null,
    risk: next.risk,
    sampleCount: snapshot.sampleCount,
    totalSamples: snapshot.totalSamples,
    status: "ready",
    updatedAt: Date.now(),
  };
  emitChange();
}

export function resetModelConfidenceStatus() {
  snapshot = {
    ...snapshot,
    status: snapshot.updatedAt
      ? "ready"
      : snapshot.sampleCount > 0
        ? "collecting"
        : "idle",
  };
  emitChange();
}

import numpy as np
import pandas as pd

SEQUENCE_LENGTH = 50
FEATURE_COLS = ["X", "Y", "Pressure", "Duration", "Orientation", "Size"]
NUM_FEATURES = len(FEATURE_COLS)


def clamp01(values):
    return np.clip(values, 0.0, 1.0)


def pad_or_trim(arr: np.ndarray):
    if len(arr) >= SEQUENCE_LENGTH:
        # Keep the latest behavior window so continuous scoring reacts to
        # recent user interactions, not stale historical touches.
        return arr[-SEQUENCE_LENGTH:]

    padding = np.zeros((SEQUENCE_LENGTH - len(arr), NUM_FEATURES), dtype=np.float32)
    return np.vstack([arr, padding])


def normalize_session(df: pd.DataFrame, renormalize: bool = False):
    frame = df.copy()
    
    # Handle if 'UserId' column exists (new CSV format with user tracking)
    if 'UserId' in frame.columns:
        frame = frame.drop(columns=['UserId'])
    
    for column in FEATURE_COLS:
        if column not in frame:
            frame[column] = 0.0

    frame = frame[FEATURE_COLS].apply(pd.to_numeric, errors="coerce").fillna(0.0)

    if renormalize:
        for column in FEATURE_COLS:
            values = frame[column].to_numpy(dtype=np.float32)
            min_value = float(np.min(values))
            max_value = float(np.max(values))
            if max_value - min_value > 1e-6:
                frame[column] = (values - min_value) / (max_value - min_value)
            else:
                frame[column] = np.full_like(values, 0.5, dtype=np.float32)
    else:
        # Input rows are already normalized to [0, 1] by the backend writer.
        # Re-normalizing each window here can erase user-specific scale.
        frame = frame.clip(lower=0.0, upper=1.0)

    return pad_or_trim(frame.to_numpy(dtype=np.float32))


def extract_stat_features(sequence: np.ndarray):
    sequence = sequence.astype(np.float32)
    means = np.mean(sequence, axis=0)
    stds = np.std(sequence, axis=0)
    mins = np.min(sequence, axis=0)
    maxs = np.max(sequence, axis=0)
    p25 = np.percentile(sequence, 25, axis=0)
    p50 = np.percentile(sequence, 50, axis=0)
    p75 = np.percentile(sequence, 75, axis=0)
    ranges = maxs - mins

    diffs = np.diff(sequence, axis=0, prepend=sequence[:1])
    abs_diffs = np.abs(diffs)
    mean_abs_diff = np.mean(abs_diffs, axis=0)
    std_abs_diff = np.std(abs_diffs, axis=0)

    step_dist = np.linalg.norm(diffs[:, 0:2], axis=1)
    step_sign_changes = np.sum(np.diff(np.signbit(diffs[:, 0:2]), axis=0), axis=0).astype(
        np.float32
    )
    corr_xy = np.array(
        [
            np.corrcoef(sequence[:, 0], sequence[:, 1])[0, 1]
            if np.std(sequence[:, 0]) > 1e-6 and np.std(sequence[:, 1]) > 1e-6
            else 0.0
        ],
        dtype=np.float32,
    )
    # Feature-specific behavior trends help a statistical model separate
    # stable user patterns from shuffled/spiky negatives.
    slopes = []
    timeline = np.linspace(0.0, 1.0, len(sequence), dtype=np.float32)
    for feature_index in range(NUM_FEATURES):
        feature_values = sequence[:, feature_index]
        covariance = np.mean((timeline - np.mean(timeline)) * (feature_values - np.mean(feature_values)))
        variance = np.var(timeline) + 1e-8
        slopes.append(covariance / variance)
    slopes = np.array(slopes, dtype=np.float32)

    motion_stats = np.array(
        [
            np.mean(step_dist),
            np.std(step_dist),
            np.max(step_dist),
            np.sum(step_dist),
        ],
        dtype=np.float32,
    )

    return np.concatenate(
        [
            means,
            stds,
            mins,
            maxs,
            p25,
            p50,
            p75,
            ranges,
            mean_abs_diff,
            std_abs_diff,
            step_sign_changes,
            corr_xy,
            slopes,
            motion_stats,
        ]
    ).astype(np.float32)

import argparse
import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn import svm
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import balanced_accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, Dataset

from feature_pipeline import (
    FEATURE_COLS,
    NUM_FEATURES,
    SEQUENCE_LENGTH,
    clamp01,
    extract_stat_features,
    normalize_session,
)
from lstm_model import LSTMClassifier

BATCH_SIZE = 32
EPOCHS = 16
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_PATH = ROOT_DIR / "temp_input.csv"
DEFAULT_HISTORY_PATH = ROOT_DIR / "history_input.csv"
DEFAULT_REFERENCE_PATH = ROOT_DIR / "reference_session.csv"
DEFAULT_SVM_SEQ_PATH = ROOT_DIR.parent / "svm_tier_1_sequence.pkl"
DEFAULT_SVM_STAT_PATH = ROOT_DIR.parent / "svm_tier_2_statistical.pkl"
DEFAULT_LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"
DEFAULT_PROFILES_ROOT = ROOT_DIR / "user_profiles"


def set_seed(seed: int = 42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def temporal_resample(sequence: np.ndarray):
    original_steps = np.linspace(0, 1, len(sequence))
    warped_steps = np.sort(clamp01(original_steps + np.random.normal(0, 0.025, len(sequence))))
    warped_steps[0] = 0.0
    warped_steps[-1] = 1.0

    columns = []
    for feature_index in range(NUM_FEATURES):
        columns.append(
            np.interp(original_steps, warped_steps, sequence[:, feature_index])
        )

    return np.stack(columns, axis=1)


def augment_positive(reference: np.ndarray):
    augmented = temporal_resample(reference)
    augmented = augmented + np.random.normal(0, 0.035, augmented.shape)
    augmented[:, 3] = clamp01(
        augmented[:, 3] * np.random.uniform(0.85, 1.15)
    )
    augmented[:, 2] = clamp01(
        augmented[:, 2] + np.random.normal(0, 0.02, len(augmented))
    )
    return clamp01(augmented).astype(np.float32)


def generate_negative(reference: np.ndarray):
    mode = random.choice(
        ["reverse", "permute", "random", "swap_axes", "spike", "drift", "dropout"]
    )

    if mode == "reverse":
        negative = reference[::-1].copy()
        negative[:, 0] = clamp01(1.0 - negative[:, 0])
        return negative.astype(np.float32)

    if mode == "permute":
        shuffled = reference[np.random.permutation(len(reference))].copy()
        shuffled[:, 3] = clamp01(np.sort(shuffled[:, 3])[::-1])
        return shuffled.astype(np.float32)

    if mode == "swap_axes":
        swapped = reference.copy()
        swapped[:, [0, 1]] = swapped[:, [1, 0]]
        swapped[:, 5] = clamp01(1.0 - swapped[:, 5])
        return swapped.astype(np.float32)

    if mode == "spike":
        spiked = reference.copy()
        spike_index = np.random.randint(0, len(spiked), size=8)
        spiked[spike_index, :2] = np.random.rand(len(spike_index), 2)
        spiked[:, 2] = clamp01(np.roll(spiked[:, 2], 5))
        return clamp01(spiked).astype(np.float32)

    if mode == "drift":
        drifted = reference.copy()
        gradual_shift = np.linspace(0, np.random.uniform(0.2, 0.45), len(drifted), dtype=np.float32)
        drifted[:, 0] = clamp01(drifted[:, 0] + gradual_shift)
        drifted[:, 1] = clamp01(drifted[:, 1] - gradual_shift[::-1])
        drifted[:, 4] = clamp01(drifted[:, 4] + np.random.normal(0, 0.08, len(drifted)))
        return drifted.astype(np.float32)

    if mode == "dropout":
        dropped = reference.copy()
        mask = np.random.rand(*dropped.shape) < 0.15
        dropped[mask] = 0.0
        dropped[:, 3] = clamp01(dropped[:, 3] * np.random.uniform(0.5, 0.9))
        return dropped.astype(np.float32)

    return np.random.rand(SEQUENCE_LENGTH, NUM_FEATURES).astype(np.float32)


class SequenceDataset(Dataset):
    def __init__(self, features: np.ndarray, labels: np.ndarray):
        self.features = torch.tensor(features, dtype=torch.float32)
        self.labels = torch.tensor(labels, dtype=torch.long)

    def __len__(self):
        return len(self.features)

    def __getitem__(self, index):
        return self.features[index], self.labels[index]


def train_lstm_model(x_train, y_train, lstm_output_path: Path):
    dataset = SequenceDataset(x_train, y_train)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    model = LSTMClassifier().to(DEVICE)
    criterion = nn.NLLLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

    for epoch in range(EPOCHS):
        model.train()
        epoch_loss = 0.0

        for batch_features, batch_labels in loader:
            batch_features = batch_features.to(DEVICE)
            batch_labels = batch_labels.to(DEVICE)

            optimizer.zero_grad()
            predictions = model(batch_features)
            loss = criterion(torch.log(predictions.clamp(min=1e-8)), batch_labels)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()

        print(
            f"Epoch {epoch + 1}/{EPOCHS}, "
            f"Loss: {epoch_loss / max(len(loader), 1):.4f}"
        )

    torch.save(model.state_dict(), lstm_output_path)


def load_hard_negative_sequences(profiles_root: Path, scope_id: str):
    negatives = []
    if not profiles_root.exists():
        return negatives

    for profile_dir in profiles_root.iterdir():
        if not profile_dir.is_dir() or profile_dir.name == scope_id:
            continue
        reference_path = profile_dir / "reference_session.csv"
        if not reference_path.exists():
            continue
        try:
            df = pd.read_csv(reference_path)
            seq = normalize_session(df)
            negatives.append(seq.astype(np.float32))
        except Exception:
            continue

    return negatives


def extract_sessions_from_history(raw_df: pd.DataFrame):
    if raw_df.empty:
        return []

    sessions = []
    stride = max(10, SEQUENCE_LENGTH // 2)
    values = raw_df.copy()
    total_rows = len(values)
    if total_rows < 10:
        return sessions

    if total_rows <= SEQUENCE_LENGTH:
        sessions.append(normalize_session(values))
        return sessions

    for start in range(0, total_rows - 9, stride):
        end = min(total_rows, start + SEQUENCE_LENGTH)
        window = values.iloc[start:end]
        sessions.append(normalize_session(window))

    return sessions[-12:]


def main():
    set_seed()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DEFAULT_INPUT_PATH))
    parser.add_argument("--history", default=str(DEFAULT_HISTORY_PATH))
    parser.add_argument("--reference", default=str(DEFAULT_REFERENCE_PATH))
    parser.add_argument("--svm-seq", default=str(DEFAULT_SVM_SEQ_PATH))
    parser.add_argument("--svm-stat", default=str(DEFAULT_SVM_STAT_PATH))
    parser.add_argument("--lstm", default=str(DEFAULT_LSTM_PATH))
    parser.add_argument("--profiles-root", default=str(DEFAULT_PROFILES_ROOT))
    parser.add_argument("--scope-id", default="shared")
    parser.add_argument("--min-hard-negatives", type=int, default=5)
    parser.add_argument("--min-lstm-balanced-accuracy", type=float, default=0.60)
    parser.add_argument("--enforce-quality-gate", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    history_path = Path(args.history)
    reference_path = Path(args.reference)
    svm_seq_path = Path(args.svm_seq)
    svm_stat_path = Path(args.svm_stat)
    lstm_path = Path(args.lstm)
    profiles_root = Path(args.profiles_root)
    scope_id = str(args.scope_id or "shared").strip() or "shared"

    reference_path.parent.mkdir(parents=True, exist_ok=True)
    svm_seq_path.parent.mkdir(parents=True, exist_ok=True)
    svm_stat_path.parent.mkdir(parents=True, exist_ok=True)
    lstm_path.parent.mkdir(parents=True, exist_ok=True)

    source_path = history_path if history_path.exists() else input_path
    if not source_path.exists():
        raise FileNotFoundError(f"Missing input session file: {source_path}")

    raw_df = pd.read_csv(source_path)
    if len(raw_df) < 10:
        raise ValueError("Need at least 10 live samples in temp/history csv to retrain.")

    historical_sessions = extract_sessions_from_history(raw_df)
    if not historical_sessions:
        raise ValueError("Could not extract enough historical sessions for retraining.")

    reference = historical_sessions[-1]
    reference_df = pd.DataFrame(reference, columns=FEATURE_COLS)
    reference_df.to_csv(reference_path, index=False)

    positive_sequences = []
    for session in historical_sessions:
        positive_sequences.append(session.astype(np.float32))
        positive_sequences.extend([augment_positive(session) for _ in range(24)])
    positive_sequences.extend([augment_positive(reference) for _ in range(120)])
    synthetic_negatives = [generate_negative(reference) for _ in range(220)]
    hard_negatives = load_hard_negative_sequences(profiles_root, scope_id)
    sampled_hard_negatives = (
        random.sample(hard_negatives, min(len(hard_negatives), 220))
        if hard_negatives
        else []
    )
    negative_sequences = synthetic_negatives + sampled_hard_negatives
    if len(negative_sequences) < 220:
        needed = 220 - len(negative_sequences)
        negative_sequences.extend([generate_negative(reference) for _ in range(needed)])

    x_sequences = np.array(positive_sequences + negative_sequences, dtype=np.float32)
    y = np.array([1] * len(positive_sequences) + [0] * len(negative_sequences))

    x_seq_flat = x_sequences.reshape(len(x_sequences), -1)
    x_stat = np.array([extract_stat_features(sequence) for sequence in x_sequences])

    x_seq_train, x_seq_test, y_train, y_test = train_test_split(
        x_seq_flat, y, test_size=0.2, random_state=42, stratify=y
    )
    x_stat_train, x_stat_test, _, _ = train_test_split(
        x_stat, y, test_size=0.2, random_state=42, stratify=y
    )
    x_lstm_train, x_lstm_test, y_lstm_train, y_lstm_test = train_test_split(
        x_sequences, y, test_size=0.2, random_state=42, stratify=y
    )

    seq_base = make_pipeline(
        StandardScaler(),
        svm.SVC(
            kernel="rbf",
            C=3.0,
            gamma="scale",
            class_weight="balanced",
            random_state=42,
        ),
    )
    stat_base = make_pipeline(
        StandardScaler(),
        svm.SVC(
            kernel="rbf",
            C=2.0,
            gamma="scale",
            class_weight="balanced",
            random_state=42,
        ),
    )

    clf_seq = CalibratedClassifierCV(
        seq_base,
        method="sigmoid",
        cv=5,
    )
    clf_seq.fit(x_seq_train, y_train)
    clf_stat = CalibratedClassifierCV(
        stat_base,
        method="sigmoid",
        cv=5,
    )
    clf_stat.fit(x_stat_train, y_train)

    seq_accuracy = clf_seq.score(x_seq_test, y_test)
    stat_accuracy = clf_stat.score(x_stat_test, y_test)
    seq_balanced_accuracy = balanced_accuracy_score(y_test, clf_seq.predict(x_seq_test))
    stat_balanced_accuracy = balanced_accuracy_score(y_test, clf_stat.predict(x_stat_test))

    print(f"SVM Seq Accuracy: {seq_accuracy:.4f}")
    print(f"SVM Stat Accuracy: {stat_accuracy:.4f}")
    print(f"SVM Seq Balanced Accuracy: {seq_balanced_accuracy:.4f}")
    print(f"SVM Stat Balanced Accuracy: {stat_balanced_accuracy:.4f}")

    train_lstm_model(x_lstm_train, y_lstm_train, lstm_path)

    lstm_eval_model = LSTMClassifier().to(DEVICE)
    lstm_eval_model.load_state_dict(torch.load(lstm_path, map_location=DEVICE))
    lstm_eval_model.eval()

    with torch.no_grad():
        x_eval = torch.tensor(x_lstm_test, dtype=torch.float32).to(DEVICE)
        y_pred = torch.argmax(lstm_eval_model(x_eval), dim=1).cpu().numpy()
        lstm_accuracy = float(np.mean(y_pred == y_lstm_test))
        lstm_balanced_accuracy = float(balanced_accuracy_score(y_lstm_test, y_pred))

    print(f"LSTM Accuracy: {lstm_accuracy:.4f}")
    print(f"LSTM Balanced Accuracy: {lstm_balanced_accuracy:.4f}")

    joblib.dump(clf_seq, svm_seq_path)
    joblib.dump(clf_stat, svm_stat_path)

    print(f"Hard negatives used: {len(sampled_hard_negatives)}")

    if args.enforce_quality_gate:
        failures = []
        if len(sampled_hard_negatives) < max(0, int(args.min_hard_negatives)):
            failures.append(
                f"hard negatives {len(sampled_hard_negatives)} < required {int(args.min_hard_negatives)}"
            )
        if lstm_balanced_accuracy < float(args.min_lstm_balanced_accuracy):
            failures.append(
                f"LSTM balanced accuracy {lstm_balanced_accuracy:.4f} < required {float(args.min_lstm_balanced_accuracy):.4f}"
            )
        if failures:
            raise ValueError(
                "Model quality gate failed: "
                + "; ".join(failures)
                + ". Collect more genuine owner sessions and at least 5 impostor sessions from other users."
            )

    print(f"Saved reference to {reference_path}")
    print(f"Saved SVM seq model to {svm_seq_path}")
    print(f"Saved SVM stat model to {svm_stat_path}")
    print(f"Saved LSTM model to {lstm_path}")


if __name__ == "__main__":
    main()

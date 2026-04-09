import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn import svm
from sklearn.calibration import CalibratedClassifierCV
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
INPUT_PATH = ROOT_DIR / "temp_input.csv"
REFERENCE_PATH = ROOT_DIR / "reference_session.csv"
SVM_SEQ_PATH = ROOT_DIR.parent / "svm_tier_1_sequence.pkl"
SVM_STAT_PATH = ROOT_DIR.parent / "svm_tier_2_statistical.pkl"
LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"


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


def train_lstm_model(x_train, y_train):
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

    torch.save(model.state_dict(), LSTM_PATH)


def main():
    set_seed()

    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Missing input session file: {INPUT_PATH}")

    raw_df = pd.read_csv(INPUT_PATH)
    if len(raw_df) < 10:
        raise ValueError("Need at least 10 live samples in temp_input.csv to retrain.")

    reference = normalize_session(raw_df)
    reference_df = pd.DataFrame(reference, columns=FEATURE_COLS)
    reference_df.to_csv(REFERENCE_PATH, index=False)

    positive_sequences = [augment_positive(reference) for _ in range(320)]
    negative_sequences = [generate_negative(reference) for _ in range(320)]

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

    print(f"SVM Seq Accuracy: {seq_accuracy:.4f}")
    print(f"SVM Stat Accuracy: {stat_accuracy:.4f}")

    train_lstm_model(x_lstm_train, y_lstm_train)

    lstm_eval_model = LSTMClassifier().to(DEVICE)
    lstm_eval_model.load_state_dict(torch.load(LSTM_PATH, map_location=DEVICE))
    lstm_eval_model.eval()

    with torch.no_grad():
        x_eval = torch.tensor(x_lstm_test, dtype=torch.float32).to(DEVICE)
        y_pred = torch.argmax(lstm_eval_model(x_eval), dim=1).cpu().numpy()
        lstm_accuracy = float(np.mean(y_pred == y_lstm_test))

    print(f"LSTM Accuracy: {lstm_accuracy:.4f}")

    joblib.dump(clf_seq, SVM_SEQ_PATH)
    joblib.dump(clf_stat, SVM_STAT_PATH)

    print(f"Saved reference to {REFERENCE_PATH}")
    print(f"Saved SVM seq model to {SVM_SEQ_PATH}")
    print(f"Saved SVM stat model to {SVM_STAT_PATH}")
    print(f"Saved LSTM model to {LSTM_PATH}")


if __name__ == "__main__":
    main()

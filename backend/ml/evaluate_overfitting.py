import argparse
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn import svm
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, Dataset

from feature_pipeline import extract_stat_features
from lstm_model import LSTMClassifier
from retrain_tiered_from_live_session import (
    EPOCHS,
    BATCH_SIZE,
    DEVICE,
    augment_positive,
    extract_sessions_from_history,
    generate_negative,
    load_hard_negative_sequences,
    set_seed,
)

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_HISTORY_PATH = ROOT_DIR / "user_profiles" / "shared" / "history_input.csv"
DEFAULT_PROFILES_ROOT = ROOT_DIR / "user_profiles"


class SequenceDataset(Dataset):
    def __init__(self, features: np.ndarray, labels: np.ndarray):
        self.features = torch.tensor(features, dtype=torch.float32)
        self.labels = torch.tensor(labels, dtype=torch.long)

    def __len__(self):
        return len(self.features)

    def __getitem__(self, index):
        return self.features[index], self.labels[index]


def train_lstm_model(x_train: np.ndarray, y_train: np.ndarray):
    dataset = SequenceDataset(x_train, y_train)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    model = LSTMClassifier().to(DEVICE)
    criterion = nn.NLLLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

    for _ in range(EPOCHS):
        model.train()
        for batch_features, batch_labels in loader:
            batch_features = batch_features.to(DEVICE)
            batch_labels = batch_labels.to(DEVICE)
            optimizer.zero_grad()
            predictions = model(batch_features)
            loss = criterion(torch.log(predictions.clamp(min=1e-8)), batch_labels)
            loss.backward()
            optimizer.step()

    return model


def metric_summary(y_true: np.ndarray, y_pred: np.ndarray):
    return {
        "acc": float(accuracy_score(y_true, y_pred)),
        "bal_acc": float(balanced_accuracy_score(y_true, y_pred)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "cm": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
    }


def train_eval_svm(x_train, y_train, x_test, y_test, c_value: float):
    model = CalibratedClassifierCV(
        make_pipeline(
            StandardScaler(),
            svm.SVC(
                kernel="rbf",
                C=c_value,
                gamma="scale",
                class_weight="balanced",
                random_state=42,
            ),
        ),
        method="sigmoid",
        cv=5,
    )
    model.fit(x_train, y_train)
    train_pred = model.predict(x_train)
    test_pred = model.predict(x_test)
    return metric_summary(y_train, train_pred), metric_summary(y_test, test_pred)


def train_eval_lstm(x_train, y_train, x_test, y_test):
    model = train_lstm_model(x_train, y_train)
    model.eval()
    with torch.no_grad():
        train_pred = (
            torch.argmax(model(torch.tensor(x_train, dtype=torch.float32).to(DEVICE)), dim=1)
            .cpu()
            .numpy()
        )
        test_pred = (
            torch.argmax(model(torch.tensor(x_test, dtype=torch.float32).to(DEVICE)), dim=1)
            .cpu()
            .numpy()
        )
    return metric_summary(y_train, train_pred), metric_summary(y_test, test_pred)


def print_block(title: str, train_metrics: dict, test_metrics: dict):
    print(f"\n{title}")
    print(
        "train: "
        f"acc={train_metrics['acc']:.4f} "
        f"bal_acc={train_metrics['bal_acc']:.4f} "
        f"f1={train_metrics['f1']:.4f} "
        f"precision={train_metrics['precision']:.4f} "
        f"recall={train_metrics['recall']:.4f} "
        f"cm={train_metrics['cm']}"
    )
    print(
        "test:  "
        f"acc={test_metrics['acc']:.4f} "
        f"bal_acc={test_metrics['bal_acc']:.4f} "
        f"f1={test_metrics['f1']:.4f} "
        f"precision={test_metrics['precision']:.4f} "
        f"recall={test_metrics['recall']:.4f} "
        f"cm={test_metrics['cm']}"
    )


def build_dataset(history_path: Path, profiles_root: Path, scope_id: str):
    raw_df = pd.read_csv(history_path)
    if len(raw_df) < 10:
        raise ValueError("Need at least 10 rows in history csv for evaluation.")

    historical_sessions = extract_sessions_from_history(raw_df)
    if not historical_sessions:
        raise ValueError("Could not extract sessions from history csv.")

    reference = historical_sessions[-1]
    hard_negatives = load_hard_negative_sequences(profiles_root, scope_id)
    sampled_hard_negatives = (
        random.sample(hard_negatives, min(len(hard_negatives), 220)) if hard_negatives else []
    )

    x_sequences = []
    y = []
    groups = []

    for idx, session in enumerate(historical_sessions):
        session = session.astype(np.float32)
        group_id = f"pos_session_{idx}"
        x_sequences.append(session)
        y.append(1)
        groups.append(group_id)
        for _ in range(24):
            x_sequences.append(augment_positive(session))
            y.append(1)
            groups.append(group_id)

    for _ in range(120):
        x_sequences.append(augment_positive(reference))
        y.append(1)
        groups.append("pos_reference_aug")

    negative_sequences = [generate_negative(reference) for _ in range(220)] + sampled_hard_negatives
    if len(negative_sequences) < 220:
        negative_sequences.extend([generate_negative(reference) for _ in range(220 - len(negative_sequences))])
    negative_sequences = negative_sequences[:220]

    for neg_idx, sequence in enumerate(negative_sequences):
        x_sequences.append(np.asarray(sequence, dtype=np.float32))
        y.append(0)
        groups.append(f"neg_{neg_idx}")

    x_sequences = np.array(x_sequences, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    groups = np.array(groups, dtype=object)
    x_seq_flat = x_sequences.reshape(len(x_sequences), -1)
    x_stat = np.array([extract_stat_features(sequence) for sequence in x_sequences], dtype=np.float32)
    return x_sequences, x_seq_flat, x_stat, y, groups


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", default=str(DEFAULT_HISTORY_PATH))
    parser.add_argument("--profiles-root", default=str(DEFAULT_PROFILES_ROOT))
    parser.add_argument("--scope-id", default="shared")
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    set_seed(42)
    history_path = Path(args.history)
    profiles_root = Path(args.profiles_root)
    scope_id = str(args.scope_id or "shared").strip() or "shared"

    if not history_path.exists():
        raise FileNotFoundError(f"History file not found: {history_path}")

    x_sequences, x_seq_flat, x_stat, y, groups = build_dataset(history_path, profiles_root, scope_id)

    print(f"Total samples: {len(y)}")
    print(f"Positives: {int((y == 1).sum())}, Negatives: {int((y == 0).sum())}")
    print(f"Always-positive baseline accuracy: {float((y == 1).mean()):.4f}")

    indices = np.arange(len(y))
    train_idx, test_idx = train_test_split(
        indices, test_size=args.test_size, random_state=42, stratify=y
    )
    train_groups = set(groups[train_idx].tolist())
    test_pos_idx = [idx for idx in test_idx if y[idx] == 1]
    leaked_pos = [idx for idx in test_pos_idx if groups[idx] in train_groups]
    leak_rate = (len(leaked_pos) / len(test_pos_idx)) if test_pos_idx else 0.0

    print(f"Random split positive leakage rate: {leak_rate:.4f} ({len(leaked_pos)}/{len(test_pos_idx)})")

    print("\n=== Random Split ===")
    svm_seq_train, svm_seq_test = train_eval_svm(
        x_seq_flat[train_idx], y[train_idx], x_seq_flat[test_idx], y[test_idx], c_value=3.0
    )
    print_block("SVM Sequence", svm_seq_train, svm_seq_test)

    svm_stat_train, svm_stat_test = train_eval_svm(
        x_stat[train_idx], y[train_idx], x_stat[test_idx], y[test_idx], c_value=2.0
    )
    print_block("SVM Statistical", svm_stat_train, svm_stat_test)

    lstm_train, lstm_test = train_eval_lstm(
        x_sequences[train_idx], y[train_idx], x_sequences[test_idx], y[test_idx]
    )
    print_block("LSTM", lstm_train, lstm_test)

    gss = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=42)
    g_train_idx, g_test_idx = next(gss.split(x_seq_flat, y, groups=groups))

    print("\n=== Group Split (No Augmentation Leakage) ===")
    svm_seq_train_g, svm_seq_test_g = train_eval_svm(
        x_seq_flat[g_train_idx], y[g_train_idx], x_seq_flat[g_test_idx], y[g_test_idx], c_value=3.0
    )
    print_block("SVM Sequence", svm_seq_train_g, svm_seq_test_g)

    svm_stat_train_g, svm_stat_test_g = train_eval_svm(
        x_stat[g_train_idx], y[g_train_idx], x_stat[g_test_idx], y[g_test_idx], c_value=2.0
    )
    print_block("SVM Statistical", svm_stat_train_g, svm_stat_test_g)

    lstm_train_g, lstm_test_g = train_eval_lstm(
        x_sequences[g_train_idx], y[g_train_idx], x_sequences[g_test_idx], y[g_test_idx]
    )
    print_block("LSTM", lstm_train_g, lstm_test_g)


if __name__ == "__main__":
    main()

import argparse
import random
from pathlib import Path
from typing import Dict, List, Tuple
import pandas as pd
import numpy as np
import joblib
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
DEFAULT_MODEL_CSV_PATH = ROOT_DIR / "user_profiles" / "shared" / "Model.csv"
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


def extract_sessions_from_model_csv(raw_df: pd.DataFrame, user_id: str = None):
    """
    Extract sessions from Model.csv for a specific user or all users.
    Handles user_id column if present.
    """
    if raw_df.empty:
        return []

    # Filter by user if specified
    if user_id:
        if 'user_id' in raw_df.columns:
            raw_df = raw_df[raw_df['user_id'] == user_id]
        elif 'UserId' in raw_df.columns:
            raw_df = raw_df[raw_df['UserId'] == user_id]
        
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


def load_model_csv_for_user(model_csv_path: Path, user_id: str = None) -> Tuple[pd.DataFrame, str]:
    """
    Load Model.csv and optionally filter for a specific user.
    Returns (dataframe, actual_user_id_used).
    """
    if not model_csv_path.exists():
        raise FileNotFoundError(f"Model.csv not found at {model_csv_path}")

    df = pd.read_csv(model_csv_path)
    
    if df.empty:
        raise ValueError("Model.csv is empty")

    # Auto-detect user ID column
    user_col = None
    if 'user_id' in df.columns:
        user_col = 'user_id'
    elif 'UserId' in df.columns:
        user_col = 'UserId'
    
    # If user_id specified, filter data
    if user_id and user_col:
        df = df[df[user_col] == user_id]
        if df.empty:
            raise ValueError(f"No data found for user {user_id} in Model.csv")
        return df, user_id
    
    # Return user_id found or "shared" if no user column
    actual_user_id = "shared"
    if user_col and len(df[user_col].unique()) > 0:
        actual_user_id = str(df[user_col].unique()[0])
    
    return df, actual_user_id


def main():
    set_seed()
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-csv", default=str(DEFAULT_MODEL_CSV_PATH),
                        help="Path to Model.csv in backend (replaces temp_input.csv)")
    parser.add_argument("--user-id", default=None,
                        help="Specific user ID to train model for. If not specified, uses all data.")
    parser.add_argument("--reference", default=str(DEFAULT_REFERENCE_PATH))
    parser.add_argument("--svm-seq", default=str(DEFAULT_SVM_SEQ_PATH))
    parser.add_argument("--svm-stat", default=str(DEFAULT_SVM_STAT_PATH))
    parser.add_argument("--lstm", default=str(DEFAULT_LSTM_PATH))
    parser.add_argument("--profiles-root", default=str(DEFAULT_PROFILES_ROOT))
    parser.add_argument("--scope-id", default=None,
                        help="Scope ID for per-user models. If not provided, derives from user-id.")
    parser.add_argument("--min-hard-negatives", type=int, default=5)
    parser.add_argument("--min-lstm-balanced-accuracy", type=float, default=0.60)
    parser.add_argument("--enforce-quality-gate", action="store_true")
    args = parser.parse_args()

    model_csv_path = Path(args.model_csv)
    reference_path = Path(args.reference)
    svm_seq_path = Path(args.svm_seq)
    svm_stat_path = Path(args.svm_stat)
    lstm_path = Path(args.lstm)
    profiles_root = Path(args.profiles_root)

    # Load Model.csv for training
    print(f"[retrain] Loading Model.csv from {model_csv_path}")
    try:
        raw_df, actual_user_id = load_model_csv_for_user(model_csv_path, args.user_id)
    except (FileNotFoundError, ValueError) as e:
        raise FileNotFoundError(f"Failed to load Model.csv: {e}")

    scope_id = args.scope_id or actual_user_id or "shared"
    print(f"[retrain] Training for scope: {scope_id}, user_id: {actual_user_id}, rows: {len(raw_df)}")

    # Prepare output directories
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    svm_seq_path.parent.mkdir(parents=True, exist_ok=True)
    svm_stat_path.parent.mkdir(parents=True, exist_ok=True)
    lstm_path.parent.mkdir(parents=True, exist_ok=True)

    if len(raw_df) < 10:
        raise ValueError("Need at least 10 live samples in Model.csv to retrain.")

    # Extract sessions from Model.csv
    historical_sessions = extract_sessions_from_model_csv(raw_df, args.user_id)
    if not historical_sessions:
        raise ValueError("Could not extract enough sessions from Model.csv for retraining.")

    print(f"[retrain] Extracted {len(historical_sessions)} sessions from Model.csv")

    reference = historical_sessions[-1]

    # Save reference for future negative generation
    np.save(reference_path.with_suffix(".npy"), reference)
    ref_csv_data = pd.DataFrame(reference, columns=FEATURE_COLS)
    ref_csv_data.to_csv(reference_path, index=False)
    print(f"[retrain] Saved reference session to {reference_path}")

    # Prepare positive samples (augmented from user sessions)
    positive_samples = []
    for session in historical_sessions:
        positive_samples.append(session.astype(np.float32))
        for _ in range(2):
            positive_samples.append(augment_positive(session).astype(np.float32))

    # Prepare negative samples
    negative_samples = load_hard_negative_sequences(profiles_root, scope_id)
    
    if len(negative_samples) < args.min_hard_negatives:
        print(
            f"[retrain] Only {len(negative_samples)} hard negatives available. "
            f"Generating synthetic negatives."
        )
        for _ in range(args.min_hard_negatives - len(negative_samples)):
            negative_samples.append(generate_negative(reference).astype(np.float32))

    print(
        f"[retrain] Total samples: {len(positive_samples)} positive, "
        f"{len(negative_samples)} negative"
    )

    # Prepare training data
    x_all = np.array(positive_samples + negative_samples, dtype=np.float32)
    y_all = np.array([1] * len(positive_samples) + [0] * len(negative_samples), dtype=np.int64)

    x_train, x_test, y_train, y_test = train_test_split(
        x_all, y_all, test_size=0.2, random_state=42, stratify=y_all
    )

    print(f"[retrain] Training set: {len(x_train)}, Test set: {len(x_test)}")

    # Train tier 1 (sequence-level SVM)
    print("[retrain] Training tier-1 SVM (sequence-level)...")
    x_train_flat = x_train.reshape(x_train.shape[0], -1)
    x_test_flat = x_test.reshape(x_test.shape[0], -1)

    clf_seq = make_pipeline(StandardScaler(), svm.SVC(kernel="rbf", probability=True))
    clf_seq.fit(x_train_flat, y_train)
    y_pred_seq = clf_seq.predict(x_test_flat)
    acc_seq = balanced_accuracy_score(y_test, y_pred_seq)
    print(f"[retrain] Tier-1 balanced accuracy: {acc_seq:.4f}")
    joblib.dump(clf_seq, svm_seq_path)

    # Train tier 2 (statistical SVM)
    print("[retrain] Training tier-2 SVM (statistical features)...")
    stat_features_train = np.array([extract_stat_features(seq) for seq in x_train])
    stat_features_test = np.array([extract_stat_features(seq) for seq in x_test])

    clf_stat = make_pipeline(StandardScaler(), svm.SVC(kernel="rbf", probability=True))
    clf_stat.fit(stat_features_train, y_train)
    y_pred_stat = clf_stat.predict(stat_features_test)
    acc_stat = balanced_accuracy_score(y_test, y_pred_stat)
    print(f"[retrain] Tier-2 balanced accuracy: {acc_stat:.4f}")
    joblib.dump(clf_stat, svm_stat_path)

    # Train LSTM
    print("[retrain] Training LSTM model...")
    train_lstm_model(x_train, y_train, lstm_path)
    lstm_model = LSTMClassifier()
    lstm_model.load_state_dict(torch.load(lstm_path, map_location="cpu"))
    lstm_model.eval()

    with torch.no_grad():
        x_test_tensor = torch.tensor(x_test, dtype=torch.float32)
        predictions = lstm_model(x_test_tensor)
        y_pred_lstm = predictions.argmax(dim=1).numpy()

    acc_lstm = balanced_accuracy_score(y_test, y_pred_lstm)
    print(f"[retrain] LSTM balanced accuracy: {acc_lstm:.4f}")

    # Quality gate
    if args.enforce_quality_gate:
        min_acc = args.min_lstm_balanced_accuracy
        if acc_lstm < min_acc:
            raise ValueError(
                f"LSTM model accuracy {acc_lstm:.4f} below minimum {min_acc}. "
                f"Retraining failed quality gate."
            )

    print(f"[retrain] Successfully trained models for scope: {scope_id}")
    print(f"[retrain] Models saved to:")
    print(f"  - {svm_seq_path}")
    print(f"  - {svm_stat_path}")
    print(f"  - {lstm_path}")


if __name__ == "__main__":
    main()

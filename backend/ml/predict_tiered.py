import joblib
import numpy as np
import pandas as pd
import torch
from pathlib import Path

from feature_pipeline import extract_stat_features, normalize_session
from lstm_model import LSTMClassifier

ROOT_DIR = Path(__file__).resolve().parent
SVM_SEQ_PATH = ROOT_DIR.parent / "svm_tier_1_sequence.pkl"
SVM_STAT_PATH = ROOT_DIR.parent / "svm_tier_2_statistical.pkl"
LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"
TEMP_INPUT_PATH = ROOT_DIR / "temp_input.csv"

clf_seq = joblib.load(SVM_SEQ_PATH)
clf_stat = joblib.load(SVM_STAT_PATH)

lstm_model = LSTMClassifier()
lstm_model.load_state_dict(torch.load(LSTM_PATH, map_location=torch.device("cpu")))
lstm_model.eval()

df = pd.read_csv(TEMP_INPUT_PATH)
test_seq = normalize_session(df)

test_seq_flat = test_seq.flatten()
svm1_score = clf_seq.predict_proba([test_seq_flat])[0][1]

stat_features = extract_stat_features(test_seq)
expected_stat_dims = getattr(clf_stat, "n_features_in_", len(stat_features))
if len(stat_features) != expected_stat_dims and expected_stat_dims == 24:
    # Backward compatibility for older tier-2 models trained with
    # [means, stds, mins, maxs] only.
    means = np.mean(test_seq, axis=0)
    stds = np.std(test_seq, axis=0)
    mins = np.min(test_seq, axis=0)
    maxs = np.max(test_seq, axis=0)
    stat_features = np.concatenate([means, stds, mins, maxs]).astype(np.float32)
svm2_score = clf_stat.predict_proba([stat_features])[0][1]

test_tensor = torch.tensor(test_seq, dtype=torch.float32).unsqueeze(0)
with torch.no_grad():
    outputs = lstm_model(test_tensor)
    lstm_score = outputs[0][1].item()

print(f"{svm1_score},{svm2_score},{lstm_score}")

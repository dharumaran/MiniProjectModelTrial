import joblib
import numpy as np
import pandas as pd
import torch
from pathlib import Path

from lstm_model import LSTMClassifier

ROOT_DIR = Path(__file__).resolve().parent
SVM_SEQ_PATH = ROOT_DIR.parent / "tier_one_svm.pkl"
SVM_STAT_PATH = ROOT_DIR.parent / "tier_two_svm.pkl"
LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"
TEMP_INPUT_PATH = ROOT_DIR / "temp_input.csv"

clf_seq = joblib.load(SVM_SEQ_PATH)
clf_stat = joblib.load(SVM_STAT_PATH)

lstm_model = LSTMClassifier()
lstm_model.load_state_dict(torch.load(LSTM_PATH, map_location=torch.device("cpu")))
lstm_model.eval()

feature_cols = ["X", "Y", "Pressure", "Duration", "Orientation", "Size"]


def pad_sequence(df):
    arr = df[feature_cols].values
    if len(arr) >= 50:
        seq = arr[:50]
    else:
        padding = np.zeros((50 - len(arr), len(feature_cols)))
        seq = np.vstack([arr, padding])
    return seq


def extract_stat_features(seq):
    means = np.mean(seq, axis=0)
    stds = np.std(seq, axis=0)
    mins = np.min(seq, axis=0)
    maxs = np.max(seq, axis=0)
    return np.concatenate([means, stds, mins, maxs])


df = pd.read_csv(TEMP_INPUT_PATH)
test_seq = pad_sequence(df)

test_seq_flat = test_seq.flatten()
svm1_score = clf_seq.predict_proba([test_seq_flat])[0][1]

stat_features = extract_stat_features(test_seq)
svm2_score = clf_stat.predict_proba([stat_features])[0][1]

test_tensor = torch.tensor(test_seq, dtype=torch.float32).unsqueeze(0)
with torch.no_grad():
    outputs = lstm_model(test_tensor)
    lstm_score = outputs[0][1].item()

print(f"{svm1_score},{svm2_score},{lstm_score}")

import argparse
import joblib
import numpy as np
import pandas as pd
import torch
from pathlib import Path

from feature_pipeline import extract_stat_features, normalize_session
from lstm_model import LSTMClassifier

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_SVM_SEQ_PATH = ROOT_DIR.parent / "svm_tier_1_sequence.pkl"
DEFAULT_SVM_STAT_PATH = ROOT_DIR.parent / "svm_tier_2_statistical.pkl"
DEFAULT_LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"
DEFAULT_TEMP_INPUT_PATH = ROOT_DIR / "temp_input.csv"

parser = argparse.ArgumentParser()
parser.add_argument("--temp-input", default=str(DEFAULT_TEMP_INPUT_PATH))
parser.add_argument("--svm-seq", default=str(DEFAULT_SVM_SEQ_PATH))
parser.add_argument("--svm-stat", default=str(DEFAULT_SVM_STAT_PATH))
parser.add_argument("--lstm", default=str(DEFAULT_LSTM_PATH))
args = parser.parse_args()

temp_input_path = Path(args.temp_input)
svm_seq_path = Path(args.svm_seq)
svm_stat_path = Path(args.svm_stat)
lstm_path = Path(args.lstm)

# Load models
clf_seq = joblib.load(svm_seq_path)
clf_stat = joblib.load(svm_stat_path)
lstm_model = LSTMClassifier()
lstm_model.load_state_dict(torch.load(lstm_path, map_location=torch.device("cpu")))
lstm_model.eval()

# Read and normalize test data
df = pd.read_csv(temp_input_path)
test_seq = normalize_session(df)

# TIER 1: Sequence-level SVM (fast check)
test_seq_flat = test_seq.flatten()
svm1_score = clf_seq.predict_proba([test_seq_flat])[0][1]
svm1_verdict = "genuine" if svm1_score >= 0.5 else "intruder"

print(f"[Tier-1 SVM] Score: {svm1_score:.4f}, Verdict: {svm1_verdict}")

# TIER 2: Statistical SVM (confirmation check)
stat_features = extract_stat_features(test_seq)
expected_stat_dims = getattr(clf_stat, "n_features_in_", len(stat_features))

if len(stat_features) != expected_stat_dims and expected_stat_dims == 24:
    # Backward compatibility
    means = np.mean(test_seq, axis=0)
    stds = np.std(test_seq, axis=0)
    mins = np.min(test_seq, axis=0)
    maxs = np.max(test_seq, axis=0)
    stat_features = np.concatenate([means, stds, mins, maxs]).astype(np.float32)

svm2_score = clf_stat.predict_proba([stat_features])[0][1]
svm2_verdict = "genuine" if svm2_score >= 0.5 else "intruder"

print(f"[Tier-2 SVM] Score: {svm2_score:.4f}, Verdict: {svm2_verdict}")

# CASCADE LOGIC: Only run LSTM if BOTH SVM1 and SVM2 suspect an intruder
lstm_score = 0.5  # Default neutral score
lstm_verdict = "skip"
lstm_used = False
SVM_SUSPICIOUS_THRESHOLD = 0.60

if svm1_score < SVM_SUSPICIOUS_THRESHOLD or svm2_score < SVM_SUSPICIOUS_THRESHOLD:
    # Trigger LSTM when either SVM is suspicious to improve intruder recall.
    print(
        f"[Cascade] Suspicious SVM score detected (threshold={SVM_SUSPICIOUS_THRESHOLD:.2f}) -> Running LSTM..."
    )
    test_tensor = torch.tensor(test_seq, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        outputs = lstm_model(test_tensor)
        lstm_score = outputs[0][1].item()
    lstm_verdict = "genuine" if lstm_score >= 0.5 else "intruder"
    lstm_used = True
    print(f"[Tier-3 LSTM] Score: {lstm_score:.4f}, Verdict: {lstm_verdict}")
else:
    # High-confidence SVM pair -> Skip LSTM
    print(
        f"[Cascade] Both SVM scores above {SVM_SUSPICIOUS_THRESHOLD:.2f} ({svm1_score:.4f}/{svm2_score:.4f}) -> Skipping LSTM"
    )
    lstm_used = False

# FINAL DECISION: Ensemble voting with cascade logic
if lstm_used:
    # If LSTM was used, weight it equally with SVMs
    verdicts = [svm1_verdict, svm2_verdict, lstm_verdict]
    genuine_votes = verdicts.count("genuine")
    final_verdict = "genuine" if genuine_votes >= 2 else "intruder"
    overall_score = (svm1_score + svm2_score + lstm_score) / 3.0
else:
    # If LSTM was skipped, use SVM consensus (both said genuine)
    final_verdict = "genuine" if (svm1_verdict == "genuine" and svm2_verdict == "genuine") else "intruder"
    overall_score = (svm1_score + svm2_score) / 2.0

print(f"[FINAL] Verdict: {final_verdict.upper()}, Score: {overall_score:.4f}, LSTM Used: {lstm_used}")
# Output format: svm1_score,svm2_score,lstm_score,lstm_used_flag
print(f"{svm1_score},{svm2_score},{lstm_score if lstm_used else 0},{int(lstm_used)}")

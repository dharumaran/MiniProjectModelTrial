"""
Enhanced prediction script that supports:
1. Legacy: Using temp_input.csv with shared models
2. New: Using per-user models by specifying user_id
3. Model discovery: Auto-detect per-user model directories

Usage:
  # Legacy (shared models + temp_input.csv)
  python predict_tiered.py --temp-input temp_input.csv
  
  # Per-user models (recommended)
  python predict_tiered.py --temp-input test_data.csv --user-id BANK123456
  
  # Explicit model paths
  python predict_tiered.py --temp-input test_data.csv \\
    --svm-seq models/tier1.pkl \\
    --svm-stat models/tier2.pkl \\
    --lstm models/lstm.pt
"""

import argparse
import joblib
import numpy as np
import pandas as pd
import torch
from pathlib import Path

from feature_pipeline import extract_stat_features, normalize_session, clamp01
from lstm_model import LSTMClassifier

ROOT_DIR = Path(__file__).resolve().parent
PROFILES_ROOT = ROOT_DIR / "user_profiles"

# Legacy defaults (for backward compatibility)
DEFAULT_SVM_SEQ_PATH = ROOT_DIR.parent / "svm_tier_1_sequence.pkl"
DEFAULT_SVM_STAT_PATH = ROOT_DIR.parent / "svm_tier_2_statistical.pkl"
DEFAULT_LSTM_PATH = ROOT_DIR / "lstm_classifier.pt"
DEFAULT_TEMP_INPUT_PATH = ROOT_DIR / "temp_input.csv"


def resolve_model_paths(user_id=None):
    """
    Resolve model paths for either shared or per-user models.
    
    Args:
        user_id: User ID for per-user models. If None, uses shared models.
    
    Returns:
        dict with paths to svm_seq, svm_stat, lstm models
    """
    if user_id:
        # Per-user model paths
        user_dir = PROFILES_ROOT / user_id
        paths = {
            "svm_seq": user_dir / "svm_tier_1_sequence.pkl",
            "svm_stat": user_dir / "svm_tier_2_statistical.pkl", 
            "lstm": user_dir / "lstm_classifier.pt",
            "user_id": user_id,
            "scope": "per_user"
        }
        
        # Verify all models exist
        missing = [p for p, v in paths.items() if p != "user_id" and p != "scope" and not v.exists()]
        if missing:
            raise FileNotFoundError(
                f"Per-user models missing for {user_id}: {missing}. "
                f"Have you trained models for this user?"
            )
        return paths
    else:
        # Shared model paths (legacy)
        paths = {
            "svm_seq": DEFAULT_SVM_SEQ_PATH,
            "svm_stat": DEFAULT_SVM_STAT_PATH,
            "lstm": DEFAULT_LSTM_PATH,
            "user_id": None,
            "scope": "shared"
        }
        return paths


def load_models(model_paths):
    """Load all three tier models."""
    print(f"[predict] Loading models from {model_paths['scope']} scope")
    if model_paths['user_id']:
        print(f"           User: {model_paths['user_id']}")
    
    clf_seq = joblib.load(model_paths["svm_seq"])
    print(f"           SVM Tier-1 (sequence): {model_paths['svm_seq']}")
    
    clf_stat = joblib.load(model_paths["svm_stat"])
    print(f"           SVM Tier-2 (statistical): {model_paths['svm_stat']}")
    
    lstm_model = LSTMClassifier()
    lstm_model.load_state_dict(
        torch.load(model_paths["lstm"], map_location=torch.device("cpu"))
    )
    lstm_model.eval()
    print(f"           LSTM: {model_paths['lstm']}")
    
    return clf_seq, clf_stat, lstm_model


def predict_with_session(test_seq, clf_seq, clf_stat, lstm_model):
    """
    Run three-tier prediction on a normalized session.
    
    Returns:
        dict with all scores and final verdict
    """
    # Tier 1: Sequence-level SVM
    test_seq_flat = test_seq.flatten()
    svm1_score = clf_seq.predict_proba([test_seq_flat])[0][1]
    svm1_verdict = "genuine" if svm1_score >= 0.5 else "anomaly"
    
    # Tier 2: Statistical SVM (with backward compatibility)
    stat_features = extract_stat_features(test_seq)
    expected_stat_dims = getattr(clf_stat, "n_features_in_", len(stat_features))
    
    if len(stat_features) != expected_stat_dims and expected_stat_dims == 24:
        # Backward compatibility for older models trained with [means, stds, mins, maxs] only
        means = np.mean(test_seq, axis=0)
        stds = np.std(test_seq, axis=0)
        mins = np.min(test_seq, axis=0)
        maxs = np.max(test_seq, axis=0)
        stat_features = np.concatenate([means, stds, mins, maxs])
    
    svm2_score = clf_stat.predict_proba([stat_features])[0][1]
    svm2_verdict = "genuine" if svm2_score >= 0.5 else "anomaly"
    
    # Tier 3: LSTM
    test_seq_tensor = torch.tensor([test_seq], dtype=torch.float32)
    with torch.no_grad():
        lstm_probs = lstm_model(test_seq_tensor)
    lstm_score = lstm_probs[0][1].item()  # Probability of class 1 (genuine)
    lstm_verdict = "genuine" if lstm_score >= 0.5 else "anomaly"
    
    # Ensemble: majority vote on verdicts
    verdicts = [svm1_verdict, svm2_verdict, lstm_verdict]
    genuine_count = verdicts.count("genuine")
    final_verdict = "genuine" if genuine_count >= 2 else "anomaly"
    
    # Calculate overall score as average
    overall_score = (svm1_score + svm2_score + lstm_score) / 3.0
    
    return {
        "tier_1_svm": {
            "score": float(svm1_score),
            "verdict": svm1_verdict,
        },
        "tier_2_svm": {
            "score": float(svm2_score),
            "verdict": svm2_verdict,
        },
        "tier_3_lstm": {
            "score": float(lstm_score),
            "verdict": lstm_verdict,
        },
        "final_verdict": final_verdict,
        "overall_score": float(overall_score),
        "confidence": float(max([svm1_score, svm2_score, lstm_score])),
        "ensemble_vote": f"{genuine_count}/3",
    }


def main():
    parser = argparse.ArgumentParser(
        description="Three-tier biometric authentication prediction"
    )
    parser.add_argument("--temp-input", default=str(DEFAULT_TEMP_INPUT_PATH),
                        help="CSV file with behavior data to predict on")
    parser.add_argument("--user-id", default=None,
                        help="User ID for per-user models. If not set, uses shared models")
    parser.add_argument("--svm-seq", default=None,
                        help="Override Tier-1 SVM model path")
    parser.add_argument("--svm-stat", default=None,
                        help="Override Tier-2 SVM model path")
    parser.add_argument("--lstm", default=None,
                        help="Override LSTM model path")
    parser.add_argument("--output", default=None,
                        help="Save prediction results to JSON file")
    parser.add_argument("--verbose", action="store_true",
                        help="Print detailed prediction info")
    
    args = parser.parse_args()
    
    try:
        # Resolve model paths
        if args.user_id:
            model_paths = resolve_model_paths(args.user_id)
        else:
            model_paths = resolve_model_paths()
        
        # Override with explicit paths if provided
        if args.svm_seq:
            model_paths["svm_seq"] = Path(args.svm_seq)
        if args.svm_stat:
            model_paths["svm_stat"] = Path(args.svm_stat)
        if args.lstm:
            model_paths["lstm"] = Path(args.lstm)
        
        # Load test data
        temp_input_path = Path(args.temp_input)
        if not temp_input_path.exists():
            raise FileNotFoundError(f"Input CSV not found: {temp_input_path}")
        
        print(f"\n[predict] Loading test data from {temp_input_path}")
        df = pd.read_csv(temp_input_path)
        print(f"           Rows: {len(df)}")
        print(f"           Columns: {list(df.columns)}")
        
        # Normalize session
        test_seq = normalize_session(df)
        print(f"           Normalized sequence shape: {test_seq.shape}")
        
        # Load models
        print("\n[predict] Loading models")
        clf_seq, clf_stat, lstm_model = load_models(model_paths)
        
        # Predict
        print("\n[predict] Running three-tier prediction")
        result = predict_with_session(test_seq, clf_seq, clf_stat, lstm_model)
        
        # Display results
        print("\n" + "="*70)
        print("PREDICTION RESULTS")
        print("="*70)
        print(f"Final Verdict: {result['final_verdict'].upper()}")
        print(f"Overall Score: {result['overall_score']:.4f}")
        print(f"Confidence: {result['confidence']:.4f}")
        print(f"Ensemble Vote: {result['ensemble_vote']}")
        print("\n" + "-"*70)
        print("TIER BREAKDOWN:")
        print("-"*70)
        print(f"Tier 1 (Sequence SVM):   {result['tier_1_svm']['verdict'].upper():8s} ({result['tier_1_svm']['score']:.4f})")
        print(f"Tier 2 (Statistical SVM): {result['tier_2_svm']['verdict'].upper():8s} ({result['tier_2_svm']['score']:.4f})")
        print(f"Tier 3 (LSTM):            {result['tier_3_lstm']['verdict'].upper():8s} ({result['tier_3_lstm']['score']:.4f})")
        print("="*70)
        
        if args.verbose:
            print("\n[DEBUG] Detailed results:")
            import json
            print(json.dumps(result, indent=2))
        
        if args.output:
            import json
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\n✅ Results saved to {output_path}")
        
        # Return appropriate exit code
        exit_code = 0 if result['final_verdict'] == 'genuine' else 1
        print(f"\n✅ Done (exit code: {exit_code})\n")
        exit(exit_code)
        
    except Exception as e:
        print(f"\n❌ Error: {e}\n", flush=True)
        exit(1)


if __name__ == "__main__":
    main()

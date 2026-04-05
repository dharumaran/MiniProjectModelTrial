import pandas as pd
import numpy as np
import joblib

# Load model
clf = joblib.load("../svm_behavior_model.pkl")

# Load test data
df = pd.read_csv("temp_input.csv")
feature_cols = ['X', 'Y', 'Pressure', 'Duration', 'Orientation', 'Size']

def pad_and_flatten(df):
    arr = df[feature_cols].values
    if len(arr) >= 50:
        seq = arr[:50]
    else:
        padding = np.zeros((50 - len(arr), len(feature_cols)))
        seq = np.vstack([arr, padding])
    return seq.flatten()

test_seq = pad_and_flatten(df)

# Predict probability
prob = clf.predict_proba([test_seq])[0][1]  # probability of being legitimate (class 1)

print(prob)
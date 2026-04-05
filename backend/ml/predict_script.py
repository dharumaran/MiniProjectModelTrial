import pandas as pd
import torch
from siamese_model import load_model
from predict import predict_risk_score
import numpy as np

df = pd.read_csv("ml/temp_input.csv")
reference = pd.read_csv("ml/reference_session.csv")

SEQ_LEN = 50
feature_cols = ['X', 'Y', 'Pressure', 'Duration', 'Orientation', 'Size']

def pad(df):
    arr = df[feature_cols].values
    if len(arr) >= SEQ_LEN:
        return arr[:SEQ_LEN]
    else:
        return np.vstack([arr, np.zeros((SEQ_LEN - len(arr), len(feature_cols)))])

new_seq = pad(df)
ref_seq = pad(reference)

score = predict_risk_score(new_seq, ref_seq)
print(score)  # Printed and caught by Node.js

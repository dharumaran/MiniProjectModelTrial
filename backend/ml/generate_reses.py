import pandas as pd
import numpy as np

SEQUENCE_LENGTH = 50
feature_cols = ['X', 'Y', 'Pressure', 'Duration', 'Orientation', 'Size']

np.random.seed(42)
data = np.random.rand(SEQUENCE_LENGTH, len(feature_cols))  # Values between 0 and 1
df = pd.DataFrame(data, columns=feature_cols)
df.to_csv("reference_session.csv", index=False)

print("✅ Synthetic reference_session.csv created.")

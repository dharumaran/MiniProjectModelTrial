import pandas as pd
import numpy as np
from sklearn import svm
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import joblib

# Parameters
SEQUENCE_LENGTH = 50
FEATURE_COLS = ['X', 'Y', 'Pressure', 'Duration', 'Orientation', 'Size']
NUM_FEATURES = len(FEATURE_COLS)

# Load reference session
reference = pd.read_csv("reference_session.csv").values

# Function to generate legitimate sequences (similar to reference)
def generate_legitimate(num_samples=50):
    data = []
    labels = []
    for _ in range(num_samples):
        # Add small noise to reference
        noise = np.random.normal(0, 0.1, reference.shape)
        seq = np.clip(reference + noise, 0, 1)
        data.append(seq.flatten())
        labels.append(1)  # legitimate
    return data, labels

# Function to generate fraudulent sequences (random)
def generate_fraudulent(num_samples=50):
    data = []
    labels = []
    for _ in range(num_samples):
        seq = np.random.rand(SEQUENCE_LENGTH, NUM_FEATURES)
        data.append(seq.flatten())
        labels.append(0)  # fraudulent
    return data, labels

# Generate data
legit_data, legit_labels = generate_legitimate(100)
fraud_data, fraud_labels = generate_fraudulent(100)

X = np.array(legit_data + fraud_data)
y = np.array(legit_labels + fraud_labels)

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train SVM with probability
clf = svm.SVC(kernel='rbf', probability=True, random_state=42)
clf.fit(X_train, y_train)

# Evaluate
y_pred = clf.predict(X_test)
print(f"Accuracy: {accuracy_score(y_test, y_pred)}")

# Save model
joblib.dump(clf, "svm_behavior_model.pkl")
print("Model saved as svm_behavior_model.pkl")
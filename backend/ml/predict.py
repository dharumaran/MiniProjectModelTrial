import torch
import pandas as pd
import numpy as np
from siamese_model import load_model  # Assuming the model is loaded correctly

REFERENCE_PATH = "reference_session.csv"  # Correct path to the reference session

# Function to load the reference session data
def load_sequence(path):
    try:
        df = pd.read_csv(path)
        print(f"✅ Loaded reference session data from {path}")
        return df
    except FileNotFoundError as e:
        print(f"❌ Failed to load input files: {str(e)}")
        return None

# Function to preprocess and pad the sequence if less than 50 events
def preprocess_sequence(session_data, sequence_length=50):
    if len(session_data) < sequence_length:
        padding = np.zeros((sequence_length - len(session_data), session_data.shape[1]))
        session_data = np.vstack([session_data, padding])
    return session_data

# Function to compute the similarity score
def predict_risk_score(test_seq, reference_seq, model_path="ml/siamese_lstm_behavior.pt"):
    model = load_model(model_path)
    
    print("🚨 Debugging Test Sequence Shape:", test_seq.shape)  # Debugging the test sequence shape
    print("🚨 Debugging Reference Sequence Shape:", reference_seq.shape)  # Debugging the reference sequence shape

    # Ensure input data is converted to tensors correctly
    x1 = torch.tensor(test_seq, dtype=torch.float32).unsqueeze(0)  # Add batch dimension
    x2 = torch.tensor(reference_seq, dtype=torch.float32).unsqueeze(0)

    print(f"🚨 Input Shape for Test Sequence: {x1.shape}, Reference Sequence: {x2.shape}")

    with torch.no_grad():
        distance = model(x1, x2)  # Output from model, which is typically the distance
        print("🧮 Raw model output (distance):", distance)

        similarity = torch.sigmoid(-distance).item()


        return similarity

# Load reference session data
reference = load_sequence(REFERENCE_PATH)

if reference is None:
    print("❌ No reference session found.")
else:
    # Simulating the input session (from Postman request or your real-time input)
    test = [
        [120, 340, 0.6, 110, 0, 0.5],
        [130, 360, 0.5, 90, 0, 0.6]
    ]  # Replace with actual session data from Postman request

    test_sequence = np.array(test)  # Your input session

    # Ensure reference sequence is in the correct format (same number of features)
    reference_sequence = reference[["X", "Y", "Pressure", "Duration", "Orientation", "Size"]].values  # Ensure only the necessary columns

    # Preprocess and pad the sequences to the correct length (50 events)
    test_sequence = preprocess_sequence(test_sequence)
    reference_sequence = preprocess_sequence(reference_sequence)

    print("🚨 Debugging Input Sequence for Model:", test_sequence)

    # Compute similarity
    similarity_score = predict_risk_score(test_sequence, reference_sequence)
    print("🧠 ML Similarity Score:", similarity_score)

import pandas as pd
import numpy as np
import torch
from siamese_model import load_model  # Import the model loading function

# Path to the reference session file
REFERENCE_PATH = "ml/reference_session.csv"

# Function to load the reference session data
def load_sequence(path):
    try:
        df = pd.read_csv(path)
        return df
    except FileNotFoundError as e:
        print(f"Failed to load input files: {str(e)}")
    except Exception as e:
        print(f"Unexpected error: {str(e)}")

# Function to compute the similarity score
def predict_risk_score(test_seq, reference_seq, model_path="ml/siamese_lstm_behavior.pt"):
    model = load_model(model_path)
    
    #print("Debugging Test Sequence Shape:", test_seq.shape)  # Check test sequence shape
    #print("Debugging Reference Sequence Shape:", reference_seq.shape)  # Check reference sequence shape

    x1 = torch.tensor(test_seq, dtype=torch.float32).unsqueeze(0)  # Add batch dimension
    x2 = torch.tensor(reference_seq, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        dist = model(x1, x2).item()
        #print("Raw model output (distance):", dist)

        similarity = torch.sigmoid(torch.tensor(-dist)).item()

        return similarity

# Load reference session data
reference = load_sequence(REFERENCE_PATH)

if reference is None:
    print("No reference session found.")
else:
    # Assuming the incoming request has a 'session' key with the user data to compare
    test = [
        [120, 340, 0.6, 110, 0, 0.5],
        [130, 360, 0.5, 90, 0, 0.6]
    ]  # Replace this with the actual session data received in the API request

    # Ensure the reference and test have the same shape
    test_sequence = np.array(test)  # Your input session
    reference_sequence = reference.values  # Your reference session (make sure it's correctly structured)
    def pad_sequence(arr, seq_len=50):
        if arr.shape[0] < seq_len:
            padding = np.zeros((seq_len - arr.shape[0], arr.shape[1]))
            return np.vstack([arr, padding])
        else:
            return arr[:seq_len]

    test_sequence = pad_sequence(test_sequence)
    reference_sequence = pad_sequence(reference_sequence)

    # Compute similarity
    similarity_score = predict_risk_score(test_sequence, reference_sequence)
    print(similarity_score)

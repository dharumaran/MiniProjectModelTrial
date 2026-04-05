import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from tqdm import tqdm
import os
import random

from siamese_model import SiameseLSTM

# Constants
SEQUENCE_LENGTH = 50
EMBEDDING_DIM = 64
LSTM_UNITS = 64
BATCH_SIZE = 128
EPOCHS = 10
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Load dataset
df = pd.read_csv('simulated_touch_data.csv')
feature_cols = ['X', 'Y', 'Pressure', 'Duration', 'Orientation', 'Size']

# Group sessions
sessions = df.groupby(['user_id', 'session_id'])

def pad_session(session_df):
    arr = session_df[feature_cols].values
    if len(arr) >= SEQUENCE_LENGTH:
        return arr[:SEQUENCE_LENGTH]
    else:
        pad = np.zeros((SEQUENCE_LENGTH - len(arr), len(feature_cols)))
        return np.vstack([arr, pad])

session_data = {}
for (user_id, session_id), sess_df in sessions:
    session_data[(user_id, session_id)] = pad_session(sess_df)

session_keys = list(session_data.keys())

# Create positive & negative pairs
def create_pairs(session_data, n_pairs=10000):
    pairs, labels = [], []
    keys = list(session_data.keys())
    users = list(set([k[0] for k in keys]))
    
    for _ in tqdm(range(n_pairs)):
        same_user = np.random.choice(users)
        same_sessions = [k for k in keys if k[0] == same_user]
        if len(same_sessions) < 2:
            continue
        s1, s2 = random.sample(same_sessions, 2)
        pairs.append([session_data[s1], session_data[s2]])
        labels.append(1)

        u1, u2 = np.random.choice(users, 2, replace=False)
        s1 = random.choice([k for k in keys if k[0] == u1])
        s2 = random.choice([k for k in keys if k[0] == u2])
        pairs.append([session_data[s1], session_data[s2]])
        labels.append(0)

    return np.array(pairs), np.array(labels)

# Generate data
pairs, labels = create_pairs(session_data, 10000)
X1, X2 = pairs[:,0], pairs[:,1]
X1_train, X1_val, X2_train, X2_val, y_train, y_val = train_test_split(X1, X2, labels, test_size=0.2, random_state=42)

# Dataset
class SiameseDataset(Dataset):
    def __init__(self, X1, X2, y):
        self.X1 = torch.tensor(X1, dtype=torch.float32)
        self.X2 = torch.tensor(X2, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32)
    def __len__(self):
        return len(self.y)
    def __getitem__(self, idx):
        return self.X1[idx], self.X2[idx], self.y[idx]

train_loader = DataLoader(SiameseDataset(X1_train, X2_train, y_train), batch_size=BATCH_SIZE, shuffle=True)
val_loader = DataLoader(SiameseDataset(X1_val, X2_val, y_val), batch_size=BATCH_SIZE)

# Model init
input_dim = len(feature_cols)
model = SiameseLSTM(input_dim, LSTM_UNITS, EMBEDDING_DIM).to(DEVICE)
optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

# Contrastive loss
def contrastive_loss(y_pred, y_true):
    margin = 1.0
    return torch.mean(y_true * (y_pred ** 2) + (1 - y_true) * ((torch.clamp(margin - y_pred, min=0.0)) ** 2))

# Train loop
for epoch in range(EPOCHS):
    model.train()
    total_loss = 0
    for x1, x2, y in train_loader:
        x1, x2, y = x1.to(DEVICE), x2.to(DEVICE), y.to(DEVICE)
        optimizer.zero_grad()
        dist = model(x1, x2)
        loss = contrastive_loss(dist, y)
        loss.backward()
        optimizer.step()
        total_loss += loss.item()
    
    print(f"Epoch {epoch+1}/{EPOCHS}, Loss: {total_loss:.4f}")

# Save model
torch.save(model.state_dict(), "siamese_lstm_behavior.pt")
print("✅ Model trained and saved to siamese_lstm_behavior.pt")

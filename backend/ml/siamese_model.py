import torch
import torch.nn as nn

class SiameseLSTM(nn.Module):
    def __init__(self, input_dim, lstm_units=64, embedding_dim=64):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, lstm_units, batch_first=True)
        self.fc = nn.Linear(lstm_units, embedding_dim)

    def forward_once(self, x):
        out, _ = self.lstm(x)
        out = out[:, -1, :]
        return torch.relu(self.fc(out))

    def forward(self, x1, x2):
        emb1 = self.forward_once(x1)
        emb2 = self.forward_once(x2)
        return torch.norm(emb1 - emb2, dim=1)

def load_model(model_path="ml/siamese_lstm_behavior.pt", input_dim=6):
    model = SiameseLSTM(input_dim=input_dim)
    model.load_state_dict(torch.load(model_path, map_location=torch.device("cpu")))
    model.eval()
    return model

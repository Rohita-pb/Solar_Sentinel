"""
LSTM Baseline Model for ISRO PS14 Radiation Forecasting.

Bidirectional LSTM with multi-output head for 3 forecast horizons:
30-minute, 6-hour, and 12-hour ahead electron flux prediction.
"""

import torch
import torch.nn as nn
from typing import Optional, Dict

from src.utils.logger import get_logger

logger = get_logger(__name__)


class LSTMForecaster(nn.Module):
    """
    Bidirectional LSTM model for multi-horizon electron flux forecasting.
    
    Architecture:
    Input (seq_len, num_features) 
    → LSTM (bidirectional, 2 layers) 
    → LayerNorm 
    → Dense → GELU → Dropout 
    → Dense → output (num_horizons)
    """
    
    def __init__(
        self,
        num_features: int,
        hidden_size: int = 128,
        num_layers: int = 2,
        num_horizons: int = 3,
        dropout: float = 0.2,
        bidirectional: bool = True,
    ):
        """
        Args:
            num_features: Number of input features per timestep.
            hidden_size: LSTM hidden state size.
            num_layers: Number of stacked LSTM layers.
            num_horizons: Number of forecast horizons (default: 3 for 30min, 6h, 12h).
            dropout: Dropout rate.
            bidirectional: Whether to use bidirectional LSTM.
        """
        super().__init__()
        
        self.num_features = num_features
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.num_horizons = num_horizons
        self.bidirectional = bidirectional
        self.num_directions = 2 if bidirectional else 1
        
        # Input projection
        self.input_proj = nn.Linear(num_features, hidden_size)
        
        # LSTM
        self.lstm = nn.LSTM(
            input_size=hidden_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=bidirectional
        )
        
        # Layer normalization
        lstm_output_size = hidden_size * self.num_directions
        self.layer_norm = nn.LayerNorm(lstm_output_size)
        
        # Attention over sequence (to weight important timesteps)
        self.attention = nn.Sequential(
            nn.Linear(lstm_output_size, hidden_size),
            nn.Tanh(),
            nn.Linear(hidden_size, 1),
        )
        
        # Multi-horizon output head
        self.output_head = nn.Sequential(
            nn.Linear(lstm_output_size, hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, num_horizons),
        )
        
        # Initialize weights
        self._init_weights()
        
        # Log model size
        total_params = sum(p.numel() for p in self.parameters())
        trainable_params = sum(p.numel() for p in self.parameters() if p.requires_grad)
        logger.info(f"LSTM model: {trainable_params:,} trainable params ({total_params:,} total)")
    
    def _init_weights(self):
        """Initialize weights with Xavier/Glorot initialization."""
        for name, param in self.named_parameters():
            if 'weight_ih' in name:
                nn.init.xavier_uniform_(param)
            elif 'weight_hh' in name:
                nn.init.orthogonal_(param)
            elif 'bias' in name:
                nn.init.zeros_(param)
            elif 'weight' in name and param.dim() >= 2:
                nn.init.xavier_uniform_(param)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.
        
        Args:
            x: Input tensor of shape (batch_size, seq_len, num_features)
        
        Returns:
            Predictions of shape (batch_size, num_horizons)
        """
        batch_size = x.size(0)
        
        # Project input features
        x = self.input_proj(x)  # (B, T, hidden_size)
        
        # LSTM
        lstm_out, _ = self.lstm(x)  # (B, T, hidden_size * num_directions)
        
        # Layer norm
        lstm_out = self.layer_norm(lstm_out)
        
        # Attention mechanism: weight different timesteps
        attn_weights = self.attention(lstm_out)  # (B, T, 1)
        attn_weights = torch.softmax(attn_weights, dim=1)
        
        # Weighted sum over time
        context = torch.sum(lstm_out * attn_weights, dim=1)  # (B, hidden_size * num_directions)
        
        # Multi-horizon prediction
        output = self.output_head(context)  # (B, num_horizons)
        
        return output
    
    @classmethod
    def from_config(cls, config: Dict, num_features: int) -> 'LSTMForecaster':
        """Create model from configuration dictionary."""
        lstm_config = config.get('model', {}).get('lstm', {})
        return cls(
            num_features=num_features,
            hidden_size=lstm_config.get('hidden_size', 128),
            num_layers=lstm_config.get('num_layers', 2),
            dropout=lstm_config.get('dropout', 0.2),
            bidirectional=lstm_config.get('bidirectional', True),
            num_horizons=len(config.get('features', {}).get('target_horizons_steps', [6, 72, 144])),
        )

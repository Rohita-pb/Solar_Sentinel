"""
Transformer Model for ISRO PS14 Radiation Forecasting.

Informer-inspired Transformer with:
- Sinusoidal positional encoding
- Multi-head self-attention encoder
- Direct multi-horizon output decoder
- ProbSparse attention approximation (optional)

This is the PRIMARY model — expected to outperform LSTM especially
for longer forecast horizons (6h, 12h).
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Dict, Tuple

from src.utils.logger import get_logger

logger = get_logger(__name__)


class PositionalEncoding(nn.Module):
    """
    Sinusoidal positional encoding (Vaswani et al., 2017).
    
    Injects position information into the input embeddings so the
    Transformer can distinguish between different time steps.
    """
    
    def __init__(self, d_model: int, max_len: int = 500, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)
        
        self.register_buffer('pe', pe)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: Tensor of shape (batch_size, seq_len, d_model)
        
        Returns:
            Tensor with positional encoding added.
        """
        x = x + self.pe[:, :x.size(1)]
        return self.dropout(x)


class TransformerForecaster(nn.Module):
    """
    Transformer-based model for multi-horizon electron flux forecasting.
    
    Architecture:
    Input (seq_len, num_features)
    → Linear projection to d_model
    → Positional Encoding
    → Transformer Encoder (4 layers, 8 heads)
    → Global attention pooling
    → Multi-horizon output head
    
    Designed for RTX 5060 (~8GB VRAM) with mixed precision.
    """
    
    def __init__(
        self,
        num_features: int,
        d_model: int = 128,
        nhead: int = 8,
        num_encoder_layers: int = 4,
        dim_feedforward: int = 512,
        dropout: float = 0.1,
        num_horizons: int = 3,
        max_seq_len: int = 200,
        activation: str = 'gelu',
    ):
        """
        Args:
            num_features: Number of input features per timestep.
            d_model: Transformer model dimension.
            nhead: Number of attention heads.
            num_encoder_layers: Number of encoder layers.
            dim_feedforward: Feed-forward network dimension.
            dropout: Dropout rate.
            num_horizons: Number of forecast horizons (3: 30min, 6h, 12h).
            max_seq_len: Maximum sequence length.
            activation: Activation function ('gelu' or 'relu').
        """
        super().__init__()
        
        self.num_features = num_features
        self.d_model = d_model
        self.num_horizons = num_horizons
        
        # Input projection
        self.input_proj = nn.Sequential(
            nn.Linear(num_features, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        
        # Positional encoding
        self.pos_encoder = PositionalEncoding(d_model, max_seq_len, dropout)
        
        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            activation=activation,
            batch_first=True,
            norm_first=True,  # Pre-LN for better training stability
        )
        
        self.encoder = nn.TransformerEncoder(
            encoder_layer,
            num_layers=num_encoder_layers,
            norm=nn.LayerNorm(d_model),
        )
        
        # Global attention pooling (learned attention over sequence)
        self.global_attention = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.Tanh(),
            nn.Linear(d_model // 2, 1),
        )
        
        # Horizon-specific output heads (each horizon gets its own predictor)
        self.horizon_heads = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model // 2),
                nn.GELU(),
                nn.Dropout(dropout / 2),
                nn.Linear(d_model // 2, 1),
            )
            for _ in range(num_horizons)
        ])
        
        # Initialize weights
        self._init_weights()
        
        # Log model size
        total_params = sum(p.numel() for p in self.parameters())
        trainable_params = sum(p.numel() for p in self.parameters() if p.requires_grad)
        logger.info(
            f"Transformer model: {trainable_params:,} trainable params "
            f"(d_model={d_model}, heads={nhead}, layers={num_encoder_layers})"
        )
    
    def _init_weights(self):
        """Initialize weights with Xavier uniform."""
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.
        
        Args:
            x: Input tensor of shape (batch_size, seq_len, num_features)
        
        Returns:
            Predictions of shape (batch_size, num_horizons)
        """
        # Project input to d_model dimension
        x = self.input_proj(x)  # (B, T, d_model)
        
        # Add positional encoding
        x = self.pos_encoder(x)  # (B, T, d_model)
        
        # Transformer encoder
        encoded = self.encoder(x)  # (B, T, d_model)
        
        # Global attention pooling
        attn_weights = self.global_attention(encoded)  # (B, T, 1)
        attn_weights = F.softmax(attn_weights, dim=1)
        context = torch.sum(encoded * attn_weights, dim=1)  # (B, d_model)
        
        # Horizon-specific predictions
        outputs = []
        for head in self.horizon_heads:
            out = head(context)  # (B, 1)
            outputs.append(out)
        
        output = torch.cat(outputs, dim=1)  # (B, num_horizons)
        
        return output
    
    @classmethod
    def from_config(cls, config: Dict, num_features: int) -> 'TransformerForecaster':
        """Create model from configuration dictionary."""
        tf_config = config.get('model', {}).get('transformer', {})
        return cls(
            num_features=num_features,
            d_model=tf_config.get('d_model', 128),
            nhead=tf_config.get('nhead', 8),
            num_encoder_layers=tf_config.get('num_encoder_layers', 4),
            dim_feedforward=tf_config.get('dim_feedforward', 512),
            dropout=tf_config.get('dropout', 0.1),
            activation=tf_config.get('activation', 'gelu'),
            num_horizons=len(config.get('features', {}).get('target_horizons_steps', [6, 72, 144])),
        )


class EnsembleForecaster(nn.Module):
    """
    Ensemble model combining Transformer and LSTM predictions.
    
    Uses a learned weighting to combine outputs from both models,
    potentially capturing complementary strengths (LSTM for short-term,
    Transformer for long-term dependencies).
    """
    
    def __init__(
        self,
        transformer: TransformerForecaster,
        lstm: 'LSTMForecaster',
        num_horizons: int = 3,
    ):
        super().__init__()
        self.transformer = transformer
        self.lstm = lstm
        
        # Learned combination weights per horizon
        self.combination_weights = nn.Parameter(
            torch.ones(num_horizons, 2) * 0.5
        )
    
    def forward(
        self,
        x_transformer: torch.Tensor,
        x_lstm: torch.Tensor
    ) -> torch.Tensor:
        """
        Forward pass combining both models.
        
        Args:
            x_transformer: Input for transformer (longer sequence).
            x_lstm: Input for LSTM (shorter sequence).
        
        Returns:
            Weighted ensemble predictions.
        """
        pred_tf = self.transformer(x_transformer)  # (B, H)
        pred_lstm = self.lstm(x_lstm)  # (B, H)
        
        weights = F.softmax(self.combination_weights, dim=1)  # (H, 2)
        
        output = (
            weights[:, 0].unsqueeze(0) * pred_tf +
            weights[:, 1].unsqueeze(0) * pred_lstm
        )
        
        return output

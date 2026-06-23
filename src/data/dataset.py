"""
PyTorch Dataset and DataLoader for ISRO PS14 Radiation Forecasting.

Implements sliding window approach for time-series data with:
- Configurable lookback and forecast horizons
- Chronological train/val/test split (no data leakage)
- NaN-aware window skipping
- Efficient memory-mapped data loading
"""

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset, DataLoader
from typing import Optional, List, Tuple, Dict
from pathlib import Path

from src.utils.logger import get_logger
from src.utils.config import Config

logger = get_logger(__name__)


class FluxForecastDataset(Dataset):
    """
    PyTorch Dataset for multi-horizon electron flux forecasting.
    
    Creates sliding windows of (input_sequence, target_values) pairs where:
    - input_sequence: shape (seq_len, num_features)
    - target_values: shape (num_horizons,) — log10 flux at each forecast horizon
    
    Automatically skips windows containing too many NaN values.
    """
    
    def __init__(
        self,
        data: np.ndarray,
        timestamps: np.ndarray,
        feature_names: List[str],
        seq_len: int = 144,
        target_horizons: List[int] = None,
        target_col_idx: int = 0,
        min_valid_fraction: float = 0.8,
    ):
        """
        Args:
            data: 2D array of shape (n_timesteps, n_features), already normalized.
            timestamps: 1D array of datetime values.
            feature_names: Names of feature columns.
            seq_len: Number of lookback timesteps (e.g., 144 = 12h at 5-min).
            target_horizons: List of forecast steps ahead (e.g., [6, 72, 144] for 30min, 6h, 12h).
            target_col_idx: Index of the target column (log10_flux) in data.
            min_valid_fraction: Minimum fraction of valid (non-NaN) values in window.
        """
        super().__init__()
        
        self.data = data.astype(np.float32)
        self.timestamps = timestamps
        self.feature_names = feature_names
        self.seq_len = seq_len
        self.target_horizons = target_horizons or [6, 72, 144]
        self.target_col_idx = target_col_idx
        self.min_valid_fraction = min_valid_fraction
        
        # Maximum horizon determines how far ahead we need data
        self.max_horizon = max(self.target_horizons)
        
        # Precompute valid window indices (skip windows with too many NaNs)
        self.valid_indices = self._compute_valid_indices()
        
        logger.info(
            f"Dataset created: {len(self.valid_indices)} valid windows "
            f"out of {len(data) - seq_len - self.max_horizon} possible "
            f"(seq_len={seq_len}, horizons={target_horizons})"
        )
    
    def _compute_valid_indices(self) -> np.ndarray:
        """Find all starting indices where both input and target are sufficiently valid."""
        n = len(self.data)
        max_start = n - self.seq_len - self.max_horizon
        
        if max_start <= 0:
            logger.warning("Dataset too short for the given sequence length and horizons")
            return np.array([], dtype=np.int64)
        
        valid = []
        
        # Pre-compute NaN mask for the target column
        target_valid = ~np.isnan(self.data[:, self.target_col_idx])
        
        for i in range(max_start):
            # Check input window has enough valid values
            input_window = self.data[i:i + self.seq_len]
            input_valid_frac = np.mean(~np.isnan(input_window))
            
            if input_valid_frac < self.min_valid_fraction:
                continue
            
            # Check all target values exist
            targets_valid = True
            for h in self.target_horizons:
                target_idx = i + self.seq_len + h - 1
                if target_idx >= n or not target_valid[target_idx]:
                    targets_valid = False
                    break
            
            if targets_valid:
                valid.append(i)
        
        return np.array(valid, dtype=np.int64)
    
    def __len__(self) -> int:
        return len(self.valid_indices)
    
    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Get a single (input, target) pair.
        
        Returns:
            X: Tensor of shape (seq_len, num_features)
            Y: Tensor of shape (num_horizons,) — log10 flux at each horizon
        """
        start = self.valid_indices[idx]
        
        # Input sequence
        X = self.data[start:start + self.seq_len].copy()
        
        # Replace any remaining NaNs with 0 (column mean in normalized space)
        X = np.nan_to_num(X, nan=0.0)
        
        # Target values at each horizon
        Y = np.array([
            self.data[start + self.seq_len + h - 1, self.target_col_idx]
            for h in self.target_horizons
        ], dtype=np.float32)
        
        return torch.from_numpy(X), torch.from_numpy(Y)
    
    def get_timestamp(self, idx: int) -> np.datetime64:
        """Get the timestamp of the prediction point for a given index."""
        start = self.valid_indices[idx]
        return self.timestamps[start + self.seq_len]


def create_dataloaders(
    df: pd.DataFrame,
    feature_columns: List[str],
    config: Optional[Config] = None,
    model_type: str = 'transformer'
) -> Tuple[DataLoader, DataLoader, DataLoader, Dict]:
    """
    Create train, validation, and test DataLoaders from processed DataFrame.
    
    Uses chronological split to prevent data leakage.
    
    Args:
        df: Processed DataFrame with datetime index and all features.
        feature_columns: List of feature column names to use.
        config: Configuration object.
        model_type: 'transformer' or 'lstm' (affects sequence length).
    
    Returns:
        Tuple of (train_loader, val_loader, test_loader, metadata_dict)
    """
    config = config or Config()
    
    # Get parameters
    if model_type == 'transformer':
        seq_len = config.features.get('lookback_steps', 144)
    else:
        seq_len = config.features.get('lookback_steps_lstm', 72)
    
    target_horizons = config.features.get('target_horizons_steps', [6, 72, 144])
    batch_size = config.training.get('batch_size', 256)
    split = config.training.get('split', {})
    
    train_years = split.get('train_years', [2011, 2018])
    val_years = split.get('val_years', [2019, 2020])
    test_years = split.get('test_years', [2021, 2021])
    
    # Filter to available columns
    available_cols = [c for c in feature_columns if c in df.columns]
    if not available_cols:
        raise ValueError(f"No feature columns found in DataFrame. "
                        f"Expected: {feature_columns[:5]}... "
                        f"Available: {list(df.columns)[:10]}...")
    
    logger.info(f"Using {len(available_cols)} features for {model_type} model")
    
    # Find target column index
    if 'log10_flux' in available_cols:
        target_col_idx = available_cols.index('log10_flux')
    else:
        raise ValueError("'log10_flux' must be in feature columns")
    
    # Convert to numpy
    data = df[available_cols].values.astype(np.float32)
    timestamps = df.index.values
    # Chronological percentage split (70% train, 15% val, 15% test)
    n_total = len(data)
    n_train = int(n_total * 0.7)
    n_val = int(n_total * 0.15)
    
    train_mask = np.zeros(n_total, dtype=bool)
    val_mask = np.zeros(n_total, dtype=bool)
    test_mask = np.zeros(n_total, dtype=bool)
    
    train_mask[:n_train] = True
    val_mask[n_train:n_train+n_val] = True
    test_mask[n_train+n_val:] = True
    
    logger.info(f"Data split:")
    logger.info(f"  Train: {train_mask.sum()} samples")
    logger.info(f"  Val:   {val_mask.sum()} samples")
    logger.info(f"  Test:  {test_mask.sum()} samples")
    
    # Create datasets
    min_valid = config.preprocessing.get('gap_handling', {}).get('min_valid_fraction', 0.8)
    
    train_dataset = FluxForecastDataset(
        data[train_mask], timestamps[train_mask], available_cols,
        seq_len=seq_len, target_horizons=target_horizons,
        target_col_idx=target_col_idx, min_valid_fraction=min_valid
    )
    
    val_dataset = FluxForecastDataset(
        data[val_mask], timestamps[val_mask], available_cols,
        seq_len=seq_len, target_horizons=target_horizons,
        target_col_idx=target_col_idx, min_valid_fraction=min_valid
    )
    
    test_dataset = FluxForecastDataset(
        data[test_mask], timestamps[test_mask], available_cols,
        seq_len=seq_len, target_horizons=target_horizons,
        target_col_idx=target_col_idx, min_valid_fraction=min_valid
    )
    
    # Create DataLoaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=0,  # Windows compatibility
        pin_memory=True,
        drop_last=True
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=True
    )
    
    test_loader = DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=True
    )
    
    metadata = {
        'feature_columns': available_cols,
        'target_col_idx': target_col_idx,
        'seq_len': seq_len,
        'target_horizons': target_horizons,
        'num_features': len(available_cols),
        'train_size': len(train_dataset),
        'val_size': len(val_dataset),
        'test_size': len(test_dataset),
    }
    
    logger.info(f"DataLoaders created:")
    logger.info(f"  Train: {len(train_dataset)} windows, {len(train_loader)} batches")
    logger.info(f"  Val:   {len(val_dataset)} windows, {len(val_loader)} batches")
    logger.info(f"  Test:  {len(test_dataset)} windows, {len(test_loader)} batches")
    
    return train_loader, val_loader, test_loader, metadata

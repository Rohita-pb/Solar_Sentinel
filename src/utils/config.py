"""
Configuration loader for ISRO PS14 Radiation Forecasting project.
Reads config.yaml and provides typed access to all settings.
"""

import os
import yaml
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


def find_project_root() -> Path:
    """Find project root by looking for config.yaml."""
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        if (parent / "config.yaml").exists():
            return parent
    # Fallback: assume standard layout
    return Path(__file__).resolve().parents[2]


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML file.
    
    Args:
        config_path: Path to config.yaml. If None, auto-discovers from project root.
    
    Returns:
        Dictionary with all configuration values.
    """
    if config_path is None:
        root = find_project_root()
        config_path = root / "config.yaml"
    else:
        config_path = Path(config_path)
    
    if not config_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    # Resolve relative paths to absolute
    root = config_path.parent
    for key in ['raw_dir', 'processed_dir', 'cache_file']:
        if key in config.get('data', {}):
            path = config['data'][key]
            if not os.path.isabs(path):
                config['data'][key] = str(root / path)
    
    for key in ['checkpoint_dir', 'best_model_path']:
        if key in config.get('training', {}):
            path = config['training'][key]
            if not os.path.isabs(path):
                config['training'][key] = str(root / path)
    
    return config


class Config:
    """
    Typed configuration wrapper with dot-access.
    
    Usage:
        cfg = Config()
        print(cfg.data['start_year'])
        print(cfg.model['transformer']['d_model'])
    """
    
    def __init__(self, config_path: Optional[str] = None):
        self._config = load_config(config_path)
        self._root = find_project_root()
    
    @property
    def root(self) -> Path:
        return self._root
    
    @property
    def data(self) -> Dict[str, Any]:
        return self._config.get('data', {})
    
    @property
    def preprocessing(self) -> Dict[str, Any]:
        return self._config.get('preprocessing', {})
    
    @property
    def features(self) -> Dict[str, Any]:
        return self._config.get('features', {})
    
    @property
    def model(self) -> Dict[str, Any]:
        return self._config.get('model', {})
    
    @property
    def training(self) -> Dict[str, Any]:
        return self._config.get('training', {})
    
    @property
    def evaluation(self) -> Dict[str, Any]:
        return self._config.get('evaluation', {})
    
    @property
    def dashboard(self) -> Dict[str, Any]:
        return self._config.get('dashboard', {})
    
    def get(self, *keys, default=None):
        """Nested key access: cfg.get('model', 'transformer', 'd_model')"""
        value = self._config
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value
    
    def ensure_dirs(self):
        """Create all required directories."""
        dirs_to_create = [
            self.data.get('raw_dir', 'data/raw'),
            self.data.get('processed_dir', 'data/processed'),
            self.training.get('checkpoint_dir', 'models/checkpoints'),
            str(self._root / 'outputs'),
            str(self._root / 'outputs' / 'plots'),
            str(self._root / 'outputs' / 'predictions'),
            str(self._root / 'data' / 'raw' / 'goes'),
            str(self._root / 'data' / 'raw' / 'wind_swe'),
            str(self._root / 'data' / 'raw' / 'wind_mfi'),
            str(self._root / 'data' / 'raw' / 'omniweb'),
            str(self._root / 'data' / 'raw' / 'grasp'),
        ]
        for d in dirs_to_create:
            os.makedirs(d, exist_ok=True)

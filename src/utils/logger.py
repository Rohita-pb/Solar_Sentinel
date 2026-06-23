"""
Logging setup for ISRO PS14 Radiation Forecasting project.
Provides consistent, colored logging across all modules.
"""

import logging
import sys
from pathlib import Path
from datetime import datetime


def setup_logger(
    name: str = "isro_ps14",
    level: int = logging.INFO,
    log_file: str = None,
    console: bool = True
) -> logging.Logger:
    """
    Create a configured logger with console and optional file output.
    
    Args:
        name: Logger name (usually module name).
        level: Logging level (DEBUG, INFO, WARNING, ERROR).
        log_file: Optional path to log file.
        console: Whether to output to console.
    
    Returns:
        Configured logging.Logger instance.
    """
    logger = logging.getLogger(name)
    
    # Avoid adding duplicate handlers
    if logger.handlers:
        return logger
    
    logger.setLevel(level)
    
    # Formatter
    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Console handler
    if console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(fmt)
        logger.addHandler(console_handler)
    
    # File handler
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(str(log_path), encoding='utf-8')
        file_handler.setLevel(level)
        file_handler.setFormatter(fmt)
        logger.addHandler(file_handler)
    
    return logger


def get_logger(name: str = None) -> logging.Logger:
    """
    Get an existing logger or create a new one.
    
    Args:
        name: Logger name. If None, returns root project logger.
    
    Returns:
        logging.Logger instance.
    """
    if name is None:
        name = "isro_ps14"
    
    logger = logging.getLogger(name)
    
    # If no handlers, set up with defaults
    if not logger.handlers:
        return setup_logger(name)
    
    return logger

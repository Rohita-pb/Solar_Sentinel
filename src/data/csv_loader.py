"""
CSV Data Loader for ISRO PS14 Radiation Forecasting.

Reads raw CSV files (GOES electron flux + OMNI solar wind) from the raw/ directory
and produces DataFrames compatible with the existing preprocessor merge pipeline.

This is an alternative ingestion path when CDF files are not available.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Column mappings: CSV column name → pipeline expected column name
OMNI_COLUMN_MAP = {
    'flow_speed': 'Vsw',
    'proton_density': 'Np',
    'BZ_GSM': 'Bz_GSM',
    'Pressure': 'Pdyn',
    'E': 'Ey',
    'SYM_H': 'SYM_H',
    'AE_INDEX': 'AE',
}


def load_goes_csv(raw_dir: str | Path) -> pd.DataFrame:
    """
    Load all GOES electron flux CSV files from the raw directory.
    
    Expected CSV format:
        time,flux
        2017-01-01 00:00:00,24.425913
    
    Returns:
        DataFrame with DatetimeIndex and 'electron_flux_gt2MeV' column.
    """
    raw_dir = Path(raw_dir)
    csv_files = sorted(raw_dir.glob('goes_*.csv'))
    
    if not csv_files:
        logger.warning(f"No GOES CSV files found in {raw_dir}")
        return pd.DataFrame()
    
    logger.info(f"Loading {len(csv_files)} GOES CSV files from {raw_dir}...")
    
    dfs = []
    for f in csv_files:
        try:
            df = pd.read_csv(f, parse_dates=['time'], index_col='time')
            df = df.rename(columns={'flux': 'electron_flux_gt2MeV'})
            dfs.append(df)
        except Exception as e:
            logger.warning(f"  Failed to read {f.name}: {e}")
    
    if not dfs:
        return pd.DataFrame()
    
    combined = pd.concat(dfs).sort_index()
    combined = combined[~combined.index.duplicated(keep='last')]
    combined.index.name = 'datetime'
    
    logger.info(f"  GOES: {len(combined)} records, "
                f"{combined['electron_flux_gt2MeV'].notna().sum()} valid, "
                f"range: {combined.index[0]} to {combined.index[-1]}")
    
    return combined


def load_omni_csv(raw_dir: str | Path) -> pd.DataFrame:
    """
    Load all OMNI solar wind CSV files from the raw directory.
    
    Expected CSV format:
        time,flow_speed,proton_density,BZ_GSM,Pressure,E,SYM_H,AE_INDEX
        2017-01-01 00:00:00,546.5,7.42,-3.82,4.44,2.11,-18.0,83.0
    
    Returns:
        DataFrame with DatetimeIndex and renamed columns matching the pipeline.
    """
    raw_dir = Path(raw_dir)
    csv_files = sorted(raw_dir.glob('omni_*.csv'))
    
    if not csv_files:
        logger.warning(f"No OMNI CSV files found in {raw_dir}")
        return pd.DataFrame()
    
    logger.info(f"Loading {len(csv_files)} OMNI CSV files from {raw_dir}...")
    
    dfs = []
    for f in csv_files:
        try:
            df = pd.read_csv(f, parse_dates=['time'], index_col='time')
            df = df.rename(columns=OMNI_COLUMN_MAP)
            dfs.append(df)
        except Exception as e:
            logger.warning(f"  Failed to read {f.name}: {e}")
    
    if not dfs:
        return pd.DataFrame()
    
    combined = pd.concat(dfs).sort_index()
    combined = combined[~combined.index.duplicated(keep='last')]
    combined.index.name = 'datetime'
    
    logger.info(f"  OMNI: {len(combined)} records, "
                f"range: {combined.index[0]} to {combined.index[-1]}")
    logger.info(f"  Columns: {list(combined.columns)}")
    
    return combined


def load_all_csv_data(raw_dir: str | Path) -> Dict[str, pd.DataFrame]:
    """
    Load all CSV data and return in the format expected by the preprocessor.
    
    Returns:
        Dictionary with keys 'goes' and 'omniweb' containing DataFrames.
    """
    raw_dir = Path(raw_dir)
    data = {}
    
    goes_df = load_goes_csv(raw_dir)
    if not goes_df.empty:
        data['goes'] = goes_df
    
    omni_df = load_omni_csv(raw_dir)
    if not omni_df.empty:
        data['omniweb'] = omni_df
    
    return data

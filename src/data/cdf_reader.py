"""
CDF File Reader for ISRO PS14 Radiation Forecasting.

Reads Common Data Format (CDF) files from GOES, Wind, and GRASP missions
using the pure-Python cdflib library. Handles epoch conversion, fill value
replacement, and batch directory reading.
"""

import os
import numpy as np
import pandas as pd
from pathlib import Path
from typing import List, Dict, Optional, Union, Tuple
from datetime import datetime

import cdflib

from src.utils.logger import get_logger

logger = get_logger(__name__)


class CDFReader:
    """
    Universal CDF file reader for space weather data.
    
    Handles:
    - GOES Energetic Particle Sensor (EPS) data
    - Wind Solar Wind Experiment (SWE) data
    - Wind Magnetic Field Investigation (MFI) data
    - GRASP/GSAT electron flux data
    - OMNIWeb data in CDF format
    """
    
    @staticmethod
    def read_cdf(filepath: str, variables: Optional[List[str]] = None) -> Dict[str, np.ndarray]:
        """
        Read a single CDF file and extract specified variables.
        
        Args:
            filepath: Path to the CDF file.
            variables: List of variable names to extract. If None, reads all zVariables.
        
        Returns:
            Dictionary mapping variable names to numpy arrays.
        """
        filepath = str(filepath)
        
        try:
            cdf = cdflib.CDF(filepath)
            info = cdf.cdf_info()
            
            available_vars = info.zVariables if hasattr(info, 'zVariables') else info.get('zVariables', [])
            
            if variables is None:
                variables = available_vars
            
            data = {}
            for var in variables:
                if var in available_vars:
                    try:
                        raw = cdf.varget(var)
                        
                        # Replace fill values with NaN
                        try:
                            attrs = cdf.varattsget(var)
                            fillval = attrs.get('FILLVAL', None)
                            if fillval is not None:
                                if isinstance(fillval, (list, np.ndarray)):
                                    fillval = fillval[0] if len(fillval) > 0 else None
                                if fillval is not None and np.isfinite(float(fillval)):
                                    raw = raw.astype(np.float64)
                                    raw[raw == float(fillval)] = np.nan
                                elif fillval is not None:
                                    raw = raw.astype(np.float64)
                                    raw[~np.isfinite(raw)] = np.nan
                        except Exception:
                            # If we can't get fill values, just replace obvious invalids
                            if raw.dtype in [np.float32, np.float64]:
                                raw = raw.astype(np.float64)
                                raw[np.abs(raw) > 1e30] = np.nan
                        
                        data[var] = raw
                    except Exception as e:
                        logger.warning(f"Could not read variable '{var}' from {filepath}: {e}")
                else:
                    logger.debug(f"Variable '{var}' not found in {filepath}. Available: {available_vars}")
            
            return data
            
        except Exception as e:
            logger.error(f"Failed to read CDF file {filepath}: {e}")
            return {}
    
    @staticmethod
    def convert_epoch(epoch_data: np.ndarray) -> np.ndarray:
        """
        Convert CDF epoch values to numpy datetime64.
        
        Handles CDF_EPOCH (milliseconds since 0000-01-01),
        CDF_EPOCH16, and CDF_TT2000 (nanoseconds since 2000-01-01).
        
        Args:
            epoch_data: Raw epoch array from CDF file.
        
        Returns:
            Array of numpy datetime64 values.
        """
        try:
            # Try cdflib's built-in epoch conversion
            if epoch_data.dtype == np.complex128:
                # CDF_EPOCH16
                times = cdflib.cdfepoch.to_datetime(epoch_data)
            elif epoch_data.dtype == np.int64:
                # TT2000
                times = cdflib.cdfepoch.to_datetime(epoch_data)
            else:
                # Standard CDF_EPOCH (float64, milliseconds)
                times = cdflib.cdfepoch.to_datetime(epoch_data)
            
            # Convert to numpy datetime64
            if isinstance(times, list):
                return np.array(times, dtype='datetime64[ns]')
            elif isinstance(times, np.ndarray):
                if times.dtype == object:
                    return np.array([np.datetime64(t) for t in times], dtype='datetime64[ns]')
                return times.astype('datetime64[ns]')
            else:
                return np.array([np.datetime64(t) for t in times], dtype='datetime64[ns]')
                
        except Exception as e:
            logger.error(f"Epoch conversion failed: {e}")
            # Fallback: try manual conversion for CDF_EPOCH
            try:
                # CDF_EPOCH: milliseconds since 0000-01-01 00:00:00
                # Convert to milliseconds since 1970-01-01
                epoch_1970_ms = 62167219200000.0  # ms between 0000-01-01 and 1970-01-01
                unix_ms = epoch_data - epoch_1970_ms
                return (unix_ms * 1e6).astype('datetime64[ns]')
            except Exception as e2:
                logger.error(f"Fallback epoch conversion also failed: {e2}")
                raise
    
    @staticmethod
    def inspect_cdf(filepath: str) -> Dict:
        """
        Inspect a CDF file and return its structure.
        
        Args:
            filepath: Path to the CDF file.
        
        Returns:
            Dictionary with file info including variables, shapes, and attributes.
        """
        cdf = cdflib.CDF(str(filepath))
        info = cdf.cdf_info()
        
        result = {
            'filepath': filepath,
            'zVariables': [],
            'global_attributes': {}
        }
        
        available_vars = info.zVariables if hasattr(info, 'zVariables') else info.get('zVariables', [])
        
        for var in available_vars:
            try:
                data = cdf.varget(var)
                attrs = cdf.varattsget(var)
                result['zVariables'].append({
                    'name': var,
                    'shape': data.shape,
                    'dtype': str(data.dtype),
                    'units': attrs.get('UNITS', 'unknown'),
                    'description': attrs.get('CATDESC', attrs.get('FIELDNAM', 'N/A')),
                })
            except Exception:
                result['zVariables'].append({'name': var, 'error': 'Could not read'})
        
        try:
            result['global_attributes'] = cdf.globalattsget()
        except Exception:
            pass
        
        return result
    
    @classmethod
    def read_goes_flux(cls, filepath: str) -> pd.DataFrame:
        """
        Read GOES electron flux data from a CDF file.
        
        Extracts >2 MeV integral electron flux and epoch time.
        
        Args:
            filepath: Path to GOES EPS CDF file.
        
        Returns:
            DataFrame with datetime index and 'electron_flux_gt2MeV' column.
        """
        # Try multiple possible variable names for different GOES versions
        epoch_names = ['Epoch', 'EPOCH', 'epoch']
        flux_names = ['E2', 'E_2', 'E>2', 'electron_flux_gt2MeV', 'E2W',
                       'AvgDiffElectronFlux', 'E_Integral']
        proton_names = ['P5', 'P_5', 'P>10', 'proton_flux_gt10MeV']
        
        data = cls.read_cdf(filepath)
        
        if not data:
            return pd.DataFrame()
        
        # Find epoch variable
        epoch_var = None
        for name in epoch_names:
            if name in data:
                epoch_var = name
                break
        
        if epoch_var is None:
            logger.warning(f"No epoch variable found in {filepath}")
            return pd.DataFrame()
        
        # Convert epoch
        times = cls.convert_epoch(data[epoch_var])
        
        # Find flux variable
        result = pd.DataFrame(index=pd.DatetimeIndex(times, name='datetime'))
        
        for name in flux_names:
            if name in data:
                flux = data[name].astype(np.float64).flatten()
                if len(flux) == len(times):
                    result['electron_flux_gt2MeV'] = flux
                    logger.debug(f"Found electron flux variable: {name}")
                    break
        
        for name in proton_names:
            if name in data:
                proton = data[name].astype(np.float64).flatten()
                if len(proton) == len(times):
                    result['proton_flux_gt10MeV'] = proton
                    break
        
        # Remove invalid/negative flux values
        if 'electron_flux_gt2MeV' in result.columns:
            result.loc[result['electron_flux_gt2MeV'] <= 0, 'electron_flux_gt2MeV'] = np.nan
        
        return result
    
    @classmethod
    def read_wind_swe(cls, filepath: str) -> pd.DataFrame:
        """
        Read Wind SWE (Solar Wind Experiment) data.
        
        Extracts solar wind speed (Vp) and proton density (Np).
        
        Args:
            filepath: Path to Wind SWE CDF file.
        
        Returns:
            DataFrame with datetime index and solar wind columns.
        """
        data = cls.read_cdf(filepath)
        
        if not data:
            return pd.DataFrame()
        
        # Find epoch
        epoch_var = None
        for name in ['Epoch', 'EPOCH', 'epoch']:
            if name in data:
                epoch_var = name
                break
        
        if epoch_var is None:
            return pd.DataFrame()
        
        times = cls.convert_epoch(data[epoch_var])
        result = pd.DataFrame(index=pd.DatetimeIndex(times, name='datetime'))
        
        # Solar wind speed - may be scalar or 3-component vector (V_GSE)
        for name in ['V_GSE', 'Vp', 'V_sw', 'SW_V']:
            if name in data:
                v = data[name].astype(np.float64)
                if v.ndim == 2 and v.shape[1] >= 3:
                    # V_GSE is [Vx, Vy, Vz] - speed magnitude
                    result['Vsw'] = np.sqrt(v[:, 0]**2 + v[:, 1]**2 + v[:, 2]**2)
                    result['Vx_GSE'] = v[:, 0]
                elif v.ndim == 1:
                    result['Vsw'] = np.abs(v)
                break
        
        # Proton density
        for name in ['Np', 'N_p', 'proton_density', 'SW_N']:
            if name in data:
                np_data = data[name].astype(np.float64).flatten()
                if len(np_data) == len(times):
                    result['Np'] = np_data
                    break
        
        # Thermal speed / temperature (bonus feature)
        for name in ['V_th', 'Vth', 'THERMAL_SPD']:
            if name in data:
                vth = data[name].astype(np.float64).flatten()
                if len(vth) == len(times):
                    result['Vth'] = vth
                    break
        
        # Remove invalid values
        for col in result.columns:
            result.loc[result[col] <= 0, col] = np.nan
            result.loc[result[col] > 1e6, col] = np.nan
        
        return result
    
    @classmethod
    def read_wind_mfi(cls, filepath: str) -> pd.DataFrame:
        """
        Read Wind MFI (Magnetic Field Investigation) data.
        
        Extracts IMF components (Bx, By, Bz) and magnitude.
        
        Args:
            filepath: Path to Wind MFI CDF file.
        
        Returns:
            DataFrame with datetime index and magnetic field columns.
        """
        data = cls.read_cdf(filepath)
        
        if not data:
            return pd.DataFrame()
        
        # Find epoch
        epoch_var = None
        for name in ['Epoch', 'EPOCH', 'Epoch3']:
            if name in data:
                epoch_var = name
                break
        
        if epoch_var is None:
            return pd.DataFrame()
        
        times = cls.convert_epoch(data[epoch_var])
        result = pd.DataFrame(index=pd.DatetimeIndex(times, name='datetime'))
        
        # Magnetic field components in GSE
        for name in ['BGSE', 'B3GSE', 'BF1']:
            if name in data:
                b = data[name].astype(np.float64)
                if b.ndim == 2 and b.shape[1] >= 3:
                    result['Bx_GSE'] = b[:, 0]
                    result['By_GSE'] = b[:, 1]
                    result['Bz_GSE'] = b[:, 2]
                    result['Bt'] = np.sqrt(b[:, 0]**2 + b[:, 1]**2 + b[:, 2]**2)
                    break
        
        # If total field magnitude is available separately
        for name in ['B1F1', 'Bmag', 'BF1']:
            if name in data and 'Bt' not in result.columns:
                bt = data[name].astype(np.float64).flatten()
                if len(bt) == len(times):
                    result['Bt'] = bt
                    break
        
        # Remove invalid values (>1000 nT is clearly wrong for IMF)
        for col in result.columns:
            result.loc[np.abs(result[col]) > 500, col] = np.nan
        
        return result
    
    @classmethod
    def read_grasp(cls, filepath: str) -> pd.DataFrame:
        """
        Read GRASP/GSAT-19 electron flux data.
        
        Handles both CDF and CSV formats.
        
        Args:
            filepath: Path to GRASP data file.
        
        Returns:
            DataFrame with datetime index and electron flux columns.
        """
        filepath = str(filepath)
        
        if filepath.lower().endswith('.csv'):
            # CSV format
            df = pd.read_csv(filepath, parse_dates=['datetime'], index_col='datetime')
            return df
        path = Path(filepath)
        
        if path.suffix.lower() in ['.csv', '.txt']:
            # Handle PRADAN .txt format or CSV
            if 'pradan' in path.name.lower() or path.suffix.lower() == '.txt':
                # Parse ISRO PRADAN TXT format
                # e.g. grasp_5_min_avg_1-APR-2018.txt
                # Columns: Time-Day of Year 	 Electron flux 	 Proton flux
                df = pd.read_csv(filepath, sep=r'\s+', skiprows=1, 
                                 names=['doy', 'grasp_electron_flux', 'grasp_proton_flux'],
                                 usecols=['doy', 'grasp_electron_flux', 'grasp_proton_flux'])
                
                # Extract year from filename
                year_str = path.stem.split('-')[-1]
                year = int(year_str)
                
                # Convert DOY to datetime
                start_of_year = pd.Timestamp(f'{year}-01-01')
                # DOY is 1-indexed, so we subtract 1 day to add it to start_of_year
                td = pd.to_timedelta(df['doy'] - 1, unit='D')
                df.index = start_of_year + td
                df.index.name = 'datetime'
                df.drop(columns=['doy'], inplace=True)
                return df
            else:
                # Standard CSV format
                return pd.read_csv(filepath, parse_dates=['datetime'], index_col='datetime')
        
        elif path.suffix.lower() == '.cdf':
            # CDF format - variable names may vary
            data = cls.read_cdf(filepath)
            
            if not data:
                return pd.DataFrame()
            
            # Find epoch
            epoch_var = None
            for name in ['Epoch', 'EPOCH', 'Time', 'TIME']:
                if name in data:
                    epoch_var = name
                    break
            
            if epoch_var is None:
                return pd.DataFrame()
            
            times = cls.convert_epoch(data[epoch_var])
            result = pd.DataFrame(index=pd.DatetimeIndex(times, name='datetime'))
            
            # Try to find electron flux variable
            for name in data.keys():
                if name == epoch_var:
                    continue
                name_lower = name.lower()
                if 'electron' in name_lower or 'flux' in name_lower or 'e_flux' in name_lower:
                    flux = data[name].astype(np.float64).flatten()
                    if len(flux) == len(times):
                        result['grasp_electron_flux'] = flux
                        break
            
            # If no obvious flux variable, take the first non-epoch variable
            if 'grasp_electron_flux' not in result.columns:
                for name, arr in data.items():
                    if name != epoch_var:
                        arr = arr.astype(np.float64)
                        if arr.ndim == 1 and len(arr) == len(times):
                            result['grasp_electron_flux'] = arr
                            break
            
            return result
        
        else:
            logger.error(f"Unsupported file format: {filepath}")
            return pd.DataFrame()
    
    @classmethod
    def batch_read_directory(
        cls,
        directory: str,
        reader_func: str = 'goes',
        file_pattern: str = '*.cdf'
    ) -> pd.DataFrame:
        """
        Read all CDF files in a directory and concatenate.
        
        Args:
            directory: Path to directory containing CDF files.
            reader_func: Which reader to use ('goes', 'wind_swe', 'wind_mfi', 'grasp').
            file_pattern: Glob pattern for files.
        
        Returns:
            Concatenated DataFrame sorted by datetime index.
        """
        directory = Path(directory)
        
        if not directory.exists():
            logger.warning(f"Directory does not exist: {directory}")
            return pd.DataFrame()
        
        files = sorted(directory.glob(file_pattern))
        
        if not files:
            logger.warning(f"No files matching '{file_pattern}' in {directory}")
            return pd.DataFrame()
        
        logger.info(f"Reading {len(files)} CDF files from {directory}")
        
        reader_map = {
            'goes': cls.read_goes_flux,
            'wind_swe': cls.read_wind_swe,
            'wind_mfi': cls.read_wind_mfi,
            'grasp': cls.read_grasp,
        }
        
        reader = reader_map.get(reader_func)
        if reader is None:
            raise ValueError(f"Unknown reader: {reader_func}. Choose from {list(reader_map.keys())}")
        
        dfs = []
        for i, f in enumerate(files):
            try:
                df = reader(str(f))
                if not df.empty:
                    dfs.append(df)
                if (i + 1) % 50 == 0:
                    logger.info(f"  Read {i + 1}/{len(files)} files...")
            except Exception as e:
                logger.warning(f"  Failed to read {f.name}: {e}")
        
        if not dfs:
            logger.warning("No data read from any file")
            return pd.DataFrame()
        
        result = pd.concat(dfs, axis=0)
        result = result[~result.index.duplicated(keep='first')]
        result = result.sort_index()
        
        logger.info(
            f"Read {len(result)} records from {len(dfs)} files. "
            f"Range: {result.index[0]} to {result.index[-1]}"
        )
        
        return result

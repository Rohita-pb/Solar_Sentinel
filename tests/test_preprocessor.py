"""Tests for preprocessing pipeline."""

import sys
import numpy as np
import pandas as pd
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.data.preprocessor import DataPreprocessor
from src.utils.config import Config


class TestSpikeRemoval:
    """Test spike removal functionality."""
    
    def setup_method(self):
        self.preprocessor = DataPreprocessor.__new__(DataPreprocessor)
        self.preprocessor.preprocessing = {
            'spike_removal': {'sigma_threshold': 3.0, 'window_hours': 6},
            'spe_filter': {'proton_threshold_pfu': 10, 'exclusion_hours_before': 2, 'exclusion_hours_after': 24},
            'gap_handling': {'max_linear_interp_hours': 2, 'max_spline_interp_hours': 6},
            'propagation': {'l1_distance_Re': 235.0, 'default_vsw_kms': 400.0},
        }
    
    def test_spike_removal_removes_outliers(self):
        """Verify that spikes are replaced with NaN."""
        np.random.seed(42)
        n = 1000
        times = pd.date_range('2020-01-01', periods=n, freq='5min')
        
        # Normal flux data with one spike
        flux = np.random.lognormal(mean=4, sigma=0.5, size=n)
        flux[500] = 1e8  # Spike
        
        df = pd.DataFrame({'electron_flux_gt2MeV': flux}, index=times)
        result = self.preprocessor.remove_spikes(df)
        
        assert pd.isna(result.loc[times[500], 'electron_flux_gt2MeV'])
    
    def test_spike_removal_preserves_valid_data(self):
        """Verify valid data is not removed."""
        np.random.seed(42)
        n = 500
        times = pd.date_range('2020-01-01', periods=n, freq='5min')
        flux = np.full(n, 1000.0)  # Constant flux, no spikes
        
        df = pd.DataFrame({'electron_flux_gt2MeV': flux}, index=times)
        result = self.preprocessor.remove_spikes(df)
        
        valid_count = result['electron_flux_gt2MeV'].notna().sum()
        assert valid_count == n  # All should be preserved


class TestGapInterpolation:
    """Test gap interpolation."""
    
    def setup_method(self):
        self.preprocessor = DataPreprocessor.__new__(DataPreprocessor)
        self.preprocessor.preprocessing = {
            'gap_handling': {
                'max_linear_interp_hours': 2,
                'max_spline_interp_hours': 6,
            }
        }
    
    def test_short_gap_filled(self):
        """Gaps shorter than max_linear_hours should be filled."""
        times = pd.date_range('2020-01-01', periods=100, freq='5min')
        values = np.ones(100) * 5.0
        values[10:15] = np.nan  # 25-minute gap (< 2 hours)
        
        df = pd.DataFrame({'test': values}, index=times)
        result = self.preprocessor.interpolate_gaps(df, columns=['test'])
        
        assert result['test'].isna().sum() < 5  # Most should be filled
    
    def test_long_gap_not_filled(self):
        """Gaps longer than max_spline_hours should remain NaN."""
        times = pd.date_range('2020-01-01', periods=500, freq='5min')
        values = np.ones(500) * 5.0
        values[100:250] = np.nan  # ~12.5 hour gap (> 6 hours)
        
        df = pd.DataFrame({'test': values}, index=times)
        result = self.preprocessor.interpolate_gaps(df, columns=['test'])
        
        # The long gap should still have NaN values
        assert result['test'].isna().sum() > 0


class TestResampling:
    """Test time resampling."""
    
    def setup_method(self):
        self.preprocessor = DataPreprocessor.__new__(DataPreprocessor)
        self.preprocessor.config = type('obj', (object,), {'data': {'resolution_minutes': 5}})()
    
    def test_resample_to_5min(self):
        """Test resampling to 5-minute cadence."""
        # Create 1-minute data
        times = pd.date_range('2020-01-01', periods=60, freq='1min')
        df = pd.DataFrame({'value': np.random.randn(60)}, index=times)
        
        result = self.preprocessor.resample_to_cadence(df, cadence_minutes=5)
        
        # Should have ~12 points (60 min / 5 min)
        assert len(result) == 12
    
    def test_resample_preserves_range(self):
        """Resampled data should cover the same time range."""
        times = pd.date_range('2020-01-01', periods=1440, freq='1min')
        df = pd.DataFrame({'value': np.random.randn(1440)}, index=times)
        
        result = self.preprocessor.resample_to_cadence(df, cadence_minutes=5)
        
        assert result.index[0] >= df.index[0]
        assert result.index[-1] <= df.index[-1]


class TestPropagationDelay:
    """Test solar wind propagation delay."""
    
    def setup_method(self):
        self.preprocessor = DataPreprocessor.__new__(DataPreprocessor)
        self.preprocessor.preprocessing = {
            'propagation': {'l1_distance_Re': 235.0, 'default_vsw_kms': 400.0}
        }
    
    def test_delay_shifts_time_forward(self):
        """Propagation delay should shift times forward."""
        times = pd.date_range('2020-01-01', periods=100, freq='5min')
        df = pd.DataFrame({
            'Vsw': np.full(100, 400.0),
            'Bz': np.random.randn(100)
        }, index=times)
        
        result = self.preprocessor.apply_propagation_delay(df)
        
        # All timestamps should be shifted forward
        assert result.index[0] > times[0]
    
    def test_faster_wind_shorter_delay(self):
        """Faster solar wind should result in shorter propagation delay."""
        times = pd.date_range('2020-01-01', periods=10, freq='5min')
        
        # Slow wind
        df_slow = pd.DataFrame({'Vsw': np.full(10, 300.0)}, index=times.copy())
        result_slow = self.preprocessor.apply_propagation_delay(df_slow)
        
        # Fast wind
        df_fast = pd.DataFrame({'Vsw': np.full(10, 600.0)}, index=times.copy())
        result_fast = self.preprocessor.apply_propagation_delay(df_fast)
        
        # Fast wind delay should be shorter
        delay_slow = (result_slow.index[0] - times[0]).total_seconds()
        delay_fast = (result_fast.index[0] - times[0]).total_seconds()
        
        assert delay_fast < delay_slow

"""Tests for evaluation metrics."""

import sys
import numpy as np
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from src.evaluation.metrics import ForecastMetrics


class TestPredictionEfficiency:
    """Test Prediction Efficiency (PE) metric."""
    
    def test_perfect_prediction(self):
        """PE = 1.0 for perfect predictions."""
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        pe = ForecastMetrics.prediction_efficiency(y, y)
        assert np.isclose(pe, 1.0)
    
    def test_mean_prediction(self):
        """PE = 0.0 when predicting the mean."""
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_mean = np.full_like(y, y.mean())
        pe = ForecastMetrics.prediction_efficiency(y, y_mean)
        assert np.isclose(pe, 0.0, atol=1e-10)
    
    def test_worse_than_mean(self):
        """PE < 0 for predictions worse than the mean."""
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_bad = np.array([5.0, 1.0, 5.0, 1.0, 5.0])  # Anti-correlated
        pe = ForecastMetrics.prediction_efficiency(y, y_bad)
        assert pe < 0
    
    def test_handles_nan(self):
        """PE should handle NaN values."""
        y = np.array([1.0, np.nan, 3.0, 4.0, 5.0])
        pred = np.array([1.1, 2.0, 3.1, 4.1, 5.1])
        pe = ForecastMetrics.prediction_efficiency(y, pred)
        assert np.isfinite(pe)


class TestRMSE:
    """Test RMSE in log space."""
    
    def test_zero_error(self):
        """RMSE = 0 for perfect predictions."""
        y = np.array([1.0, 2.0, 3.0])
        rmse = ForecastMetrics.rmse_log(y, y)
        assert np.isclose(rmse, 0.0)
    
    def test_known_error(self):
        """RMSE should match expected value."""
        y = np.array([1.0, 2.0, 3.0])
        pred = np.array([1.1, 2.1, 3.1])
        rmse = ForecastMetrics.rmse_log(y, pred)
        expected = np.sqrt(np.mean(0.1**2))
        assert np.isclose(rmse, expected)
    
    def test_positive(self):
        """RMSE should always be non-negative."""
        y = np.random.randn(100)
        pred = np.random.randn(100)
        rmse = ForecastMetrics.rmse_log(y, pred)
        assert rmse >= 0


class TestPearsonR:
    """Test Pearson correlation."""
    
    def test_perfect_correlation(self):
        """R = 1.0 for perfectly correlated data."""
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        r = ForecastMetrics.pearson_r(y, y)
        assert np.isclose(r, 1.0)
    
    def test_negative_correlation(self):
        """R = -1.0 for perfectly anti-correlated data."""
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_neg = np.array([5.0, 4.0, 3.0, 2.0, 1.0])
        r = ForecastMetrics.pearson_r(y, y_neg)
        assert np.isclose(r, -1.0)
    
    def test_range(self):
        """R should be between -1 and 1."""
        np.random.seed(42)
        y = np.random.randn(100)
        pred = np.random.randn(100)
        r = ForecastMetrics.pearson_r(y, pred)
        assert -1 <= r <= 1


class TestHSS:
    """Test Heidke Skill Score."""
    
    def test_perfect_categorical(self):
        """HSS = 1.0 for perfect categorical predictions."""
        y = np.array([1.0, 2.0, 4.0, 5.0, 1.0])  # threshold = 3
        pred = np.array([1.0, 2.0, 4.0, 5.0, 1.0])
        hss = ForecastMetrics.heidke_skill_score(y, pred, threshold=3.0)
        assert np.isclose(hss, 1.0)
    
    def test_no_skill(self):
        """HSS = 0 for random predictions matching climatology."""
        np.random.seed(42)
        n = 10000
        y = np.random.randn(n) + 3
        pred = np.random.randn(n) + 3
        hss = ForecastMetrics.heidke_skill_score(y, pred, threshold=3.0)
        assert abs(hss) < 0.1  # Should be near 0 for random


class TestMultiHorizon:
    """Test multi-horizon evaluation."""
    
    def test_multi_horizon_output(self):
        """Should return metrics for each horizon."""
        np.random.seed(42)
        y_true = np.random.randn(100, 3)
        y_pred = y_true + np.random.randn(100, 3) * 0.1
        
        labels = ['30min', '6h', '12h']
        result = ForecastMetrics.compute_multi_horizon(y_true, y_pred, labels)
        
        assert len(result) == 3
        for label in labels:
            assert label in result
            assert 'PE' in result[label]
            assert 'RMSE_log' in result[label]
            assert 'Pearson_R' in result[label]
    
    def test_degradation_with_horizon(self):
        """Performance should typically degrade with longer horizons."""
        np.random.seed(42)
        n = 1000
        y_true = np.random.randn(n, 3)
        
        # Add increasing noise for longer horizons
        y_pred = y_true.copy()
        y_pred[:, 0] += np.random.randn(n) * 0.05  # 30min: small error
        y_pred[:, 1] += np.random.randn(n) * 0.2   # 6h: medium error
        y_pred[:, 2] += np.random.randn(n) * 0.5   # 12h: large error
        
        labels = ['30min', '6h', '12h']
        result = ForecastMetrics.compute_multi_horizon(y_true, y_pred, labels)
        
        # PE should decrease with horizon
        assert result['30min']['PE'] > result['6h']['PE']
        assert result['6h']['PE'] > result['12h']['PE']

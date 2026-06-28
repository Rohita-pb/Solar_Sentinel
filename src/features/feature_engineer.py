"""
Feature Engineering for ISRO PS14 Radiation Forecasting.

Generates 28+ physics-informed features from raw solar wind and electron flux data,
including coupling functions, rolling statistics, and cyclical encodings.
"""

import numpy as np
import pandas as pd
from typing import Optional, List
from sklearn.preprocessing import StandardScaler
import joblib
from pathlib import Path

from src.utils.logger import get_logger
from src.utils.config import Config

logger = get_logger(__name__)


class FeatureEngineer:
    """
    Generates competition-winning feature set for radiation belt electron
    flux forecasting. Features are based on latest space weather ML literature.
    """
    
    def __init__(self, config: Optional[Config] = None):
        self.config = config or Config()
        self.scaler = StandardScaler()
        self.scaler_fitted = False
        self.feature_columns = []
    
    # =========================================================================
    # Core Feature Generation
    # =========================================================================
    
    def generate_all_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate the complete feature set from preprocessed data.
        
        Args:
            df: Preprocessed DataFrame with datetime index.
        
        Returns:
            DataFrame with all engineered features added.
        """
        logger.info("Generating features...")
        df = df.copy()
        
        # 1. Log-transform electron flux (target variable)
        df = self._add_log_flux(df)
        
        # 2. Derived physics-based features
        df = self._add_dynamic_pressure(df)
        df = self._add_electric_field(df)
        df = self._add_newell_coupling(df)
        df = self._add_epsilon_parameter(df)
        df = self._add_ulf_proxy(df)
        df = self._add_plasma_beta(df)
        df = self._add_alfven_mach(df)
        
        # 3. GSE to GSM conversion for Bz (approximate)
        df = self._add_bz_gsm(df)
        
        # 4. Rolling statistics
        df = self._add_rolling_features(df)
        
        # 5. Cyclical time encodings
        df = self._add_cyclical_encodings(df)
        
        # 6. Flux trend features
        df = self._add_flux_trends(df)
        
        # 7. Advanced signal processing features (MACD, Skewness, Cross-corr)
        df = self._add_advanced_signal_features(df)
        
        # Report
        feature_cols = [c for c in df.columns if c not in ['electron_flux_gt2MeV', 'proton_flux_gt10MeV', 'grasp_electron_flux']]
        logger.info(f"Generated {len(feature_cols)} features:")
        for i, col in enumerate(feature_cols, 1):
            valid_pct = df[col].notna().mean() * 100
            logger.debug(f"  {i:2d}. {col:<30s} ({valid_pct:.1f}% valid)")
        
        return df
    
    # =========================================================================
    # Individual Feature Functions
    # =========================================================================
    
    def _add_log_flux(self, df: pd.DataFrame) -> pd.DataFrame:
        """Log10 transform of electron flux — the primary target and autoregressive input."""
        if 'electron_flux_gt2MeV' in df.columns:
            df['log10_flux'] = np.log10(df['electron_flux_gt2MeV'].clip(lower=1e-10))
        return df
    
    def _add_dynamic_pressure(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Solar wind dynamic pressure: Pdyn = 1.67e-6 * Np * Vsw²
        Units: nPa (when Np in cm⁻³, Vsw in km/s)
        
        Physical meaning: Compression of the magnetosphere. Higher Pdyn
        pushes the magnetopause inward, affecting radiation belt dynamics.
        """
        if 'Np' in df.columns and 'Vsw' in df.columns:
            df['Pdyn'] = 1.6726e-6 * df['Np'] * df['Vsw']**2
        return df
    
    def _add_electric_field(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Dawn-dusk (y-component) electric field: Ey = -Vsw × Bz_GSM
        Units: mV/m
        
        Physical meaning: Drives magnetospheric convection. Positive Ey
        (southward IMF) enhances particle energization.
        """
        bz_col = 'Bz_GSM' if 'Bz_GSM' in df.columns else 'Bz_GSE'
        if 'Vsw' in df.columns and bz_col in df.columns:
            # Convert to mV/m: Vsw (km/s) * Bz (nT) * 1e-3
            df['Ey'] = -df['Vsw'] * df[bz_col] * 1e-3
        return df
    
    def _add_newell_coupling(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Newell universal coupling function:
        CF = Vsw^(4/3) × Bt^(2/3) × sin^(8/3)(θ/2)
        
        where θ = clock angle = arctan(By/Bz) in GSM
        
        Physical meaning: Best single metric for solar wind-magnetosphere
        coupling. Outperforms Akasofu epsilon for most applications.
        """
        bz_col = 'Bz_GSM' if 'Bz_GSM' in df.columns else 'Bz_GSE'
        by_col = 'By_GSM' if 'By_GSM' in df.columns else 'By_GSE'
        
        if 'Vsw' in df.columns and 'Bt' in df.columns:
            if by_col in df.columns and bz_col in df.columns:
                # Clock angle
                theta = np.arctan2(np.abs(df[by_col]), df[bz_col])
                # Newell coupling function
                df['Newell_CF'] = (
                    df['Vsw'].clip(lower=1) ** (4/3) *
                    df['Bt'].clip(lower=0.01) ** (2/3) *
                    np.abs(np.sin(theta / 2)) ** (8/3)
                )
            else:
                # Simplified version without clock angle
                df['Newell_CF'] = (
                    df['Vsw'].clip(lower=1) ** (4/3) *
                    df['Bt'].clip(lower=0.01) ** (2/3)
                )
        return df
    
    def _add_epsilon_parameter(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Akasofu epsilon parameter (energy input rate):
        ε = (4π/μ₀) × Vsw × Bt² × sin⁴(θ/2) × l₀²
        
        Physical meaning: Rate of solar wind electromagnetic energy
        coupling into the magnetosphere. Classic energy input metric.
        """
        bz_col = 'Bz_GSM' if 'Bz_GSM' in df.columns else 'Bz_GSE'
        by_col = 'By_GSM' if 'By_GSM' in df.columns else 'By_GSE'
        
        if 'Vsw' in df.columns and 'Bt' in df.columns:
            mu0 = 4 * np.pi * 1e-7  # T·m/A
            l0 = 7 * 6371e3  # 7 Re in meters
            
            if by_col in df.columns and bz_col in df.columns:
                theta = np.arctan2(np.abs(df[by_col]), df[bz_col])
                df['epsilon'] = (
                    (4 * np.pi / mu0) *
                    df['Vsw'] * 1e3 *  # km/s → m/s
                    (df['Bt'] * 1e-9) ** 2 *  # nT → T
                    np.sin(theta / 2) ** 4 *
                    l0 ** 2
                ) * 1e-12  # Scale to TW for reasonable numbers
        return df
    
    def _add_ulf_proxy(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        ULF wave power proxy: rolling standard deviation of IMF Bz.
        
        Physical meaning: ULF waves (1-20 mHz) drive radial diffusion
        of radiation belt electrons. IMF fluctuations correlate with
        ULF wave power in the magnetosphere.
        """
        bz_col = 'Bz_GSM' if 'Bz_GSM' in df.columns else 'Bz_GSE'
        
        if bz_col in df.columns:
            # 30-minute rolling std as ULF proxy
            df['ULF_proxy'] = df[bz_col].rolling('30min', min_periods=3).std()
        return df
    
    def _add_plasma_beta(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Plasma beta: ratio of thermal to magnetic pressure.
        β = nkT / (B²/2μ₀)
        
        Physical meaning: Indicates solar wind regime. High β means
        thermally dominated, low β means magnetically dominated.
        """
        if 'Np' in df.columns and 'Bt' in df.columns:
            if 'Vth' in df.columns:
                # Use thermal speed if available
                # kT = 0.5 * mp * Vth²
                mp = 1.6726e-27  # proton mass kg
                mu0 = 4 * np.pi * 1e-7
                kT = 0.5 * mp * (df['Vth'] * 1e3) ** 2  # J
                B2_over_2mu0 = (df['Bt'] * 1e-9) ** 2 / (2 * mu0)  # Pa
                n_m3 = df['Np'] * 1e6  # cm⁻³ → m⁻³
                df['plasma_beta'] = (n_m3 * kT) / B2_over_2mu0.clip(lower=1e-20)
            else:
                # Approximate using Tp ≈ 500 * Vsw - 1e5 (empirical)
                if 'Vsw' in df.columns:
                    Tp = (500 * df['Vsw'] - 1e5).clip(lower=1e4)  # K
                    kB = 1.381e-23  # Boltzmann
                    mu0 = 4 * np.pi * 1e-7
                    n_m3 = df['Np'] * 1e6
                    nkT = n_m3 * kB * Tp
                    B2_over_2mu0 = (df['Bt'] * 1e-9) ** 2 / (2 * mu0)
                    df['plasma_beta'] = nkT / B2_over_2mu0.clip(lower=1e-20)
        return df
    
    def _add_alfven_mach(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Alfvén Mach number: Ma = Vsw / V_Alfvén
        V_Alfvén = B / sqrt(μ₀ × ρ)
        
        Physical meaning: Ratio of flow speed to Alfvén speed.
        Controls shock formation and energy transfer at bow shock.
        """
        if 'Vsw' in df.columns and 'Bt' in df.columns and 'Np' in df.columns:
            mu0 = 4 * np.pi * 1e-7
            mp = 1.6726e-27
            rho = df['Np'] * 1e6 * mp  # mass density in kg/m³
            V_alfven = (df['Bt'] * 1e-9) / np.sqrt(mu0 * rho.clip(lower=1e-30))  # m/s
            V_alfven_kms = V_alfven / 1e3  # km/s
            df['Mach_A'] = df['Vsw'] / V_alfven_kms.clip(lower=1)
        return df
    
    def _add_bz_gsm(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Approximate GSE to GSM conversion for Bz.
        
        GSM differs from GSE by a rotation about the x-axis by the
        dipole tilt angle. For a first approximation, Bz_GSM ≈ Bz_GSE
        (exact at equinoxes, small error at solstices).
        """
        if 'Bz_GSE' in df.columns and 'Bz_GSM' not in df.columns:
            # Simple approximation — exact conversion requires dipole tilt
            df['Bz_GSM'] = df['Bz_GSE']
            logger.debug("Using Bz_GSE as Bz_GSM approximation")
        
        if 'By_GSE' in df.columns and 'By_GSM' not in df.columns:
            df['By_GSM'] = df['By_GSE']
        
        return df
    
    def _add_rolling_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add rolling window statistics capturing temporal memory.
        
        Radiation belt electrons respond to sustained solar wind forcing
        with delays of hours to days, not instantaneous values.
        """
        windows = self.config.features.get('rolling_windows_hours', [1, 3, 6, 12, 24])
        
        # Solar wind speed statistics
        if 'Vsw' in df.columns:
            for w in [3, 24]:
                if w in windows:
                    df[f'Vsw_mean_{w}h'] = df['Vsw'].rolling(f'{w}h', min_periods=1).mean()
            df['Vsw_std_6h'] = df['Vsw'].rolling('6h', min_periods=1).std()
        
        # IMF Bz minimum (worst southward turning)
        bz_col = 'Bz_GSM' if 'Bz_GSM' in df.columns else 'Bz_GSE'
        if bz_col in df.columns:
            df['Bz_min_6h'] = df[bz_col].rolling('6h', min_periods=1).min()
            df['Bz_mean_3h'] = df[bz_col].rolling('3h', min_periods=1).mean()
        
        # Dynamic pressure maximum
        if 'Pdyn' in df.columns:
            df['Pdyn_max_6h'] = df['Pdyn'].rolling('6h', min_periods=1).max()
        
        # AE index average (substorm activity)
        if 'AE' in df.columns:
            df['AE_mean_3h'] = df['AE'].rolling('3h', min_periods=1).mean()
            df['AE_max_6h'] = df['AE'].rolling('6h', min_periods=1).max()
        
        # Dst running statistics
        if 'Dst' in df.columns:
            df['Dst_min_6h'] = df['Dst'].rolling('6h', min_periods=1).min()
        
        # Newell coupling cumulative (energy input over time)
        if 'Newell_CF' in df.columns:
            df['Newell_CF_sum_3h'] = df['Newell_CF'].rolling('3h', min_periods=1).sum()
        
        # Flux rolling statistics
        if 'log10_flux' in df.columns:
            df['flux_rolling_std_6h'] = df['log10_flux'].rolling('6h', min_periods=1).std()
            df['flux_rolling_mean_12h'] = df['log10_flux'].rolling('12h', min_periods=1).mean()
        
        return df
    
    def _add_cyclical_encodings(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add cyclical time encodings to capture periodic patterns.
        
        - Hour of day: Diurnal electron flux variation (day/night asymmetry)
        - Day of year: Seasonal/Russell-McPherron effect
        - Bartels rotation: 27-day solar rotation period
        """
        if not isinstance(df.index, pd.DatetimeIndex):
            return df
        
        # Hour of day (UT)
        hour = df.index.hour + df.index.minute / 60
        df['hour_sin'] = np.sin(2 * np.pi * hour / 24)
        df['hour_cos'] = np.cos(2 * np.pi * hour / 24)
        
        # Day of year (seasonal)
        doy = df.index.dayofyear
        df['doy_sin'] = np.sin(2 * np.pi * doy / 365.25)
        df['doy_cos'] = np.cos(2 * np.pi * doy / 365.25)
        
        # Bartels rotation (27-day solar rotation)
        # Days since a reference Bartels rotation start
        ref_date = pd.Timestamp('2011-01-01')
        days_since_ref = (df.index - ref_date).total_seconds() / 86400
        df['bartels_sin'] = np.sin(2 * np.pi * days_since_ref / 27.0)
        df['bartels_cos'] = np.cos(2 * np.pi * days_since_ref / 27.0)
        
        return df
    
    def _add_flux_trends(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add flux trend and rate-of-change features.
        
        Captures whether flux is rising, falling, or stable — important
        for distinguishing storm phases (main phase vs recovery).
        """
        if 'log10_flux' in df.columns:
            # 1-hour difference
            steps_1h = 12  # 12 × 5min = 1 hour
            df['flux_diff_1h'] = df['log10_flux'].diff(steps_1h)
            
            # 3-hour difference
            steps_3h = 36
            df['flux_diff_3h'] = df['log10_flux'].diff(steps_3h)
            
            # Rate of change (derivative approximation)
            df['flux_roc_30min'] = df['log10_flux'].diff(6) / 0.5  # per hour
        
        return df
    
    def _add_advanced_signal_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add advanced signal processing features (MACD, Skewness, Kurtosis, Cross-correlation).
        This extracts maximum information from the limited GRASP dataset.
        """
        if 'log10_flux' in df.columns:
            # 1. MACD (Moving Average Convergence Divergence)
            # EMA_12 - EMA_26 in 5-min intervals (usually finance, adapting to hours here)
            # We use 1h (12 steps) and 3h (36 steps) EMA
            ema_1h = df['log10_flux'].ewm(span=12, adjust=False).mean()
            ema_3h = df['log10_flux'].ewm(span=36, adjust=False).mean()
            df['flux_macd'] = ema_1h - ema_3h
            # MACD signal line (9-step EMA of MACD)
            df['flux_macd_signal'] = df['flux_macd'].ewm(span=9, adjust=False).mean()
            # MACD Histogram
            df['flux_macd_hist'] = df['flux_macd'] - df['flux_macd_signal']
            
            # 2. Rolling Skewness and Kurtosis (6-hour window = 72 steps)
            df['flux_skew_6h'] = df['log10_flux'].rolling('6h', min_periods=12).skew()
            df['flux_kurt_6h'] = df['log10_flux'].rolling('6h', min_periods=12).kurt()
            
            # 3. Cross-correlation with Proton Flux (if available)
            if 'grasp_proton_flux' in df.columns:
                df['log10_proton'] = np.log10(df['grasp_proton_flux'].clip(lower=1e-10))
                # 12-hour rolling correlation
                df['electron_proton_corr_12h'] = df['log10_flux'].rolling('12h', min_periods=36).corr(df['log10_proton'])
        
        return df
    
    # =========================================================================
    # Normalization
    # =========================================================================
    
    def get_feature_columns(self) -> List[str]:
        """Get the list of feature columns configured for model input."""
        return self.config.features.get('input_features', self.feature_columns)
    
    def fit_scaler(self, df: pd.DataFrame, feature_cols: List[str] = None) -> None:
        """
        Fit StandardScaler on training data.
        
        Args:
            df: Training DataFrame.
            feature_cols: Columns to normalize. If None, uses config.
        """
        feature_cols = feature_cols or self.get_feature_columns()
        available_cols = [c for c in feature_cols if c in df.columns]
        
        # Fill NaN with column median before fitting
        data = df[available_cols].fillna(df[available_cols].median())
        self.scaler.fit(data)
        self.scaler_fitted = True
        self.feature_columns = available_cols
        
        logger.info(f"Scaler fitted on {len(available_cols)} features")
    
    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Apply fitted scaler to normalize features.
        
        Args:
            df: DataFrame to normalize.
        
        Returns:
            DataFrame with normalized feature columns.
        """
        if not self.scaler_fitted:
            raise RuntimeError("Scaler not fitted. Call fit_scaler() first.")
        
        df = df.copy()
        available_cols = [c for c in self.feature_columns if c in df.columns]
        
        # Fill NaN with 0 after scaling (represents the mean)
        data = df[available_cols].fillna(df[available_cols].median())
        df[available_cols] = self.scaler.transform(data)
        
        return df
    
    def inverse_transform_flux(self, normalized_log_flux: np.ndarray) -> np.ndarray:
        """
        Inverse transform normalized log10 flux back to physical units.
        
        Args:
            normalized_log_flux: Normalized log10(flux) values.
        
        Returns:
            Flux values in original physical units (pfu).
        """
        if 'log10_flux' in self.feature_columns:
            idx = self.feature_columns.index('log10_flux')
            mean = self.scaler.mean_[idx]
            scale = self.scaler.scale_[idx]
            log_flux = normalized_log_flux * scale + mean
            return 10 ** log_flux
        else:
            return 10 ** normalized_log_flux
    
    def save_scaler(self, path: str = None):
        """Save fitted scaler to disk."""
        if path is None:
            path = str(self.config.root / 'models' / 'feature_scaler.pkl')
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            'scaler': self.scaler,
            'feature_columns': self.feature_columns,
        }, path)
        logger.info(f"Scaler saved to {path}")
    
    def load_scaler(self, path: str = None):
        """Load fitted scaler from disk."""
        if path is None:
            path = str(self.config.root / 'models' / 'feature_scaler.pkl')
        data = joblib.load(path)
        self.scaler = data['scaler']
        self.feature_columns = data['feature_columns']
        self.scaler_fitted = True
        logger.info(f"Scaler loaded from {path}")

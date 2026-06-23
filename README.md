# ISRO PS14 — Forecasting Energetic Particle Radiation Environment

## 🛰️ Overview

AI-powered prediction of **>2 MeV electron fluxes** at geostationary orbit for ISRO's satellite protection. Uses **Transformer** and **LSTM** deep learning models trained on **11 years** of GOES and Wind spacecraft data to forecast radiation fluxes at three horizons:

| Horizon | Use Case |
|---------|----------|
| **30 minutes** | Immediate satellite protection alerts |
| **6 hours** | Medium-term operational planning |
| **12 hours** | Extended forecast for scheduling |

## 🏗️ Architecture

```
Solar Wind Data (Wind L1) → Feature Engineering (28+ features) → Transformer/LSTM → Multi-Horizon Forecast
       ↓                          ↓                                    ↓
   CDF Reader              Physics-based                         30min | 6h | 12h
   + Preprocessing       (Newell, epsilon,                      electron flux
                           ULF proxy, etc.)                      prediction
```

## 📊 Data Sources

| Source | Data | Access |
|--------|------|--------|
| **GOES-13/15** | >2 MeV electron flux | [SPDF/CDAWeb](https://spdf.gsfc.nasa.gov/pub/data/goes/) |
| **Wind SWE/MFI** | Solar wind Vsw, Np, IMF | [SPDF/CDAWeb](https://spdf.gsfc.nasa.gov/pub/data/wind/) |
| **OMNIWeb** | Kp, Dst, AE, SYM-H | [OMNIWeb](https://omniweb.gsfc.nasa.gov/) |
| **GRASP/GSAT-19** | Electron flux (Indian lon) | [PRADAN](https://pradan.issdc.gov.in) |

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Download Data
```bash
python data/download_data.py
```
This downloads ~11 years of GOES, Wind, and OMNIWeb data (~several GB).

### 3. Run Full Pipeline
```bash
python main.py --mode full --model both
```

Or step-by-step:
```bash
python main.py --mode download        # Step 1: Download data
python main.py --mode preprocess      # Step 2: Preprocess
python main.py --mode train --model transformer  # Step 3: Train
```

### 4. Launch Dashboard
```bash
streamlit run app/dashboard.py
```

## 🧠 Models

### Transformer (Primary)
- Informer-inspired with 4 encoder layers, 8 attention heads
- d_model=128, dim_ff=512
- 12-hour lookback (144 steps × 28 features)
- Pre-LN architecture for training stability
- Horizon-specific output heads

### LSTM (Baseline)
- Bidirectional, 2 layers, 128 hidden units
- Learned attention over sequence
- 6-hour lookback (72 steps × 28 features)

## 📈 Feature Set (28+ Features)

**Raw inputs**: Electron flux, Vsw, Np, IMF (Bx, By, Bz, Bt), Kp, Dst, AE, SYM-H

**Physics-derived**:
- Newell coupling function (best SW-magnetosphere coupling metric)
- Akasofu epsilon (energy input rate)
- Dynamic pressure, Electric field (Ey)
- ULF wave proxy, Plasma beta, Alfvén Mach number

**Rolling statistics**: 3h/6h/24h means, minimums, maximums

**Cyclical encodings**: Hour-of-day, day-of-year, 27-day Bartels rotation

## 📋 Evaluation Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| **PE** (Prediction Efficiency) | Skill score vs climatology | > 0.80 |
| **RMSE(log₁₀)** | Error in orders of magnitude | < 0.30 |
| **Pearson R** | Linear correlation | > 0.90 |
| **HSS** | Categorical skill (threshold exceedance) | > 0.50 |

## 📁 Project Structure

```
├── main.py              # Pipeline orchestrator
├── config.yaml          # All configuration
├── requirements.txt     # Dependencies
├── data/
│   ├── download_data.py # Download script
│   ├── raw/             # Raw CDF files
│   └── processed/       # Cleaned Parquet
├── src/
│   ├── data/            # CDF reader, downloader, preprocessor, dataset
│   ├── features/        # Feature engineering
│   ├── models/          # LSTM, Transformer, trainer
│   ├── evaluation/      # Metrics, visualizer
│   └── utils/           # Config, logging
├── app/
│   └── dashboard.py     # Streamlit dashboard
├── notebooks/           # Jupyter notebooks
├── models/              # Saved checkpoints
├── outputs/             # Plots, predictions
└── tests/               # Unit tests
```

## 🧪 Testing

```bash
pytest tests/ -v
```

## 📜 License

This project is developed for the ISRO national competition (Problem Statement 14).

## 📚 References

1. Newell et al. (2007) - Universal coupling function
2. Li et al. (2001) - Relativistic electron flux forecasting  
3. Transformer-based radiation belt forecasting (SWSC, 2024)
4. GOES Space Environment Monitor documentation (NOAA/NCEI)

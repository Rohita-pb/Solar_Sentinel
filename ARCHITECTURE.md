# ISRO Geostationary Electron Flux Prediction System (PS14)
**System Architecture & Technical Design Document**

## 1. System Overview

The system is an end-to-end operational ML pipeline designed to forecast >2 MeV electron fluxes at geostationary orbit (GEO). It fulfills ISRO's requirement to provide early warnings (30-45 minutes) and long-term forecasts (6 hours, 12 hours) of harsh radiation environments that could damage satellite electronics. 

The architecture is divided into three primary subsystems:
1. **Historical Data & Training Pipeline** (Data acquisition, Preprocessing, Feature Engineering, Model Training)
2. **Real-Time Inference Engine** (Live data polling, Dynamic feature generation, PyTorch Inference)
3. **Serving Layer** (FastAPI REST backend and Streamlit Dashboard)

---

## 2. Data Pipeline Architecture

### 2.1 Data Sources
- **ISRO GRASP / GSAT-19 Payload**: High-resolution localized electron and proton flux data at the Indian longitudinal geostationary sector. Used as the primary ground-truth target.
- **NASA OMNIWeb / Wind Spacecraft**: High-resolution L1 Lagrangian point solar wind parameters (Speed, Density, IMF components).
- **NOAA SWPC Real-Time Feeds**: JSON feeds providing real-time solar wind and GOES electron flux for live operational inference.

### 2.2 Data Ingestion (`src/data/downloader.py` & `src/data/cdf_reader.py`)
- The `DataDownloader` pulls massive archives of `.cdf` files from NASA CDAWeb.
- The `CDFReader` parses Common Data Format (CDF) files, handling epoch conversions, missing value masking (e.g., `-1e31`), and timezone alignment (forced to UTC).

### 2.3 Data Preprocessing (`src/data/preprocessor.py`)
- **Resampling**: All heterogenous time-series (Wind at 1-min, GOES at 5-min, GRASP at 5-min) are normalized to a strict `5-minute` cadence using forward-filling for small gaps and mean-aggregation for downsampling.
- **Spike Removal**: Implements IQR-based anomaly detection to remove instrumental artifacts and telemetry noise.
- **Target Prioritization**: Natively merges GOES and GRASP, prioritizing GRASP data when available to train the model specifically for ISRO's orbital slots.

### 2.4 Feature Engineering (`src/features/feature_engineer.py`)
The system extracts 44 advanced physics-based features, though strictly subsets them dynamically based on data availability (falling back to 15 core features when OMNIWeb indices are unavailable).
* **Core Physics**: `log10_flux`, `Vsw` (Speed), `Np` (Density), `Bt`, `Bx_GSE`, `By_GSM`, `Bz_GSM`.
* **Cyclical Encoding**: Sin/Cos transformations for `hour`, `doy` (Day of Year), and `bartels` (27-day solar rotation cycle).
* **Derived Magnetospheric Proxies**:
  * **Alfvén Mach Number ($M_A$)**: Solar wind speed divided by Alfvén speed.
  * **Plasma Beta ($\beta$)**: Ratio of thermal to magnetic pressure.
  * **Akasofu Epsilon ($\epsilon$)**: Energy coupling rate into the magnetosphere.
  * **Newell Coupling Function**: Best-performing empirical solar wind coupling metric.
* **Rolling Statistics**: 3-hour and 6-hour moving averages and minimums (e.g., `Bz_min_6h`) to capture the time-history of geomagnetic storms.

---

## 3. Machine Learning Architecture

### 3.1 Model Design (`src/models/transformer_model.py`)
The core prediction engine is a **Time-Series Transformer** implemented in PyTorch. Unlike standard LSTMs, Transformers utilize multi-head self-attention to capture both immediate sudden changes (substorms) and long-term cyclic variations (corotating interaction regions).

**Hyperparameters & Topology:**
- **Sequence Length**: 72 steps (6 hours of 5-minute data).
- **Multi-Horizon Output**: Predicts 3 specific timeframes simultaneously:
  - Horizon 1: +6 steps (30 minutes)
  - Horizon 2: +72 steps (6 hours)
  - Horizon 3: +144 steps (12 hours)
- **Encoder**: 3 layers, 4 attention heads, 64-dimensional model state (`d_model`).
- **Positional Encoding**: Uses standard sine/cosine absolute positional embeddings to inject temporal order.
- **Probabilistic Output**: For each horizon, the model outputs 3 values: `[Prediction, Lower_Bound_5%, Upper_Bound_95%]`. This is achieved using a **Quantile Loss Function**.

### 3.2 Loss Function (Quantile Loss)
Instead of standard MSE, the model uses Pinball/Quantile loss to provide confidence intervals. This is critical for space weather operations, where scientists need to know the *worst-case scenario* (the 95th percentile upper bound) of radiation flux.

### 3.3 Training Loop (`src/models/trainer.py`)
- **Optimization**: AdamW optimizer with weight decay to prevent overfitting.
- **Early Stopping**: Halts training if validation loss doesn't improve for 12 epochs.
- **Metrics**: Evaluates using RMSE, MAE, Pearson Correlation (R), Prediction Efficiency (PE), and Heidke Skill Score (HSS).

---

## 4. Real-Time Operations Architecture

### 4.1 Live Fetcher Daemon (`run_live_service.py` & `src/data/live_fetcher.py`)
A detached background service that polls NOAA REST APIs every 5 minutes.
- Fetches real-time GOES >2 MeV flux, Solar Wind Plasma, and Magnetometer data.
- **Network Resilience**: Employs `tenacity` for exponential backoff. If the NOAA API drops connections, it retries safely and dynamically broadcasts a `DISCONNECTED` state to the database and frontend so scientists know the data is stale.
- Maps real-time column names (`bz_gsm`, `speed`) to historical model expectations (`Bz_GSM`, `Vsw`).
- Fills missing values with neutral approximations (e.g., `Dst=0`) to ensure 100% uptime.

### 4.2 Inference Engine (`src/models/live_inference.py`)
- Loads the fitted `StandardScaler` and applies exactly the same transformations used during training.
- Constructs the most recent 6-hour sequence tensor.
- Pushes the sequence through the PyTorch Transformer.
- Inverse-transforms the predicted `log10_flux` back into physical units (pfu).
- **Thresholding System**:
  - **Normal**: Flux < 100 pfu
  - **Warning**: Flux >= 100 pfu
  - **Critical**: Flux >= 1000 pfu (Standard NOAA storm threshold).

### 4.3 Scientific Explainability (`src/evaluation/explainability.py`)
To prevent "black box" syndrome, a PyTorch Saliency Gradient explainer runs in real-time. It executes a backward pass to calculate input gradients against the 95th-percentile (worst-case) forecast. This identifies precisely which physical solar wind features (e.g. `Bz_GSM`, `Vsw`) triggered the alert.

### 4.4 Serving API & TimescaleDB (`api.py` & `src/data/database.py`)
- **Database Engine**: Uses **TimescaleDB** (PostgreSQL) via SQLAlchemy to permanently log every reading and prediction. Provides historical context to measure model drift. Includes a graceful fallback to an in-process SQLite database if Docker isn't running.
- **FastAPI Web Server**: Decouples the PyTorch inference engine from the frontend UI.
- Exposes `GET /api/live` (for real-time dashboard state) and `GET /api/history` (for historical drift tracking). Returns strict JSON schemas including predictions, uncertainty bounds, connection health, and feature explainability.

---

## 5. Deployment & System Requirements
- **Hardware**: Compatible with CPU-only environments, but optimally run on NVIDIA CUDA-enabled GPUs (e.g., RTX 5060) for millisecond inference latency.
- **Stack**: Python 3.10+, PyTorch, Scikit-learn, Pandas, FastAPI, SQLAlchemy, PostgreSQL (TimescaleDB), Docker.
- **Dockerization**: The entire backend and database architecture is fully containerized. Deploying to an ISRO server requires only running `docker-compose up -d --build`. This automatically provisions the database, loads the AI models, and launches the detached polling daemon and FastAPI server.

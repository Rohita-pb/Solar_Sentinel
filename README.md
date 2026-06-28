# ISRO PS14: Geostationary Electron Flux Forecasting System

![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![PyTorch](https://img.shields.io/badge/PyTorch-Transformer-EE4C2C)
![FastAPI](https://img.shields.io/badge/FastAPI-Serving-009688)
![Database](https://img.shields.io/badge/TimescaleDB-PostgreSQL-FDB515)
![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED)

A state-of-the-art, production-ready machine learning pipeline and real-time backend designed for **ISRO Hackathon Problem Statement 14 (PS14)**. 

This system actively monitors L1 solar wind parameters (via NOAA SWPC/NASA OMNIWeb) to forecast hazardous >2 MeV energetic electron flux at geostationary orbit. It provides early warnings 30–45 minutes in advance, alongside long-term 6-hour and 12-hour forecasts, protecting satellite electronics from severe space weather anomalies (e.g., Coronal Mass Ejections, Corotating Interaction Regions).

---

## 🚀 Key Features

* **Time-Series Transformer Engine**: Utilizes a PyTorch multi-head self-attention Transformer, dynamically extracting temporal dependencies over a 6-hour rolling sequence.
* **Uncertainty Quantification**: Powered by a Quantile/Pinball Loss function. The model doesn't just output a deterministic prediction—it provides strict 95% worst-case upper bound confidence intervals, vital for mission-critical satellite operations.
* **Real-Time Scientific Explainability**: Extracts PyTorch Saliency Gradients dynamically during inference, explaining exactly *why* an alert was triggered (e.g., "Alert driven by a drop in `Bz_GSM` and high `Alfvén Mach Number`").
* **Network Resilience**: Employs exponential backoff (`tenacity`) for external NOAA API calls. Broadcasts strict connection health (`CONNECTED` / `DISCONNECTED`) to the frontend if network outages occur, preventing silent "black-box" failures.
* **TimescaleDB Persistence**: Permanently logs telemetry and predictive drift in a high-performance PostgreSQL time-series database (with seamless fallback to SQLite for local rapid-prototyping).
* **Dockerized Microservices**: The entire Python API and TimescaleDB infrastructure is fully containerized for one-command deployment to ISRO servers.

---

## 🛠 Setup & Installation

### Option 1: Docker (Recommended for Production)
The simplest way to deploy the system, containing both the TimescaleDB database and the FastAPI Backend.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop).
2. Clone the repository and navigate to the project root.
3. Run the deployment:
   ```bash
   docker-compose up -d --build
   ```
4. The API is now live at `http://localhost:8000/api/live`

### Option 2: Native Python (Recommended for Development)
Run directly on your host machine using a virtual environment. The system will gracefully fall back to a local `sqlite:///isro_fallback.db` database automatically.

1. **Create and Activate Virtual Environment**:
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate   # Windows
   source .venv/bin/activate  # Linux/Mac
   ```
2. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   pip install sqlalchemy psycopg2-binary tenacity fastapi uvicorn
   ```
3. **Start the Live Daemon** (Polls space weather every 5 minutes):
   ```bash
   python run_live_service.py
   ```
4. **Start the FastAPI Server** (In a separate terminal):
   ```bash
   uvicorn api:app --host 0.0.0.0 --port 8000
   ```

---

## 📡 API Documentation

The decoupled FastAPI backend serves strict JSON payloads designed for consumption by a modern frontend dashboard (e.g., React, Next.js).

### `GET /api/live`
Returns the absolute latest real-time forecast.
```json
{
  "timestamp": "2026-06-28T12:00:00+00:00",
  "latest_data_time": "2026-06-28T11:55:00+00:00",
  "connection_status": "CONNECTED",
  "current_flux_gt2MeV": 2.5,
  "status": "Normal",
  "predictions_pfu": [5.6, 8.1, 15.2],
  "p95_pfu": [8.5, 12.0, 28.1],
  "explainability": {
    "top_drivers": {
      "Bz_GSM": 45.2,
      "Vsw": 22.1,
      "ULF_proxy": 15.4
    },
    "method": "Input Gradients (Saliency) on 95th Percentile 30-min Forecast"
  }
}
```

### `GET /api/history?limit=100`
Returns an array of historical predictions, allowing the frontend to plot model drift vs. observed flux over time.

---

## 🏗 Architecture Overview

Please see the highly detailed [architecture.md](architecture.md) for a deep dive into the underlying physics logic, data pipeline preprocessing, and mathematical topology of the Transformer model.

### Subsystem Structure
- **`src/data/`**: Ingestion of historical CDF files and real-time NOAA JSON feeds. `database.py` manages SQLAlchemy ORM.
- **`src/features/`**: Implements 44 advanced magnetospheric physics proxies (Akasofu Epsilon, Newell Coupling, Alfvén Mach).
- **`src/models/`**: PyTorch implementations of the Time-Series Transformer and Model Trainer.
- **`src/evaluation/`**: Contains metrics (RMSE, HSS, Prediction Efficiency) and the real-time Saliency Explainability module.
- **`api.py`**: The FastAPI ASGI server.
- **`run_live_service.py`**: The detached daemon that triggers the feature pipeline and inference loop dynamically.

---

## 🧪 Testing
To test the system's ability to trigger alerts under extreme space weather events, run the anomaly injection script:
```bash
python test_anomaly.py
```
This script dynamically injects a massive simulated Coronal Mass Ejection (CME) into the live data pipeline and verifies that the real-time PyTorch inference engine correctly calculates the physics anomalies, triggers a `CRITICAL` alert, and logs the explainability drivers.

<div align="center">
  
# 🌌 ISRO PS-14: Energetic Particle Radiation Forecasting Pipeline
**Bharatiya Antariksh Hackathon 2026 Submission by Team Pocket Aces**

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat&logo=streamlit&logoColor=white)](https://streamlit.io/)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

An advanced, production-ready Deep Learning pipeline to predict >2 MeV energetic electron fluxes at Geostationary Orbit 30 minutes, 6 hours, and 12 hours in advance.

</div>

---

## 🚀 The Differentiator: Why This Architecture Wins
Most hackathon projects deliver a "black box" machine learning script. We engineered a **deployment-ready microservice** that provides ISRO operators with absolute trust and transparency.

1. **Simultaneous Multi-Horizon Transformer:** Instead of using LSTMs that accumulate error by predicting step-by-step, our custom Informer-based architecture predicts all three horizons (30m, 6h, 12h) simultaneously.
2. **Predictive Uncertainty (Risk Bounds):** Space weather operators cannot rely on single-point predictions. We implemented **Monte Carlo Dropout** during inference to generate a 90% Confidence Interval around our forecasts.
3. **Explainable AI (XAI):** We implemented **Permutation Feature Importance** to mathematically prove to operators *why* the model is predicting a storm. 
4. **Automated Physics Engineering:** Calculates the Alfvén Mach Number, Dynamic Pressure, and the Newell Coupling Function automatically from raw CDF data.

---

## 🛠️ System Architecture

### 1. Backend API (`app/api.py`)
A lightning-fast FastAPI REST API designed to interface directly with automated satellite subsystems.
*   `GET /predict/latest` - Returns the real-time 30m, 6h, and 12h forecasts alongside their 5th and 95th percentile confidence bounds.

### 2. Operational Dashboard (`app/dashboard.py`)
A beautiful Streamlit UI designed for control room operators.
*   Interactive Plotly charts mapping the >2 MeV flux predictions.
*   Shaded Uncertainty bands to visualize operational risk.
*   Live Feature Importance bar charts detailing the model's internal logic.

---

## 💻 Quickstart (Run it Yourself)

### Option 1: Docker (Recommended)
This project is fully containerized. You can run both the REST API and the Dashboard with a single command.
```bash
docker-compose up --build
```
*   **Dashboard:** `http://localhost:8501`
*   **REST API:** `http://localhost:8000/docs`

### Option 2: Local Python Environment
```bash
# 1. Clone the repository
git clone https://github.com/TanmayMahajan26/Team-Pocket-Aces-Bharatiya-Antariksh-Hackathon-2026-ISRO.git
cd Team-Pocket-Aces-Bharatiya-Antariksh-Hackathon-2026-ISRO

# 2. Create virtual environment & install dependencies
python -m venv .venv
source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# 3. Launch the Dashboard
streamlit run app/dashboard.py
```

---

## 🧠 Training Pipeline

Want to train the model from scratch on the 11-year NASA GOES/Wind dataset?

```bash
# 1. Download 11 years of raw CDF files from NASA SPDF
python main.py --mode download

# 2. Run the entire pipeline (Preprocess -> Train -> Evaluate -> XAI)
python main.py --mode full --model both
```

All models are automatically saved to `models/checkpoints/` and performance metrics/XAI outputs are logged to `outputs/`.

---
*Built with ❤️ for ISRO.*

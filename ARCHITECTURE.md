# ISRO PS-14: Energetic Particle Radiation Forecasting Pipeline
## Architecture & Workflow Documentation

This document explains the entire end-to-end workflow of the deep learning pipeline we are building to predict harsh radiation environments at geostationary orbit. It is designed to help you understand the architecture so you can confidently present it to the judges.

---

### 1. High-Level Objective
The goal is to predict **>2 MeV energetic electron fluxes** 30 minutes, 6 hours, and 12 hours into the future. 
High electron flux can cause deep dielectric charging in geostationary satellites (like ISRO's GSAT), potentially causing fatal short-circuits. Predicting these spikes allows satellite operators to put spacecraft into safe modes.

---

### 2. The Data Pipeline (ETL: Extract, Transform, Load)
Raw space weather data is notoriously messy. Our pipeline automates the cleanup.

* **A. Data Extraction (`src/data/downloader.py`):**
  We connect directly to NASA's SPDF and NOAA servers to download `.cdf` (Common Data Format) files. We pull:
  *   **GOES:** Electron fluxes (the target we are trying to predict).
  *   **Wind (SWE & MFI):** Solar wind speed, density, and magnetic field parameters measured at the L1 Lagrange point (1.5 million km away from Earth).
  *   **GRASP:** ISRO's own GSAT payload data.

* **B. Preprocessing & Cleaning (`src/data/preprocessor.py`):**
  *   **Spike Removal:** We use sigma-clipping to remove physically impossible instrument noise.
  *   **Solar Proton Event (SPE) Filtering:** During a solar flare, high-energy protons contaminate electron sensors. We detect proton spikes and mask out the false electron readings.
  *   **Propagation Delay:** The solar wind takes ~45-60 minutes to travel from the Wind satellite to Earth. The code calculates this delay based on the wind speed ($V_{sw}$) and shifts the timestamps so the data aligns with when the wind actually hits Earth's magnetosphere.

* **C. Feature Engineering (`src/features/feature_engineer.py`):**
  We generate features that help the neural network understand physics and time:
  *   **Cyclical Time Encodings:** Using sine/cosine transforms to encode the 24-hour daily cycle, the 27-day solar rotation (Bartels cycle), and the 365-day seasonal cycle.
  *   **Physics-Based Features:** Calculating the Alfvén Mach number, Dynamic Pressure, and the Newell Coupling Function (which measures how much solar wind energy is entering Earth's magnetic shield).
  *   **Advanced Signal Processing:** For periods where we only have flux data (like the GRASP dataset), we extract MACD (momentum), Rolling Skewness, and Rolling Kurtosis to detect hidden "brewing" storm signatures before they erupt.

---

### 3. The Deep Learning Architecture (The Brains)
We are training two separate models to forecast the future.

* **A. The Transformer Model (`src/models/transformer_model.py`):**
  This is the crown jewel of the project. Based on the "Informer" architecture, it uses Multi-Head Self-Attention. 
  Instead of predicting 1 step ahead and feeding it back into itself (which causes compounding errors), it predicts the 30m, 6h, and 12h horizons **simultaneously** in a single forward pass.

* **B. The LSTM Model (`src/models/lstm_model.py`):**
  Long Short-Term Memory networks are the traditional standard for time-series. We use this as a strong baseline to prove to the judges that our Transformer is actually better.

---

### 4. Advanced Production Capabilities (How we win)
To elevate this from a "student project" to a "production-ready operational tool", we added two massive features:

* **A. Predictive Uncertainty (Monte Carlo Dropout):**
  Space weather operators don't just want a single line; they want risk bounds. During prediction, we keep the model's "Dropout" layers turned on and run the prediction 20 times. This generates a spread of possible futures, allowing us to plot a **90% Confidence Interval** (shaded band) around the prediction.

* **B. Explainable AI / XAI (Permutation Feature Importance):**
  Neural networks are "black boxes." Judges hate black boxes. 
  During evaluation, our code systematically shuffles each feature (e.g., mixing up the MACD feature) and measures how much the prediction accuracy drops. If accuracy drops massively, that feature is extremely important. We save these scores to visualize *exactly* how the model makes decisions.

---

### 5. The Operational Dashboard (`app/dashboard.py`)
Finally, all this math is wrapped in a beautiful, interactive Streamlit frontend.
*   **Data Explorer:** Visualizes the raw time series and features.
*   **Model Performance:** Displays standard scientific metrics like Prediction Efficiency (PE), RMSE, and Pearson Correlation.
*   **Predictions:** An interactive Plotly chart showing the actual vs. predicted flux, complete with the 90% uncertainty confidence bands.
*   **Explainable AI:** Displays the Feature Importance bar chart so judges can see the internal logic of the model.

---

### Workflow Summary
1. `downloader.py` gets the data.
2. `preprocessor.py` cleans it.
3. `feature_engineer.py` extracts patterns.
4. `trainer.py` trains the Transformer and LSTM.
5. `main.py` runs the evaluation, extracts uncertainty bounds, and scores feature importance.
6. `dashboard.py` visualizes the entire system for the judges.

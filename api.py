import json
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import pandas as pd
import numpy as np

from src.data.database import DatabaseManager

import logging

logger = logging.getLogger("api")

app = FastAPI(
    title="ISRO PS14 Space Weather API",
    description="Real-time Geostationary Electron Flux Prediction API",
    version="1.0.0"
)

# Allow CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).parent
LIVE_STATE_FILE = PROJECT_ROOT / "outputs" / "live" / "live_state.json"

db = DatabaseManager()

class ForecastData(BaseModel):
    timestamp: str
    latest_data_time: str
    connection_status: str
    current_flux_gt2MeV: float
    status: str
    predictions_pfu: List[float]
    p95_pfu: List[float]
    explainability: Optional[Dict[str, Any]] = None

@app.get("/api/status")
async def get_system_status():
    """Check if the backend is running."""
    return {"status": "operational", "service": "ISRO PS14 Backend API"}

@app.get("/api/live", response_model=ForecastData)
async def get_live_forecast():
    """Get the latest real-time predictions."""
    try:
        history = db.get_latest_predictions(limit=1)
        if not history:
            logger.warning("No predictions found in database. Is the daemon running?")
            raise HTTPException(status_code=503, detail="Live state not available. Ensure the daemon is running.")
        return history[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Internal Server Error while fetching live forecast: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/api/history", response_model=List[ForecastData])
async def get_history(limit: int = Query(100, ge=1, le=1000)):
    """Get historical predictions for plotting drift."""
    try:
        history = db.get_latest_predictions(limit=limit)
        return history
    except Exception as e:
        logger.error(f"Internal Server Error while fetching history: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/api/v1/forecast/live")
async def get_v1_live_forecast():
    """Format and return live data for the HTML/JS frontend."""
    try:
        # 1. Read predictions from live_state.json
        if not LIVE_STATE_FILE.exists():
            history = db.get_latest_predictions(limit=1)
            if not history:
                raise HTTPException(status_code=503, detail="Live state not available.")
            live_data = history[0]
        else:
            with open(LIVE_STATE_FILE, 'r') as f:
                live_data = json.load(f)
        
        # 2. Fetch live aligned data for history (last 12 hours)
        from src.data.live_fetcher import LiveDataFetcher
        fetcher = LiveDataFetcher()
        raw_df = fetcher.get_latest_aligned_data(hours_back=12)
        
        if raw_df.empty:
            raise HTTPException(status_code=503, detail="Failed to fetch live telemetry.")
            
        # 3. Construct history array for frontend
        history_list = []
        for index, row in raw_df.iterrows():
            history_list.append({
                "time": index.isoformat(),
                "flux": float(row['electron_flux_gt2MeV']) if not pd.isna(row['electron_flux_gt2MeV']) else 0.0,
                "vsw": float(row['Vsw']) if not pd.isna(row['Vsw']) else 400.0,
                "bz": float(row['Bz_GSM']) if not pd.isna(row['Bz_GSM']) else 0.0,
                "np": float(row['Np']) if not pd.isna(row['Np']) else 5.0
            })
            
        # 4. Construct current conditions
        latest_row = raw_df.iloc[-1]
        current_conditions = {
            "electron_flux_gt2MeV": float(latest_row['electron_flux_gt2MeV']) if not pd.isna(latest_row['electron_flux_gt2MeV']) else 0.0,
            "Vsw": float(latest_row['Vsw']) if not pd.isna(latest_row['Vsw']) else 400.0,
            "Bz_GSM": float(latest_row['Bz_GSM']) if not pd.isna(latest_row['Bz_GSM']) else 0.0,
            "Np": float(latest_row['Np']) if not pd.isna(latest_row['Np']) else 5.0,
            "Kp": float(latest_row['Kp']) if not pd.isna(latest_row['Kp']) else 1.0
        }
        
        # 5. Interpolate forecast points for all 144 steps (5-min intervals over 12 hours)
        preds = live_data.get('predictions_pfu', [0.0, 0.0, 0.0])
        p_30m, p_6h, p_12h = preds[0], preds[1], preds[2]
        f_0 = current_conditions['electron_flux_gt2MeV']
        
        forecast_list = []
        t0 = raw_df.index[-1]
        
        for step in range(1, 145):
            t_step = t0 + pd.Timedelta(minutes=step * 5)
            if step <= 6:
                alpha = step / 6.0
                flux = f_0 + alpha * (p_30m - f_0)
            elif step <= 72:
                alpha = (step - 6) / 66.0
                flux = p_30m + alpha * (p_6h - p_30m)
            else:
                alpha = (step - 72) / 72.0
                flux = p_6h + alpha * (p_12h - p_6h)
                
            forecast_list.append({
                "time": t_step.isoformat(),
                "flux": float(flux)
            })
            
        return {
            "current_conditions": current_conditions,
            "history": history_list,
            "forecast": forecast_list
        }
    except Exception as e:
        logger.error(f"Error in v1 live forecast: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Run the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)

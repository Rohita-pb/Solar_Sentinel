import os
import json
import logging
import pandas as pd
from datetime import datetime, timezone
import torch
import numpy as np

from src.utils.config import Config
from src.models.live_inference import LiveInferenceEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s")
logger = logging.getLogger("anomaly_test")

class MockLiveInferenceEngine(LiveInferenceEngine):
    def __init__(self):
        super().__init__()
        
    def run_anomaly_test(self):
        logger.info("Starting anomaly injection test...")
        
        # Original fetcher
        original_fetch = self.fetcher.get_latest_aligned_data
        
        def mock_fetch(*args, **kwargs):
            raw_df = original_fetch(*args, **kwargs)
            if len(raw_df) > 0:
                logger.info("Injecting massive CME anomaly into the last 50 minutes of data...")
                anomaly_steps = 10
                raw_df.iloc[-anomaly_steps:, raw_df.columns.get_loc('electron_flux_gt2MeV')] = np.linspace(100, 5000, anomaly_steps)
                raw_df.iloc[-anomaly_steps:, raw_df.columns.get_loc('Bz_GSM')] = -25.0
                raw_df.iloc[-anomaly_steps:, raw_df.columns.get_loc('Vsw')] = 850.0
                raw_df.iloc[-anomaly_steps:, raw_df.columns.get_loc('Bt')] = 30.0
            return raw_df
            
        self.fetcher.get_latest_aligned_data = mock_fetch
        
        # Run standard inference loop
        self.run_inference()
        
        # Read the output JSON to check the status
        with open(self.state_file, 'r') as f:
            state = json.load(f)
            
        logger.info(f"System detected status: {state['status']} (Current Flux: {state['current_flux_gt2MeV']:.2f} pfu)")
        
        if state['status'] == "CRITICAL":
            logger.info("✅ SUCCESS: The system successfully detected the severe space weather anomaly and raised a Critical status!")
        else:
            logger.error("❌ FAILURE: The system failed to raise a Critical alarm despite injected anomalies.")

if __name__ == "__main__":
    engine = MockLiveInferenceEngine()
    engine.run_anomaly_test()

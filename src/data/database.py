import logging
from sqlalchemy import create_engine, Column, Integer, Float, String, DateTime, JSON
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone

logger = logging.getLogger("database")

Base = declarative_base()

class PredictionRecord(Base):
    __tablename__ = 'predictions'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc))
    latest_data_time = Column(DateTime(timezone=True), index=True)
    
    # Telemetry Health
    api_connection_status = Column(String(50), default="CONNECTED") # CONNECTED, STALE, DISCONNECTED
    
    # Target / Live Features
    current_flux_gt2MeV = Column(Float)
    
    # Core Horizons stored as JSON (e.g. {"30min": 5.6, "6h": 8.1, "12h": 15.2})
    predictions_pfu = Column(JSON)
    p95_pfu = Column(JSON)
    
    # Alert Status
    status = Column(String(50)) # Normal, WARNING, CRITICAL
    
    # SHAP / Feature Explanations
    explainability_features = Column(JSON, nullable=True)


class DatabaseManager:
    def __init__(self, db_url=None):
        """
        Initialize the database connection.
        If TimescaleDB is down or not installed, gracefully fall back to SQLite.
        """
        import os
        self.db_url = db_url or os.environ.get("DB_URL", "postgresql://isro_admin:isro_secure_password@localhost:5432/space_weather")
        try:
            self.engine = create_engine(self.db_url, connect_args={"connect_timeout": 3})
            self.engine.connect() # Test connection
            logger.info(f"Successfully connected to TimescaleDB at {self.db_url}")
        except Exception as e:
            logger.warning(f"Could not connect to TimescaleDB ({e}). Falling back to local SQLite database.")
            self.db_url = "sqlite:///isro_fallback.db"
            self.engine = create_engine(self.db_url)
            
        # Create tables
        Base.metadata.create_all(self.engine)
        
        # Create session factory
        self.Session = sessionmaker(bind=self.engine)
        
    def save_prediction(self, state_dict: dict):
        """Save a live inference state dictionary into the database."""
        session = self.Session()
        try:
            # Parse datetime strings
            ts = datetime.fromisoformat(state_dict['timestamp'].replace('Z', '+00:00'))
            data_ts = datetime.fromisoformat(state_dict['latest_data_time'].replace('Z', '+00:00'))
            
            # Pack horizon lists into mapped dicts for easier querying
            horizons = state_dict['horizons']
            preds_pfu = {h: p for h, p in zip(horizons, state_dict['predictions_pfu'])}
            p95_pfu = {h: p for h, p in zip(horizons, state_dict['p95_pfu'])}
            
            record = PredictionRecord(
                timestamp=ts,
                latest_data_time=data_ts,
                api_connection_status=state_dict.get('connection_status', 'CONNECTED'),
                current_flux_gt2MeV=state_dict['current_flux_gt2MeV'],
                predictions_pfu=preds_pfu,
                p95_pfu=p95_pfu,
                status=state_dict['status'],
                explainability_features=state_dict.get('explainability')
            )
            
            session.add(record)
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Failed to save prediction to database: {e}")
        finally:
            session.close()

    def get_latest_predictions(self, limit=100):
        """Retrieve recent predictions for dashboard plotting."""
        session = self.Session()
        try:
            records = session.query(PredictionRecord).order_by(PredictionRecord.timestamp.desc()).limit(limit).all()
            
            # Serialize
            results = []
            for r in records:
                results.append({
                    "timestamp": r.timestamp.isoformat(),
                    "latest_data_time": r.latest_data_time.isoformat(),
                    "connection_status": r.api_connection_status,
                    "current_flux_gt2MeV": r.current_flux_gt2MeV,
                    "predictions_pfu": list(r.predictions_pfu.values()) if r.predictions_pfu else [],
                    "p95_pfu": list(r.p95_pfu.values()) if r.p95_pfu else [],
                    "status": r.status,
                    "explainability": r.explainability_features
                })
            return results[::-1] # Return chronological order
        except Exception as e:
            logger.error(f"Failed to query database: {e}")
            return []
        finally:
            session.close()

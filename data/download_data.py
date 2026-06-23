"""
Data Download Script for ISRO PS14.

Run this to download all required datasets:
    python data/download_data.py

Or selectively:
    python data/download_data.py --source goes
    python data/download_data.py --source wind
    python data/download_data.py --source omniweb
"""

import sys
import argparse
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.utils.config import Config
from src.utils.logger import setup_logger
from src.data.downloader import DataDownloader


def main():
    parser = argparse.ArgumentParser(description='Download ISRO PS14 datasets')
    parser.add_argument(
        '--source', type=str, default='all',
        choices=['all', 'goes', 'wind', 'omniweb', 'grasp_info'],
        help='Which data source to download'
    )
    parser.add_argument('--start-year', type=int, default=None)
    parser.add_argument('--end-year', type=int, default=None)
    
    args = parser.parse_args()
    
    setup_logger("download", log_file=str(PROJECT_ROOT / 'outputs' / 'download.log'))
    
    config = Config()
    config.ensure_dirs()
    downloader = DataDownloader(config)
    
    if args.source == 'all':
        downloader.download_all()
    elif args.source == 'goes':
        downloader.download_goes(args.start_year, args.end_year)
    elif args.source == 'wind':
        downloader.download_wind_swe(args.start_year, args.end_year)
        downloader.download_wind_mfi(args.start_year, args.end_year)
    elif args.source == 'omniweb':
        downloader.download_omniweb_indices(args.start_year, args.end_year)
    elif args.source == 'grasp_info':
        DataDownloader.print_grasp_instructions()


if __name__ == "__main__":
    main()

"""
Data downloader module using yfinance for fetching historical market data.
"""
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

import pandas as pd
import yfinance as yf
from yfinance import cache as yf_cache

logger = logging.getLogger(__name__)


class DataDownloader:
    """Download historical market data from Yahoo Finance."""

    def __init__(self, data_dir: Path):
        """
        Initialize the data downloader.

        Args:
            data_dir: Directory where downloaded data will be stored
        """
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.data_dir / "downloads_manifest.json"
        self._manifest: Dict[str, Dict[str, Any]] = self._load_manifest()
        self._last_download_time: float = 0.0
        self.min_delay_seconds: float = 10.0
        # ensure yfinance cache lives in a writable location (avoid read-only home dirs)
        cache_dir = self.data_dir / ".yf-cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            yf_cache.set_cache_location(str(cache_dir))
        except Exception as exc:
            logger.warning("Could not set yfinance cache location: %s", exc)

    def _load_manifest(self) -> Dict[str, Dict[str, Any]]:
        if not self.manifest_path.exists():
            return {}
        try:
            data = json.loads(self.manifest_path.read_text())
            if isinstance(data, dict):
                return data
        except Exception:
            logger.warning("Failed to read downloader manifest, starting fresh.")
        return {}

    def _save_manifest(self) -> None:
        try:
            self.manifest_path.write_text(json.dumps(self._manifest, indent=2))
        except Exception as exc:
            logger.error("Failed to persist downloader manifest: %s", exc)

    @staticmethod
    def _request_key(symbol: str, start_date: Optional[str], end_date: Optional[str], period: str) -> str:
        if start_date and end_date:
            return f"{symbol}:{start_date}:{end_date}"
        return f"{symbol}:{period or 'max'}"

    @staticmethod
    def _normalize_date(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d")
            return parsed.strftime("%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"Invalid date format '{value}'. Use YYYY-MM-DD.") from exc

    @staticmethod
    def _format_date_label(ts: Optional[int]) -> Optional[str]:
        if ts is None:
            return None
        return datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")

    def _find_cached_entry(
        self,
        symbol: str,
        start_date: Optional[str],
        end_date: Optional[str],
        period: str,
    ) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
        request_key = self._request_key(symbol, start_date, end_date, period)
        for filename, meta in self._manifest.items():
            if meta.get("request_key") != request_key:
                continue
            path = Path(meta.get("path", ""))
            if not path.exists():
                continue
            return filename, meta
        return None, None

    def _lookup_company_name(self, ticker: Optional[yf.Ticker]) -> Optional[str]:
        try:
            if ticker is None:
                return None
            info = ticker.info
        except Exception:
            return None
        if not isinstance(info, dict):
            return None
        return info.get("longName") or info.get("shortName")

    def manifest_entry_for_filename(self, filename: str) -> Optional[Dict[str, Any]]:
        return self._manifest.get(filename)

    def _download_via_history(
        self,
        ticker: yf.Ticker,
        symbol: str,
        start_date: Optional[str],
        end_date: Optional[str],
        period: str,
        interval: str,
    ) -> pd.DataFrame:
        if start_date and end_date:
            return ticker.history(start=start_date, end=end_date, interval=interval)
        return ticker.history(period=period, interval=interval)

    def _download_via_direct(
        self,
        symbol: str,
        start_date: Optional[str],
        end_date: Optional[str],
        period: str,
        interval: str,
    ) -> pd.DataFrame:
        params = {
            "interval": interval,
            "progress": False,
            "auto_adjust": False,
        }
        if start_date and end_date:
            return yf.download(symbol, start=start_date, end=end_date, **params)
        return yf.download(symbol, period=period, **params)

    def download_symbol(
        self,
        symbol: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        period: str = "max",
        interval: str = "1d",
        refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Download historical data for a symbol.

        Args:
            symbol: Ticker symbol (e.g., 'SPY', 'AAPL')
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            period: Period to download (e.g., '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max')
            interval: Data interval ('1d', '1h', '1m', etc.)

        Returns:
            Dictionary with download status and metadata
        """
        symbol = symbol.upper()
        start_date = self._normalize_date(start_date)
        end_date = self._normalize_date(end_date)
        if bool(start_date) ^ bool(end_date):
            return {
                "success": False,
                "error": "Provide both start_date and end_date, or leave both blank to use period.",
                "symbol": symbol,
            }
        if start_date and end_date:
            if start_date > end_date:
                return {
                    "success": False,
                    "error": "start_date must be before end_date.",
                    "symbol": symbol,
                }

        cached_filename, cached_meta = self._find_cached_entry(symbol, start_date, end_date, period)
        if cached_meta and not refresh:
            cached_meta = dict(cached_meta)
            cached_meta.update({"success": True, "cached": True, "message": "Dataset already downloaded."})
            return cached_meta

        if cached_meta and refresh:
            downloaded_at = cached_meta.get("downloaded_at")
            if downloaded_at:
                try:
                    dl_dt = datetime.fromisoformat(downloaded_at.replace("Z", "+00:00"))
                except ValueError:
                    dl_dt = datetime.min
            else:
                dl_dt = datetime.min
            if datetime.utcnow() - dl_dt < timedelta(hours=24):
                remaining = timedelta(hours=24) - (datetime.utcnow() - dl_dt)
                hours_left = max(0, int(remaining.total_seconds() // 3600))
                minutes_left = max(0, int((remaining.total_seconds() % 3600) // 60))
                return {
                    "success": False,
                    "error": f"Dataset last updated less than 24h ago. Try again in ~{hours_left}h {minutes_left}m.",
                    "symbol": symbol,
                }

        try:
            logger.info(f"Downloading {symbol} from Yahoo Finance...")

            wait_time = self.min_delay_seconds - (time.time() - self._last_download_time)
            if wait_time > 0:
                time.sleep(wait_time)
            self._last_download_time = time.time()

            # Create ticker object (best effort; fallback to direct download if it fails)
            try:
                ticker = yf.Ticker(symbol)
            except Exception as exc:
                logger.warning("Failed to initialize yfinance.Ticker for %s: %s", symbol, exc)
                ticker = None

            # Download historical data with multiple fallbacks
            if ticker is not None:
                try:
                    df = self._download_via_history(ticker, symbol, start_date, end_date, period, interval)
                except Exception as exc:
                    logger.warning("Ticker.history failed for %s (%s). Falling back to direct download.", symbol, exc)
                    df = self._download_via_direct(symbol, start_date, end_date, period, interval)
            else:
                df = self._download_via_direct(symbol, start_date, end_date, period, interval)

            if df.empty:
                logger.warning("history()/download returned empty for %s, attempting final fallback.", symbol)
                df = self._download_via_direct(symbol, start_date, end_date, period, interval)

            if df.empty:
                return {
                    "success": False,
                    "error": f"No data returned for symbol {symbol}. Check the ticker or try a shorter date range.",
                    "symbol": symbol,
                }

            # Reset index to make date a column
            df = df.reset_index()

            # Rename columns to lowercase for consistency
            df.columns = [col.lower() for col in df.columns]

            # Convert datetime to timestamp (milliseconds since epoch)
            if 'date' in df.columns:
                df['timestamp'] = (pd.to_datetime(df['date']).astype(int) // 10**6)
            elif 'datetime' in df.columns:
                df['timestamp'] = (pd.to_datetime(df['datetime']).astype(int) // 10**6)

            # Select only OHLCV columns
            columns_to_keep = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
            df = df[[col for col in columns_to_keep if col in df.columns]]

            # Generate filename
            start_str = df['timestamp'].min() if 'timestamp' in df.columns else 'unknown'
            end_str = df['timestamp'].max() if 'timestamp' in df.columns else 'unknown'

            # Convert timestamps to dates for filename
            if start_str != 'unknown':
                start_date_str = datetime.fromtimestamp(start_str / 1000).strftime('%Y%m%d')
                end_date_str = datetime.fromtimestamp(end_str / 1000).strftime('%Y%m%d')
                filename = f"{symbol}_{start_date_str}-{end_date_str}.csv"
            else:
                filename = f"{symbol}_downloaded.csv"

            filepath = self.data_dir / filename

            # Save as CSV
            df.to_csv(filepath, index=False)

            company_name = self._lookup_company_name(ticker) if ticker is not None else None
            display_name = f"{company_name} ({symbol})" if company_name else symbol

            start_ts = int(df["timestamp"].min()) if "timestamp" in df.columns else None
            end_ts = int(df["timestamp"].max()) if "timestamp" in df.columns else None

            start_label = self._format_date_label(start_ts)
            end_label = self._format_date_label(end_ts)

            metadata: Dict[str, Any] = {
                "symbol": symbol,
                "company_name": company_name,
                "display_name": display_name,
                "filename": filename,
                "path": str(filepath),
                "rows": len(df),
                "start": start_ts,
                "end": end_ts,
                "columns": list(df.columns),
                "start_date_label": start_label,
                "end_date_label": end_label,
                "date_range_label": f"{start_label} → {end_label}" if start_label and end_label else None,
                "downloaded_at": datetime.utcnow().isoformat() + "Z",
                "request_key": self._request_key(symbol, start_date, end_date, period),
                "start_param": start_date,
                "end_param": end_date,
                "period": period,
            }

            # Remove cached entry if refreshing
            if cached_filename and cached_filename in self._manifest:
                old_path = Path(self._manifest[cached_filename].get("path", ""))
                if old_path.exists():
                    try:
                        old_path.unlink()
                    except Exception:
                        logger.warning("Failed to delete old dataset %s", old_path)
                self._manifest.pop(cached_filename, None)

            self._manifest[filename] = metadata
            self._save_manifest()

            logger.info(f"Successfully downloaded {len(df)} rows for {symbol} to {filepath}")

            metadata.update({"success": True, "cached": False})
            return metadata

        except Exception as e:
            logger.error(f"Error downloading {symbol}: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "symbol": symbol
            }

    def get_symbol_info(self, symbol: str) -> Dict[str, Any]:
        """
        Get information about a symbol without downloading data.

        Args:
            symbol: Ticker symbol

        Returns:
            Dictionary with symbol information
        """
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info

            return {
                "success": True,
                "symbol": symbol,
                "name": info.get("longName", symbol),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "exchange": info.get("exchange"),
                "currency": info.get("currency", "USD")
            }
        except Exception as e:
            logger.error(f"Error getting info for {symbol}: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "symbol": symbol
            }

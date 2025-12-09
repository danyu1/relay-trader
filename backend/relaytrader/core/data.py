from __future__ import annotations

from pathlib import Path
from typing import Iterable, Protocol, List, Optional, Union

import pandas as pd

from .types import Bar


class BarDataFeed(Protocol):
    def bars(self) -> Iterable[Bar]:
        ...


class CSVBarDataFeed:
    """
    simple CSV loader for OHLCV data.
    Expected columns: timestamp, open, high, low, close, volume
    """

    def __init__(self, csv_path: str | Path, symbol: str):
        self.csv_path = Path(csv_path)
        self.symbol = symbol

    @staticmethod
    def _parse_timestamp(ts: Union[int, float, str]) -> int:
        if isinstance(ts, (int, float)):
            return int(ts)
        if isinstance(ts, str):
            dt = pd.to_datetime(ts, errors="coerce")
            if pd.isna(dt):
                raise ValueError(f"Invalid timestamp: {ts}")
            return int(dt.timestamp() * 1000)  # ms since epoch
        raise ValueError(f"Unsupported timestamp type: {type(ts)}")

    def bars(self) -> Iterable[Bar]:
        df = pd.read_csv(self.csv_path)
        for row in df.itertuples(index=False):
            ts_raw = getattr(row, "timestamp")
            ts = self._parse_timestamp(ts_raw)
            o = float(getattr(row, "open"))
            h = float(getattr(row, "high"))
            l = float(getattr(row, "low"))
            c = float(getattr(row, "close"))
            v = float(getattr(row, "volume"))
            yield Bar(timestamp=ts, symbol=self.symbol, open=o, high=h, low=l, close=c, volume=v)


def inspect_csv(path: str | Path) -> dict:
    """
    Validate a CSV for OHLCV schema and return metadata.
    Schema: timestamp, open, high, low, close, volume
    """
    csv_path = Path(path)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)
    required = ["timestamp", "open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    # basic type/na checks
    subset = df[required]
    if subset.isnull().any().any():
        raise ValueError("CSV contains nulls in required columns")

    # ensure numeric columns
    for col in ["open", "high", "low", "close", "volume"]:
        subset[col] = pd.to_numeric(subset[col], errors="coerce")
        if subset[col].isnull().any():
            raise ValueError(f"Non-numeric values in column: {col}")

    # timestamps normalize and monotonic
    parsed_ts = subset["timestamp"].apply(CSVBarDataFeed._parse_timestamp)
    if parsed_ts.isnull().any():
        raise ValueError("Non-numeric timestamps found")
    if (parsed_ts.diff().dropna() < 0).any():
        raise ValueError("Timestamps are not monotonically increasing")

    # normalize timestamps to int (allow ISO8601 strings but they should have parsed)
    start_val: Optional[int] = int(parsed_ts.iloc[0]) if len(parsed_ts) > 0 else None
    end_val: Optional[int] = int(parsed_ts.iloc[-1]) if len(parsed_ts) > 0 else None

    meta = {
        "rows": int(len(df)),
        "start": start_val,
        "end": end_val,
        "columns": list(df.columns),
        "path": str(csv_path.resolve()),
    }
    return meta

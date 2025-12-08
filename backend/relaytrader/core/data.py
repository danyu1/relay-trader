from __future__ import annotations

from pathlib import Path
from typing import Iterable, Protocol, List

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

    def bars(self) -> Iterable[Bar]:
        df = pd.read_csv(self.csv_path)
        for row in df.itertuples(index=False):
            ts = getattr(row, "timestamp")
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

    # timestamps monotonic
    ts = subset["timestamp"]
    if (ts.diff().dropna() < 0).any():
        raise ValueError("Timestamps are not monotonically increasing")

    meta = {
        "rows": int(len(df)),
        "start": int(ts.iloc[0]) if len(ts) > 0 else None,
        "end": int(ts.iloc[-1]) if len(ts) > 0 else None,
        "columns": list(df.columns),
        "path": str(csv_path.resolve()),
    }
    return meta

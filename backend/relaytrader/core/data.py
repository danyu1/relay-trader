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

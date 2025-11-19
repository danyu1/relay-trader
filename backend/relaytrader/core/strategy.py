from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Protocol, Dict, Any, Iterable, Optional

from .types import Bar, Tick, Side, OrderType, TimeInForce, Order


class BrokerContext(Protocol):
    """
    Methods that a Strategy can call to interact with the broker/backtester.
    """

    def buy(
        self,
        symbol: str,
        qty: float,
        order_type: OrderType = OrderType.MARKET,
        limit_price: float | None = None,
        stop_price: float | None = None,
        time_in_force: TimeInForce = TimeInForce.DAY,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Order:
        ...

    def sell(
        self,
        symbol: str,
        qty: float,
        order_type: OrderType = OrderType.MARKET,
        limit_price: float | None = None,
        stop_price: float | None = None,
        time_in_force: TimeInForce = TimeInForce.DAY,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Order:
        ...

    def cancel(self, order_id: int) -> None:
        ...

    def get_position_qty(self, symbol: str) -> float:
        ...

    def get_cash(self) -> float:
        ...

    def get_equity(self) -> float:
        ...

    #Historical helpers
    def get_history(
        self, symbol: str, field: str, lookback: int
    ) -> Iterable[float]:
        ...


class Strategy(ABC):
    """
    Base class users subclass.
    """

    def __init__(self, context: BrokerContext, params: Dict[str, Any] | None = None):
        self.context = context
        self.params = params or {}

    #lifecycle hooks
    def on_start(self) -> None:
        """Called once before data starts."""
        ...

    def on_end(self) -> None:
        """Called once after data ends."""
        ...

    #event handlers
    def on_bar(self, bar: Bar) -> None:
        """Override for bar-based strategies."""
        ...

    def on_tick(self, tick: Tick) -> None:
        """Override for tick-based strategies."""
        ...

    def on_order_fill(self, fill) -> None:
        """Called every time an order is filled. Fill type defined in broker."""
        ...

    #helper examples
    def zscore(self, symbol: str, field: str, lookback: int) -> float | None:
        """
        Compute z-score of last value over lookback window for given series.
        """
        hist = list(self.context.get_history(symbol, field, lookback))
        if len(hist) < lookback:
            return None
        import numpy as np

        arr = np.array(hist)
        mean = arr.mean()
        std = arr.std()
        if std == 0:
            return None
        return (arr[-1] - mean) / std

    #convenience wrappers
    def buy(
        self,
        symbol: str,
        qty: float,
        order_type: OrderType = OrderType.MARKET,
        limit_price: float | None = None,
        stop_price: float | None = None,
        time_in_force: TimeInForce = TimeInForce.DAY,
    ) -> Order:
        return self.context.buy(
            symbol,
            qty,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
        )

    def sell(
        self,
        symbol: str,
        qty: float,
        order_type: OrderType = OrderType.MARKET,
        limit_price: float | None = None,
        stop_price: float | None = None,
        time_in_force: TimeInForce = TimeInForce.DAY,
    ) -> Order:
        return self.context.sell(
            symbol,
            qty,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
        )

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional, Dict


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"


class TimeInForce(str, Enum):
    DAY = "DAY"
    GTC = "GTC"  #good till cancelled


class OrderStatus(str, Enum):
    NEW = "NEW"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


@dataclass
class Bar:
    """
    Standard OHLCV bar.
    """
    timestamp: int  #POSIX ms, or any monotonically increasing int
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Tick:
    """
    Simple trade tick; you can extend to include best bid/ask.
    """
    timestamp: int
    symbol: str
    price: float
    size: float


@dataclass
class Order:
    id: int
    symbol: str
    side: Side
    qty: float
    order_type: OrderType
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    status: OrderStatus = OrderStatus.NEW
    filled_qty: float = 0.0
    avg_fill_price: float = 0.0
    metadata: Dict[str, str] | None = None


@dataclass
class Fill:
    """
    Represents a single fill event for an order.
    """
    order_id: int
    timestamp: int
    symbol: str
    side: Side
    qty: float
    price: float
    commission: float = 0.0
    slippage: float = 0.0


@dataclass
class Position:
    symbol: str
    qty: float = 0.0
    avg_price: float = 0.0

    def apply_fill(self, fill: Fill) -> None:
        """
        Update position after a fill.
        """
        if self.qty == 0:
            #open a new position
            self.qty = fill.qty if fill.side == Side.BUY else -fill.qty
            self.avg_price = fill.price
            return

        signed_qty = fill.qty if fill.side == Side.BUY else -fill.qty
        new_qty = self.qty + signed_qty

        #same side adding to position
        if self.qty * signed_qty > 0:
            total_cost = self.avg_price * abs(self.qty) + fill.price * abs(signed_qty)
            self.qty = new_qty
            self.avg_price = total_cost / abs(self.qty)
        else:
            #Reducing or flipping
            if self.qty * new_qty > 0:
                #Partial reduce
                self.qty = new_qty
                #avg_price unchanged
            elif new_qty == 0:
                #Closed
                self.qty = 0.0
                self.avg_price = 0.0
            else:
                #Flipped side
                self.qty = new_qty
                self.avg_price = fill.price

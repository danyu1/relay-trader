from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Iterable, Optional

from .types import (
    Bar,
    Side,
    Order,
    OrderType,
    TimeInForce,
    OrderStatus,
    Fill,
    Position,
)
from .strategy import BrokerContext


@dataclass
class Portfolio:
    cash: float
    positions: Dict[str, Position] = field(default_factory=dict)
    equity: float = 0.0

    def update_equity(self, prices: Dict[str, float]) -> None:
        self.equity = self.cash
        for sym, pos in self.positions.items():
            px = prices.get(sym)
            if px is not None:
                self.equity += pos.qty * px

    def apply_fill(self, fill: Fill) -> None:
        symbol = fill.symbol
        if symbol not in self.positions:
            self.positions[symbol] = Position(symbol=symbol)
        pos = self.positions[symbol]
        before_qty = pos.qty
        pos.apply_fill(fill)
        # cash update
        sign = 1 if fill.side == Side.SELL else -1
        self.cash += sign * fill.qty * fill.price - fill.commission - fill.slippage
        #iff position fully closed, you could drop it:
        if self.positions[symbol].qty == 0:
            # eep avg_price = 0 from Position.apply_fill
            pass


class SimpleBroker(BrokerContext):
    """
    Broker for backtests with simple microstructure model:
    - Market orders fill at bar.close
    - Limit buy: fill if bar.low <= limit_price
    - Limit sell: fill if bar.high >= limit_price
    """

    def __init__(self, initial_cash: float, symbol: str, commission_per_trade: float = 0.0):
        self.portfolio = Portfolio(cash=initial_cash)
        self.symbol = symbol
        self.commission_per_trade = commission_per_trade

        self._orders: Dict[int, Order] = {}
        self._fills: List[Fill] = []
        self._next_order_id: int = 1

        #simple history
        self._price_history: Dict[str, Dict[str, List[float]]] = {
            symbol: {"open": [], "high": [], "low": [], "close": [], "volume": []}
        }

        self._current_bar: Optional[Bar] = None

#broker context methods

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
        return self._submit_order(
            symbol,
            qty,
            side=Side.BUY,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            metadata=metadata,
        )

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
        return self._submit_order(
            symbol,
            qty,
            side=Side.SELL,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            metadata=metadata,
        )

    def cancel(self, order_id: int) -> None:
        order = self._orders.get(order_id)
        if order and order.status in (OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED):
            order.status = OrderStatus.CANCELLED

    def get_position_qty(self, symbol: str) -> float:
        pos = self.portfolio.positions.get(symbol)
        return pos.qty if pos else 0.0

    def get_cash(self) -> float:
        return self.portfolio.cash

    def get_equity(self) -> float:
        return self.portfolio.equity

    def get_history(self, symbol: str, field: str, lookback: int) -> Iterable[float]:
        hist = self._price_history.get(symbol, {}).get(field, [])
        if lookback <= 0:
            return hist
        return hist[-lookback:]

# some of the internal methods

    def _submit_order(
        self,
        symbol: str,
        qty: float,
        side: Side,
        order_type: OrderType,
        limit_price: float | None,
        stop_price: float | None,
        time_in_force: TimeInForce,
        metadata: Optional[Dict[str, str]],
    ) -> Order:
        oid = self._next_order_id
        self._next_order_id += 1

        order = Order(
            id=oid,
            symbol=symbol,
            side=side,
            qty=qty,
            order_type=order_type,
            time_in_force=time_in_force,
            limit_price=limit_price,
            stop_price=stop_price,
            metadata=metadata,
        )
        self._orders[oid] = order
        return order

    def on_bar(self, bar: Bar) -> List[Fill]:
        """
        Called by BacktestEngine each bar. Updates history, simulates fills,
        updates portfolio, returns fills for strategy hook.
        """
        self._current_bar = bar

        #update history
        hist = self._price_history[self.symbol]
        hist["open"].append(bar.open)
        hist["high"].append(bar.high)
        hist["low"].append(bar.low)
        hist["close"].append(bar.close)
        hist["volume"].append(bar.volume)

        fills: List[Fill] = []
        #simple one-shot execution model (no partials for now)
        for order in list(self._orders.values()):
            if order.status not in (OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED):
                continue

            fill_price: Optional[float] = None

            if order.order_type == OrderType.MARKET:
                fill_price = bar.close

            elif order.order_type == OrderType.LIMIT:
                if order.side == Side.BUY and order.limit_price is not None:
                    if bar.low <= order.limit_price:
                        fill_price = min(order.limit_price, bar.close)
                elif order.side == Side.SELL and order.limit_price is not None:
                    if bar.high >= order.limit_price:
                        fill_price = max(order.limit_price, bar.close)

            #(STOP, STOP_LIMIT, etc. can be added later)

            if fill_price is not None:
                fill = Fill(
                    order_id=order.id,
                    timestamp=bar.timestamp,
                    symbol=order.symbol,
                    side=order.side,
                    qty=order.qty - order.filled_qty,
                    price=fill_price,
                    commission=self.commission_per_trade,
                    slippage=0.0,
                )
                fills.append(fill)

                #apply to portfolio
                self.portfolio.apply_fill(fill)

                #update order
                order.filled_qty += fill.qty
                order.avg_fill_price = fill.price  #no multi-fill averaging in v1
                order.status = OrderStatus.FILLED

                self._fills.append(fill)

        self.portfolio.update_equity({self.symbol: bar.close})
        return fills

    @property
    def orders(self) -> Dict[int, Order]:
        return self._orders

    @property
    def fills(self) -> List[Fill]:
        return self._fills

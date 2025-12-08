from __future__ import annotations

from dataclasses import dataclass
from typing import Type, Dict, Any, List, Optional

from .types import Bar
from .strategy import Strategy
from .data import BarDataFeed
from .broker import SimpleBroker
from .metrics import PerformanceStats, compute_performance, compute_trade_stats, TradeStats


@dataclass
class BacktestConfig:
    symbol: str
    initial_cash: float = 100_000.0
    commission_per_trade: float = 0.0
    slippage_bps: float = 0.0
    max_bars: Optional[int] = None  #for debugging


@dataclass
class BacktestResult:
    config: BacktestConfig
    stats: PerformanceStats
    trade_stats: TradeStats
    trades: List[Dict[str, Any]]  #simplified; you can structure later
    orders: List[Dict[str, Any]]


class BacktestEngine:
    """
    Orchestrates the backtest: feeds bars to strategy + broker, collects results.
    """

    def __init__(self, data_feed: BarDataFeed, config: BacktestConfig):
        self.data_feed = data_feed
        self.config = config

    def run(
        self,
        strategy_cls: Type[Strategy],
        strategy_params: Dict[str, Any] | None = None,
    ) -> BacktestResult:
        broker = SimpleBroker(
            initial_cash=self.config.initial_cash,
            symbol=self.config.symbol,
            commission_per_trade=self.config.commission_per_trade,
            slippage_bps=self.config.slippage_bps,
        )

        strategy = strategy_cls(context=broker, params=strategy_params)

        equity_curve: List[float] = []

        strategy.on_start()

        for i, bar in enumerate(self.data_feed.bars()):
            if self.config.max_bars is not None and i >= self.config.max_bars:
                break

            fills = broker.on_bar(bar)
            for fill in fills:
                strategy.on_order_fill(fill)

            strategy.on_bar(bar)

            equity_curve.append(broker.get_equity())

        strategy.on_end()

        stats = compute_performance(equity_curve)
        trade_stats, realized_list = compute_trade_stats(broker.fills, initial_cash=self.config.initial_cash)

        #serialize orders + trades for reporting
        trades: List[Dict[str, Any]] = []
        for fill, realized in zip(broker.fills, realized_list):
            trades.append(
                {
                    "order_id": fill.order_id,
                    "timestamp": fill.timestamp,
                    "symbol": fill.symbol,
                    "side": fill.side.value,
                    "qty": fill.qty,
                    "price": fill.price,
                    "commission": fill.commission,
                    "slippage": fill.slippage,
                    "realized_pnl": realized,
                }
            )

        orders: List[Dict[str, Any]] = []
        for order in broker.orders.values():
            orders.append(
                {
                    "id": order.id,
                    "symbol": order.symbol,
                    "side": order.side.value,
                    "qty": order.qty,
                    "order_type": order.order_type.value,
                    "status": order.status.value,
                    "limit_price": order.limit_price,
                    "stop_price": order.stop_price,
                    "filled_qty": order.filled_qty,
                    "avg_fill_price": order.avg_fill_price,
                }
            )

        return BacktestResult(
            config=self.config,
            stats=stats,
            trade_stats=trade_stats,
            trades=trades,
            orders=orders,
        )

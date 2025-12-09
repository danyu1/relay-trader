from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Type

from relaytrader.core.strategy import Strategy
from relaytrader.core.types import Bar, OrderType


@dataclass
class StrategyParam:
    name: str
    type: str
    default: Any
    min: float | None = None
    max: float | None = None


@dataclass
class StrategyDefinition:
    id: str
    name: str
    description: str
    params: List[StrategyParam]
    cls: Type[Strategy]


class MeanReversionZScore(Strategy):
    """
    Simple mean reversion on close z-score.
    """

    def on_bar(self, bar: Bar) -> None:
        lookback = int(self.params.get("lookback", 50))
        entry = float(self.params.get("entry_z", 2.0))
        exit_z = float(self.params.get("exit_z", 0.5))

        z = self.zscore(bar.symbol, "close", lookback)
        if z is None:
            return

        pos = self.context.get_position_qty(bar.symbol)
        if z > entry and pos > 0:
            self.sell(bar.symbol, pos, OrderType.MARKET)
        elif z < -entry and pos >= 0:
            self.buy(bar.symbol, 1, OrderType.MARKET)
        elif abs(z) < exit_z and pos != 0:
            # flatten when reversion achieved
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            else:
                self.buy(bar.symbol, -pos, OrderType.MARKET)


class SmaCross(Strategy):
    """
    Fast/slow SMA crossover on close.
    """

    def on_bar(self, bar: Bar) -> None:
        fast = int(self.params.get("fast", 10))
        slow = int(self.params.get("slow", 40))
        if fast >= slow:
            return

        history_fast = list(self.context.get_history(bar.symbol, "close", slow))
        if len(history_fast) < slow:
            return
        fast_ma = sum(history_fast[-fast:]) / fast
        slow_ma = sum(history_fast) / slow

        pos = self.context.get_position_qty(bar.symbol)
        if fast_ma > slow_ma and pos <= 0:
            if pos < 0:
                self.buy(bar.symbol, -pos, OrderType.MARKET)
            self.buy(bar.symbol, 1, OrderType.MARKET)
        elif fast_ma < slow_ma and pos >= 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            self.sell(bar.symbol, 1, OrderType.MARKET)


BUILTIN_STRATEGIES: Dict[str, StrategyDefinition] = {
    "mean_reversion": StrategyDefinition(
        id="mean_reversion",
        name="Mean Reversion (Z-Score)",
        description="Buy when close z-score below -entry, exit/flip when above +entry.",
        params=[
          StrategyParam("lookback", "int", 50, min=10, max=200),
          StrategyParam("entry_z", "float", 2.0, min=0.5, max=5.0),
          StrategyParam("exit_z", "float", 0.5, min=0.0, max=2.0),
        ],
        cls=MeanReversionZScore,
    ),
    "sma_cross": StrategyDefinition(
        id="sma_cross",
        name="SMA Crossover",
        description="Fast/slow SMA on close; go long when fast>slow, short when fast<slow.",
        params=[
          StrategyParam("fast", "int", 10, min=2, max=200),
          StrategyParam("slow", "int", 40, min=5, max=400),
        ],
        cls=SmaCross,
    ),
}


def list_strategies() -> List[Dict[str, Any]]:
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "params": [
                {"name": p.name, "type": p.type, "default": p.default, "min": p.min, "max": p.max}
                for p in s.params
            ],
        }
        for s in BUILTIN_STRATEGIES.values()
    ]


def get_strategy_class(strategy_id: str) -> StrategyDefinition:
    if strategy_id not in BUILTIN_STRATEGIES:
        raise ValueError(f"Unknown strategy id: {strategy_id}")
    return BUILTIN_STRATEGIES[strategy_id]

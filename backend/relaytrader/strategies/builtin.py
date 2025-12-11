from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Type

from relaytrader.core.strategy import BrokerContext, Strategy
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


class RsiReversion(Strategy):
    """
    Buy oversold RSI, short overbought RSI.
    """

    def on_bar(self, bar: Bar) -> None:
        length = int(self.params.get("length", 14))
        overbought = float(self.params.get("overbought", 70))
        oversold = float(self.params.get("oversold", 30))
        qty = float(self.params.get("qty", 1))

        closes = list(self.context.get_history(bar.symbol, "close", length + 1))
        if len(closes) < length + 1:
            return
        gains: list[float] = []
        losses: list[float] = []
        for i in range(1, len(closes)):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        avg_gain = sum(gains[-length:]) / length
        avg_loss = sum(losses[-length:]) / length
        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

        pos = self.context.get_position_qty(bar.symbol)
        if rsi < oversold and pos <= 0:
            if pos < 0:
                self.buy(bar.symbol, -pos, OrderType.MARKET)
            self.buy(bar.symbol, qty, OrderType.MARKET)
        elif rsi > overbought and pos >= 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            self.sell(bar.symbol, qty, OrderType.MARKET)
        elif oversold < rsi < overbought and pos != 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            else:
                self.buy(bar.symbol, -pos, OrderType.MARKET)


class BollingerMeanReversion(Strategy):
    """
    Fade moves outside Bollinger Bands, flatten near mean.
    """

    def on_bar(self, bar: Bar) -> None:
        lookback = int(self.params.get("lookback", 20))
        dev = float(self.params.get("num_std", 2.0))
        qty = float(self.params.get("qty", 1))

        prices = list(self.context.get_history(bar.symbol, "close", lookback))
        if len(prices) < lookback:
            return
        mean = sum(prices) / lookback
        variance = sum((p - mean) ** 2 for p in prices) / lookback
        std = variance ** 0.5
        upper = mean + dev * std
        lower = mean - dev * std

        pos = self.context.get_position_qty(bar.symbol)
        if bar.close < lower and pos <= 0:
            if pos < 0:
                self.buy(bar.symbol, -pos, OrderType.MARKET)
            self.buy(bar.symbol, qty, OrderType.MARKET)
        elif bar.close > upper and pos >= 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            self.sell(bar.symbol, qty, OrderType.MARKET)
        elif lower <= bar.close <= upper and pos != 0:
            if pos > 0 and bar.close >= mean:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            elif pos < 0 and bar.close <= mean:
                self.buy(bar.symbol, -pos, OrderType.MARKET)


class DonchianBreakout(Strategy):
    """
    Enter on channel breakouts, flip on opposite break.
    """

    def on_bar(self, bar: Bar) -> None:
        lookback = int(self.params.get("lookback", 55))
        qty = float(self.params.get("qty", 1))

        highs = list(self.context.get_history(bar.symbol, "high", lookback + 1))
        lows = list(self.context.get_history(bar.symbol, "low", lookback + 1))
        if len(highs) < lookback + 1 or len(lows) < lookback + 1:
            return
        upper = max(highs[:-1])
        lower = min(lows[:-1])

        pos = self.context.get_position_qty(bar.symbol)
        if bar.high > upper and pos <= 0:
            if pos < 0:
                self.buy(bar.symbol, -pos, OrderType.MARKET)
            self.buy(bar.symbol, qty, OrderType.MARKET)
        elif bar.low < lower and pos >= 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            self.sell(bar.symbol, qty, OrderType.MARKET)


class PercentMomentum(Strategy):
    """
    Compare current price to lookback percentage change.
    """

    def on_bar(self, bar: Bar) -> None:
        lookback = int(self.params.get("lookback", 20))
        threshold = float(self.params.get("threshold", 0.02))
        qty = float(self.params.get("qty", 1))

        closes = list(self.context.get_history(bar.symbol, "close", lookback + 1))
        if len(closes) < lookback + 1:
            return
        pct_change = (closes[-1] / closes[0]) - 1

        pos = self.context.get_position_qty(bar.symbol)
        if pct_change > threshold and pos <= 0:
            if pos < 0:
                self.buy(bar.symbol, -pos, OrderType.MARKET)
            self.buy(bar.symbol, qty, OrderType.MARKET)
        elif pct_change < -threshold and pos >= 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            self.sell(bar.symbol, qty, OrderType.MARKET)
        elif abs(pct_change) < threshold / 2 and pos != 0:
            if pos > 0:
                self.sell(bar.symbol, pos, OrderType.MARKET)
            else:
                self.buy(bar.symbol, -pos, OrderType.MARKET)


class BuyAndHold(Strategy):
    """
    Deploy capital once and hold.
    """

    def __init__(self, context: BrokerContext, params: Dict[str, Any] | None = None):
        super().__init__(context, params)
        self.executed = False

    def on_bar(self, bar: Bar) -> None:
        if self.executed:
            return
        qty = float(self.params.get("qty", 1))
        self.buy(bar.symbol, qty, OrderType.MARKET)
        self.executed = True


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
    "rsi_reversion": StrategyDefinition(
        id="rsi_reversion",
        name="RSI Fade",
        description="Fade RSI extremes; buy oversold, short overbought.",
        params=[
            StrategyParam("length", "int", 14, min=5, max=50),
            StrategyParam("oversold", "float", 30.0, min=5, max=45),
            StrategyParam("overbought", "float", 70.0, min=55, max=95),
            StrategyParam("qty", "float", 1.0, min=0.5, max=10),
        ],
        cls=RsiReversion,
    ),
    "bollinger_reversion": StrategyDefinition(
        id="bollinger_reversion",
        name="Bollinger Mean Reversion",
        description="Enter against Bollinger Band extremes, flatten near the mean.",
        params=[
            StrategyParam("lookback", "int", 20, min=10, max=200),
            StrategyParam("num_std", "float", 2.0, min=0.5, max=4.0),
            StrategyParam("qty", "float", 1.0, min=0.5, max=10),
        ],
        cls=BollingerMeanReversion,
    ),
    "donchian_breakout": StrategyDefinition(
        id="donchian_breakout",
        name="Donchian Breakout",
        description="Trend-following breakout using channel highs/lows.",
        params=[
            StrategyParam("lookback", "int", 55, min=10, max=200),
            StrategyParam("qty", "float", 1.0, min=0.5, max=10),
        ],
        cls=DonchianBreakout,
    ),
    "percent_momentum": StrategyDefinition(
        id="percent_momentum",
        name="Percent Momentum",
        description="Compare price to historical average move and follow the direction.",
        params=[
            StrategyParam("lookback", "int", 20, min=5, max=200),
            StrategyParam("threshold", "float", 0.02, min=0.005, max=0.1),
            StrategyParam("qty", "float", 1.0, min=0.5, max=10),
        ],
        cls=PercentMomentum,
    ),
    "buy_and_hold": StrategyDefinition(
        id="buy_and_hold",
        name="Buy & Hold",
        description="Purchase a fixed quantity on the first bar and hold.",
        params=[StrategyParam("qty", "float", 1.0, min=0.1, max=100)],
        cls=BuyAndHold,
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

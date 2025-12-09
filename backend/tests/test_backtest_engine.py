from pathlib import Path

import pandas as pd

from relaytrader.core.backtest import BacktestConfig, BacktestEngine
from relaytrader.core.data import CSVBarDataFeed
from relaytrader.core.strategy import Strategy
from relaytrader.core.types import Bar


class BuyThenSell(Strategy):
    def on_bar(self, bar: Bar) -> None:
        pos = self.context.get_position_qty(bar.symbol)
        if bar.timestamp == 1:
            self.buy(bar.symbol, 1)
        elif bar.timestamp == 2 and pos > 0:
            self.sell(bar.symbol, pos)


def test_backtest_engine_metrics(tmp_path: Path):
    csv = tmp_path / "bars.csv"
    df = pd.DataFrame(
        {
            "timestamp": [1, 2, 3],
            "open": [100.0, 101.0, 103.0],
            "high": [101.0, 103.0, 104.0],
            "low": [99.0, 100.0, 102.0],
            "close": [101.0, 103.0, 104.0],
            "volume": [1000, 1200, 1300],
        }
    )
    df.to_csv(csv, index=False)

    feed = CSVBarDataFeed(csv_path=csv, symbol="AAPL")
    cfg = BacktestConfig(symbol="AAPL", initial_cash=100_000.0)
    engine = BacktestEngine(feed, cfg)
    result = engine.run(BuyThenSell)

    assert len(result.stats.equity_curve) == 3
    assert result.trade_stats.num_trades == 1  # realized on the sell
    assert result.trade_stats.win_rate >= 0.0
    assert result.trade_stats.net_pnl > 0
    assert result.trades[-1]["realized_pnl"] > 0

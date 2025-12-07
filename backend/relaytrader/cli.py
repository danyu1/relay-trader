from __future__ import annotations

import argparse
import importlib
from pathlib import Path
from typing import Type
from datetime import datetime

from .core.backtest import BacktestConfig, BacktestEngine
from .core.strategy import Strategy
from .core.data import CSVBarDataFeed
from .reporting.html_report import generate_html_report


def load_strategy(path: str) -> Type[Strategy]:
    """
    some path like: 'package.module.ClassName'
    """
    parts = path.split(".")
    if len(parts) < 2:
        raise ValueError("Strategy path must be 'module.ClassName' or 'pkg.module.ClassName'")
    module_path = ".".join(parts[:-1])
    class_name = parts[-1]
    mod = importlib.import_module(module_path)
    cls = getattr(mod, class_name)
    return cls


def main() -> None:
    parser = argparse.ArgumentParser(description="RelayTrader Backtest CLI")
    parser.add_argument("--strategy", required=True, help="Python path to Strategy class")
    parser.add_argument("--csv", required=True, help="Path to CSV file with OHLCV")
    parser.add_argument("--symbol", required=True, help="Symbol name")
    parser.add_argument("--cash", type=float, default=100_000.0)
    parser.add_argument("--commission", type=float, default=0.0)
    parser.add_argument("--max-bars", type=int, default=None)

    args = parser.parse_args()

    strategy_cls = load_strategy(args.strategy)
    feed = CSVBarDataFeed(csv_path=Path(args.csv), symbol=args.symbol)
    config = BacktestConfig(
        symbol=args.symbol,
        initial_cash=args.cash,
        commission_per_trade=args.commission,
        max_bars=args.max_bars,
    )

    engine = BacktestEngine(data_feed=feed, config=config)
    result = engine.run(strategy_cls=strategy_cls)

    print("=== Backtest Summary ===")
    print(f"Symbol: {config.symbol}")
    print(f"Initial cash: {config.initial_cash:,.2f}")
    print(f"Final equity: {result.stats.equity_curve[-1]:,.2f}")
    print(f"Total return: {result.stats.total_return * 100:.2f}%")
    print(f"Annualized return: {result.stats.annualized_return * 100:.2f}%")
    print(f"Volatility: {result.stats.volatility * 100:.2f}%")
    print(f"Sharpe: {result.stats.sharpe:.2f}")
    print(f"Max drawdown: {result.stats.max_drawdown * 100:.2f}%")

    reports_dir = Path("reports")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_name = f"report_{args.symbol}_{ts}.html"
    report_path = reports_dir / report_name

    generate_html_report(result, report_path)
    print(f"\nHTML report written to: {report_path.resolve()}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import importlib.util
import sys
import textwrap
import tempfile
from pathlib import Path
from typing import Dict, Any, Type

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ..core.backtest import BacktestConfig, BacktestEngine, BacktestResult
from ..core.strategy import Strategy
from ..core.data import CSVBarDataFeed

app = FastAPI(title="RelayTrader API", version="0.1.0")


class BacktestRequest(BaseModel):
    strategy_code: str
    strategy_class_name: str = "UserStrategy"
    csv_path: str
    symbol: str
    initial_cash: float = 100_000.0
    commission_per_trade: float = 0.0
    max_bars: int | None = None
    strategy_params: Dict[str, Any] | None = None


class BacktestResponse(BaseModel):
    config: Dict[str, Any]
    stats: Dict[str, Any]
    trades: list[Dict[str, Any]]
    orders: list[Dict[str, Any]]


def load_strategy_from_code(code: str, class_name: str) -> Type[Strategy]:
    """
    The goal is to dynamically load a Strategy subclass from a string of Python code.
    Not for untrusted prod use; wrap this in sandbox/containers later.
    """
    tmp_dir = tempfile.mkdtemp(prefix="relaytrader_strategy_")
    file_path = Path(tmp_dir) / "user_strategy.py"
    #ensure we can 'from relaytrader import Strategy'
    wrapped_code = textwrap.dedent(code)
    file_path.write_text(wrapped_code)

    spec = importlib.util.spec_from_file_location("user_strategy", file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load strategy module")

    module = importlib.util.module_from_spec(spec)
    sys.modules["user_strategy"] = module
    spec.loader.exec_module(module)  #type: ignore[attr-defined]

    cls = getattr(module, class_name, None)
    if cls is None:
        raise RuntimeError(f"Strategy class '{class_name}' not found in code")
    return cls


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/backtest", response_model=BacktestResponse)
def backtest(req: BacktestRequest) -> BacktestResponse:
    try:
        strategy_cls = load_strategy_from_code(req.strategy_code, req.strategy_class_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Strategy load error: {e}")

    csv_path = Path(req.csv_path)
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="CSV path does not exist on server")

    data_feed = CSVBarDataFeed(csv_path=csv_path, symbol=req.symbol)
    config = BacktestConfig(
        symbol=req.symbol,
        initial_cash=req.initial_cash,
        commission_per_trade=req.commission_per_trade,
        max_bars=req.max_bars,
    )

    try:
        engine = BacktestEngine(data_feed=data_feed, config=config)
        result: BacktestResult = engine.run(strategy_cls=strategy_cls, strategy_params=req.strategy_params)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest execution error: {e}")

    return BacktestResponse(
        config={
            "symbol": result.config.symbol,
            "initial_cash": result.config.initial_cash,
            "commission_per_trade": result.config.commission_per_trade,
            "max_bars": result.config.max_bars,
        },
        stats={
            "total_return": result.stats.total_return,
            "annualized_return": result.stats.annualized_return,
            "volatility": result.stats.volatility,
            "sharpe": result.stats.sharpe,
            "max_drawdown": result.stats.max_drawdown,
            "equity_curve": result.stats.equity_curve,
        },
        trades=result.trades,
        orders=result.orders,
    )

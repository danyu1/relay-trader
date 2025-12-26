from __future__ import annotations

import ast
import importlib.util
import json
import os
import sys
import textwrap
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Type, List

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Response, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, model_validator
from sqlalchemy.orm import Session

from ..core.backtest import BacktestConfig, BacktestEngine, BacktestResult
from ..core.strategy import Strategy
from ..core.data import CSVBarDataFeed, inspect_csv
from ..core.annotations import TradeAnnotation, StockTradeAnnotation, AnnotationSet, OptionSettings, SimulatedTrade, ManualBacktestStats
from ..core.manual_simulator import ManualSimulator
from ..strategies import list_strategies, get_strategy_class
from ..data import DataDownloader
from ..db import models
from ..db.database import Base, engine, DATABASE_URL
from .deps import get_db, get_current_user
from .security import hash_password, verify_password, create_access_token, SESSION_COOKIE_NAME

app = FastAPI(title="RelayTrader API", version="0.1.0")

# Initialize database tables on startup
@app.on_event("startup")
async def startup_event():
    try:
        print(f"Initializing database at: {DATABASE_URL}")
        Base.metadata.create_all(bind=engine)
        print("Database tables created successfully")
    except Exception as e:
        print(f"Error creating database tables: {e}")
        raise

cors_origins = os.getenv("CORS_ORIGINS")
if cors_origins:
    allow_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
else:
    allow_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BacktestRequest(BaseModel):
    mode: str = "mechanical"  # "mechanical" or "manual"
    strategy_code: str | None = None
    strategy_class_name: str = "UserStrategy"
    builtin_strategy_id: str | None = None
    builtin_params: Dict[str, Any] | None = None
    csv_path: str
    symbol: str
    initial_cash: float = 100_000.0
    start_bar: int | None = None
    commission_per_trade: float = 0.0
    slippage_bps: float = 0.0
    max_bars: int | None = None
    strategy_params: Dict[str, Any] | None = None
    # Manual mode fields
    annotations: list[TradeAnnotation] | None = None
    stock_trades: list[StockTradeAnnotation] | None = None
    option_settings: OptionSettings | None = None

    @model_validator(mode="after")
    def validate_strategy_choice(self) -> "BacktestRequest":
        if self.mode == "mechanical":
            if not self.strategy_code and not self.builtin_strategy_id:
                raise ValueError("Provide either strategy_code or builtin_strategy_id for mechanical mode")
        elif self.mode == "manual":
            if not self.annotations and not self.stock_trades:
                raise ValueError("Provide annotations or stock_trades for manual mode")
        return self


class LintRequest(BaseModel):
    strategy_code: str
    strategy_class_name: str = "UserStrategy"


class BacktestResponse(BaseModel):
    mode: str = "mechanical"
    config: Dict[str, Any]
    stats: Dict[str, Any]
    trade_stats: Dict[str, Any]
    trades: list[Dict[str, Any]]
    orders: list[Dict[str, Any]]
    price_series: list[float]
    timestamps: list[int]
    strategy: Dict[str, Any] | None = None
    run_id: str
    diagnostics: Dict[str, Any]
    # Manual mode fields
    manual_stats: Dict[str, Any] | None = None
    simulated_trades: list[Dict[str, Any]] | None = None


class UploadResponse(BaseModel):
    name: str
    path: str
    size: int


class DatasetInfo(BaseModel):
    name: str
    path: str
    rows: int | None = None
    start: int | None = None
    end: int | None = None
    columns: list[str] | None = None
    symbol: str | None = None
    company_name: str | None = None
    display_name: str | None = None
    start_label: str | None = None
    end_label: str | None = None
    date_range_label: str | None = None
    downloaded_at: str | None = None


class DatasetListResponse(BaseModel):
    datasets: list[DatasetInfo]


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: EmailStr


class DatasetProfilePayload(BaseModel):
    id: int | None = None
    datasetName: str
    displayName: str
    startIndex: int
    endIndex: int
    startTimestamp: int | None = None
    endTimestamp: int | None = None
    startDate: str | None = None
    endDate: str | None = None
    initialEquity: float
    createdAt: str | None = None
    updatedAt: str | None = None


class DatasetProfileListResponse(BaseModel):
    profiles: list[DatasetProfilePayload]


class ManualConfigPayload(BaseModel):
    id: int | None = None
    name: str
    datasetName: str | None = None
    trades: list[dict[str, Any]]
    initialCash: float
    createdAt: str | None = None
    updatedAt: str | None = None


class ManualConfigListResponse(BaseModel):
    configs: list[ManualConfigPayload]


class PortfolioHoldingPayload(BaseModel):
    id: int | None = None
    symbol: str
    shares: float
    avgCost: float
    costBasis: float | None = None
    purchaseDate: int | None = None
    referenceDate: int | None = None
    currentPrice: float | None = None
    currentValue: float | None = None
    color: str | None = None
    cardColor: str | None = None
    lineThickness: float | None = None
    fontSize: float | None = None
    lastUpdate: int | None = None
    meta: dict[str, Any] | None = None


class PortfolioPayload(BaseModel):
    id: int | None = None
    name: str
    cash: float
    context: str = "builder"
    chartConfig: dict[str, Any] | None = None
    lineStyles: dict[str, Any] | None = None
    notes: str | None = None
    tags: list[str] | None = None
    targetAllocations: dict[str, Any] | None = None
    performanceHistory: list[dict[str, Any]] | None = None
    holdings: list[PortfolioHoldingPayload] = []
    createdAt: str | None = None
    updatedAt: str | None = None


class PortfolioListResponse(BaseModel):
    portfolios: list[PortfolioPayload]


class LineStylePayload(BaseModel):
    symbol: str
    color: str
    thickness: float


class LineStyleListResponse(BaseModel):
    styles: list[LineStylePayload]


class UserSettingPayload(BaseModel):
    key: str
    value: Any | None = None


def _ts_to_label(ts: int | None) -> str | None:
    if ts is None:
        return None
    return datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")


def _symbol_from_filename(filename: str) -> str:
    base = Path(filename).stem
    return base.split("_")[0].upper() if base else filename.upper()


BASE_DATA_DIR = (Path(__file__).resolve().parent.parent.parent / "data").resolve()
BASE_DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_user_data_dir(user_id: int) -> Path:
    user_dir = BASE_DATA_DIR / "users" / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def set_session_cookie(response: Response, token: str) -> None:
    # For cross-origin cookies (Vercel -> Railway), we need SameSite=None and Secure=True
    is_production = os.getenv("RAILWAY_ENVIRONMENT") == "production"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="none" if is_production else "lax",
        secure=True if is_production else False,
        max_age=60 * 60 * 24 * 7,
        path="/",
    )

def _dataset_to_info(dataset: models.Dataset) -> DatasetInfo:
    return DatasetInfo(
        name=dataset.name,
        path=dataset.path,
        rows=dataset.rows,
        start=dataset.start_ts,
        end=dataset.end_ts,
        columns=dataset.columns,
        symbol=dataset.symbol,
        company_name=dataset.company_name,
        display_name=dataset.display_name,
        start_label=dataset.start_label,
        end_label=dataset.end_label,
        date_range_label=dataset.date_range_label,
        downloaded_at=dataset.downloaded_at,
    )


def _profile_to_payload(profile: models.DatasetProfile, dataset_name: str) -> DatasetProfilePayload:
    return DatasetProfilePayload(
        id=profile.id,
        datasetName=dataset_name,
        displayName=profile.display_name,
        startIndex=profile.start_index,
        endIndex=profile.end_index,
        startTimestamp=profile.start_ts,
        endTimestamp=profile.end_ts,
        startDate=profile.start_date,
        endDate=profile.end_date,
        initialEquity=profile.initial_equity,
        createdAt=profile.created_at.isoformat(),
        updatedAt=profile.updated_at.isoformat(),
    )


def _holding_to_payload(holding: models.PortfolioHolding) -> PortfolioHoldingPayload:
    return PortfolioHoldingPayload(
        id=holding.id,
        symbol=holding.symbol,
        shares=holding.shares,
        avgCost=holding.avg_cost,
        costBasis=holding.cost_basis,
        purchaseDate=holding.purchase_date,
        referenceDate=holding.reference_date,
        currentPrice=holding.current_price,
        currentValue=holding.current_value,
        color=holding.color,
        cardColor=holding.card_color,
        lineThickness=holding.line_thickness,
        fontSize=holding.font_size,
        lastUpdate=holding.last_update,
        meta=holding.meta,
    )


def _portfolio_to_payload(portfolio: models.Portfolio) -> PortfolioPayload:
    return PortfolioPayload(
        id=portfolio.id,
        name=portfolio.name,
        cash=portfolio.cash,
        context=portfolio.context,
        chartConfig=portfolio.chart_config,
        lineStyles=portfolio.line_styles,
        notes=portfolio.notes,
        tags=portfolio.tags,
        targetAllocations=portfolio.target_allocations,
        performanceHistory=portfolio.performance_history,
        holdings=[_holding_to_payload(holding) for holding in portfolio.holdings],
        createdAt=portfolio.created_at.isoformat(),
        updatedAt=portfolio.updated_at.isoformat(),
    )


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


@app.post("/auth/signup", response_model=UserResponse)
def signup(req: SignupRequest, response: Response, db: Session = Depends(get_db)) -> UserResponse:
    existing = db.query(models.User).filter(models.User.email == req.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(email=req.email.lower(), hashed_password=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    set_session_cookie(response, token)
    return UserResponse(id=user.id, email=user.email)


@app.post("/auth/login", response_model=UserResponse)
def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)) -> UserResponse:
    user = db.query(models.User).filter(models.User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": str(user.id)})
    set_session_cookie(response, token)
    return UserResponse(id=user.id, email=user.email)


@app.post("/auth/logout")
def logout(response: Response) -> Dict[str, str]:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"status": "ok"}


@app.get("/auth/me", response_model=UserResponse)
def me(user: models.User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=user.id, email=user.email)


@app.get("/strategies")
def strategies() -> Dict[str, Any]:
    return {"strategies": list_strategies()}


@app.post("/lint-strategy")
def lint_strategy(req: LintRequest) -> Dict[str, str]:
    try:
        tree = ast.parse(req.strategy_code)
    except SyntaxError as exc:
        raise HTTPException(status_code=400, detail=f"Syntax error: {exc}") from exc
    has_class = any(isinstance(node, ast.ClassDef) and node.name == req.strategy_class_name for node in ast.walk(tree))
    if not has_class:
        raise HTTPException(status_code=400, detail=f"Strategy class '{req.strategy_class_name}' not found")
    return {"status": "ok"}


@app.post("/backtest", response_model=BacktestResponse)
def backtest(
    req: BacktestRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> BacktestResponse:
    run_start = time.perf_counter()
    started_at = datetime.utcnow().isoformat() + "Z"
    run_id = uuid.uuid4().hex

    csv_path = Path(req.csv_path)
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="CSV path does not exist on server")
    dataset_record = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.path == str(csv_path))
        .first()
    )
    if not dataset_record:
        raise HTTPException(status_code=404, detail="Dataset not found for user")

    data_feed = CSVBarDataFeed(csv_path=csv_path, symbol=req.symbol)

    # Manual mode
    if req.mode == "manual":
        # Load price data
        import pandas as pd
        df = pd.read_csv(csv_path)
        total_rows = len(df)
        start_bar = max(req.start_bar or 0, 0)
        if start_bar >= total_rows:
            raise HTTPException(status_code=400, detail="start_bar is beyond dataset length")
        end_bar = None
        if req.max_bars is not None:
            if req.max_bars <= 0:
                raise HTTPException(status_code=400, detail="max_bars must be greater than 0")
            end_bar = start_bar + req.max_bars
        df_slice = df.iloc[start_bar:end_bar]
        timestamps = df_slice["timestamp"].tolist()
        price_series = df_slice["close"].tolist()

        simulated_trades = []
        manual_stats = None

        # Handle option trades
        if req.annotations and req.option_settings:
            simulator = ManualSimulator(
                annotations=req.annotations,
                timestamps=timestamps,
                price_series=price_series,
                option_settings=req.option_settings,
            )
            simulated_trades, manual_stats = simulator.simulate()

        # Handle stock trades
        if req.stock_trades:
            stock_pnl = 0.0
            stock_trade_results = []

            try:
                for trade in req.stock_trades:
                    # Adjust indices to be relative to the sliced data
                    rel_entry_idx = trade.entryIndex - start_bar
                    rel_exit_idx = (trade.exitIndex - start_bar) if trade.exitIndex is not None else len(price_series) - 1

                    # Bounds check
                    if rel_entry_idx < 0 or rel_entry_idx >= len(price_series):
                        raise HTTPException(status_code=400, detail=f"Trade {trade.id}: entry index {trade.entryIndex} out of range [{start_bar}, {start_bar + len(price_series)})")
                    if rel_exit_idx < 0 or rel_exit_idx >= len(price_series):
                        raise HTTPException(status_code=400, detail=f"Trade {trade.id}: exit index {trade.exitIndex} out of range [{start_bar}, {start_bar + len(price_series)})")

                    entry_price = price_series[rel_entry_idx]
                    exit_price = price_series[rel_exit_idx]
                    pnl = (exit_price - entry_price) * trade.quantity
                    stock_pnl += pnl

                    stock_trade_results.append({
                        "id": trade.id,
                        "entry_price": entry_price,
                        "exit_price": exit_price,
                        "quantity": trade.quantity,
                        "pnl": pnl,
                    })
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"Error processing stock trades: {str(e)}")

            # Combine stock trades with option trades stats
            if manual_stats is None:
                # Only stock trades, create stats
                winners = [t["pnl"] for t in stock_trade_results if t["pnl"] > 0]
                losers = [t["pnl"] for t in stock_trade_results if t["pnl"] < 0]

                manual_stats = ManualBacktestStats(
                    total_premium_spent=0,
                    total_premium_received=0,
                    net_premium=0,
                    max_payoff=max([t["pnl"] for t in stock_trade_results]) if stock_trade_results else 0,
                    min_payoff=min([t["pnl"] for t in stock_trade_results]) if stock_trade_results else 0,
                    net_pnl=stock_pnl,
                    win_rate=len(winners) / len(stock_trade_results) if stock_trade_results else 0,
                    num_trades=len(stock_trade_results),
                    num_winners=len(winners),
                    num_losers=len(losers),
                    avg_win=sum(winners) / len(winners) if winners else 0,
                    avg_loss=sum(losers) / len(losers) if losers else 0,
                    max_win=max(winners) if winners else 0,
                    max_loss=min(losers) if losers else 0,
                    return_on_capital=stock_pnl / req.initial_cash if req.initial_cash > 0 else 0,
                )
            else:
                # Combine option and stock stats - create new instance
                combined_pnl = manual_stats.net_pnl + stock_pnl
                manual_stats = ManualBacktestStats(
                    total_premium_spent=manual_stats.total_premium_spent,
                    total_premium_received=manual_stats.total_premium_received,
                    net_premium=manual_stats.net_premium,
                    max_payoff=max(manual_stats.max_payoff, max([t["pnl"] for t in stock_trade_results]) if stock_trade_results else manual_stats.max_payoff),
                    min_payoff=min(manual_stats.min_payoff, min([t["pnl"] for t in stock_trade_results]) if stock_trade_results else manual_stats.min_payoff),
                    net_pnl=combined_pnl,
                    win_rate=manual_stats.win_rate,  # Would need to recalculate properly
                    num_trades=manual_stats.num_trades + len(stock_trade_results),
                    num_winners=manual_stats.num_winners + len([t for t in stock_trade_results if t["pnl"] > 0]),
                    num_losers=manual_stats.num_losers + len([t for t in stock_trade_results if t["pnl"] < 0]),
                    avg_win=manual_stats.avg_win,  # Would need to recalculate properly
                    avg_loss=manual_stats.avg_loss,  # Would need to recalculate properly
                    max_win=max(manual_stats.max_win, max([t["pnl"] for t in stock_trade_results if t["pnl"] > 0]) if any(t["pnl"] > 0 for t in stock_trade_results) else manual_stats.max_win),
                    max_loss=min(manual_stats.max_loss, min([t["pnl"] for t in stock_trade_results if t["pnl"] < 0]) if any(t["pnl"] < 0 for t in stock_trade_results) else manual_stats.max_loss),
                    return_on_capital=combined_pnl / req.initial_cash if req.initial_cash > 0 else 0,
                )

        runtime_ms = (time.perf_counter() - run_start) * 1000

        diagnostics = {
            "run_id": run_id,
            "started_at": started_at,
            "completed_at": datetime.utcnow().isoformat() + "Z",
            "runtime_ms": runtime_ms,
            "bars_processed": len(price_series),
            "engine_version": "0.1.0-manual",
            "mode": "manual",
        }

        # Ensure manual_stats exists
        if manual_stats is None:
            manual_stats = ManualBacktestStats(
                total_premium_spent=0,
                total_premium_received=0,
                net_premium=0,
                max_payoff=0,
                min_payoff=0,
                net_pnl=0,
                win_rate=0,
                num_trades=0,
                num_winners=0,
                num_losers=0,
                avg_win=0,
                avg_loss=0,
                max_win=0,
                max_loss=0,
                return_on_capital=0,
            )

        response = BacktestResponse(
            mode="manual",
            config={
                "symbol": req.symbol,
                "initial_cash": req.initial_cash,
                "option_settings": req.option_settings.model_dump() if req.option_settings else None,
            },
            stats={},  # No mechanical stats for manual mode
            trade_stats={},  # No mechanical trade stats
            trades=[],
            orders=[],
            price_series=price_series,
            timestamps=timestamps,
            run_id=run_id,
            diagnostics=diagnostics,
            manual_stats=manual_stats.model_dump(),
            simulated_trades=[t.model_dump() for t in simulated_trades],
        )
        record = response.model_dump()
        record["saved_at"] = diagnostics["completed_at"]
        run_entry = models.BacktestRun(
            run_id=run_id,
            user_id=user.id,
            dataset_id=dataset_record.id if dataset_record else None,
            mode="manual",
            symbol=req.symbol,
            saved_at=diagnostics["completed_at"],
            payload=record,
        )
        db.add(run_entry)
        db.commit()
        return response

    # Mechanical mode (original logic)
    strategy_cls: Type[Strategy]
    strategy_params: Dict[str, Any] | None = req.strategy_params

    if req.builtin_strategy_id:
        try:
            definition = get_strategy_class(req.builtin_strategy_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Unknown built-in strategy: {e}")
        strategy_cls = definition.cls
        strategy_params = req.builtin_params or {}
        # apply defaults for any missing params
        for p in definition.params:
            strategy_params.setdefault(p.name, p.default)
    else:
        if not req.strategy_code:
            raise HTTPException(status_code=400, detail="strategy_code required for custom strategies")
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
        start_bar=req.start_bar,
        commission_per_trade=req.commission_per_trade,
        slippage_bps=req.slippage_bps,
        max_bars=req.max_bars,
    )

    try:
        engine = BacktestEngine(data_feed=data_feed, config=config)
        result: BacktestResult = engine.run(strategy_cls=strategy_cls, strategy_params=strategy_params)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest execution error: {e}")

    runtime_ms = (time.perf_counter() - run_start) * 1000
    run_id = uuid.uuid4().hex
    applied_strategy_params: Dict[str, Any] = strategy_params or {}
    strategy_payload: Dict[str, Any] = {
        "mode": "builtin" if req.builtin_strategy_id else "custom",
        "class_name": strategy_cls.__name__,
        "builtin_id": req.builtin_strategy_id,
        "params": applied_strategy_params,
        "submitted_params": req.strategy_params if req.strategy_code else req.builtin_params,
    }
    form_snapshot = {
        "symbol": req.symbol,
        "csv_path": req.csv_path,
        "initial_cash": req.initial_cash,
        "start_bar": req.start_bar,
        "max_bars": req.max_bars,
        "commission_per_trade": req.commission_per_trade,
        "slippage_bps": req.slippage_bps,
        "mode": "builtin" if req.builtin_strategy_id else "custom",
        "builtin_id": req.builtin_strategy_id,
        "builtin_params": req.builtin_params,
        "strategy_params": req.strategy_params,
    }
    diagnostics = {
        "run_id": run_id,
        "started_at": started_at,
        "completed_at": datetime.utcnow().isoformat() + "Z",
        "runtime_ms": runtime_ms,
        "bars_processed": len(result.price_series),
        "engine_version": "0.1.0",
        "form": form_snapshot,
    }

    response = BacktestResponse(
        config={
            "symbol": result.config.symbol,
            "initial_cash": result.config.initial_cash,
            "start_bar": result.config.start_bar,
            "commission_per_trade": result.config.commission_per_trade,
            "slippage_bps": result.config.slippage_bps,
            "max_bars": result.config.max_bars,
            "strategy_params": applied_strategy_params,
        },
        stats={
            "total_return": result.stats.total_return,
            "annualized_return": result.stats.annualized_return,
            "volatility": result.stats.volatility,
            "sharpe": result.stats.sharpe,
            "sortino": result.stats.sortino,
            "calmar": result.stats.calmar,
            "max_drawdown": result.stats.max_drawdown,
            "equity_curve": result.stats.equity_curve,
            "drawdown_curve": result.stats.drawdown_curve,
        },
        trade_stats={
            "total_pnl": result.trade_stats.total_pnl,
            "net_pnl": result.trade_stats.net_pnl,
            "total_commission": result.trade_stats.total_commission,
            "total_slippage": result.trade_stats.total_slippage,
            "win_rate": result.trade_stats.win_rate,
            "avg_win": result.trade_stats.avg_win,
            "avg_loss": result.trade_stats.avg_loss,
            "num_trades": result.trade_stats.num_trades,
            "turnover": result.trade_stats.turnover,
        },
        trades=result.trades,
        orders=result.orders,
        price_series=result.price_series,
        timestamps=result.timestamps,
        run_id=run_id,
        diagnostics=diagnostics,
        strategy=strategy_payload,
    )
    record = response.model_dump()
    record["saved_at"] = diagnostics["completed_at"]
    run_entry = models.BacktestRun(
        run_id=run_id,
        user_id=user.id,
        dataset_id=dataset_record.id if dataset_record else None,
        mode="mechanical",
        symbol=req.symbol,
        saved_at=diagnostics["completed_at"],
        payload=record,
    )
    db.add(run_entry)
    db.commit()
    return response


@app.get("/datasets", response_model=DatasetListResponse)
def list_datasets(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> DatasetListResponse:
    datasets = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id)
        .order_by(models.Dataset.name.asc())
        .all()
    )
    return DatasetListResponse(datasets=[_dataset_to_info(dataset) for dataset in datasets])


@app.post("/upload-dataset", response_model=UploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> UploadResponse:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    dest_dir = get_user_data_dir(user.id)
    dest_path = dest_dir / Path(file.filename).name
    content = await file.read()
    dest_path.write_bytes(content)
    try:
        meta = inspect_csv(dest_path)
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")
    name = dest_path.name
    symbol = _symbol_from_filename(name)
    start_label = _ts_to_label(meta.get("start"))
    end_label = _ts_to_label(meta.get("end"))
    date_range_label = f"{start_label} → {end_label}" if start_label and end_label else None
    existing = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == name)
        .first()
    )
    if existing:
        existing.path = str(dest_path)
        existing.rows = meta.get("rows")
        existing.start_ts = meta.get("start")
        existing.end_ts = meta.get("end")
        existing.columns = meta.get("columns")
        existing.symbol = symbol
        existing.display_name = symbol
        existing.start_label = start_label
        existing.end_label = end_label
        existing.date_range_label = date_range_label
    else:
        dataset = models.Dataset(
            user_id=user.id,
            name=name,
            path=str(dest_path),
            rows=meta.get("rows"),
            start_ts=meta.get("start"),
            end_ts=meta.get("end"),
            columns=meta.get("columns"),
            symbol=symbol,
            display_name=symbol,
            start_label=start_label,
            end_label=end_label,
            date_range_label=date_range_label,
        )
        db.add(dataset)
    db.commit()
    return UploadResponse(name=dest_path.name, path=str(dest_path), size=len(content))


@app.get("/dataset-preview")
def dataset_preview(
    name: str,
    limit: int = 5,
    sample: int = 200,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    if limit <= 0:
        limit = 5
    if limit > 50:
        limit = 50
    full_series = sample < 0
    if sample < 0:
        sample = 0
    if sample > 2000:
        sample = 2000

    dataset = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == name)
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    file_path = Path(dataset.path).resolve()
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {e}")

    head = df.head(limit).to_dict(orient="records")
    tail = df.tail(limit).to_dict(orient="records")

    series: list[dict[str, Any]] = []
    close_col = "close" if "close" in df.columns else ("Close" if "Close" in df.columns else None)
    ts_col = "timestamp" if "timestamp" in df.columns else None
    if (full_series or sample > 0) and close_col:
        total_rows = len(df)
        if total_rows > 0:
            if full_series or sample >= total_rows:
                indices = list(range(total_rows))
            else:
                step = max(1, total_rows // sample)
                indices = list(range(0, total_rows, step))
                if indices[-1] != total_rows - 1:
                    indices.append(total_rows - 1)
            subset = df.iloc[indices]
            if ts_col:
                timestamps = subset[ts_col].tolist()
            elif "date" in df.columns:
                timestamps = (
                    pd.to_datetime(subset["date"], errors="coerce")
                    .astype("int64", errors="ignore")
                    .tolist()
                )
            else:
                timestamps = list(range(len(subset)))
            closes = subset[close_col].tolist()
            for idx, close_val in enumerate(closes):
                ts_val = timestamps[idx] if idx < len(timestamps) else None
                if ts_val is None:
                    continue
                try:
                    series.append({"timestamp": int(ts_val), "close": float(close_val)})
                except (TypeError, ValueError):
                    continue
    return {
        "name": name,
        "head": head,
        "tail": tail,
        "total_rows": int(len(df)),
        "columns": list(df.columns),
        "series": series,
    }


@app.get("/dataset-profiles", response_model=DatasetProfileListResponse)
def list_dataset_profiles(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> DatasetProfileListResponse:
    profiles = (
        db.query(models.DatasetProfile, models.Dataset.name)
        .join(models.Dataset, models.Dataset.id == models.DatasetProfile.dataset_id)
        .filter(models.DatasetProfile.user_id == user.id)
        .order_by(models.DatasetProfile.created_at.desc())
        .all()
    )
    payloads = [_profile_to_payload(profile, dataset_name) for profile, dataset_name in profiles]
    return DatasetProfileListResponse(profiles=payloads)


@app.post("/dataset-profiles", response_model=DatasetProfilePayload)
def save_dataset_profile(
    payload: DatasetProfilePayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> DatasetProfilePayload:
    dataset = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == payload.datasetName)
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    profile = None
    if payload.id:
        profile = (
            db.query(models.DatasetProfile)
            .filter(models.DatasetProfile.user_id == user.id, models.DatasetProfile.id == payload.id)
            .first()
        )
    if profile:
        profile.display_name = payload.displayName
        profile.start_index = payload.startIndex
        profile.end_index = payload.endIndex
        profile.start_ts = payload.startTimestamp
        profile.end_ts = payload.endTimestamp
        profile.start_date = payload.startDate
        profile.end_date = payload.endDate
        profile.initial_equity = payload.initialEquity
    else:
        profile = models.DatasetProfile(
            user_id=user.id,
            dataset_id=dataset.id,
            display_name=payload.displayName,
            start_index=payload.startIndex,
            end_index=payload.endIndex,
            start_ts=payload.startTimestamp,
            end_ts=payload.endTimestamp,
            start_date=payload.startDate,
            end_date=payload.endDate,
            initial_equity=payload.initialEquity,
        )
        db.add(profile)
    db.commit()
    db.refresh(profile)
    return _profile_to_payload(profile, dataset.name)


@app.delete("/dataset-profiles/{profile_id}")
def delete_dataset_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, str]:
    deleted = (
        db.query(models.DatasetProfile)
        .filter(models.DatasetProfile.user_id == user.id, models.DatasetProfile.id == profile_id)
        .delete()
    )
    if deleted:
        db.commit()
    return {"status": "ok"}


@app.get("/user-settings/{key}", response_model=UserSettingPayload)
def get_user_setting(
    key: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> UserSettingPayload:
    setting = (
        db.query(models.UserSetting)
        .filter(models.UserSetting.user_id == user.id, models.UserSetting.key == key)
        .first()
    )
    return UserSettingPayload(key=key, value=setting.value if setting else None)


@app.put("/user-settings/{key}", response_model=UserSettingPayload)
def set_user_setting(
    key: str,
    payload: UserSettingPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> UserSettingPayload:
    setting = (
        db.query(models.UserSetting)
        .filter(models.UserSetting.user_id == user.id, models.UserSetting.key == key)
        .first()
    )
    if setting:
        setting.value = payload.value
    else:
        setting = models.UserSetting(user_id=user.id, key=key, value=payload.value)
        db.add(setting)
    db.commit()
    return UserSettingPayload(key=key, value=payload.value)


@app.get("/manual-configs", response_model=ManualConfigListResponse)
def list_manual_configs(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> ManualConfigListResponse:
    configs = (
        db.query(models.ManualConfig, models.Dataset.name)
        .outerjoin(models.Dataset, models.Dataset.id == models.ManualConfig.dataset_id)
        .filter(models.ManualConfig.user_id == user.id)
        .order_by(models.ManualConfig.created_at.desc())
        .all()
    )
    payloads: list[ManualConfigPayload] = []
    for config, dataset_name in configs:
        payloads.append(
            ManualConfigPayload(
                id=config.id,
                name=config.name,
                datasetName=dataset_name,
                trades=config.trades,
                initialCash=config.initial_cash,
                createdAt=config.created_at.isoformat(),
                updatedAt=config.updated_at.isoformat(),
            )
        )
    return ManualConfigListResponse(configs=payloads)


@app.post("/manual-configs", response_model=ManualConfigPayload)
def save_manual_config(
    payload: ManualConfigPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> ManualConfigPayload:
    dataset_id = None
    if payload.datasetName:
        dataset = (
            db.query(models.Dataset)
            .filter(models.Dataset.user_id == user.id, models.Dataset.name == payload.datasetName)
            .first()
        )
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        dataset_id = dataset.id
    config = None
    if payload.id:
        config = (
            db.query(models.ManualConfig)
            .filter(models.ManualConfig.user_id == user.id, models.ManualConfig.id == payload.id)
            .first()
        )
    if config:
        config.name = payload.name
        config.dataset_id = dataset_id
        config.trades = payload.trades
        config.initial_cash = payload.initialCash
    else:
        config = models.ManualConfig(
            user_id=user.id,
            dataset_id=dataset_id,
            name=payload.name,
            trades=payload.trades,
            initial_cash=payload.initialCash,
        )
        db.add(config)
    db.commit()
    db.refresh(config)
    return ManualConfigPayload(
        id=config.id,
        name=config.name,
        datasetName=payload.datasetName,
        trades=config.trades,
        initialCash=config.initial_cash,
        createdAt=config.created_at.isoformat(),
        updatedAt=config.updated_at.isoformat(),
    )


@app.delete("/manual-configs/{config_id}")
def delete_manual_config(
    config_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, str]:
    deleted = (
        db.query(models.ManualConfig)
        .filter(models.ManualConfig.user_id == user.id, models.ManualConfig.id == config_id)
        .delete()
    )
    if deleted:
        db.commit()
    return {"status": "ok"}


@app.get("/portfolios", response_model=PortfolioListResponse)
def list_portfolios(
    context: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> PortfolioListResponse:
    query = db.query(models.Portfolio).filter(models.Portfolio.user_id == user.id)
    if context:
        query = query.filter(models.Portfolio.context == context)
    portfolios = query.order_by(models.Portfolio.updated_at.desc()).all()
    return PortfolioListResponse(portfolios=[_portfolio_to_payload(p) for p in portfolios])


@app.post("/portfolios", response_model=PortfolioPayload)
def save_portfolio(
    payload: PortfolioPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> PortfolioPayload:
    portfolio = None
    if payload.id:
        portfolio = (
            db.query(models.Portfolio)
            .filter(models.Portfolio.user_id == user.id, models.Portfolio.id == payload.id)
            .first()
        )
    if portfolio:
        portfolio.name = payload.name
        portfolio.cash = payload.cash
        portfolio.context = payload.context
        portfolio.chart_config = payload.chartConfig
        portfolio.line_styles = payload.lineStyles
        portfolio.notes = payload.notes
        portfolio.tags = payload.tags
        portfolio.target_allocations = payload.targetAllocations
        portfolio.performance_history = payload.performanceHistory
        portfolio.holdings.clear()
    else:
        portfolio = models.Portfolio(
            user_id=user.id,
            name=payload.name,
            cash=payload.cash,
            context=payload.context,
            chart_config=payload.chartConfig,
            line_styles=payload.lineStyles,
            notes=payload.notes,
            tags=payload.tags,
            target_allocations=payload.targetAllocations,
            performance_history=payload.performanceHistory,
        )
        db.add(portfolio)
        db.flush()
    for holding in payload.holdings:
        portfolio.holdings.append(
            models.PortfolioHolding(
                symbol=holding.symbol,
                shares=holding.shares,
                avg_cost=holding.avgCost,
                cost_basis=holding.costBasis,
                purchase_date=holding.purchaseDate,
                reference_date=holding.referenceDate,
                current_price=holding.currentPrice,
                current_value=holding.currentValue,
                color=holding.color,
                card_color=holding.cardColor,
                line_thickness=holding.lineThickness,
                font_size=holding.fontSize,
                last_update=holding.lastUpdate,
                meta=holding.meta,
            )
        )
    db.commit()
    db.refresh(portfolio)
    return _portfolio_to_payload(portfolio)


@app.delete("/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, str]:
    deleted = (
        db.query(models.Portfolio)
        .filter(models.Portfolio.user_id == user.id, models.Portfolio.id == portfolio_id)
        .delete()
    )
    if deleted:
        db.commit()
    return {"status": "ok"}


@app.get("/line-styles", response_model=LineStyleListResponse)
def list_line_styles(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> LineStyleListResponse:
    styles = (
        db.query(models.LineStyle)
        .filter(models.LineStyle.user_id == user.id)
        .order_by(models.LineStyle.symbol.asc())
        .all()
    )
    return LineStyleListResponse(
        styles=[LineStylePayload(symbol=s.symbol, color=s.color, thickness=s.thickness) for s in styles]
    )


@app.post("/line-styles", response_model=LineStyleListResponse)
def save_line_styles(
    payload: LineStyleListResponse,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> LineStyleListResponse:
    for style in payload.styles:
        existing = (
            db.query(models.LineStyle)
            .filter(models.LineStyle.user_id == user.id, models.LineStyle.symbol == style.symbol)
            .first()
        )
        if existing:
            existing.color = style.color
            existing.thickness = style.thickness
        else:
            db.add(
                models.LineStyle(
                    user_id=user.id,
                    symbol=style.symbol,
                    color=style.color,
                    thickness=style.thickness,
                )
            )
    db.commit()
    return payload


@app.get("/runs")
def list_runs(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    runs = (
        db.query(models.BacktestRun)
        .filter(models.BacktestRun.user_id == user.id)
        .order_by(models.BacktestRun.created_at.desc())
        .limit(50)
        .all()
    )
    summaries = []
    for run in runs:
        payload = run.payload or {}
        summaries.append(
            {
                "run_id": run.run_id,
                "saved_at": run.saved_at or (payload.get("diagnostics", {}) or {}).get("completed_at"),
                "symbol": run.symbol or (payload.get("config", {}) or {}).get("symbol"),
                "total_return": (payload.get("stats", {}) or {}).get("total_return"),
                "max_drawdown": (payload.get("stats", {}) or {}).get("max_drawdown"),
            }
        )
    return {"runs": summaries}


@app.get("/runs/{run_id}")
def get_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    run = (
        db.query(models.BacktestRun)
        .filter(models.BacktestRun.user_id == user.id, models.BacktestRun.run_id == run_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run.payload


@app.post("/download-symbol")
def download_symbol(
    symbol: str = Query(...),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    period: str = Query("max"),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Download historical data for a symbol from Yahoo Finance.

    Args:
        symbol: Ticker symbol (e.g., 'SPY', 'AAPL')
        start_date: Start date in YYYY-MM-DD format (optional)
        end_date: End date in YYYY-MM-DD format (optional)
        period: Period to download if dates not specified (e.g., 'max', '5y', '1y')

    Returns:
        Download status and metadata
    """
    downloader = DataDownloader(get_user_data_dir(user.id))
    result = downloader.download_symbol(
        symbol=symbol.upper(),
        start_date=start_date,
        end_date=end_date,
        period=period,
        refresh=refresh,
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Download failed"))

    name = result.get("filename")
    if not name:
        return result
    existing = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == name)
        .first()
    )
    if existing:
        existing.path = result.get("path", existing.path)
        existing.rows = result.get("rows")
        existing.start_ts = result.get("start")
        existing.end_ts = result.get("end")
        existing.columns = result.get("columns")
        existing.symbol = result.get("symbol")
        existing.company_name = result.get("company_name")
        existing.display_name = result.get("display_name")
        existing.start_label = result.get("start_date_label")
        existing.end_label = result.get("end_date_label")
        existing.date_range_label = result.get("date_range_label")
        existing.downloaded_at = result.get("downloaded_at")
    else:
        dataset = models.Dataset(
            user_id=user.id,
            name=name,
            path=result.get("path"),
            rows=result.get("rows"),
            start_ts=result.get("start"),
            end_ts=result.get("end"),
            columns=result.get("columns"),
            symbol=result.get("symbol"),
            company_name=result.get("company_name"),
            display_name=result.get("display_name"),
            start_label=result.get("start_date_label"),
            end_label=result.get("end_date_label"),
            date_range_label=result.get("date_range_label"),
            downloaded_at=result.get("downloaded_at"),
        )
        db.add(dataset)
    db.commit()
    return result


@app.get("/symbol-info/{symbol}")
def get_symbol_info(
    symbol: str,
    user: models.User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get information about a symbol."""
    downloader = DataDownloader(get_user_data_dir(user.id))
    result = downloader.get_symbol_info(symbol.upper())

    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Symbol not found"))

    return result


@app.get("/annotations")
def get_annotations(
    dataset: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> AnnotationSet:
    """
    Get annotations for a dataset.

    Args:
        dataset: Dataset name (filename)

    Returns:
        AnnotationSet with all annotations
    """
    dataset_record = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == dataset)
        .first()
    )
    if not dataset_record:
        raise HTTPException(status_code=404, detail="Dataset not found")
    record = (
        db.query(models.DatasetAnnotation)
        .filter(
            models.DatasetAnnotation.user_id == user.id,
            models.DatasetAnnotation.dataset_id == dataset_record.id,
        )
        .first()
    )
    if not record:
        return AnnotationSet(dataset_name=dataset, annotations=[])
    try:
        return AnnotationSet(**record.payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load annotations: {e}")


@app.post("/annotations")
def save_annotations(
    annotation_set: AnnotationSet,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, str]:
    """
    Save annotations for a dataset.

    Args:
        annotation_set: AnnotationSet to save

    Returns:
        Success message
    """
    dataset_record = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == annotation_set.dataset_name)
        .first()
    )
    if not dataset_record:
        raise HTTPException(status_code=404, detail="Dataset not found")
    payload = annotation_set.model_dump()
    existing = (
        db.query(models.DatasetAnnotation)
        .filter(
            models.DatasetAnnotation.user_id == user.id,
            models.DatasetAnnotation.dataset_id == dataset_record.id,
        )
        .first()
    )
    if existing:
        existing.payload = payload
    else:
        record = models.DatasetAnnotation(
            user_id=user.id,
            dataset_id=dataset_record.id,
            payload=payload,
        )
        db.add(record)
    db.commit()
    return {"status": "ok", "message": f"Saved {len(annotation_set.annotations)} annotations"}


@app.delete("/annotations")
def delete_annotations(
    dataset: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Dict[str, str]:
    """
    Delete all annotations for a dataset.

    Args:
        dataset: Dataset name

    Returns:
        Success message
    """
    dataset_record = (
        db.query(models.Dataset)
        .filter(models.Dataset.user_id == user.id, models.Dataset.name == dataset)
        .first()
    )
    if dataset_record:
        (
            db.query(models.DatasetAnnotation)
            .filter(
                models.DatasetAnnotation.user_id == user.id,
                models.DatasetAnnotation.dataset_id == dataset_record.id,
            )
            .delete()
        )
        db.commit()
    return {"status": "ok", "message": "Annotations deleted"}


# ==================== LIVE PRICES API ====================

class StockPricesRequest(BaseModel):
    """Request model for fetching stock prices"""
    symbols: List[str]
    range: str = "1M"  # 1D, 1W, 1M, 3M, 6M, 1Y, 2Y, 3Y, ALL


class StockPriceData(BaseModel):
    """Stock price data response model"""
    symbol: str
    name: str
    current_price: float
    previous_close: float
    historical: List[Dict[str, Any]]  # [{timestamp, price}, ...]


@app.post("/api/stock-prices")
async def get_stock_prices(
    req: StockPricesRequest,
    user: models.User = Depends(get_current_user),
):
    """
    Fetch current and historical stock prices using yfinance.

    Args:
        req: Request containing symbols and time range

    Returns:
        Dictionary mapping symbols to price data
    """
    import yfinance as yf
    from datetime import timedelta

    # Map time range to yfinance period
    period_map = {
        "1D": "1d",
        "1W": "5d",
        "1M": "1mo",
        "3M": "3mo",
        "6M": "6mo",
        "1Y": "1y",
        "2Y": "2y",
        "3Y": "3y",
        "ALL": "max",
    }

    period = period_map.get(req.range, "1mo")
    interval = "1d" if req.range not in ["1D"] else "5m"

    result = {}

    for symbol in req.symbols:
        try:
            ticker = yf.Ticker(symbol)

            # Get historical data
            hist = ticker.history(period=period, interval=interval)

            if hist.empty:
                print(f"No historical data for {symbol} with period={period}")
                result[symbol] = {
                    "error": f"No historical data available for {symbol}. Try a different time range or check if the symbol is valid."
                }
                continue

            # Get company info
            try:
                info = ticker.info
                company_name = info.get("longName", symbol)
            except Exception:
                # If ticker.info fails, just use the symbol
                company_name = symbol

            # Current price (latest close)
            current_price = float(hist['Close'].iloc[-1])

            # Previous close (second to last if available, otherwise same as current)
            if len(hist) > 1:
                previous_close = float(hist['Close'].iloc[-2])
            else:
                previous_close = current_price

            # Build historical data array
            historical = []
            for idx, row in hist.iterrows():
                historical.append({
                    "timestamp": int(idx.timestamp() * 1000),  # Convert to milliseconds
                    "price": float(row['Close'])
                })

            result[symbol] = {
                "symbol": symbol,
                "name": company_name,
                "current_price": current_price,
                "previous_close": previous_close,
                "historical": historical,
            }

        except Exception as e:
            # If we fail to fetch a stock, log but continue with others
            error_msg = str(e)
            print(f"Error fetching {symbol}: {error_msg}")
            result[symbol] = {
                "error": f"Failed to fetch data for {symbol}: {error_msg}"
            }

    return result

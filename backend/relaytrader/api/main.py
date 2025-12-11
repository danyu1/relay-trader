from __future__ import annotations

import ast
import importlib.util
import json
import sys
import textwrap
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Type, List

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator

from ..core.backtest import BacktestConfig, BacktestEngine, BacktestResult
from ..core.strategy import Strategy
from ..core.data import CSVBarDataFeed, inspect_csv
from ..core.annotations import TradeAnnotation, AnnotationSet, OptionSettings, SimulatedTrade, ManualBacktestStats
from ..core.manual_simulator import ManualSimulator
from ..strategies import list_strategies, get_strategy_class
from ..data import DataDownloader

app = FastAPI(title="RelayTrader API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    commission_per_trade: float = 0.0
    slippage_bps: float = 0.0
    max_bars: int | None = None
    strategy_params: Dict[str, Any] | None = None
    # Manual mode fields
    annotations: list[TradeAnnotation] | None = None
    option_settings: OptionSettings | None = None

    @model_validator(mode="after")
    def validate_strategy_choice(self) -> "BacktestRequest":
        if self.mode == "mechanical":
            if not self.strategy_code and not self.builtin_strategy_id:
                raise ValueError("Provide either strategy_code or builtin_strategy_id for mechanical mode")
        elif self.mode == "manual":
            if not self.annotations:
                raise ValueError("Provide annotations for manual mode")
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


def _ts_to_label(ts: int | None) -> str | None:
    if ts is None:
        return None
    return datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")


def _symbol_from_filename(filename: str) -> str:
    base = Path(filename).stem
    return base.split("_")[0].upper() if base else filename.upper()


DATA_DIR = (Path(__file__).resolve().parent.parent.parent / "data").resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
RUNS_FILE = DATA_DIR / "runs.json"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)

# Initialize data downloader
downloader = DataDownloader(DATA_DIR)


def load_run_records() -> List[Dict[str, Any]]:
    if not RUNS_FILE.exists():
        return []
    try:
        return json.loads(RUNS_FILE.read_text())
    except json.JSONDecodeError:
        return []


def persist_run_record(record: Dict[str, Any]) -> None:
    runs = load_run_records()
    runs = [r for r in runs if r.get("run_id") != record.get("run_id")]
    runs.insert(0, record)
    runs = runs[:50]
    RUNS_FILE.write_text(json.dumps(runs))


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
def backtest(req: BacktestRequest) -> BacktestResponse:
    run_start = time.perf_counter()
    started_at = datetime.utcnow().isoformat() + "Z"
    run_id = uuid.uuid4().hex

    csv_path = Path(req.csv_path)
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="CSV path does not exist on server")

    data_feed = CSVBarDataFeed(csv_path=csv_path, symbol=req.symbol)

    # Manual mode
    if req.mode == "manual":
        if not req.annotations or not req.option_settings:
            raise HTTPException(status_code=400, detail="Manual mode requires annotations and option_settings")

        # Load price data
        import pandas as pd
        df = pd.read_csv(csv_path)
        timestamps = df["timestamp"].tolist()
        price_series = df["close"].tolist()

        # Run simulation
        simulator = ManualSimulator(
            annotations=req.annotations,
            timestamps=timestamps,
            price_series=price_series,
            option_settings=req.option_settings,
        )
        simulated_trades, manual_stats = simulator.simulate()

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

        response = BacktestResponse(
            mode="manual",
            config={
                "symbol": req.symbol,
                "initial_cash": req.initial_cash,
                "option_settings": req.option_settings.model_dump(),
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
        persist_run_record(record)
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
    persist_run_record(record)
    return response


@app.get("/datasets", response_model=DatasetListResponse)
def list_datasets() -> DatasetListResponse:
    if not DATA_DIR.exists():
        return DatasetListResponse(datasets=[])
    files: list[DatasetInfo] = []
    for f in DATA_DIR.glob("*.csv"):
        if not f.is_file():
            continue
        try:
            meta = inspect_csv(f)
        except Exception:
            files.append(DatasetInfo(name=f.name, path=str(f.resolve())))
            continue

        manifest_meta = downloader.manifest_entry_for_filename(f.name)
        start_label = (manifest_meta or {}).get("start_date_label") or _ts_to_label(meta.get("start"))
        end_label = (manifest_meta or {}).get("end_date_label") or _ts_to_label(meta.get("end"))
        date_range_label = (manifest_meta or {}).get("date_range_label")
        if not date_range_label and start_label and end_label:
            date_range_label = f"{start_label} → {end_label}"
        symbol = (manifest_meta or {}).get("symbol") or _symbol_from_filename(f.name)
        display_name = (manifest_meta or {}).get("display_name") or symbol
        files.append(
            DatasetInfo(
                name=f.name,
                path=str(f.resolve()),
                rows=meta.get("rows"),
                start=meta.get("start"),
                end=meta.get("end"),
                columns=meta.get("columns"),
                symbol=symbol,
                company_name=(manifest_meta or {}).get("company_name"),
                display_name=display_name,
                start_label=start_label,
                end_label=end_label,
                date_range_label=date_range_label,
                downloaded_at=(manifest_meta or {}).get("downloaded_at"),
            )
        )

    files = sorted(files, key=lambda d: d.name.lower())
    return DatasetListResponse(datasets=files)


@app.post("/upload-dataset", response_model=UploadResponse)
async def upload_dataset(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    dest_path = DATA_DIR / Path(file.filename).name
    content = await file.read()
    dest_path.write_bytes(content)
    try:
        meta = inspect_csv(dest_path)
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")
    return UploadResponse(name=dest_path.name, path=str(dest_path), size=len(content))


@app.get("/dataset-preview")
def dataset_preview(name: str, limit: int = 5) -> Dict[str, Any]:
    if limit <= 0:
        limit = 5
    if limit > 50:
        limit = 50

    file_path = (DATA_DIR / name).resolve()
    if not file_path.exists() or file_path.parent != DATA_DIR:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {e}")

    head = df.head(limit).to_dict(orient="records")
    tail = df.tail(limit).to_dict(orient="records")
    return {
        "name": name,
        "head": head,
        "tail": tail,
        "total_rows": int(len(df)),
        "columns": list(df.columns),
    }


@app.get("/runs")
def list_runs() -> Dict[str, Any]:
    runs = load_run_records()
    summaries = [
        {
            "run_id": r.get("run_id"),
            "saved_at": r.get("saved_at") or r.get("diagnostics", {}).get("completed_at"),
            "symbol": r.get("config", {}).get("symbol"),
            "total_return": r.get("stats", {}).get("total_return"),
            "max_drawdown": r.get("stats", {}).get("max_drawdown"),
        }
        for r in runs
    ]
    return {"runs": summaries}


@app.get("/runs/{run_id}")
def get_run(run_id: str) -> Dict[str, Any]:
    runs = load_run_records()
    for record in runs:
        if record.get("run_id") == run_id:
            return record
    raise HTTPException(status_code=404, detail="Run not found")


@app.post("/download-symbol")
def download_symbol(
    symbol: str,
    start_date: str | None = None,
    end_date: str | None = None,
    period: str = "max",
    refresh: bool = False,
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
    result = downloader.download_symbol(
        symbol=symbol.upper(),
        start_date=start_date,
        end_date=end_date,
        period=period,
        refresh=refresh,
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Download failed"))

    return result


@app.get("/symbol-info/{symbol}")
def get_symbol_info(symbol: str) -> Dict[str, Any]:
    """Get information about a symbol."""
    result = downloader.get_symbol_info(symbol.upper())

    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Symbol not found"))

    return result


@app.get("/annotations")
def get_annotations(dataset: str) -> AnnotationSet:
    """
    Get annotations for a dataset.

    Args:
        dataset: Dataset name (filename)

    Returns:
        AnnotationSet with all annotations
    """
    annotation_file = ANNOTATIONS_DIR / f"{dataset}.json"

    if not annotation_file.exists():
        return AnnotationSet(dataset_name=dataset, annotations=[])

    try:
        data = json.loads(annotation_file.read_text())
        return AnnotationSet(**data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load annotations: {e}")


@app.post("/annotations")
def save_annotations(annotation_set: AnnotationSet) -> Dict[str, str]:
    """
    Save annotations for a dataset.

    Args:
        annotation_set: AnnotationSet to save

    Returns:
        Success message
    """
    annotation_file = ANNOTATIONS_DIR / f"{annotation_set.dataset_name}.json"

    try:
        annotation_file.write_text(annotation_set.model_dump_json(indent=2))
        return {"status": "ok", "message": f"Saved {len(annotation_set.annotations)} annotations"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save annotations: {e}")


@app.delete("/annotations")
def delete_annotations(dataset: str) -> Dict[str, str]:
    """
    Delete all annotations for a dataset.

    Args:
        dataset: Dataset name

    Returns:
        Success message
    """
    annotation_file = ANNOTATIONS_DIR / f"{dataset}.json"

    if annotation_file.exists():
        annotation_file.unlink()

    return {"status": "ok", "message": "Annotations deleted"}

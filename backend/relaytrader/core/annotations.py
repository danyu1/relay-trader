"""
Annotation data models for manual/fundamental trading mode.
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class StockTradeAnnotation(BaseModel):
    """Represents a single stock trade annotation."""

    id: str = Field(..., description="Unique identifier for this annotation")
    entryTimestamp: int = Field(..., description="Entry timestamp in milliseconds")
    entryIndex: int = Field(..., description="Entry bar index")
    exitTimestamp: Optional[int] = Field(None, description="Exit timestamp in milliseconds")
    exitIndex: Optional[int] = Field(None, description="Exit bar index")
    quantity: int = Field(..., description="Number of shares")
    stopLoss: Optional[float] = Field(None, description="Stop loss price")
    takeProfit: Optional[float] = Field(None, description="Take profit price")


class TradeAnnotation(BaseModel):
    """Represents a single trade annotation (option position)."""

    id: str = Field(..., description="Unique identifier for this annotation")
    timestamp: int = Field(..., description="Timestamp in milliseconds when trade occurs")
    type: Literal["call", "put"] = Field(..., description="Option type")
    action: Literal["buy", "sell"] = Field(..., description="Buy to open or sell to close")
    strike: float = Field(..., description="Strike price")
    expiry: str = Field(..., description="Expiration date in YYYY-MM-DD format")
    contracts: int = Field(default=1, description="Number of contracts")
    premium: Optional[float] = Field(None, description="Premium per contract (if known)")
    note: Optional[str] = Field(None, description="User notes about this trade")
    tags: list[str] = Field(default_factory=list, description="Tags for categorization")
    source_url: Optional[str] = Field(None, description="URL to research/source")
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class AnnotationSet(BaseModel):
    """Collection of annotations for a dataset."""

    dataset_name: str = Field(..., description="Name of the dataset these annotations apply to")
    annotations: list[TradeAnnotation] = Field(default_factory=list)
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class OptionSettings(BaseModel):
    """Settings for option pricing simulation."""

    implied_volatility: float = Field(default=0.30, description="Implied volatility (0.30 = 30%)")
    risk_free_rate: float = Field(default=0.05, description="Risk-free interest rate (0.05 = 5%)")
    use_black_scholes: bool = Field(default=True, description="Use Black-Scholes vs simple payoff")
    scenario: Literal["base", "bull", "bear"] = Field(default="base", description="Price scenario")
    scenario_move_pct: float = Field(default=0.10, description="Bull/bear move percentage (0.10 = 10%)")
    commission_per_contract: float = Field(default=0.65, description="Commission per contract")


class SimulatedTrade(BaseModel):
    """Result of simulating a single trade annotation."""

    annotation_id: str
    entry_timestamp: int
    entry_price: float  # underlying price at entry
    option_premium_paid: float
    exit_timestamp: Optional[int] = None
    exit_price: Optional[float] = None  # underlying price at exit
    option_premium_received: Optional[float] = None
    payoff: float  # Net P&L for this trade
    status: Literal["open", "closed", "expired"] = "open"
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None


class ManualBacktestStats(BaseModel):
    """Statistics from manual/fundamental backtest."""

    total_premium_spent: float
    total_premium_received: float
    net_premium: float
    max_payoff: float
    min_payoff: float
    net_pnl: float
    win_rate: float
    num_trades: int
    num_winners: int
    num_losers: int
    avg_win: float
    avg_loss: float
    max_win: float
    max_loss: float
    return_on_capital: float

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    datasets = relationship("Dataset", back_populates="user", cascade="all, delete-orphan")
    dataset_profiles = relationship("DatasetProfile", back_populates="user", cascade="all, delete-orphan")
    backtest_runs = relationship("BacktestRun", back_populates="user", cascade="all, delete-orphan")
    portfolios = relationship("Portfolio", back_populates="user", cascade="all, delete-orphan")
    manual_configs = relationship("ManualConfig", back_populates="user", cascade="all, delete-orphan")
    line_styles = relationship("LineStyle", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("UserSetting", back_populates="user", cascade="all, delete-orphan")
    annotations = relationship("DatasetAnnotation", back_populates="user", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_dataset_user_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    columns: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    end_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date_range_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    downloaded_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="datasets")
    profiles = relationship("DatasetProfile", back_populates="dataset", cascade="all, delete-orphan")
    backtest_runs = relationship("BacktestRun", back_populates="dataset")
    annotations = relationship("DatasetAnnotation", back_populates="dataset", cascade="all, delete-orphan")
    manual_configs = relationship("ManualConfig", back_populates="dataset", cascade="all, delete-orphan")


class DatasetProfile(Base):
    __tablename__ = "dataset_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    start_index: Mapped[int] = mapped_column(Integer, nullable=False)
    end_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    initial_equity: Mapped[float] = mapped_column(Float, default=10000.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="dataset_profiles")
    dataset = relationship("Dataset", back_populates="profiles")


class BacktestRun(Base):
    __tablename__ = "backtest_runs"
    __table_args__ = (UniqueConstraint("run_id", name="uq_backtest_run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id"), nullable=True)
    mode: Mapped[str] = mapped_column(String(32), default="mechanical")
    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    saved_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="backtest_runs")
    dataset = relationship("Dataset", back_populates="backtest_runs")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    cash: Mapped[float] = mapped_column(Float, default=0.0)
    context: Mapped[str] = mapped_column(String(32), default="builder")
    chart_config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    line_styles: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    target_allocations: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    performance_history: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="portfolios")
    holdings = relationship("PortfolioHolding", back_populates="portfolio", cascade="all, delete-orphan")


class PortfolioHolding(Base):
    __tablename__ = "portfolio_holdings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    shares: Mapped[float] = mapped_column(Float, default=0.0)
    avg_cost: Mapped[float] = mapped_column(Float, default=0.0)
    cost_basis: Mapped[float | None] = mapped_column(Float, nullable=True)
    purchase_date: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_date: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    card_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    line_thickness: Mapped[float | None] = mapped_column(Float, nullable=True)
    font_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_update: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    portfolio = relationship("Portfolio", back_populates="holdings")


class ManualConfig(Base):
    __tablename__ = "manual_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    trades: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    initial_cash: Mapped[float] = mapped_column(Float, default=100000.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="manual_configs")
    dataset = relationship("Dataset", back_populates="manual_configs")


class LineStyle(Base):
    __tablename__ = "line_styles"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_line_style_user_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    color: Mapped[str] = mapped_column(String(32), nullable=False)
    thickness: Mapped[float] = mapped_column(Float, default=2.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="line_styles")


class UserSetting(Base):
    __tablename__ = "user_settings"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_settings_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[dict[str, Any] | list[Any] | str | int | float | bool | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="settings")


class DatasetAnnotation(Base):
    __tablename__ = "dataset_annotations"
    __table_args__ = (UniqueConstraint("user_id", "dataset_id", name="uq_annotation_user_dataset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="annotations")
    dataset = relationship("Dataset", back_populates="annotations")

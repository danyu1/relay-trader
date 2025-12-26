from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _default_db_url() -> str:
    # Check for Railway volume mount path first
    volume_mount = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    if volume_mount:
        base_dir = Path(volume_mount)
        base_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{base_dir / 'relaytrader.db'}"

    # Default to local data directory
    base_dir = Path(__file__).resolve().parents[2] / "data"
    base_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{base_dir / 'relaytrader.db'}"


DATABASE_URL = os.getenv("DATABASE_URL", _default_db_url())

# Railway provides postgres:// but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


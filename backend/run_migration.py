#!/usr/bin/env python3
"""Run Alembic migrations programmatically"""

import sys
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from alembic import command
from alembic.config import Config

def run_migration():
    """Run database migrations"""
    # Get the alembic.ini file path
    alembic_ini = backend_dir / "alembic.ini"

    # Create Alembic config
    alembic_cfg = Config(str(alembic_ini))

    # Run migrations to head
    print("Running database migrations...")
    command.upgrade(alembic_cfg, "head")
    print("✓ Migrations complete!")

if __name__ == "__main__":
    run_migration()

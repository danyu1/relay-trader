#!/usr/bin/env python3
"""Initialize database with all tables"""

import sys
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from relaytrader.db.database import engine, Base
from relaytrader.db import models  # Import models to register them with Base

def init_database():
    """Create all database tables"""
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ Database initialized successfully!")
    print(f"✓ Created {len(Base.metadata.tables)} tables")
    print(f"  Tables: {', '.join(Base.metadata.tables.keys())}")

if __name__ == "__main__":
    init_database()

#!/usr/bin/env python3
"""
Initialize default permissions and groups/roles.
Delegates to seed_permissions.py which contains the full
granular per-sub-page permission set.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Import all models first to avoid relationship errors
import app.models  # noqa: F401

from scripts.seed_permissions import seed_permissions as _seed

def init_permissions():
    print("=" * 60)
    print("Initializing Permissions and Groups")
    print("=" * 60)
    _seed()

if __name__ == "__main__":
    init_permissions()

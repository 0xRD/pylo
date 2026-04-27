#!/bin/sh
set -e
cd /app

# On a brand-new database, the alembic_version table does not exist yet.
# Running incremental migrations on an empty DB fails because early migrations
# try to ALTER tables that haven't been created yet (the initial migration is empty).
# Fix: detect fresh DB → create_all first, then stamp head.
HAS_ALEMBIC=$(python3 - <<'PY'
import os, sqlite3
url = os.environ.get("DATABASE_URL", "sqlite:///./objects_storage/pylo.db")
path = url.replace("sqlite:///", "").replace("sqlite://", "")
try:
    conn = sqlite3.connect(path)
    row = conn.execute("SELECT name FROM sqlite_master WHERE name='alembic_version'").fetchone()
    print("yes" if row else "no")
except Exception:
    print("no")
PY
)

if [ "$HAS_ALEMBIC" = "no" ]; then
    echo "Fresh database detected — initialising schema then stamping migrations."
    python3 -c "from backend.database import init_db; init_db()"
    python -m alembic stamp head
else
    echo "Existing database detected — applying incremental migrations."
    python -m alembic upgrade head
fi

exec uvicorn backend.main:app --host 0.0.0.0 --port 8000

#!/bin/sh
set -e
cd /app

# Fresh databases are initialised from SQLModel metadata and stamped at the
# current migration head. Existing databases run normal Alembic upgrades.
HAS_ALEMBIC=$(python3 - <<'PY'
import time
from sqlalchemy import inspect
from backend.database import engine

last_exc = None
for _ in range(30):
    try:
        with engine.connect() as conn:
            print("yes" if inspect(conn).has_table("alembic_version") else "no")
        raise SystemExit(0)
    except Exception as exc:
        last_exc = exc
        time.sleep(2)
print(f"error:{last_exc}")
raise SystemExit(1)
PY
)

if [ "$HAS_ALEMBIC" = "no" ]; then
    echo "Fresh database detected — initialising schema then stamping migrations."
    python3 -c "from backend.database import init_db; init_db()"
    python -m alembic stamp head
else
    echo "Existing database detected — applying incremental migrations."
    python -m alembic upgrade head
    python3 -c "from backend.database import init_db; init_db()"
fi

exec uvicorn backend.main:app --host 0.0.0.0 --port 8000

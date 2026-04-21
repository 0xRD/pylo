# Pylo — Claude Context

> Read this first. Full technical spec: `docs/pylo-spec-v2-en.md`. Session history: `docs/PROGRESS.md`. Feature backlog: `docs/TODO.md`.

## What is Pylo

Python automation orchestration platform for SOAR and data pipelines. Users write **PyBooks** (Python scripts running in isolated Docker containers), define **Blueprints** (REST API data sources with field mappings), and link them so new data entries automatically trigger playbooks.

## Environment

- **VM**: `claude-workspace@orb` (OrbStack Ubuntu 25.10) — all code at `~/pylo`
- **Stack**: FastAPI + SQLModel + SQLite backend · React 18 + Vite + Tailwind CSS v3 frontend · Docker Compose
- **Running services**: `docker compose up -d` → frontend on :3000, backend on :8000
- **Auth**: `X-API-Token` header on all API calls. Token in `~/pylo/.env`
- **DB**: `~/pylo/objects_storage/pylo.db` (SQLite, migrations via Alembic, run on container start)
- **No hot-reload in Docker**: after backend changes, run `docker compose build backend --no-cache && docker compose up -d backend`. Frontend: same with `frontend`.

## Repository State (as of session 9)

All features committed and working. Clean `main` branch, 5 commits ahead of `origin/main`.

Current Alembic head: `e8f6a5b4c3d2` (trigger_conditions on blueprint table)

## Next Priorities (from `docs/TODO.md`)

1. **#1** Entry deduplication + mutable fields + audit trail — highest SOAR value
2. **#4** User authentication + roles — JWT, login page, admin/viewer roles
3. **#9** Paginated API source fetching — cursor/page/offset pagination in `_do_fetch`
4. **#15** Multi-PyBook blueprint triggers — subscribe to blueprint events from the PyBook editor
5. **#6** Re-parse entries on mapping change — background task after blueprint update
6. **#19** Always-on sub-PyBooks — warm Docker containers for near-instant invocation

## Key Files to Know

```
backend/api/blueprints.py    # fetch pipeline, trigger logic, entry CRUD
backend/objects/filter.py    # field query language + trigger condition engine
backend/core/queue_manager.py # async execution queue
backend/core/scheduler.py    # APScheduler for cron + blueprint fetch schedules
frontend/src/components/BlueprintForm.jsx  # reused in create modal + settings tab
frontend/src/pages/BlueprintDetail.jsx     # tabbed detail (entries + settings)
frontend/src/pages/Entries.jsx             # global entries view
pylo_sdk.py                  # mounted into every PyBook container
```

## Critical Patterns

- **Route ordering**: `/blueprints/entries/:id` before `/blueprints/:id` in App.jsx; `/api/runs/queue` before `/api/runs/{run_id}` in runs.py
- **Run lifecycle**: always write `status="queued"` to DB *before* calling `queue_manager.enqueue()` — this ensures orphan recovery on restart
- **Trigger payload** (blueprint → PyBook): `{"blueprint_id": "...", "entry_id": "...", "entry_data": {...}}`
- **New DB column**: add to `models.py` with `Field(default=...)` + new Alembic migration with `server_default`
- **Backend deploy**: source files are copied into the Docker image at build time (not volume-mounted), so `docker compose build` is required after any Python change
- **BlueprintForm is the single source of truth** for blueprint editing — used both in the "New Blueprint" modal and the Settings tab; don't fork it

## Development Workflow

```bash
# Deploy backend change
ssh claude-workspace@orb 'cd ~/pylo && docker compose build backend --no-cache && docker compose up -d backend'

# Deploy frontend change
ssh claude-workspace@orb 'cd ~/pylo && docker compose build frontend --no-cache && docker compose up -d frontend'

# Check logs
ssh claude-workspace@orb 'cd ~/pylo && docker compose logs backend --tail=20'

# Run a quick API test
ssh claude-workspace@orb 'source ~/pylo/.env && curl -s -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/blueprints | python3 -m json.tool | head -20'

# Write and SCP a patch script (preferred for complex multi-file changes)
# 1. Write /tmp/patch_X.py locally
# 2. scp /tmp/patch_X.py claude-workspace@orb:/tmp/
# 3. ssh claude-workspace@orb 'cd ~/pylo && python3 /tmp/patch_X.py'
# 4. Rebuild + verify
```

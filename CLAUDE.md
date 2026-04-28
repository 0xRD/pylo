# Pylo — Claude Context

> Read this first. Full technical spec: `docs/pylo-spec-v2-en.md`. Session history: `docs/PROGRESS.md`. Feature backlog: `docs/TODO.md`.

## What is Pylo

Python automation orchestration platform for SOAR and data pipelines. Users write **PyBooks** (Python scripts running in isolated Docker containers), define **Blueprints** (REST API data sources with field mappings), chain them into **Workflows** (visual DAG editor), and trigger everything on schedules, blueprint events, or webhooks.

## Environment

- **VM**: `claude-workspace@orb` (OrbStack Ubuntu 25.10) — all code at `~/pylo`
- **SSH**: `ssh claude-workspace@orb` (OrbStack config included via `~/.ssh/config`)
- **Stack**: FastAPI + SQLModel + SQLite backend · React 18 + Vite + Tailwind CSS v3 frontend · Docker Compose
- **Running services**: `docker compose up -d` → frontend on :3000, backend on :8000
- **Auth**: `X-API-Token` header on all API calls (or httpOnly JWT cookie from browser login). Token in `~/pylo/.env`
- **DB**: `~/pylo/objects_storage/pylo.db` (SQLite + FTS5, migrations via Alembic, run on container start)
- **Test credentials**: username=`Romain`, password=`12345678`
- **No hot-reload in Docker**: after backend changes → `docker compose build backend && docker compose up -d backend`. Frontend: same with `frontend`.

## Repository State (after Session 12)

Branch: `main`. All features committed. Pushed to `https://github.com/0xRD/pylo`.

**Alembic head**: `j9k0l1m2n3o4` (adds `mutable_mode` on blueprint + `entry_event` table)

Migration chain:
```
fc661ed4275a (initial) → 1fd00603a2fc (fetch_cron) → a3f2b1c4d5e6 (rename objects→blueprints)
→ b5c3d2e1f0a9 (trigger_event) → c6d4e3f2a1b0 (pybook tags) → d7e5f4a3b2c1 (system_setting)
→ e8f6a5b4c3d2 (trigger_conditions) → f1a2b3c4d5e6 (blueprint→pybook trigger ownership)
→ g2h3i4j5k6l7 (activity_log) → h7i8j9k0l1m2 (workflows + output_vars)
→ i8j9k0l1m2n3 (workflow trigger_config) → j9k0l1m2n3o4 (mutable_mode + entry_event)
```

## Key Files to Know

```
backend/api/blueprints.py      # fetch pipeline, _fire_blueprint_triggers (PyBook+Workflow),
                               # entry CRUD, PATCH entry (mutability), history endpoint
backend/api/workflows.py       # Workflow CRUD, WorkflowRun, global /runs endpoint
backend/api/runs.py            # PyBookRun history, WebSocket live log
backend/api/system.py          # /info, /update/check, /update/apply, /update/status
backend/api/settings.py        # system settings (concurrency, JWT, retention)
backend/objects/models.py      # Blueprint, Entry, EntryEvent SQLModel classes
backend/objects/filter.py      # field query language + check_trigger_conditions
backend/workflows/executor.py  # DAG executor: topological sort, asyncio.gather, var passing
backend/core/queue_manager.py  # asyncio Semaphore-based execution queue
backend/core/scheduler.py      # APScheduler: blueprint cron fetch + workflow cron runs
frontend/src/pages/Runs.jsx          # unified PyBook + Workflow run history
frontend/src/pages/Automations.jsx   # all active triggers in one view
frontend/src/pages/WorkflowEditor.jsx # 3-panel DAG editor (palette / canvas / properties)
frontend/src/pages/EntryDetail.jsx   # Fields/Raw/History tabs + inline edit
frontend/src/components/BlueprintForm.jsx  # field mappings + mutable_mode selector
frontend/src/components/ScheduleBuilder.jsx # human-friendly cron builder
pylo_sdk.py                    # auto-mounted in every PyBook container
```

## Critical Patterns

- **Route ordering**: `/blueprints/entries/:id` before `/blueprints/:id` in App.jsx; `/api/runs/queue` and `/api/workflows/runs` before `/{id}` in their routers — FastAPI matches in declaration order
- **Run lifecycle**: always write `status="queued"` to DB *before* calling `queue_manager.enqueue()` — ensures orphan recovery on restart
- **Workflow trigger_config**: stored as JSON string in DB, includes `blueprint_id` and `trigger_event` for blueprint triggers, `cron` for cron triggers
- **Blueprint trigger fan-out**: `_fire_blueprint_triggers(bp, created_entries)` is the single entry point — queries both PyBook and Workflow subscribers, evaluates conditions (PyBooks only), caps at 50 per subscriber
- **asyncio in sync functions**: use `asyncio.get_running_loop().create_task(...)` — NOT `get_event_loop()` (deprecated in Python 3.10+)
- **Self-update**: backend container has git + Docker CLI; repo is mounted at `/app/repo`; `git config --global --add safe.directory /app/repo` needed before git commands

## Architecture Summary

```
Browser (React 18 + Vite + Tailwind)
  ↓ nginx proxy
FastAPI backend (port 8000)
  ├── /api/auth, /api/users          — JWT cookie auth + roles
  ├── /api/blueprints                — Blueprint CRUD, fetch, entry CRUD, mutability
  ├── /api/pybooks                   — PyBook CRUD, manual run
  ├── /api/runs                      — PyBookRun history, WebSocket logs
  ├── /api/workflows                 — Workflow CRUD, WorkflowRun, global /runs
  ├── /api/secrets                   — Encrypted Fernet store
  ├── /api/settings                  — Concurrency, JWT, activity retention
  ├── /api/system                    — git info, self-update check/apply
  ├── /api/webhooks                  — inbound webhook triggers
  └── /api/activity                  — audit event log
  
  APScheduler (in-process)
    ├── blueprint cron jobs (cron_obj_{id})
    └── workflow cron jobs (cron_wf_{id})
  
  asyncio Semaphore queue → Docker sibling containers (DooD)
    └── pylo_sdk.py + PyBook script mounted at runtime
    
  SQLite + FTS5 (objects_storage/pylo.db)
  Alembic migrations (run on container start)
  
  /app/repo → ~/pylo (host) — for self-update
  /var/run/docker.sock → Docker daemon — for running PyBooks + self-update
```

## Next Priorities (from docs/TODO.md)

1. **trigger_conditions for workflow blueprint triggers** — PyBooks already have this; Workflows currently fire unconditionally
2. **Task 5: pylo_sdk standalone library** — pip-installable `PyloClient` class, `docs/SDK.md`
3. **Paginated API source fetching** — cursor/page/offset pagination in `_do_fetch`
4. **Scoped API keys** — per-key permissions
5. **Configuration backup & restore** — export/import + Git integration
6. **Re-parse entries on mapping change** — background task after blueprint update

## Common Operations

```bash
# Build + restart backend after code changes
ssh claude-workspace@orb "cd /home/romain/pylo && docker compose build backend && docker compose up -d backend"

# Build + restart frontend
ssh claude-workspace@orb "cd /home/romain/pylo && docker compose build frontend && docker compose up -d frontend"

# Run tests
ssh claude-workspace@orb "docker compose -f /home/romain/pylo/docker-compose.yml exec backend python3 -m pytest tests/ -x -q"

# Apply migrations
ssh claude-workspace@orb "docker compose -f /home/romain/pylo/docker-compose.yml exec backend python -m alembic upgrade head"

# Check current migration
ssh claude-workspace@orb "docker compose -f /home/romain/pylo/docker-compose.yml exec backend python -m alembic current"

# View backend logs
ssh claude-workspace@orb "docker compose -f /home/romain/pylo/docker-compose.yml logs backend --tail=50"

# Quick API test (after login)
ssh claude-workspace@orb "curl -s http://localhost:8000/health"
```

## Known Quirks / Watch Out For

- The `/app/repo` mount uses the host user's files but the container runs as root → `git` will complain about "dubious ownership" unless you run `git config --global --add safe.directory /app/repo` first
- When writing Python patch scripts, escape quotes carefully — the `PYEOF` heredoc approach is safer than inline `-c` commands for complex patches
- Backend source is baked into the Docker image at build time (`COPY . /app/backend/`); only `migrations/`, `tests/`, `pylo_sdk.py`, `alembic.ini`, and the repo dir (`/app/repo`) are live-mounted
- The duplicate function bug: a previous patch session accidentally created duplicate `_fire_blueprint_triggers` definitions. Always check after patching with `grep -c 'def function_name'`

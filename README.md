# Pylo

**Python automation orchestration platform for SOAR and beyond.** Write Python scripts (PyBooks) that run in isolated Docker containers, ingest structured data from external APIs (Blueprints), manage secrets securely, and trigger automations on schedules, webhooks, or data events.

## Quick Start

### Requirements
- OrbStack (or Docker + Docker Compose)
- A host running the Docker daemon

### 1. Clone and configure

```bash
git clone https://github.com/0xRD/pylo
cd pylo
cp .env.example .env
```

Edit `.env`:

```env
API_TOKEN=your_secure_token_here
SECRET_KEY=your_32_char_secret_key_here
```

### 2. Start

```bash
docker compose up -d
```

Frontend: `http://localhost:3000` — API: `http://localhost:8000`

---

## Core Concepts

### PyBooks
Python scripts that run inside isolated Docker containers. Each PyBook has:
- A Python script edited in the browser (Monaco editor)
- A trigger: **manual**, **cron schedule**, **webhook**, or **blueprint event**
- Optional **required secrets** (injected as env vars at runtime)
- **Sub-PyBook** mode — callable from other PyBooks via `pylo_sdk.call_sub_pybook()`

### Blueprints
Define a schema and data source for structured objects. Each Blueprint has:
- A **source URL** (REST API endpoint) with configurable method, headers, and body
- **Authentication** — Bearer Token, API Key (any header), or Basic Auth, all referencing stored secrets
- **Field mappings** — JSONPath expressions mapped to named fields with type coercion
- A **unique key field** for deduplication on repeated fetches
- An optional **auto-fetch schedule** (human-friendly builder → cron under the hood)
- **Manual mode** — no API source, entries are managed directly in the UI (useful for shared variables, rule toggles, allow/blocklists)

### Entries
Individual records stored under a Blueprint. Created by fetching the source API or manually (manual blueprints). Searchable via full-text search (FTS5). Accessible from PyBooks via `pylo_sdk`.

### Secrets
Encrypted key-value store (Fernet/AES-128). Secret values are never returned by the API. Referenced in Blueprint headers as `{{secret:name}}` — resolved at fetch time. Injected into PyBook containers as environment variables.

### Runs
Every PyBook execution creates a Run with full stdout/stderr logs, status, and timing. Live log streaming via WebSocket.

---

## PyBook SDK (`pylo_sdk`)

Available inside every PyBook container as `/app/pylo_sdk.py`:

```python
from pylo_sdk import search_entries, get_entry, call_sub_pybook

# Full-text search across blueprint entries
entries = search_entries("mimikatz", blueprint_id="<id>")

# Fetch a single entry by ID
entry = get_entry("<entry_id>")

# Trigger a sub-PyBook and wait for its result
result = call_sub_pybook("<pybook_id>", payload={"alert_id": "123"})
```

---

## Blueprint Authentication

In the Blueprint form, use the **Authentication** section to configure API auth without writing templates manually:

| Type | What gets sent |
|---|---|
| Bearer Token | `Authorization: Bearer <secret_value>` |
| API Key (header) | `<header_name>: <secret_value>` (e.g. `X-Apikey`) |
| Basic Auth | `Authorization: Basic <base64(secret_value)>` — store as `user:password` |

Secrets are selected from your stored secrets by name. The `{{secret:name}}` template is built and stored transparently.

---

## Auto-fetch Schedules

Blueprints support recurring fetches via the **Schedule Builder** — no cron syntax required:

- **Every…** mode: "Every 5 minutes", "Every 2 hours", "Every 1 day"
- **At a time** mode: pick a 24h time + day-of-week chips (e.g. "At 18:00 on Sunday")

The cron expression is shown as a read-only preview for verification.

---

## API Authentication

All API endpoints require `X-API-Token: <your_token>` header. Set `API_TOKEN` in `.env`.

```bash
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/blueprints
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  Browser        │────▶│  nginx (port 3000)                   │
│  React + Vite   │     │  ├─ /          → React SPA           │
└─────────────────┘     │  └─ /api/*     → FastAPI (port 8000) │
                        └──────────────────────────────────────┘
                                          │
                        ┌─────────────────▼────────────────────┐
                        │  FastAPI backend                      │
                        │  ├─ /api/blueprints  Blueprint CRUD  │
                        │  ├─ /api/pybooks     PyBook CRUD/run │
                        │  ├─ /api/runs        Run logs/WS     │
                        │  ├─ /api/secrets     Secret store    │
                        │  └─ /api/webhooks    Webhook trigger │
                        │                                       │
                        │  APScheduler — cron triggers          │
                        │  SQLite + FTS5 — persistence/search  │
                        └──────────────────┬───────────────────┘
                                           │ docker socket
                        ┌──────────────────▼───────────────────┐
                        │  Docker (sibling containers)          │
                        │  python:3.12-slim per PyBook run      │
                        │  pylo_sdk.py injected at runtime      │
                        └──────────────────────────────────────┘
```

---

## Development

```bash
# Backend only (hot-reload)
cd backend && uvicorn backend.main:app --reload

# Frontend only (Vite dev server)
cd frontend && npm run dev

# Run tests
docker compose run --rm backend python -m pytest tests/ -v
```

### Database migrations

Alembic is used for schema migrations. The entrypoint runs `alembic upgrade head` automatically on startup.

```bash
# Generate a new migration (run inside backend container or with venv)
alembic revision --autogenerate -m "describe change"
```

---

## Roadmap

See the [feature backlog](https://github.com/0xRD/pylo) for planned features including:
- Login page + admin/viewer roles (JWT auth)
- Mutable fields + upsert on fetch + instance history
- Manual entry creation UI for manual blueprints
- Paginated API source fetching (cursor, page, offset)
- Blueprint/Entry UI restructure (tabbed detail pages)
- Cross-type entry search + field query language
- PyBook filtering + tags
- Scoped API Keys

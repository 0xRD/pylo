# Pylo

**Python automation orchestration platform for SOAR and beyond.** Write Python scripts (PyBooks) that run in isolated Docker containers, ingest structured data from external APIs (Blueprints), manage secrets securely, and trigger automations on schedules, webhooks, or data events.

## Quick Start

### Requirements
- Docker (with Compose plugin) — installed automatically by `setup.sh` if missing
- git

### 1. Clone

```bash
git clone https://github.com/0xRD/pylo
cd pylo
```

### 2. Run setup

```bash
bash setup.sh
```

`setup.sh` handles everything on a fresh machine:
- Installs Docker if not present
- Generates a `.env` with secure `SECRET_KEY` and `API_TOKEN`
- Builds the PyBook runner base image (`pylo-runner-base:latest`)
- Starts the stack with `docker compose up -d --build`
- Waits for the backend health check

It prints your `API_TOKEN` at the end — save it for SDK/script access.

### 3. Create your admin account

Open `http://localhost:3000` in your browser. You are redirected to a **setup wizard** where you create the first admin account (minimum 8-character password).

The wizard disappears once the first user exists. Add more users from the **Users** page.

### Manual setup (optional)

If you prefer to configure things yourself:

```bash
cp .env.example .env
# Edit .env: set SECRET_KEY and API_TOKEN to random values
# Build the PyBook runner base image:
docker build -t pylo-runner-base:latest -f docker/pybook-runner/Dockerfile.base docker/pybook-runner/
# Start:
docker compose up -d --build
```

---

## Core Concepts

### PyBooks
Python scripts that run in isolated Docker containers. Each PyBook has:
- A Python script edited in the browser (Monaco editor)
- A **trigger**: manual, cron schedule, webhook, or blueprint event
- Optional **required secrets** (injected as environment variables at runtime)
- **Sub-PyBook** mode — callable from other PyBooks via `pylo_sdk.call_sub_pybook()`
- **Tags** — free-form labels; filter the sidebar by tag to find related playbooks

### Blueprints
Define a schema and data source for structured data. Each Blueprint has:
- A **source URL** (REST API endpoint) with configurable method, headers, and body
- **Authentication** — Bearer Token, API Key (any header), or Basic Auth via stored secrets
- **Field mappings** — JSONPath expressions mapped to named fields with type coercion
- A **unique key field** for deduplication on repeated fetches (★ marker in the field mapping builder)
- An optional **auto-fetch schedule** (human-friendly builder generates cron under the hood)
- **Manual mode** — no API source; entries are created directly in the UI (shared variables, rule toggles, allow/blocklists)

Multiple PyBooks can subscribe to a Blueprint's entry events independently (see [Blueprint → PyBook Trigger](#blueprint--pybook-trigger)).

### Entries
Individual records stored under a Blueprint. Created by fetching a source API or manually (manual blueprints). Searchable globally across all blueprints via the Entries page, or scoped to a specific Blueprint's detail view.

**Field query language** — filter entries by parsed field values directly in the UI:

```
severity = "high"
category contains "Execute"
os starts_with "Windows"
score > 7.5
severity = "critical" AND status != "closed"
```

Operators: `=` `!=` `contains` `starts_with` `>` `>=` `<` `<=` — AND-chained. Applied server-side via SQLite `json_extract` for correct pagination.

### Secrets
Encrypted key-value store (Fernet/AES-128). Secret values are never returned by the API after creation. Referenced in Blueprint headers as `{{secret:name}}` — resolved at fetch time. Injected into PyBook containers as `SECRET_<name>` environment variables.

### Runs
Every PyBook execution creates a Run record with full stdout/stderr, exit code, duration, and trigger source. Live log streaming via WebSocket. The **execution queue** (default: 5 concurrent runs) ensures no run is lost even under heavy load.

---

## Navigation

| Route | Description |
|---|---|
| `/blueprints` | Blueprint card grid — create and manage data sources |
| `/blueprints/:id` | Blueprint detail — **Entries** tab (data) + **Settings** tab (config, delete) |
| `/entries/:id` | Single entry detail with raw, parsed fields, editable mutable fields, and history |
| `/blueprints/entries/:id` | Legacy single-entry detail route, kept for compatibility |
| `/entries` | Global entries view — full-text search, field filter, blueprint chips, multi-select bulk delete |
| `/pybooks` | PyBook editor with sidebar filters, Monaco editor, SDK reference, and run console with output variables |
| `/runs` | Unified PyBook + Workflow run history with type filter |
| `/automations` | All active scheduled/triggered PyBooks and Workflows in one view |
| `/secrets` | Encrypted secret management |
| `/workflows` | Workflow list — visual DAG editor for multi-step automation |
| `/settings` | System settings (max concurrent runs, session duration, self-update) |
| `/users` | User management — admin only |

---

## PyBook SDK

Available inside every PyBook at `/app/pylo_sdk.py` (auto-mounted at runtime):

```python
from pylo_sdk import search_entries, get_entry, call_sub_pybook

# Full-text search across blueprint entries (optionally scoped to a blueprint)
alerts = search_entries("mimikatz", type_id="<blueprint_id>")
# search_entries returns the entry list directly, even though the API endpoint is paginated.

# Fetch a single entry by ID
entry = get_entry("<entry_id>")
# entry["data"] and entry["raw_data"] are JSON strings; parse them before indexing.

# Trigger a sub-PyBook synchronously and get its result
result = call_sub_pybook("<sub_pybook_id>", payload={"alert_id": "123"})
```

Export variables for use in downstream workflow nodes or for inspection after the run:

```python
# Export one variable at a time
pylo.set_output("alert_id", "abc-123")
pylo.set_output("vt_score", 0.92)

# Or export all local variables at once (filters non-serialisable values)
vt_score = 0.92
is_malicious = vt_score > 0.7
pylo.export_vars(locals())
```

Exported variables appear in the **Variables** panel of the run detail and can be passed to downstream Workflow nodes via edge payload mappings (`$.vars.key`).

Secrets are injected as environment variables:

```python
import os
api_key = os.environ["SECRET_virustotal_key"]
```

---


### Workflows

Visual DAG (directed acyclic graph) editor for chaining multiple PyBooks into multi-step automations.

- **Nodes**: drag PyBooks onto the canvas from the left palette
- **Edges**: draw connections between nodes; set condition (`always` / `on success` / `on failure`)
- **Payload mappings**: pass output variables from one node to the next via `$.vars.key` references
- **Triggers**: same options as PyBooks — manual, cron, webhook, or blueprint event with optional trigger conditions
- **Execution**: parallel fan-out via asyncio, topological ordering, per-node status tracking
- **Runs**: per-workflow run history with node-level status and output variables

The Workflow editor auto-saves changes. Runs are tracked separately from PyBook runs and visible in both the Workflow editor sidebar and the unified Runs page.

---
## Blueprint Authentication

The Authentication section in the Blueprint form builds the auth header from a stored secret — no manual template editing required:

| Type | Header sent |
|---|---|
| Bearer Token | `Authorization: Bearer <secret_value>` |
| API Key (header) | `<header_name>: <secret_value>` (e.g. `X-Apikey: abc123`) |
| Basic Auth | `Authorization: Basic <base64(secret)>` — store credentials as `user:password` |

Additional headers (e.g. `Accept`, `X-Tenant-Id`) can be added separately in the **Additional Headers** JSON field.

---

## Auto-fetch Schedules

Both Blueprints and PyBook cron triggers use the **Schedule Builder** — no cron syntax required:

- **Every…** mode: "Every 5 minutes", "Every 2 hours", "Every 1 day"
- **At a time** mode: choose a 24h time + day-of-week chips ("At 18:00 on Mon–Fri")

The generated cron expression is shown as a read-only preview.

---

## Blueprint → PyBook Trigger

PyBooks subscribe to Blueprint events from the **PyBook editor**, not the Blueprint settings. This allows multiple PyBooks to react to the same Blueprint independently.

**To subscribe a PyBook to a Blueprint:**

1. Open the PyBook editor → click **Edit trigger** in the trigger bar
2. Set trigger type to **blueprint**
3. Select the Blueprint and the event:
   - **On new entry** — fires once per new entry created by a fetch
   - **On new or updated entry** — fires on create or update
4. Optionally add **trigger conditions** — field-level filters that must match before the run is enqueued (e.g. `severity = "critical"`)

**To see which PyBooks are watching a Blueprint:**

Open the Blueprint → **Settings** tab → **Subscribed PyBooks** section.

Triggered runs go through the shared execution queue with the same concurrency limit as manual runs. Each subscriber has its own condition list and is capped at 50 triggered runs per fetch cycle.

---

## Entry Field Filter

Both the global **Entries** page and the per-blueprint **Entries** tab expose a field filter input. Entries are filtered server-side — pagination stays correct even with complex conditions.

**Syntax:**
```
field_name OPERATOR "value"
```

Multiple conditions joined with `AND`:
```
severity = "critical" AND category contains "Execute" AND os starts_with "Windows"
```

**Operators:**

| Operator | Behaviour |
|---|---|
| `=` | Exact match (case-insensitive) |
| `!=` | Not equal (case-insensitive) |
| `contains` | Substring present (case-insensitive) |
| `starts_with` | Prefix match (case-insensitive) |
| `>` `>=` `<` `<=` | Numeric comparison (values coerced to float) |

The `?` button next to the filter input shows inline syntax examples.

---

## Bulk Entry Actions

Hover over any entry card to reveal a checkbox. Select one or more entries to open the bulk action bar:

- **Count** — shows how many entries are selected
- **Select all** — selects all visible entries on the current page
- **Clear** — deselects everything
- **Delete N entries** — confirms and deletes all selected entries in parallel

---

## Execution Queue

PyBook runs are **persistent** — every run is written to the database as `queued` before execution starts. A server restart never drops waiting jobs; orphaned runs are recovered automatically on startup.

- Default concurrency: **5 simultaneous Docker containers**
- Configurable live via **Settings → Max concurrent runs** (1–20), no restart needed
- Also settable via `PYLO_MAX_CONCURRENT_RUNS` env var (DB setting takes precedence)
- Queue depth and running count visible on the **Runs page** (live, refreshes every 2 s)

---

## Authentication

### Browser / console

The console uses **httpOnly cookie-based JWT**. Login at `/login` (or go through the setup wizard on first launch). Sessions last 24 h by default — configurable in **Settings → Session duration** or via `JWT_EXPIRE_HOURS` in `.env`.

Roles:
- **Admin** — full access (create, edit, delete, trigger)
- **Viewer** — read-only; write actions are visible but disabled

### Scripts / SDK / external integrations

Use the master `API_TOKEN` from `.env` via the `X-API-Token` header — it always grants admin-level access:

```bash
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/blueprints
curl -H "X-API-Token: $API_TOKEN" "http://localhost:8000/api/blueprints/entries?filter=severity%20%3D%20%22high%22"
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/runs/queue
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/settings
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────┐
│  Browser        │────▶│  nginx (port 3000)                       │
│  React + Vite   │     │  ├─ /        → React SPA                 │
│  + Tailwind     │     │  └─ /api/*   → FastAPI (port 8000)       │
└─────────────────┘     └─────────────────┬────────────────────────┘
                                           │
                        ┌──────────────────▼────────────────────────┐
                        │  FastAPI backend                           │
                        │  ├─ /api/auth        Login, logout, setup │
                        │  ├─ /api/users       User management      │
                        │  ├─ /api/blueprints  Blueprint + Entry CRUD│
                        │  ├─ /api/pybooks     PyBook CRUD / run    │
                        │  ├─ /api/runs        History, logs, WS    │
                        │  ├─ /api/secrets     Encrypted store      │
                        │  ├─ /api/workflows    Workflow + DAG runs  │
                        │  ├─ /api/settings    System config        │
                        │  ├─ /api/system      Self-update & info    │
                        │  └─ /api/webhooks    Inbound triggers     │
                        │                                            │
                        │  APScheduler — cron + blueprint fetches   │
                        │  asyncio queue — persistent run queue     │
                        │  SQLite + FTS5 — persistence + search     │
                        │  Alembic — schema migrations              │
                        └──────────────────┬────────────────────────┘
                                           │ Docker socket (DooD)
                        ┌──────────────────▼────────────────────────┐
                        │  Docker sibling containers                 │
                        │  python:3.12-slim per PyBook run          │
                        │  pylo_sdk.py + script mounted at runtime  │
                        └───────────────────────────────────────────┘
```

---

## Development

```bash
# Backend hot-reload
cd backend && uvicorn backend.main:app --reload

# Frontend dev server
cd frontend && npm run dev
```

### Database migrations

Alembic runs `alembic upgrade head` automatically on container startup.

```bash
# Inside the backend container or virtualenv:
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

---

## Roadmap

See [`docs/TODO.md`](docs/TODO.md) for the full backlog. Key upcoming items:

- **pylo_sdk standalone library** — pip-installable `PyloClient` for external script integration without manual SDK mounting
- **Paginated API fetching** — cursor, page-number, and offset pagination for multi-page sources
- **Scoped API Keys** — per-key permissions for SIEM/script integrations
- **Configuration backup & restore** — export/import to ZIP or Git repository
- **Re-parse entries on mapping change** — apply updated field mappings to historical raw data

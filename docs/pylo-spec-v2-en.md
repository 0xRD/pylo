# Pylo — Technical Specification v2

> Living document. Last updated: session 9 (trigger conditions, field query language, multi-select).
> See `docs/PROGRESS.md` for session-by-session history and `docs/TODO.md` for the backlog.

---

## 1. Purpose

Pylo is a Python automation orchestration platform targeting SOAR (Security Orchestration, Automation and Response) and general-purpose data pipeline use cases. Core value proposition:

- **Blueprints** ingest structured data from external REST APIs and deduplicate it as **Entries**.
- **PyBooks** are Python scripts that run in isolated Docker containers, triggered by schedules, webhooks, blueprint events, or manually.
- A persistent **execution queue** ensures no run is lost; live WebSocket streaming exposes logs to the browser.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLModel, SQLite, Alembic, APScheduler, httpx, asyncio |
| Frontend | React 18, Vite, Tailwind CSS v3, React Router v6, Monaco Editor |
| Runtime | Docker (sibling containers via DooD), Docker Compose |
| Crypto | Fernet (AES-128-CBC) via `cryptography` library |
| Full-text search | SQLite FTS5 |

---

## 3. Repository Layout

```
pylo/
├── backend/
│   ├── main.py                   # FastAPI app, lifespan (queue start/stop, scheduler)
│   ├── config.py                 # Pydantic settings (reads .env)
│   ├── database.py               # SQLModel engine, get_session dependency
│   ├── api/
│   │   ├── blueprints.py         # Blueprint + Entry CRUD, fetch, preview, manual entry
│   │   ├── pybooks.py            # PyBook CRUD, run, build, webhook
│   │   ├── runs.py               # Run list, get, queue stats, WebSocket log stream
│   │   ├── secrets.py            # Secret CRUD (encrypted values never returned)
│   │   ├── settings.py           # GET/PUT /api/settings (max_concurrent_runs)
│   │   └── webhooks.py           # POST /api/webhooks/:pybook_id
│   ├── core/
│   │   ├── auth.py               # Bearer token verification (X-API-Token header)
│   │   ├── crypto.py             # Fernet encrypt/decrypt
│   │   ├── image_builder.py      # Docker image build for PyBooks
│   │   ├── queue_manager.py      # asyncio Queue + Semaphore, orphan recovery
│   │   ├── runner.py             # Docker container run, log capture
│   │   ├── scheduler.py          # APScheduler: blueprint cron + PyBook cron
│   │   └── settings_model.py     # SystemSetting SQLModel table
│   ├── objects/
│   │   ├── models.py             # Blueprint, Entry SQLModel tables
│   │   ├── filter.py             # Field query language + trigger condition engine
│   │   ├── indexer.py            # FTS5 index helpers (index_entry, search_fts)
│   │   └── parser.py             # JSONPath field mapping, text extraction
│   ├── pybooks/
│   │   ├── models.py             # PyBook, PyBookRun SQLModel tables
│   │   └── store.py              # Script file read/write on disk
│   └── secrets/
│       └── models.py             # Secret SQLModel table (encrypted_value stored)
├── frontend/src/
│   ├── App.jsx                   # React Router routes
│   ├── api/
│   │   ├── blueprints.js         # API client for /api/blueprints/*
│   │   ├── pybooks.js            # API client for /api/pybooks/* and /api/runs/*
│   │   └── secrets.js            # API client for /api/secrets/*
│   ├── components/
│   │   ├── BlueprintForm.jsx     # Full blueprint create/edit form (reused in modal + settings tab)
│   │   ├── CodeEditor.jsx        # Monaco editor wrapper
│   │   ├── EntryCard.jsx         # Entry card with checkbox for multi-select
│   │   ├── HelpTip.jsx           # Inline (?) tooltip component
│   │   ├── Layout.jsx            # App shell (sidebar + main)
│   │   ├── RunStatusBadge.jsx    # Colored pill: queued/running/success/error/timeout
│   │   ├── ScheduleBuilder.jsx   # Human-friendly cron builder (interval + scheduled modes)
│   │   └── Sidebar.jsx           # Navigation sidebar with links + active state
│   └── pages/
│       ├── BlueprintDetail.jsx   # Tabbed: Entries (filter, multi-select) + Settings
│       ├── Blueprints.jsx        # Blueprint card grid + new blueprint modal
│       ├── Entries.jsx           # Global entries: blueprint chips, FTS, field filter, bulk delete
│       ├── EntryDetail.jsx       # Raw + parsed fields, breadcrumb, back navigation
│       ├── PyBooks.jsx           # PyBook list + Monaco editor + tag management
│       ├── Runs.jsx              # Run history + live queue/concurrency bar
│       ├── Secrets.jsx           # Secret management
│       └── Settings.jsx          # max_concurrent_runs slider
├── migrations/versions/          # Alembic migration files (applied on container start)
│   ├── fc661ed4275a_initial.py
│   ├── 1fd00603a2fc_add_object_fetch_cron.py
│   ├── a3f2b1c4d5e6_rename_objects_to_blueprints.py
│   ├── b5c3d2e1f0a9_add_trigger_event.py
│   ├── c6d4e3f2a1b0_add_pybook_tags.py
│   ├── d7e5f4a3b2c1_add_system_setting.py
│   └── e8f6a5b4c3d2_add_trigger_conditions.py
├── pylo_sdk.py                   # SDK mounted into every PyBook container at runtime
├── docker-compose.yml
├── .env.example
├── README.md
└── docs/
    ├── pylo-spec-v2-en.md        # This file
    ├── PROGRESS.md               # Session-by-session development log
    └── TODO.md                   # Prioritised feature backlog
```

---

## 4. Data Models

All tables live in `objects_storage/pylo.db` (SQLite). IDs are `uuid4` strings.

### 4.1 Blueprint

```
blueprint
├── id              TEXT PK
├── name            TEXT NOT NULL
├── description     TEXT
├── source_url      TEXT                -- REST endpoint to fetch from
├── source_method   TEXT DEFAULT 'GET'
├── source_headers  TEXT DEFAULT '{}'   -- JSON object (may contain {{secret:name}} templates)
├── source_body     TEXT DEFAULT '{}'   -- JSON body for POST requests
├── field_mappings  TEXT DEFAULT '[]'   -- JSON array of mapping objects (see §6.1)
├── trigger_pybook_id TEXT              -- FK → pybook.id (NULL = no trigger)
├── trigger_event   TEXT DEFAULT 'on_create'  -- 'on_create' | 'on_create_or_update'
├── trigger_conditions TEXT DEFAULT '[]'      -- JSON array of condition dicts (see §6.2)
├── polling_interval_seconds INT        -- legacy, prefer fetch_cron
├── fetch_cron      TEXT                -- cron expression (NULL = no schedule)
├── fetch_is_active BOOL DEFAULT FALSE
├── is_manual       BOOL DEFAULT FALSE  -- TRUE = no fetch; entries created via UI/API
└── created_at      DATETIME
```

**field_mappings** schema (each element):
```json
{
  "source_path": "$.commands[0].category",
  "field_name": "category",
  "field_type": "string",
  "is_key": false
}
```
`is_key: true` on exactly one mapping designates the deduplication field.

### 4.2 Entry

```
entry
├── id              TEXT PK
├── blueprint_id    TEXT (indexed)
├── external_id     TEXT               -- value of the is_key field (used for dedup)
├── data            TEXT DEFAULT '{}'  -- JSON: parsed fields after field_mappings applied
├── raw_data        TEXT DEFAULT '{}'  -- JSON: original API response item
├── created_at      DATETIME
└── updated_at      DATETIME
```

FTS5 virtual table `fts_entries (entry_id, blueprint_id, content)` mirrors searchable text.

### 4.3 PyBook

```
pybook
├── id              TEXT PK
├── name            TEXT NOT NULL
├── description     TEXT
├── script          TEXT DEFAULT ''    -- Python source (also mirrored on disk)
├── is_sub_pybook   BOOL DEFAULT FALSE -- callable via call_sub_pybook()
├── dependencies    TEXT DEFAULT '[]'  -- JSON list of pip packages
├── trigger_type    TEXT DEFAULT 'manual'  -- 'manual'|'cron'|'webhook'|'object_event'
├── trigger_config  TEXT DEFAULT '{}'  -- e.g. {"cron": "0 * * * *"}
├── is_active       BOOL DEFAULT TRUE
├── docker_image_tag TEXT              -- custom built image tag (optional)
├── required_secrets TEXT DEFAULT '[]' -- JSON list of secret names injected as env vars
├── tags            TEXT DEFAULT '[]'  -- JSON list of tag strings
├── created_at      DATETIME
└── updated_at      DATETIME
```

### 4.4 PyBookRun

```
pybook_run
├── id              TEXT PK
├── pybook_id       TEXT (indexed)
├── status          TEXT               -- 'queued'|'running'|'success'|'error'|'timeout'
├── trigger_source  TEXT               -- 'manual'|'cron'|'webhook'|'blueprint'|'sub_pybook'
├── trigger_payload TEXT DEFAULT '{}'  -- JSON; for blueprint triggers includes entry_id + entry_data
├── stdout          TEXT DEFAULT ''
├── stderr          TEXT DEFAULT ''
├── exit_code       INT
├── started_at      DATETIME
├── ended_at        DATETIME
└── duration_ms     INT
```

### 4.5 Secret

```
secret
├── id              TEXT PK
├── name            TEXT UNIQUE NOT NULL
├── description     TEXT
├── encrypted_value TEXT NOT NULL  -- Fernet-encrypted; never returned via API
├── created_at      DATETIME
└── updated_at      DATETIME
```

Referenced in Blueprint headers as `{{secret:name}}`. Injected into PyBooks as `SECRET_<name>` env vars.

### 4.6 SystemSetting

```
system_setting
├── key   TEXT PK   -- e.g. 'max_concurrent_runs'
└── value TEXT      -- string representation
```

---

## 5. API Endpoints

All endpoints require `X-API-Token: <API_TOKEN>` header.

### 5.1 Blueprints — `/api/blueprints`

| Method | Path | Description |
|---|---|---|
| GET | `/api/blueprints` | List all blueprints |
| POST | `/api/blueprints` | Create blueprint |
| GET | `/api/blueprints/{id}` | Get blueprint |
| PUT | `/api/blueprints/{id}` | Update blueprint |
| DELETE | `/api/blueprints/{id}` | Delete blueprint + all its entries |
| POST | `/api/blueprints/{id}/fetch` | Trigger immediate fetch from source URL |
| POST | `/api/blueprints/preview` | Test source URL and return raw response |
| GET | `/api/blueprints/entries` | List entries (params: blueprint_id, q, filter, limit, offset) |
| GET | `/api/blueprints/entries/{id}` | Get entry |
| DELETE | `/api/blueprints/entries/{id}` | Delete entry |
| POST | `/api/blueprints/{id}/entries` | Create manual entry (201; fires trigger via BackgroundTasks) |

**`filter` query param syntax** (`GET /entries`):
```
field_name OPERATOR "value" [AND field_name OPERATOR "value" ...]
```
Operators: `=` `!=` `contains` `starts_with` `>` `>=` `<` `<=`
Applied server-side via SQLite `json_extract(data, '$.field_name')`.

### 5.2 PyBooks — `/api/pybooks`

| Method | Path | Description |
|---|---|---|
| GET | `/api/pybooks` | List all PyBooks |
| POST | `/api/pybooks` | Create PyBook |
| GET | `/api/pybooks/{id}` | Get PyBook |
| PUT | `/api/pybooks/{id}` | Update PyBook |
| DELETE | `/api/pybooks/{id}` | Delete PyBook |
| POST | `/api/pybooks/{id}/run` | Trigger run (body: trigger_source, trigger_payload) |
| POST | `/api/pybooks/{id}/build` | Build custom Docker image |
| GET | `/api/pybooks/{id}/runs` | List runs for a PyBook |

### 5.3 Runs — `/api/runs`

| Method | Path | Description |
|---|---|---|
| GET | `/api/runs` | List all runs (params: pybook_id, status, limit, offset) |
| GET | `/api/runs/queue` | Live queue stats: {queued, running, max_concurrent} |
| GET | `/api/runs/{id}` | Get run (includes stdout/stderr) |
| WS | `/api/runs/{id}/ws` | WebSocket live log stream |

**Critical route ordering**: `/api/runs/queue` MUST be registered before `/{run_id}` in `runs.py` to prevent FastAPI matching "queue" as a run ID.

### 5.4 Secrets — `/api/secrets`

| Method | Path | Description |
|---|---|---|
| GET | `/api/secrets` | List secrets (no encrypted_value in response) |
| POST | `/api/secrets` | Create secret |
| PUT | `/api/secrets/{id}` | Update secret |
| DELETE | `/api/secrets/{id}` | Delete secret |

### 5.5 Settings — `/api/settings`

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | Get settings + queue stats |
| PUT | `/api/settings` | Update settings (body: {max_concurrent_runs: int}) |

### 5.6 Webhooks — `/api/webhooks`

| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/{pybook_id}` | Receive webhook, create queued run |

---

## 6. Key Subsystems

### 6.1 Fetch Pipeline (`backend/api/blueprints.py`)

```
_do_fetch(blueprint_id)
  ├── _load_secrets_map(session) → {name: decrypted_value}
  ├── _resolve_request_params(bp, secrets_map) → (headers, body)
  │     resolves {{secret:name}} templates in headers
  ├── _fetch_raw_items(bp, headers, body) → list[dict]
  │     async httpx GET/POST; raises RuntimeError on HTTP error
  ├── _upsert_entries(bp, items, field_mappings, session)
  │     → (created_entries: list[{entry_id, parsed}], skipped_count)
  │     parse_instance() applies JSONPath mappings
  │     deduplicates by external_id (the is_key field)
  │     FTS-indexes each new entry
  └── _fire_pybook_trigger(bp, created_entries)   ← if trigger_pybook_id set
        checks trigger_event (on_create / on_create_or_update)
        applies trigger_conditions (see §6.2)
        caps at _MAX_TRIGGERS_PER_FETCH = 50
        creates one PyBookRun per matching entry (single DB commit)
        enqueues all runs via queue_manager.enqueue()
```

### 6.2 Trigger Conditions (`backend/objects/filter.py`)

Stored on Blueprint as `trigger_conditions` JSON:
```json
[
  {"field": "severity", "operator": "eq",       "value": "critical"},
  {"field": "status",   "operator": "ne",       "value": "closed"},
  {"field": "score",    "operator": "gt",       "value": "7.5"},
  {"field": "name",     "operator": "regex",    "value": "mimikatz|cobalt"}
]
```

All conditions ANDed. Empty array = always trigger. `check_trigger_conditions(parsed_dict, conditions_list)` returns bool. Unknown operator returns `False` (safe default).

Operators: `eq` `ne` `contains` `starts_with` `regex` (Python `re.search`, case-insensitive) `gt` `lt`

The same file also exports `apply_field_filter` (SQL json_extract) and `python_field_filter` for the UI query language (`=` `!=` `contains` `starts_with` `>` `>=` `<` `<=`).

### 6.3 Execution Queue (`backend/core/queue_manager.py`)

- Module-level: `_queue: asyncio.Queue`, `_semaphore: asyncio.Semaphore`, `_current_limit: int`
- `start()`: loads `max_concurrent_runs` from DB (fallback to env), recovers orphaned `queued`/`pending` runs
- `enqueue(pybook_id, run_id)`: adds to queue (all trigger paths use this)
- `update_limit(n)`: resizes semaphore live; increases release extra permits immediately; decreases are passive
- `get_stats()`: uses `_current_limit` (not env var) for accurate post-update display
- Single asyncio worker coroutine drains the queue gated by the semaphore

All trigger paths (manual, cron, webhook, blueprint) write `status="queued"` to DB **before** calling `enqueue()`, so runs survive restarts.

### 6.4 Blueprint → PyBook Trigger Payload

When a PyBook is triggered by a blueprint fetch, `trigger_payload` contains:
```json
{
  "blueprint_id": "...",
  "entry_id": "...",
  "entry_data": {"field1": "value1", "field2": "value2", ...}
}
```
The PyBook receives `TRIGGER_PAYLOAD` env var as a JSON string. Access via:
```python
import json, os
payload = json.loads(os.environ.get("TRIGGER_PAYLOAD", "{}"))
entry = payload.get("entry_data", {})
```

### 6.5 Secret Resolution

Blueprint source headers support `{{secret:name}}` templates:
```json
{"Authorization": "Bearer {{secret:virustotal_key}}", "X-Tenant": "acme"}
```
`_resolve_request_params()` calls `resolve_secret_templates()` which decrypts and substitutes at fetch time.

The Authentication section in BlueprintForm generates these templates transparently from a visual picker (Bearer / API Key / Basic Auth modes).

---

## 7. Frontend Routes

```
/                       → redirect to /blueprints
/blueprints             → Blueprints.jsx  (card grid + new blueprint modal)
/blueprints/:id         → BlueprintDetail.jsx  (Entries tab + Settings tab)
/blueprints/entries/:id → EntryDetail.jsx  (raw + parsed fields, breadcrumb)
/entries                → Entries.jsx  (global: FTS + field filter + blueprint chips + bulk delete)
/pybooks                → PyBooks.jsx  (sidebar list + Monaco editor)
/runs                   → Runs.jsx  (history + queue concurrency bar)
/secrets                → Secrets.jsx
/settings               → Settings.jsx
```

**Critical route ordering in App.jsx**: `/blueprints/entries/:id` MUST come before `/blueprints/:id` to prevent "entries" being matched as a blueprint ID.

---

## 8. Frontend Key Components

| Component | Purpose |
|---|---|
| `BlueprintForm` | Full blueprint create/edit; reused in Blueprints modal and BlueprintDetail Settings tab. Contains `TriggerConditionBuilder` sub-component. |
| `TriggerConditionBuilder` | Row-per-condition UI for trigger conditions (field/operator/value). Serialises to `trigger_conditions` JSON. |
| `EntryCard` | Entry summary card with optional checkbox for multi-select (passes `onSelect` prop to enable). |
| `ScheduleBuilder` | Interval mode (every N min/h/d) or scheduled mode (HH:MM + weekday chips). Emits cron string. |
| `HelpTip` | Inline `(?)` with hover tooltip. Props: `text`. |
| `RunStatusBadge` | Coloured pill for run status. States: `queued` (gray) `running` (blue) `success` (green) `error` (red) `timeout` (orange). |
| `CodeEditor` | Monaco editor wrapper (Python syntax). |
| `Sidebar` | Navigation; Pylo logo = home link. Routes: Blueprints, Entries, PyBooks, Runs, Secrets, Settings. |

---

## 9. PyBook SDK (`pylo_sdk.py`)

Mounted read-only into every container as `/app/pylo_sdk.py`. Injected env vars: `PYLO_API_URL`, `PYLO_API_TOKEN`, `SECRET_<name>` for each required secret, `TRIGGER_PAYLOAD`.

```python
from pylo_sdk import call_sub_pybook, search_entries, get_entry

# Trigger a sub-PyBook synchronously, get its stdout/result
result = call_sub_pybook("<sub_pybook_id>", payload={"alert_id": "42"})

# Full-text search entries (optional: scope to blueprint)
entries = search_entries("mimikatz", type_id="<blueprint_id>")

# Fetch a single entry by ID
entry = get_entry("<entry_id>")
# entry["data"] = parsed field dict
# entry["raw_data"] = original API response
```

---

## 10. Configuration (`.env`)

```env
API_TOKEN=<required — all API requests need X-API-Token: this value>
SECRET_KEY=<required — 32+ chars — Fernet key for secret encryption>

# Optional overrides
DATABASE_URL=sqlite:///./objects_storage/pylo.db
DOCKER_NETWORK=pylo_pylo_default
PYLO_BASE_IMAGE=pylo-runner-base:latest
PYLO_TIMEOUT_SECONDS=300
PYLO_MAX_CONCURRENT_RUNS=5   # overridden at runtime by SystemSetting DB value
PYLO_MEM_LIMIT=256m
PYLO_CPU_QUOTA=50000
```

---

## 11. Development & Deployment

```bash
# Full stack (production-like)
docker compose up -d
# Frontend: http://localhost:3000   Backend: http://localhost:8000

# Rebuild after backend code changes (source not volume-mounted)
docker compose build backend --no-cache && docker compose up -d backend

# Rebuild after frontend changes
docker compose build frontend --no-cache && docker compose up -d frontend

# Backend hot-reload (local dev, no Docker)
cd backend && uvicorn backend.main:app --reload

# Frontend dev server (local dev)
cd frontend && npm run dev    # http://localhost:5173

# Alembic migrations (run automatically on container start via entrypoint.sh)
cd /app && alembic upgrade head

# Add a new migration
alembic revision --autogenerate -m "describe change"
```

**Migration head**: `e8f6a5b4c3d2` (trigger_conditions)

---

## 12. Coding Conventions

- **Backend**: all new DB fields need both a model change (`models.py`) and an Alembic migration. Use `Field(default=...)` for non-nullable columns to keep existing rows valid.
- **Backend**: private helpers in `blueprints.py` are prefixed with `_` and are synchronous unless they do async I/O. `_fire_pybook_trigger` is always called via `BackgroundTasks` from manual entry creation, and synchronously from `_do_fetch` (which is already async).
- **Frontend**: API calls live in `src/api/`. Pages fetch data directly; no global state store. URL search params sync for filterable list pages.
- **Frontend**: `BlueprintForm` is the single source of truth for blueprint editing — do not duplicate form logic in `Blueprints.jsx` (new modal) or `BlueprintDetail.jsx` (settings tab).
- **Migrations**: always add `server_default` for `NOT NULL` columns added to existing tables.
- **IDs**: all IDs are `str(uuid.uuid4())` — never integers.

---

## 13. Feature Status

### Implemented ✅
1. Blueprint CRUD, field mappings, JSONPath picker, endpoint preview
2. Cron auto-fetch with APScheduler
3. Unique key field deduplication (★ selector)
4. Manual blueprints (is_manual flag)
5. Blueprint authentication builder (Bearer / API Key / Basic)
6. Schedule builder (human-friendly cron, used in blueprints + PyBook cron)
7. ScheduleBuilder + HelpTip components
8. Entry FTS5 full-text search
9. **Field query language** — `field = "value" AND field contains "text"` via `json_extract`
10. Blueprint/Entry two-route tabbed UI
11. Global Entries page with blueprint filter chips + bulk delete
12. PyBook tags, filtering, tag-based sidebar search
13. Persistent execution queue (`queue_manager.py`) + orphan recovery
14. Settings page (live `max_concurrent_runs` resize)
15. Runs page: live queue depth + concurrency bar
16. PyBook trigger event type (`on_create` / `on_create_or_update`)
17. **Trigger conditions** — conditional PyBook trigger per entry (`eq` `ne` `contains` `starts_with` `regex` `gt` `lt`)
18. Manual entry creation UI + trigger integration
19. Multi-select entry bulk delete
20. Console navigation (breadcrumbs, smart back, home link)
21. WebSocket live log streaming
22. Webhook triggers

### Pending (see `docs/TODO.md`)
- **#1** Entry deduplication + mutable fields + history/audit trail
- **#4** User authentication + roles (login page, JWT, admin/viewer)
- **#5** Scoped API keys
- **#6** Re-parse existing entries when field mappings change
- **#9** Paginated API source fetching (cursor / page-number / offset)
- **#15** Multi-PyBook blueprint triggers (subscribe from PyBook editor)
- **#16** Run variable inspector (post-run variable snapshot)
- **#17** Visual workflow builder (React Flow DAG)
- **#19** Always-on sub-PyBooks (warm Docker containers)

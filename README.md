# Pylo

**Python automation orchestration platform.** Write Python scripts (PyBooks) that run in isolated Docker containers, fetch structured data from external APIs (Objects), manage secrets, and trigger automations on schedules or webhooks.

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

Edit `.env` with your values:

```dotenv
SECRET_KEY=your-random-secret-key
API_TOKEN=your-api-token          # used by frontend + API clients

PYBOOKS_HOST_PATH=/absolute/path/to/pylo/pybooks_storage
PYLO_SDK_HOST_PATH=/absolute/path/to/pylo/pylo_sdk.py
DOCKER_NETWORK=pylo_pylo_default  # Compose project prefix + network name
```

> **Important (Docker-out-of-Docker):** `PYBOOKS_HOST_PATH` and `PYLO_SDK_HOST_PATH` must be **host-machine absolute paths** — not container paths. The backend auto-detects these at startup by inspecting its own bind mounts; explicit values are only needed as fallback.

### 2. Build the runner base image

PyBook containers need a base image with pre-installed packages:

```bash
docker build -t pylo-runner-base:latest -f docker/pybook-runner/Dockerfile.base .
```

### 3. Start

```bash
docker compose up -d --build
```

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **API docs:** http://localhost:8000/docs

---

## Concepts

### PyBooks

A PyBook is a Python script that runs inside an ephemeral Docker container. Each run is isolated, has a timeout, and its stdout/stderr is captured and stored.

**Creating a PyBook:**
1. Go to **PyBooks** in the sidebar
2. Click **+ New**
3. Write your script in the Monaco editor
4. Set trigger type (manual, cron, webhook)
5. Click **Save**, then **Run** to execute

**Triggers:**
| Type | Description |
|------|-------------|
| `manual` | Run on demand from the UI or API |
| `cron` | Scheduled via cron expression in `trigger_config`: `{"cron": "0 * * * *"}` |
| `webhook` | HTTP POST to `/api/webhooks/{webhook_id}` |

**Dependencies:**

Add pip packages in the **Dependencies** field as a JSON array:
```json
["pandas", "boto3", "pillow"]
```

The first run builds a Docker image with these packages installed. Subsequent runs reuse the cached image (keyed on the dependency hash).

**pylo_sdk:**

The `pylo_sdk` module is automatically mounted in every container at `/pybook/pylo_sdk.py`. Import it to interact with Pylo from within your script:

```python
from pylo_sdk import search_objects, get_object, call_sub_pybook

# Search objects
results = search_objects(q="malware", type_id="optional-type-id", limit=10)

# Get a single object instance
obj = get_object("instance-id")

# Call another PyBook and wait for its result
result = call_sub_pybook("pybook-id", payload={"key": "value"})
```

### Objects

Objects model structured data fetched from external HTTP APIs. Each **Object Type** defines:
- An HTTP endpoint to fetch from
- JSONPath mappings to extract fields
- Optional HTTP headers (supports `{{secret:name}}` template substitution)

**Creating an Object Type:**
1. Go to **Objects** in the sidebar
2. Click **+ New Type**
3. Configure the fetch URL, method, and response path (JSONPath to the list)
4. Add field mappings (name → JSONPath expression)
5. One field must be `external_id` — used for deduplication

**Fetching data:**

Click **Fetch now** to pull data immediately. The system deduplicates by `external_id`, so re-fetching only creates new instances.

**Searching:**

Use the search bar on the Objects page — backed by SQLite FTS5 with BM25 ranking and Porter stemming.

### Secrets

Secrets are encrypted at rest (Fernet/AES-128) and never returned by the API. They can be used in two ways:

1. **In Object headers:** `{{secret:my_api_key}}`
2. **In PyBooks:** available as env vars `SECRET_<name>` — list them in **Required secrets**: `["my_api_key"]`

```python
import os
api_key = os.environ["SECRET_my_api_key"]
```

---

## API Reference

All endpoints require `X-API-Token: <your-token>` header (except `/health` and WebSocket endpoints).

### PyBooks
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pybooks` | List all PyBooks |
| `POST` | `/api/pybooks` | Create a PyBook |
| `GET` | `/api/pybooks/{id}` | Get a PyBook |
| `PUT` | `/api/pybooks/{id}` | Update a PyBook |
| `DELETE` | `/api/pybooks/{id}` | Delete a PyBook |
| `POST` | `/api/pybooks/{id}/run` | Trigger a run |
| `POST` | `/api/pybooks/{id}/build` | Pre-build Docker image |
| `GET` | `/api/pybooks/{id}/runs` | List runs for a PyBook |

### Runs
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/runs` | List all runs (filter by `pybook_id`, `status`) |
| `GET` | `/api/runs/{id}` | Get a run |
| `WS` | `/api/runs/{id}/ws` | WebSocket — live status updates until terminal state |

### Objects
| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/objects/types` | List / create object types |
| `GET/PUT/DELETE` | `/api/objects/types/{id}` | Read / update / delete |
| `POST` | `/api/objects/types/{id}/fetch` | Fetch data from configured URL |
| `GET` | `/api/objects/instances` | List instances (`type_id`, `q`, `limit`, `offset`) |
| `GET/DELETE` | `/api/objects/instances/{id}` | Get / delete instance |

### Secrets
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/secrets` | List secret names (values never returned) |
| `POST` | `/api/secrets` | Create a secret |
| `PUT` | `/api/secrets/{id}` | Update value |
| `DELETE` | `/api/secrets/{id}` | Delete |

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhooks/{webhook_id}` | Trigger PyBook run via webhook |

---

## Schema migrations

Pylo uses [Alembic](https://alembic.sqlalchemy.org/) for schema migrations.

```bash
# Generate a migration after model changes
docker compose exec backend python -m alembic revision --autogenerate -m "describe change"

# Apply pending migrations
docker compose exec backend python -m alembic upgrade head

# Check current revision
docker compose exec backend python -m alembic current
```

---

## Running tests

```bash
docker compose exec backend python -m pytest /app/tests/ -v
```

---

## Architecture

```
pylo/
├── backend/              # FastAPI application
│   ├── api/              # Route handlers (objects, pybooks, runs, secrets, webhooks)
│   ├── core/             # Runner, scheduler, image builder, auth, crypto
│   ├── objects/          # Object type models, JSONPath parser, FTS5 indexer
│   ├── pybooks/          # PyBook models, script storage
│   └── secrets/          # Secret model + Fernet encryption
├── frontend/             # React 18 + Vite 6 + Tailwind CSS v3
│   └── src/
│       ├── api/          # Typed API clients (with X-API-Token auth)
│       ├── components/   # CodeEditor (Monaco), RunStatusBadge, Layout, Sidebar
│       └── pages/        # Objects, PyBooks, Runs, Secrets, Dashboards
├── docker/
│   └── pybook-runner/    # Base Dockerfile for PyBook execution containers
├── pylo_sdk.py           # Mounted read-only in every run container
├── migrations/           # Alembic migrations
└── tests/                # pytest suite (28 tests)
```

**Key design decisions:**
- **Docker-out-of-Docker:** The backend container spawns sibling containers via the Docker socket. Volume mounts use host-side paths (auto-detected at startup via self-inspection).
- **Encryption at rest:** Secrets use Fernet (AES-128-CBC + HMAC) with a key derived from `SECRET_KEY` via SHA-256.
- **FTS5 search:** SQLite FTS5 virtual table with Porter stemmer for full-text search over object instances.
- **Deduplication:** Objects are deduplicated by `external_id` on each fetch.

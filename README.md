# Pylo

Pylo is a Python automation orchestration platform for SOAR and general-purpose data pipelines. It combines API ingestion, normalized Entries, isolated Python execution, visual Workflows, scoped API keys, encrypted secrets, and an operator-friendly web UI.

Pylo is built for security analysts, DevOps engineers, and code-first automation users who want automation that stays inspectable and scriptable.

## V1 Scope

Pylo V1 focuses on a stable automation core:

- **Blueprints** fetch structured data from external REST APIs with authentication, pagination, retries, fetch limits, and on-fail behavior.
- **Entries** store normalized records from Blueprints, support deduplication, mutable fields, history, search, filtering, and bulk actions.
- **PyBooks** run Python scripts in isolated ephemeral Docker containers with payloads, scoped API access, network controls, and selected secrets injected as environment variables.
- **Workflows** orchestrate PyBooks with branching, loops, multiple outgoing connections, payload mappings, and per-node run history.
- **Runs** provide a persistent async execution queue with live logs, status history, concurrency limits, and orphan recovery after restarts.
- **Secrets and API keys** are designed for least privilege: secrets are encrypted, decrypted values are never returned, and integration API keys can be scoped.
- **Operations** include backup/export, restore/import, system settings, user management, audit activity, and a GitOps-style dev-to-prod promotion flow.

## Quick Start

### Requirements

- Docker with the Compose plugin
- Git

### Install

```bash
git clone https://github.com/<your-org>/pylo
cd pylo
bash setup.sh
```

`setup.sh` prepares a fresh machine by generating `.env`, creating strong runtime secrets, building the PyBook runner base image, starting the Docker Compose stack, and waiting for the backend health check.

Open the app at `http://localhost:3000`, then create the first admin account in the setup wizard.

### Manual Setup

```bash
cp .env.example .env
# Edit .env and set SECRET_KEY, API_TOKEN, POSTGRES_PASSWORD, and other deployment values.
docker build -t pylo-runner-base:latest -f docker/pybook-runner/Dockerfile.base docker/pybook-runner/
docker compose up -d --build
```

Keep `.env` private. It contains deployment secrets and must not be committed.

## Runtime Services

| Service | Default URL | Purpose |
|---|---|---|
| Frontend | `http://localhost:3000` | React UI served by nginx |
| Backend | `http://localhost:8000` | FastAPI API and queue manager |
| API docs | `http://localhost:8000/docs` | Interactive OpenAPI docs |
| Postgres | Compose network only | Runtime database |

Postgres is the supported runtime database. SQLite is deprecated for runtime use and kept only as a temporary recovery path when explicitly enabled.

The backend applies Alembic migrations on startup. Postgres is not published to the host by default; protect shell access and Docker access as privileged infrastructure.

## Core Concepts

### Blueprints

Blueprints describe how to fetch and parse structured data from external APIs. A Blueprint can define request method, headers, body, authentication, pagination, item extraction path, field mappings, deduplication key, fetch limits, retry policy, retention, and auto-fetch schedule.

Secrets can be referenced in Blueprint headers as `{{secret:name}}`; values are resolved only at fetch time and are never logged or returned by the API.

### Entries

Entries are instances produced by Blueprints or created manually. They keep raw source data, parsed fields, history, mutable values, and full-text search metadata. Field filters are evaluated server-side so pagination remains correct.

Example field filters:

```text
severity = "high"
category contains "malware"
score >= 80
status != "closed" AND owner starts_with "secops"
```

### PyBooks

PyBooks are Python scripts executed in short-lived Docker containers. They can be triggered manually, by cron, by webhook, by Blueprint Entry events, or from Workflows.

Each PyBook can receive a JSON payload, use the mounted SDK, export output variables, and access only the selected secrets/API credentials explicitly configured in the UI.

```python
import os
import pylo_sdk as pylo

payload = pylo.get_payload()
api_key = os.environ["SECRET_virustotal_key"]

matches = pylo.search_entries(payload.get("query", ""))
pylo.set_output("match_count", len(matches))
```

PyBook containers are network-restricted by default. When network access is enabled, allowed hosts are configured as a JSON list of hostnames or domains, for example:

```json
["api.abuseipdb.com", "api.github.com"]
```

Use hostnames only, not full URLs. Pylo validates outbound access against this allowlist before the PyBook can reach external services.

### Workflows

Workflows chain PyBooks into automation graphs. Nodes can branch on success or failure, use conditional expressions, loop over data, fan out through multiple connections, and map variables from upstream node outputs into downstream payloads.

Workflow runs are tracked separately from PyBook runs and are also visible in the unified Runs page.

### Runs and Queue

Every PyBook execution is written to the database as `queued` before it is enqueued. The run lifecycle is:

```text
queued -> pending -> running -> success | error | timeout
```

The queue is persistent and recovers orphaned runs after backend restarts. The default concurrency is 20 simultaneous runs and can be adjusted live from Settings without restarting the backend.

## Authentication and Security

Browser sessions use httpOnly JWT cookies. API clients should use scoped API keys created from Settings whenever possible. The bootstrap `API_TOKEN` in `.env` remains available for administrative automation.

```bash
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/blueprints
curl -H "X-API-Token: $API_TOKEN" http://localhost:8000/api/runs/queue
```

Security posture:

- Secrets are encrypted with Fernet and decrypted only at use time.
- Secret values are never returned by the API after creation.
- Secret values must not be logged by Pylo internals.
- API keys are stored hashed and the raw token is shown only once.
- Blueprint fetches block private, loopback, link-local, reserved, multicast, and metadata-style targets by default.
- PyBook network access can be restricted by allowed hosts.
- Docker access should be treated as privileged infrastructure.

## Main Routes

| Route | Description |
|---|---|
| `/dashboard` | Operational overview |
| `/blueprints` | Blueprint list and API ingestion setup |
| `/blueprints/:id` | Blueprint Entries and Settings tabs |
| `/entries` | Global searchable Entry view |
| `/entries/:id` | Single Entry detail and history |
| `/pybooks` | PyBook editor, trigger setup, SDK reference, and run console |
| `/workflows` | Visual Workflow editor |
| `/runs` | Unified run history and queue visibility |
| `/secrets` | Encrypted secret management |
| `/settings` | API keys, backups, concurrency, sessions, and system settings |
| `/users` | User management |

## Development

Use Docker for backend tests because the container has the runtime dependencies and database wiring used by the app.

```bash
docker compose exec -T backend python -m pytest tests/ -v
docker compose exec -T backend alembic upgrade head
cd frontend && npm run build
```

Backend code changes should be followed by:

```bash
docker compose build backend
docker compose up -d backend
```

Frontend code changes should be followed by:

```bash
docker compose build frontend
docker compose up -d frontend
```

## Project Hygiene

Do not commit deployment state or runtime secrets:

- `.env`
- `objects_storage/`
- `pybooks_storage/`
- database files
- build artifacts such as `frontend/dist/`
- local agent or editor context files

Before a release, run the tests, migrations, frontend build, stack health check, and a tracked-file scan for secrets or personal paths.

## Documentation

- `docs/pylo-spec-v2-en.md` - technical specification
- `docs/TODO.md` - backlog and future work
- `docs/PROGRESS.md` - implementation history
- `docs/CODE_AUDIT.md` - audit notes when present

## License

Pylo is licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).

Apache-2.0 is permissive and business-friendly: it allows use, modification, distribution, private use, and commercial use, while also including an explicit patent grant and preserving notice requirements.

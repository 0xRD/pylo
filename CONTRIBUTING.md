# Contributing to Pylo

Thanks for your interest in improving Pylo! Bug reports, documentation fixes, and pull requests are all welcome.

## Ground rules

- Open an issue before starting a large change (new feature, schema change, or new dependency) so the design can be discussed first.
- Report security issues privately. See [`SECURITY.md`](SECURITY.md). Do not open a public issue for them.
- Never commit `.env`, secrets, runtime storage (`pybooks_storage/`, `objects_storage/`), or database files.
- By contributing, you agree your contributions are licensed under the [Apache License 2.0](LICENSE).

## Development setup

### Full stack (Docker)

```bash
bash setup.sh            # generates .env, builds the runner image, starts the stack
```

The UI is at http://localhost:3000 and the API at http://localhost:8000.

### Backend tests without Docker

The test suite needs Python 3.11+ and a PostgreSQL database. Tests that need a Docker daemon are skipped automatically when it is unavailable.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

export DATABASE_URL=postgresql+psycopg://pylo:pylo@localhost:5432/pylo
export SECRET_KEY=dev_secret_key_at_least_32_characters__
export API_TOKEN=dev_api_token_at_least_32_characters___
export PYLO_ENV=test PYLO_ALLOW_INSECURE_DEFAULTS=true

.venv/bin/alembic upgrade head
.venv/bin/python -m pytest
```

### Frontend

```bash
cd frontend
npm ci
PYLO_BACKEND_URL=http://localhost:8000 npm run dev   # Vite on :3000, proxies /api to the backend
npm run build    # production build; CI runs this on every pull request
```

## Making changes

- **Database changes** need an Alembic migration in `migrations/versions/`. Give new non-nullable columns a `server_default` so upgrades work on populated databases. CI runs `alembic upgrade head` against a fresh Postgres.
- **Every run trigger path** must persist the run with `status="queued"` before calling the queue manager. Never execute PyBooks directly from a request handler.
- **Secrets** must never be logged, returned by the API, or written to exports in plaintext.
- Add or update tests in `tests/` for behaviour changes, and update `README.md` / `docs/` when user-facing behaviour changes.
- Add a line to the `Unreleased` section of [`CHANGELOG.md`](CHANGELOG.md).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep pull requests focused. Unrelated refactors belong in separate PRs.
3. Make sure `pytest` and `npm run build` pass locally.
4. Describe what changed and how you tested it in the PR description.

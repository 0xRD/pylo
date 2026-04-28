# Pylo Code Audit

Date: 2026-04-28
Branch: `audit/code-quality`

## Executive Summary

The audit found several concrete correctness and security issues. Low-risk fixes were applied directly; larger hardening work is documented for a follow-up pass.

The highest-impact bug was the `pylo_sdk.search_entries()` contract drift: the backend now returns `{items, total}`, while existing PyBooks expect a list. That caused the demo PyBook to iterate the keys `items` and `total`, then call `/api/blueprints/entries/items` and `/api/blueprints/entries/total`, producing the reported 404s.

## Fixed Issues

### SDK search result compatibility

- File: `pylo_sdk.py`
- Problem: `search_entries()` returned the backend paginated envelope directly.
- Impact: PyBooks written against the SDK list contract broke, including `Push IOC to IOC Colelction`.
- Fix: unwrap paginated responses to `items` while preserving legacy list responses.
- Regression check: `tests/test_pylo_sdk.py` covers paginated and legacy response shapes.

### Queue manager syntax error

- File: `backend/core/queue_manager.py`
- Problem: the restart recovery stderr message contained a literal newline inside a string, making the module fail Python parsing.
- Impact: a backend rebuild or fresh import could fail before the queue starts; stranded `running` runs would not be recovered.
- Fix: restore the intended escaped newline string.
- Regression check: `python3 -m compileall` and backend tests cover importability.

### Frontend runs page brittle loading

- File: `frontend/src/pages/Runs.jsx`
- Problem: workflow run fetch failures rejected the combined `Promise.all`, leaving run lists in a stale or loading state.
- Impact: the Runs page could fail to render PyBook runs if workflow runs were temporarily unavailable.
- Fix: fallback to empty arrays on failed run-list fetches.
- Regression check: frontend build.

### Unnecessary frontend API token build arg

- Files: `docker-compose.yml`, `frontend/Dockerfile`
- Problem: `API_TOKEN` was passed into the frontend build as `VITE_API_TOKEN` even though the frontend does not use it.
- Impact: avoidable secret exposure risk through build args/history and developer tooling.
- Fix: remove the unused build arg and environment variable.
- Regression check: frontend Docker build and `npm run build`.

### Frontend dependency advisories

- Files: `frontend/package.json`, `frontend/package-lock.json`
- Problem: `npm audit` reported a high-severity Vite advisory plus moderate PostCSS/DOMPurify advisories.
- Impact: vulnerable development/build dependencies and Monaco transitive sanitizer dependency.
- Fix: update lockfile-resolved Vite/PostCSS versions and add a narrow `dompurify` override to force the patched transitive version used by Monaco.
- Regression check: `npm audit --audit-level=moderate` reports 0 vulnerabilities; frontend build passes.

### PyBooks AI prompt modal layout cleanup

- File: `frontend/src/pages/PyBooks.jsx`
- Problem: the modal was rendered as a sibling of the app surface via an extra fragment.
- Impact: avoidable layout/layering inconsistency in the editor view.
- Fix: render the modal inside the PyBooks page root.
- Regression check: frontend build.

## Remaining Findings

### Self-update system is high privilege

- Files: `backend/api/system.py`, `docker-compose.yml`
- Risk: the backend has Docker socket access and admin users can trigger `git pull` plus `docker compose up --build`.
- Current mitigations: `update/apply` requires admin, commands are argument-list subprocess calls rather than shell strings.
- Recommendation: require explicit opt-in for the self-update endpoints, record update activity events, and document that Docker socket access is equivalent to host root on typical Docker installations.

### CORS is permissive

- File: `backend/main.py`
- Risk: `allow_origins=["*"]` with credentials enabled is overly broad and can also behave inconsistently across browsers.
- Recommendation: configure allowed origins from `.env`, defaulting to local frontend origins for development.

### Preview/fetch endpoints can reach arbitrary URLs

- File: `backend/api/blueprints.py`
- Risk: blueprint preview/fetch can be used as a server-side HTTP client by authenticated users.
- Recommendation: add SSRF controls before multi-user or untrusted deployments: block link-local/metadata/private networks by default, add an allowlist option, and log target hostnames.

### Default development secrets remain in code

- Files: `backend/config.py`, `.env.example`
- Risk: a deployment that skips `setup.sh` can boot with known `SECRET_KEY` and `API_TOKEN` values.
- Recommendation: fail startup when production mode is enabled and either value is still `change_me_in_production`; keep local development easy with an explicit dev mode.

### Setup script prints generated secrets

- File: `setup.sh`
- Risk: generated secrets are written to terminal logs/shell scrollback.
- Recommendation: print only the API token if needed for first use, and avoid printing `SECRET_KEY`.

### User-supplied PyBook dependency installation needs policy

- Files: `backend/core/image_builder.py`, `backend/api/pybooks.py`
- Risk: arbitrary dependencies in PyBooks are expected behavior, but they expand supply-chain risk.
- Recommendation: support a deployment-level allowlist or trusted index configuration before broader team use.

## Audit Notes

- Route ordering checked: `/api/runs/queue` is before `/{run_id}`, `/api/workflows/runs` is before `/{workflow_id}`, and `/blueprints/entries/:id` is before `/blueprints/:id`.
- Duplicate function/class definitions checked with AST after fixes; no duplicate definitions remained.
- Secret value handling checked in backend logs/API responses; no decrypted secret values were found in normal API responses.
- Migration head in the VM is `k0l1m2n3o4p5`; the project overview still mentions `e8f6a5b4c3d2`, so the overview is stale.

## Verification

- `python3 -m compileall -q backend pylo_sdk.py tests` passed.
- `docker compose build backend --no-cache && docker compose up -d backend` passed; backend became healthy.
- `docker compose exec -T backend python -m pytest tests/ -v` passed: 64 tests.
- `docker compose exec -T backend alembic upgrade head` passed; current head is `k0l1m2n3o4p5`.
- Affected smoke checks passed: `/api/blueprints/entries`, `/api/runs/queue`, and in-container `pylo_sdk.search_entries()` unwrap.
- `cd frontend && npm audit --audit-level=moderate` passed: 0 vulnerabilities.
- `cd frontend && npm run build` passed.
- `docker compose build frontend --no-cache && docker compose up -d frontend` passed.
- Final `docker compose ps` passed with backend healthy and frontend running.

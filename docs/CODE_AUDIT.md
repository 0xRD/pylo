# Pylo Code Audit

Date: 2026-04-28
Branch: `audit/code-quality`

## Executive Summary

The audit found several concrete correctness and security issues. Low-risk fixes were applied directly; larger hardening work is documented for a follow-up pass.

The highest-impact bug was the `pylo_sdk.search_entries()` contract drift: the backend now returns `{items, total}`, while existing PyBooks expect a list. That caused the demo PyBook to iterate the keys `items` and `total`, then call `/api/blueprints/entries/items` and `/api/blueprints/entries/total`, producing the reported 404s.

## Fixed Issues

### Self-update system removed

- Files: `backend/main.py`, `backend/api/system.py`, `frontend/src/pages/Settings.jsx`, `docker-compose.yml`
- Removed the high-privilege in-app update endpoints and Settings controls. The backend no longer mounts the whole repo at `/app/repo`.
- Verification: grep shows no active frontend/backend references to `/api/system` or update routes.


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


---

# Pylo Code Audit — Addendum

Date: 2026-05-30
Branch: `main`

This addendum covers a focused **security review** of the backend and an **audit + functional test of the Workflows feature**. Several "Remaining Findings" from the 2026-04-28 audit are now resolved in the codebase: CORS is configured from `PYLO_ALLOWED_ORIGINS` (no longer `*`), an SSRF guard exists for blueprint fetch, and `Settings.validate_security()` refuses to boot production with default/weak `SECRET_KEY`/`ENCRYPTION_KEY`/`API_TOKEN`.

## Security review

### Fixed in this pass

#### Run-token IDOR — runner could read/modify any run (`ff89f8b`)
- File: `backend/api/runs.py`, `backend/main.py`
- Problem: run tokens injected into PyBook containers were allowed to call `GET /api/runs/{id}`, `POST /api/runs/{id}/output`, and `DELETE /api/runs/{id}` for *any* `run_id` — the id was never bound to the token. One PyBook could read another run's stdout/stderr/output_vars and overwrite its output, breaking run isolation.
- Fix: added `_enforce_run_access()` so a `runner` principal may only touch its own `run_id` (mirrors the existing WebSocket check). Admin and scoped-key principals are unaffected. Regression test added: `tests/test_security_hardening.py::test_run_token_can_only_access_its_own_run`.

#### Non-constant-time master-token comparison (`686a6c2`)
- Files: `backend/core/auth.py`, `backend/main.py`, `backend/api/runs.py`
- Problem: `api_key == settings.API_TOKEN` (×5) is a timing side-channel on the highest-value static credential.
- Fix: centralized `is_master_token()` using `hmac.compare_digest` on encoded bytes (also prevents a non-ASCII `X-API-Token` header from raising a `TypeError`/500).

### Open findings

#### MEDIUM — SSRF DNS-rebinding TOCTOU
- File: `backend/api/blueprints.py` (`_validate_fetch_url`, `_resolved_private_fetch_host`)
- `_validate_fetch_url` resolves the hostname to reject private IPs, but `httpx` re-resolves independently at connect time. A host whose DNS flips between a public and a private/metadata IP (`169.254.169.254`, `127.0.0.1`) bypasses the guard.
- Recommendation: resolve once and pin the connection to the validated IP (custom transport / connect-to-IP with `Host` header), or validate the actually-connected peer IP. (Note: the redirect-follow path already re-validates each hop, which is good.)

#### MEDIUM — `network_policy="allowlisted"` does not restrict egress
- File: `backend/core/runner.py` (`_run_container_sync`)
- The "allowlisted" policy only adds `extra_hosts` DNS entries and attaches the container to the full `DOCKER_NETWORK`; it does not block egress to the internet, `backend:8000`, or `postgres`. The name implies an egress allowlist that is not enforced — only `network_policy="none"` truly isolates.
- Recommendation: enforce egress with a real mechanism (per-run network + firewall), or rename/document the policy as DNS-convenience only.

#### MEDIUM — No rate limiting / lockout on authentication
- File: `backend/api/auth.py` (`/api/auth/login`, `/api/auth/invite/{token}`)
- Failures are logged but not throttled — online brute force is unbounded.
- Recommendation: per-IP/account backoff or lockout.

#### LOW / hardening
- Run/master tokens accepted via WebSocket **query param** (`backend/api/runs.py` `?token=`) leak into proxy/access logs — prefer the cookie/header paths.
- Git PAT embedded in the remote URL (`backend/api/gitops.py` `_url_with_token`) is visible in process args (`ps`) and written to `.git/config` — prefer `GIT_ASKPASS`/`http.extraHeader`.
- Backup-passphrase KDF uses PBKDF2 **100k** iterations (`backend/api/export_import.py`) vs **600k** for the main key — align them.
- `PYLO_COOKIE_SECURE` defaults to `False` (`backend/config.py`) and is not covered by `validate_security()` — production over HTTP would send the session cookie in clear.
- Scoped API keys / runner tokens are coarse by design: `pybooks:trigger` triggers any PyBook; `entries:write` writes any blueprint's entries. No per-resource scoping.

## Workflows feature audit

### Functional test (live, against the running stack)
Created two trivial PyBooks chained `A → B` with an `on_success` edge and a payload mapping `incoming = $.vars.greeting`, plus a diamond `A→B, A→C, B→D, C→D`. Results:
- Validation (`/validate`) correctly returned `valid: true`.
- Both nodes executed in dependency order; A's `pylo.set_output("greeting", …)` flowed through the edge mapping and B received `{"incoming": "hello-from-A"}`. Workflow status `success`.
- Diamond: each node (incl. the join `D`) executed **exactly once**.

Conclusion: the executor's core DAG execution, edge conditions (`always`/`on_success`/`on_failure`/`true`/`false`/`loop_item`), output-var propagation, and condition/loop control nodes work as intended. Edge fields are consistently `from`/`to` across the frontend, executor, and validator.

### Findings / limitations (not fixed — flagged for follow-up)
- **Fan-in join semantics**: a node with multiple incoming edges executes as soon as the *first* parent completes (guarded by the `triggered` set in `executor.py::execute_workflow`); it does **not** wait for all parents and only receives the first parent's payload. For true join/merge behavior this needs a barrier that waits for all in-edges. A concurrent-completion case could also theoretically double-schedule a join node before the `triggered` guard is set.
- **Workflow runs bypass the queue manager**: `backend/api/workflows.py::trigger_workflow_run` uses `asyncio.create_task(_run_bg(...))` on the server event loop with status `"pending"` — no concurrency cap, and in-flight runs are lost (left `pending`/`running`) on a backend restart. This is inconsistent with the project rule that all trigger paths write `status="queued"` before `queue_manager.enqueue()` (which PyBook runs follow).
- `trigger_workflow_run` does not check `wf.is_active` before running.
- Manual runs cannot supply an input payload (the endpoint takes no body; `WorkflowRun.trigger_payload` defaults to `"{}"`).
- `create_workflow` does not validate that `nodes`/`edges` are well-formed JSON or that `trigger_type` is known.

### Improvement implemented — canvas zoom & pan
- File: `frontend/src/pages/WorkflowEditor.jsx`
- The canvas was previously fixed-scale with no pan, capping practical workflow size. Added:
  - Mouse-wheel zoom that zooms toward the cursor (native non-passive listener since React's `onWheel` is passive), clamped to 25%–200%.
  - Drag-empty-canvas to pan; a click without drag still clears the selection.
  - On-screen controls (zoom in / out / fit-to-view / reset + live % readout).
  - Dot grid tracks the transform; node dragging and edge drawing convert screen→world coordinates so they remain accurate at any zoom/pan.

## Verification
- `backend python -m pytest tests/` → **114 passed** (after the two security fixes + new test).
- `frontend npm run build` → passed (JSX valid); frontend container rebuilt.
- Live workflow runs (linear + diamond) executed successfully end-to-end.
- Both security fixes smoke-tested: valid/invalid/non-ASCII master token (200/401/401); runner token own-run (404, ownership OK) vs other run (403).

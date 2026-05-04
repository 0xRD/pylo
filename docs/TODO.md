# Pylo — Feature Backlog

Items are ordered by priority. This file tracks remaining product work only; completed historical items are listed at the end for traceability.

---

## 1. V1 production hardening follow-ups ✅

- Docker socket proxy: replaced raw `/var/run/docker.sock` mount with `tecnativa/docker-socket-proxy` on an internal-only network; backend exposes only the container/image/build API surface. ✅
- Per-PyBook runner network policy (`default`, `none`, `allowlisted`): model fields, Alembic migration, runner enforcement, ConfigPanel selector. ✅
- Durable queue — retries, cancellation, dead-letter: `retry_count`/`max_retries` on `PyBookRun`, auto-retry on error/timeout, `dead_letter` after exhaustion, `cancelled` status, `DELETE /api/runs/{run_id}` endpoint. ✅
- Dependency allowlist / trusted package index: `PYLO_ALLOWED_PACKAGES` and `PYLO_PIP_INDEX_URL` env vars enforced in `image_builder.py` at build time. ✅
- CI migration validation: GitHub Actions job that runs `alembic upgrade head` against a fresh Postgres on every push/PR. ✅
- CI smoke coverage: GitHub Actions job that boots the full Compose stack and exercises queue, blueprints, PyBooks, and entry search endpoints on push to main. ✅
- Workflow DAG validation (cycles, missing/inactive PyBooks, broken edges): GET validate endpoint, 422 guard on run, inline error panel + red node border in editor. ✅
- Cases Lite: status, severity, assignee, linked entries/runs, comments — Cases list page + detail page with Overview / Linked Items / Comments tabs. ✅

**Why:** The current pass adds scoped keys, safer fetches, fixed live concurrency limits, and secret access auditing. These remaining items harden the runtime and operations layer for trusted team production.

---

## 2. `pylo_sdk` standalone library

- Package `pylo_sdk` as a pip-installable library.
- Add a `PyloClient` class for external scripts:
  - configurable base URL and API key
  - `search_entries`, `get_entry`, `update_entry`
  - `run_pybook`, `get_run`, `wait_for_run`
- Keep the mounted container SDK backward compatible.
- Add minimal documentation and examples.

**Why:** External automation should not depend on copying the in-container helper file.

---

## 3. Configuration backup & restore

Two levels of export/import: granular (single object) and full snapshot.

---

### 3a. Granular export/import (per object) — implemented

Export and import individual objects as JSON files directly from their detail page (Settings tab).

**PyBook export** — `pybook_<name>.json`:
- Full config (name, description, script, tags, trigger config, schedule).
- Script content embedded as a string.

**Blueprint export** — `blueprint_<name>.json`:
- Full config (name, field mappings, source URL, headers, schedule, pagination, retention, mutable mode).
- No entries by default for API-fetched blueprints.
- For manual blueprints: prompt asking whether to include entries.

**Workflow export** — `workflow_<name>.json`:
- Full workflow config (DAG nodes, edges, trigger config).
- All referenced PyBooks embedded under a `pybooks` key.

**Import conflict resolution** — when an imported object's name or ID already exists:
- User is prompted: **Overwrite**, **Create duplicate**, or **Cancel**.

**UI:**
- "Export" button in the Settings tab of each Blueprint / PyBook / Workflow detail page.
- "Import" button on the Blueprint, PyBook, and Workflow list pages.
- The global Settings page handles only the full backup/restore (see 3b).

---

### 3b. Full backup & restore — implemented

Full snapshot of Pylo configuration exportable to a ZIP file, re-importable for disaster recovery.

**Manual export/import:**
- Settings page "Download backup" button. ✅
- Optional encrypted secret inclusion with passphrase (PBKDF2-SHA256 + Fernet). ✅
- Import ZIP with manifest validation and optional secret decryption. ✅
- Blocking confirmation requiring the user to type `RESTORE`. ✅

**Scheduled auto-backup:**
- Configurable cron schedule and retention count in Settings. ✅
- APScheduler job saves ZIPs to `objects_storage/backups/` and prunes old files. ✅
- `POST /api/backup/now` to trigger an immediate on-disk backup. ✅
- `GET /api/backup/history` + download + delete endpoints. ✅
- Settings page shows backup history list with download/delete per file. ✅

**Why:** A single VM failure or bad import can destroy weeks of blueprints and PyBooks.

---

### 3c. Git-based dev → prod promotion — implemented

GitOps-style workflow: objects are authored in a dev instance, committed to a Git repository, and selectively pulled into a production instance. Production is read-only for config edits but fully operational (run, activate/deactivate, view logs).

**Environment mode**
- A `environment` setting per instance: `dev` (default) or `prod`.
- On `prod`: script editors and config forms are read-only; trigger configs cannot be modified. Activation/deactivation and manual runs remain available.
- Git config stored in Settings: repository URL, branch, token, committer name/email.

**Dev side — Commit UI**
- A **"Commit"** button appears in the top bar whenever one or more objects have changed since the last git commit.
- Clicking opens a panel listing all pending changes (new / modified / deleted) per object type, with a per-field diff for modified objects.
- User selects which changes to include, writes an optional commit message, then pushes to the configured branch.
- `is_active` is never versioned (operational state, not config).
- Secrets are never written to git.

**Git repository layout**
```
pylo-config/
  manifest.json          ← pylo version, last commit date, instance id
  settings.json          ← system settings (no secrets)
  blueprints/
    <name-slug>.json
  pybooks/
    <name-slug>.json
  workflows/
    <name-slug>.json     ← PyBooks referenced by name slug, not UUID
```

**Prod side — Sync UI**
- A persistent **"Sync"** button in the top bar shows a badge when the remote branch is ahead.
- Clicking opens a panel: new objects to create, modified objects with diff, objects deleted from git (shown as warnings, never auto-deleted).
- Objects present in prod but absent from git are flagged as "local only" — user decides whether to keep or remove.
- User selects what to apply and confirms; import uses name-based matching (same mechanism as 3a), with `is_active` left untouched on existing objects.

**Object identity across instances**
- Objects are matched by name slug, not UUID. A PyBook called "Scan URL" in dev will update the same-named PyBook in prod on sync.
- UUIDs are regenerated on import; internal references (workflow → PyBook) are remapped automatically as in 3a.

**Safety constraints**
- Git operations are config-only: never `git pull` on application code, never rebuild containers.
- Token stored encrypted in the database (same mechanism as secrets).
- Prod mode only allows `git fetch` + read; it cannot push back to the repo.

**Why:** Enables a safe, auditable promotion pipeline from development to production without requiring direct network access between instances or manual file transfers.

---

## 4. Dashboard and dense views ergonomics

- Rework the dashboard layout to feel less compressed on desktop.
- Add more breathing room, larger chart panels, and clearer visual hierarchy for high-priority metrics.
- Consider a collapsible or wider main content mode for operator pages such as Dashboard, PyBooks, Runs, and Entries.
- Improve PyBook run/development surfaces so payload, variables, logs, and recent runs are easier to scan without cramped side-by-side panels.
- Keep compact density available for power users, but avoid making the default view feel squeezed.

**Why:** The current Dracula refresh is functional, but operational views need more space and stronger hierarchy for long development/debugging sessions.


---

## Completed

- Postgres production profile with dialect-aware engine setup, bootstrap detection, FTS/search helpers, JSON field extraction, and optional Compose service.
- Scoped API keys with hashed storage, one-time raw token display, scopes, last-used timestamp, revoke UI, and middleware enforcement.
- Live queue concurrency shrinking fixed with a tracked limiter instead of stale semaphore permits.
- Blueprint fetch SSRF hardening now validates DNS results and redirect targets.
- Secret injection now writes activity events containing only secret names and run context, never decrypted values.
- Entry deduplication, mutable fields, and entry history.
- Cross-blueprint field query language.
- PyBook search/type/tag filtering.
- User authentication, roles, setup wizard, invites, and password management.
- Activity log.
- Manual blueprint entry creation.
- Contextual help tooltips.
- Blueprint trigger event type.
- Blueprint/Entry UI separation.
- Human-friendly schedule builder.
- Console navigation improvements.
- Multi-select deletion for Entries.
- Persistent PyBook execution queue.
- Multi-PyBook blueprint triggers owned by PyBooks.
- Run variable inspector via `pylo.set_output()` and `pylo.export_vars(locals())`.
- Visual Workflow builder.
- Workflow blueprint trigger conditions.
- Paginated API source fetching.
- Frontend Dracula-style navigation and PyBooks/Entries refresh.
- Per-blueprint entry retention (`max_entries`, `retention_days`).
- Concurrent execution hardening: `NullPool` for SQLite, per-tag image build lock, split DB sessions — validated at 15 concurrent runs.
- Re-parse existing entries on blueprint mapping change (background task, progress banner, FTS re-index).
- Field name required validation in Blueprint field mappings form.
- Dashboard / command center with operational metrics, charts, failures, automations, and activity.
- Bulk PyBook dispatch from selected entries.
- PyBook payload helper and development ergonomics (`pylo.get_payload()`, payload templates, prompt/help updates).
- Granular export/import for blueprints, PyBooks, and workflows.
- Manual full backup/restore ZIP for blueprints, PyBooks, workflows, and settings.
- Mounted `pylo_sdk` entry helpers: `create_entry`, `update_entry`, and `delete_entry`.
- Workflow DAG validation: `validator.py` (Kahn cycle detection + PyBook checks), GET validate endpoint, 422 run guard, WorkflowEditor error panel and red node highlights.
- Cases Lite: Case / CaseComment / CaseLink models, full REST API, Cases list page and CaseDetail page (Overview / Linked Items / Comments tabs), sidebar nav entry.
- GitOps dev→prod promotion: git commit/push from dev, git pull/apply on prod, field-level diffs, per-object selection, pybookSlug portability, Settings git config, sidebar Commit/Sync buttons.
- Multi-status filter on Runs page (toggle buttons, multi-value URL params).
- Trigger conditions for workflow blueprint triggers (evaluated in `_fire_blueprint_triggers`, configurable in WorkflowEditor PropertiesPanel).
- Docker socket proxy: `tecnativa/docker-socket-proxy` on internal `socket_proxy` network; backend no longer has raw socket access.
- Per-PyBook network policy: `default` / `none` / `allowlisted` field on PyBook, enforced in runner, configurable in ConfigPanel.
- Dependency allowlist + trusted pip index: `PYLO_ALLOWED_PACKAGES` and `PYLO_PIP_INDEX_URL` checked in `image_builder.py`.
- Durable queue hardening: `retry_count` / `max_retries` auto-retry, `dead_letter` status after exhaustion, `cancelled` status with `DELETE /api/runs/{run_id}`.
- CI: migration validation job (fresh Postgres + alembic head check) + smoke test job (full Compose stack, key endpoints) in `.github/workflows/ci.yml`.

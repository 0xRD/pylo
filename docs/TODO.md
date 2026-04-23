# Pylo — Feature Backlog

Items are ordered by priority. Do not implement until explicitly requested.

---

## 1. Entry deduplication + mutability + history

**Dedup key** (partially done — ★ selector exists in UI, `_do_fetch` reads `is_key`):
- Next: mutable fields — mark fields as mutable in mapping config; on re-fetch update mutable fields on existing entries instead of skipping.
- Add `EntryEvent` audit table: `(id, entry_id, changed_by, pybook_id, changed_fields, previous_values, timestamp)`.
- SDK: `update_entry(entry_id, fields)`.

**Why:** Core SOAR use case — ingest XDR alerts, track lifecycle changes, let PyBooks close/update them.

---

## 2. Cross-blueprint field query language

- Field-level query syntax: `os contains "Windows"`, `category = "Execute"`, combinable with `AND`/`OR`.
- Server-side filtering via SQLite `json_extract` on `data` column.
- Works alongside FTS search on the global Entries page.

**Why:** Users need structured filtering beyond full-text search.

---

## 3. PyBook filtering + tags ✅ NEXT

- Search/filter by name in the PyBooks list.
- Filter by type (sub-pybook vs top-level).
- Free-form tags stored as JSON array; tag chips in UI; click to filter.

**Why:** Discovery becomes painful as PyBook count grows.

---

## 4. User authentication + roles (login page) ✅ DONE

- Setup wizard (`/setup`) for first account creation.
- Login page (`/login`) with httpOnly cookie JWT (24 h, configurable via `.env` + Settings page).
- `User(id, username, hashed_password, role: admin|viewer)` model.
- Admin: full access. Viewer: read-only — write buttons disabled in UI + 403 enforced by backend middleware.
- `verify_token` accepts both master `API_TOKEN` header and JWT cookie.
- Invitation system: admins generate single-use 24 h links (`/invite/:token`); links are re-accessible.
- Change-password modal available to all users; admins can reset any user's password.
- `/users` admin panel for user management.

**Why:** Multi-user support for team environments.

---

## 5. Activity log ✅ DONE

Global audit trail of everything that happens in Pylo, visible to all authenticated users.

**Data model — `ActivityEvent` table:**
```
id, event_type, category, actor, resource_type, resource_id, resource_name, detail (JSON), created_at
```
- `event_type` — stable string ID for the event, used as the primary filter key. Same type always produces the same ID regardless of which resource triggered it. Grouped into categories:
  - `auth` — `auth.login`, `auth.logout`, `auth.login_failed`
  - `user` — `user.created`, `user.updated`, `user.deleted`
  - `blueprint` — `blueprint.created`, `blueprint.updated`, `blueprint.deleted`, `blueprint.fetch`
  - `entry` — `entry.created`, `entry.deleted`, `entry.bulk_deleted`
  - `pybook` — `pybook.run`, `pybook.created`, `pybook.updated`, `pybook.deleted`
  - `secret` — `secret.created`, `secret.deleted`
  - `invite` — `invite.created`, `invite.used`, `invite.revoked`
  - `settings` — `settings.updated`
- `category`: top-level group (`auth`, `blueprint`, `pybook`, etc.) — derived from `event_type`, stored for fast filtering
- `actor`: username (or `"api_token"` for SDK calls, `"scheduler"` for cron)
- `resource_id` / `resource_name`: e.g. blueprint UUID + name, pybook id + name
- `detail`: freeform JSON for extra context (run exit code, changed fields, fetch entry count, etc.)

**Retention:**
- Default: **7 days**. Configurable in Settings (alongside max concurrent runs / session duration).
- A background cleanup task runs daily and deletes events older than the configured window.
- `GET /api/settings` and `PUT /api/settings` extended with `activity_retention_days`.

**API:**
- `GET /api/activity` — paginated, newest first. Query params: `event_type`, `category`, `resource_id`, `actor`, `from`, `to`, `limit` (default 50), `offset`.
- Events are written server-side by the backend — no client-initiated writes.

**UI — `/activity` global page:**
- Full-width event feed, paginated (load more).
- **Filter bar:**
  - Category chips (multi-select): Auth / Blueprint / PyBook / Entry / User / Secret — one click to scope by domain
  - Event type dropdown (scoped to selected categories): e.g. "Fetch", "Run", "Login failed"
  - Actor input: filter by username
  - Date range presets: Last hour / Last 24 h / Last 7 days / Custom range
  - Resource ID field: paste any resource ID to show all events for that specific object
- **Preconfigured filter presets** (one-click shortcuts in a top bar):
  - "Failed runs" → `event_type=pybook.run` + `detail.exit_code != 0`
  - "Auth events" → `category=auth`
  - "Config changes" → `category=blueprint OR category=settings OR category=secret`
  - "Today" → `from=today 00:00`
- Each row: relative timestamp, coloured category badge, `event_type` label, actor, resource link (clickable → Blueprint/PyBook detail), expandable detail JSON.
- Visible to all authenticated users (admin and viewer).

**Per-resource "last N events" panel:**
- Blueprint detail → Settings tab: "Recent fetch history" — last 20 `blueprint.fetch` events for that blueprint (entry count, duration, trigger source).
- PyBook detail → existing runs panel already covers run history; no duplication needed.

**Why:** Observability for team use — know who changed what, debug unexpected runs, audit access. Stable `event_type` IDs allow external tools (dashboards, alerts) to reliably filter events by type.

---

## 6. Scoped API Keys

- Per-key permissions: `blueprints:read`, `pybooks:trigger`, `runs:read`.
- Keys stored hashed; raw value shown only at creation.
- Settings page: create/revoke, name + scopes + last-used.

**Why:** Enables SIEM/script integrations without handing out the master token.

---

## 6. Re-parse existing entries when blueprint mappings change

- On `PUT /blueprints/:id` with changed `field_mappings`, re-parse all existing entries using stored `raw_data`.
- Run as background task; surface progress.

**Why:** Users iterate on mappings after ingestion; old entries show stale fields.

---

## 7. Manual blueprint entry creation UI ✅ DONE

`is_manual` blueprints now have an "+ Add entry" button that opens a field-per-mapping form.
`POST /api/blueprints/:id/entries` endpoint added with dedup check on key field.

---

## 8. Contextual help tooltips ✅ DONE

Implemented via `HelpTip` component.

---

## 9. Paginated API source fetching

- Per-Blueprint pagination config: `pagination_type` (none | cursor | page_number | offset), `pagination_param`, `pagination_path` (JSONPath to extract next cursor), `max_pages` safety limit (default 50).
- `_do_fetch` loops until empty response or no next cursor.
- UI: collapsible Pagination section in Blueprint form.

**Why:** Most APIs (GitHub, JIRA, SIEMs) page results — single-request fetch silently drops data.

---

## 9b. Blueprint trigger event type ✅ DONE

`trigger_event` column added (`on_create` | `on_create_or_update`). `_do_fetch` fires linked PyBook via `asyncio.create_task` after creating entries. BlueprintForm shows PyBook selector + event dropdown.

---

## 10. Blueprint/Entry UI separation ✅ DONE

`/blueprints` card grid, `/blueprints/:id` tabbed detail (Entries + Settings), `/entries` global entries page.

---

## 11. Human-friendly schedule builder ✅ DONE

`ScheduleBuilder` component used in Blueprint form and PyBook cron trigger.

---

## 12. Console navigation improvements ✅ DONE

Pylo logo → home link. EntryDetail breadcrumb (Entries › Blueprint › id). Smart back button.

---

## 13. Multi-select for entries

- Hover-reveal checkboxes on entry cards; select-all in toolbar.
- Bulk action bar: Delete selected (confirm), Trigger PyBook on selected.

**Why:** Bulk cleanup after bad fetches; bulk playbook dispatch for SOAR.

---

## 14. Persistent PyBook execution queue

**Context:** `runner.py` has a `ThreadPoolExecutor(max_workers=PYLO_MAX_CONCURRENT_RUNS, default=5)`.
That's the hard cap on simultaneous Docker container spawns. The asyncio layer queues unlimited
`create_task` calls, but **none of them are persisted** — a server restart drops all queued runs.
With 50–100 alerts per fetch each triggering a PyBook, this is a real data-loss risk.

**Implementation:**
- Add `"queued"` status to `PyBookRun` (before `"pending"`). Runs are written to DB as `queued` before any container is spawned.
- A global `asyncio.Semaphore(PYLO_MAX_CONCURRENT_RUNS)` gates container starts — replaces the ThreadPoolExecutor approach.
- On startup, recover all runs with `status="queued"` and re-enqueue them.
- Expose queue depth: `GET /api/runs/queue` → `{queued: N, running: N}`.
- UI: queue depth badge in the Runs sidebar link.
- `PYLO_MAX_CONCURRENT_RUNS` already exists in config (default 5); document it in `.env.example`.

**Why:** Blueprint fetches triggering many PyBooks in parallel will silently lose queued runs on restart. The ThreadPoolExecutor limit of 5 is correct but bypass-able via direct API calls; a semaphore enforces it globally.

---

## 15. Multi-PyBook blueprint triggers (subscribe from PyBooks view)

**Current model:** Blueprint has a single `trigger_pybook_id` — only one PyBook can subscribe per blueprint.

**Better model:** PyBook owns its trigger subscription.
- Add `blueprint` as a trigger type on PyBook (`trigger_type = "blueprint"`).
- `trigger_config` for blueprint triggers: `{"blueprint_id": "...", "trigger_event": "on_create"}`.
- `_do_fetch` queries all active PyBooks where `trigger_type = "blueprint"` and `trigger_config.blueprint_id` matches — fires all of them through the queue (see #14).
- PyBooks view: add a "Blueprint trigger" option in the trigger type selector alongside Cron / Webhook.
- Remove `trigger_pybook_id` / `trigger_event` from Blueprint model (migration to migrate existing config to PyBook trigger records).
- Multiple PyBooks can subscribe to the same blueprint event independently.

**Why:** The current model only allows one PyBook per blueprint. SOAR workflows need N PyBooks to react to the same new alert (e.g. enrich + notify + open ticket in parallel).

---

## 16. Run variable inspector

After a PyBook run completes, expose the variables that were in scope at the end of execution (or at the point of failure).

**Implementation:**
- In `pylo_sdk.py`, add an `export_vars(namespace: dict)` helper that serializes a variable dict to JSON and POSTs it to `PUT /api/runs/:id/vars`. Call it at the end of the script: `export_vars(locals())`.
- The SDK auto-filters un-serializable values (module objects, functions, built-ins) before sending.
- Add a `output_vars` JSON column to `PyBookRun` (migration).
- On failure, the runner captures the traceback locals automatically (via `sys.exc_info()` + `inspect` in the container wrapper) so variables are captured even on crash.
- `GET /api/runs/:id` returns `output_vars` alongside stdout/stderr.
- UI: **Variables** tab in the run detail panel (alongside stdout / stderr). Rendered as a collapsible key→value tree, similar to the Blueprint JSONPath tree. Primitive values shown inline; dicts/lists expandable.

**Why:** Debugging PyBooks currently requires reading stdout logs and inserting print statements. Seeing live variable state after a run (especially on error) dramatically shortens iteration time for complex automation scripts.

---

## 17. Visual PyBook orchestration — Workflow builder

A GUI for chaining PyBooks into multi-step workflows where the output of one step feeds into the next, with branching on success/failure.

**Data model:**
- New `Workflow` entity: `(id, name, description, nodes: JSON, edges: JSON, trigger_type, trigger_config, is_active, created_at)`.
- `nodes`: array of `{id, pybook_id, label, position: {x, y}}`.
- `edges`: array of `{id, from_node_id, to_node_id, condition: "always"|"on_success"|"on_failure", payload_mapping: JSON}`.
- `payload_mapping`: JSONPath-like rules for extracting fields from the upstream run's `output_vars` and injecting them as `trigger_payload` keys for the downstream PyBook. Example: `{"alert_id": "$.vars.alert_id", "score": "$.vars.vt_score"}`.

**Execution engine:**
- `POST /api/workflows/:id/run` creates a `WorkflowRun` and starts node execution from all root nodes (nodes with no incoming edges).
- Nodes run through the existing PyBook execution queue.
- On each node completion, the engine evaluates outgoing edge conditions and enqueues the next nodes, passing mapped payload.
- A `WorkflowRun` record tracks overall status and per-node run IDs.

**UI — graph editor:**
- Route: `/workflows/:id`.
- Uses **React Flow** (MIT licensed) for the canvas: drag-and-drop nodes, draw edges between them.
- Node palette sidebar: search and drag PyBooks onto the canvas.
- Edge config panel: click an edge to set condition (always / on success / on failure) and define payload mappings.
- Run button on the toolbar; progress shown live — nodes pulse blue while running, turn green on success, red on failure.
- `/workflows` list page: cards showing name, node count, last run status.

**Why:** Real SOAR workflows are multi-step — enrich an alert, score it, decide whether to escalate, open a ticket, notify Slack. Hand-coded `call_sub_pybook()` chains work for simple cases but don't scale to conditional branching, parallel fan-out, or visual debugging. A graph editor makes the logic readable and modifiable without touching code.

---

## 18. Configuration backup & restore

Full snapshot of Pylo configuration (blueprints, pybooks, secrets, settings) exportable to a Git repository or a ZIP file, and re-importable for disaster recovery.

**What is backed up (users excluded):**
- `blueprints/` — one JSON file per blueprint (name, source config, field mappings, schedule, trigger config)
- `pybooks/` — one JSON file per PyBook (script inline, trigger config, dependencies, tags)
- `secrets/` — optional, opt-in (see below)
- `settings.json` — system settings (max concurrent runs, JWT expiry, activity retention)
- `manifest.json` — schema version, Pylo version, timestamp, list of included objects

**File naming:** `{kebab-case-name}_{short-id}.json` to avoid collisions on rename.

**Secrets handling:**
- Excluded by default; opt-in via checkbox.
- When included: values are re-encrypted with a **user-supplied backup passphrase** (independent of the app's `ENCRYPTION_KEY`). The passphrase is required again at import to decrypt.
- Warning displayed at export: *"Secret values will be encrypted but this file remains sensitive — do not share it publicly."*
- When excluded: only name and description are saved (so secrets can be recreated manually after restore).

**Git integration (Settings page — "Backup" section):**
- Fields: repository URL, branch, personal access token (GitHub / GitLab), optional subdirectory path.
- **Auto-push**: after each create / update / delete of a blueprint, pybook, secret, or setting — debounced 5 s to batch rapid changes.
- **"Push now"** manual button alongside a status indicator: `Last saved X ago` / `✗ Failed — see logs`.
- Commits signed as the Pylo instance (configurable author name/email in Settings).
- Git errors (bad token, repo not found, push conflict) surfaced as a dismissible banner in the UI.

**Manual export (no Git required):**
- "Download backup" button in Settings → downloads a ZIP with the same folder structure.
- Checkbox to include secrets (shows warning, prompts for passphrase).

**Import:**
- Two sources: pull from the configured Git repo (latest commit on the configured branch) or upload a ZIP.
- Blocking confirmation dialog before import starts:
  - Warning: *"All existing blueprints, pybooks, secrets and settings will be permanently replaced. This action cannot be undone."*
  - User must type **RESTORE** to confirm.
- Import sequence:
  1. Validate manifest (schema version compatibility check).
  2. If secrets are present: prompt for backup passphrase and verify before proceeding.
  3. Delete all existing blueprints (cascade to entries), pybooks (cascade to runs), secrets, settings.
  4. Re-create all objects from backup files.
  5. For each PyBook that has pip dependencies: trigger an async Docker image rebuild (`ensure_image`). Progress shown in a live log panel.
  6. Emit a `settings.updated` activity event with `detail.action = "restore"`.
- Import result summary: N blueprints, N pybooks, N secrets restored; N image builds triggered.

**API:**
- `GET /api/backup/export` — streams a ZIP (query param `include_secrets=true/false`, `passphrase` if secrets included). Admin only.
- `POST /api/backup/import` — multipart upload of a ZIP. Admin only.
- `POST /api/backup/git/push` — manual push trigger. Admin only.
- `PUT /api/backup/git/config` — save Git connection settings. Admin only.
- `GET /api/backup/git/status` — last push timestamp, last error. Admin only.

**UI — Settings page, new "Backup" tab:**
- Git config form (URL, branch, token, author).
- Auto-push toggle + "Push now" button + status line.
- Export section: "Download backup" button + secrets checkbox.
- Import section: file upload or "Pull from Git" button + RESTORE confirmation dialog + live rebuild log.

**Why:** A single VM failure or misconfiguration wipe can destroy weeks of blueprint and PyBook work. Connecting to an existing Git repo gives point-in-time recovery, diff history, and a familiar workflow for exporting configuration to other Pylo instances.

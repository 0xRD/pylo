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

## 2. Cross-blueprint field query language ✅ DONE

- Field-level query syntax: `os contains "Windows"`, `category = "Execute"`, combinable with `AND`/`OR`.
- Server-side filtering via SQLite `json_extract` on `data` column.
- Works alongside FTS search on the global Entries page.

**Why:** Users need structured filtering beyond full-text search.

---

## 3. PyBook filtering + tags ✅ DONE

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

## 5. Scoped API Keys

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

`trigger_event` stored in each PyBook's `trigger_config` (`on_create` | `on_create_or_update`). `_fire_blueprint_triggers` checks this value per subscriber before enqueuing. Event selector exposed in the PyBook editor's blueprint trigger config panel (moved from BlueprintForm as part of #15).

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

## 13. Multi-select for entries ✅ DONE

- Hover-reveal checkboxes on entry cards; select-all in toolbar.
- Bulk action bar: Delete selected (confirm), Trigger PyBook on selected.

**Why:** Bulk cleanup after bad fetches; bulk playbook dispatch for SOAR.

---

## 14. Persistent PyBook execution queue ✅ DONE

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

## 15. Multi-PyBook blueprint triggers ✅ DONE

Trigger subscription ownership moved from Blueprint to PyBook. Each PyBook now declares `trigger_type = "blueprint"` with `trigger_config = {"blueprint_id": "...", "trigger_event": "on_create|on_create_or_update", "trigger_conditions": [...]}`.

- Migration `f1a2b3c4d5e6` converted existing `blueprint.trigger_pybook_id` records into PyBook `trigger_config` entries.
- `_fire_blueprint_triggers` queries all active PyBooks subscribed to a blueprint; each has independent conditions and is capped at 50 enqueued runs per fetch.
- `GET /api/blueprints/{id}/subscribers` returns all subscribed PyBooks.
- PyBooks editor: "blueprint" trigger type with inline config panel (blueprint selector + event + conditions builder); "Edit trigger" bar in the editor.
- BlueprintDetail Settings tab: **Subscribed PyBooks** read-only section.
- `trigger_pybook_id` / `trigger_event` removed from BlueprintForm UI (DB columns kept for schema compatibility).

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

## 18. Bug: max_concurrent_runs change not reflected in Runs page ✅ DONE

After saving a new `max_concurrent_runs` value in the Settings page, the concurrency bar and slot count on the Runs page continue showing the old value until the server restarts.

**Root cause:** `queue_manager.get_stats()` calls `_get_max()` which reads `settings.PYLO_MAX_CONCURRENT_RUNS` from the environment config object — not from the `system_setting` DB table. So after `PUT /api/settings` calls `update_limit(new_limit)`, the semaphore is correctly resized but `get_stats()["max_concurrent"]` still returns the original env-var value.

**Fix:** Add a module-level `_current_limit: int = 0` variable in `queue_manager.py`. Set it in `start()` (load from DB or fall back to env) and in `update_limit()`. Replace `_get_max()` with `_current_limit` in `get_stats()`.

**Why:** The Runs page concurrency bar is misleading — it shows outdated slot counts after a settings change, making users think the change had no effect.

---

## 19. Always-on sub-PyBooks — warm container pool

Sub-PyBooks called frequently incur 1-3 second cold-start latency for each Docker container spin-up. An "always on" mode would keep a warm container running between calls for near-instant invocation.

**Data model:**
- Add `always_on: bool = False` flag on PyBook (and migration).
- Add `warm_port: int = None` — the host port the warm container is currently listening on (set at runtime, not persisted).

**Implementation:**
- On server startup, `scheduler.py` (or a new `warm_pool.py` module) starts a persistent container for each `always_on=True` sub-PyBook. The container runs a lightweight HTTP server (FastAPI on port 8000) that accepts `POST /invoke` with `{"payload": {...}, "secrets": {...}}` and executes the PyBook script.
- `call_sub_pybook(pybook_id, payload)` in `pylo_sdk.py` checks a module-level registry `_warm_containers: dict[int, str]` (pybook_id → base URL). If an entry exists, it POSTs to the warm container instead of spawning a new one.
- Warm containers are restarted on crash (Docker `--restart=unless-stopped` or health-check loop in `warm_pool.py`).
- Configurable `warm_idle_timeout` (default: never) — after N minutes with no invocations, the container is stopped and removed from the registry; it is re-warmed on next call.

**UI:**
- Toggle "Always on" in the PyBook editor toolbar (only visible when `is_sub_pybook=True`).
- Status indicator next to the toggle: green dot "warm" / gray dot "cold" — polled from `GET /api/pybooks/:id/warm-status`.
- Settings page: list of currently warm containers with uptime and last-invoked timestamp.

**Why:** In real-time SOAR workflows, sub-PyBooks are called on every alert (potentially hundreds per minute). A 2s cold start per call adds up and introduces latency into incident response pipelines. Warm containers make the call overhead comparable to a local function call.

---

## 20. PyBook trigger filtering — conditional entry triggers ✅ DONE

Each PyBook subscribed to a Blueprint can define a list of field-value conditions that must all match before a run is enqueued. Conditions are stored inside the PyBook's `trigger_config.trigger_conditions` (moved from `blueprint.trigger_conditions` when #15 was implemented).

- `check_trigger_conditions(parsed_fields, conditions)` in `backend/objects/filter.py`; operators `eq`, `ne`, `contains`, `starts_with`, `regex`, `gt`, `lt`; all ANDed.
- Called in `_fire_blueprint_triggers` per subscriber before enqueuing; also called from `POST /{blueprint_id}/entries` for manual entry creation.
- UI: `TriggerConditionBuilder` component in the PyBook editor's blueprint trigger config panel (field input + operator dropdown + value input + remove).

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

## 4. User authentication + roles (login page)

- Login page (`/login`) with JWT issued on `POST /api/auth/login`.
- `User(id, username, hashed_password, role: admin|viewer)` model.
- Admin: full access. Viewer: read-only (no create/edit/delete/trigger).
- `verify_token` accepts both master `API_TOKEN` and JWT.
- Admin panel for user management.

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

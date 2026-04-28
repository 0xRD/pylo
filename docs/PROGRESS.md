# Pylo — Progress Log

## Session 1 — Core platform (initial commit)
- FastAPI backend with SQLite + SQLModel
- PyBooks: create, edit (Monaco), run in Docker containers, view logs
- Objects (now Blueprints): basic CRUD, JSON field mapping, fetch from URL
- Secrets: encrypted store (Fernet), injected into PyBook containers
- Runs: execution history, log viewer
- React + Vite + Tailwind frontend

## Session 2 — Fixes & hardening
- `pylo_sdk.py` mounted into runner containers
- Auto-detection of host pybooks/sdk paths via Docker self-inspect
- Alembic migration system wired up; `entrypoint.sh` runs migrations on startup
- Bearer token auth (`X-API-Token`) on all API routes
- Unsaved changes guard in PyBook editor (beforeunload)
- WebSocket live log streaming for runs (`/api/runs/:id/ws`)
- GitHub repo created and pushed

## Session 3 — Blueprint intelligence
- **Unique key field**: ★ selector in field mapping builder; `is_key` stored in mappings JSON; `_do_fetch` deduplicates by chosen field
- **Cron auto-fetch**: `fetch_cron` + `fetch_is_active` on Blueprint; APScheduler syncs jobs on startup and after saves; migration added columns
- **Endpoint test + JSONPath picker**: `POST /api/blueprints/preview` endpoint; frontend JSON tree with click-to-fill path selection

## Session 4 — Rename + manual blueprints
- Renamed throughout: `ObjectType` → `Blueprint`, `ObjectInstance` → `Entry`
- DB migration renames tables (`object_type→blueprint`, `object_instance→entry`, `fts_objects→fts_entries`)
- API routes: `/api/objects/*` → `/api/blueprints/*` and `/api/blueprints/entries/*`
- Added `is_manual: bool` on Blueprint; hides source/cron/fetch controls in UI
- Fixed JSONPath picker form-submit bug (`type="button"` missing)
- Old `/objects` URL redirects to `/blueprints`

## Session 5 — UX & auth
- **HelpTip component**: `(?)` hover tooltips on Blueprint form fields
- **ScheduleBuilder component**: human-friendly cron builder — interval mode (every N min/h/d) and scheduled mode (HH:MM + weekday chips, 24h)
- **Authentication builder**: visual auth section — Bearer Token / API Key / Basic Auth with secret picker; auth header merged into `source_headers` transparently
- **Secret resolution fix**: `_do_fetch` and `preview_endpoint` now correctly resolve `{{secret:name}}` templates before parsing
- README fully rewritten

## Session 6 — Blueprint/Entry UI separation + navigation
- **Two-route layout** (#10): `/blueprints` card grid + `/blueprints/:id` tabbed detail (Entries tab / Settings tab)
- **BlueprintDetail**: breadcrumb `Blueprints › name`; entries count in tab label; fetch result inline feedback
- **Global Entries page** (`/entries`): blueprint filter chips, FTS search, URL-synced params, pagination
- **EntryDetail** (#12): smart back button (`navigate(-1)` or fallback to `/entries`); breadcrumb `Entries › Blueprint › entry-id`; navigate to blueprint on delete
- **Manual entry creation** (#7): "+ Add entry" button on manual blueprints opens modal with per-field form
- **Trigger event type** (#9b): `trigger_event` field on Blueprint (`on_create` / `on_create_or_update`); dropdown in BlueprintForm; migration `b5c3d2e1f0a9`
- **Sidebar**: Entries (◈) and Settings (⚙) links added; Pylo logo is a home `<NavLink>`

## Session 7 — PyBook tags, queue, settings
- **PyBook tags** (#3): `tags: str = "[]"` on PyBook; `TagChip` + `TagInput` components; sidebar search, type filter, tag filter chips; inline tag editor auto-saves; migration `c6d4e3f2a1b0`
- **Persistent execution queue** (#14): `queue_manager.py` — asyncio Queue + Semaphore; orphan recovery on startup; status `"queued"` propagated to all trigger paths (manual, cron, webhook, blueprint)
- **Settings page** (`/settings`): `SystemSetting` DB model; `GET/PUT /api/settings`; slider 1–20 for `max_concurrent_runs`; live apply via `update_limit()`; migration `d7e5f4a3b2c1`
- **Runs page queue UI**: concurrency bar (running/available slots + queued chips); stats refresh every 2 s; `GET /api/runs/queue` endpoint
- `RunStatusBadge`: added `queued` state

## Session 8 — Code audit + quality fixes
- **Engineering skills audit**: ran `code-reviewer` (quality checker), `docker-development` (Dockerfile/compose analyzer), `dependency-auditor` (CVE scan) via installed skill plugins
- **Bug fix** (critical): `trigger_source=blueprint` NameError in `_do_fetch` → `"blueprint"` string literal; would crash every blueprint-triggered PyBook run
- **Bug fix** (#18): `queue_manager.get_stats()` returned stale `max_concurrent` from env var after `update_limit()` — fixed with `_current_limit` module variable
- **Refactor** `_do_fetch` (complexity 30→11, 105→30 lines): extracted `_load_secrets_map`, `_resolve_request_params`, `_fetch_raw_items`, `_upsert_entries`, `_fire_pybook_trigger`; extracted `_resolve_preview_params` from `preview_endpoint`
- **Cleanup** `pybooks.py`: removed stale `BackgroundTasks` import/param; imported `queue_manager` at module level
- **Docker**: added `HEALTHCHECK` to backend `Dockerfile`; `docker-compose.yml` backend healthcheck + frontend `depends_on: condition: service_healthy`
- **TODO additions**: #18 (max_concurrent bug), #19 (always-on sub-PyBooks), #20 (PyBook trigger field filtering)
- Overall backend quality score: 95.7/100 (A)

## Session 9 — Field query language + multi-select
- **Field query language** (#2): `backend/objects/filter.py` — `apply_field_filter` (SQL `json_extract` WHERE clauses) + `python_field_filter` (Python-side for FTS+filter path); operators `=` `!=` `contains` `starts_with` `>` `>=` `<` `<=`; AND-chained; field names validated
- `list_entries` API: new `filter` query param; SQL path for plain queries, Python-side filtering for FTS results
- **Entries + BlueprintDetail**: monospace filter input row with `?` syntax help tooltip
- **Multi-select bulk delete** (#13): `EntryCard` checkbox (hover-reveal, always visible when selected); `selectedIds: Set` state in both pages; bulk action bar with count, select-all, clear, and destructive "Delete N entries" (confirm + `Promise.all`)

## Session 10 — Multi-PyBook blueprint triggers + test fixes
- **Test suite fixed**: `test_models.py` and `test_phase1_objects.py` updated to match renamed models (`ObjectType→Blueprint`, `ObjectInstance→Entry`, `fts_objects→fts_entries`); 28/28 passing
- **Multi-PyBook blueprint triggers (#15)**: trigger subscription ownership moved from Blueprint to PyBook
  - Migration `f1a2b3c4d5e6`: converts existing `blueprint.trigger_pybook_id` records into PyBook `trigger_config` entries
  - `_fire_blueprint_triggers` replaces `_fire_pybook_trigger` — queries all active PyBooks with `trigger_type="blueprint"` matching the blueprint; each subscriber has independent trigger conditions; capped at 50 per subscriber per fetch
  - New `GET /api/blueprints/{id}/subscribers` endpoint returns all subscribed PyBooks
  - `PyBooks.jsx`: `"blueprint"` added to trigger types; `BlueprintTriggerConfig` component (blueprint selector + event + conditions builder); "Edit trigger" inline panel in the editor; blueprints loaded on page mount
  - `BlueprintForm.jsx`: old single-PyBook trigger dropdown removed; `pybooksApi` import removed
  - `BlueprintDetail.jsx`: **Subscribed PyBooks** section in Settings tab (name, event type, condition count)
  - `blueprints.js`: `getSubscribers(blueprintId)` added to API client

## Current state
- All core features working end-to-end
- Blueprint card grid → tabbed detail (Entries / Settings + Subscribed PyBooks)
- Global Entries page with FTS + field filter + blueprint chips + bulk delete
- PyBooks: create/edit/run/schedule/webhook/blueprint-trigger/tags
- Multiple PyBooks can subscribe to the same blueprint independently with per-subscriber conditions
- Persistent execution queue with live Runs page stats
- Secrets: create/list/delete with encryption
- Settings: live concurrency limit

## Session 11 — Workflow builder merge + fresh-machine setup
- **Merged `feat/workflow-builder` into main**: DAG workflow executor, 3-panel React Flow editor, node palette, edge config, run progress overlay
- **`setup.sh`**: one-shot fresh machine bootstrap — installs Docker if absent, generates `.env` with secure keys, builds `pylo-runner-base`, starts the stack, waits for health
- **Entrypoint DB detection**: `entrypoint.sh` now detects fresh DB (no `alembic_version`) and runs `init_db()` + `alembic stamp head` instead of `alembic upgrade head` — eliminates empty-table errors on new machines
- **`docker-compose.yml`**: added `name: pylo` so Docker network is always `pylo_pylo_default` regardless of clone directory name
- **`pylo_sdk.py`**: fixed auth header bug — was using `Authorization: Bearer`, now correctly uses `X-API-Token`
- **Tests fixed**: `test_phase1_objects.py` DB fixture imports all models; `test_fts_search` updated for paginated entry response
- **New migration `h7i8j9k0l1m2`**: adds `output_vars` column to `pybook_run`, creates `workflow`, `workflow_run`, `workflow_node_run` tables

## Session 12 — Workflow triggers (blueprint + cron) + mutable entries + run variables + fixes
- **Workflow blueprint trigger** (`i8j9k0l1m2n3`): `trigger_config: str = "{}"` added to Workflow model; `_fire_blueprint_triggers` extended to query Workflow subscribers in addition to PyBook subscribers; `_run_cron_workflow` added to scheduler; WorkflowEditor now shows 4 trigger types (manual/cron/webhook/blueprint) with ScheduleBuilder for cron and blueprint picker + event selector for blueprint
- **Bug fix** (critical): `WorkflowCreate` Pydantic schema was missing `trigger_config` — workflows could save `trigger_type=blueprint` but never save `blueprint_id`, so triggers never matched. Fixed by adding `trigger_config: str = "{}"` to schema
- **asyncio fix**: `asyncio.get_event_loop()` → `asyncio.get_running_loop()` in blueprint trigger path (Python 3.10+ correctness)
- **Mutable blueprint entry fields** (`j9k0l1m2n3o4`): `mutable_mode` (`none`/`all`/`per_field`) on Blueprint; `EntryEvent` audit table; `PATCH /{bp}/entries/{id}` validates mutability before writing; `GET /{bp}/entries/{id}/history` returns ordered event log; BlueprintForm gets mutable_mode selector + per-field editable toggle; EntryDetail gets tabs (Fields/Raw/History) with inline edit inputs and history diff view
- **Run variable inspector**: `export_vars(locals())` added to `pylo_sdk.py` — exports all non-private JSON-serialisable local variables at once; Runs page sidebar and PyBooks run panel now show a Variables section when `output_vars` is non-empty
- **Self-update system**: new `/api/system/*` endpoints — `/info` (current git commit), `/update/check` (compare local HEAD vs origin/main via `git ls-remote`), `/update/apply` (git pull + docker compose up --build in background thread), `/update/status` (poll job state + log); backend Dockerfile now installs git + Docker CLI; repo mounted at `/app/repo`; Settings page gets "System updates" section with check + apply + live log
- **Unified Runs page**: PyBook runs and Workflow runs shown together with WF/PB type badges; type filter (All/PyBooks/Workflows); workflow detail shows per-node status and output_vars; global `GET /api/workflows/runs` endpoint added
- **Automations page** (`/automations`): lists all PyBooks and Workflows with active triggers in one view; filterable by type and active/all; shows trigger type badge + detail (cron expression, blueprint name + event); sidebar link added
- **Duplicate function cleanup**: removed duplicate `_fire_blueprint_triggers` and `_execute_workflow_bg` definitions left by previous patching; fixed duplicate `_MAX_TRIGGERS_PER_FETCH` constant
- **Remote fix (Rémi)**: `c4c57cc` — removed duplicate cron handlers in scheduler.py, added auth to WebSocket endpoint and `/api/runs/queue`

## Current state (after Session 12)
All core features working end-to-end on `main` branch.

**Alembic head**: `j9k0l1m2n3o4`

**Active routes:**
| Route | Description |
|---|---|
| `/blueprints` | Blueprint card grid |
| `/blueprints/:id` | Tabbed detail (Entries / Settings) |
| `/blueprints/entries/:id` | Entry detail with Fields/Raw/History tabs |
| `/entries` | Global entries — FTS + field filter + bulk delete |
| `/pybooks` | PyBook editor |
| `/workflows` | Workflow list |
| `/workflows/:id` | Workflow DAG editor |
| `/runs` | Unified PyBook + Workflow run history |
| `/automations` | All active triggers in one view |
| `/secrets` | Secret store |
| `/activity` | Audit log |
| `/settings` | System settings + self-update |
| `/users` | User management (admin) |

**Pending / backlog items:**
- Task 5: `pylo_sdk` as a standalone pip-installable library with `PyloClient` class
- Paginated API source fetching (#9)
- Scoped API keys (#6)
- Configuration backup & restore (#18)
- Re-parse entries on mapping change (#6b)

## Session 13 — Code quality audit + SDK compatibility + Sekoia demo fix
- **Branch `audit/code-quality` merged into `main`**: documented audit findings in `docs/CODE_AUDIT.md`; merged and pushed as `c08f4e9`.
- **SDK compatibility fix**: `pylo_sdk.search_entries()` now unwraps paginated `/api/blueprints/entries` responses and returns the historical list-like result expected by existing PyBooks.
- **Regression tests**: added `tests/test_pylo_sdk.py` to cover paginated and legacy list responses; full container test suite passed (`64 passed`).
- **Queue manager syntax fix**: fixed a syntax error in `backend/core/queue_manager.py` discovered during audit validation.
- **Frontend build/security cleanup**: removed stale frontend `VITE_API_TOKEN` build arg; `npm audit` is clean.
- **Sekoia IOC demo PyBook**: diagnosed successful API calls with no visible indicators; Sekoia expects raw observables in `value`, not STIX patterns. Updated the runtime demo PyBook script accordingly and verified a successful run with `indicators_count = 97`.

## Session 14 — Frontend refresh + Entries workflow fixes
- **Branch `feat/frontend-refresh` pushed**: `60e925f feat: refresh frontend navigation and entries`.
- **Sidebar refresh**: replaced emoji/glyph navigation with `lucide-react` icons; applied a Dracula-inspired dark palette across the app shell.
- **PyBooks UX refresh**: rebuilt the PyBooks page shell with a cleaner internal list, icon command bar, improved tags/trigger controls, and a bottom run console.
- **Run variables visibility**: PyBook run output variables are now prominent in the run console instead of hidden in a cramped side panel.
- **Entries route fix**: entry cards now navigate to canonical `/entries/:id`; deletion from EntryDetail returns to `/entries`; legacy `/blueprints/entries/:id` remains registered for compatibility.
- **Global Entries bulk delete**: added multi-select checkboxes, select-visible, clear, and delete-selected actions to the global Entries page.
- **Validation**: frontend build passed, Docker frontend rebuilt, container health checked, backend test suite passed in the backend container (`64 passed`), migrations upgraded cleanly, API and SPA route smokes passed, and `npm audit` reported `0 vulnerabilities`.

## Current state (after Session 14)
All core features remain working end-to-end on `main`, with the frontend refresh staged on `feat/frontend-refresh` for review.

**Alembic head**: `j9k0l1m2n3o4`

**Active routes:**
| Route | Description |
|---|---|
| `/blueprints` | Blueprint card grid |
| `/blueprints/:id` | Tabbed detail (Entries / Settings) |
| `/entries` | Global entries — FTS + field filter + blueprint chips + multi-select bulk delete |
| `/entries/:id` | Canonical entry detail with Fields/Raw/History tabs |
| `/blueprints/entries/:id` | Legacy entry detail route kept for compatibility |
| `/pybooks` | PyBook editor with refreshed layout and run console |
| `/workflows` | Workflow list |
| `/workflows/:id` | Workflow DAG editor |
| `/runs` | Unified PyBook + Workflow run history |
| `/automations` | All active triggers in one view |
| `/secrets` | Secret store |
| `/activity` | Audit log |
| `/settings` | System settings + self-update |
| `/users` | User management (admin) |

**Pending / backlog items:**
- `pylo_sdk` as a standalone pip-installable library with a `PyloClient` class
- Paginated API source fetching (#9)
- Scoped API keys (#6)
- Configuration backup & restore (#18)
- Re-parse entries on mapping change (#6b)

## Session 15 — Paginated Blueprint source fetching
- **Paginated API source fetching**: Blueprints now support `none`, `page_number`, `offset`, and `cursor` pagination modes.
- **Wrapped response support**: optional `pagination_items_path` JSONPath extracts item lists from envelopes such as `$.items` or `$.data.results`.
- **Cursor support**: optional `pagination_path` JSONPath extracts the next cursor token, with loop protection for empty/repeated cursors.
- **Safety cap**: `pagination_max_pages` defaults to 50 and is clamped to 500 in the fetch loop.
- **Fetch output**: manual/cron fetch results and activity details include `pages_fetched`.
- **Blueprint form**: added a Pagination section with type, parameter name, items path, next-cursor path, and max-pages controls.
- **Migration**: `l1m2n3o4p5q6` adds pagination config columns to `blueprint`.
- **Tests**: added focused coverage for wrapped item extraction, page-number pagination, and cursor pagination.

## Current state (after Session 15)
All core features remain working end-to-end, with frontend refresh and paginated fetching staged on `feat/frontend-refresh` for review.

**Alembic head**: `l1m2n3o4p5q6`

**Pending / backlog items:**
- `pylo_sdk` as a standalone pip-installable library with a `PyloClient` class
- Scoped API keys (#6)
- Configuration backup & restore (#18)
- Re-parse entries on mapping change (#6b)
- Entry update support in `pylo_sdk`
- Bulk PyBook dispatch from selected entries

## Session 16 — Blueprint entry retention limits
- **Per-blueprint retention controls**: added optional `max_entries` and `retention_days` settings.
- **Cleanup behavior**: after API fetches or manual entry creation, Pylo deletes expired entries and trims over-limit blueprints by removing the oldest entries first.
- **Index/event cleanup**: retention deletion removes FTS rows and entry history rows for deleted entries.
- **Fetch output**: fetch responses and activity details include `retention_deleted`.
- **Blueprint form**: added an Entry retention section.
- **Migration**: `m2n3o4p5q6r7` adds retention columns to `blueprint`.

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

## Current state
- All core features working end-to-end
- Blueprint card grid → tabbed detail (Entries / Settings)
- Global Entries page with FTS + field filter + blueprint chips + bulk delete
- PyBooks: create/edit/run/schedule/webhook/tags
- Persistent execution queue with live Runs page stats
- Secrets: create/list/delete with encryption
- Settings: live concurrency limit

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
- **Unique key field**: ★ selector in field mapping builder; `is_key` stored in mappings JSON; `_do_fetch` deduplicates by chosen field (not hardcoded `external_id`)
- **Cron auto-fetch**: `fetch_cron` + `fetch_is_active` on Blueprint; APScheduler syncs jobs on startup and after saves; migration added columns
- **Endpoint test + JSONPath picker**: `POST /api/blueprints/preview` endpoint; frontend JSON tree with click-to-fill path selection; hover-reveal path buttons

## Session 4 — Rename + manual blueprints
- Renamed throughout: `ObjectType` → `Blueprint`, `ObjectInstance` → `Entry`
- DB migration renames tables (`object_type→blueprint`, `object_instance→entry`, `fts_objects→fts_entries`)
- API routes: `/api/objects/*` → `/api/blueprints/*` and `/api/blueprints/entries/*`
- Added `is_manual: bool` on Blueprint; hides source/cron/fetch controls in UI
- Fixed JSONPath picker form-submit bug (`type="button"` missing)
- Old `/objects` URL redirects to `/blueprints`

## Session 5 — UX & auth
- **HelpTip component**: `(?)` hover tooltips on Blueprint form fields (source URL, headers, cron, key field, manual toggle)
- **ScheduleBuilder component**: human-friendly cron builder — interval mode (every N min/h/d) and scheduled mode (HH:MM + weekday chips, 24h); used in both Blueprint and PyBook forms
- **Authentication builder**: visual auth section in Blueprint form — Bearer Token / API Key / Basic Auth with secret picker dropdown; auth header merged into `source_headers` transparently
- **Secret resolution fix**: `_do_fetch` and `preview_endpoint` now correctly build `secrets_map` from DB and call `resolve_secret_templates` on raw JSON strings before parsing
- README fully rewritten

## Current state
- All core features working end-to-end
- Blueprints list and detail on single page (sidebar + panel layout)
- PyBooks: create/edit/run/schedule/webhook
- Secrets: create/list/delete with encryption
- Runs: history + live WebSocket logs

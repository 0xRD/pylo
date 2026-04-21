# Pylo — Feature Backlog

Items are ordered by priority. Do not implement until explicitly requested.

---

## 1. Object deduplication + mutability + history

**`external_id` key field** (partially done — ★ selector exists in UI):
- `_do_fetch` already reads `is_key` from field mappings. The `external_id` column stores the matched value.
- Next: mutable fields — mark fields as mutable in mapping config; on re-fetch update mutable fields on existing entries instead of skipping.
- Add `ObjectInstanceEvent` audit table: `(id, entry_id, changed_by, pybook_id, changed_fields, previous_values, timestamp)`.
- SDK: `update_entry(entry_id, fields)`.

**Why:** Core SOAR use case — ingest XDR alerts, track lifecycle changes, let PyBooks close/update them.

---

## 2. Cross-type entry search + field query language

- Global search across all blueprints (remove `blueprint_id` filter from FTS query).
- Field-level query language: `os contains "Windows"`, `category = "Execute"`, combinable with `AND`/`OR`.
- Server-side filtering via SQLite `json_extract` on `parsed_fields` column.

**Why:** Users need to slice across all blueprints without switching views.

---

## 3. PyBook filtering + tags

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

## 7. Manual blueprint entry creation UI

- `is_manual` flag already exists on Blueprint model and is respected in fetch/cron logic.
- Missing: "Add entry" button on the Entries tab that opens a form with one input per mapped field.
- SDK: `get_blueprint_entries(blueprint_id, key_value=None)` for PyBook consumption.

**Why:** Manual blueprints (shared variables, rule toggles, allow/blocklists) are not usable without entry creation UI.

---

## 8. Contextual help tooltips ✅ DONE

Implemented via `HelpTip` component. Added to Blueprint form (source URL, headers, cron, key field, manual toggle).

---

## 9. Paginated API source fetching

- Per-Blueprint pagination config: `pagination_type` (none | cursor | page_number | offset), `pagination_param`, `pagination_path` (JSONPath to extract next cursor), `max_pages` safety limit (default 50).
- `_do_fetch` loops until empty response or no next cursor.
- UI: collapsible Pagination section in Blueprint form.

**Why:** Most APIs (GitHub, JIRA, SIEMs) page results — single-request fetch silently drops data.

---

## 9b. Clarify PyBook trigger event type

- Add `trigger_event` field on Blueprint: `on_create` | `on_update` | `on_create_or_update`.
- UI: PyBook selector + event dropdown side by side.
- Migration: add `trigger_event VARCHAR` column.

**Why:** Users can't build reliable SOAR workflows without knowing when the trigger fires.

---

## 10. Blueprint/Entry UI separation — two-route tabbed layout ✅ IN PROGRESS

- `/blueprints` → blueprint list/card grid.
- `/blueprints/:id` → tabbed detail: **Entries** tab (search, grid, Fetch now) + **Settings** tab (BlueprintForm, delete).
- `/blueprints/entries/:id` → entry detail (already exists).

**Why:** Blueprints (config) and entries (data) are separate concerns; the old sidebar layout mixed them.

---

## 11. Human-friendly schedule builder ✅ DONE

Implemented as `ScheduleBuilder` component. Used in Blueprint form and PyBook cron trigger. Two modes: interval (every N min/h/d) and scheduled (at HH:MM on selected weekdays). 24h format.

---

## 12. Console navigation improvements

- Pylo logo → `<Link to="/">` (home).
- Back buttons fall back to section root when no history.
- Breadcrumbs on detail pages.
- Form cancel uses `navigate(-1)`.

**Why:** No in-app navigation beyond browser back button.

---

## 13. Multi-select for entries

- Hover-reveal checkboxes on entry cards; select-all in toolbar.
- Bulk action bar: Delete selected (confirm), later Trigger PyBook on selected.

**Why:** Bulk cleanup after bad fetches; bulk playbook dispatch for SOAR.

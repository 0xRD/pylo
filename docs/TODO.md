# Pylo — Feature Backlog

Items are ordered by priority. This file tracks remaining product work only; completed historical items are listed at the end for traceability.

---

## 1. Scoped API keys

- Per-key permissions: `blueprints:read`, `entries:read`, `entries:write`, `pybooks:trigger`, `runs:read`.
- Keys stored hashed; raw value shown only at creation.
- Settings page: create/revoke keys, name, scopes, last-used timestamp.
- Middleware should accept scoped keys separately from the master `API_TOKEN`.

**Why:** Enables SIEM/script integrations without handing out the master token.

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

### 3b. Full backup & restore — partially implemented

Full snapshot of Pylo configuration exportable to a ZIP file or Git repository and re-importable for disaster recovery. Manual ZIP export/import is implemented; Git integration and encrypted secret backup remain pending.

**Backed up objects:**
- `blueprints/` — one JSON file per blueprint
- `pybooks/` — one JSON file per PyBook, script included
- `secrets/` — excluded by default; optionally encrypted with a user-supplied backup passphrase
- `settings.json`
- `manifest.json`

**Manual export/import:**
- Settings page "Download backup" button. ✅
- Secrets excluded from backup. ✅
- Optional encrypted secret backup with warning. Pending.
- Import ZIP with manifest validation. ✅
- Blocking confirmation requiring the user to type `RESTORE`. ✅

**Git integration:**
- Settings form for repository URL, branch, token, author.
- Manual "Push now".
- Optional debounced auto-push after config changes.
- Status line with last push or last error.

**Why:** A single VM failure or bad import can destroy weeks of blueprints and PyBooks.

---

## 4. Entry update support in `pylo_sdk`

- Add `update_entry(entry_id, fields)` helper.
- The helper should discover or accept `blueprint_id` because the API route is currently blueprint-scoped.
- Document mutable-field requirements and expected 403/400 failure modes.

**Why:** PyBooks need a clean way to update lifecycle fields such as status, owner, or verdict.

---

## 5. Dashboard and dense views ergonomics

- Rework the dashboard layout to feel less compressed on desktop.
- Add more breathing room, larger chart panels, and clearer visual hierarchy for high-priority metrics.
- Consider a collapsible or wider main content mode for operator pages such as Dashboard, PyBooks, Runs, and Entries.
- Improve PyBook run/development surfaces so payload, variables, logs, and recent runs are easier to scan without cramped side-by-side panels.
- Keep compact density available for power users, but avoid making the default view feel squeezed.

**Why:** The current Dracula refresh is functional, but operational views need more space and stronger hierarchy for long development/debugging sessions.


---

## Completed

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

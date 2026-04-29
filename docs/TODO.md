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

Full snapshot of Pylo configuration exportable to a ZIP file, re-importable for disaster recovery. Manual ZIP export/import is implemented; remaining work is encrypted secret backup/restore and a scheduled auto-backup.

**Manual export/import:**
- Settings page "Download backup" button. ✅
- Secrets excluded from backup. ✅
- Import ZIP with manifest validation. ✅
- Blocking confirmation requiring the user to type `RESTORE`. ✅

**Remaining:**
- Scheduled auto-backup (cron) with configurable retention.
- Optional encrypted secret inclusion with passphrase (avoid exposing decrypted values via API).

**Why:** A single VM failure or bad import can destroy weeks of blueprints and PyBooks.

---

### 3c. Git-based dev → prod promotion

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

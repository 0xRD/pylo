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

## 2. Re-parse existing entries when blueprint mappings change

- On `PUT /blueprints/:id` with changed `field_mappings`, re-parse existing entries using stored `raw_data`.
- Run as a background task.
- Surface progress and completion/failure state in the Blueprint detail view.
- Re-index FTS after each updated entry.

**Why:** Users iterate on mappings after ingestion; old entries otherwise show stale fields.

---

## 3. `pylo_sdk` standalone library

- Package `pylo_sdk` as a pip-installable library.
- Add a `PyloClient` class for external scripts:
  - configurable base URL and API key
  - `search_entries`, `get_entry`, `update_entry`
  - `run_pybook`, `get_run`, `wait_for_run`
- Keep the mounted container SDK backward compatible.
- Add minimal documentation and examples.

**Why:** External automation should not depend on copying the in-container helper file.

---

## 4. Configuration backup & restore

Full snapshot of Pylo configuration exportable to a ZIP file or Git repository and re-importable for disaster recovery.

**Backed up objects:**
- `blueprints/` — one JSON file per blueprint
- `pybooks/` — one JSON file per PyBook, script included
- `secrets/` — excluded by default; optionally encrypted with a user-supplied backup passphrase
- `settings.json`
- `manifest.json`

**Manual export/import:**
- Settings page "Download backup" button.
- Optional include-secrets checkbox with warning.
- Import ZIP with manifest validation.
- Blocking confirmation requiring the user to type `RESTORE`.

**Git integration:**
- Settings form for repository URL, branch, token, author.
- Manual "Push now".
- Optional debounced auto-push after config changes.
- Status line with last push or last error.

**Why:** A single VM failure or bad import can destroy weeks of blueprints and PyBooks.

---

## 5. Entry update support in `pylo_sdk`

- Add `update_entry(entry_id, fields)` helper.
- The helper should discover or accept `blueprint_id` because the API route is currently blueprint-scoped.
- Document mutable-field requirements and expected 403/400 failure modes.

**Why:** PyBooks need a clean way to update lifecycle fields such as status, owner, or verdict.

---

## 6. Bulk PyBook dispatch from selected entries

- Extend the global Entries multi-select toolbar.
- Admins can select a PyBook and trigger it once per selected entry.
- Payload shape should match blueprint-triggered PyBooks:

```json
{
  "blueprint_id": "...",
  "entry_id": "...",
  "entry_data": {"field1": "value1"}
}
```

**Why:** Bulk cleanup exists now; bulk playbook dispatch is the natural SOAR companion action.

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

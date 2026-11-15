# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Container orchestration
- **The concurrency limit is now a true cap on containers.** A Workflow used to hold one slot while its nodes ran outside the limit, so loops and parallel branches could start up to twice the configured number of containers. Workflow orchestration now takes no slot and every node container takes one.
- **The limit can be raised beyond 20.** The 20 was only the Settings slider; the API stopped at 50 (the size of the worker thread pool). Both now follow `PYLO_MAX_CONCURRENT_RUNS_CEILING` (default 200), Settings has a number field next to the slider, and the database pool is sized for it.
- Large payloads (over 64 kB) are handed to the container as a read-only file instead of an environment variable, which the kernel limits to about 128 kB. `pylo.get_payload()` reads either. This affected Workflow loops over long lists.
- A missing script file (restored or moved storage) is rewritten from the database before the run. Docker used to create a root-owned directory in its place, which also blocked later saves.
- Runner images are removed when a PyBook's dependencies change or the PyBook is deleted (they accumulated forever), and are rebuilt when `PYLO_BASE_IMAGE` changes. A failed dependency build now shows pip's error in the run.
- The run loop waits on the container with one long-poll per second instead of four status calls, tolerates short Docker API hiccups instead of failing a healthy run, and closes its Docker connections.
- A job that crashes inside Pylo can no longer leave its run stuck as `pending`/`running`; workflow node runs interrupted by a restart are marked as failed.
- `pylo.call_sub_pybook()` is documented as what it does: it queues the other PyBook and does not wait.

### Added
- **Agent skill** in `skills/pylo`: instructions plus a dependency-free CLI (`pylo_cli.py`) so an LLM can create, test and run PyBooks and Workflows through the API.
- Workflows saved without canvas coordinates (API clients) get an automatic left-to-right layout, and the editor fits the whole graph in view when a workflow is opened.

### Changed
- The sidebar density toggle is now labelled "Layout: Comfortable / Compact" with a rows icon. The previous gauge icon and bare "Compact" label read like a load indicator.

### Security (audit)
- **Backup restore could overwrite application files.** A crafted backup ZIP with a PyBook id such as `../backend` made the restore write `main.py` outside PyBook storage (including over the backend's own entry point). Imported ids are now validated and regenerated, and storage paths refuse anything that is not a plain id.
- **The "allowlisted" network policy was not enforced** (it only added host aliases that broke DNS for the allowed hosts). Allowlisted PyBooks now run on an internal network and can only leave through an authenticated egress proxy that connects to their allowed hosts and refuses internal addresses.
- **PyBooks shared a network with Postgres.** All PyBook containers now run on dedicated networks (`runner_egress`, `runner_internal`) that reach the Pylo API but not the database or the Docker socket proxy.
- **Workflow nodes ignored the PyBook network policy** and always ran with full network access. They now keep the PyBook's policy.
- **GitOps accepted any git remote**, including `ext::` commands, local paths and option-like values, which let an admin run commands in the backend container. Remotes must be `https://`, `http://` or `ssh://`, branch names are validated, and git is restricted to those transports.
- **Sessions survived a password change.** Session cookies are now bound to the password they were issued with, so changing or resetting a password signs out every other session. Existing sessions must sign in again once after upgrading.
- The last active admin can no longer be deleted, demoted or disabled (instance lockout).
- Backup restore only applies known settings, with the same bounds as the settings API; a backup can no longer inject arbitrary setting rows. The encrypted GitOps token is no longer written to backups.
- PyBook network policy and allowed hosts are now part of exports, backups and GitOps sync. They were dropped before, so a restored or promoted PyBook silently fell back to open network access.
- GitOps sync can only set the fields Pylo exports (not `id` or other columns).
- `max_retries` is capped at 10; PyBook settings (dependencies, network policy, allowed hosts, trigger, cron) and Blueprint settings (cron, method, JSON fields, URL scheme) are validated on save; usernames and secret names are validated; export download file names are sanitised.

### Fixed
- **Timed-out PyBooks kept running forever.** The time limit only stopped the backend from waiting; the container was never killed. Containers are now killed and removed on timeout.
- **Output was lost on failure.** A failing script kept only stderr and a timeout kept nothing. Both streams are now stored in every case (capped at 1 MB each).
- **An invalid cron expression could stop the backend from starting** (backup schedule or Blueprint fetch schedule), as could a corrupt numeric setting. Schedules are validated on save and bad values are skipped at startup.
- New cron-triggered PyBooks and Blueprints were not scheduled until the next edit or restart; deleted ones kept their job. Imports and GitOps sync now reschedule too.
- **Search syntax shown in the UI did not work on Postgres**: `OR`, `NOT`, `"phrases"` and `prefix*` were treated as plain words. Field filters now support `starts_with`, `ends_with`, `>`, `>=`, `<`, `<=` as documented; `contains` is case-insensitive and treats `%`/`_` literally.
- Auto-backups and the GitOps working copy were stored inside the backend container and lost on every rebuild. `objects_storage/` is now a bind mount.
- `setup.sh` failed on macOS (`sed -i`), and on Linux hosts whose user is not UID 501 the backend could not write PyBook scripts. The backend now runs as the installing user on Linux.
- Deleting entries or a Blueprint left their history and search rows behind. Entries restored from a backup were not searchable.
- API errors in the UI were shown as raw JSON (`{"detail": ...}`).

### Added
- **Cancel running runs**: `DELETE /api/runs/{id}` now stops the container of a running run. New Cancel buttons in the PyBook run console and on the Runs page. Cancelling a Workflow run stops its executing nodes.
- **Live logs**: stdout/stderr are stored while a run is executing and the run console refreshes them.

### Performance
- Blueprint fetches look up existing entries in batches instead of one query per item, with a new `(blueprint_id, external_id)` index. Retention and bulk deletes use set-based statements instead of loading every entry.
- GitOps status/diff/commit/sync and image builds no longer block the API event loop (the GitOps status poll used to freeze every request during `git fetch`).
- The run WebSocket only sends a message when the run changed; a Workflow loop no longer starts an unbounded number of containers at once.

### Upgrade notes
- Run `bash setup.sh` (or `mkdir -p objects_storage && docker compose up -d --build`). Compose creates the two new PyBook networks; `DOCKER_NETWORK` in `.env` is no longer used.
- PyBooks using the "allowlisted" policy are now really restricted: add every host they need to their allowed hosts.

### Workflows
- Workflow node runs record the PyBook script version they executed. The run detail shows each node's label, PyBook and version.
- **Cancel** queued or running workflow runs from the editor or the Runs page (`POST /api/workflows/runs/{id}/cancel`). Nodes already executing finish; no further nodes start.
- **Webhook trigger now works**: `POST /api/webhooks/workflows/{id}` starts a workflow whose trigger type is `webhook`, with the JSON body as its payload. The editor shows the URL. New API-key scope `workflows:trigger` (also allows `POST /api/workflows/{id}/run`).
- Fixed: creating or editing a cron-triggered workflow (schedule, active flag, deletion) only took effect after a backend restart.
- Fixed: a PyBook run started by a workflow node stayed `queued` while executing, so a backend restart could re-run it as a standalone PyBook run.
- Fixed: a node whose PyBook was deleted failed without leaving a node-run record.
- Fixed: runs whose workflow was deleted, or whose definition was malformed, stayed `queued`/`running` forever. Create/update now reject malformed `nodes`/`edges`, unknown trigger types and invalid `trigger_config` (HTTP 422).
- Fixed: the editor polled a missing run forever. The editor run history is capped (`limit`, default 50).

### Added
- **PyBook script history** (GitLab-style): every save, restore, import or sync records a version with author, message and +/− line counts. A History panel shows the timeline; selecting a version opens a side-by-side or inline diff ("changes since the previous version" or "compare with editor") with one-click restore (restores are new versions, nothing is deleted). Each run records the script version it executed, linked from the run console. New endpoints: `GET /api/pybooks/{id}/versions`, `GET …/versions/{n}`, `POST …/versions/{n}/restore`.
- **PyBook editor**: optional change description on save, `Ctrl/Cmd+S` to save, `Ctrl/Cmd+Enter` to save and run with the current payload, a status bar (saved state, current version, cursor position), sticky scroll and bracket colouring, and a prompt before switching away from unsaved changes.

### Fixed
- The PyBook editor was editable in production mode and for viewers (only the Save button was hidden); it is now read-only there.
- The run console adapts to its own width, so logs stay readable when a side panel is open.

### Security
- Replaced `python-jose` (unpatched CVE; pulled in vulnerable `ecdsa`/`pyasn1`) with PyJWT, upgraded FastAPI/Starlette, DOMPurify and react-router. `pip-audit` and `npm audit --omit=dev` report no known vulnerabilities.
- The GitOps token is sent as an HTTP header via environment-only git config instead of being embedded in the remote URL, so it no longer appears in `.git/config`, process arguments, or git error messages. Existing remotes are cleaned on the next sync.
- The backend port is published on the host loopback only, so client-IP headers used by login throttling can no longer be spoofed by bypassing nginx. All containers run with `no-new-privileges`.
- nginx hides its version and forwards `X-Forwarded-For`/`X-Forwarded-Proto`. The backend warns at startup when production runs without secure cookies.

### Fixed
- GitOps could not work in the Docker image: the backend image did not include `git`.
- Restoring backups larger than 1 MB through the UI failed on nginx's default upload limit (now 200 MB).
- Requests for missing `/assets/*` files returned `index.html` instead of 404.

### Performance
- Run lists can omit stdout/stderr (`include_output=false`); the UI loads logs only for the selected run. `/api/pybooks/{id}/runs` is now limited (default 100) instead of returning every run.
- New indexes on run status/start time, workflow run start time, node-run lookups and entry creation time.
- nginx gzips text assets and caches content-hashed assets for a year, while `index.html` is always revalidated.

## [1.0.0] - Unreleased

First public release.

### Added
- **Blueprints**: REST API ingestion with authentication, pagination (cursor / page / offset), retries, fetch limits, on-fail PyBook triggers, retention, and cron auto-fetch.
- **Entries**: normalized records with deduplication, mutable fields, history, full-text search, a field query language, and bulk actions.
- **PyBooks**: Python scripts executed in ephemeral Docker containers, with payloads, output variables, selected secrets, per-PyBook network policy, and cron / webhook / Entry-event triggers.
- **Workflows**: visual DAG editor with condition and loop nodes, payload mappings, join barriers, validation, and manual runs with a JSON input payload.
- **Runs**: persistent queue with live logs, retries, dead-lettering, cancellation, live concurrency limits, orphan recovery, and configurable history retention.
- **Security**: users and roles, invitations, scoped API keys, Fernet-encrypted secrets with a dedicated key, SSRF guard for Blueprint fetches, and throttling for login, password change, and invitation endpoints.
- **Operations**: dashboard, activity log, per-object and full ZIP backup/restore (optionally including passphrase-encrypted secrets), scheduled backups, and GitOps dev → prod promotion.
- **Failure notifications**: an admin-configured webhook (Slack/Mattermost-compatible) receives a message when a PyBook or Workflow run finally fails, with a "Send test" button in Settings.
- `pylo-sdk` Python client (`PyloClient`) for external scripts.

### Fixed
- `setup.sh` now generates the mandatory `ENCRYPTION_KEY`. Fresh production installs previously refused to start. Existing `.env` files that lack one get it added.
- `.env.example` referenced a runner image tag (`latest`) that is never built.
- Frontend Docker builds no longer copy a host `node_modules` into the image.
- Workflow editor no longer gets stuck in a "running" state when a run request is rejected.
- Docker-dependent tests skip cleanly when no Docker daemon is available.

### Changed
- Backup secret encryption uses 600,000 PBKDF2 iterations. Older backups still restore.
- Frontend pages are code-split; the initial JS bundle shrank from ~4.1 MB to ~0.2 MB.
- Inactive workflows can no longer be run manually, matching PyBook behaviour.

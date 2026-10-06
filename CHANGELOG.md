# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

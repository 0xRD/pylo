# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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

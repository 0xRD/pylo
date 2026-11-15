# Roadmap

This page lists known limitations of Pylo V1 and the work planned after it. Contributions are welcome. Please open an issue to discuss larger items before starting.

## Known limitations

These are documented trade-offs in the current release. Deploy accordingly.

- **The `allowlisted` network policy only carries proxy-aware traffic.** Allowlisted PyBooks leave through Pylo's HTTP egress proxy, so HTTP(S) clients that honour `HTTPS_PROXY` (requests, httpx, urllib, curl) work and raw sockets or other protocols are blocked. HTTPS is tunnelled, not inspected, so the allowlist is checked against the host the PyBook asks the proxy for; a script could still reach another site served from the same address as an allowed host (domain fronting on shared CDNs). PyBook containers on the same runner network can reach each other while they run. Use `network_policy = "none"` for fully untrusted code.
- **Blueprint fetch SSRF guard is subject to DNS rebinding.** Hostnames are resolved and checked before the request, and every redirect hop is re-validated, but the HTTP client resolves the host again when it connects. Keep `PYLO_ALLOW_PRIVATE_FETCH=false` and restrict who can author Blueprints.
- **Scoped API keys are not per-resource.** `pybooks:trigger` can trigger any PyBook, and `entries:write` can write any Blueprint's Entries.
- **Run tokens may be passed as a WebSocket query parameter**, which can end up in proxy access logs. Prefer the cookie or header paths in front-end proxies.
- **Login throttling is in-memory.** It resets when the backend restarts and assumes a single backend process.

## Planned

- Pinning Blueprint fetch connections to the validated IP address.
- Per-resource scopes for API keys (specific PyBooks / Blueprints).
- Additional notification channels (email) and per-PyBook notification rules.
- Prometheus `/metrics` endpoint for queue depth, run outcomes, and fetch latency.
- Wider operator layout options for dense pages (Runs, Entries, PyBook console).
- Published `pylo-sdk` package on PyPI and versioned Docker images.

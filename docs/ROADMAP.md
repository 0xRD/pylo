# Roadmap

This page lists known limitations of Pylo V1 and the work planned after it. Contributions are welcome. Please open an issue to discuss larger items before starting.

## Known limitations

These are documented trade-offs in the current release. Deploy accordingly.

- **PyBook `allowlisted` network policy is DNS-level only.** It pins the allowed hostnames but does not firewall other egress from the runner container. Use `network_policy = "none"` for untrusted code, and put Pylo behind an egress proxy if you need enforced allowlisting.
- **Blueprint fetch SSRF guard is subject to DNS rebinding.** Hostnames are resolved and checked before the request, and every redirect hop is re-validated, but the HTTP client resolves the host again when it connects. Keep `PYLO_ALLOW_PRIVATE_FETCH=false` and restrict who can author Blueprints.
- **Scoped API keys are not per-resource.** `pybooks:trigger` can trigger any PyBook, and `entries:write` can write any Blueprint's Entries.
- **Run tokens may be passed as a WebSocket query parameter**, which can end up in proxy access logs. Prefer the cookie or header paths in front-end proxies.
- **Login throttling is in-memory.** It resets when the backend restarts and assumes a single backend process.
- **Build-time frontend tooling** (Tailwind CSS 3 and its file-watching dependencies) has open denial-of-service advisories. They affect only `npm run build`/`dev` on untrusted input, not the shipped app. Migrating to Tailwind 4 clears them.

## Planned

- Enforced egress allowlisting for PyBook containers (per-run network + egress proxy).
- Pinning Blueprint fetch connections to the validated IP address.
- Per-resource scopes for API keys (specific PyBooks / Blueprints).
- Additional notification channels (email) and per-PyBook notification rules.
- Prometheus `/metrics` endpoint for queue depth, run outcomes, and fetch latency.
- Wider operator layout options for dense pages (Runs, Entries, PyBook console).
- Published `pylo-sdk` package on PyPI and versioned Docker images.

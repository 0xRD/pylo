# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.x | Yes |
| < 1.0 | No |

Security fixes land on `main` and are released as patch versions of the latest 1.x release.

## Reporting a Vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/0xRD/pylo/security/advisories/new). Do not open a public issue for security problems.

You should receive an acknowledgement within a few days. Please give us reasonable time to release a fix before disclosing publicly.

Please include:

- affected Pylo version or commit
- deployment context when relevant
- clear reproduction steps
- expected impact
- whether secrets, API keys, authentication, container isolation, or Blueprint fetch controls are involved

Do not post live secrets, tokens, production data, or exploit payloads in public issues.

## Security Expectations

Pylo should never log or return decrypted secrets. API keys should be scoped when possible, stored hashed, and rotated if exposed. Docker and shell access to the host running Pylo should be treated as privileged access.

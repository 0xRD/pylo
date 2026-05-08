# Security Policy

## Supported Versions

Until the first tagged release, security fixes are handled on `main`. After V1 tags are published, supported versions should be documented here per release line.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, open a public issue without exploit details and request a private reporting channel.

Please include:

- affected Pylo version or commit
- deployment context when relevant
- clear reproduction steps
- expected impact
- whether secrets, API keys, authentication, container isolation, or Blueprint fetch controls are involved

Do not post live secrets, tokens, production data, or exploit payloads in public issues.

## Security Expectations

Pylo should never log or return decrypted secrets. API keys should be scoped when possible, stored hashed, and rotated if exposed. Docker and shell access to the host running Pylo should be treated as privileged access.

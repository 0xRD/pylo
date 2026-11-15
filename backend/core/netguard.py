"""Shared outbound-network guards (Blueprint fetches and the PyBook egress proxy)."""
import ipaddress


def is_blocked_ip(value: str) -> bool:
    """True for private, loopback, link-local, multicast, reserved and unspecified addresses."""
    ip = ipaddress.ip_address(value)
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:  # ::ffff:10.0.0.1 must be judged as 10.0.0.1
        ip = mapped
    return any([
        ip.is_private,
        ip.is_loopback,
        ip.is_link_local,
        ip.is_multicast,
        ip.is_reserved,
        ip.is_unspecified,
    ])


def normalize_host(host: str) -> str:
    return (host or "").strip().lower().rstrip(".")


def host_allowed(host: str, allowed_hosts: list[str]) -> bool:
    """Match ``host`` against an allowlist of hostnames or domains.

    ``example.com`` allows example.com and any subdomain; ``*.example.com`` is
    accepted as the same thing. Entries are hostnames only (no scheme or path).
    """
    host = normalize_host(host)
    if not host:
        return False
    for entry in allowed_hosts or []:
        if not isinstance(entry, str):
            continue
        entry = normalize_host(entry)
        if entry.startswith("*."):
            entry = entry[2:]
        if entry and (host == entry or host.endswith("." + entry)):
            return True
    return False

"""Egress proxy that enforces the PyBook "allowlisted" network policy.

Allowlisted PyBooks run on an internal Docker network with no route to the
outside. Their only way out is this HTTP proxy (set through HTTP(S)_PROXY in
the container). Each connection is authenticated with the run token, so the
proxy knows which PyBook is calling and only connects to that PyBook's
allowed hosts. Targets are resolved here and private/loopback addresses are
refused, so the proxy cannot be used to reach the database or other internal
services.
"""
import asyncio
import base64
import json
import logging
import socket
from urllib.parse import urlsplit

from backend.config import settings
from backend.core.netguard import host_allowed, is_blocked_ip, normalize_host

logger = logging.getLogger(__name__)

_MAX_HEAD_BYTES = 64 * 1024
_HEAD_TIMEOUT = 15
_CONNECT_TIMEOUT = 15
_server: asyncio.AbstractServer | None = None


def _allowed_hosts_for_token(token: str) -> tuple[str, list[str]] | None:
    """Return (pybook_id, allowed hosts) for a valid run token of an allowlisted PyBook."""
    from sqlmodel import Session

    from backend.core.auth import auth_user_from_run_token
    from backend.database import engine
    from backend.pybooks.models import PyBook

    runner = auth_user_from_run_token(token or "")
    if not runner:
        return None
    with Session(engine) as session:
        pb = session.get(PyBook, runner.pybook_id)
        if not pb or (pb.network_policy or "default") != "allowlisted":
            return None
        try:
            hosts = json.loads(pb.allowed_hosts or "[]")
        except ValueError:
            hosts = []
    return pb.id, [h for h in hosts if isinstance(h, str)] if isinstance(hosts, list) else []


def _proxy_token(headers: dict[str, str]) -> str:
    value = headers.get("proxy-authorization", "")
    scheme, _, encoded = value.partition(" ")
    if scheme.lower() != "basic" or not encoded:
        return ""
    try:
        decoded = base64.b64decode(encoded.strip()).decode("utf-8", errors="replace")
    except ValueError:
        return ""
    return decoded.partition(":")[2]


def _split_host_port(authority: str, default_port: int) -> tuple[str, int]:
    parsed = urlsplit(f"//{authority}")
    return parsed.hostname or "", parsed.port or default_port


async def _resolve_public(host: str, port: int) -> str | None:
    """Resolve ``host`` and return one address, or None if any address is internal."""
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        return None
    addresses = [info[4][0] for info in infos]
    if not addresses:
        return None
    if not settings.PYLO_ALLOW_PRIVATE_FETCH:
        for address in addresses:
            try:
                if is_blocked_ip(address):
                    return None
            except ValueError:
                return None
    return addresses[0]


async def _reply(writer: asyncio.StreamWriter, status: str, message: str) -> None:
    body = (message + "\n").encode()
    head = (
        f"HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\n"
        f"Content-Length: {len(body)}\r\nConnection: close\r\n"
    )
    if status.startswith("407"):
        head += 'Proxy-Authenticate: Basic realm="pylo-egress"\r\n'
    writer.write(head.encode() + b"\r\n" + body)
    try:
        await writer.drain()
    except ConnectionError:
        pass


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, limit: int | None = None) -> None:
    """Copy bytes until EOF, or at most ``limit`` bytes when a limit is given."""
    remaining = limit
    try:
        while remaining is None or remaining > 0:
            data = await reader.read(65536 if remaining is None else min(65536, remaining))
            if not data:
                break
            if remaining is not None:
                remaining -= len(data)
            writer.write(data)
            await writer.drain()
        if limit is not None:
            return  # request body sent; keep the upstream open for its response
    except (ConnectionError, asyncio.CancelledError):
        pass
    try:
        writer.close()
    except Exception:
        pass


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    upstream_writer = None
    try:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=_HEAD_TIMEOUT)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
            return
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) != 3:
            await _reply(writer, "400 Bad Request", "Malformed proxy request")
            return
        method, target, version = parts
        header_lines = [line for line in lines[1:] if line]
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in header_lines)}

        auth = await asyncio.to_thread(_allowed_hosts_for_token, _proxy_token(headers))
        if auth is None:
            await _reply(writer, "407 Proxy Authentication Required",
                         "Pylo egress proxy: a valid run token for an allowlisted PyBook is required")
            return
        pybook_id, allowed = auth

        body_length = None
        if method.upper() == "CONNECT":
            host, port = _split_host_port(target, 443)
            forward_head = None
        else:
            url = urlsplit(target)
            if url.scheme != "http" or not url.hostname:
                await _reply(writer, "400 Bad Request", "Pylo egress proxy only handles http:// and CONNECT requests")
                return
            host, port = url.hostname, url.port or 80
            path = url.path or "/"
            if url.query:
                path += f"?{url.query}"
            # Forward exactly one request to exactly the authorised host: the Host
            # header is rewritten (it must not name another site on the same
            # address), hop-by-hop proxy headers are dropped, and the body is
            # bounded so nothing can be pipelined behind it.
            if "transfer-encoding" in headers and "content-length" in headers:
                await _reply(writer, "400 Bad Request", "Ambiguous request framing")
                return
            try:
                body_length = int(headers["content-length"]) if "content-length" in headers else None
                if body_length is not None and body_length < 0:
                    raise ValueError
            except ValueError:
                await _reply(writer, "400 Bad Request", "Invalid Content-Length")
                return
            if body_length is None and "transfer-encoding" not in headers:
                body_length = 0
            kept = [line for line in header_lines
                    if not line.lower().startswith(("proxy-authorization:", "proxy-connection:", "connection:", "host:"))]
            default_port = url.port in (None, 80)
            host_header = url.hostname if default_port else f"{url.hostname}:{url.port}"
            forward_head = "\r\n".join(
                [f"{method} {path} {version}", f"Host: {host_header}", *kept, "Connection: close", "", ""]
            ).encode("latin-1")

        host = normalize_host(host)
        if not host_allowed(host, allowed):
            logger.info("Egress denied for PyBook %s: %s is not in its allowed hosts", pybook_id, host)
            await _reply(writer, "403 Forbidden",
                         f"Pylo egress proxy: host '{host}' is not in this PyBook's allowed hosts")
            return
        address = await _resolve_public(host, port)
        if address is None:
            logger.info("Egress denied for PyBook %s: %s does not resolve to a public address", pybook_id, host)
            await _reply(writer, "403 Forbidden",
                         f"Pylo egress proxy: host '{host}' does not resolve to a public address")
            return

        try:
            upstream_reader, upstream_writer = await asyncio.wait_for(
                asyncio.open_connection(address, port), timeout=_CONNECT_TIMEOUT
            )
        except (OSError, asyncio.TimeoutError):
            await _reply(writer, "502 Bad Gateway", f"Pylo egress proxy: could not connect to '{host}:{port}'")
            return

        if forward_head is None:
            writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
            await writer.drain()
        else:
            upstream_writer.write(forward_head)
            await upstream_writer.drain()

        await asyncio.gather(_pipe(reader, upstream_writer, body_length), _pipe(upstream_reader, writer))
    except Exception as exc:  # a broken client must never take the proxy down
        logger.debug("Egress proxy connection error: %s", exc)
    finally:
        for w in (upstream_writer, writer):
            if w is not None:
                try:
                    w.close()
                except Exception:
                    pass


async def start(host: str = "0.0.0.0", port: int | None = None) -> None:
    global _server
    from backend.core.runner import EGRESS_PROXY_PORT

    if _server is not None:
        return
    try:
        _server = await asyncio.start_server(_handle, host, port or EGRESS_PROXY_PORT, limit=_MAX_HEAD_BYTES)
        logger.info("PyBook egress proxy listening on %s:%s", host, port or EGRESS_PROXY_PORT)
    except OSError as exc:
        # Allowlisted PyBooks then have no way out, which fails closed.
        logger.error("Could not start the PyBook egress proxy: %s", exc)


def stop() -> None:
    global _server
    if _server is not None:
        _server.close()
        _server = None

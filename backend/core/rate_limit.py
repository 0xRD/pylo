"""In-process failed-attempt throttling for authentication endpoints.

Pylo runs a single backend process, so an in-memory sliding window is enough to
stop online brute force without adding a Redis dependency.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class FailureLimiter:
    def __init__(self, max_failures: int, window_seconds: int):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window_seconds:
            attempts.popleft()
        if not attempts:
            self._failures.pop(key, None)
        return attempts

    def retry_after(self, *keys: str) -> int:
        """Seconds until the most-throttled key may try again (0 = allowed)."""
        now = time.monotonic()
        wait = 0.0
        with self._lock:
            for key in keys:
                attempts = self._prune(key, now)
                if len(attempts) >= self.max_failures:
                    wait = max(wait, self.window_seconds - (now - attempts[0]))
        return int(wait) + 1 if wait else 0

    def check(self, *keys: str) -> None:
        wait = self.retry_after(*keys)
        if wait:
            raise HTTPException(
                status_code=429,
                detail="Too many failed attempts. Try again later.",
                headers={"Retry-After": str(wait)},
            )

    def fail(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._failures[key].append(now)

    def reset(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._failures.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()


# 10 failures per account or 30 per client IP within 15 minutes.
login_limiter = FailureLimiter(max_failures=10, window_seconds=900)
ip_limiter = FailureLimiter(max_failures=30, window_seconds=900)


def client_ip(request: Request) -> str:
    # nginx in front of the backend sets X-Real-IP; fall back to the socket peer.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")

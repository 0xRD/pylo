import json
import os
import time

import requests

# Runtime (in-container) configuration, injected by Pylo into every PyBook
# container. These default to empty strings so that the module can also be
# imported by external scripts that only use ``PyloClient`` (see the bottom of
# this file) without the container environment being present.
_api_url = os.environ.get("PYLO_API_URL", "")
_api_token = os.environ.get("PYLO_RUN_TOKEN") or os.environ.get("PYLO_API_TOKEN", "")
_headers = {"X-API-Token": _api_token}


def get_payload(default: dict = None) -> dict:
    """Return the JSON trigger payload injected into the PyBook container.

    Pylo stores run input in TRIGGER_PAYLOAD. Manual runs, selected Entry
    runs, webhooks, Blueprint triggers, and Workflow edge mappings all use
    this same JSON payload channel.
    """
    fallback = default if default is not None else {}
    raw = os.environ.get("TRIGGER_PAYLOAD", "")
    if not raw:
        return fallback
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return fallback
    return payload if isinstance(payload, dict) else {"value": payload}


def call_sub_pybook(sub_pybook_id: str, payload: dict = None) -> dict:
    """Trigger a sub-PyBook and wait for its result."""
    resp = requests.post(
        f"{_api_url}/api/pybooks/{sub_pybook_id}/run",
        json={"trigger_source": "sub_pybook", "trigger_payload": payload or {}},
        headers=_headers,
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()


def search_entries(query: str, type_id: str = None) -> list:
    """Full-text search on blueprint entries.

    The backend returns a paginated object, but PyBooks historically expect
    this helper to return the entry list directly.
    """
    params = {"q": query}
    if type_id:
        params["blueprint_id"] = type_id
    resp = requests.get(f"{_api_url}/api/blueprints/entries", params=params, headers=_headers)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    return data


def get_entry(object_id: str) -> dict:
    """Fetch a single entry by ID."""
    resp = requests.get(f"{_api_url}/api/blueprints/entries/{object_id}", headers=_headers)
    resp.raise_for_status()
    return resp.json()


def create_entry(blueprint_id: str, fields: dict) -> dict:
    """Create an entry in a manual or mutable Blueprint."""
    resp = requests.post(
        f"{_api_url}/api/blueprints/{blueprint_id}/entries",
        json={"fields": fields},
        headers=_headers,
    )
    resp.raise_for_status()
    return resp.json()


def update_entry(entry_id: str, fields: dict, blueprint_id: str = None) -> dict:
    """Update mutable fields on an entry.

    If blueprint_id is omitted, the helper fetches the entry first and uses
    its blueprint_id. The backend enforces Blueprint mutability rules.
    """
    bp_id = blueprint_id or get_entry(entry_id).get("blueprint_id")
    if not bp_id:
        raise ValueError("blueprint_id is required when it cannot be inferred from the entry")
    resp = requests.patch(
        f"{_api_url}/api/blueprints/{bp_id}/entries/{entry_id}",
        json={"fields": fields},
        headers=_headers,
    )
    resp.raise_for_status()
    return resp.json()


def delete_entry(entry_id: str) -> bool:
    """Delete an entry by ID."""
    resp = requests.delete(f"{_api_url}/api/blueprints/entries/{entry_id}", headers=_headers)
    resp.raise_for_status()
    return True


def set_output(key: str, value) -> None:
    """Export an output variable to downstream workflow nodes via payload mapping."""
    run_id = os.environ.get("PYLO_RUN_ID", "")
    if not run_id:
        return
    try:
        requests.post(
            f"{_api_url}/api/runs/{run_id}/output",
            json={key: value},
            headers=_headers,
            timeout=10,
        )
    except Exception:
        pass  # Non-fatal — output vars are best-effort


def export_vars(local_vars: dict, include: list = None, exclude: list = None) -> None:
    """Export multiple local variables as output vars in one call.

    Usage in your PyBook:
        result = 42
        alert_name = "CVE-2024-1234"
        pylo.export_vars(locals())

    Args:
        local_vars: Pass locals() to capture current scope.
        include:    If set, only export keys in this list.
        exclude:    Keys to skip (e.g. dunder vars, imports).
    """
    _skip = exclude or []
    _skip_defaults = {k for k in local_vars if k.startswith("_")}
    keys = include if include is not None else [
        k for k in local_vars
        if k not in _skip_defaults and k not in _skip
        and not callable(local_vars[k])
        and not hasattr(local_vars[k], "__module__")  # skip imported modules
    ]
    for k in keys:
        if k in local_vars:
            v = local_vars[k]
            try:
                import json as _j
                _j.dumps(v)  # only export JSON-serialisable values
            except (TypeError, ValueError):
                v = str(v)
            set_output(k, v)


# ---------------------------------------------------------------------------
# Standalone client
#
# Everything above this line is the helper API mounted into PyBook containers
# (imported as ``pylo``). The ``PyloClient`` below is for *external* scripts and
# is what ships as the pip-installable ``pylo-sdk`` package. It does not rely on
# the container environment: pass a base URL and API token explicitly.
# ---------------------------------------------------------------------------

TERMINAL_STATUSES = frozenset(
    {"success", "error", "timeout", "cancelled", "dead_letter"}
)


class PyloError(RuntimeError):
    """Raised when the Pylo API returns a non-2xx response."""

    def __init__(self, message, status_code=None, response=None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class RunResult(dict):
    """A PyBook run object with convenience accessors.

    Behaves like the raw JSON dict returned by the API, plus:
      - ``.status``   the run status string (shorthand for ``run["status"]``)
      - ``.outputs``  parsed ``output_vars`` (dict)
      - ``.ok``       True when the run finished successfully
      - ``.finished`` True when the run reached a terminal status
    """

    @property
    def status(self):
        return self.get("status")

    @property
    def outputs(self) -> dict:
        raw = self.get("output_vars")
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw or "{}")
        except (TypeError, ValueError):
            return {}

    @property
    def ok(self) -> bool:
        return self.get("status") == "success"

    @property
    def finished(self) -> bool:
        return self.get("status") in TERMINAL_STATUSES


class PyloClient:
    """Client for the Pylo REST API, for use from external scripts.

    Example::

        from pylo_sdk import PyloClient

        pylo = PyloClient("http://localhost:8000", "my-api-token")
        entries = pylo.search_entries("malware", blueprint_id="bp-123")
        run = pylo.run_pybook("pybook-abc", {"ip": "1.2.3.4"}, wait=True)
        print(run.status, run.outputs)

    Args:
        base_url:  Pylo backend URL, e.g. ``http://localhost:8000``. Falls back
                   to the ``PYLO_API_URL`` environment variable.
        api_token: API token sent as the ``X-API-Token`` header. Falls back to
                   the ``PYLO_API_TOKEN`` environment variable.
        timeout:   Default per-request timeout, in seconds.
        session:   Optional pre-configured ``requests.Session``.
    """

    def __init__(self, base_url=None, api_token=None, *, timeout=30.0, session=None):
        base_url = base_url or os.environ.get("PYLO_API_URL")
        if not base_url:
            raise ValueError("base_url is required (or set PYLO_API_URL)")
        api_token = api_token or os.environ.get("PYLO_API_TOKEN")
        if not api_token:
            raise ValueError("api_token is required (or set PYLO_API_TOKEN)")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.update({"X-API-Token": api_token})

    # -- low level -------------------------------------------------------
    def _request(self, method, path, **kwargs):
        kwargs.setdefault("timeout", self.timeout)
        resp = self.session.request(method, f"{self.base_url}{path}", **kwargs)
        if not resp.ok:
            raise PyloError(
                f"{method} {path} -> {resp.status_code}: {resp.text[:500]}",
                status_code=resp.status_code,
                response=resp,
            )
        content_type = resp.headers.get("Content-Type", "")
        if resp.content and "application/json" in content_type:
            return resp.json()
        return None

    # -- entries ---------------------------------------------------------
    def search_entries(self, query, blueprint_id=None, limit=None) -> list:
        """Full-text search across blueprint entries. Returns a list of entries."""
        params = {"q": query}
        if blueprint_id:
            params["blueprint_id"] = blueprint_id
        if limit is not None:
            params["limit"] = limit
        data = self._request("GET", "/api/blueprints/entries", params=params)
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return data["items"]
        return data or []

    def get_entry(self, entry_id) -> dict:
        """Fetch a single entry by ID."""
        return self._request("GET", f"/api/blueprints/entries/{entry_id}")

    def update_entry(self, entry_id, fields, blueprint_id=None) -> dict:
        """Update mutable fields on an entry.

        ``blueprint_id`` is inferred from the entry when omitted. The backend
        enforces the Blueprint's mutability rules.
        """
        bp_id = blueprint_id or (self.get_entry(entry_id) or {}).get("blueprint_id")
        if not bp_id:
            raise ValueError(
                "blueprint_id is required when it cannot be inferred from the entry"
            )
        return self._request(
            "PATCH",
            f"/api/blueprints/{bp_id}/entries/{entry_id}",
            json={"fields": fields},
        )

    # -- pybooks & runs --------------------------------------------------
    def run_pybook(self, pybook_id, payload=None, *, wait=False,
                   timeout=300.0, poll_interval=2.0) -> "RunResult":
        """Trigger a PyBook run.

        Returns the created run immediately, or — when ``wait=True`` — blocks
        until the run reaches a terminal status and returns the final run.
        """
        run = RunResult(
            self._request(
                "POST",
                f"/api/pybooks/{pybook_id}/run",
                json={"trigger_source": "api", "trigger_payload": payload or {}},
            )
        )
        if wait:
            return self.wait_for_run(
                run["id"], timeout=timeout, poll_interval=poll_interval
            )
        return run

    def get_run(self, run_id) -> "RunResult":
        """Fetch a run by ID."""
        return RunResult(self._request("GET", f"/api/runs/{run_id}"))

    def wait_for_run(self, run_id, *, timeout=300.0, poll_interval=2.0) -> "RunResult":
        """Poll a run until it reaches a terminal status.

        Raises ``TimeoutError`` if the run does not finish within ``timeout``.
        """
        deadline = time.monotonic() + timeout
        while True:
            run = self.get_run(run_id)
            if run.finished:
                return run
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"Run {run_id} did not finish within {timeout}s "
                    f"(status={run.get('status')!r})"
                )
            time.sleep(min(poll_interval, remaining))

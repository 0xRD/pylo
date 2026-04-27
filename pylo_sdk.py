import os
import requests

_api_url = os.environ["PYLO_API_URL"]
_headers = {"X-API-Token": os.environ["PYLO_API_TOKEN"]}


def call_sub_pybook(sub_pybook_id: str, payload: dict = {}) -> dict:
    """Trigger a sub-PyBook and wait for its result."""
    resp = requests.post(
        f"{_api_url}/api/pybooks/{sub_pybook_id}/run",
        json={"trigger_source": "sub_pybook", "trigger_payload": payload},
        headers=_headers,
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()


def search_entries(query: str, type_id: str = None) -> list:
    """Full-text search on blueprint entries."""
    params = {"q": query}
    if type_id:
        params["blueprint_id"] = type_id
    resp = requests.get(f"{_api_url}/api/blueprints/entries", params=params, headers=_headers)
    resp.raise_for_status()
    return resp.json()


def get_entry(object_id: str) -> dict:
    """Fetch a single entry by ID."""
    resp = requests.get(f"{_api_url}/api/blueprints/entries/{object_id}", headers=_headers)
    resp.raise_for_status()
    return resp.json()


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

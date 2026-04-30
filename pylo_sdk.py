import json
import os
import requests

_api_url = os.environ["PYLO_API_URL"]
_api_token = os.environ.get("PYLO_RUN_TOKEN") or os.environ["PYLO_API_TOKEN"]
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

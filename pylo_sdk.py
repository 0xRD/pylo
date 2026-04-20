import os
import requests

_api_url = os.environ["PYLO_API_URL"]
_headers = {"Authorization": f"Bearer {os.environ['PYLO_API_TOKEN']}"}


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

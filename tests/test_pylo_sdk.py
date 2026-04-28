import importlib
import sys


class DummyResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def load_sdk(monkeypatch):
    monkeypatch.setenv("PYLO_API_URL", "http://backend:8000")
    monkeypatch.setenv("PYLO_API_TOKEN", "test-token")
    sys.modules.pop("pylo_sdk", None)
    return importlib.import_module("pylo_sdk")


def test_search_entries_unwraps_paginated_response(monkeypatch):
    sdk = load_sdk(monkeypatch)
    entries = [{"id": "entry-1"}, {"id": "entry-2"}]

    def fake_get(url, params, headers):
        assert url == "http://backend:8000/api/blueprints/entries"
        assert params == {"q": "", "blueprint_id": "bp-1"}
        assert headers == {"X-API-Token": "test-token"}
        return DummyResponse({"items": entries, "total": 2})

    monkeypatch.setattr(sdk.requests, "get", fake_get)

    assert sdk.search_entries("", type_id="bp-1") == entries


def test_search_entries_preserves_legacy_list_response(monkeypatch):
    sdk = load_sdk(monkeypatch)
    entries = [{"id": "entry-1"}]

    monkeypatch.setattr(
        sdk.requests,
        "get",
        lambda url, params, headers: DummyResponse(entries),
    )

    assert sdk.search_entries("hash") == entries

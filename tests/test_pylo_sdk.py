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


def test_get_payload_reads_trigger_payload(monkeypatch):
    sdk = load_sdk(monkeypatch)
    monkeypatch.setenv("TRIGGER_PAYLOAD", '{"entry_id":"entry-1","entry_data":{"hash":"abc"}}')

    assert sdk.get_payload() == {"entry_id": "entry-1", "entry_data": {"hash": "abc"}}


def test_get_payload_handles_missing_or_non_object_payload(monkeypatch):
    sdk = load_sdk(monkeypatch)
    monkeypatch.delenv("TRIGGER_PAYLOAD", raising=False)
    assert sdk.get_payload({"mode": "manual"}) == {"mode": "manual"}

    monkeypatch.setenv("TRIGGER_PAYLOAD", '["a", "b"]')
    assert sdk.get_payload() == {"value": ["a", "b"]}

    monkeypatch.setenv("TRIGGER_PAYLOAD", 'not-json')
    assert sdk.get_payload() == {}

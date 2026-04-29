import importlib
import sys


class DummyResponse:
    def __init__(self, payload=None):
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


def test_create_entry_posts_fields(monkeypatch):
    sdk = load_sdk(monkeypatch)

    def fake_post(url, json, headers):
        assert url == "http://backend:8000/api/blueprints/bp-1/entries"
        assert json == {"fields": {"hash": "abc"}}
        assert headers == {"X-API-Token": "test-token"}
        return DummyResponse({"id": "entry-1", "data": "{}"})

    monkeypatch.setattr(sdk.requests, "post", fake_post)

    assert sdk.create_entry("bp-1", {"hash": "abc"})["id"] == "entry-1"


def test_update_entry_can_infer_blueprint_id(monkeypatch):
    sdk = load_sdk(monkeypatch)
    calls = []

    def fake_get(url, headers):
        calls.append(("get", url))
        return DummyResponse({"id": "entry-1", "blueprint_id": "bp-1"})

    def fake_patch(url, json, headers):
        calls.append(("patch", url, json))
        assert json == {"fields": {"status": "sent"}}
        return DummyResponse({"id": "entry-1", "data": '{"status":"sent"}'})

    monkeypatch.setattr(sdk.requests, "get", fake_get)
    monkeypatch.setattr(sdk.requests, "patch", fake_patch)

    assert sdk.update_entry("entry-1", {"status": "sent"})["id"] == "entry-1"
    assert calls[0] == ("get", "http://backend:8000/api/blueprints/entries/entry-1")
    assert calls[1][0:2] == ("patch", "http://backend:8000/api/blueprints/bp-1/entries/entry-1")


def test_delete_entry_returns_true(monkeypatch):
    sdk = load_sdk(monkeypatch)

    def fake_delete(url, headers):
        assert url == "http://backend:8000/api/blueprints/entries/entry-1"
        assert headers == {"X-API-Token": "test-token"}
        return DummyResponse()

    monkeypatch.setattr(sdk.requests, "delete", fake_delete)

    assert sdk.delete_entry("entry-1") is True

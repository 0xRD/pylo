"""Tests for the standalone PyloClient in pylo_sdk.

These use a fake requests.Session injected into the client, so no live backend
is required.
"""

import importlib
import sys

import pytest


def load_sdk():
    # PyloClient does not need the container env, but clear it so we exercise
    # the explicit-argument path.
    sys.modules.pop("pylo_sdk", None)
    return importlib.import_module("pylo_sdk")


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text="", is_json=True):
        self.status_code = status_code
        self._json = json_data
        self.text = text
        self.headers = {"Content-Type": "application/json"} if is_json else {}
        # `content` is truthy when there is a body to parse.
        self.content = b"{}" if json_data is not None else (text.encode() if text else b"")

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        return self._json


class FakeSession:
    """Records requests and returns queued responses (list) or a callable."""

    def __init__(self, responses):
        self.headers = {}
        self.calls = []
        self._responses = responses

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if callable(self._responses):
            return self._responses(method, url, kwargs)
        return self._responses.pop(0)


def make_client(sdk, responses):
    session = FakeSession(responses)
    client = sdk.PyloClient("http://backend:8000/", "test-token", session=session)
    return client, session


def test_requires_base_url_and_token():
    sdk = load_sdk()
    with pytest.raises(ValueError):
        sdk.PyloClient(base_url=None, api_token="t")
    with pytest.raises(ValueError):
        sdk.PyloClient(base_url="http://x", api_token=None)


def test_sets_auth_header_and_strips_trailing_slash():
    sdk = load_sdk()
    client, session = make_client(sdk, [])
    assert client.base_url == "http://backend:8000"
    assert session.headers["X-API-Token"] == "test-token"


def test_search_entries_unwraps_paginated_response():
    sdk = load_sdk()
    entries = [{"id": "e1"}, {"id": "e2"}]
    client, session = make_client(
        sdk, [FakeResponse(json_data={"items": entries, "total": 2})]
    )
    result = client.search_entries("malware", blueprint_id="bp-1", limit=10)
    assert result == entries
    call = session.calls[0]
    assert call["method"] == "GET"
    assert call["url"] == "http://backend:8000/api/blueprints/entries"
    assert call["params"] == {"q": "malware", "blueprint_id": "bp-1", "limit": 10}


def test_search_entries_returns_plain_list():
    sdk = load_sdk()
    entries = [{"id": "e1"}]
    client, _ = make_client(sdk, [FakeResponse(json_data=entries)])
    assert client.search_entries("x") == entries


def test_get_entry():
    sdk = load_sdk()
    client, session = make_client(sdk, [FakeResponse(json_data={"id": "e1"})])
    assert client.get_entry("e1") == {"id": "e1"}
    assert session.calls[0]["url"] == "http://backend:8000/api/blueprints/entries/e1"


def test_update_entry_infers_blueprint_id():
    sdk = load_sdk()
    client, session = make_client(
        sdk,
        [
            FakeResponse(json_data={"id": "e1", "blueprint_id": "bp-9"}),  # get_entry
            FakeResponse(json_data={"id": "e1", "updated": True}),  # patch
        ],
    )
    result = client.update_entry("e1", {"status": "done"})
    assert result == {"id": "e1", "updated": True}
    patch_call = session.calls[1]
    assert patch_call["method"] == "PATCH"
    assert patch_call["url"] == "http://backend:8000/api/blueprints/bp-9/entries/e1"
    assert patch_call["json"] == {"fields": {"status": "done"}}


def test_update_entry_uses_explicit_blueprint_id_without_lookup():
    sdk = load_sdk()
    client, session = make_client(sdk, [FakeResponse(json_data={"ok": True})])
    client.update_entry("e1", {"a": 1}, blueprint_id="bp-x")
    # Only the PATCH should have been issued (no get_entry lookup).
    assert len(session.calls) == 1
    assert session.calls[0]["method"] == "PATCH"


def test_run_pybook_returns_run_result():
    sdk = load_sdk()
    client, session = make_client(
        sdk, [FakeResponse(json_data={"id": "run-1", "status": "queued"})]
    )
    run = client.run_pybook("pb-1", {"ip": "1.2.3.4"})
    assert isinstance(run, sdk.RunResult)
    assert run["id"] == "run-1"
    post = session.calls[0]
    assert post["method"] == "POST"
    assert post["url"] == "http://backend:8000/api/pybooks/pb-1/run"
    assert post["json"] == {"trigger_source": "api", "trigger_payload": {"ip": "1.2.3.4"}}


def test_wait_for_run_polls_until_terminal():
    sdk = load_sdk()
    client, _ = make_client(
        sdk,
        [
            FakeResponse(json_data={"id": "run-1", "status": "running"}),
            FakeResponse(json_data={"id": "run-1", "status": "running"}),
            FakeResponse(
                json_data={"id": "run-1", "status": "success", "output_vars": '{"n": 42}'}
            ),
        ],
    )
    run = client.wait_for_run("run-1", poll_interval=0)
    assert run.ok is True
    assert run.finished is True
    assert run.outputs == {"n": 42}


def test_run_pybook_wait_returns_final_run():
    sdk = load_sdk()
    client, _ = make_client(
        sdk,
        [
            FakeResponse(json_data={"id": "run-1", "status": "queued"}),  # run_pybook
            FakeResponse(json_data={"id": "run-1", "status": "error"}),  # wait poll
        ],
    )
    run = client.run_pybook("pb-1", wait=True, poll_interval=0)
    assert run["status"] == "error"
    assert run.ok is False
    assert run.finished is True


def test_wait_for_run_times_out():
    sdk = load_sdk()
    client, _ = make_client(
        sdk, lambda m, u, k: FakeResponse(json_data={"id": "run-1", "status": "running"})
    )
    with pytest.raises(TimeoutError):
        client.wait_for_run("run-1", timeout=0, poll_interval=0)


def test_error_response_raises_pylo_error():
    sdk = load_sdk()
    client, _ = make_client(
        sdk, [FakeResponse(status_code=404, text="Not found", is_json=False)]
    )
    with pytest.raises(sdk.PyloError) as exc_info:
        client.get_entry("missing")
    assert exc_info.value.status_code == 404


def test_run_result_outputs_handles_bad_json():
    sdk = load_sdk()
    run = sdk.RunResult({"status": "success", "output_vars": "not-json"})
    assert run.outputs == {}
    run2 = sdk.RunResult({"status": "success", "output_vars": {"already": "dict"}})
    assert run2.outputs == {"already": "dict"}


def test_run_result_status_accessor():
    sdk = load_sdk()
    run = sdk.RunResult({"id": "r1", "status": "running"})
    assert run.status == "running"
    assert run.finished is False
    assert sdk.RunResult({}).status is None

import httpx
import pytest
import respx

from backend.api.blueprints import PreviewRequest, _build_auto_mappings, _extract_fetch_items, _fetch_raw_pages, _infer_items_path, preview_endpoint
from backend.objects.models import Blueprint


def test_extract_fetch_items_from_wrapped_response():
    raw = {"items": [{"id": "a"}, {"id": "b"}], "next": "two"}
    assert _extract_fetch_items(raw, "$.items") == [{"id": "a"}, {"id": "b"}]


def test_infer_items_path_prefers_common_wrapped_list_keys():
    raw = {
        "success": True,
        "count": 2,
        "data": [
            {"applicationId": "a", "name": "App A"},
            {"applicationId": "b", "name": "App B"},
        ],
    }

    assert _infer_items_path(raw) == "$.data"


def test_build_auto_mappings_marks_application_id_as_key():
    mappings = _build_auto_mappings({
        "id": "1",
        "name": "PERFECTDATA SOFTWARE",
        "applicationId": "ff8d92dc-3d82-41d6-bcbd-b9174d163620",
        "isOfficial": False,
        "categories": ["bec", "exfiltration"],
    })

    assert {m["field_name"] for m in mappings} == {"id", "name", "applicationId", "isOfficial", "categories"}
    assert next(m for m in mappings if m["field_name"] == "applicationId")["is_key"] is True
    assert next(m for m in mappings if m["field_name"] == "isOfficial")["field_type"] == "boolean"
    assert next(m for m in mappings if m["field_name"] == "categories")["field_type"] == "string"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_raw_pages_with_page_number():
    route = respx.get(url__regex=r"https://api\.example\.test/items.*").mock(side_effect=[
        httpx.Response(200, json={"items": [{"id": "a"}]}),
        httpx.Response(200, json={"items": [{"id": "b"}]}),
        httpx.Response(200, json={"items": []}),
    ])
    bp = Blueprint(
        id="bp",
        name="Paged",
        source_url="https://api.example.test/items",
        pagination_type="page_number",
        pagination_param="page",
        pagination_items_path="$.items",
        pagination_max_pages=10,
    )

    items, pages = await _fetch_raw_pages(bp, {}, {})

    assert items == [{"id": "a"}, {"id": "b"}]
    assert pages == 3
    assert [str(call.request.url.params["page"]) for call in route.calls] == ["1", "2", "3"]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_raw_pages_with_cursor():
    route = respx.get(url__regex=r"https://api\.example\.test/items.*").mock(side_effect=[
        httpx.Response(200, json={"items": [{"id": "a"}], "next_cursor": "two"}),
        httpx.Response(200, json={"items": [{"id": "b"}], "next_cursor": None}),
    ])
    bp = Blueprint(
        id="bp",
        name="Cursor",
        source_url="https://api.example.test/items",
        pagination_type="cursor",
        pagination_param="cursor",
        pagination_path="$.next_cursor",
        pagination_items_path="$.items",
        pagination_max_pages=10,
    )

    items, pages = await _fetch_raw_pages(bp, {}, {})

    assert items == [{"id": "a"}, {"id": "b"}]
    assert pages == 2
    assert "cursor" not in route.calls[0].request.url.params
    assert route.calls[1].request.url.params["cursor"] == "two"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_raw_pages_stops_at_entry_limit():
    route = respx.get(url__regex=r"https://api\.example\.test/limited.*").mock(side_effect=[
        httpx.Response(200, json={"items": [{"id": "a"}, {"id": "b"}]}),
        httpx.Response(200, json={"items": [{"id": "c"}, {"id": "d"}]}),
    ])
    bp = Blueprint(
        id="bp-limit",
        name="Limited",
        source_url="https://api.example.test/limited",
        pagination_type="page_number",
        pagination_param="page",
        pagination_items_path="$.items",
        pagination_max_pages=10,
        fetch_entry_limit=3,
    )

    items, pages = await _fetch_raw_pages(bp, {}, {})

    assert items == [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    assert pages == 2
    assert len(route.calls) == 2

@pytest.mark.asyncio
@respx.mock
async def test_fetch_raw_pages_offset_stops_at_total_count():
    route = respx.get(url__regex=r"https://api\.example\.test/offset.*").mock(side_effect=[
        httpx.Response(200, json={"items": [{"id": "a"}, {"id": "b"}], "total": 3}),
        httpx.Response(200, json={"items": [{"id": "c"}], "total": 3}),
    ])
    bp = Blueprint(
        id="bp-offset-total",
        name="Offset Total",
        source_url="https://api.example.test/offset?limit=2",
        pagination_type="offset",
        pagination_param="offset",
        pagination_items_path="$.items",
        pagination_max_pages=10,
    )

    items, pages = await _fetch_raw_pages(bp, {}, {})

    assert items == [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    assert pages == 2
    assert [str(call.request.url.params["offset"]) for call in route.calls] == ["0", "2"]
    assert [str(call.request.url.params["limit"]) for call in route.calls] == ["2", "2"]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_raw_pages_stops_when_offset_api_repeats_page():
    route = respx.get(url__regex=r"https://api\.example\.test/repeat.*").mock(side_effect=[
        httpx.Response(200, json={"items": [{"id": "a"}]}),
        httpx.Response(200, json={"items": [{"id": "a"}]}),
    ])
    bp = Blueprint(
        id="bp-offset-repeat",
        name="Offset Repeat",
        source_url="https://api.example.test/repeat?limit=1",
        pagination_type="offset",
        pagination_param="offset",
        pagination_items_path="$.items",
        pagination_max_pages=10,
    )

    items, pages = await _fetch_raw_pages(bp, {}, {})

    assert items == [{"id": "a"}]
    assert pages == 2
    assert len(route.calls) == 2


@pytest.mark.asyncio
@respx.mock
async def test_preview_endpoint_uses_changed_source_url():
    first = respx.get("https://api.example.test/first").mock(return_value=httpx.Response(200, json={"items": [{"id": "first"}]}))
    second = respx.get("https://api.example.test/second").mock(return_value=httpx.Response(200, json={"items": [{"id": "second"}]}))

    first_result = await preview_endpoint(PreviewRequest(source_url="https://api.example.test/first", pagination_items_path="$.items"))
    second_result = await preview_endpoint(PreviewRequest(source_url="https://api.example.test/second", pagination_items_path="$.items"))

    assert first_result["sample"] == [{"id": "first"}]
    assert second_result["sample"] == [{"id": "second"}]
    assert len(first.calls) == 1
    assert len(second.calls) == 1

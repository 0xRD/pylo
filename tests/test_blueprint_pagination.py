import httpx
import pytest
import respx

from backend.api.blueprints import _build_auto_mappings, _extract_fetch_items, _fetch_raw_pages, _infer_items_path
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

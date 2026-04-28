import httpx
import pytest
import respx

from backend.api.blueprints import _extract_fetch_items, _fetch_raw_pages
from backend.objects.models import Blueprint


def test_extract_fetch_items_from_wrapped_response():
    raw = {"items": [{"id": "a"}, {"id": "b"}], "next": "two"}
    assert _extract_fetch_items(raw, "$.items") == [{"id": "a"}, {"id": "b"}]


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

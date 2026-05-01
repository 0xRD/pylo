import asyncio

import pytest

from backend.core import queue_manager


@pytest.fixture(autouse=True)
def reset_queue_limiter():
    queue_manager._current_limit = 0
    queue_manager._running_count = 0
    queue_manager._limit_condition = None
    yield
    queue_manager._current_limit = 0
    queue_manager._running_count = 0
    queue_manager._limit_condition = None


@pytest.mark.asyncio
async def test_update_limit_decrease_blocks_new_reservations():
    queue_manager._limit_condition = asyncio.Condition()
    queue_manager._current_limit = 20

    queue_manager.update_limit(5)

    for _ in range(5):
        await queue_manager._reserve_slot()

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue_manager._reserve_slot(), timeout=0.01)


@pytest.mark.asyncio
async def test_update_limit_increase_allows_more_reservations():
    queue_manager._limit_condition = asyncio.Condition()
    queue_manager._current_limit = 1

    await queue_manager._reserve_slot()
    queue_manager.update_limit(2)
    await asyncio.wait_for(queue_manager._reserve_slot(), timeout=0.05)

    assert queue_manager.get_stats()["running"] == 2


@pytest.mark.asyncio
async def test_decrease_while_active_waits_until_running_drops_below_limit():
    queue_manager._limit_condition = asyncio.Condition()
    queue_manager._current_limit = 3

    for _ in range(3):
        await queue_manager._reserve_slot()

    queue_manager.update_limit(1)
    await queue_manager._release_slot()
    await queue_manager._release_slot()

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(queue_manager._reserve_slot(), timeout=0.01)

    await queue_manager._release_slot()
    await asyncio.wait_for(queue_manager._reserve_slot(), timeout=0.05)
    assert queue_manager.get_stats()["running"] == 1

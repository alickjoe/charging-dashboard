"""Service layer for connection management."""

import asyncio
import time
import logging
from datetime import datetime, timezone
from typing import Dict

import asyncpg

from app.database import test_pool, create_pool_from_row, get_pool

logger = logging.getLogger(__name__)

# Maximum total time spent testing all connections when building the list.
LIST_TEST_TOTAL_TIMEOUT = 25


async def get_connection_list(pools: Dict[str, asyncpg.Pool]) -> list[dict]:
    """Build connection list with current status for each pool entry."""
    from app.sqlite_store import ConnectionStore

    rows = await ConnectionStore.list_all()

    async def _test_one(name: str) -> tuple[str, bool | None]:
        try:
            alive = await test_pool(pools, name)
            return name, alive
        except Exception as exc:
            logger.warning(f"Connection test failed for {name}: {exc}")
            return name, None

    # Test all connections concurrently with a total deadline
    try:
        async with asyncio.timeout(LIST_TEST_TOTAL_TIMEOUT):
            tasks = [asyncio.create_task(_test_one(row["name"])) for row in rows]
            gathered = await asyncio.gather(*tasks)
            results = dict(gathered)
    except TimeoutError:
        results = {}

    final: list[dict] = []
    for row in rows:
        name = row["name"]
        status = "disconnected"
        last_checked = None

        alive = results.get(name)
        if alive:
            status = "connected"
            last_checked = datetime.now(timezone.utc)

        final.append({
            "name": name,
            "label": row["label"],
            "type": "postgresql",
            "host": row["host"],
            "port": row["port"],
            "database": row["database"],
            "status": status,
            "last_checked": last_checked,
        })

    return final


async def test_single_connection(
    name: str, pools: Dict[str, asyncpg.Pool]
) -> dict:
    """Test a specific connection, return latency and status."""
    pool = pools.get(name)
    if pool is None:
        return {
            "name": name,
            "status": "error",
            "message": f"连接 '{name}' 不存在或未配置",
            "latency_ms": 0,
        }

    try:
        start = time.monotonic()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        latency = (time.monotonic() - start) * 1000
        return {
            "name": name,
            "status": "connected",
            "message": "连接成功",
            "latency_ms": round(latency, 2),
        }
    except Exception as e:
        logger.error(f"Connection test failed for {name}: {e}")
        return {
            "name": name,
            "status": "error",
            "message": f"连接失败: {str(e)}",
            "latency_ms": 0,
        }


async def test_temp_connection(params: dict) -> dict:
    """Test a connection with temporary parameters (not saved to store)."""
    try:
        start = time.monotonic()
        pool = await create_pool_from_row(params)
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            latency = (time.monotonic() - start) * 1000
            return {
                "status": "connected",
                "message": "连接成功",
                "latency_ms": round(latency, 2),
            }
        finally:
            await pool.close()
    except asyncio.TimeoutError:
        return {
            "status": "error",
            "message": "连接超时：无法在 10 秒内连接到数据库，请检查网络或主机地址",
            "latency_ms": 0,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"连接失败: {str(e)}".strip() or "连接失败",
            "latency_ms": 0,
        }

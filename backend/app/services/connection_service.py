"""Service layer for connection management."""

import asyncio
import time
import logging
from typing import Dict

import asyncpg

from app.database import create_pool_from_row

logger = logging.getLogger(__name__)


async def get_connection_list(pools: Dict[str, asyncpg.Pool]) -> list[dict]:
    """Build connection list without testing pools.

    Connection status is deliberately *not* tested here so that the page
    loads instantly.  Users can test individual connections on demand via
    the ``POST /{name}/test`` endpoint.
    """
    from app.sqlite_store import ConnectionStore

    rows = await ConnectionStore.list_all()

    return [
        {
            "name": row["name"],
            "label": row["label"],
            "type": "postgresql",
            "host": row["host"],
            "port": row["port"],
            "database": row["database"],
            "status": "unknown",
            "last_checked": None,
        }
        for row in rows
    ]


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

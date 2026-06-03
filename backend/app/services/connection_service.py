"""Service layer for connection management."""

import time
import logging
from datetime import datetime, timezone
from typing import Dict

import asyncpg

from app.config import AppConfig

logger = logging.getLogger(__name__)


async def get_connection_list(
    config: AppConfig, pools: Dict[str, asyncpg.Pool]
) -> list[dict]:
    """Build connection list with current status for each."""
    results = []

    for conn in config.connections:
        status = "disconnected"
        last_checked = None

        pool = pools.get(conn.name)
        if pool is not None:
            try:
                async with pool.acquire() as ac:
                    await ac.fetchval("SELECT 1")
                status = "connected"
            except Exception:
                status = "error"

        results.append({
            "name": conn.name,
            "label": conn.label,
            "type": conn.type,
            "host": conn.host,
            "port": conn.port,
            "database": conn.database,
            "status": status,
            "last_checked": datetime.now(timezone.utc) if status != "disconnected" else None,
        })

    return results


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

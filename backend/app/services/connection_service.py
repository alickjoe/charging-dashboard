"""Service layer for connection management."""

import asyncio
import time
import logging
import uuid
from typing import Dict

import asyncpg

from app.database import create_pool_from_row
from app.ws_tunnel import tunnel_manager

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
            "ssl_mode": row.get("ssl_mode", "prefer"),
            "pool_min": row.get("pool_min", 2),
            "pool_max": row.get("pool_max", 10),
            "pool_idle": row.get("pool_idle", 300),
            "query_timeout": row.get("query_timeout", 30),
            "tunnel_mode": bool(row.get("tunnel_mode")),
            "tunnel_path": row.get("tunnel_path") or "/pgwss",
            "tunnel_port": row.get("tunnel_port") or 443,
            "tunnel_auth_user": row.get("tunnel_auth_user"),
            "has_tunnel_auth": bool(row.get("tunnel_auth_password")),
        }
        for row in rows
    ]


async def test_single_connection(
    name: str, pools: Dict[str, asyncpg.Pool]
) -> dict:
    """Test a specific connection, return latency and status.

    If a live pool already exists it is tested directly; otherwise the
    stored credentials are used to attempt a fresh connection.
    """
    from app.sqlite_store import ConnectionStore

    pool = pools.get(name)
    if pool is not None:
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

    # No live pool — attempt a fresh connection with stored credentials
    row = await ConnectionStore.get_by_name(name)
    if row is None:
        return {
            "name": name,
            "status": "error",
            "message": f"连接 '{name}' 不存在或未配置",
            "latency_ms": 0,
        }

    params = ConnectionStore.decrypt_password(row)
    result = await test_temp_connection(params)
    result["name"] = name
    return result


async def test_temp_connection(params: dict) -> dict:
    """Test a connection with temporary parameters (not saved to store).

    Tunnelled params (``tunnel_mode``) go through an *ephemeral* local
    bridge that is torn down right after the test, so unsaved form values
    never disturb the persistent bridge of a same-named saved connection.
    """
    temp_key = None
    try:
        start = time.monotonic()
        if int(params.get("tunnel_mode") or 0):
            temp_key = f"temp-test-{uuid.uuid4().hex}"
            local_port = await tunnel_manager.ensure(
                temp_key,
                params["host"],
                int(params.get("tunnel_port") or 443),
                params.get("tunnel_path") or "/pgwss",
                params.get("tunnel_auth_user"),
                params.get("tunnel_auth_password"),
            )
            params = {
                **params,
                "host": "127.0.0.1",
                "port": local_port,
                "ssl_mode": "disable",
                "tunnel_mode": 0,
            }
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
            if temp_key:
                await tunnel_manager.stop(temp_key)
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

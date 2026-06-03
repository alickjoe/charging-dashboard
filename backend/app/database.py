"""Multi-database connection pool management using asyncpg."""

import logging
from typing import Dict

import asyncpg
from tenacity import retry, stop_after_attempt, wait_fixed

from app.config import AppConfig, ConnectionConfig

logger = logging.getLogger(__name__)


def _build_dsn(conn: ConnectionConfig) -> str:
    """Build a DSN string from connection config."""
    return (
        f"postgresql://{conn.username}:{conn.password}"
        f"@{conn.host}:{conn.port}/{conn.database}"
    )


async def _test_connection(pool: asyncpg.Pool) -> bool:
    """Quick test that a pool can execute a query."""
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:
        return False


@retry(stop=stop_after_attempt(3), wait=wait_fixed(2), reraise=True)
async def _create_single_pool(conn: ConnectionConfig) -> asyncpg.Pool:
    """Create a single connection pool with retry."""
    dsn = _build_dsn(conn)

    ssl_context = None
    if conn.ssl_mode in ("require", "prefer"):
        import ssl
        ssl_context = ssl.create_default_context()
        if conn.ssl_mode == "require":
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=conn.pool.min_size,
        max_size=conn.pool.max_size,
        command_timeout=conn.query_timeout,
        ssl=ssl_context,
    )
    return pool


async def create_pools(config: AppConfig) -> Dict[str, asyncpg.Pool]:
    """Create connection pools for all configured databases."""
    pools: Dict[str, asyncpg.Pool] = {}

    for conn in config.connections:
        try:
            pool = await _create_single_pool(conn)
            pools[conn.name] = pool
            logger.info(f"Connection pool created: {conn.name} -> {conn.host}:{conn.port}/{conn.database}")
        except Exception as e:
            logger.error(f"Failed to create pool for {conn.name}: {e}")
            pools[conn.name] = None  # Mark as failed

    return pools


async def close_pools(pools: Dict[str, asyncpg.Pool]) -> None:
    """Close all connection pools."""
    for name, pool in pools.items():
        if pool is not None:
            try:
                await pool.close()
                logger.info(f"Connection pool closed: {name}")
            except Exception as e:
                logger.error(f"Error closing pool {name}: {e}")


async def get_pool(pools: Dict[str, asyncpg.Pool], name: str) -> asyncpg.Pool:
    """Get a pool by name, raising ValueError if not found."""
    pool = pools.get(name)
    if pool is None:
        raise ValueError(f"Connection '{name}' not found or unavailable")
    return pool

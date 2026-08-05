"""Multi-database connection pool management using asyncpg."""

import asyncio
import logging
from typing import Dict
from urllib.parse import quote

import asyncpg

logger = logging.getLogger(__name__)

# Timeout (seconds) for establishing a single database connection.
# Prevents startup from hanging indefinitely when a host is unreachable.
CONNECTION_TIMEOUT = 10
POOL_TEST_TIMEOUT = 5


def _build_dsn(row: dict) -> str:
    """Build a DSN string from a connection row dict.

    Username and password are URL-encoded to handle special characters
    (e.g. ``?``, ``@``, ``%``, ``}``) that would otherwise break DSN parsing.
    """
    user = quote(row['username'], safe='')
    pwd = quote(row['password'], safe='')
    return (
        f"postgresql://{user}:{pwd}"
        f"@{row['host']}:{row['port']}/{row['database']}"
    )


def _get_ssl_context(ssl_mode: str):
    """Build SSL context from ssl_mode string."""
    if ssl_mode in ("require", "prefer", "allow"):
        import ssl
        ctx = ssl.create_default_context()
        if ssl_mode == "require":
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return False  # disable SSL


async def create_pool_from_row(row: dict) -> asyncpg.Pool:
    """Create a single connection pool from a row dict."""
    dsn = _build_dsn(row)
    ssl_context = _get_ssl_context(row.get("ssl_mode", "prefer"))

    pool = await asyncio.wait_for(
        asyncpg.create_pool(
            dsn=dsn,
            min_size=row.get("pool_min", 2),
            max_size=row.get("pool_max", 10),
            max_inactive_connection_lifetime=row.get("pool_idle", 300),
            command_timeout=row.get("query_timeout", 30),
            ssl=ssl_context,
        ),
        timeout=CONNECTION_TIMEOUT,
    )
    return pool


async def create_pools_from_rows(rows: list[dict]) -> Dict[str, asyncpg.Pool]:
    """Create connection pools for all configured databases concurrently."""
    pools: Dict[str, asyncpg.Pool] = {}

    async def _create_one(row: dict) -> None:
        name = row["name"]
        try:
            pool = await asyncio.wait_for(
                create_pool_from_row(row), timeout=CONNECTION_TIMEOUT
            )
            pools[name] = pool
            logger.info(
                f"Pool created: {name} -> {row['host']}:{row['port']}/{row['database']}"
            )
        except asyncio.TimeoutError:
            logger.error(
                f"Timeout creating pool for {name} "
                f"({row['host']}:{row['port']})"
            )
            pools[name] = None
        except Exception as e:
            logger.error(f"Failed to create pool for {name}: {e}")
            pools[name] = None

    await asyncio.gather(*(_create_one(row) for row in rows))
    return pools


async def destroy_pool(name: str, pools: Dict[str, asyncpg.Pool]) -> None:
    """Close and remove a pool by name."""
    pool = pools.pop(name, None)
    if pool is not None:
        try:
            await pool.close()
            logger.info(f"Pool destroyed: {name}")
        except Exception as e:
            logger.error(f"Error destroying pool {name}: {e}")


async def rebuild_pool(name: str, pools: Dict[str, asyncpg.Pool], row: dict) -> asyncpg.Pool:
    """Destroy existing pool and create a new one from updated config."""
    await destroy_pool(name, pools)
    pool = await create_pool_from_row(row)
    pools[name] = pool
    logger.info(f"Pool rebuilt: {name}")
    return pool


async def close_pools(pools: Dict[str, asyncpg.Pool]) -> None:
    """Close all connection pools."""
    for name, pool in list(pools.items()):
        if pool is not None:
            try:
                await pool.close()
                logger.info(f"Pool closed: {name}")
            except Exception as e:
                logger.error(f"Error closing pool {name}: {e}")


async def get_pool(pools: Dict[str, asyncpg.Pool], name: str) -> asyncpg.Pool:
    """Get a pool by name, raising ValueError if not found."""
    pool = pools.get(name)
    if pool is None:
        raise ValueError(f"Connection '{name}' not found or unavailable")
    return pool


async def test_pool(pools: Dict[str, asyncpg.Pool], name: str) -> bool:
    """Test that a pool is alive."""
    pool = pools.get(name)
    if pool is None:
        return False
    try:
        async with asyncio.timeout(POOL_TEST_TIMEOUT):
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        return True
    except Exception:
        return False

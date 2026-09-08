"""Multi-database connection pool management using asyncpg."""

import asyncio
import logging
from typing import Dict
from urllib.parse import quote

import asyncpg

from app.ws_tunnel import tunnel_manager

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
    """Build SSL context used for the SSL attempts of a connection.

    libpq's prefer/allow/require never verify certificates (only verify-ca /
    verify-full do), so every SSL attempt runs with verification disabled —
    otherwise self-signed VM/internal CAs would always fail.
    """
    if ssl_mode in ("require", "prefer", "allow"):
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return False  # disable SSL


def _ssl_attempt_order(ssl_mode: str) -> list:
    """SSL attempts to try, in order, approximating libpq semantics.

    asyncpg treats a passed SSL context as "SSL is mandatory", so prefer /
    allow need explicit fallback attempts:
      - prefer:  SSL first, fall back to plaintext
      - allow:   plaintext first, fall back to SSL
      - require: SSL only
      - disable (or unknown): plaintext only
    """
    return {
        "prefer": [True, False],
        "allow": [False, True],
        "require": [True],
    }.get(ssl_mode, [False])


async def create_pool_from_row(row: dict) -> asyncpg.Pool:
    """Create a single connection pool from a row dict.

    Rows with ``tunnel_mode`` set are routed through the in-process WSS
    bridge: asyncpg talks plaintext PostgreSQL to a loopback listener and the
    bridge carries the bytes inside a WebSocket session to the real host.
    ``ssl_mode`` is ignored for tunnelled connections (encryption is provided
    by the WSS transport itself).
    """
    connect_row = dict(row)
    if int(connect_row.get("tunnel_mode") or 0):
        local_port = await tunnel_manager.ensure(
            str(connect_row.get("name") or f"tunnel-{connect_row['host']}"),
            connect_row["host"],
            int(connect_row.get("tunnel_port") or 443),
            connect_row.get("tunnel_path") or "/pgwss",
            connect_row.get("tunnel_auth_user"),
            connect_row.get("tunnel_auth_password"),
        )
        connect_row["host"] = "127.0.0.1"
        connect_row["port"] = local_port
        connect_row["ssl_mode"] = "disable"

    dsn = _build_dsn(connect_row)
    ssl_mode = connect_row.get("ssl_mode", "prefer")

    last_error: Exception = RuntimeError("no connection attempt was made")
    for use_ssl in _ssl_attempt_order(ssl_mode):
        ssl_option = _get_ssl_context(ssl_mode) if use_ssl else False
        try:
            pool = await asyncio.wait_for(
                asyncpg.create_pool(
                    dsn=dsn,
                    min_size=row.get("pool_min", 2),
                    max_size=row.get("pool_max", 10),
                    max_inactive_connection_lifetime=row.get("pool_idle", 300),
                    command_timeout=row.get("query_timeout", 30),
                    ssl=ssl_option,
                ),
                timeout=CONNECTION_TIMEOUT,
            )
            return pool
        except Exception as e:  # noqa: BLE001 - surfaced to the API caller
            last_error = e
    raise last_error


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

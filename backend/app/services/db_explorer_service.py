"""Service layer for database exploration."""

import logging
from typing import Optional

import asyncpg

from app.database import get_pool

logger = logging.getLogger(__name__)


async def list_schemas(pools: dict, connection_name: str) -> list[str]:
    """List all non-system schemas in the database."""
    pool = await get_pool(pools, connection_name)
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
            ORDER BY schema_name
        """)
        return [r["schema_name"] for r in rows]


async def list_tables(
    pools: dict,
    connection_name: str,
    schema: str = "public",
) -> list[dict]:
    """List all tables in a schema with row count estimates."""
    pool = await get_pool(pools, connection_name)
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                t.table_name,
                t.table_schema AS schema,
                COALESCE(s.n_live_tup, 0)::bigint AS row_count_estimate,
                t.table_type
            FROM information_schema.tables t
            LEFT JOIN pg_stat_user_tables s
                ON s.schemaname = t.table_schema
                AND s.relname = t.table_name
            WHERE t.table_schema = $1
            ORDER BY t.table_name
        """, schema)
        return [dict(r) for r in rows]


async def list_columns(
    pools: dict,
    connection_name: str,
    table_name: str,
) -> list[dict]:
    """List columns for a table with primary key information."""
    pool = await get_pool(pools, connection_name)
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                c.column_name,
                c.data_type,
                c.is_nullable,
                COALESCE(
                    (SELECT true
                     FROM information_schema.key_column_usage kcu
                     JOIN information_schema.table_constraints tc
                       ON kcu.constraint_name = tc.constraint_name
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                       AND kcu.table_schema = c.table_schema
                       AND kcu.table_name = c.table_name
                       AND kcu.column_name = c.column_name),
                    false
                ) AS is_primary_key
            FROM information_schema.columns c
            WHERE c.table_name = $1
            ORDER BY c.ordinal_position
        """, table_name)
        return [dict(r) for r in rows]


async def fetch_table_data(
    pools: dict,
    connection_name: str,
    table_name: str,
    page: int = 1,
    page_size: int = 50,
    order_by: Optional[str] = None,
    order_dir: str = "asc",
    time_column: Optional[str] = None,
    time_from: Optional[str] = None,
    time_to: Optional[str] = None,
) -> dict:
    """Fetch paginated data from a table with optional time filtering."""
    pool = await get_pool(pools, connection_name)

    if page_size > 200:
        page_size = 200
    if page < 1:
        page = 1

    # Validate column existence via information_schema
    async with pool.acquire() as conn:
        valid_cols_rows = await conn.fetch("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1
        """, table_name)
        valid_columns = {r["column_name"] for r in valid_cols_rows}

        if not valid_columns:
            raise ValueError(f"Table '{table_name}' not found or has no columns")

        # Build safe column list
        all_columns = sorted(valid_columns)

        # Validate time column
        safe_time_col = None
        if time_column and time_column in valid_columns:
            safe_time_col = time_column

        # Build WHERE clause
        wheres = []
        params: list = []
        param_idx = 1

        if safe_time_col and time_from:
            wheres.append(f"\"{safe_time_col}\" >= ${param_idx}::timestamptz")
            params.append(time_from)
            param_idx += 1
        if safe_time_col and time_to:
            wheres.append(f"\"{safe_time_col}\" <= ${param_idx}::timestamptz")
            params.append(time_to)
            param_idx += 1

        where_clause = f"WHERE {' AND '.join(wheres)}" if wheres else ""

        # Count
        count_sql = f"SELECT COUNT(*) FROM \"{table_name}\" {where_clause}"
        total = await conn.fetchval(count_sql, *params)

        # Order by
        order_clause = ""
        if order_by and order_by in valid_columns:
            direction = "DESC" if order_dir.upper() == "DESC" else "ASC"
            order_clause = f"ORDER BY \"{order_by}\" {direction}"

        # Data query
        columns_str = ", ".join(f'"{c}"' for c in all_columns)
        offset = (page - 1) * page_size
        data_sql = (
            f"SELECT {columns_str} FROM \"{table_name}\" "
            f"{where_clause} {order_clause} "
            f"LIMIT {page_size} OFFSET {offset}"
        )
        rows = await conn.fetch(data_sql, *params)

        return {
            "page": page,
            "page_size": page_size,
            "total_rows": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "columns": all_columns,
            "rows": [list(r.values()) for r in rows],
        }

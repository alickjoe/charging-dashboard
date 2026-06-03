"""Service layer for chart data aggregation."""

import logging
from typing import Optional

from app.database import get_pool

logger = logging.getLogger(__name__)

ALLOWED_AGGREGATIONS = {"sum", "avg", "count", "none"}
ALLOWED_GROUP_BY = {
    "date_trunc_day": "day",
    "date_trunc_hour": "hour",
    "date_trunc_month": "month",
    "none": None,
}


async def fetch_chart_data(
    pools: dict,
    connection_name: str,
    table_name: str,
    x_column: str,
    y_column: str,
    aggregation: str = "sum",
    group_by: str = "date_trunc_day",
    time_from: Optional[str] = None,
    time_to: Optional[str] = None,
    limit: int = 100,
) -> dict:
    """Build and execute an aggregation query for chart data."""
    pool = await get_pool(pools, connection_name)

    # Validate inputs
    if aggregation not in ALLOWED_AGGREGATIONS:
        raise ValueError(f"Invalid aggregation: {aggregation}")
    if group_by not in ALLOWED_GROUP_BY:
        raise ValueError(f"Invalid group_by: {group_by}")

    async with pool.acquire() as conn:
        # Get valid columns from information_schema (whitelist)
        cols = await conn.fetch("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1
        """, table_name)
        valid_columns = {c["column_name"] for c in cols}

        if not valid_columns:
            raise ValueError(f"Table '{table_name}' not found")

        # Validate x_column and y_column
        if x_column not in valid_columns:
            raise ValueError(f"Column '{x_column}' not found in table '{table_name}'")
        if y_column not in valid_columns:
            raise ValueError(f"Column '{y_column}' not found in table '{table_name}'")

        # Build aggregation expression
        agg_expr: str
        if aggregation == "count":
            agg_expr = f"COUNT(\"{y_column}\")"
        elif aggregation == "avg":
            agg_expr = f"AVG(\"{y_column}\")"
        elif aggregation == "sum":
            agg_expr = f"SUM(\"{y_column}\")"
        else:  # none
            agg_expr = f"\"{y_column}\""

        agg_label = f"{y_column} ({aggregation.upper()})"

        # Build group expression
        trunc_unit = ALLOWED_GROUP_BY[group_by]
        if trunc_unit:
            group_expr = f"date_trunc('{trunc_unit}', \"{x_column}\")"
            select_x = f"{group_expr} AS x_val"
            group_clause = f"GROUP BY {group_expr}"
            order_clause = f"ORDER BY {group_expr}"
        else:
            select_x = f"\"{x_column}\" AS x_val"
            group_clause = f"GROUP BY \"{x_column}\""
            order_clause = f"ORDER BY \"{x_column}\""

        # Build WHERE
        wheres: list[str] = []
        params: list = []
        idx = 1

        if time_from:
            wheres.append(f"\"{x_column}\" >= ${idx}::timestamptz")
            params.append(time_from)
            idx += 1
        if time_to:
            wheres.append(f"\"{x_column}\" <= ${idx}::timestamptz")
            params.append(time_to)
            idx += 1

        where_clause = f"WHERE {' AND '.join(wheres)}" if wheres else ""

        sql = f"""
            SELECT {select_x}, {agg_expr} AS y_val
            FROM "{table_name}"
            {where_clause}
            {group_clause}
            {order_clause}
            LIMIT {limit}
        """

        rows = await conn.fetch(sql, *params)

        labels = [str(r["x_val"]) for r in rows]
        data_values = [float(r["y_val"] or 0) for r in rows]

        return {
            "labels": labels,
            "datasets": [
                {
                    "label": agg_label,
                    "data": data_values,
                }
            ],
        }

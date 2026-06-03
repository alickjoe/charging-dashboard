"""API routes for database exploration."""

from typing import Optional

from fastapi import APIRouter, Request, Query, HTTPException
from app.services.db_explorer_service import (
    list_schemas,
    list_tables,
    list_columns,
    fetch_table_data,
)

router = APIRouter(prefix="/api/v1/connections", tags=["databases"])


@router.get("/{name}/schemas")
async def get_schemas(name: str, request: Request):
    """List all schemas in a database connection."""
    try:
        schemas = await list_schemas(request.app.state.pools, name)
        return {"schemas": schemas}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/tables")
async def get_tables(
    name: str,
    request: Request,
    schema: str = Query("public"),
):
    """List all tables in a schema."""
    try:
        tables = await list_tables(request.app.state.pools, name, schema)
        return {"tables": tables}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/tables/{table_name}/columns")
async def get_columns(name: str, table_name: str, request: Request):
    """List columns for a table."""
    try:
        columns = await list_columns(request.app.state.pools, name, table_name)
        return {"columns": columns}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/tables/{table_name}/data")
async def get_table_data(
    name: str,
    table_name: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    order_by: Optional[str] = Query(None),
    order_dir: str = Query("asc"),
    time_column: Optional[str] = Query(None),
    time_from: Optional[str] = Query(None),
    time_to: Optional[str] = Query(None),
):
    """Get paginated data from a table with optional time filtering."""
    try:
        result = await fetch_table_data(
            pools=request.app.state.pools,
            connection_name=name,
            table_name=table_name,
            page=page,
            page_size=page_size,
            order_by=order_by,
            order_dir=order_dir,
            time_column=time_column,
            time_from=time_from,
            time_to=time_to,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

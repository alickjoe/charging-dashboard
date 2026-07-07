"""API routes for custom SQL query execution and saved queries."""

import time

from fastapi import APIRouter, Request, HTTPException

from app.database import get_pool
from app.services.sql_validator import validate_readonly_sql
from app.sqlite_store import SavedQueryStore
from app.schemas.custom_query import (
    ExecuteQueryRequest,
    ExecuteQueryResponse,
    SavedQueryCreate,
    SavedQueryUpdate,
    SavedQueryResponse,
)

router = APIRouter(prefix="/api/v1/connections", tags=["custom_query"])


@router.post("/{name}/query", response_model=ExecuteQueryResponse)
async def execute_query(name: str, body: ExecuteQueryRequest, request: Request):
    """Execute a custom read-only SQL query against a database connection."""
    # Validate SQL
    is_valid, result = validate_readonly_sql(body.sql)
    if not is_valid:
        raise HTTPException(status_code=400, detail=result)

    try:
        pool = await get_pool(request.app.state.pools, name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    sql_start = time.monotonic()

    try:
        async with pool.acquire() as conn:
            await conn.execute("SET TRANSACTION READ ONLY")
            rows = await conn.fetch(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL 执行失败: {str(e)}")

    exec_time = (time.monotonic() - sql_start) * 1000
    columns = list(rows[0].keys()) if rows else []

    return ExecuteQueryResponse(
        columns=columns,
        rows=[list(r.values()) for r in rows],
        execution_time_ms=round(exec_time, 2),
    )


@router.get("/{name}/queries", response_model=list[SavedQueryResponse])
async def list_saved_queries(name: str, request: Request):
    """List all saved queries for a connection."""
    rows = await SavedQueryStore.list_by_connection(name)
    return [SavedQueryResponse(**r) for r in rows]


@router.post("/{name}/queries", response_model=SavedQueryResponse, status_code=201)
async def create_saved_query(name: str, body: SavedQueryCreate, request: Request):
    """Create a new saved query for a connection."""
    try:
        row = await SavedQueryStore.create(
            connection_name=name,
            name=body.name,
            sql_text=body.sql_text,
        )
        return SavedQueryResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"创建失败: {str(e)}")


@router.put("/{name}/queries/{query_id}", response_model=SavedQueryResponse)
async def update_saved_query(
    name: str, query_id: int, body: SavedQueryUpdate, request: Request
):
    """Update an existing saved query."""
    row = await SavedQueryStore.update(
        id=query_id,
        name=body.name,
        sql_text=body.sql_text,
    )
    if not row:
        raise HTTPException(status_code=404, detail="查询不存在")
    return SavedQueryResponse(**row)


@router.delete("/{name}/queries/{query_id}", status_code=204)
async def delete_saved_query(name: str, query_id: int, request: Request):
    """Delete a saved query."""
    deleted = await SavedQueryStore.delete(query_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="查询不存在")

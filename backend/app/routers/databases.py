"""API routes for database exploration."""

from typing import Optional

from fastapi import APIRouter, Request, Query, HTTPException
from app.services.db_explorer_service import (
    list_schemas,
    list_tables,
    list_columns,
    fetch_table_data,
)
from app.sqlite_store import AnnotationStore
from app.schemas.annotation import AnnotationUpsert, AnnotationResponse

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
async def get_columns(name: str, table_name: str, request: Request, schema: str = Query("public")):
    """List columns for a table."""
    try:
        columns = await list_columns(request.app.state.pools, name, table_name, schema)
        return {"columns": columns}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/tables/{table_name}/data")
async def get_table_data(
    name: str,
    table_name: str,
    request: Request,
    schema: str = Query("public"),
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
            schema=schema,
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


# ─── Annotation CRUD ───────────────────────────────────────────────


@router.get("/{name}/annotations", response_model=list[AnnotationResponse])
async def get_annotations(name: str, request: Request):
    """Get all business annotations for a connection."""
    rows = await AnnotationStore.list_by_connection(name)
    return [AnnotationResponse(**r) for r in rows]


@router.put("/{name}/annotations", response_model=AnnotationResponse, status_code=201)
async def upsert_annotation(name: str, body: AnnotationUpsert, request: Request):
    """Create or update a business annotation for a table or column."""
    row = await AnnotationStore.upsert(
        connection_name=name,
        table_name=body.table_name,
        column_name=body.column_name,
        annotation=body.annotation,
    )
    return AnnotationResponse(**row)


@router.delete("/{name}/annotations", status_code=204)
async def delete_annotation(
    name: str,
    request: Request,
    table_name: str = Query(...),
    column_name: str | None = Query(None),
):
    """Delete a business annotation."""
    deleted = await AnnotationStore.delete(
        connection_name=name,
        table_name=table_name,
        column_name=column_name,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="注解不存在")

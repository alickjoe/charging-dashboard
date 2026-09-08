"""API routes for dynamic connection CRUD management."""

from fastapi import APIRouter, Request, HTTPException

from app.schemas.connection import (
    CreateConnectionRequest,
    UpdateConnectionRequest,
    ConnectionResponse,
)
from app.sqlite_store import ConnectionStore
from app.database import create_pool_from_row, rebuild_pool, destroy_pool
from app.ws_tunnel import tunnel_manager

router = APIRouter(prefix="/api/v1/connections", tags=["connections-crud"])


def _row_to_brief(row: dict) -> dict:
    return {
        "name": row["name"],
        "label": row["label"],
        "type": "postgresql",
        "host": row["host"],
        "port": row["port"],
        "database": row["database"],
        "status": "disconnected",
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


@router.post("", response_model=ConnectionResponse, status_code=201)
async def create_connection(body: CreateConnectionRequest, request: Request):
    """Create a new database connection and its pool."""
    existing = await ConnectionStore.get_by_name(body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"连接 '{body.name}' 已存在")

    data = body.model_dump()
    row = await ConnectionStore.create(data)
    row = ConnectionStore.decrypt_password(row)

    # Create pool
    try:
        pool = await create_pool_from_row(row)
        request.app.state.pools[body.name] = pool
    except Exception as e:
        await ConnectionStore.delete(body.name)
        await tunnel_manager.stop(body.name)
        raise HTTPException(status_code=400, detail=f"无法建立连接: {str(e)}")

    return _row_to_brief(row)


@router.put("/{name}", response_model=ConnectionResponse)
async def update_connection(name: str, body: UpdateConnectionRequest, request: Request):
    """Update a database connection config and rebuild its pool."""
    existing = await ConnectionStore.get_by_name(name)
    if not existing:
        raise HTTPException(status_code=404, detail=f"连接 '{name}' 不存在")

    # Empty strings are treated as "not provided" so that blank
    # username/password fields on the edit form keep the stored values.
    data = {k: v for k, v in body.model_dump().items() if v is not None and v != ""}
    if not data:
        raise HTTPException(status_code=400, detail="未提供任何更新字段")

    row = await ConnectionStore.update(name, data)
    if not row:
        raise HTTPException(status_code=404, detail=f"连接 '{name}' 不存在")
    row = ConnectionStore.decrypt_password(row)

    # Rebuild pool
    try:
        await rebuild_pool(name, request.app.state.pools, row)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法重建连接池: {str(e)}")

    # Tunnel turned off in this update → tear down the no-longer-used bridge
    if not row.get("tunnel_mode"):
        await tunnel_manager.stop(name)

    return _row_to_brief(row)


@router.delete("/{name}", status_code=204)
async def delete_connection(name: str, request: Request):
    """Delete a database connection and destroy its pool."""
    await destroy_pool(name, request.app.state.pools)
    deleted = await ConnectionStore.delete(name)
    await tunnel_manager.stop(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"连接 '{name}' 不存在")

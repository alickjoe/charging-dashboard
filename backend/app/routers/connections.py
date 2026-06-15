"""API routes for connection management."""

from fastapi import APIRouter, Request

from app.schemas.connection import (
    TestConnectionResponse,
    TestTempConnectionRequest,
)
from app.services.connection_service import (
    get_connection_list,
    test_single_connection,
    test_temp_connection,
)

router = APIRouter(prefix="/api/v1/connections", tags=["connections"])


@router.get("", response_model=dict)
async def list_connections(request: Request):
    """List all configured database connections with their status."""
    pools = request.app.state.pools
    connections = await get_connection_list(pools)
    return {"connections": connections}


@router.post("/{name}/test", response_model=TestConnectionResponse)
async def test_connection(name: str, request: Request):
    """Test a specific database connection."""
    pools = request.app.state.pools
    result = await test_single_connection(name, pools)
    return result


@router.post("/test", response_model=dict)
async def test_temp_connection_endpoint(body: TestTempConnectionRequest):
    """Test a database connection with temporary parameters (not saved)."""
    params = {
        "host": body.host,
        "port": body.port,
        "database": body.database,
        "username": body.username,
        "password": body.password,
        "ssl_mode": body.ssl_mode,
        "query_timeout": body.query_timeout,
        "pool_min": 1,
        "pool_max": 2,
    }
    return await test_temp_connection(params)

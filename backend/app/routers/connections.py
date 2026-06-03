"""API routes for connection management."""

from fastapi import APIRouter, Request

from app.schemas.connection import ConnectionResponse, TestConnectionResponse
from app.services.connection_service import get_connection_list, test_single_connection

router = APIRouter(prefix="/api/v1/connections", tags=["connections"])


@router.get("", response_model=dict)
async def list_connections(request: Request):
    """List all configured database connections with their status."""
    config = request.app.state.db_config
    pools = request.app.state.pools
    connections = await get_connection_list(config, pools)
    return {"connections": connections}


@router.post("/{name}/test", response_model=TestConnectionResponse)
async def test_connection(name: str, request: Request):
    """Test a specific database connection."""
    pools = request.app.state.pools
    result = await test_single_connection(name, pools)
    return result

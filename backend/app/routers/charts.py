"""API routes for chart data aggregation."""

from fastapi import APIRouter, Request, HTTPException, Query

from app.schemas.chart import ChartDataRequest, ChartDataResponse
from app.services.chart_service import fetch_chart_data

router = APIRouter(prefix="/api/v1/connections", tags=["charts"])


@router.post("/{name}/tables/{table_name}/chart-data", response_model=ChartDataResponse)
async def get_chart_data(
    name: str,
    table_name: str,
    request: Request,
    body: ChartDataRequest,
    schema: str = Query("public"),
):
    """Generate aggregated chart data from a table."""
    try:
        result = await fetch_chart_data(
            pools=request.app.state.pools,
            connection_name=name,
            table_name=table_name,
            schema=schema,
            x_column=body.x_column,
            y_column=body.y_column,
            aggregation=body.aggregation,
            group_by=body.group_by,
            time_from=body.time_from,
            time_to=body.time_to,
            limit=body.limit,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

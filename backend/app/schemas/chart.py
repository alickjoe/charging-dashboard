"""Pydantic schemas for chart data."""

from typing import Optional

from pydantic import BaseModel, Field


class ChartDataRequest(BaseModel):
    x_column: str
    y_column: str
    chart_type: str = "bar"  # "bar" | "line"
    aggregation: str = "sum"  # "sum" | "avg" | "count" | "none"
    group_by: str = "date_trunc_day"  # date_trunc_day | date_trunc_hour | date_trunc_month | none
    time_from: Optional[str] = None
    time_to: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=500)


class DatasetItem(BaseModel):
    label: str
    data: list[float]


class ChartDataResponse(BaseModel):
    labels: list[str]
    datasets: list[DatasetItem]

"""Pydantic schemas for database exploration."""

from typing import Any, Optional

from pydantic import BaseModel


class TableInfoResponse(BaseModel):
    table_name: str
    schema: str
    row_count_estimate: int
    table_type: str


class ColumnInfoResponse(BaseModel):
    column_name: str
    data_type: str
    is_nullable: str
    is_primary_key: bool


class TableDataResponse(BaseModel):
    page: int
    page_size: int
    total_rows: int
    total_pages: int
    columns: list[str]
    rows: list[list[Any]]

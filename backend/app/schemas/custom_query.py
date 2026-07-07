"""Pydantic schemas for custom SQL query execution and saved queries."""

from typing import Any

from pydantic import BaseModel


class ExecuteQueryRequest(BaseModel):
    sql: str


class ExecuteQueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    execution_time_ms: float


class SavedQueryCreate(BaseModel):
    name: str
    sql_text: str


class SavedQueryUpdate(BaseModel):
    name: str
    sql_text: str


class SavedQueryResponse(BaseModel):
    id: int
    connection_name: str
    name: str
    sql_text: str
    created_at: str
    updated_at: str

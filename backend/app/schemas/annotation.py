"""Pydantic schemas for business annotations."""

from typing import Optional

from pydantic import BaseModel


class AnnotationUpsert(BaseModel):
    table_name: str
    column_name: Optional[str] = None
    annotation: str = ""


class AnnotationResponse(BaseModel):
    id: int
    connection_name: str
    table_name: str
    column_name: Optional[str] = None
    annotation: str
    created_at: str
    updated_at: str

"""Pydantic schemas for connection management."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ConnectionResponse(BaseModel):
    name: str
    label: str
    type: str = "postgresql"
    host: str
    port: int
    database: str
    status: str  # "connected" | "disconnected" | "error"
    last_checked: Optional[datetime] = None
    ssl_mode: str = "prefer"
    pool_min: int = 2
    pool_max: int = 10
    pool_idle: int = 300
    query_timeout: int = 30


class TestConnectionResponse(BaseModel):
    name: str
    status: str  # "connected" | "error"
    message: str
    latency_ms: float


class CreateConnectionRequest(BaseModel):
    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    host: str = Field(min_length=1)
    port: int = 5432
    database: str = Field(min_length=1)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    ssl_mode: str = "prefer"
    pool_min: int = Field(default=2, ge=1, le=50)
    pool_max: int = Field(default=10, ge=1, le=100)
    pool_idle: int = Field(default=300, ge=10)
    query_timeout: int = Field(default=30, ge=1, le=300)


class UpdateConnectionRequest(BaseModel):
    label: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_mode: Optional[str] = None
    pool_min: Optional[int] = Field(default=None, ge=1, le=50)
    pool_max: Optional[int] = Field(default=None, ge=1, le=100)
    pool_idle: Optional[int] = Field(default=None, ge=10)
    query_timeout: Optional[int] = Field(default=None, ge=1, le=300)


class TestTempConnectionRequest(BaseModel):
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    ssl_mode: str = "prefer"
    query_timeout: int = 30

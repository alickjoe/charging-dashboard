"""Pydantic schemas for connection management."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ConnectionResponse(BaseModel):
    name: str
    label: str
    type: str
    host: str
    port: int
    database: str
    status: str  # "connected" | "disconnected" | "error"
    last_checked: Optional[datetime] = None


class TestConnectionResponse(BaseModel):
    name: str
    status: str  # "connected" | "error"
    message: str
    latency_ms: float

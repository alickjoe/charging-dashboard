"""Pydantic schemas for LLM configuration and queries."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LLMConfigResponse(BaseModel):
    id: int
    name: str
    api_base: str
    api_key_masked: str  # e.g. "sk-...xxxx"
    model: str
    temperature: float
    max_tokens: int
    is_default: bool
    created_at: str
    updated_at: str


class LLMConfigCreate(BaseModel):
    name: str
    api_base: str
    api_key: str
    model: str = "gpt-4o"
    temperature: float = Field(default=0.1, ge=0, le=2)
    max_tokens: int = Field(default=4096, ge=1, le=32768)
    is_default: bool = False


class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=32768)
    is_default: Optional[bool] = None


class TestLLMResponse(BaseModel):
    status: str  # "ok" | "error"
    message: str
    latency_ms: float = 0


class NLQueryRequest(BaseModel):
    connection_name: str
    llm_config_id: int
    question: str = Field(..., min_length=1, max_length=2000)
    conversation_id: Optional[int] = None


class NLQueryResponse(BaseModel):
    sql: str
    columns: list[str]
    rows: list[list]
    execution_time_ms: float
    llm_call_time_ms: float
    cannot_answer: Optional[str] = None

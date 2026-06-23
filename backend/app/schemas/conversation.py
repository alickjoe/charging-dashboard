"""Pydantic schemas for conversation management."""

from typing import Optional

from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    connection_name: str
    llm_config_id: int
    title: str = ""


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    question: str
    answer_blocks: str  # JSON string of StreamBlock[]
    llm_time_ms: Optional[float] = None
    raw_messages: str  # JSON string
    created_at: str


class ConversationResponse(BaseModel):
    id: int
    title: str
    connection_name: str
    llm_config_id: int
    message_count: int = 0
    created_at: str
    updated_at: str


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    connection_name: str
    llm_config_id: int
    created_at: str
    updated_at: str
    messages: list[MessageResponse] = []

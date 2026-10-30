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
    answer_blocks: str  # JSON string of StreamBlock[]: think/sql/result/error/summary
    llm_time_ms: Optional[float] = None
    raw_messages: str  # JSON string
    skill_ids: str = '[]'  # JSON string of int[], e.g. "[1,2]"
    created_at: str


class ConversationResponse(BaseModel):
    id: int
    title: str
    connection_name: str
    llm_config_id: int
    connection_schemas: list[dict] = []  # [{connection_name, schemas}] JSON from column
    message_count: int = 0
    skill_ids: list[int] = []  # Historical union of skill IDs used in this conversation
    bound_skill_ids: list[int] = []  # Skills currently bound to this conversation
    created_at: str
    updated_at: str


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    connection_name: str
    llm_config_id: int
    connection_schemas: list[dict] = []  # [{connection_name, schemas}] JSON from column
    skill_ids: list[int] = []  # Historical union of skill IDs used in this conversation
    bound_skill_ids: list[int] = []  # Skills currently bound to this conversation
    created_at: str
    updated_at: str
    messages: list[MessageResponse] = []


class UpdateConversationSkillsRequest(BaseModel):
    skill_ids: list[int] = []


class ConversationSkillsResponse(BaseModel):
    id: int
    bound_skill_ids: list[int] = []

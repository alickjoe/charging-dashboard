"""API routes for conversation management."""

import json
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.conversation import (
    ConversationResponse,
    ConversationDetailResponse,
    CreateConversationRequest,
)
from app.sqlite_store import ConversationStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


def _row_to_response(row: dict) -> ConversationResponse:
    return ConversationResponse(
        id=row["id"],
        title=row["title"],
        connection_name=row["connection_name"],
        llm_config_id=row["llm_config_id"],
        message_count=row.get("message_count", 0),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[ConversationResponse])
async def list_conversations():
    """List all conversations with message counts."""
    rows = await ConversationStore.list_all()
    return [_row_to_response(r) for r in rows]


@router.get("/user-questions")
async def list_user_questions():
    """List all distinct user questions from all conversations, newest first."""
    rows = await ConversationStore.get_all_user_questions()
    return rows


@router.get("/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation(conversation_id: int):
    """Get conversation detail with messages."""
    row = await ConversationStore.get_by_id(conversation_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")
    return ConversationDetailResponse(**row)


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(body: CreateConversationRequest):
    """Create a new conversation."""
    row = await ConversationStore.create(
        connection_name=body.connection_name,
        llm_config_id=body.llm_config_id,
        title=body.title,
    )
    row["message_count"] = 0
    return _row_to_response(row)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: int):
    """Delete a conversation and all its messages."""
    deleted = await ConversationStore.delete(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")

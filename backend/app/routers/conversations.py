"""API routes for conversation management."""

import json
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.conversation import (
    ConversationResponse,
    ConversationDetailResponse,
    ConversationSkillsResponse,
    CreateConversationRequest,
    UpdateConversationSkillsRequest,
)
from app.sqlite_store import ConversationStore, SkillStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


def _skill_list(value) -> list[int]:
    """Normalize a skill-id field that may be a list or a raw JSON string."""
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [v for v in parsed if isinstance(v, int) and not isinstance(v, bool)]


def _schema_list(value) -> list:
    """Normalize connection_schemas that may already be parsed or still raw JSON."""
    if isinstance(value, list):
        return value
    return ConversationStore._parse_connection_schemas(value)


def _row_to_response(row: dict) -> ConversationResponse:
    return ConversationResponse(
        id=row["id"],
        title=row["title"],
        connection_name=row["connection_name"],
        llm_config_id=row["llm_config_id"],
        connection_schemas=_schema_list(row.get("connection_schemas")),
        message_count=row.get("message_count", 0),
        skill_ids=_skill_list(row.get("skill_ids")),
        bound_skill_ids=_skill_list(row.get("bound_skill_ids", row.get("skill_ids"))),
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


@router.put("/{conversation_id}/skill-ids", response_model=ConversationSkillsResponse)
async def update_conversation_skills(
    conversation_id: int, body: UpdateConversationSkillsRequest
):
    """Replace the skills bound to a conversation (empty list = no skills)."""
    row = await ConversationStore.get_by_id(conversation_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")

    # Dedupe while preserving the user's selection order.
    unique_ids: list[int] = []
    for sid in body.skill_ids:
        if sid not in unique_ids:
            unique_ids.append(sid)

    if unique_ids:
        skill_rows = await SkillStore.get_by_ids(unique_ids)
        found = {s["id"] for s in skill_rows}
        unknown = [sid for sid in unique_ids if sid not in found]
        if unknown:
            raise HTTPException(status_code=400, detail=f"未知技能 ID: {unknown}")

    updated = await ConversationStore.update_skill_ids(
        conversation_id, json.dumps(unique_ids)
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")
    return ConversationSkillsResponse(id=conversation_id, bound_skill_ids=unique_ids)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: int):
    """Delete a conversation and all its messages."""
    deleted = await ConversationStore.delete(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")

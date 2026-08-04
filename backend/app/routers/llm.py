"""API routes for LLM configuration management and natural language queries."""

import json
import time
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.schemas.llm import (
    LLMConfigResponse,
    LLMConfigCreate,
    LLMConfigUpdate,
    TestLLMResponse,
    NLQueryRequest,
    NLQueryResponse,
)
from app.sqlite_store import LLMConfigStore, ConversationStore, SkillStore
from app.services.llm_service import execute_nl_query
from app.services.llm_agent_service import run_agent_stream

logger = logging.getLogger(__name__)

router = APIRouter(tags=["llm"])


def _row_to_response(row: dict) -> LLMConfigResponse:
    return LLMConfigResponse(
        id=row["id"],
        name=row["name"],
        api_base=row["api_base"],
        api_key_masked=LLMConfigStore.mask_api_key(row["api_key"]),
        model=row["model"],
        temperature=row["temperature"],
        max_tokens=row["max_tokens"],
        is_default=bool(row["is_default"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _resolve_connections(body: NLQueryRequest) -> list[dict]:
    """Resolve effective connection selections from a query request.

    Prefers `connection_schemas` (multi-DB with per-connection schema filters);
    falls back to the legacy single `connection_name` (all schemas).
    """
    if body.connection_schemas:
        return [c.model_dump() for c in body.connection_schemas]
    if body.connection_name:
        return [{"connection_name": body.connection_name, "schemas": []}]
    raise HTTPException(status_code=400, detail="请至少选择一个数据库连接")


# ─── LLM Config CRUD ───────────────────────────────────────────────

@router.get("/api/v1/llm-configs", response_model=list[LLMConfigResponse])
async def list_llm_configs():
    """List all LLM configurations (api_key masked)."""
    rows = await LLMConfigStore.list_all()
    return [_row_to_response(r) for r in rows]


@router.post("/api/v1/llm-configs", response_model=LLMConfigResponse, status_code=201)
async def create_llm_config(body: LLMConfigCreate):
    """Create a new LLM configuration."""
    existing_rows = await LLMConfigStore.list_all()
    for r in existing_rows:
        if r["name"] == body.name:
            raise HTTPException(status_code=409, detail=f"LLM 配置 '{body.name}' 已存在")

    row = await LLMConfigStore.create(body.model_dump())
    return _row_to_response(row)


@router.put("/api/v1/llm-configs/{config_id}", response_model=LLMConfigResponse)
async def update_llm_config(config_id: int, body: LLMConfigUpdate):
    """Update an LLM configuration."""
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="未提供任何更新字段")

    row = await LLMConfigStore.update(config_id, data)
    if not row:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={config_id} 不存在")
    return _row_to_response(row)


@router.delete("/api/v1/llm-configs/{config_id}", status_code=204)
async def delete_llm_config(config_id: int):
    """Delete an LLM configuration."""
    deleted = await LLMConfigStore.delete(config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={config_id} 不存在")


@router.post("/api/v1/llm-configs/{config_id}/test", response_model=TestLLMResponse)
async def test_llm_config(config_id: int):
    """Test LLM connectivity by sending a simple chat request."""
    row = await LLMConfigStore.get_by_id(config_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={config_id} 不存在")

    row = LLMConfigStore.decrypt_api_key(row)
    api_base = row["api_base"].rstrip("/")
    api_key = row["api_key"]
    model = row["model"]

    try:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.post(
                f"{api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                },
            )
        latency = (time.monotonic() - start) * 1000

        if resp.status_code == 200:
            return TestLLMResponse(
                status="ok",
                message=f"连接成功 (模型: {model})",
                latency_ms=round(latency, 2),
            )
        else:
            detail = resp.json().get("error", {}).get("message", resp.text)
            return TestLLMResponse(
                status="error",
                message=f"API 返回错误 ({resp.status_code}): {detail}",
                latency_ms=round(latency, 2),
            )
    except httpx.TimeoutException:
        return TestLLMResponse(status="error", message="连接超时")
    except Exception as e:
        return TestLLMResponse(status="error", message=f"连接失败: {str(e)}")


# ─── Natural Language Query ────────────────────────────────────────

@router.post("/api/v1/nl-query", response_model=NLQueryResponse)
async def nl_query(body: NLQueryRequest, request: Request):
    """Execute a natural language query against a database."""
    pools = request.app.state.pools

    # Load LLM config
    llm_row = await LLMConfigStore.get_by_id(body.llm_config_id)
    if not llm_row:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={body.llm_config_id} 不存在")
    llm_row = LLMConfigStore.decrypt_api_key(llm_row)

    connections = _resolve_connections(body)

    try:
        result = await execute_nl_query(
            pools=pools,
            connection_name=connections[0]["connection_name"],
            llm_config=llm_row,
            question=body.question,
        )
        return NLQueryResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/api/v1/nl-query-stream")
async def nl_query_stream(body: NLQueryRequest, request: Request):
    """Execute natural language query with SSE streaming (Agent mode).

    Supports conversation persistence: if conversation_id is provided, loads
    previous messages and continues the conversation. Saves new messages on done.
    """
    pools = request.app.state.pools

    llm_row = await LLMConfigStore.get_by_id(body.llm_config_id)
    if not llm_row:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={body.llm_config_id} 不存在")
    llm_row = LLMConfigStore.decrypt_api_key(llm_row)

    connections = _resolve_connections(body)

    # Load skill prompts if skill_ids provided
    skill_prompts: list[str] | None = None
    if body.skill_ids:
        skill_rows = await SkillStore.get_by_ids(body.skill_ids)
        logger.info("NL query with skill_ids=%s, loaded %d skill(s)", body.skill_ids, len(skill_rows))
        prompt_parts: list[str] = []
        for s in skill_rows:
            sp = s.get("system_prompt", "").strip()
            ut = s.get("user_prompt_template", "").strip()
            if sp:
                prompt_parts.append(sp)
                logger.info("  Skill '%s': system_prompt loaded (%d chars)", s["name"], len(sp))
            if ut:
                prompt_parts.append(ut)
                logger.info("  Skill '%s': user_prompt_template loaded (%d chars)", s["name"], len(ut))
        if not prompt_parts:
            logger.warning("  No prompt content found in selected skills (both system_prompt and user_prompt_template are empty)!")
        skill_prompts = prompt_parts if prompt_parts else None

    # Load history messages if continuing a conversation
    history_messages = []
    conversation_id = body.conversation_id
    if conversation_id:
        conv = await ConversationStore.get_by_id(conversation_id)
        if not conv:
            raise HTTPException(status_code=404, detail=f"会话 ID={conversation_id} 不存在")
        history_messages = await ConversationStore.get_latest_raw_messages(conversation_id)
    else:
        # Pre-create conversation so we can return its ID in the done event
        conv = await ConversationStore.create(
            connection_name=connections[0]["connection_name"],
            llm_config_id=body.llm_config_id,
            title="",
            connection_schemas=json.dumps(connections, ensure_ascii=False),
        )
        conversation_id = conv["id"]

    async def event_generator():
        collected_blocks: list[dict] = []
        final_llm_time = None
        final_conversation_messages = None
        done_sse_str: str | None = None

        async for sse_str in run_agent_stream(
            pools=pools,
            connections=connections,
            llm_config=llm_row,
            question=body.question,
            history_messages=history_messages if history_messages else None,
            language=body.language,
            skill_prompts=skill_prompts,
        ):
            if sse_str.startswith("data: "):
                try:
                    event = json.loads(sse_str[6:])
                    if event.get("type") == "done":
                        final_llm_time = event.get("llm_time_ms")
                        final_conversation_messages = event.get("conversation_messages")
                        # Inject conversation_id and defer yielding until after DB save
                        event["conversation_id"] = conversation_id
                        done_sse_str = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                        break  # exit loop, persist messages, then yield done
                    etype = event.get("type", "")
                    if etype in ("think", "sql", "result", "error"):
                        # Merge consecutive think blocks to avoid content fragmentation
                        if etype == "think" and collected_blocks and collected_blocks[-1].get("type") == "think":
                            collected_blocks[-1]["content"] = (
                                collected_blocks[-1].get("content", "") +
                                event.get("content", "")
                            )
                        else:
                            collected_blocks.append(event)
                except (json.JSONDecodeError, KeyError):
                    pass

            yield sse_str

        # Update conversation title from first question (if title is still empty)
        current_conv = await ConversationStore.get_by_id(conversation_id)
        if current_conv and not current_conv.get("title"):
            title = body.question[:30] if len(body.question) > 30 else body.question
            await ConversationStore.update_title(conversation_id, title)

        raw_msgs_json = json.dumps(final_conversation_messages or [], ensure_ascii=False)
        blocks_json = json.dumps(collected_blocks, ensure_ascii=False)
        skill_ids_json = json.dumps(body.skill_ids) if body.skill_ids else '[]'

        await ConversationStore.add_message(
            conversation_id=conversation_id,
            role="user",
            question=body.question,
            answer_blocks="[]",
            llm_time_ms=None,
            raw_messages=raw_msgs_json,
            skill_ids=skill_ids_json,
        )
        await ConversationStore.add_message(
            conversation_id=conversation_id,
            role="assistant",
            question="",
            answer_blocks=blocks_json,
            llm_time_ms=final_llm_time,
            raw_messages=raw_msgs_json,
            skill_ids=skill_ids_json,
        )

        # Now yield the done event — frontend will see messages when it reloads
        if done_sse_str:
            yield done_sse_str

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

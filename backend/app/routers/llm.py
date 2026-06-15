"""API routes for LLM configuration management and natural language queries."""

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
from app.sqlite_store import LLMConfigStore
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

    try:
        result = await execute_nl_query(
            pools=pools,
            connection_name=body.connection_name,
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
    """Execute natural language query with SSE streaming (Agent mode)."""
    pools = request.app.state.pools

    llm_row = await LLMConfigStore.get_by_id(body.llm_config_id)
    if not llm_row:
        raise HTTPException(status_code=404, detail=f"LLM 配置 ID={body.llm_config_id} 不存在")
    llm_row = LLMConfigStore.decrypt_api_key(llm_row)

    return StreamingResponse(
        run_agent_stream(
            pools=pools,
            connection_name=body.connection_name,
            llm_config=llm_row,
            question=body.question,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

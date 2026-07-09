"""API routes for skill (prompt template) management."""

import logging

import httpx
from fastapi import APIRouter, HTTPException

from app.schemas.skill import (
    SkillCreate,
    SkillUpdate,
    SkillResponse,
    EnhancePromptRequest,
    EnhancePromptResponse,
)
from app.sqlite_store import SkillStore, LLMConfigStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


def _row_to_response(row: dict) -> SkillResponse:
    return SkillResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        system_prompt=row["system_prompt"],
        user_prompt_template=row["user_prompt_template"],
        source_questions=row["source_questions"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ─── CRUD ──────────────────────────────────────────────────────────

@router.get("", response_model=list[SkillResponse])
async def list_skills():
    """List all skills."""
    rows = await SkillStore.list_all()
    return [_row_to_response(r) for r in rows]


@router.get("/{skill_id}", response_model=SkillResponse)
async def get_skill(skill_id: int):
    """Get a single skill by ID."""
    row = await SkillStore.get_by_id(skill_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Skill ID={skill_id} 不存在")
    return _row_to_response(row)


@router.post("", response_model=SkillResponse, status_code=201)
async def create_skill(body: SkillCreate):
    """Create a new skill."""
    existing = await SkillStore.get_by_name(body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Skill '{body.name}' 已存在")

    data = body.model_dump()
    # Ensure source_questions is stored as a JSON string
    if isinstance(data.get("source_questions"), list):
        import json
        data["source_questions"] = json.dumps(data["source_questions"], ensure_ascii=False)

    row = await SkillStore.create(data)
    return _row_to_response(row)


@router.put("/{skill_id}", response_model=SkillResponse)
async def update_skill(skill_id: int, body: SkillUpdate):
    """Update an existing skill."""
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="未提供任何更新字段")

    # Handle source_questions list -> JSON string
    if "source_questions" in data and isinstance(data["source_questions"], list):
        import json
        data["source_questions"] = json.dumps(data["source_questions"], ensure_ascii=False)

    row = await SkillStore.update(skill_id, data)
    if not row:
        raise HTTPException(status_code=404, detail=f"Skill ID={skill_id} 不存在")
    return _row_to_response(row)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(skill_id: int):
    """Delete a skill."""
    deleted = await SkillStore.delete(skill_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Skill ID={skill_id} 不存在")


# ─── Prompt Enhancement ────────────────────────────────────────────

ENHANCE_SYSTEM_PROMPT = """You are a prompt engineering expert. Your task is to improve user-provided prompt templates to make them clearer, more specific, and more effective for an AI data analyst.

## Rules
1. Keep the original intent and domain. Do NOT change what the prompt is asking for.
2. Add specificity: clarify vague terms, add context where helpful.
3. Structure the output: use bullet points or numbered steps if the prompt involves multiple steps.
4. Keep the enhanced prompt concise — do NOT make it significantly longer than the original.
5. Output ONLY the enhanced prompt text. No explanations, no markdown fences, no commentary.
6. Write the enhanced prompt in {language}."""


@router.post("/enhance", response_model=EnhancePromptResponse)
async def enhance_prompt(body: EnhancePromptRequest):
    """Use LLM to enhance/optimize a prompt template."""
    # Get default LLM config
    llm_row = await LLMConfigStore.get_default()
    if not llm_row:
        # Try any LLM config
        rows = await LLMConfigStore.list_all()
        if not rows:
            raise HTTPException(status_code=400, detail="没有可用的 LLM 配置，请先配置一个 LLM")
        llm_row = rows[0]

    llm_row = LLMConfigStore.decrypt_api_key(llm_row)
    api_base = llm_row["api_base"].rstrip("/")
    api_key = llm_row["api_key"]
    model = llm_row["model"]

    lang_name = "Chinese" if body.language == "zh" else "English"
    system_prompt = ENHANCE_SYSTEM_PROMPT.format(language=lang_name)

    try:
        async with httpx.AsyncClient(timeout=120, verify=False) as client:
            resp = await client.post(
                f"{api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": "Enhance the following prompt:\n\n" + body.raw_prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 2048,
                },
            )

        if resp.status_code != 200:
            detail = resp.json().get("error", {}).get("message", resp.text)
            raise HTTPException(status_code=502, detail=f"LLM API 调用失败: {detail}")

        content = resp.json()["choices"][0]["message"]["content"].strip()
        return EnhancePromptResponse(enhanced_prompt=content)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="LLM API 请求超时")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"增强请求失败: {str(e)}")

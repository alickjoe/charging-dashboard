"""Pydantic schemas for skill management."""

from typing import Optional

from pydantic import BaseModel, Field


class SkillCreate(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    user_prompt_template: str = ""
    source_questions: str = "[]"  # JSON string array


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    source_questions: Optional[str] = None


class SkillResponse(BaseModel):
    id: int
    name: str
    description: str
    system_prompt: str
    user_prompt_template: str
    source_questions: str
    created_at: str
    updated_at: str


class EnhancePromptRequest(BaseModel):
    raw_prompt: str
    language: str = "zh"


class EnhancePromptResponse(BaseModel):
    enhanced_prompt: str

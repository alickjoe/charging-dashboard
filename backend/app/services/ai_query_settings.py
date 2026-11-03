"""App-level (model-agnostic) settings for AI queries.

These knobs used to be hardcoded in ``llm_agent_service.py`` (``MAX_ROUNDS``,
the 120s httpx timeout, the ``rows[:100]`` cap) or missing entirely (no
``finish_reason`` handling). They are global on purpose: they describe how the
agent loop behaves, independent of the chosen provider/model, and apply to
every AI query.

Storage contract: only customized keys are persisted in ``app_settings`` under
the ``ai_query.`` prefix; defaults live here so they can be tuned in future
releases without a migration.
"""

from __future__ import annotations

import logging
from typing import Any

from ..sqlite_store import SettingsStore

logger = logging.getLogger(__name__)

SETTINGS_PREFIX = "ai_query."

# Default values are the effective behaviour of the app unless the user
# changes them. ``max_tokens=None`` means "use each model's own max_tokens".
AI_QUERY_SETTINGS_DEFAULTS: dict[str, Any] = {
    "max_rounds": 500,
    "max_tokens": None,
    "request_timeout_sec": 120,
    "max_result_rows": 100,
    "auto_continue_rounds": 1,
    "max_history_messages": 20,
}

# Inclusive bounds, shared by the API schema and the defensive clamp below.
AI_QUERY_SETTINGS_BOUNDS: dict[str, tuple[int, int]] = {
    "max_rounds": (1, 2000),
    "max_tokens": (1, 32768),
    "request_timeout_sec": (10, 1800),
    "max_result_rows": (10, 1000),
    "auto_continue_rounds": (0, 5),
    "max_history_messages": (0, 200),
}


def _clamp(name: str, value: int) -> int:
    lo, hi = AI_QUERY_SETTINGS_BOUNDS[name]
    return max(lo, min(hi, int(value)))


def _parse_stored(raw: dict[str, str]) -> dict[str, Any]:
    """Turn raw ``app_settings`` rows into typed values (unknown keys ignored)."""
    parsed: dict[str, Any] = {}
    for name, default in AI_QUERY_SETTINGS_DEFAULTS.items():
        raw_value = raw.get(SETTINGS_PREFIX + name)
        if raw_value is None:
            continue
        if name == "max_tokens":
            text = raw_value.strip()
            if not text:
                continue  # empty string == "no override"
            parsed[name] = _clamp(name, int(text))
            continue
        try:
            parsed[name] = _clamp(name, int(raw_value))
        except (TypeError, ValueError):
            logger.warning("ignoring invalid ai_query setting %s=%r", name, raw_value)
    return parsed


async def load_ai_query_settings() -> dict[str, Any]:
    """Return the effective settings (defaults merged with stored overrides)."""
    try:
        raw = await SettingsStore.get_all(SETTINGS_PREFIX)
    except Exception:  # pragma: no cover - never break a query because of settings
        logger.exception("failed to load ai_query settings, using defaults")
        raw = {}
    effective = dict(AI_QUERY_SETTINGS_DEFAULTS)
    effective.update(_parse_stored(raw))
    return effective


async def save_ai_query_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Persist a partial update.

    ``patch`` maps setting name -> value. A ``None`` value for ``max_tokens``
    means "clear the override" (the key is deleted). Unknown names and values
    out of bounds are clamped/ignored. Returns the new effective settings.
    """
    to_upsert: dict[str, str] = {}
    to_delete: list[str] = []
    for name, value in patch.items():
        if name not in AI_QUERY_SETTINGS_DEFAULTS:
            continue
        if value is None:
            to_delete.append(SETTINGS_PREFIX + name)
            continue
        if name == "max_tokens":
            try:
                value = int(value)
            except (TypeError, ValueError):
                to_delete.append(SETTINGS_PREFIX + name)
                continue
        to_upsert[SETTINGS_PREFIX + name] = str(_clamp(name, value))

    if to_delete:
        await SettingsStore.delete_many(to_delete)
    if to_upsert:
        await SettingsStore.upsert_many(to_upsert)
    return await load_ai_query_settings()

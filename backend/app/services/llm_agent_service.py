"""Agent service with LLM tool-calling loop for database analysis."""

import json
import re
import time
import logging
from typing import AsyncGenerator

import httpx

from app.database import get_pool
from app.services.ai_query_settings import (
    AI_QUERY_SETTINGS_DEFAULTS,
    load_ai_query_settings,
)
from app.services.db_explorer_service import list_schemas, list_tables, list_columns
from app.services.sql_validator import validate_readonly_sql
from app.sqlite_store import AnnotationStore, ConnectionStore

logger = logging.getLogger(__name__)

AGENT_SYSTEM_PROMPT = """## CRITICAL LANGUAGE REQUIREMENT

YOU MUST WRITE ALL YOUR OUTPUT IN {language}. This includes your reasoning, step-by-step thinking, analysis, explanations, and final answer. The user's question language is irrelevant — you reply in {language} ALWAYS.

**IMPORTANT**: Database query results may contain text in other languages (e.g. Chinese column values). This does NOT change your output language. Even when analyzing data that contains Chinese/other-language content, ALL of your writing MUST remain in {language}. The language of the data does NOT determine the language of your response.

---

You are a data analyst with read-only access to a PostgreSQL database. Your job is to answer the user's question by exploring and analyzing the data.

## Available Tool

You have one tool: `query_database`. Use it to run SELECT queries against one of the available databases. Call it whenever you need to look at actual data to answer the user's question.

### query_database
- Parameter `database`: the name of the database to query, exactly as shown in a `## Database: <name>` section header below. Omit this parameter only when exactly one database is available.
- Parameter `sql`: a valid PostgreSQL SELECT statement
- Returns: JSON with columns (list of column names) and rows (list of row arrays)
- Limit results to at most 200 rows unless the user asks for more
- Always use quoted identifiers for table/column names

## Rules

1. ONLY use SELECT / WITH ... SELECT queries. NEVER any write operations.
2. Explore the schema first with simple queries before diving into complex analysis.
3. The data you need may be spread across multiple databases: query each database as needed (pass its `database` parameter) and combine the results in your analysis.
4. Explain your reasoning step by step before each query.
5. After seeing query results, analyze them and explain your findings in plain language.
6. If a query fails, try to fix it based on the error message.
7. Use markdown formatting for readability.
8. You may use up to {max_rounds} tool-call rounds (one round = one assistant turn that calls query_database). Use as few queries as possible and stop as soon as you have enough data to answer.
9. REMINDER: All output must be in {language}. This is non-negotiable.

## Database Schema

{schema_text}"""

TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "query_database",
        "description": "Execute a read-only SELECT query against one of the available databases and return results as JSON.",
        "parameters": {
            "type": "object",
            "properties": {
                "database": {
                    "type": "string",
                    "description": "The database name to query, exactly as shown in a '## Database: <name>' section header of the schema. Omit only when exactly one database is available.",
                },
                "sql": {
                    "type": "string",
                    "description": "A valid PostgreSQL SELECT statement to execute.",
                },
            },
            "required": ["sql"],
        },
    },
}

DEFAULT_MAX_TOKENS = 4096


async def _get_schema_text(
    pools: dict, connections: list[dict], language: str = "en", correlation_id: str | None = None
) -> str:
    """Build a text description of the schemas for one or more connections.

    Each ``connections`` item is a dict: ``{"connection_name": str, "schemas": [..]}``
    where an empty ``schemas`` list means all schemas of that connection.
    """
    cid = _cid(correlation_id)
    # Language-aware labels
    anno_label = "业务说明" if language == "zh" else "Business Description"
    sections = []

    for conn_sel in connections:
        conn_name = conn_sel["connection_name"]
        selected_schemas = conn_sel.get("schemas") or []

        # Resolve display label from connection config (fallback to name)
        try:
            conn_row = await ConnectionStore.get_by_name(conn_name)
            label = conn_row["label"] if conn_row else conn_name
        except Exception:
            logger.warning("[cid=%s] connection label lookup failed for %s, falling back to name", cid, conn_name)
            label = conn_name

        try:
            schemas = await list_schemas(pools, conn_name)
        except Exception:
            logger.warning("[cid=%s] list_schemas failed for %s, assuming 'public'", cid, conn_name)
            schemas = ["public"]
        if selected_schemas:
            schemas = [s for s in schemas if s in selected_schemas]

        # Fetch business annotations for this connection
        try:
            annotation_rows = await AnnotationStore.list_by_connection(conn_name)
        except Exception:
            logger.warning("[cid=%s] annotation lookup failed for %s", cid, conn_name)
            annotation_rows = []
        table_annotations: dict[str, str] = {}
        column_annotations: dict[str, dict[str, str]] = {}
        for a in annotation_rows:
            tn = a["table_name"]
            if a["column_name"] is None:
                table_annotations[tn] = a["annotation"]
            else:
                column_annotations.setdefault(tn, {})[a["column_name"]] = a["annotation"]

        lines = [f"## Database: {conn_name}", f"- label: {label}"]
        for schema in schemas[:5]:
            try:
                tables = await list_tables(pools, conn_name, schema)
            except Exception:
                logger.warning("[cid=%s] list_tables failed for %s/%s", cid, conn_name, schema)
                continue

            for table in tables[:20]:
                table_name = table["table_name"]
                try:
                    cols = await list_columns(pools, conn_name, table_name, schema)
                except Exception:
                    logger.warning("[cid=%s] list_columns failed for %s.%s", cid, schema, table_name)
                    continue

                col_lines = []
                for c in cols[:50]:
                    nullable = "NULL" if c["is_nullable"] == "YES" else "NOT NULL"
                    pk = " PRIMARY KEY" if c["is_primary_key"] else ""
                    col_line = f'    "{c["column_name"]}" {c["data_type"]} {nullable}{pk}'
                    col_anno = column_annotations.get(table_name, {}).get(c["column_name"], "")
                    if col_anno:
                        col_line += f"  -- {col_anno}"
                    col_lines.append(col_line)

                row_est = table.get("row_count_estimate", "?")
                table_header = f'Table "{schema}"."{table_name}" (~{row_est} rows):'
                table_anno = table_annotations.get(table_name, "")
                if table_anno:
                    table_header += f" -- {anno_label}: {table_anno}"
                lines.append(table_header + "\n" + "\n".join(col_lines))

        sections.append("\n".join(lines))

    if not sections:
        return "No tables found in any schema."
    return "\n\n".join(sections)


async def _execute_sql(
    pools: dict, connection_name: str, sql: str
) -> tuple[list[str], list[list]]:
    """Execute a read-only SQL and return (columns, rows)."""
    pool = await get_pool(pools, connection_name)

    async with pool.acquire() as conn:
        await conn.execute("SET TRANSACTION READ ONLY")
        rows = await conn.fetch(sql)

    columns = list(rows[0].keys()) if rows else []
    return columns, [list(r.values()) for r in rows]


def _sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


def _cid(correlation_id: str | None) -> str:
    """Format a correlation id for log prefixes, falling back to '-' when absent."""
    return correlation_id or "-"


# Some providers (notably DeepSeek-style endpoints that use DSML tool tokens)
# leak the raw tool-call control markup into the plain ``content`` stream
# instead of returning parsed ``tool_calls``.  A round whose whole content is
# only that markup carries no answer at all, so it must never be presented or
# persisted as the conclusion.
_TOOL_MARKUP_RE = re.compile(
    r"</?tool[ _]?(?:invoke|calls?|call|sep|begin|end)[^>]*>"
    r"|</?functions?>"
    r"|<function[=\s][^>]*>?"
    r"|<\|[^|]{0,40}\|>",
    re.IGNORECASE,
)


def _strip_tool_markup(text: str) -> str:
    """Drop leaked tool-call control markup from model text."""
    if not text:
        return ""
    return _TOOL_MARKUP_RE.sub(" ", text).strip()


_PROMPT_ECHO_MARKERS = (
    "## CRITICAL LANGUAGE REQUIREMENT",
    "# 用户问题",
    "You are a database analyst",
    "## Database:",
)


def _detect_bad_round(content: str, question: str) -> str | None:
    """Classify a no-tool-call round whose text is not a usable answer.

    Some DeepSeek-style endpoints leak raw DSML tool markup into ``content``
    instead of returning ``tool_calls``.  When that happens the model sees its
    own broken output next round and often degenerates: it echoes the prompt
    back, repeats the same line hundreds of times, or keeps producing only
    control markup.  None of that may be shown as the answer.

    Returns a short reason code (for logs / retry wording) or ``None`` when the
    round looks like a normal answer.
    """
    if not content or not content.strip():
        return None
    text = content.strip()

    if not _strip_tool_markup(text):
        return "markup_only"
    if _TOOL_MARKUP_RE.match(text):
        return "markup_prefix"

    flat = " ".join(text.split())
    probe = " ".join((question or "").split())[:40]
    if len(probe) >= 20 and probe in flat:
        return "prompt_echo"
    for marker in _PROMPT_ECHO_MARKERS:
        if marker in text:
            return "prompt_echo"

    lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) >= 2]
    if len(lines) >= 40:
        counts: dict[str, int] = {}
        for ln in lines:
            counts[ln] = counts.get(ln, 0) + 1
        if max(counts.values()) / len(lines) >= 0.3:
            return "repetition"

    # Degeneration often comes as one endless line ("好。执行。好。执行。…") with
    # no newlines at all, so also look for a short prefix repeated many times.
    if len(text) >= 500:
        for size in (12, 20, 30):
            unit = text[:size]
            if unit.strip() and text.count(unit) >= 20:
                return "repetition"

    return None


def _trim_history(messages: list[dict], limit: int) -> list[dict]:
    """Bound the conversation window sent to the LLM.

    Keeps the leading system message(s) and the last ``limit`` messages, then
    advances the cut point to the first clean ``user`` message: a window that
    starts in the middle of a tool-call sequence (an assistant ``tool_calls``
    message without its ``tool`` replies, or a ``tool`` reply without its call)
    is rejected by the provider. ``limit <= 0`` disables trimming.
    """
    if limit <= 0 or len(messages) <= limit + 2:
        return messages

    system_msgs: list[dict] = []
    rest = list(messages)
    while rest and rest[0].get("role") == "system":
        system_msgs.append(rest.pop(0))
    if not rest:
        return messages

    start = max(0, len(rest) - limit)
    while start < len(rest) - 1:
        msg = rest[start]
        prev = rest[start - 1] if start > 0 else None
        prev_is_open_tool_call = bool(
            prev and prev.get("role") == "assistant" and prev.get("tool_calls")
        )
        if msg.get("role") == "user" and not prev_is_open_tool_call:
            break
        start += 1

    kept = rest[start:]
    # Orphaned tool replies whose assistant call was trimmed away.
    while kept and kept[0].get("role") == "tool":
        kept.pop(0)
    return system_msgs + kept


async def run_agent_stream(
    pools: dict,
    connections: list[dict],
    llm_config: dict,
    question: str,
    history_messages: list | None = None,
    language: str = "en",
    skill_prompts: list[str] | None = None,
    correlation_id: str | None = None,
    settings: dict | None = None,
) -> AsyncGenerator[str, None]:
    """
    Agent loop with SSE streaming output.

    ``connections`` is a list of dicts: ``{"connection_name": str, "schemas": [..]}``
    (empty ``schemas`` = all schemas of that connection).
    ``correlation_id`` is a request-scoped trace id included in every log line.
    ``settings`` is a snapshot of the app-level, model-agnostic AI-query limits
    (rounds cap, token budget, request timeout, result-row cap, auto-continue,
    history window); when omitted the current values are loaded from the DB.

    Yields SSE-formatted strings to be consumed by StreamingResponse.
    """
    # Map language code to display name for the system prompt
    lang_name = "Chinese" if language == "zh" else "English"
    cid = _cid(correlation_id)
    started = time.monotonic()

    # App-level, model-agnostic query limits (services/ai_query_settings.py).
    if settings is None:
        settings = await load_ai_query_settings()
    limits = dict(AI_QUERY_SETTINGS_DEFAULTS)
    limits.update({k: v for k, v in settings.items() if k in limits})
    max_rounds = int(limits["max_rounds"])
    request_timeout_sec = int(limits["request_timeout_sec"])
    max_result_rows = int(limits["max_result_rows"])
    auto_continue_rounds = int(limits["auto_continue_rounds"])
    max_history_messages = int(limits["max_history_messages"])
    # A global max_tokens (when set) overrides the per-model configuration.
    _global_max_tokens = limits.get("max_tokens")
    if _global_max_tokens is None:
        max_tokens = int(llm_config.get("max_tokens") or DEFAULT_MAX_TOKENS)
    else:
        max_tokens = int(_global_max_tokens)
    logger.info(
        "[cid=%s] stage=limits max_rounds=%d max_tokens=%d timeout=%ds "
        "max_result_rows=%d auto_continue=%d history=%d",
        cid, max_rounds, max_tokens, request_timeout_sec,
        max_result_rows, auto_continue_rounds, max_history_messages,
    )

    # Filter out connections whose pool is unavailable (failed to initialize)
    available: list[dict] = []
    unavailable_names: list[str] = []
    for c in connections:
        if pools.get(c["connection_name"]) is not None:
            available.append(c)
        else:
            unavailable_names.append(c["connection_name"])

    if not available:
        logger.warning(
            "[cid=%s] stage=init no available database, duration_ms=%.1f",
            cid, (time.monotonic() - started) * 1000,
        )
        yield _sse_event("error", {"message": f"所选数据库均不可用: {', '.join(unavailable_names)}"})
        yield _sse_event("done", {"message": ""})
        return
    if unavailable_names:
        logger.warning("[cid=%s] unavailable databases skipped: %s", cid, unavailable_names)

    available_names = [c["connection_name"] for c in available]
    logger.info(
        "[cid=%s] agent_stream start: connections=%s, question_len=%d, history_msgs=%d, skills=%d",
        cid, available_names, len(question), len(history_messages or []), len(skill_prompts or []),
    )

    schema_start = time.monotonic()
    schema_text = await _get_schema_text(pools, available, language, correlation_id=cid)
    logger.info(
        "[cid=%s] stage=schema duration_ms=%.1f chars=%d",
        cid, (time.monotonic() - schema_start) * 1000, len(schema_text),
    )
    if not schema_text or schema_text.startswith("No tables"):
        logger.warning(
            "[cid=%s] stage=init no tables found, duration_ms=%.1f",
            cid, (time.monotonic() - started) * 1000,
        )
        yield _sse_event("error", {"message": "所选数据库中没有找到任何表"})
        yield _sse_event("done", {"message": ""})
        return

    # Tell the LLM which databases must NOT be queried
    if unavailable_names:
        schema_text += (
            "\n\n## Unavailable Databases\n"
            + "\n".join(f"- {n}" for n in unavailable_names)
            + "\n(These databases are NOT queryable. Never use them.)"
        )

    system_prompt = AGENT_SYSTEM_PROMPT.format(
        schema_text=schema_text, language=lang_name, max_rounds=max_rounds
    )

    # Append user-defined skill prompts (after language directive, before user message)
    if skill_prompts:
        logger.info("[cid=%s] appending %d skill prompt segment(s) to system prompt", cid, len(skill_prompts))
        skill_section = "\n\n## User-Defined Skills\n\n" + "\n\n".join(skill_prompts)
        # Re-assert language requirement after skills to prevent skill content
        # from diluting the language directive (mitigates "lost in the middle")
        skill_section += f"\n\n---\n**REMINDER**: The CRITICAL LANGUAGE REQUIREMENT at the start of this prompt remains in effect. All your responses, reasoning, analysis, and final answers MUST be in {lang_name}. This is non-negotiable."
        system_prompt = system_prompt + skill_section

    api_base = llm_config["api_base"].rstrip("/")
    api_key = llm_config["api_key"]
    model = llm_config["model"]

    # Build messages: system + history (non-system) + new user question
    messages = [{"role": "system", "content": system_prompt}]
    if history_messages:
        for msg in history_messages:
            if msg.get("role") == "system":
                continue
            # A past turn may have been persisted with leaked tool markup / a
            # prompt echo; replaying it teaches the model to degenerate again.
            if (
                msg.get("role") == "assistant"
                and not msg.get("tool_calls")
                and isinstance(msg.get("content"), str)
                and _detect_bad_round(msg["content"], question)
            ):
                logger.warning(
                    "[cid=%s] stage=history_drop_bad_assistant chars=%d",
                    cid, len(msg["content"]),
                )
                continue
            messages.append(msg)
    # Inject language directive into user message for double enforcement
    # (multi-system-message not used due to API compatibility concerns)
    messages.append({"role": "user", "content": f"[⬤ Output language: {lang_name}. ALL reasoning, analysis, and conclusions MUST be in {lang_name} — regardless of the question's language or database data values. ⬤] {question}"})

    before_trim = len(messages)
    messages = _trim_history(messages, max_history_messages)
    if len(messages) != before_trim:
        logger.info("[cid=%s] stage=history_trim kept=%d/%d", cid, len(messages), before_trim)

    answer_parts: list[str] = []
    continuations_used = 0
    markup_retries = 0
    llm_time = 0.0
    total_llm_time = 0.0

    async with httpx.AsyncClient(timeout=request_timeout_sec, verify=False) as client:
        for _round in range(max_rounds):
            llm_start = time.monotonic()
            logger.info(
                "[cid=%s] stage=llm_call round=%d/%d history_msgs=%d",
                cid, _round + 1, max_rounds, len(messages),
            )

            # Call LLM with streaming + tool definition
            async with client.stream(
                "POST",
                f"{api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    # Only the recent window goes to the model; ``messages`` keeps
                    # growing so the whole turn can be persisted.
                    "messages": _trim_history(messages, max_history_messages),
                    "temperature": llm_config.get("temperature", 0.1),
                    "max_tokens": max_tokens,
                    "stream": True,
                    "tools": [TOOL_DEFINITION],
                    "tool_choice": "auto",
                },
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    logger.error(
                        "[cid=%s] stage=llm_api status=%d duration_ms=%.1f",
                        cid, resp.status_code, (time.monotonic() - llm_start) * 1000,
                    )
                    yield _sse_event("error", {"message": f"LLM API 错误 ({resp.status_code})"})
                    yield _sse_event("done", {"message": ""})
                    return

                accumulated_content = ""
                tool_calls: list[dict] = []
                tool_call_buf: dict[int, dict] = {}  # index -> {id, name, arguments}
                finish_reason: str | None = None
                timed_out = False
                degenerate_reason: str | None = None
                watchdog_next = 2000

                try:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        choice = choices[0]
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
                        delta = choice.get("delta") or {}

                        # Text content
                        content = delta.get("content", "")
                        if content:
                            accumulated_content += content
                            yield _sse_event("think", {"content": content})
                            # Degeneration watchdog: stop paying for junk as soon
                            # as the model starts echoing the prompt or looping.
                            if len(accumulated_content) >= watchdog_next:
                                watchdog_next = len(accumulated_content) + 2000
                                reason = _detect_bad_round(accumulated_content, question)
                                if reason in ("prompt_echo", "repetition", "markup_prefix"):
                                    degenerate_reason = reason
                                    logger.warning(
                                        "[cid=%s] stage=degeneration round=%d reason=%s chars=%d",
                                        cid, _round + 1, reason,
                                        len(accumulated_content),
                                    )
                                    break

                        # Tool calls in delta
                        tc_deltas = delta.get("tool_calls", [])
                        for tc in tc_deltas:
                            idx = tc.get("index", 0)
                            if idx not in tool_call_buf:
                                tool_call_buf[idx] = {
                                    "id": tc.get("id", ""),
                                    "function": {"name": "", "arguments": ""},
                                }
                            if tc.get("id"):
                                tool_call_buf[idx]["id"] = tc["id"]
                            func = tc.get("function", {})
                            if func.get("name"):
                                tool_call_buf[idx]["function"]["name"] += func["name"]
                            if func.get("arguments"):
                                tool_call_buf[idx]["function"]["arguments"] += func["arguments"]
                except httpx.ReadTimeout:
                    timed_out = True
                    logger.warning(
                        "[cid=%s] stage=llm_stream interrupted reason=read_timeout round=%d "
                        "timeout=%ds duration_ms=%.1f",
                        cid, _round + 1, request_timeout_sec,
                        (time.monotonic() - llm_start) * 1000,
                    )
                    yield _sse_event("error", {"message": (
                        f"LLM 响应超时（{request_timeout_sec}s），结论不完整；"
                        "可在「AI 配置 → 通用设置」调大「单次请求超时」。"
                        "已生成的部分内容保留在上方分析过程中。"
                    )})

            llm_time = round((time.monotonic() - llm_start) * 1000, 2)
            total_llm_time = round(total_llm_time + llm_time, 2)

            if timed_out:
                # Partial text already streamed as think events; a half-finished
                # answer must never be presented as the conclusion.
                logger.warning(
                    "[cid=%s] stage=timeout forced done round=%d partial_chars=%d total_ms=%.1f",
                    cid, _round + 1, len(accumulated_content),
                    (time.monotonic() - started) * 1000,
                )
                yield _sse_event("done", {
                    "message": "",
                    "llm_time_ms": total_llm_time,
                    "conversation_messages": _trim_history(messages, max_history_messages),
                })
                return

            if degenerate_reason:
                logger.warning(
                    "[cid=%s] stage=degeneration_stop round=%d reason=%s chars=%d",
                    cid, _round + 1, degenerate_reason, len(accumulated_content),
                )

            # Build assistant message from accumulated content + tool calls
            assistant_msg: dict = {"role": "assistant", "content": accumulated_content or None}
            tool_calls_list = sorted(tool_call_buf.values(), key=lambda x: list(tool_call_buf.keys()))
            tool_calls_final = [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": tc["function"],
                }
                for tc in tool_calls_list
                if tc["function"]["name"]
            ]
            logger.info(
                "[cid=%s] stage=llm_done round=%d duration_ms=%.1f content_chars=%d "
                "tool_calls=%d finish_reason=%s",
                cid, _round + 1, llm_time, len(accumulated_content),
                len(tool_calls_final), finish_reason,
            )

            if tool_calls_final:
                assistant_msg["tool_calls"] = tool_calls_final
                assistant_msg["content"] = accumulated_content or None

            messages.append(assistant_msg)

            # Execute tool calls
            if not tool_calls_final:
                # No tool calls → this round produced the answer text bit.
                cleaned_content = _strip_tool_markup(accumulated_content)
                bad_round = _detect_bad_round(accumulated_content, question)
                if bad_round:
                    # Drop the junk assistant turn: leaving it in the history
                    # poisons the next request (the model starts echoing it).
                    if messages and messages[-1].get("role") == "assistant":
                        messages.pop()
                    if markup_retries < 1:
                        markup_retries += 1
                        logger.warning(
                            "[cid=%s] stage=bad_round round=%d reason=%s retry=%d "
                            "chars=%d raw=%r",
                            cid, _round + 1, bad_round, markup_retries,
                            len(accumulated_content), accumulated_content[:120],
                        )
                        messages.append({
                            "role": "user",
                            "content": (
                                "[纠正] 上一条回复异常（只含工具标记、回显了提示词或重复内容），"
                                "已被丢弃。请不要复述问题或提示词，也不要输出任何 XML/工具标记；"
                                "如需数据请调用 query_database，否则直接用中文给出最终结论。"
                            ),
                        })
                        continue
                    logger.warning(
                        "[cid=%s] stage=bad_round_giveup round=%d reason=%s chars=%d raw=%r",
                        cid, _round + 1, bad_round, len(accumulated_content),
                        accumulated_content[:120],
                    )
                    yield _sse_event("error", {"message": (
                        "模型本轮输出异常（只含工具标记、回显了提示词或重复退化），"
                        "本次回答已中止；请重试，或换一个模型（部分模型的工具调用标记"
                        "会被服务端当成普通文本返回）。已生成内容见上方分析过程。"
                    )})
                    yield _sse_event("done", {
                        "message": "",
                        "llm_time_ms": total_llm_time,
                        "conversation_messages": _trim_history(messages, max_history_messages),
                    })
                    return
                if cleaned_content:
                    answer_parts.append(cleaned_content)
                answer_text = "".join(answer_parts)

                if finish_reason == "length" and continuations_used < auto_continue_rounds:
                    continuations_used += 1
                    logger.warning(
                        "[cid=%s] stage=truncated round=%d action=continue "
                        "auto_continue=%d/%d",
                        cid, _round + 1, continuations_used, auto_continue_rounds,
                    )
                    messages.append({
                        "role": "user",
                        "content": (
                            "[续写] 上次输出因 token 上限中断，请从断点继续，"
                            "不要重复已输出内容。"
                        ),
                    })
                    continue

                if finish_reason == "length":
                    logger.warning(
                        "[cid=%s] stage=truncated round=%d action=give_up "
                        "auto_continue=%d/%d",
                        cid, _round + 1, continuations_used, auto_continue_rounds,
                    )
                    # Never let half an answer masquerade as the conclusion.
                    yield _sse_event("error", {"message": (
                        f"输出达到 token 上限被截断（已自动续写 {continuations_used} 次），"
                        "结论可能不完整；可在「AI 配置 → 通用设置」中调大"
                        "「单轮输出 token 上限」。已生成内容见上方分析过程。"
                    )})
                    yield _sse_event("done", {
                        "message": "",
                        "llm_time_ms": total_llm_time,
                        "conversation_messages": _trim_history(messages, max_history_messages),
                    })
                    return

                logger.info(
                    "[cid=%s] stage=done rounds=%d llm_time_ms=%.1f total_ms=%.1f",
                    cid, _round + 1, llm_time, (time.monotonic() - started) * 1000,
                )
                yield _sse_event("done", {
                    "message": answer_text,
                    "llm_time_ms": total_llm_time,
                    "conversation_messages": _trim_history(messages, max_history_messages),
                })
                return

            # Tool calls → text produced so far is intermediate analysis, not a
            # conclusion; the next round starts a fresh answer.
            answer_parts = []
            if finish_reason == "length":
                logger.warning(
                    "[cid=%s] stage=truncated_with_tool_calls round=%d",
                    cid, _round + 1,
                )

            for tc in tool_calls_final:
                func_name = tc["function"]["name"]
                if func_name != "query_database":
                    continue

                args_str = tc["function"]["arguments"]
                try:
                    args = json.loads(args_str)
                except json.JSONDecodeError:
                    logger.warning("[cid=%s] stage=tool_args parse failed round=%d", cid, _round + 1)
                    yield _sse_event("error", {"message": f"工具参数解析失败: {args_str}"})
                    continue

                sql = args.get("sql", "")
                yield _sse_event("sql", {"content": sql})

                # Resolve target database (omit → first available, backward compatible)
                db_name = args.get("database") or available_names[0]
                if db_name not in available_names:
                    tool_result = (
                        f"Unknown database '{db_name}'. "
                        f"Available databases: {', '.join(available_names)}. "
                        "Pass the 'database' parameter matching a '## Database:' header."
                    )
                    logger.warning("[cid=%s] stage=tool_db unknown database '%s'", cid, db_name)
                    yield _sse_event("error", {"message": tool_result})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": tool_result,
                    })
                    continue

                # Validate
                is_valid, validated_or_err = validate_readonly_sql(sql)
                if not is_valid:
                    tool_result = f"SQL validation failed: {validated_or_err}"
                    logger.warning("[cid=%s] stage=sql_validate rejected round=%d", cid, _round + 1)
                    yield _sse_event("error", {"message": tool_result})
                else:
                    sql_start = time.monotonic()
                    try:
                        columns, rows = await _execute_sql(pools, db_name, validated_or_err)
                        result_preview = json.dumps({
                            "columns": columns,
                            "rows": rows[:min(20, max_result_rows)],
                            "total_rows": len(rows),
                        }, ensure_ascii=False)
                        yield _sse_event("result", {
                            "columns": columns,
                            "rows": rows[:max_result_rows],
                            "total_rows": len(rows),
                        })
                        # Prepend language reminder to tool result to prevent
                        # Chinese data values from causing mid-response language switch
                        tool_result = f"[REMINDER: You MUST analyze these results and write ALL conclusions in {lang_name}. The language of data values is irrelevant.]\n\n{result_preview}"
                        logger.info(
                            "[cid=%s] stage=sql_exec db=%s rows=%d duration_ms=%.1f",
                            cid, db_name, len(rows), (time.monotonic() - sql_start) * 1000,
                        )
                    except Exception as e:
                        tool_result = f"Query execution failed: {str(e)}"
                        logger.warning(
                            "[cid=%s] stage=sql_exec db=%s failed duration_ms=%.1f: %s",
                            cid, db_name, (time.monotonic() - sql_start) * 1000, e,
                        )
                        yield _sse_event("error", {"message": tool_result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })

        # Max rounds reached
        logger.warning(
            "[cid=%s] stage=max_rounds forced done rounds=%d total_ms=%.1f",
            cid, max_rounds, (time.monotonic() - started) * 1000,
        )
        yield _sse_event("error", {"message": (
            f"已执行最大轮数（工具调用轮次上限 {max_rounds}），分析在此结束；"
            "可在「AI 配置 → 通用设置」调大「最大工具调用轮次」。"
            "已生成内容见上方分析过程。"
        )})
        yield _sse_event("done", {
            "message": "",
            "llm_time_ms": total_llm_time,
            "conversation_messages": _trim_history(messages, max_history_messages),
        })

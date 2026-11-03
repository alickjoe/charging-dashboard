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
9. NEVER run the same SQL statement twice in one analysis. The runtime lists every statement you already executed under "Run progress" below; reuse those results instead of re-running them.
10. Deliver partial conclusions early: as soon as the data you have supports a useful answer, stop exploring, write the conclusion with concrete numbers, and say what could still be checked. Do not try to read every table.
11. A statement budget and a wall-clock budget apply to every run and are shown under "Run progress". When one is exhausted the runtime forces a final round with tools disabled, so plan the exploration instead of grinding.
12. REMINDER: All output must be in {language}. This is non-negotiable.

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


def _json_default(value):
    """Serialise DB values the stdlib JSON encoder cannot handle.

    ``asyncpg`` returns ``datetime`` / ``Decimal`` / ``UUID`` objects; without
    this the SSE event (and the tool payload sent back to the model) raised
    "Object of type datetime is not JSON serializable", which aborted the
    stream mid-answer and made the model retry the same query forever.
    """
    return str(value)


def _sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False, default=_json_default)
    return f"data: {payload}\n\n"


def _cid(correlation_id: str | None) -> str:
    """Format a correlation id for log prefixes, falling back to '-' when absent."""
    return correlation_id or "-"


# ─── Per-run working memory, de-duplication and run budgets ─────────
#
# The window of messages sent to the model is bounded by
# ``max_history_messages``.  In a long exploratory run (hundreds of
# statements) that window only holds the last handful of tool results, so the
# model forgets what it already learned: a real run re-introspected the same
# tables a dozen times, re-ran the same statements and never converged (258
# rounds / 846 statements / 62 minutes / no answer, stopped by the user).
# A second real run showed the same shape because nothing told the model how
# much budget it had already spent.
#
# The helpers below give every run a cheap, durable memory that survives the
# window (a compact ledger of executed statements, re-injected into the system
# prompt on each request) plus exact-SQL de-duplication and hard run budgets
# that guarantee the turn ends with a conclusion instead of grinding forever.

_SQL_NOISE_RE = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)
_LEDGER_MAX_LINES = 60
_LEDGER_MAX_CHARS = 6000


def _sql_fingerprint(sql: str) -> str:
    """Normalise a statement so cosmetically different copies compare equal."""
    text = _SQL_NOISE_RE.sub(" ", sql or "")
    text = re.sub(r"\s+", " ", text).strip().rstrip(";").strip().lower()
    return text


def _clip(text: str, limit: int) -> str:
    """Collapse whitespace and truncate for logs / ledger lines."""
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _rows_summary(columns: list, rows: list, total_rows: int) -> str:
    """Very compact result preview kept in the run ledger."""
    if not rows:
        return "0 rows"
    head = " | ".join(
        ", ".join(str(v) for v in row[:6]) for row in rows[:2]
    )
    return _clip(
        f"{total_rows} rows; columns={','.join(str(c) for c in columns[:8])}; head: {head}",
        200,
    )


def _augment_sql_error(message: str) -> str:
    """Append one actionable hint to the PostgreSQL errors that caused churn.

    Roughly 8% of the statements in the stuck run failed on the same classes of
    mistake (a ``json`` column treated as ``jsonb``, guessed column names, two
    statements in one call).  The raw driver message does not say how to fix it,
    so the model retried blind; one hint line cuts that loop short.
    """
    text = message or ""
    lowered = text.lower()
    if "不允许执行多条 sql 语句" in text or "multiple statements" in lowered:
        return text + (
            "\nHint: submit exactly ONE SELECT statement per query_database call; "
            "split multi-statement SQL into separate calls."
        )
    if "jsonb_" in lowered and "does not exist" in lowered:
        return text + (
            "\nHint: this column is `json`, not `jsonb` — cast it with (col)::jsonb "
            "or use plain json functions/operators (->, ->>, json_array_length)."
        )
    if "operator does not exist: json" in lowered:
        return text + (
            "\nHint: this value is `json`; cast it to jsonb ((col)::jsonb) before "
            "using jsonb operators."
        )
    if "does not exist" in lowered and "column" in lowered:
        return text + (
            "\nHint: never guess column names — read information_schema.columns for "
            "that table first, then retry with an exact name."
        )
    if "does not exist" in lowered and "relation" in lowered:
        return text + (
            "\nHint: the table name is wrong — confirm schema.table with "
            "information_schema.tables first."
        )
    return text


class _RunMemo:
    """Working memory of one AI query run (one agent turn)."""

    def __init__(self) -> None:
        self.cache: dict[str, dict] = {}   # fingerprint -> {step, outcome, digest}
        self.ledger: list[str] = []        # compact lines, bounded
        self.executed = 0                  # statements actually sent to the database
        self.duplicate_skips = 0
        self.converge_notice_sent = False
        self.dup_notice_sent = False

    def lookup(self, fingerprint: str) -> dict | None:
        return self.cache.get(fingerprint)

    def record(
        self,
        fingerprint: str,
        database: str,
        sql: str,
        outcome: str,
        digest: str = "",
        payload: str = "",
    ) -> dict:
        step = len(self.ledger) + 1
        entry = {"step": step, "outcome": outcome, "digest": digest, "payload": payload}
        self.cache[fingerprint] = entry
        line = f"- [{step}] {database} | {_clip(sql, 170)} | {outcome}"
        if digest:
            line += f" | {digest}"
        self.ledger.append(line)
        if len(self.ledger) > _LEDGER_MAX_LINES:
            del self.ledger[: len(self.ledger) - _LEDGER_MAX_LINES]
        while (
            len(self.ledger) > 10
            and sum(len(x) for x in self.ledger) > _LEDGER_MAX_CHARS
        ):
            self.ledger.pop(0)
        return entry


def _run_context_text(
    memo: _RunMemo,
    *,
    rounds_used: int,
    max_rounds: int,
    elapsed_sec: float,
    max_query_seconds: int,
    max_tool_calls: int,
    force_wrap: bool,
) -> str:
    """Dynamic system-prompt suffix: budget progress + executed-statement ledger.

    Recomputed for every request, so it is never lost by history trimming and it
    tells the model how much of its budget is already gone.
    """
    parts = [
        "\n\n---\n\n## Run progress (refreshed every round by the runtime)",
        f"- Rounds used: {rounds_used} / {max_rounds}",
        f"- SQL statements executed: {memo.executed} / {max_tool_calls}",
        f"- Elapsed: {int(elapsed_sec)}s / {max_query_seconds}s",
        "- A budget running out forces a final round with tools disabled, so answer "
        "with what you have and state clearly what is still missing.",
    ]
    if force_wrap:
        parts.append(
            "- BUDGET EXHAUSTED: tools are disabled for this round. Write the "
            "conclusion now from the results already collected."
        )
    if memo.ledger:
        parts.append(
            "\n### Statements already executed in this run (never run them again; reuse the results)\n"
            + "\n".join(memo.ledger)
        )
    return "\n".join(parts)


def _with_run_context(
    messages: list[dict], limit: int, context_text: str, question_message: dict | None = None
) -> list[dict]:
    """Trimmed request messages with the run context appended to the system prompt.

    ``_trim_history`` keeps the *last* ``user`` message, which is usually the
    question.  Mid-run notices ("[收尾]", "[收敛提醒]", "[纠正]") are also
    ``user`` messages though, so after one of them is appended the question can
    fall out of the window.  It is re-inserted explicitly here — losing it makes
    the model restart the analysis from scratch.
    """
    trimmed = _trim_history(messages, limit)
    out = list(trimmed)
    if out and out[0].get("role") == "system" and context_text:
        out[0] = {**out[0], "content": out[0]["content"] + context_text}
    if question_message is not None and not any(m is question_message for m in out):
        out.insert(1, dict(question_message))
    return out


def _wrap_up_prompt(
    reason: str, executed: int, max_tool_calls: int, elapsed_sec: float, max_query_seconds: int
) -> str:
    """User-role notice that switches the run into forced-conclusion mode."""
    what = "SQL 条数" if reason == "sql" else "总时长"
    return (
        f"[收尾] 本次查询的{what}预算已用完（已执行 {executed}/{max_tool_calls} 条 SQL，"
        f"已用时 {int(elapsed_sec)}/{max_query_seconds} 秒），工具已禁用。\n"
        "请立即基于已经拿到的查询结果输出结论，不要再请求任何数据：\n"
        "1) 说明可以确定的事实与关键数字（附上依据的表/字段）；\n"
        "2) 说明目前还不确定、需要更多数据才能判断的点；\n"
        "3) 给出用户下一步可以继续问的具体问题（便于开启下一轮查询）。"
    )


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

    The current turn's question (the last ``user`` message) is always kept: an
    earlier version only looked for a ``user`` boundary inside the window, so
    once an agent turn grew past the window every request degenerated to
    ``[system]`` alone — the model lost the question and restarted its analysis
    from scratch, over and over, on every model.  Older history is dropped
    first; the recent tail is cut immediately before an ``assistant`` message
    because an assistant message never depends on what precedes it, while a
    ``tool`` reply always belongs to the assistant call above it.
    ``limit <= 0`` disables trimming.
    """
    if limit <= 0 or len(messages) <= limit + 2:
        return messages

    system_msgs: list[dict] = []
    rest = list(messages)
    while rest and rest[0].get("role") == "system":
        system_msgs.append(rest.pop(0))
    if not rest:
        return messages

    last_user = None
    for idx, msg in enumerate(rest):
        if msg.get("role") == "user":
            last_user = idx
    if last_user is None:
        return system_msgs + rest[-limit:]

    tail = rest[last_user + 1:]
    budget = max(1, limit - 1)  # room for the question itself
    start = max(0, len(tail) - budget)
    while start < len(tail) and tail[start].get("role") != "assistant":
        start += 1
    if start >= len(tail):
        start = max(0, len(tail) - budget)
    kept_tail = tail[start:]
    while kept_tail and kept_tail[0].get("role") == "tool":
        kept_tail.pop(0)

    # Fill the remaining budget with the newest older history.
    kept = [rest[last_user]] + kept_tail
    room = budget + 1 - len(kept)
    if room > 0:
        prefix = rest[:last_user]
        pstart = max(0, len(prefix) - room)
        while pstart < len(prefix) and prefix[pstart].get("role") == "tool":
            pstart += 1
        kept = prefix[pstart:] + kept
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
    max_tool_calls = int(limits["max_tool_calls"])
    max_query_seconds = int(limits["max_query_seconds"])
    # A global max_tokens (when set) overrides the per-model configuration.
    _global_max_tokens = limits.get("max_tokens")
    if _global_max_tokens is None:
        max_tokens = int(llm_config.get("max_tokens") or DEFAULT_MAX_TOKENS)
    else:
        max_tokens = int(_global_max_tokens)
    logger.info(
        "[cid=%s] stage=limits max_rounds=%d max_tokens=%d timeout=%ds "
        "max_result_rows=%d auto_continue=%d history=%d max_tool_calls=%d max_query_seconds=%d",
        cid, max_rounds, max_tokens, request_timeout_sec,
        max_result_rows, auto_continue_rounds, max_history_messages,
        max_tool_calls, max_query_seconds,
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
    question_message = messages[-1]

    before_trim = len(messages)
    messages = _trim_history(messages, max_history_messages)
    if len(messages) != before_trim:
        logger.info("[cid=%s] stage=history_trim kept=%d/%d", cid, len(messages), before_trim)

    answer_parts: list[str] = []
    continuations_used = 0
    markup_retries = 0
    llm_time = 0.0
    total_llm_time = 0.0
    # Per-run memory + budget state (see _RunMemo above).
    memo = _RunMemo()
    wrap_up_requested = False
    wrap_up_retries = 0

    async with httpx.AsyncClient(timeout=request_timeout_sec, verify=False) as client:
        for _round in range(max_rounds):
            elapsed_sec = time.monotonic() - started

            # ── Run budgets ────────────────────────────────────────────
            # Soft: warn the model once it has spent 85% of either budget so it
            # converges by itself. Hard: once a budget is exhausted, switch the
            # next request into forced-conclusion mode (tools disabled) instead
            # of grinding until the round cap or the user stops the run.
            if not wrap_up_requested:
                budget_hit: str | None = None
                if memo.executed >= max_tool_calls:
                    budget_hit = "sql"
                elif elapsed_sec >= max_query_seconds:
                    budget_hit = "time"
                if budget_hit:
                    wrap_up_requested = True
                    messages.append({
                        "role": "user",
                        "content": _wrap_up_prompt(
                            budget_hit, memo.executed, max_tool_calls,
                            elapsed_sec, max_query_seconds,
                        ),
                    })
                    logger.warning(
                        "[cid=%s] stage=budget_wrap round=%d reason=%s executed=%d/%d "
                        "elapsed=%.1fs/%ds",
                        cid, _round + 1, budget_hit, memo.executed, max_tool_calls,
                        elapsed_sec, max_query_seconds,
                    )
                    yield _sse_event("error", {"message": (
                        f"本次查询已用完{'SQL 条数' if budget_hit == 'sql' else '时间'}预算"
                        f"（已执行 {memo.executed}/{max_tool_calls} 条 SQL，"
                        f"已用时 {int(elapsed_sec)}/{max_query_seconds} 秒），"
                        "正在强制收尾；可在「AI 配置 → 通用设置」调大预算。"
                    )})
                elif not memo.converge_notice_sent:
                    used = max(memo.executed / max_tool_calls, elapsed_sec / max_query_seconds)
                    if used >= 0.85:
                        memo.converge_notice_sent = True
                        messages.append({
                            "role": "user",
                            "content": (
                                "[收敛提醒] 本次查询已使用 85% 的预算"
                                f"（SQL {memo.executed}/{max_tool_calls} 条，"
                                f"{int(elapsed_sec)}/{max_query_seconds} 秒）。"
                                "请立即收敛：给出当前可以确定的部分结论并说明还缺什么，"
                                "如需继续只再执行 1-2 条最关键的查询。"
                            ),
                        })
                        logger.info(
                            "[cid=%s] stage=budget_notice round=%d executed=%d elapsed=%.1fs",
                            cid, _round + 1, memo.executed, elapsed_sec,
                        )

            run_context = _run_context_text(
                memo,
                rounds_used=_round + 1,
                max_rounds=max_rounds,
                elapsed_sec=elapsed_sec,
                max_query_seconds=max_query_seconds,
                max_tool_calls=max_tool_calls,
                force_wrap=wrap_up_requested,
            )
            request_messages = _with_run_context(
                messages, max_history_messages, run_context, question_message
            )

            llm_start = time.monotonic()
            logger.info(
                "[cid=%s] stage=llm_call round=%d/%d history_msgs=%d executed=%d wrap_up=%s",
                cid, _round + 1, max_rounds, len(request_messages),
                memo.executed, wrap_up_requested,
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
                    # growing so the whole turn can be persisted.  The run context
                    # (budget + ledger) rides on the system prompt so trimming can
                    # never erase what has already been explored.
                    "messages": request_messages,
                    "temperature": llm_config.get("temperature", 0.1),
                    "max_tokens": max_tokens,
                    "stream": True,
                    "tools": [TOOL_DEFINITION],
                    "tool_choice": "none" if wrap_up_requested else "auto",
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

            # ── Forced conclusion round ────────────────────────────────
            # The budget is exhausted: the model must answer, not fetch more
            # data.  Some providers ignore tool_choice="none"; in that case the
            # tool calls are dropped and whatever text came with them is used.
            if wrap_up_requested and tool_calls_final:
                if accumulated_content.strip():
                    answer_text = "".join(
                        answer_parts + [_strip_tool_markup(accumulated_content)]
                    ).strip()
                    logger.warning(
                        "[cid=%s] stage=budget_wrap_answer round=%d chars=%d ignored_tool_calls=%d",
                        cid, _round + 1, len(answer_text), len(tool_calls_final),
                    )
                    yield _sse_event("done", {
                        "message": answer_text,
                        "llm_time_ms": total_llm_time,
                        "conversation_messages": _trim_history(messages, max_history_messages),
                    })
                    return
                # No usable text plus dangling tool_calls: drop that assistant
                # turn (an assistant tool_calls message without tool replies
                # breaks the next request) and ask once more, cleanly.
                messages.pop()
                if wrap_up_retries < 1:
                    wrap_up_retries += 1
                    messages.append({
                        "role": "user",
                        "content": (
                            "[收尾] 预算已用完且工具已禁用，不要再调用工具："
                            "请直接用已有的查询结果输出结论（可以确定的事实与数字、"
                            "仍不确定的点、建议继续问的问题）。"
                        ),
                    })
                    logger.warning(
                        "[cid=%s] stage=budget_wrap_retry round=%d", cid, _round + 1
                    )
                    continue
                logger.warning(
                    "[cid=%s] stage=budget_wrap_giveup round=%d", cid, _round + 1
                )
                yield _sse_event("error", {"message": (
                    "本次查询的预算已用完，但模型没有返回可用的结论；"
                    "已执行的查询结果保留在上方分析过程中。可调大预算后重试。"
                )})
                yield _sse_event("done", {
                    "message": "",
                    "llm_time_ms": total_llm_time,
                    "conversation_messages": _trim_history(messages, max_history_messages),
                })
                return

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

                if wrap_up_requested and not answer_text.strip():
                    # Budget-driven final round that produced nothing usable:
                    # never let this look like a successful empty answer.
                    logger.warning(
                        "[cid=%s] stage=budget_wrap_empty round=%d", cid, _round + 1
                    )
                    yield _sse_event("error", {"message": (
                        "本次查询的预算已用完，但模型没有给出结论；"
                        "已执行的查询结果保留在上方分析过程中。可调大预算后重试。"
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

                # ── SQL-statement budget ──────────────────────────────────
                # One round may request several statements; stop executing as
                # soon as the run budget is exhausted (the next round is the
                # forced conclusion round) instead of blowing past it in a burst.
                if memo.executed >= max_tool_calls:
                    tool_result = (
                        "[BUDGET] The SQL-statement budget for this query is exhausted; "
                        "this statement was NOT executed. Answer from the results already collected."
                    )
                    logger.warning(
                        "[cid=%s] stage=budget_skip round=%d executed=%d/%d",
                        cid, _round + 1, memo.executed, max_tool_calls,
                    )
                    yield _sse_event("error", {"message": (
                        f"已达到本次查询的 SQL 条数上限（{max_tool_calls}），"
                        "后续语句未执行，正在收尾。"
                    )})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": tool_result,
                    })
                    continue

                fingerprint = f"{db_name}\x00{_sql_fingerprint(sql)}"

                # ── Exact re-run guard ────────────────────────────────────
                # The model re-ran identical statements repeatedly in real
                # runs; short-circuit them so they cost neither DB time nor a
                # fresh result payload, and remind the model it already has it.
                hit = memo.lookup(fingerprint) if fingerprint.strip() else None
                if hit is not None:
                    memo.duplicate_skips += 1
                    # Replay the cached payload (when it was small enough to
                    # keep) so losing the result to history trimming never
                    # forces the model to re-derive it with a new query.
                    if hit.get("payload"):
                        replay = f"\nCached result (reuse it, do not re-run):\n{hit['payload']}"
                    elif hit["digest"]:
                        replay = f" Digest: {hit['digest']}"
                    else:
                        replay = ""
                    tool_result = (
                        f"[ALREADY EXECUTED at step {hit['step']}] This exact SQL was already run "
                        f"in this query ({hit['outcome']}).{replay}\nDo NOT run it again — reuse the "
                        "earlier result and move on to the conclusion."
                    )
                    logger.info(
                        "[cid=%s] stage=duplicate_skip round=%d step=%d skips=%d",
                        cid, _round + 1, hit["step"], memo.duplicate_skips,
                    )
                    yield _sse_event("error", {"message": (
                        f"已跳过重复查询：该 SQL 在本次查询第 {hit['step']} 步执行过"
                        f"（{hit['outcome']}），直接复用已有结果。"
                    )})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": tool_result,
                    })
                    if memo.duplicate_skips >= 3 and not memo.dup_notice_sent:
                        memo.dup_notice_sent = True
                        messages.append({
                            "role": "user",
                            "content": (
                                "[收敛提醒] 你已经连续执行了执行过的 SQL（已自动跳过）。"
                                "不要重复查同样的数据：请直接用已有结果给出结论，"
                                "或只补一条真正缺失的查询。"
                            ),
                        })
                        logger.warning(
                            "[cid=%s] stage=duplicate_notice round=%d", cid, _round + 1
                        )
                    continue

                # Validate
                is_valid, validated_or_err = validate_readonly_sql(sql)
                if not is_valid:
                    tool_result = f"SQL validation failed: {validated_or_err}"
                    logger.warning("[cid=%s] stage=sql_validate rejected round=%d", cid, _round + 1)
                    yield _sse_event("error", {"message": tool_result})
                    if fingerprint.strip():
                        memo.record(
                            fingerprint, db_name, sql,
                            f"REJECTED: {_clip(str(validated_or_err), 80)}",
                        )
                else:
                    sql_start = time.monotonic()
                    memo.executed += 1
                    try:
                        columns, rows = await _execute_sql(pools, db_name, validated_or_err)
                        preview_rows = rows[:max_result_rows]
                        truncated = len(rows) > len(preview_rows)
                        payload = {
                            "columns": columns,
                            "rows": preview_rows,
                            "total_rows": len(rows),
                        }
                        if truncated:
                            payload["note"] = (
                                f"Result truncated: showing the first {len(preview_rows)} of "
                                f"{len(rows)} rows. Do NOT re-run the same query to see the rest; "
                                "aggregate (count/sum/group by) or add filters instead."
                            )
                        result_preview = json.dumps(
                            payload, ensure_ascii=False, default=_json_default
                        )
                        yield _sse_event("result", {
                            "columns": columns,
                            "rows": rows[:max_result_rows],
                            "total_rows": len(rows),
                        })
                        # Prepend language reminder to tool result to prevent
                        # Chinese data values from causing mid-response language switch
                        tool_result = f"[REMINDER: You MUST analyze these results and write ALL conclusions in {lang_name}. The language of data values is irrelevant.]\n\n{result_preview}"
                        logger.info(
                            "[cid=%s] stage=sql_exec db=%s rows=%d duration_ms=%.1f executed=%d/%d",
                            cid, db_name, len(rows), (time.monotonic() - sql_start) * 1000,
                            memo.executed, max_tool_calls,
                        )
                        if fingerprint.strip():
                            memo.record(
                                fingerprint, db_name, sql, f"{len(rows)} rows",
                                _rows_summary(columns, preview_rows, len(rows)),
                                # Keep the full replayable payload only when it
                                # is small; the cache is per run and bounded.
                                payload=result_preview if len(result_preview) <= 20000 else "",
                            )
                    except Exception as e:
                        # Give the model one concrete fix instead of a bare
                        # driver message, which used to trigger retry churn.
                        tool_result = _augment_sql_error(f"Query execution failed: {str(e)}")
                        logger.warning(
                            "[cid=%s] stage=sql_exec db=%s failed duration_ms=%.1f: %s",
                            cid, db_name, (time.monotonic() - sql_start) * 1000, e,
                        )
                        yield _sse_event("error", {"message": tool_result})
                        if fingerprint.strip():
                            memo.record(
                                fingerprint, db_name, sql,
                                f"FAILED: {_clip(str(e), 80)}",
                            )

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

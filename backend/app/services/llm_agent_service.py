"""Agent service with LLM tool-calling loop for database analysis."""

import json
import time
import logging
from typing import AsyncGenerator

import httpx

from app.database import get_pool
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
8. Max 5 query rounds.
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

MAX_ROUNDS = 100


async def _get_schema_text(pools: dict, connections: list[dict], language: str = "en") -> str:
    """Build a text description of the schemas for one or more connections.

    Each ``connections`` item is a dict: ``{"connection_name": str, "schemas": [..]}``
    where an empty ``schemas`` list means all schemas of that connection.
    """
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
            label = conn_name

        try:
            schemas = await list_schemas(pools, conn_name)
        except Exception:
            schemas = ["public"]
        if selected_schemas:
            schemas = [s for s in schemas if s in selected_schemas]

        # Fetch business annotations for this connection
        try:
            annotation_rows = await AnnotationStore.list_by_connection(conn_name)
        except Exception:
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
                continue

            for table in tables[:20]:
                table_name = table["table_name"]
                try:
                    cols = await list_columns(pools, conn_name, table_name, schema)
                except Exception:
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


async def run_agent_stream(
    pools: dict,
    connections: list[dict],
    llm_config: dict,
    question: str,
    history_messages: list | None = None,
    language: str = "en",
    skill_prompts: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Agent loop with SSE streaming output.

    ``connections`` is a list of dicts: ``{"connection_name": str, "schemas": [..]}``
    (empty ``schemas`` = all schemas of that connection).

    Yields SSE-formatted strings to be consumed by StreamingResponse.
    """
    # Map language code to display name for the system prompt
    lang_name = "Chinese" if language == "zh" else "English"

    # Filter out connections whose pool is unavailable (failed to initialize)
    available: list[dict] = []
    unavailable_names: list[str] = []
    for c in connections:
        if pools.get(c["connection_name"]) is not None:
            available.append(c)
        else:
            unavailable_names.append(c["connection_name"])

    if not available:
        yield _sse_event("error", {"message": f"所选数据库均不可用: {', '.join(unavailable_names)}"})
        yield _sse_event("done", {"message": ""})
        return
    if unavailable_names:
        logger.warning("Unavailable databases skipped: %s", unavailable_names)

    available_names = [c["connection_name"] for c in available]

    schema_text = await _get_schema_text(pools, available, language)
    if not schema_text or schema_text.startswith("No tables"):
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

    system_prompt = AGENT_SYSTEM_PROMPT.format(schema_text=schema_text, language=lang_name)

    # Append user-defined skill prompts (after language directive, before user message)
    if skill_prompts:
        logger.info("Appending %d skill prompt segment(s) to system prompt", len(skill_prompts))
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
            if msg.get("role") != "system":
                messages.append(msg)
    # Inject language directive into user message for double enforcement
    # (multi-system-message not used due to API compatibility concerns)
    messages.append({"role": "user", "content": f"[⬤ Output language: {lang_name}. ALL reasoning, analysis, and conclusions MUST be in {lang_name} — regardless of the question's language or database data values. ⬤] {question}"})

    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        for _round in range(MAX_ROUNDS):
            llm_start = time.monotonic()

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
                    "messages": messages,
                    "temperature": llm_config.get("temperature", 0.1),
                    "max_tokens": llm_config.get("max_tokens", 4096),
                    "stream": True,
                    "tools": [TOOL_DEFINITION],
                    "tool_choice": "auto",
                },
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    yield _sse_event("error", {"message": f"LLM API 错误 ({resp.status_code})"})
                    yield _sse_event("done", {"message": ""})
                    return

                accumulated_content = ""
                tool_calls: list[dict] = []
                tool_call_buf: dict[int, dict] = {}  # index -> {id, name, arguments}

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

                        delta = chunk.get("choices", [{}])[0].get("delta", {})

                        # Text content
                        content = delta.get("content", "")
                        if content:
                            accumulated_content += content
                            yield _sse_event("think", {"content": content})

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
                    logger.warning("LLM stream read timed out after %.1fs", time.monotonic() - llm_start)
                    yield _sse_event("error", {"message": "LLM 响应超时，已返回部分结果"})

            llm_time = round((time.monotonic() - llm_start) * 1000, 2)

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

            if tool_calls_final:
                assistant_msg["tool_calls"] = tool_calls_final
                assistant_msg["content"] = accumulated_content or None

            messages.append(assistant_msg)

            # Execute tool calls
            if not tool_calls_final:
                # No tool calls → LLM is done
                yield _sse_event("done", {
                    "message": accumulated_content,
                    "llm_time_ms": llm_time,
                    "conversation_messages": messages,
                })
                return

            for tc in tool_calls_final:
                func_name = tc["function"]["name"]
                if func_name != "query_database":
                    continue

                args_str = tc["function"]["arguments"]
                try:
                    args = json.loads(args_str)
                except json.JSONDecodeError:
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
                    yield _sse_event("error", {"message": tool_result})
                else:
                    try:
                        columns, rows = await _execute_sql(pools, db_name, validated_or_err)
                        result_preview = json.dumps({
                            "columns": columns,
                            "rows": rows[:20],  # Preview first 20 rows
                            "total_rows": len(rows),
                        }, ensure_ascii=False)
                        yield _sse_event("result", {
                            "columns": columns,
                            "rows": rows[:100],
                            "total_rows": len(rows),
                        })
                        # Prepend language reminder to tool result to prevent
                        # Chinese data values from causing mid-response language switch
                        tool_result = f"[REMINDER: You MUST analyze these results and write ALL conclusions in {lang_name}. The language of data values is irrelevant.]\n\n{result_preview}"
                    except Exception as e:
                        tool_result = f"Query execution failed: {str(e)}"
                        yield _sse_event("error", {"message": tool_result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })

        # Max rounds reached
        yield _sse_event("done", {
            "message": accumulated_content or "已执行最大轮数，分析结束。",
            "llm_time_ms": llm_time,
            "conversation_messages": messages,
        })

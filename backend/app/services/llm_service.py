"""Service layer for LLM-powered natural language queries."""

import time
import re
import logging

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.database import get_pool
from app.services.db_explorer_service import list_schemas, list_tables, list_columns
from app.services.sql_validator import validate_readonly_sql

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_TEMPLATE = """You are a PostgreSQL query generator. Given the database schema below, generate a valid, optimized PostgreSQL SELECT query that answers the user's question.

## Database Schema

{schema_text}

## Rules (MUST follow)

1. ONLY generate SELECT statements. NEVER INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE.
2. Always use double-quoted identifiers for table and column names (e.g., "charging_sessions"."energy_kwh").
3. Use appropriate JOIN syntax when referencing relationships between tables.
4. For time-based grouping, use date_trunc('day', "column") or date_trunc('hour', "column").
5. Return ONLY the SQL query. No markdown fences (```), no explanations, no comments before or after the SQL.
6. Always end with a single semicolon.
7. If the question cannot be answered with the given schema, return: -- CANNOT_ANSWER: <reason>
8. Limit results to at most 500 rows unless the user specifies otherwise.
9. Always fully qualify column names with table aliases when using JOINs.

Now generate a SQL query for the following question:"""


def _extract_sql(text: str) -> str:
    """Extract SQL from LLM response, removing markdown fences if present."""
    # Remove markdown code fences
    text = re.sub(r"^```(?:sql)?\s*\n?", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"\n```\s*$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()

    # If starts with -- CANNOT_ANSWER, return as-is
    if text.startswith("-- CANNOT_ANSWER"):
        return text

    # Try to find SELECT statement
    select_match = re.search(r"(SELECT|WITH)\s.+", text, re.IGNORECASE | re.DOTALL)
    if select_match:
        text = select_match.group(0).strip()
        # Remove trailing semicolon for validation, add back later
        if text.endswith(";"):
            text = text[:-1].strip()

    return text


async def _get_schema_text(pools: dict, connection_name: str) -> str:
    """Build a text description of the database schema."""
    try:
        schemas = await list_schemas(pools, connection_name)
    except Exception:
        schemas = ["public"]

    lines = []
    for schema in schemas[:5]:  # Limit schemas
        try:
            tables = await list_tables(pools, connection_name, schema)
        except Exception:
            continue

        for table in tables[:20]:  # Limit tables per schema
            table_name = table["table_name"]
            try:
                cols = await list_columns(pools, connection_name, table_name, schema)
            except Exception:
                continue

            col_lines = []
            for c in cols[:50]:  # Limit columns per table
                nullable = "NULL" if c["is_nullable"] == "YES" else "NOT NULL"
                pk = " PRIMARY KEY" if c["is_primary_key"] else ""
                col_lines.append(f'    "{c["column_name"]}" {c["data_type"]} {nullable}{pk}')

            row_est = table.get("row_count_estimate", "?")
            lines.append(
                f'Table "{schema}"."{table_name}" (~{row_est} rows):\n'
                + "\n".join(col_lines)
            )

    if not lines:
        return "No tables found in any schema."

    return "\n\n".join(lines)


async def execute_nl_query(
    pools: dict,
    connection_name: str,
    llm_config: dict,
    question: str,
) -> dict:
    """
    Execute a natural language query against a database.

    Args:
        pools: Connection pool dict
        connection_name: Target database connection name
        llm_config: LLM config dict (with api_key decrypted)
        question: User's natural language question

    Returns:
        dict with sql, columns, rows, execution_time_ms, llm_call_time_ms
    """
    pool = await get_pool(pools, connection_name)

    # Step 1: Get schema
    schema_text = await _get_schema_text(pools, connection_name)
    if not schema_text or schema_text.startswith("No tables"):
        raise ValueError("目标数据库中没有找到任何表")

    # Step 2: Build prompt
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(schema_text=schema_text)

    # Step 3: Call LLM
    api_base = llm_config["api_base"].rstrip("/")
    api_key = llm_config["api_key"]
    model = llm_config["model"]

    llm_start = time.monotonic()

    async with httpx.AsyncClient(timeout=90, verify=False) as client:
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
                    {"role": "user", "content": question},
                ],
                "temperature": llm_config.get("temperature", 0.1),
                "max_tokens": llm_config.get("max_tokens", 4096),
            },
        )

    llm_time = (time.monotonic() - llm_start) * 1000

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise RuntimeError(f"LLM API 调用失败 ({resp.status_code}): {detail}")

    content = resp.json()["choices"][0]["message"]["content"]
    sql = _extract_sql(content)

    # Check for CANNOT_ANSWER
    if sql.startswith("-- CANNOT_ANSWER"):
        reason = sql.replace("-- CANNOT_ANSWER:", "").strip()
        return {
            "sql": sql,
            "columns": [],
            "rows": [],
            "execution_time_ms": 0,
            "llm_call_time_ms": round(llm_time, 2),
            "cannot_answer": reason,
        }

    # Step 4: Validate SQL
    is_valid, result = validate_readonly_sql(sql)
    if not is_valid:
        raise ValueError(f"LLM 生成的 SQL 不安全: {result}")

    # Step 5: Execute in read-only transaction
    sql_start = time.monotonic()

    async with pool.acquire() as conn:
        try:
            await conn.execute("SET TRANSACTION READ ONLY")
            rows = await conn.fetch(result)
        except Exception as e:
            raise RuntimeError(f"SQL 执行失败: {str(e)}")

    exec_time = (time.monotonic() - sql_start) * 1000

    columns = list(rows[0].keys()) if rows else []

    return {
        "sql": result,
        "columns": columns,
        "rows": [list(r.values()) for r in rows],
        "execution_time_ms": round(exec_time, 2),
        "llm_call_time_ms": round(llm_time, 2),
    }

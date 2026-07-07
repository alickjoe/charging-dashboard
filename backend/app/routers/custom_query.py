"""API routes for custom SQL query execution and saved queries."""

import re
import time

from fastapi import APIRouter, Request, HTTPException

from app.database import get_pool
from app.services.sql_validator import validate_readonly_sql
from app.services.db_explorer_service import list_schemas, list_tables, list_columns
from app.sqlite_store import SavedQueryStore
from app.schemas.custom_query import (
    ExecuteQueryRequest,
    ExecuteQueryResponse,
    SavedQueryCreate,
    SavedQueryUpdate,
    SavedQueryResponse,
    AutocompleteSuggestion,
    AutocompleteResponse,
)

router = APIRouter(prefix="/api/v1/connections", tags=["custom_query"])

# SQL keywords for autocomplete (DQL/query-relevant only)
SQL_KEYWORDS = [
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS",
    "ON", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "IS", "NULL", "EXISTS",
    "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT",
    "CASE", "WHEN", "THEN", "ELSE", "END", "UNION", "ALL",
    "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST",
    "ASC", "DESC", "TRUE", "FALSE",
    "WITH", "RECURSIVE", "OVER", "PARTITION", "ROW_NUMBER", "RANK",
    "DENSE_RANK", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE",
    "DATE_TRUNC", "EXTRACT", "NOW", "CURRENT_DATE", "CURRENT_TIMESTAMP",
    "INTERVAL", "ILIKE", "SIMILAR", "ANY", "SOME",
]


def parse_aliases(sql_text: str) -> dict[str, tuple[str, str]]:
    """Parse table aliases from SQL, returning {alias_lower: (schema, table)}.

    Handles:
        FROM schema.table alias
        FROM schema.table AS alias
        JOIN schema.table alias
        FROM "schema"."table" "alias"
        FROM table alias (schema defaults to 'public')

    Also registers the bare table name and fully qualified name as implicit aliases.
    """
    aliases: dict[str, tuple[str, str]] = {}
    # Match FROM/JOIN table_ref [AS] alias
    pattern = re.compile(
        r'(?:FROM|JOIN)\s+'
        r'((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?)'  # table ref
        r'(?:\s+(?:AS\s+)?((?:"[^"]+"|\w+)))?',          # optional alias
        re.IGNORECASE,
    )
    for m in pattern.finditer(sql_text):
        table_ref = m.group(1)
        alias = m.group(2)

        # Parse schema.table
        if "." in table_ref:
            parts = table_ref.split(".")
            schema = parts[0].strip('"')
            table = parts[1].strip('"')
        else:
            schema = "public"
            table = table_ref.strip('"')

        if alias:
            alias = alias.strip('"')
            aliases[alias.lower()] = (schema, table)
        # Table name itself is an implicit alias
        aliases[table.lower()] = (schema, table)
        # Fully qualified name as alias
        full = f"{schema}.{table}".lower()
        aliases[full] = (schema, table)

    return aliases


@router.post("/{name}/query", response_model=ExecuteQueryResponse)
async def execute_query(name: str, body: ExecuteQueryRequest, request: Request):
    """Execute a custom read-only SQL query against a database connection."""
    # Validate SQL
    is_valid, result = validate_readonly_sql(body.sql)
    if not is_valid:
        raise HTTPException(status_code=400, detail=result)

    try:
        pool = await get_pool(request.app.state.pools, name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    sql_start = time.monotonic()

    try:
        async with pool.acquire() as conn:
            await conn.execute("SET TRANSACTION READ ONLY")
            rows = await conn.fetch(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL 执行失败: {str(e)}")

    exec_time = (time.monotonic() - sql_start) * 1000
    columns = list(rows[0].keys()) if rows else []

    return ExecuteQueryResponse(
        columns=columns,
        rows=[list(r.values()) for r in rows],
        execution_time_ms=round(exec_time, 2),
    )


@router.get("/{name}/queries", response_model=list[SavedQueryResponse])
async def list_saved_queries(name: str, request: Request):
    """List all saved queries for a connection."""
    rows = await SavedQueryStore.list_by_connection(name)
    return [SavedQueryResponse(**r) for r in rows]


@router.post("/{name}/queries", response_model=SavedQueryResponse, status_code=201)
async def create_saved_query(name: str, body: SavedQueryCreate, request: Request):
    """Create a new saved query for a connection."""
    try:
        row = await SavedQueryStore.create(
            connection_name=name,
            name=body.name,
            sql_text=body.sql_text,
        )
        return SavedQueryResponse(**row)
    except Exception as e:
        raise HTTPException(status_code=409, detail=f"创建失败: {str(e)}")


@router.put("/{name}/queries/{query_id}", response_model=SavedQueryResponse)
async def update_saved_query(
    name: str, query_id: int, body: SavedQueryUpdate, request: Request
):
    """Update an existing saved query."""
    row = await SavedQueryStore.update(
        id=query_id,
        name=body.name,
        sql_text=body.sql_text,
    )
    if not row:
        raise HTTPException(status_code=404, detail="查询不存在")
    return SavedQueryResponse(**row)


@router.delete("/{name}/queries/{query_id}", status_code=204)
async def delete_saved_query(name: str, query_id: int, request: Request):
    """Delete a saved query."""
    deleted = await SavedQueryStore.delete(query_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="查询不存在")


@router.get("/{name}/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(name: str, request: Request, prefix: str = "", sql: str = ""):
    """Return autocomplete suggestions based on cursor context.

    Parses the prefix to determine context:
    - No dot: suggest schemas + SQL keywords
    - One dot:
        - If first part is a known alias → suggest columns for that table
        - Otherwise → suggest tables in the schema
    - Two dots: suggest columns for schema.table

    When sql is provided, table aliases from FROM/JOIN clauses are parsed
    so that e.g. `cl.` after `FROM t AS cl` resolves to columns of table t.
    """
    if not prefix:
        return AutocompleteResponse(suggestions=[])

    pools = request.app.state.pools
    parts = prefix.split(".")
    suggestions: list[AutocompleteSuggestion] = []

    # Case-insensitive filter
    def matches(text: str, prefix_lower: str) -> bool:
        return text.lower().startswith(prefix_lower)

    # Parse table aliases from SQL context
    aliases = parse_aliases(sql) if sql else {}

    if len(parts) == 1:
        # No dot: schemas + keywords
        word = parts[0].lower()
        try:
            schemas = await list_schemas(pools, name)
            for s in schemas:
                if matches(s, word):
                    suggestions.append(AutocompleteSuggestion(text=s, type="schema"))
        except Exception:
            pass
        for kw in SQL_KEYWORDS:
            if matches(kw, word):
                suggestions.append(AutocompleteSuggestion(text=kw, type="keyword"))

    elif len(parts) == 2:
        first = parts[0]
        partial = parts[1].lower()

        # Check if first part is a known table alias
        if first.lower() in aliases:
            schema, table = aliases[first.lower()]
            try:
                columns = await list_columns(pools, name, table, schema)
                for c in columns:
                    if matches(c["column_name"], partial):
                        suggestions.append(
                            AutocompleteSuggestion(
                                text=f"{first}.{c['column_name']}", type="column"
                            )
                        )
            except Exception:
                pass
        else:
            # schema.partial_table — return full qualified name
            schema = first
            try:
                tables = await list_tables(pools, name, schema)
                for t in tables:
                    if matches(t["table_name"], partial):
                        suggestions.append(
                            AutocompleteSuggestion(
                                text=f"{schema}.{t['table_name']}", type="table"
                            )
                        )
            except Exception:
                pass

    elif len(parts) >= 3:
        # schema.table.partial_column — return full qualified name
        schema = parts[0]
        table = parts[1]
        partial = parts[2].lower() if len(parts) >= 3 else ""
        try:
            columns = await list_columns(pools, name, table, schema)
            for c in columns:
                if matches(c["column_name"], partial):
                    suggestions.append(
                        AutocompleteSuggestion(
                            text=f"{schema}.{table}.{c['column_name']}", type="column"
                        )
                    )
        except Exception:
            pass

    return AutocompleteResponse(suggestions=suggestions)

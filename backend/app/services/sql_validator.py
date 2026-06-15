"""SQL read-only safety validator."""

import re

FORBIDDEN_KEYWORDS = [
    r"\bINSERT\b",
    r"\bUPDATE\b",
    r"\bDELETE\b",
    r"\bDROP\b",
    r"\bALTER\b",
    r"\bTRUNCATE\b",
    r"\bCREATE\b",
    r"\bREPLACE\b",
    r"\bGRANT\b",
    r"\bREVOKE\b",
    r"\bCOPY\b",
    r"\bVACUUM\b",
    r"\bEXECUTE\b",
    r"\bCALL\b",
    r"\bDO\b",
]

_FORBIDDEN_RE = re.compile("|".join(FORBIDDEN_KEYWORDS), re.IGNORECASE)


def _remove_comments(sql: str) -> str:
    """Remove SQL comments (-- line comments and /* block comments */)."""
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return sql


def _has_multiple_statements(sql: str) -> bool:
    """Check if SQL contains multiple statements (separated by semicolons)."""
    # Remove string literals to avoid matching semicolons inside strings
    no_strings = re.sub(r"'[^']*'", "", sql)
    no_strings = re.sub(r'"[^"]*"', "", no_strings)
    # Find semicolons
    parts = [p.strip() for p in no_strings.split(";") if p.strip()]
    return len(parts) > 1


def validate_readonly_sql(sql: str) -> tuple[bool, str]:
    """
    Validate that SQL is read-only (SELECT or WITH...SELECT).
    
    Returns (is_valid, sanitized_sql_or_error_message).
    """
    if not sql or not sql.strip():
        return False, "SQL 为空"

    sanitized = _remove_comments(sql).strip()

    # Check for forbidden keywords
    if _FORBIDDEN_RE.search(sanitized):
        return False, "SQL 包含禁止的写操作关键字"

    # Check for multiple statements
    if _has_multiple_statements(sanitized):
        return False, "不允许执行多条 SQL 语句"

    # Must start with SELECT or WITH
    upper = sanitized.upper().lstrip()
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        return False, "只允许 SELECT 或 WITH ... SELECT 查询"

    return True, sanitized

"""SQLite-based configuration store for database connections and LLM configs."""

import base64
import sqlite3
import asyncio
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DB_DIR / "config.db"

DDL = """
CREATE TABLE IF NOT EXISTS db_connections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    label         TEXT NOT NULL,
    host          TEXT NOT NULL,
    port          INTEGER NOT NULL DEFAULT 5432,
    database      TEXT NOT NULL,
    username      TEXT NOT NULL,
    password      TEXT NOT NULL,
    ssl_mode      TEXT NOT NULL DEFAULT 'prefer',
    pool_min      INTEGER NOT NULL DEFAULT 2,
    pool_max      INTEGER NOT NULL DEFAULT 10,
    pool_idle     INTEGER NOT NULL DEFAULT 300,
    query_timeout INTEGER NOT NULL DEFAULT 30,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    api_base    TEXT NOT NULL,
    api_key     TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT 'gpt-4o',
    temperature REAL NOT NULL DEFAULT 0.1,
    max_tokens  INTEGER NOT NULL DEFAULT 4096,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_annotations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_name TEXT NOT NULL,
    table_name      TEXT NOT NULL,
    column_name     TEXT,
    annotation      TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_annotations_unique
ON business_annotations(connection_name, table_name, COALESCE(column_name, ''));
"""


def _encode(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


def _decode(s: str) -> str:
    return base64.b64decode(s.encode()).decode()


def _get_conn() -> sqlite3.Connection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def init_db() -> None:
    """Create tables if they don't exist."""
    def _init():
        conn = _get_conn()
        try:
            conn.executescript(DDL)
            conn.commit()
        finally:
            conn.close()
    await asyncio.to_thread(_init)
    logger.info(f"SQLite database initialized at {DB_PATH}")


class ConnectionStore:
    """CRUD operations for db_connections."""

    @staticmethod
    async def list_all() -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM db_connections ORDER BY created_at DESC"
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_by_name(name: str) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT * FROM db_connections WHERE name = ?", (name,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def create(data: dict) -> dict:
        data = {**data}
        data["password"] = _encode(data["password"])

        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    """INSERT INTO db_connections
                       (name, label, host, port, database, username, password,
                        ssl_mode, pool_min, pool_max, pool_idle, query_timeout)
                       VALUES (:name, :label, :host, :port, :database, :username, :password,
                               :ssl_mode, :pool_min, :pool_max, :pool_idle, :query_timeout)""",
                    data,
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM db_connections WHERE name = ?", (data["name"],)
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def update(name: str, data: dict) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                existing = conn.execute(
                    "SELECT * FROM db_connections WHERE name = ?", (name,)
                ).fetchone()
                if not existing:
                    return None

                merged = dict(existing)
                for k, v in data.items():
                    if v is not None:
                        merged[k] = v
                if "password" in data and data["password"] is not None:
                    merged["password"] = _encode(data["password"])
                else:
                    merged["password"] = existing["password"]

                merged["updated_at"] = None  # triggers default
                conn.execute(
                    """UPDATE db_connections SET
                       label=:label, host=:host, port=:port, database=:database,
                       username=:username, password=:password, ssl_mode=:ssl_mode,
                       pool_min=:pool_min, pool_max=:pool_max, pool_idle=:pool_idle,
                       query_timeout=:query_timeout, updated_at=datetime('now')
                       WHERE name=:name""",
                    {**merged, "name": name},
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM db_connections WHERE name = ?", (name,)
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def delete(name: str) -> bool:
        def _do():
            conn = _get_conn()
            try:
                cur = conn.execute(
                    "DELETE FROM db_connections WHERE name = ?", (name,)
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    def decrypt_password(row: dict) -> dict:
        """Decode the password field in a connection row."""
        if row and "password" in row:
            try:
                row["password"] = _decode(row["password"])
            except Exception:
                pass
        return row


class LLMConfigStore:
    """CRUD operations for llm_configs."""

    @staticmethod
    async def list_all() -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM llm_configs ORDER BY created_at DESC"
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_by_id(id: int) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT * FROM llm_configs WHERE id = ?", (id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_default() -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT * FROM llm_configs WHERE is_default = 1 LIMIT 1"
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def create(data: dict) -> dict:
        data = {**data}
        data["api_key"] = _encode(data["api_key"])

        def _do():
            conn = _get_conn()
            try:
                if data.get("is_default"):
                    conn.execute("UPDATE llm_configs SET is_default = 0")
                conn.execute(
                    """INSERT INTO llm_configs
                       (name, api_base, api_key, model, temperature, max_tokens, is_default)
                       VALUES (:name, :api_base, :api_key, :model, :temperature, :max_tokens, :is_default)""",
                    data,
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM llm_configs WHERE name = ?", (data["name"],)
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def update(id: int, data: dict) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                existing = conn.execute(
                    "SELECT * FROM llm_configs WHERE id = ?", (id,)
                ).fetchone()
                if not existing:
                    return None

                merged = dict(existing)
                for k, v in data.items():
                    if v is not None:
                        merged[k] = v
                if "api_key" in data and data["api_key"] is not None:
                    merged["api_key"] = _encode(data["api_key"])
                else:
                    merged["api_key"] = existing["api_key"]

                if merged.get("is_default"):
                    conn.execute(
                        "UPDATE llm_configs SET is_default = 0 WHERE id != ?", (id,)
                    )

                conn.execute(
                    """UPDATE llm_configs SET
                       name=:name, api_base=:api_base, api_key=:api_key,
                       model=:model, temperature=:temperature,
                       max_tokens=:max_tokens, is_default=:is_default,
                       updated_at=datetime('now')
                       WHERE id=:id""",
                    {**merged, "id": id},
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM llm_configs WHERE id = ?", (id,)
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def delete(id: int) -> bool:
        def _do():
            conn = _get_conn()
            try:
                cur = conn.execute("DELETE FROM llm_configs WHERE id = ?", (id,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    def decrypt_api_key(row: dict) -> dict:
        """Decode the api_key field."""
        if row and "api_key" in row:
            try:
                row["api_key"] = _decode(row["api_key"])
            except Exception:
                pass
        return row

    @staticmethod
    def mask_api_key(key: str) -> str:
        """Return a masked version of the API key for display."""
        if not key or len(key) < 8:
            return "***"
        return key[:3] + "..." + key[-4:]


class AnnotationStore:
    """CRUD operations for business_annotations."""

    @staticmethod
    async def list_by_connection(connection_name: str) -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM business_annotations WHERE connection_name = ? ORDER BY table_name, column_name",
                    (connection_name,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def upsert(
        connection_name: str,
        table_name: str,
        column_name: Optional[str],
        annotation: str,
    ) -> dict:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    """INSERT INTO business_annotations
                       (connection_name, table_name, column_name, annotation)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(connection_name, table_name, COALESCE(column_name, ''))
                       DO UPDATE SET annotation = excluded.annotation,
                                     updated_at = datetime('now')""",
                    (connection_name, table_name, column_name, annotation),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM business_annotations WHERE connection_name = ? AND table_name = ? AND column_name IS ?",
                    (connection_name, table_name, column_name),
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def delete(
        connection_name: str,
        table_name: str,
        column_name: Optional[str],
    ) -> bool:
        def _do():
            conn = _get_conn()
            try:
                cur = conn.execute(
                    "DELETE FROM business_annotations WHERE connection_name = ? AND table_name = ? AND column_name IS ?",
                    (connection_name, table_name, column_name),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

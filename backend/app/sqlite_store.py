"""SQLite-based configuration store for database connections and LLM configs."""

import base64
import os
import sqlite3
import asyncio
import logging
import threading
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_DATA_DIR = os.environ.get("DATA_DIR")
if _DATA_DIR:
    DB_DIR = Path(_DATA_DIR)
else:
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

CREATE TABLE IF NOT EXISTS conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL DEFAULT '',
    connection_name TEXT NOT NULL,
    llm_config_id   INTEGER NOT NULL,
    connection_schemas TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    question        TEXT NOT NULL DEFAULT '',
    answer_blocks   TEXT NOT NULL DEFAULT '[]',
    llm_time_ms     REAL,
    raw_messages    TEXT NOT NULL DEFAULT '[]',
    skill_ids       TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_queries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_name TEXT NOT NULL,
    name            TEXT NOT NULL,
    sql_text        TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_queries_unique
ON saved_queries(connection_name, name);

CREATE TABLE IF NOT EXISTS skills (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL UNIQUE,
    description         TEXT NOT NULL DEFAULT '',
    system_prompt       TEXT NOT NULL DEFAULT '',
    user_prompt_template TEXT NOT NULL DEFAULT '',
    source_questions    TEXT NOT NULL DEFAULT '[]',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


# ─── Secret encryption ────────────────────────────────────────────────
# Sensitive fields (db_connections.password, llm_configs.api_key) are
# encrypted with Fernet (AES-128-CBC + HMAC-SHA256) instead of the previous
# reversible base64 encoding. The key lives in the user profile directory
# and is never shipped with the installer or the config database.

_KEY_FILE_ENV = "AIDBQUERY_KEY_FILE"

_fernet_lock = threading.Lock()
_fernet: Optional[Fernet] = None


def _key_path() -> Path:
    override = os.environ.get(_KEY_FILE_ENV)
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home())
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))
    return base / "aidbquery" / "secret.key"


def _load_or_create_key() -> bytes:
    key_file = _key_path()
    if key_file.exists():
        return key_file.read_bytes()
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    key_file.write_bytes(key)
    try:
        os.chmod(key_file, 0o600)
    except OSError:
        pass  # Windows may not support chmod; APPDATA is user-private
    return key


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        with _fernet_lock:
            if _fernet is None:
                _fernet = Fernet(_load_or_create_key())
    return _fernet


def _encrypt(s: str) -> str:
    return _get_fernet().encrypt(s.encode("utf-8")).decode("utf-8")


def _decode_legacy(s: str) -> str:
    """Decode a secret stored with the legacy base64 encoding."""
    return base64.b64decode(s.encode()).decode()


def _is_legacy_base64(s: str) -> bool:
    """True when a stored value is legacy base64, not a Fernet token."""
    try:
        _get_fernet().decrypt(s.encode("utf-8"))
        return False
    except InvalidToken:
        pass
    try:
        base64.b64decode(s.encode(), validate=True)
        return True
    except Exception:
        return False


def _decrypt(s: str) -> str:
    """Decrypt a stored secret.

    Tries the current Fernet key first; falls back to the legacy base64
    encoding so databases created before encryption stay readable.
    """
    try:
        return _get_fernet().decrypt(s.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        pass
    try:
        return _decode_legacy(s)
    except Exception:
        return s


def _migrate_legacy_secrets() -> None:
    """Rewrite secrets stored with the legacy base64 encoding as encrypted values."""
    conn = _get_conn()
    try:
        for table, column in (("db_connections", "password"), ("llm_configs", "api_key")):
            rows = conn.execute(f"SELECT id, {column} FROM {table}").fetchall()
            for r in rows:
                value = r[column]
                if value and _is_legacy_base64(value):
                    conn.execute(
                        f"UPDATE {table} SET {column} = ? WHERE id = ?",
                        (_encrypt(_decode_legacy(value)), r["id"]),
                    )
        conn.commit()
    finally:
        conn.close()


def _get_conn() -> sqlite3.Connection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def init_db() -> None:
    """Create tables if they don't exist, and run migrations."""
    def _init():
        conn = _get_conn()
        try:
            conn.executescript(DDL)
            _migrate_legacy_secrets()
            # Migration: add skill_ids column to conversation_messages if missing
            try:
                conn.execute(
                    "ALTER TABLE conversation_messages ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '[]'"
                )
            except sqlite3.OperationalError:
                pass  # Column already exists
            # Migration: add connection_schemas column to conversations if missing
            try:
                conn.execute(
                    "ALTER TABLE conversations ADD COLUMN connection_schemas TEXT NOT NULL DEFAULT '[]'"
                )
            except sqlite3.OperationalError:
                pass  # Column already exists
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
        data["password"] = _encrypt(data["password"])

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
                    merged["password"] = _encrypt(data["password"])
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
        """Decrypt the password field in a connection row."""
        if row and "password" in row:
            row["password"] = _decrypt(row["password"])
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
        data["api_key"] = _encrypt(data["api_key"])

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
                    merged["api_key"] = _encrypt(data["api_key"])
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
        """Decrypt the api_key field."""
        if row and "api_key" in row:
            row["api_key"] = _decrypt(row["api_key"])
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


class ConversationStore:
    """CRUD operations for conversations and conversation_messages."""

    @staticmethod
    def _parse_connection_schemas(raw) -> list:
        """Parse the connection_schemas JSON column into a list."""
        import json as _json
        if not raw:
            return []
        try:
            val = _json.loads(raw)
            return val if isinstance(val, list) else []
        except (_json.JSONDecodeError, TypeError):
            return []

    @staticmethod
    async def create(
        connection_name: str,
        llm_config_id: int,
        title: str = "",
        connection_schemas: str = '[]',
    ) -> dict:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    "INSERT INTO conversations (title, connection_name, llm_config_id, connection_schemas) VALUES (?, ?, ?, ?)",
                    (title, connection_name, llm_config_id, connection_schemas),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM conversations WHERE id = last_insert_rowid()"
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def list_all() -> list[dict]:
        def _do():
            import json as _json
            conn = _get_conn()
            try:
                rows = conn.execute(
                    """SELECT c.*, COUNT(CASE WHEN cm.role = 'user' THEN 1 END) as message_count
                       FROM conversations c
                       LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
                       GROUP BY c.id
                       ORDER BY c.updated_at DESC"""
                ).fetchall()
                results = [dict(r) for r in rows]

                # Parse connection_schemas JSON for each conversation
                for r in results:
                    r["connection_schemas"] = ConversationStore._parse_connection_schemas(
                        r.get("connection_schemas")
                    )

                # Aggregate skill_ids across all messages per conversation
                conv_ids = [r["id"] for r in results]
                if conv_ids:
                    placeholders = ",".join("?" for _ in conv_ids)
                    skill_rows = conn.execute(
                        f"""SELECT conversation_id, skill_ids
                            FROM conversation_messages
                            WHERE conversation_id IN ({placeholders})
                            AND skill_ids != '[]'""",
                        conv_ids,
                    ).fetchall()
                    skill_map: dict[int, set] = {}
                    for sr in skill_rows:
                        cid = sr["conversation_id"]
                        try:
                            ids = _json.loads(sr["skill_ids"])
                            skill_map.setdefault(cid, set()).update(ids)
                        except (_json.JSONDecodeError, TypeError):
                            pass
                    for r in results:
                        r["skill_ids"] = sorted(skill_map.get(r["id"], set()))
                else:
                    for r in results:
                        r["skill_ids"] = []

                return results
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_by_id(conversation_id: int) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
                ).fetchone()
                if not row:
                    return None
                result = dict(row)
                result["connection_schemas"] = ConversationStore._parse_connection_schemas(
                    result.get("connection_schemas")
                )
                msgs = conn.execute(
                    "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC",
                    (conversation_id,),
                ).fetchall()
                result["messages"] = [dict(m) for m in msgs]
                return result
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def delete(conversation_id: int) -> bool:
        def _do():
            conn = _get_conn()
            try:
                conn.execute("DELETE FROM conversation_messages WHERE conversation_id = ?", (conversation_id,))
                cur = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def update_title(conversation_id: int, title: str) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
                    (title, conversation_id),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def add_message(
        conversation_id: int,
        role: str,
        question: str,
        answer_blocks: str,
        llm_time_ms: Optional[float],
        raw_messages: str,
        skill_ids: str = '[]',
    ) -> dict:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    """INSERT INTO conversation_messages
                       (conversation_id, role, question, answer_blocks, llm_time_ms, raw_messages, skill_ids)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (conversation_id, role, question, answer_blocks, llm_time_ms, raw_messages, skill_ids),
                )
                conn.execute(
                    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
                    (conversation_id,),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM conversation_messages WHERE id = last_insert_rowid()"
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_messages(conversation_id: int) -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC",
                    (conversation_id,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_latest_raw_messages(conversation_id: int) -> list:
        """Return the raw_messages JSON from the latest message, or empty list."""
        import json as _json
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT raw_messages FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
                    (conversation_id,),
                ).fetchone()
                if row and row["raw_messages"]:
                    return _json.loads(row["raw_messages"])
                return []
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_all_user_questions() -> list[dict]:
        """Return all distinct user questions from conversation_messages, newest first."""
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    """SELECT id, question, conversation_id, created_at
                       FROM conversation_messages
                       WHERE role = 'user' AND question != ''
                       ORDER BY created_at DESC"""
                ).fetchall()
                seen = set()
                result = []
                for r in rows:
                    q = r["question"]
                    if q not in seen:
                        seen.add(q)
                        result.append(dict(r))
                return result
            finally:
                conn.close()
        return await asyncio.to_thread(_do)


class SavedQueryStore:
    """CRUD operations for saved_queries."""

    @staticmethod
    async def list_by_connection(connection_name: str) -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM saved_queries WHERE connection_name = ? ORDER BY updated_at DESC",
                    (connection_name,),
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
                    "SELECT * FROM saved_queries WHERE id = ?", (id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def create(connection_name: str, name: str, sql_text: str) -> dict:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    "INSERT INTO saved_queries (connection_name, name, sql_text) VALUES (?, ?, ?)",
                    (connection_name, name, sql_text),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM saved_queries WHERE id = last_insert_rowid()"
                ).fetchone()
                return dict(row)
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def update(id: int, name: str, sql_text: str) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                existing = conn.execute(
                    "SELECT * FROM saved_queries WHERE id = ?", (id,)
                ).fetchone()
                if not existing:
                    return None
                conn.execute(
                    "UPDATE saved_queries SET name = ?, sql_text = ?, updated_at = datetime('now') WHERE id = ?",
                    (name, sql_text, id),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM saved_queries WHERE id = ?", (id,)
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
                cur = conn.execute(
                    "DELETE FROM saved_queries WHERE id = ?", (id,)
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)


class SkillStore:
    """CRUD operations for skills."""

    @staticmethod
    async def list_all() -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM skills ORDER BY created_at DESC"
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
                    "SELECT * FROM skills WHERE id = ?", (id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_by_name(name: str) -> Optional[dict]:
        def _do():
            conn = _get_conn()
            try:
                row = conn.execute(
                    "SELECT * FROM skills WHERE name = ?", (name,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def create(data: dict) -> dict:
        def _do():
            conn = _get_conn()
            try:
                conn.execute(
                    """INSERT INTO skills
                       (name, description, system_prompt, user_prompt_template, source_questions)
                       VALUES (:name, :description, :system_prompt, :user_prompt_template, :source_questions)""",
                    data,
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM skills WHERE id = last_insert_rowid()"
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
                    "SELECT * FROM skills WHERE id = ?", (id,)
                ).fetchone()
                if not existing:
                    return None

                merged = dict(existing)
                for k, v in data.items():
                    if v is not None:
                        merged[k] = v
                merged["updated_at"] = None

                conn.execute(
                    """UPDATE skills SET
                       name=:name, description=:description,
                       system_prompt=:system_prompt, user_prompt_template=:user_prompt_template,
                       source_questions=:source_questions, updated_at=datetime('now')
                       WHERE id=:id""",
                    {**merged, "id": id},
                )
                conn.commit()
                row = conn.execute(
                    "SELECT * FROM skills WHERE id = ?", (id,)
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
                cur = conn.execute(
                    "DELETE FROM skills WHERE id = ?", (id,)
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

    @staticmethod
    async def get_by_ids(ids: list[int]) -> list[dict]:
        def _do():
            conn = _get_conn()
            try:
                placeholders = ",".join("?" for _ in ids)
                rows = conn.execute(
                    f"SELECT * FROM skills WHERE id IN ({placeholders})",
                    ids,
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_do)

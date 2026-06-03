"""Load and parse database connection configuration from YAML."""

import os
import re
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel


class PoolConfig(BaseModel):
    min_size: int = 2
    max_size: int = 10
    idle_timeout: int = 300


class ConnectionConfig(BaseModel):
    name: str
    label: str
    type: str = "postgresql"
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    ssl_mode: str = "prefer"
    pool: PoolConfig = PoolConfig()
    readonly: bool = False
    query_timeout: int = 30


class AppConfig(BaseModel):
    connections: list[ConnectionConfig]


_ENV_VAR_RE = re.compile(r"\$\{(\w+)(?::([^}]*))?\}")


def _resolve_env_vars(value: str) -> str:
    """Replace ${VAR:default} patterns with environment variable values."""

    def _replacer(match):
        var_name = match.group(1)
        default = match.group(2) or ""
        return os.environ.get(var_name, default)

    return _ENV_VAR_RE.sub(_replacer, value)


def load_config(config_path: Optional[str] = None) -> AppConfig:
    """Load and parse the YAML configuration file."""
    if config_path is None:
        config_path = os.environ.get(
            "DATABASES_CONFIG_PATH",
            Path(__file__).parent.parent / "config" / "databases.yaml",
        )

    with open(config_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    # Resolve environment variable placeholders in the raw dict
    def resolve_dict(d):
        if isinstance(d, dict):
            return {k: resolve_dict(v) for k, v in d.items()}
        if isinstance(d, list):
            return [resolve_dict(i) for i in d]
        if isinstance(d, str):
            return _resolve_env_vars(d)
        return d

    resolved = resolve_dict(raw)
    return AppConfig(**resolved)

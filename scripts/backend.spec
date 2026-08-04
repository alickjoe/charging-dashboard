# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the FastAPI backend (backend.exe)."""

from PyInstaller.utils.hooks import collect_all

# Collect asyncpg binaries (.pyd/.dll) and hidden imports automatically
asyncpg_datas, asyncpg_binaries, asyncpg_hidden = collect_all('asyncpg')

a = Analysis(
    ['../backend/run.py'],
    pathex=['../backend'],
    binaries=asyncpg_binaries,
    datas=asyncpg_datas,
    hiddenimports=[
        # asyncpg internals
        'asyncpg',
        'asyncpg.pgproto',
        # FastAPI / Starlette / Uvicorn internals
        'fastapi',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # Other runtime deps that may be imported dynamically
        'pydantic',
        'pydantic_settings',
        'tenacity',
        'httpx',
        'dateutil',
        # Application modules (safety net for PyInstaller's analysis)
        'app',
        'app.main',
        'app.database',
        'app.sqlite_store',
        'app.routers',
        'app.routers.connections',
        'app.routers.connection_admin',
        'app.routers.databases',
        'app.routers.charts',
        'app.routers.llm',
        'app.routers.conversations',
        'app.routers.custom_query',
        'app.routers.skills',
        'app.schemas',
        'app.schemas.annotation',
        'app.schemas.chart',
        'app.schemas.connection',
        'app.schemas.conversation',
        'app.schemas.custom_query',
        'app.schemas.database',
        'app.schemas.llm',
        'app.schemas.skill',
        'app.services',
        'app.services.chart_service',
        'app.services.connection_service',
        'app.services.db_explorer_service',
        'app.services.llm_agent_service',
        'app.services.llm_service',
        'app.services.sql_validator',
    ] + asyncpg_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='aiquery-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # hide console window; logs go to launcher-managed file
)

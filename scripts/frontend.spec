# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the frontend static-file server (server.exe)."""

a = Analysis(
    ['../frontend/server.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Embed the built frontend assets so server.py can find them at runtime
        ('../frontend/dist', 'dist'),
    ],
    hiddenimports=[
        'http.server',
        'urllib.request',
        'urllib.error',
        'mimetypes',
        'json',
        'logging',
    ],
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
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # hide console window
)

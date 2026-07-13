# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the system-tray launcher (AIDBQuery.exe)."""

a = Analysis(
    ['../launcher.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        'pystray',
        'pystray._win32',
        'pystray._base',
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
    name='AIDBQuery',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # hide console window
    icon=None,              # uses programmatic icon
)

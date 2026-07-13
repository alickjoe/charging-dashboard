$content = @'
@echo off
REM ===========================================================================
REM  AI DB Query - One-Click Windows Installer Build Script
REM
REM  Prerequisites (must be installed and on PATH):
REM    1. Python 3.12+  (with pip)
REM    2. Node.js 20+    (with npm)
REM    3. NSIS 3.x       (makensis.exe)
REM
REM  Output: dist\AIDBQuery-Setup.exe
REM ===========================================================================

cd /d "%~dp0\.."

set DIST_DIR=dist
set INSTALLER_STAGING=%DIST_DIR%\installer

echo ============================================================
echo   AI DB Query - Installer Build
echo ============================================================
echo.

echo [DEBUG] script started at %time%
echo [INFO] Checking prerequisites...

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found on PATH
    exit /b 1
)
echo [DEBUG] python OK

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found on PATH
    exit /b 1
)
echo [DEBUG] node OK

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found on PATH
    exit /b 1
)
echo [DEBUG] npm OK

where makensis >nul 2>&1
if errorlevel 1 (
    echo [ERROR] NSIS makensis not found on PATH
    exit /b 1
)
echo [DEBUG] makensis OK

echo [INFO] Prerequisites OK.
echo.

echo [STEP 1/8] Building frontend (npm install + vite build)...
cd frontend
call npm install --prefer-offline --no-audit --no-fund
if errorlevel 1 (
    cd ..
    echo [ERROR] npm install failed
    exit /b 1
)
call npm run build
if errorlevel 1 (
    cd ..
    echo [ERROR] frontend build failed
    exit /b 1
)
cd ..
echo [STEP 1/8] Frontend build complete.
echo.

echo [STEP 2/8] Installing build dependencies...
pip install -r scripts\requirements-installer.txt
if errorlevel 1 (
    echo [ERROR] pip install failed
    exit /b 1
)
echo [STEP 2/8] Build dependencies installed.
echo.

echo [STEP 3/8] Installing backend runtime dependencies...
pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [ERROR] backend pip install failed
    exit /b 1
)
echo [STEP 3/8] Backend dependencies installed.
echo.

echo [STEP 4/8] Building launcher (AIDBQuery.exe)...
python -m PyInstaller scripts\launcher.spec --distpath "%INSTALLER_STAGING%" --workpath "%DIST_DIR%\build\launcher" --noconfirm --clean
if errorlevel 1 (
    echo [ERROR] launcher build failed
    exit /b 1
)
echo [STEP 4/8] Launcher built.
echo.

echo [STEP 5/8] Building backend (backend.exe)...
python -m PyInstaller scripts\backend.spec --distpath "%INSTALLER_STAGING%" --workpath "%DIST_DIR%\build\backend" --noconfirm --clean
if errorlevel 1 (
    echo [ERROR] backend build failed
    exit /b 1
)
echo [STEP 5/8] Backend built.
echo.

echo [STEP 6/8] Building frontend server (server.exe)...
python -m PyInstaller scripts\frontend.spec --distpath "%INSTALLER_STAGING%" --workpath "%DIST_DIR%\build\frontend" --noconfirm --clean
if errorlevel 1 (
    echo [ERROR] frontend server build failed
    exit /b 1
)
echo [STEP 6/8] Frontend server built.
echo.

echo [INFO] Copying initial database...
if not exist "%INSTALLER_STAGING%\data" mkdir "%INSTALLER_STAGING%\data"
copy /Y "backend\data\config.db" "%INSTALLER_STAGING%\data\config.db"
if errorlevel 1 (
    echo [ERROR] database copy failed
    exit /b 1
)
echo [INFO] Database copied.
echo.

echo [STEP 7/8] Generating installer script...
powershell -ExecutionPolicy Bypass -File scripts\write_installer.ps1
if errorlevel 1 (
    echo [ERROR] installer script generation failed
    exit /b 1
)
echo [STEP 7/8] Installer script generated.
echo.

echo [STEP 8/8] Building NSIS installer...
makensis installer\installer.nsi
if errorlevel 1 (
    echo [ERROR] NSIS build failed
    exit /b 1
)
echo [STEP 8/8] Installer built.
echo.

echo ============================================================
echo   BUILD SUCCESSFUL
echo   Output: %DIST_DIR%\AIDBQuery-Setup.exe
echo ============================================================
exit /b 0
'@

$path = Join-Path $PSScriptRoot "build.bat"
$content | Set-Content -Path $path -Encoding ASCII
Write-Host "build.bat written successfully"

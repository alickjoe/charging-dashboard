$content = @'
@echo off
REM ===========================================================================
REM  AI DB Query - One-Click Windows Installer Build Script (Electron)
REM
REM  Prerequisites (must be installed and on PATH):
REM    1. Python 3.12+  (with pip)
REM    2. Node.js 20+    (with npm)
REM
REM  Output: dist\AI DB Query Setup *.exe
REM ===========================================================================

cd /d "%~dp0\.."

set DIST_DIR=dist

echo ============================================================
echo   AI DB Query - Electron Installer Build
echo ============================================================
echo.

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

echo [INFO] Prerequisites OK.
echo.

echo [STEP 1/5] Building frontend (npm install + vite build)...
cd frontend
call npm install --prefer-offline --no-audit --no-fund
if errorlevel 1 (
    cd ..
    echo [ERROR] npm install failed
    exit /b 1
)
set VITE_ELECTRON_BUILD=true
call npm run build
if errorlevel 1 (
    cd ..
    echo [ERROR] frontend build failed
    exit /b 1
)
cd ..
echo [STEP 1/5] Frontend build complete.
echo.

echo [STEP 2/5] Installing build dependencies...
pip install -r scripts\requirements-installer.txt
if errorlevel 1 (
    echo [ERROR] pip install failed
    exit /b 1
)
echo [STEP 2/5] Build dependencies installed.
echo.

echo [STEP 3/5] Installing backend runtime dependencies...
pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [ERROR] backend pip install failed
    exit /b 1
)
echo [STEP 3/5] Backend dependencies installed.
echo.

echo [STEP 4/5] Building backend (aiquery-backend.exe)...
python -m PyInstaller scripts\backend.spec --distpath "%DIST_DIR%" --workpath "%DIST_DIR%\build\backend" --noconfirm --clean
if errorlevel 1 (
    echo [ERROR] backend build failed
    exit /b 1
)
echo [STEP 4/5] Backend built.
echo.

echo [STEP 5/5] Building Electron installer...
if not exist "electron\dist" mkdir "electron\dist"
xcopy /E /Y "frontend\dist\*" "electron\dist\"
if errorlevel 1 (
    echo [ERROR] frontend dist copy failed
    exit /b 1
)
cd electron
call npm install --prefer-offline --no-audit --no-fund
if errorlevel 1 (
    cd ..
    echo [ERROR] electron npm install failed
    exit /b 1
)
call npx electron-builder --win
if errorlevel 1 (
    cd ..
    echo [ERROR] electron-builder failed
    exit /b 1
)
cd ..
echo [STEP 5/5] Electron installer built.
echo.

echo ============================================================
echo   BUILD SUCCESSFUL
echo   Output: %DIST_DIR%\AI DB Query Setup *.exe
echo ============================================================
exit /b 0
'@

$path = Join-Path $PSScriptRoot "build.bat"
$content | Set-Content -Path $path -Encoding ASCII
Write-Host "build.bat written successfully"

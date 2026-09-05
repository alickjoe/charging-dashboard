<#
.SYNOPSIS
  Builds the aidbquery-runtime-win32-x64 npm package: a portable CPython 3.12,
  the pre-installed backend site-packages, and the Electron runtime.
  Everything is pinned by SHA-256 so CI builds are reproducible.

.DESCRIPTION
  Run on Windows (CI or a local Windows box) from the repo root:
    powershell -ExecutionPolicy Bypass -File scripts/build-runtime.ps1 [-RuntimePkgVersion 1.2.3]

  Output: desktop/runtime-build/package/aidbquery-runtime-win32-x64-<version>.tgz
#>
param(
  [string]$PbsUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only.tar.gz",
  # sha256 of cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only.tar.gz
  [string]$PbsSha256 = "e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f",
  [string]$ElectronVersion = "34.5.8",
  # sha256 of electron-v34.5.8-win32-x64.zip (from the official SHASUMS256.txt)
  [string]$ElectronSha256 = "ac880c62339b91c6833b3edaabbb62d9148b27f01b410a3b2100cb4ce92b7b11",
  [string]$RuntimePkgVersion = "",
  [string]$OutDir = "",
  # Interpreter used for `pip install --target`. Must be CPython 3.12 win-amd64
  # so the binary wheels (pydantic-core, cryptography, asyncpg) match the
  # bundled python-build-standalone runtime.
  [string]$PipPython = "python"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x slower with the progress bar

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RuntimePkgVersion) {
  $pkg = Get-Content (Join-Path $repoRoot 'desktop\package.json') -Raw | ConvertFrom-Json
  $RuntimePkgVersion = $pkg.version
}
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'desktop\runtime-build' }

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Assert-Sha256($file, $expected) {
  $actual = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected.ToLower()) {
    throw "SHA-256 mismatch for $file`n  expected: $expected`n  actual:   $actual"
  }
  Write-Host "  sha256 OK: $(Split-Path -Leaf $file)"
}

$fullOut = [System.IO.Path]::GetFullPath($OutDir)
$protected = @(
  $repoRoot,
  (Join-Path $repoRoot 'desktop'),
  (Join-Path $repoRoot 'desktop\vendor'),
  (Join-Path $repoRoot 'scripts'),
  (Join-Path $repoRoot 'backend'),
  (Join-Path $repoRoot 'frontend')
) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
if ($protected -contains $fullOut.TrimEnd('\')) {
  throw "Refusing to use protected directory as OutDir: $fullOut"
}
if (Test-Path $fullOut) { Remove-Item -Recurse -Force $fullOut }
New-Item -ItemType Directory -Force -Path $fullOut | Out-Null
$OutDir = $fullOut
$downloads = Join-Path $OutDir '_downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null

# ---------------------------------------------------------------------------
Write-Step "1/5 Download + verify python-build-standalone"
# ---------------------------------------------------------------------------
$pbsFile = Join-Path $downloads 'pbs-cpython-install_only.tar.gz'
Invoke-WebRequest -Uri $PbsUrl -OutFile $pbsFile -UseBasicParsing
Assert-Sha256 $pbsFile $PbsSha256

Write-Step "2/5 Extract portable Python"
$pythonStage = Join-Path $OutDir '_python'
New-Item -ItemType Directory -Force -Path $pythonStage | Out-Null
tar -xzf $pbsFile -C $pythonStage
if ($LASTEXITCODE -ne 0) { throw "tar extract failed" }
$runtimeDir = Join-Path $OutDir 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Move-Item (Join-Path $pythonStage 'python') (Join-Path $runtimeDir 'python')
Remove-Item -Recurse -Force $pythonStage
& (Join-Path $runtimeDir 'python\python.exe') -VV

# ---------------------------------------------------------------------------
Write-Step "3/5 Install backend dependencies into site-packages"
# ---------------------------------------------------------------------------
$pyVer = & $PipPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($pyVer -ne '3.12') {
  throw "PipPython must be CPython 3.12 (got $pyVer) so binary wheels match the bundled runtime"
}
$siteDir = Join-Path $runtimeDir 'site-packages'
& $PipPython -m pip install --disable-pip-version-check --no-cache-dir `
  -r (Join-Path $repoRoot 'backend\requirements.txt') --target $siteDir
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
foreach ($mod in 'fastapi', 'uvicorn', 'asyncpg', 'cryptography', 'pydantic') {
  if (-not (Test-Path (Join-Path $siteDir $mod))) {
    throw "site-packages sanity check failed: $mod missing"
  }
}
Write-Host "  site-packages OK"

# ---------------------------------------------------------------------------
Write-Step "4/5 Download + verify + extract Electron"
# ---------------------------------------------------------------------------
$electronUrl = "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip"
$electronZip = Join-Path $downloads "electron-v$ElectronVersion-win32-x64.zip"
Invoke-WebRequest -Uri $electronUrl -OutFile $electronZip -UseBasicParsing
Assert-Sha256 $electronZip $ElectronSha256
$electronDir = Join-Path $runtimeDir 'electron'
Expand-Archive -Path $electronZip -DestinationPath $electronDir -Force
if (-not (Test-Path (Join-Path $electronDir 'electron.exe'))) { throw "electron.exe missing after extract" }

# ---------------------------------------------------------------------------
Write-Step "5/5 Assemble + pack npm package"
# ---------------------------------------------------------------------------
$pkgDir = Join-Path $OutDir 'package'
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
$pkgJson = @"
{
  "name": "aidbquery-runtime-win32-x64",
  "version": "$RuntimePkgVersion",
  "description": "Portable runtime (CPython 3.12 + backend site-packages + Electron) for the aidbquery desktop app on Windows x64",
  "license": "UNLICENSED",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alickjoe/charging-dashboard.git",
    "directory": "desktop"
  },
  "os": ["win32"],
  "cpu": ["x64"],
  "files": ["runtime"],
  "publishConfig": { "access": "public" }
}
"@
Set-Content -Path (Join-Path $pkgDir 'package.json') -Value $pkgJson -Encoding ASCII
Move-Item $runtimeDir (Join-Path $pkgDir 'runtime')

Push-Location $pkgDir
try {
  npm pack --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm pack failed" }
} finally {
  Pop-Location
}

$tgz = Join-Path $pkgDir "aidbquery-runtime-win32-x64-$RuntimePkgVersion.tgz"
if (-not (Test-Path $tgz)) { throw "expected tarball not found: $tgz" }
$sizeMb = [math]::Round((Get-Item $tgz).Length / 1MB, 1)
Write-Host "`n=== DONE: $tgz ($sizeMb MB) ===" -ForegroundColor Green

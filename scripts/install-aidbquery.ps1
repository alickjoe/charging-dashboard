<#
.SYNOPSIS
  AI DB Query - user-level bootstrap installer for Windows 10/11.
  No admin rights required at any step.

.DESCRIPTION
  1. Ensures Node.js >= 18 is available (downloads a portable copy into
     %LOCALAPPDATA%\Programs\aidbquery\node when missing or too old)
  2. Installs the `aidbquery` npm package globally (user prefix %APPDATA%\npm)
  3. Creates user-level Start Menu + Desktop shortcuts (unless -NoShortcuts)
  4. Optionally launches the app (-Launch)

  Local run:
    powershell -ExecutionPolicy Bypass -File scripts/install-aidbquery.ps1 -Launch

  Remote one-liner (no parameters):
    irm https://raw.githubusercontent.com/alickjoe/charging-dashboard/main/scripts/install-aidbquery.ps1 | iex

  Remote with parameters:
    & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/alickjoe/charging-dashboard/main/scripts/install-aidbquery.ps1'))) -Launch

  Uninstall:
    npm uninstall -g aidbquery   (user data stays in %APPDATA%\aidbquery)
#>
param(
  [switch]$Launch,
  [switch]$NoShortcuts,
  [string]$NodeVersion = 'v22.14.0',
  [string]$NpmPackage = 'aidbquery'
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }

$nodeDir = Join-Path $env:LOCALAPPDATA 'Programs\aidbquery\node'

function Info($msg)    { Write-Host "[..] $msg" -ForegroundColor Cyan }
function Ok($msg)      { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[!!] $msg" -ForegroundColor Yellow }
function Die($msg)     { Write-Host "[XX] $msg" -ForegroundColor Red; exit 1 }

function Get-NodeMajor {
  try {
    $v = & node -v 2>$null
    if ($v -match '^v(\d+)') { return [int]$Matches[1] }
  } catch { }
  return -1
}

# ---------------------------------------------------------------------------
Info 'Step 1/4: Checking Node.js ...'
# ---------------------------------------------------------------------------
$nodeMajor = Get-NodeMajor
$needPortableNode = $true
if ($nodeMajor -ge 18) {
  Ok "Node.js $(node -v) found, using it."
  $needPortableNode = $false
} elseif ($nodeMajor -ge 0) {
  Warn "Node.js $(node -v) is too old (need >= 18); a portable copy will be installed."
}

if ($needPortableNode) {
  if (Test-Path (Join-Path $nodeDir 'node.exe')) {
    Ok "Portable Node already present: $nodeDir"
  } else {
    $nodeName = "node-$NodeVersion-win-x64.zip"
    $mirrors = @(
      "https://nodejs.org/dist/",
      "https://npmmirror.com/mirrors/node/"
    )
    $zipFile = Join-Path $env:TEMP $nodeName
    $downloaded = $false
    foreach ($mirror in $mirrors) {
      try {
        Info "Downloading $nodeName from $mirror ..."
        Invoke-WebRequest -Uri ($mirror + $nodeName) -OutFile $zipFile -UseBasicParsing -TimeoutSec 600
        if ((Get-Item $zipFile).Length -gt 1MB) { $downloaded = $true; break }
        Warn "Downloaded file is too small, trying next mirror."
      } catch {
        Warn "Download failed from $mirror ($($_.Exception.Message))"
      }
    }
    if (-not $downloaded) { Die "Failed to download portable Node.js. Please install Node.js 18+ manually from https://nodejs.org and re-run." }

    Info 'Extracting portable Node.js ...'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $nodeDir) | Out-Null
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Expand-Archive -Path $zipFile -DestinationPath $env:TEMP -Force
    Move-Item (Join-Path $env:TEMP "node-$NodeVersion-win-x64") $nodeDir
    Remove-Item $zipFile -Force -ErrorAction SilentlyContinue
  }

  # Put portable node first on PATH for this session ...
  $env:Path = "$nodeDir;$env:Path"
  # ... and persist it on the USER level (HKCU, no admin needed).
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $nodeDir) {
    [Environment]::SetEnvironmentVariable('Path', "$nodeDir;$userPath", 'User')
    Ok "Added to user PATH: $nodeDir"
  }
  Ok "Portable Node $(node -v) ready."
}

$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source }
if (-not $npmCmd) { Die 'npm not found even after Node setup.' }

# ---------------------------------------------------------------------------
Info "Step 2/4: Installing npm package '$NpmPackage' (this downloads ~100-200 MB) ..."
# ---------------------------------------------------------------------------
$installed = $false
foreach ($attempt in 1, 2) {
  try {
    Info "npm install -g $NpmPackage (attempt $attempt) ..."
    & $npmCmd install -g --no-audit --no-fund $NpmPackage
    if ($LASTEXITCODE -eq 0) { $installed = $true; break }
  } catch {
    Warn "npm install failed: $($_.Exception.Message)"
  }
}
if (-not $installed) {
  Die "npm install failed. Check your network/proxy, then re-run this script."
}
Ok "aidbquery installed."

# ---------------------------------------------------------------------------
Info 'Step 3/4: Creating shortcuts ...'
# ---------------------------------------------------------------------------
$prefix = (& $npmCmd config get prefix).Trim()
$adqCmd = Join-Path $prefix 'adq.cmd'
if (-not (Test-Path $adqCmd)) { Die "adq.cmd not found at $adqCmd — unexpected npm layout." }

# Icon: the Electron binary inside the runtime package (best-effort).
$iconExe = Join-Path $prefix 'node_modules\aidbquery-runtime-win32-x64\runtime\electron\electron.exe'
if (-not (Test-Path $iconExe)) { $iconExe = '' }

if ($NoShortcuts) {
  Info 'Skipped (-NoShortcuts). Start later with: adq'
} else {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $targets = @(
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\AI DB Query.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI DB Query.lnk')
    )
    foreach ($lnk in $targets) {
      $sc = $ws.CreateShortcut($lnk)
      $sc.TargetPath = $adqCmd
      $sc.WindowStyle = 7          # minimized: the launcher console flashes briefly only
      $sc.Description = 'AI DB Query - PostgreSQL data explorer'
      $sc.WorkingDirectory = $prefix
      if ($iconExe) { $sc.IconLocation = "$iconExe,0" }
      $sc.Save()
      Ok "Shortcut: $lnk"
    }
  } catch {
    Warn "Shortcut creation failed (non-fatal): $($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------------------
Info 'Step 4/4: Done.'
# ---------------------------------------------------------------------------
Write-Host ''
Ok 'AI DB Query installed (user level, no admin rights used).'
Write-Host "     Start:       double-click the shortcut, or run  adq  in a terminal" -ForegroundColor Gray
Write-Host "     Self-check:  adq doctor" -ForegroundColor Gray
Write-Host "     Data/logs:   $env:APPDATA\aidbquery" -ForegroundColor Gray
Write-Host "     Uninstall:   npm uninstall -g $NpmPackage" -ForegroundColor Gray
Write-Host ''

if ($Launch) {
  Info 'Launching ...'
  Start-Process -FilePath $adqCmd
}

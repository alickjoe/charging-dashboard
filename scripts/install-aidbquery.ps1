<#
.SYNOPSIS
  AI DB Query - user-level bootstrap installer for Windows 10/11.
  No admin rights required at any step.

.DESCRIPTION
  1. Ensures Node.js >= 18 is available (downloads a portable copy into
     %LOCALAPPDATA%\Programs\aidbquery\node when missing or too old)
  2. Stops a running instance (Windows locks electron.exe / python.exe, so an
     upgrade over a running app fails or leaves a half-upgraded tree)
  3. Installs the `aidbquery` npm package globally (user prefix, no admin)
  4. Creates user-level Start Menu + Desktop shortcuts (unless -NoShortcuts)
  5. Runs `adq doctor` so a broken/partial install fails here instead of at
     launch (unless -SkipSelfCheck), then optionally launches the app (-Launch)

  Why step 3 is more than one `npm install`:
  A release publishes two packages - the small `aidbquery` launcher and the
  ~150 MB `aidbquery-runtime-win32-x64` payload (pinned via
  optionalDependencies). npm processes the large package asynchronously on the
  registry, so for several minutes after a release the runtime is still not
  downloadable. `npm install` treats a missing optional dependency as a
  warning and exits 0, producing a "successful" install that cannot start.
  This script therefore pins both packages to one version, waits for the
  runtime to become visible, and verifies that both are installed with the
  same version before declaring success.

  Local run:
    powershell -ExecutionPolicy Bypass -File scripts/install-aidbquery.ps1 -Launch

  Remote one-liner (no parameters):
    irm https://raw.githubusercontent.com/alickjoe/charging-dashboard/main/scripts/install-aidbquery.ps1 | iex

  Remote with parameters:
    & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/alickjoe/charging-dashboard/main/scripts/install-aidbquery.ps1'))) -Launch

  Pin an older version (e.g. the newest runtime is still publishing):
    ... -Version 0.1.10

  Uninstall:
    npm uninstall -g aidbquery   (user data stays in %APPDATA%\aidbquery)
#>
param(
  [switch]$Launch,
  [switch]$NoShortcuts,
  [switch]$SkipSelfCheck,
  [string]$Version = '',
  [int]$RuntimeWaitSeconds = 600,
  [string]$NodeVersion = 'v24.22.1',
  [string]$NpmPackage = 'aidbquery',
  [string]$RuntimePackage = 'aidbquery-runtime-win32-x64'
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }

# Normalize: accept both '22.14.0' and 'v22.14.0'
if ($NodeVersion -notmatch '^v') { $NodeVersion = "v$NodeVersion" }

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

# Read the version field of an installed package directory, or $null.
function Get-PackageVersion([string]$dir) {
  $manifest = Join-Path $dir 'package.json'
  if (-not (Test-Path $manifest)) { return $null }
  try { return (Get-Content $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

# Locate the installed runtime package directory, or $null.
# npm installs the optional dependency EITHER hoisted next to the launcher OR
# nested under it (observed on nvm-windows installs:
#   <prefix>\node_modules\aidbquery\node_modules\aidbquery-runtime-win32-x64),
# so both layouts must be accepted.
function Find-RuntimeDir([string]$npmPrefix, [string]$launcherPkg, [string]$runtimePkg) {
  $candidates = @(
    (Join-Path $npmPrefix "node_modules\$runtimePkg"),
    (Join-Path $npmPrefix "node_modules\$launcherPkg\node_modules\$runtimePkg")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate 'package.json')) { return $candidate }
  }
  return $null
}

# True when <pkg>@<ver> is resolvable from the configured npm registry.
# Best-effort: a network/proxy error simply returns $false (the post-install
# verification then reports the real state).
function Test-RegistryVersion([string]$pkg, [string]$ver) {
  try {
    $out = & $npmCmd view "$pkg@$ver" version 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $true }
  } catch { }
  return $false
}

# ---------------------------------------------------------------------------
Info 'Step 1/5: Checking Node.js ...'
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
    # Mirrors must include the version directory segment:
    #   https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip
    # (dist root + bare filename 404s)
    $mirrors = @(
      "https://nodejs.org/dist/$NodeVersion/",
      "https://npmmirror.com/mirrors/node/$NodeVersion/"
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

$prefixRaw = & $npmCmd config get prefix 2>$null
$prefix = "$prefixRaw".Trim()
if (-not $prefix) { Die 'Could not determine the npm global prefix (npm config get prefix).' }
$adqCmd = Join-Path $prefix 'adq.cmd'

# ---------------------------------------------------------------------------
Info 'Step 2/5: Stopping a running instance (if any) ...'
# ---------------------------------------------------------------------------
if (Test-Path $adqCmd) {
  # Windows locks electron.exe / the portable python while the app is open, so
  # `npm install -g` over a running app fails with EPERM (or partially updates
  # the tree). Ask the installed launcher to stop the app first.
  Info 'Stopping the installed app so no files are locked ...'
  try {
    & $adqCmd stop 2>$null | Out-Null
    Start-Sleep -Seconds 2
    Ok 'Previous instance stopped (or was not running).'
  } catch {
    Warn "Could not stop the running instance automatically: $($_.Exception.Message)"
    Warn 'Close the app window and re-run this script if the install fails.'
  }
} else {
  Info 'No previous installation found.'
}

# ---------------------------------------------------------------------------
Info "Step 3/5: Installing '$NpmPackage' (this downloads ~150 MB) ..."
# ---------------------------------------------------------------------------
$targetVersion = $Version
if (-not $targetVersion) {
  try {
    $latest = & $npmCmd view $NpmPackage version 2>$null
    if ($LASTEXITCODE -eq 0 -and $latest) { $targetVersion = "$latest".Trim() }
  } catch { }
}
if ($targetVersion) {
  Info "Target version: $targetVersion"
  # Wait for the large runtime package to finish publishing (see .DESCRIPTION).
  if (Test-RegistryVersion $RuntimePackage $targetVersion) {
    Ok "$RuntimePackage@$targetVersion is available."
  } else {
    Warn "$RuntimePackage@$targetVersion is not visible on the npm registry yet."
    if ($RuntimeWaitSeconds -gt 0) {
      Info "Waiting up to $RuntimeWaitSeconds s for the runtime package to be published ..."
      $deadline = (Get-Date).AddSeconds($RuntimeWaitSeconds)
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 15
        if (Test-RegistryVersion $RuntimePackage $targetVersion) { break }
        $left = [int]($deadline - (Get-Date)).TotalSeconds
        if ($left -gt 0) { Write-Host "     still publishing, ${left}s left ..." -ForegroundColor Gray }
      }
    }
    if (-not (Test-RegistryVersion $RuntimePackage $targetVersion)) {
      Die "Runtime package $RuntimePackage@$targetVersion is still not on the registry. Wait a few minutes and re-run this script, or install a version that is already published with -Version <x.y.z>."
    }
    Ok "$RuntimePackage@$targetVersion is now available."
  }
} else {
  Warn 'Could not resolve the latest version from the registry (network/proxy?). Installing without a pin.'
}

$installSpec = $NpmPackage
if ($targetVersion) { $installSpec = "$NpmPackage@$targetVersion" }

$installedVersion = $null
$runtimeVersion = $null
$runtimeDir = $null
for ($attempt = 1; $attempt -le 2; $attempt++) {
  Info "npm install -g $installSpec (attempt $attempt) ..."
  & $npmCmd install -g --no-audit --no-fund $installSpec
  if ($LASTEXITCODE -ne 0) {
    Warn "npm install exited with code $LASTEXITCODE."
    Start-Sleep -Seconds 5
    continue
  }
  $installedVersion = Get-PackageVersion (Join-Path $prefix "node_modules\$NpmPackage")
  $runtimeDir = Find-RuntimeDir $prefix $NpmPackage $RuntimePackage
  if ($runtimeDir) { $runtimeVersion = Get-PackageVersion $runtimeDir } else { $runtimeVersion = $null }
  if ($installedVersion -and $runtimeVersion -and ($installedVersion -eq $runtimeVersion)) {
    Ok "$NpmPackage $installedVersion installed (runtime $runtimeVersion)."
    break
  }
  Warn "Install incomplete: launcher=$installedVersion, runtime=$runtimeVersion."
  Start-Sleep -Seconds 5
}
if (-not $installedVersion) {
  Die "npm install failed. Check your network/proxy (if npm reported EACCES/EPERM, close the app and re-run), then try again."
}
if (-not $runtimeVersion -or ($installedVersion -ne $runtimeVersion)) {
  Die "Installation is incomplete: $RuntimePackage@$installedVersion is missing or has a different version ($runtimeVersion). The ~150 MB runtime package is published asynchronously - wait a few minutes and re-run this script (already downloaded layers are cached), or pass -Version <x.y.z> with a version whose runtime is already available."
}
if (-not (Test-Path $adqCmd)) { Die "adq.cmd not found at $adqCmd - unexpected npm layout." }

# ---------------------------------------------------------------------------
Info 'Step 4/5: Creating shortcuts ...'
# ---------------------------------------------------------------------------
# Icon: the Electron binary inside the runtime package (verified above).
$iconExe = ''
if ($runtimeDir) {
  $candidateIcon = Join-Path $runtimeDir 'runtime\electron\electron.exe'
  if (Test-Path $candidateIcon) { $iconExe = $candidateIcon }
}

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
if (-not $SkipSelfCheck) {
  Info 'Step 5/5: Running self-check (adq doctor) ...'
  & $adqCmd doctor
  if ($LASTEXITCODE -ne 0) {
    Die 'Self-check failed: the installation is incomplete. Re-run this script, or report the output above.'
  }
  Ok 'Self-check passed.'
} else {
  Info 'Step 5/5: Self-check skipped (-SkipSelfCheck). Run "adq doctor" later.'
}

Info 'Done.'
# ---------------------------------------------------------------------------
Write-Host ''
Ok 'AI DB Query installed (user level, no admin rights used).'
Write-Host "     Version:     $NpmPackage $installedVersion (runtime $runtimeVersion)" -ForegroundColor Gray
Write-Host "     Start:       double-click the shortcut, or run  adq  in a terminal" -ForegroundColor Gray
Write-Host "     Self-check:  adq doctor" -ForegroundColor Gray
Write-Host "     Data/logs:   $env:APPDATA\aidbquery" -ForegroundColor Gray
Write-Host "     Uninstall:   npm uninstall -g $NpmPackage" -ForegroundColor Gray
Write-Host ''

if ($Launch) {
  Info 'Launching ...'
  Start-Process -FilePath $adqCmd
}

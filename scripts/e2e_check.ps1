$ErrorActionPreference = "Continue"
Set-Location "c:\repo\charging-dashboard\electron"
$env:ELECTRON_ENABLE_LOGGING = "true"
$p = Start-Process -FilePath "npx.cmd" -ArgumentList "electron", ".", "--user-data-dir=$env:TEMP\aidbquery_e2e_userdata" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 25
$backend = Get-Process -Name "aiquery-backend" -ErrorAction SilentlyContinue
Write-Host "electron running: $(-not $p.HasExited)"
Write-Host "backend process: $(if ($backend) { $backend.Id } else { 'none' })"
try {
    $s = Invoke-RestMethod "http://127.0.0.1:8000/api/v1/setup/status" -TimeoutSec 8
    Write-Host "backend API via Electron: needs_setup=$($s.needs_setup)"
} catch {
    Write-Host "backend unreachable: $($_.Exception.Message)"
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Stop-Process -Name "aiquery-backend" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "electron" -Force -ErrorAction SilentlyContinue
Write-Host "e2e check done"

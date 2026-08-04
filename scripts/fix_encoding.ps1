$files = @(
    "scripts\write_build.ps1"
)
foreach ($f in $files) {
    $c = Get-Content $f -Raw -Encoding UTF8
    $utf8bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText((Resolve-Path $f), $c, $utf8bom)
}
Write-Host "All .ps1 files saved as UTF-8 BOM"

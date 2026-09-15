#!/usr/bin/env pwsh
# Runs every smoke suite back-to-back and writes the combined log.
$env:ANIMBOOK_API_URL = "http://localhost:4000"
$env:ANIMBOOK_MOBILE_URL = "http://localhost:3005"
$env:ANIMBOOK_TV_URL = "http://localhost:3006"

$suites = @("phase1","edu","kids","phase2","phase3","phase4","phase5","phase6","phase7","phase8","phase9","phase10","phase11")
$logPath = Join-Path $PSScriptRoot "..\smoke-all.log"
if (Test-Path $logPath) { Remove-Item $logPath }
Add-Content -Path $logPath -Value "AnimBook all-suite smoke run"

foreach ($s in $suites) {
  Add-Content -Path $logPath -Value ""
  Add-Content -Path $logPath -Value "=== smoke-$s ==="
  $out = node "scripts/smoke-$s.mjs" 2>&1 | Out-String
  Add-Content -Path $logPath -Value $out
}

Add-Content -Path $logPath -Value ""
Add-Content -Path $logPath -Value "=== summary ==="
foreach ($s in $suites) {
  Add-Content -Path $logPath -Value $s
}
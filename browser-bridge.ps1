$ErrorActionPreference = "Continue"
$dashboard = "https://mistyrose-grasshopper-715730.hostingersite.com"
$token = (Get-Content -Raw "$PSScriptRoot\data\worker-token").Trim()
$env:DASHBOARD_URL = $dashboard
$env:WORKER_TOKEN = $token
Set-Location $PSScriptRoot
node src/browser-bridge.js

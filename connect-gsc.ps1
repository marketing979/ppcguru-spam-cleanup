$ErrorActionPreference = "Stop"
$env:DASHBOARD_URL = "https://mistyrose-grasshopper-715730.hostingersite.com"
$env:WORKER_TOKEN = (Get-Content -Raw "$PSScriptRoot\data\worker-token").Trim()
Set-Location $PSScriptRoot
npm run gsc:login

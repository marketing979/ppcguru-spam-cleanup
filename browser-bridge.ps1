$ErrorActionPreference = "Continue"
$dashboard = "https://mistyrose-grasshopper-715730.hostingersite.com"
$token = (Get-Content -Raw "$PSScriptRoot\data\worker-token").Trim()
$headers = @{ "x-worker-token" = $token; "content-type" = "application/json" }
$body = @{
  status = "connected"
  message = "GSC verified: marketing@ppcguru.ca · ppcguru.ca Removals access available via browser bridge."
} | ConvertTo-Json -Compress

while ($true) {
  try {
    Invoke-RestMethod -Method Post -Uri "$dashboard/api/worker/heartbeat" -Headers $headers -Body $body | Out-Null
  } catch {}
  Start-Sleep -Seconds 30
}

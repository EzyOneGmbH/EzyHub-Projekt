# EzyAI-Analyse-Worker-Tick (Async-Umbau 21.08.2026).
# Wird vom Windows Task Scheduler MINUETLICH aufgerufen (kein setInterval,
# kein Browser-Timer) und triggert den geschuetzten Worker-Endpunkt, der alle
# offenen prospect_audits-Jobs Etappe fuer Etappe abarbeitet.
#
# Registrierung (einmalig, als angemeldeter User — kein Admin noetig):
#   schtasks /create /tn "EzyOne-Analyse-Worker" /sc minute /mo 1 ^
#     /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\VolkanKaragülleEzyOn\EzyHub-chat-aivis\scripts\analyse-worker.ps1" ^
#     /f
# Kontrolle:  schtasks /query /tn "EzyOne-Analyse-Worker"
# Entfernen:  schtasks /delete /tn "EzyOne-Analyse-Worker" /f
#
# Ueberlappungsschutz: Task Scheduler startet Instanzen unabhaengig; die App
# lockt jede Analyse via locked_until — doppelte Worker fuehren nie dieselbe
# Etappe doppelt aus (parallele Instanzen ticken hoechstens VERSCHIEDENE Jobs).
# Ausfall-Sichtbarkeit: der Endpunkt schreibt analyse_worker_heartbeat; die
# App zeigt aktiv/verzoegert/ausgefallen (GET /api/agent/analyse?worker=1).

$ErrorActionPreference = "Stop"

# ADMIN_AUTOMATION_SECRET aus der agent-service-Env lesen (nie im Repo).
$envFile = Join-Path $env:USERPROFILE "agent-service\.env"
$secret = (Get-Content $envFile | Where-Object { $_ -match "^ADMIN_AUTOMATION_SECRET=" } |
  Select-Object -First 1) -replace "^ADMIN_AUTOMATION_SECRET=", ""
if (-not $secret) { Write-Error "ADMIN_AUTOMATION_SECRET fehlt in $envFile"; exit 1 }

$base = "https://ezyhub.ch"
try {
  # WICHTIG: TimeoutSec IMMER setzen (PS 5.1 Invoke-WebRequest ohne TimeoutSec
  # wartet unendlich — Befund 23.07.2026). Gateway kappt ~300 s.
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/agent/analyse" `
    -Headers @{ Authorization = "Bearer $secret" } `
    -ContentType "application/json" `
    -Body '{"action":"worker"}' `
    -TimeoutSec 290
  $log = Join-Path $env:USERPROFILE "agent-service\analyse-worker.log"
  Add-Content -Path $log -Encoding utf8 -Value ("[{0}] getickt={1} fertig={2} fehler={3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $r.getickt, $r.fertig, $r.fehler)
} catch {
  $log = Join-Path $env:USERPROFILE "agent-service\analyse-worker.log"
  Add-Content -Path $log -Encoding utf8 -Value ("[{0}] FEHLER: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  exit 1
}

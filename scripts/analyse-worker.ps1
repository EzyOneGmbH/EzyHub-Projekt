# EzyAI-Analyse-Worker-Tick — NOTFALL-FALLBACK (seit 13.09.2026).
#
# Primaerer Scheduler ist NICHT mehr dieser Windows-Task, sondern pg_cron +
# pg_net in der Lovable-Supabase (Migration supabase/migrations/
# 20260913180000_managed_worker_scheduler.sql): Job «ezy-analyse-worker» ruft
# minuetlich POST https://ezyhub.ch/api/agent/analyse {action:"worker",
# source:"pg_cron"} mit dem Vault-Secret admin_automation_secret auf; Job
# «ezy-analyse-watchdog» (alle 5 min, public.analyse_worker_watchdog) alarmiert
# die Admins, wenn der Heartbeat > 10 Minuten fehlt.
#
# Der Windows-Task «EzyOne-Analyse-Worker» bleibt registriert, aber DEAKTIVIERT.
# Beide Wege duerfen parallel laufen: die App serialisiert Ticks per Lease
# (analyse_worker_heartbeat.lease_until) und lockt jeden Job (locked_until).
#
# Notfall (pg_cron/pg_net ausgefallen — Alarm «Analyse-Worker ausgefallen»):
#   Enable-ScheduledTask  -TaskName "EzyOne-Analyse-Worker"    # Fallback EIN
#   Disable-ScheduledTask -TaskName "EzyOne-Analyse-Worker"    # Fallback AUS
#   Get-ScheduledTask     -TaskName "EzyOne-Analyse-Worker" | Select State
# Der Task startet minuetlich den unsichtbaren Launcher
# %USERPROFILE%\ezy-cron\hidden\analyse-worker.vbs → dieses Skript.
# Log: ~/agent-service/analyse-worker.log
#
# Ausfall-Sichtbarkeit: der Endpunkt schreibt analyse_worker_heartbeat (inkl.
# source = pg_cron | windows-fallback); die App zeigt aktiv/verzoegert/
# ausgefallen (GET /api/agent/analyse?worker=1, Admin → Systemcheck).

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
    -Body '{"action":"worker","source":"windows-fallback"}' `
    -TimeoutSec 290
  $log = Join-Path $env:USERPROFILE "agent-service\analyse-worker.log"
  if ($r.uebersprungen) {
    Add-Content -Path $log -Encoding utf8 -Value ("[{0}] uebersprungen={1} (Lease haelt ein anderer Tick)" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $r.uebersprungen)
  } else {
    Add-Content -Path $log -Encoding utf8 -Value ("[{0}] getickt={1} fertig={2} fehler={3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $r.getickt, $r.fertig, $r.fehler)
  }
} catch {
  $log = Join-Path $env:USERPROFILE "agent-service\analyse-worker.log"
  Add-Content -Path $log -Encoding utf8 -Value ("[{0}] FEHLER: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  exit 1
}

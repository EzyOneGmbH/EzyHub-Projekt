-- ChatGPT-Ads Auto-Sync stündlich (Volkan 02.10.2026, vorher alle 12 h):
-- jede Stunde zur Minute 15 werden alle aktiven ChatGPT-Ads-Konten
-- serverseitig synchronisiert (Kampagnen, Anzeigengruppen, Anzeigen,
-- Zielgruppen, Insights). Konten, die die UI in den letzten 45 Minuten
-- selbst synchronisiert hat, überspringt der Endpunkt (maxAlterStunden 0.75 —
-- mit 11 wie bisher wäre der stündliche Lauf faktisch 12-stündlich geblieben).
-- Auth: Vault-Secret admin_automation_secret (kein Klartext im Job).
-- Bereits am 02.10.2026 per cron.alter_job angewendet; idempotent.
select cron.unschedule('ezy-chatgpt-ads-sync')
  where exists (select 1 from cron.job where jobname = 'ezy-chatgpt-ads-sync');

select cron.schedule(
  'ezy-chatgpt-ads-sync',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://ezyhub.ch/api/admin/chatgpt-ads',
    body := jsonb_build_object('action', 'sync-all', 'source', 'pg_cron', 'maxAlterStunden', 0.75),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $$
);

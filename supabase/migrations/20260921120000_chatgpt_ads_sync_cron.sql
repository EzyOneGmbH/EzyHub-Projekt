-- ChatGPT-Ads Auto-Sync (Volkan 21.09.2026): alle 12 h werden alle aktiven
-- ChatGPT-Ads-Konten serverseitig synchronisiert (Kampagnen, Anzeigengruppen,
-- Anzeigen, Zielgruppen, Insights) — auch wenn niemand den Ads-Manager öffnet.
-- Konten, die die UI innerhalb der letzten 11 h selbst synchronisiert hat,
-- überspringt der Endpunkt (maxAlterStunden). Auth: Vault-Secret
-- admin_automation_secret (wie ezy-analyse-worker).
-- Aus/Ein: select cron.unschedule('ezy-chatgpt-ads-sync');  -- bzw. erneut cron.schedule
select cron.unschedule('ezy-chatgpt-ads-sync')
  where exists (select 1 from cron.job where jobname = 'ezy-chatgpt-ads-sync');

select cron.schedule(
  'ezy-chatgpt-ads-sync',
  '15 */12 * * *',
  $$
  select net.http_post(
    url := 'https://ezyhub.ch/api/admin/chatgpt-ads',
    body := jsonb_build_object('action', 'sync-all', 'source', 'pg_cron', 'maxAlterStunden', 11),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $$
);

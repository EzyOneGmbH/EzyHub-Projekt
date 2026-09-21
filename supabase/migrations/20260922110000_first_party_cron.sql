-- First-Party-KPIs, Phase 2b (22.09.2026, Volkan): verwalteter Datenlauf
-- fuer GSC/GA4 (Tabellen aus 20260922100000_first_party_kpi.sql).
--   ezy-first-party-sync      taeglich 04:40 UTC  → {action:"daily"}
--                             Tagesfenster «letzte 3 Tage» aller Kunden mit
--                             clients.metadata.first_party_kpi = true
--                             (GSC heute-4..heute-2, dataState final; GA4 heute-3..heute-1)
--   ezy-first-party-backfill  alle 15 min        → {action:"backfill"}
--                             naechste Monatsbloecke rueckwaerts fuer Kunden mit
--                             gesetztem backfill_ziel (Start ueber die Admin-Maske
--                             «Backfill starten» bzw. {action:"backfill-start"});
--                             ohne offene Backfills antwortet der Endpunkt sofort.
-- Auth: Vault-Secret admin_automation_secret (wie ezy-analyse-worker); Timeout
-- 295 s, die App haelt intern ein Zeitbudget von 240 s ein.
-- Lovable wendet Repo-Migrationen NICHT automatisch an: manuell per SQL ausfuehren.
-- Aus/Ein: select cron.unschedule('ezy-first-party-sync');  -- bzw. erneut cron.schedule

select cron.unschedule('ezy-first-party-sync')
  where exists (select 1 from cron.job where jobname = 'ezy-first-party-sync');

select cron.schedule(
  'ezy-first-party-sync',
  '40 4 * * *',
  $$
  select net.http_post(
    url := 'https://ezyhub.ch/api/admin/first-party-sync',
    body := jsonb_build_object('action', 'daily', 'source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $$
);

select cron.unschedule('ezy-first-party-backfill')
  where exists (select 1 from cron.job where jobname = 'ezy-first-party-backfill');

select cron.schedule(
  'ezy-first-party-backfill',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ezyhub.ch/api/admin/first-party-sync',
    body := jsonb_build_object('action', 'backfill', 'source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $$
);

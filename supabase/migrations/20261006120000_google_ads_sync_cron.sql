-- Google-Ads Auto-Sync (Volkan 06.10.2026): alle 4 Stunden speichert
-- /api/admin/ads-sync fuer jeden Kunden mit verknuepftem Google-Ads-Konto einen
-- Snapshot (30, 7, 14 und 90 Tage, jeweils mit Vorperiode) — auch wenn niemand
-- das Dashboard oeffnet. Kunden sehen so hoechstens 4 h alte Zahlen.
-- Zeitplan 01/05/09/13/17/21 UTC: nie zwischen 00 und 02 Uhr Schweizer Zeit,
-- wo der Schweizer Tag dem UTC-Tag voraus ist.
-- Auth: Vault-Secret admin_automation_secret (kein Klartext im Job).
-- Aus: select cron.unschedule('ezy-google-ads-sync');
select cron.unschedule('ezy-google-ads-sync')
  where exists (select 1 from cron.job where jobname = 'ezy-google-ads-sync');

select cron.schedule(
  'ezy-google-ads-sync',
  '20 1,5,9,13,17,21 * * *',
  $$
  select net.http_post(
    url := 'https://ezyhub.ch/api/admin/ads-sync',
    body := jsonb_build_object('source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $$
);

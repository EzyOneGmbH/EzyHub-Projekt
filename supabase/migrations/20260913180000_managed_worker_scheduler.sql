-- Verwalteter Worker-Scheduler (13.09.2026, Volkan): ersetzt den persoenlichen
-- Windows-Task-Scheduler als primaeren Analyse-/Admin-Worker durch pg_cron +
-- pg_net in der Lovable-Supabase (Always-on, unabhaengig vom Cloud PC).
--
-- ACHTUNG: Lovable wendet Repo-Migrationen NICHT automatisch an — dieses File
-- wird manuell via Lovable-SQL ausgefuehrt (wie 20260821140000). Danach EINMALIG
-- das Secret in den Vault legen (Wert NIE ins Repo):
--   select vault.create_secret('<ADMIN_AUTOMATION_SECRET>', 'admin_automation_secret',
--     'Bearer fuer /api/agent/analyse action:worker (pg_cron)');
--   -- optional (Alarm-Webhook, z.B. n8n):
--   select vault.create_secret('https://.../webhook/...', 'worker_alarm_webhook_url', '');
--   select vault.create_secret('<N8N_AGENT_WEBHOOK_SECRET>', 'n8n_agent_webhook_secret', '');
--
-- Kontrolle:  select jobname, schedule, active from cron.job;
--             select id, status_code, error_msg, created from net._http_response
--               order by id desc limit 10;
-- Aus/Ein:    select cron.unschedule('ezy-analyse-worker');  -- bzw. erneut cron.schedule
-- Notfall-Fallback: Windows-Task «EzyOne-Analyse-Worker» aktivieren
--   (Enable-ScheduledTask -TaskName EzyOne-Analyse-Worker; scripts/analyse-worker.ps1).

-- 1) Extensions (Supabase-Standardschemata).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;

-- 2) Heartbeat: Lease (ein Tick zur Zeit), Fehlerserie, Sweep-Zeitpunkt, Quelle.
alter table public.analyse_worker_heartbeat
  add column if not exists lease_until timestamptz,
  add column if not exists lease_holder text,
  add column if not exists consecutive_error_ticks integer not null default 0,
  add column if not exists last_sweep_at timestamptz,
  add column if not exists source text;

-- 3) Meldungen an Personen: recipient_user_id NULL = alle Berechtigten der
--    Organisation/des Kunden (bisheriges Verhalten), sonst NUR diese Person.
alter table public.app_notifications
  add column if not exists recipient_user_id uuid;
create index if not exists app_notifications_recipient
  on public.app_notifications (recipient_user_id)
  where recipient_user_id is not null;

drop policy if exists app_notifications_select on public.app_notifications;
create policy app_notifications_select on public.app_notifications
  for select using (
    (recipient_user_id is null or recipient_user_id = auth.uid())
    and (
      (client_id is not null and public.can_access_client(client_id))
      or (client_id is null and public.is_org_member(organization_id))
    )
  );
drop policy if exists app_notifications_update on public.app_notifications;
create policy app_notifications_update on public.app_notifications
  for update using (
    (recipient_user_id is null or recipient_user_id = auth.uid())
    and (
      (client_id is not null and public.can_access_client(client_id))
      or (client_id is null and public.is_org_member(organization_id))
    )
  );

-- 4) DB-seitiger Watchdog: erkennt den AUSFALL des Workers (kein Heartbeat
--    > 10 Minuten) unabhaengig von der App — die App kann ihren eigenen
--    Ausfall nicht melden. Meldung an alle owner/admin (dedupliziert je
--    Ausfall-Episode = letzter Heartbeat) + optionaler Webhook aus dem Vault.
--    _jetzt ist nur fuer Tests (Zeit «vorspulen»), Standard now().
create or replace function public.analyse_worker_watchdog(_jetzt timestamptz default now())
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  hb        public.analyse_worker_heartbeat%rowtype;
  v_alter   interval;
  v_minuten integer;
  v_key     text;
  v_neu     integer := 0;
  v_url     text;
  v_secret  text;
begin
  select * into hb from public.analyse_worker_heartbeat where id = 1;
  if not found then
    return jsonb_build_object('zustand', 'unbekannt');
  end if;
  v_alter := _jetzt - hb.last_run_at;
  v_minuten := floor(extract(epoch from v_alter) / 60)::integer;
  if v_alter <= interval '10 minutes' then
    return jsonb_build_object('zustand', case when v_alter > interval '3 minutes' then 'verzoegert' else 'aktiv' end,
                              'alter_min', v_minuten);
  end if;

  v_key := 'worker:heartbeat:' || to_char(hb.last_run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  insert into public.app_notifications
    (organization_id, client_id, kind, severity, title, body, link_section, dedupe_key, recipient_user_id)
  select au.organization_id, null, 'worker_alarm', 'kritisch',
         'Analyse-Worker ausgefallen: kein Heartbeat seit ' || v_minuten || ' Minuten',
         'Der verwaltete Scheduler (pg_cron) erreicht die App nicht oder der Worker antwortet nicht. '
         || 'Pruefen: Admin → Systemcheck, cron.job / net._http_response in Supabase. '
         || 'Notfall-Fallback: Windows-Task «EzyOne-Analyse-Worker» aktivieren (scripts/analyse-worker.ps1).',
         'system', v_key || ':' || au.user_id, au.user_id
  from public.app_users au
  where au.role::text in ('owner', 'admin')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_neu = row_count;

  if v_neu > 0 then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_alarm_webhook_url' limit 1;
    if v_url is not null and v_url <> '' then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'n8n_agent_webhook_secret' limit 1;
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('client', 'ezyhub', 'agent', 'analyse-worker', 'status', 'fehler',
                                   'kind', 'worker_heartbeat', 'note', 'kein Heartbeat seit ' || v_minuten || ' Minuten'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'X-Ezy-Auth', coalesce(v_secret, '')),
        timeout_milliseconds := 5000
      );
    end if;
  end if;
  return jsonb_build_object('zustand', 'ausgefallen', 'alter_min', v_minuten, 'neue_meldungen', v_neu);
end $$;
revoke all on function public.analyse_worker_watchdog(timestamptz) from public, anon, authenticated;

-- 5) Cron-Jobs (idempotent: bestehende gleichnamige Jobs ersetzen).
--    Worker: jede Minute, Budget 230 s; die App serialisiert ueberlappende
--    Ticks per Lease. pg_net wartet bis 295 s auf die Antwort (Gateway-Kappe
--    ~300 s), blockiert dabei aber keine weiteren Aufrufe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ezy-analyse-worker') then
    perform cron.unschedule('ezy-analyse-worker');
  end if;
  if exists (select 1 from cron.job where jobname = 'ezy-analyse-watchdog') then
    perform cron.unschedule('ezy-analyse-watchdog');
  end if;
end $$;

select cron.schedule(
  'ezy-analyse-worker',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://ezyhub.ch/api/agent/analyse',
    body := jsonb_build_object('action', 'worker', 'source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'admin_automation_secret' limit 1)
    ),
    timeout_milliseconds := 295000
  );
  $cron$
);

select cron.schedule(
  'ezy-analyse-watchdog',
  '*/5 * * * *',
  $cron$ select public.analyse_worker_watchdog(); $cron$
);

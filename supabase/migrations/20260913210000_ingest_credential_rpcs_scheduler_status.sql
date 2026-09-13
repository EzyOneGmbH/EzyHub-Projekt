-- Scheduler und Credential-Lifecycle produktionsfest (13.09.2026, Volkan).
--
-- 1) Ingest-Credentials: Create/Rotate/Revoke/Touch als TRANSAKTIONALE
--    SECURITY-DEFINER-RPCs. Rotation erzeugt das neue Credential und setzt das
--    Ablaufdatum des alten in EINER Transaktion (vorher zwei REST-Schritte —
--    ein Abbruch dazwischen liess das alte Token unbegrenzt weiterleben).
--    Touch zaehlt use_count atomar hoch (vorher nur last_used_at).
-- 2) scheduler_status(): ein Aufruf liefert alles, was ein Deployment-Smoke-
--    Test braucht (Extensions, pg_cron-Jobs + letzte Laeufe, pg_net-Antworten,
--    Vault-Secret-NAMEN, Heartbeat, Watchdog-Probe) — nie Geheimnisse.
--
-- ACHTUNG: Lovable wendet Repo-Migrationen NICHT automatisch an — manuell via
-- Lovable-SQL ausfuehren. Alle Funktionen sind fuer anon/authenticated
-- gesperrt (nur service_role/postgres).

-- ── 1) Credential-Lifecycle ──────────────────────────────────────────────────
create or replace function public.ingest_credential_create(
  _organization_id uuid,
  _client_id uuid,
  _purpose text,
  _token_hash text,
  _token_prefix text,
  _label text default null,
  _expires_at timestamptz default null,
  _created_by uuid default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  r public.ingest_credentials;
begin
  if not exists (
    select 1 from public.clients where id = _client_id and organization_id = _organization_id
  ) then
    raise exception 'Kunde nicht in dieser Organisation' using errcode = 'P0002';
  end if;
  insert into public.ingest_credentials
    (organization_id, client_id, purpose, token_hash, token_prefix, label, created_by, expires_at)
  values
    (_organization_id, _client_id, _purpose, _token_hash, _token_prefix, _label, _created_by, _expires_at)
  returning * into r;
  return r;
end $$;

create or replace function public.ingest_credential_rotate(
  _credential_id uuid,
  _client_id uuid,
  _token_hash text,
  _token_prefix text,
  _label text default null,
  _expires_at timestamptz default null,
  _grace_until timestamptz default null,
  _created_by uuid default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  alt public.ingest_credentials;
  neu public.ingest_credentials;
begin
  -- Zeile sperren: zwei gleichzeitige Rotationen erzeugen nie zwei Nachfolger.
  select * into alt from public.ingest_credentials
   where id = _credential_id and client_id = _client_id
   for update;
  if not found then
    raise exception 'Credential nicht gefunden' using errcode = 'P0002';
  end if;
  if alt.revoked_at is not null then
    raise exception 'Widerrufenes Credential kann nicht rotiert werden' using errcode = 'P0003';
  end if;
  insert into public.ingest_credentials
    (organization_id, client_id, purpose, token_hash, token_prefix, label, created_by, expires_at, rotated_from)
  values
    (alt.organization_id, alt.client_id, alt.purpose, _token_hash, _token_prefix, _label, _created_by, _expires_at, alt.id)
  returning * into neu;
  -- Altes Token laeuft nach der Ueberlappung aus — nie verlaengern.
  update public.ingest_credentials
     set expires_at = least(coalesce(expires_at, 'infinity'::timestamptz), coalesce(_grace_until, now()))
   where id = alt.id;
  return neu;
end $$;

create or replace function public.ingest_credential_revoke(
  _credential_id uuid,
  _client_id uuid,
  _reason text default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  r public.ingest_credentials;
begin
  update public.ingest_credentials
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, _reason)
   where id = _credential_id and client_id = _client_id
  returning * into r;
  if not found then
    raise exception 'Credential nicht gefunden' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.ingest_credential_touch(_credential_id uuid)
returns void
language sql security definer set search_path to 'public'
as $$
  update public.ingest_credentials
     set use_count = use_count + 1, last_used_at = now()
   where id = _credential_id;
$$;

revoke all on function public.ingest_credential_create(uuid, uuid, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ingest_credential_rotate(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ingest_credential_revoke(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ingest_credential_touch(uuid) from public, anon, authenticated;

-- ── 2) Scheduler-Status (Deployment-Smoke) ──────────────────────────────────
create or replace function public.scheduler_status()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ext jsonb; v_jobs jsonb; v_runs jsonb; v_http jsonb; v_vault jsonb;
  v_hb jsonb; v_watchdog jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', extname, 'version', extversion)), '[]'::jsonb)
    into v_ext from pg_extension where extname in ('pg_cron', 'pg_net', 'supabase_vault');
  begin
    select coalesce(jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
      into v_jobs from cron.job where jobname like 'ezy-%';
  exception when others then v_jobs := jsonb_build_object('error', sqlerrm); end;
  begin
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_runs from (
      select j.jobname, d.status, left(coalesce(d.return_message, ''), 160) as message,
             d.start_time, d.end_time
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where j.jobname like 'ezy-%'
       order by d.start_time desc limit 10) x;
  exception when others then v_runs := jsonb_build_object('error', sqlerrm); end;
  begin
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_http from (
      select id, status_code, timed_out, left(coalesce(error_msg, ''), 160) as error_msg,
             left(coalesce(content::text, ''), 200) as content, created
        from net._http_response order by id desc limit 5) x;
  exception when others then v_http := jsonb_build_object('error', sqlerrm); end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'updated_at', updated_at)), '[]'::jsonb)
      into v_vault from vault.secrets
     where name in ('admin_automation_secret', 'worker_alarm_webhook_url', 'n8n_agent_webhook_secret');
  exception when others then v_vault := jsonb_build_object('error', sqlerrm); end;
  select to_jsonb(h) - 'lease_holder' into v_hb from public.analyse_worker_heartbeat h where id = 1;
  begin
    v_watchdog := public.analyse_worker_watchdog();
  exception when others then v_watchdog := jsonb_build_object('error', sqlerrm); end;
  return jsonb_build_object(
    'now', now(), 'extensions', v_ext, 'jobs', v_jobs, 'runs', v_runs,
    'http', v_http, 'vault', v_vault, 'heartbeat', v_hb, 'watchdog', v_watchdog);
end $$;
revoke all on function public.scheduler_status() from public, anon, authenticated;

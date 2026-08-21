-- EzyAI Analyse vollstaendig asynchron (21.08.2026):
-- 1) Retry-Queue-Felder am Job; 2) Worker-Heartbeat-Tabelle.
-- Status-Werte (Text, ohne Check — App-seitig geprueft):
--   queued | laufend | retry | fehler | abgebrochen | fertig

alter table public.prospect_audits
  add column if not exists attempts        integer     not null default 0,
  add column if not exists max_attempts    integer     not null default 3,
  add column if not exists next_retry_at   timestamptz,
  add column if not exists last_error      text,
  add column if not exists last_started_at timestamptz,
  add column if not exists failed_at       timestamptz;

comment on column public.prospect_audits.attempts is
  'Fehlversuche der AKTUELLEN Etappe (wird bei Etappenwechsel genullt)';

-- Worker-Heartbeat: genau eine Zeile (id=1), vom Worker-Endpoint geschrieben.
create table if not exists public.analyse_worker_heartbeat (
  id              integer primary key default 1 check (id = 1),
  last_run_at     timestamptz not null default now(),
  duration_ms     integer     not null default 0,
  jobs_processed  integer     not null default 0,
  errors          integer     not null default 0,
  last_error      text
);
alter table public.analyse_worker_heartbeat enable row level security;
-- Kein Policy-Grant: Zugriff ausschliesslich serverseitig (service_role).

insert into public.analyse_worker_heartbeat (id) values (1)
on conflict (id) do nothing;

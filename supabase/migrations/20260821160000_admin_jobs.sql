-- Admin-Ausbau (21.08.2026): asynchrone Admin-Datenlaeufe.
-- "Datenlauf starten" blockierte bis zu 240 s im Request — jetzt wird ein
-- persistenter Job angelegt (sofortige jobId), den der minuetliche Worker
-- (Task EzyOne-Analyse-Worker -> /api/agent/analyse action:worker) abarbeitet.
-- Status: queued | laufend | fertig | fehler

create table if not exists public.admin_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id       uuid,
  job_type        text not null,
  status          text not null default 'queued',
  progress        integer not null default 0,
  result          jsonb,
  error           text,
  attempts        integer not null default 0,
  max_attempts    integer not null default 2,
  locked_until    timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index if not exists admin_jobs_offen_idx
  on public.admin_jobs (status, updated_at);
alter table public.admin_jobs enable row level security;
-- Kein Policy-Grant: Zugriff ausschliesslich serverseitig (service_role).

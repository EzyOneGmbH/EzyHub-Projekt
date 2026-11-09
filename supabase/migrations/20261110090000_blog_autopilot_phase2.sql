-- Blog-Autopilot Phase 2 · Onboarding (09.11.2026)
--  * Schwelle «fast vorne» pro Projekt (Volkan: «neu» ab 10 Suchen/Monat,
--    «fast vorne» ab 10 Impressionen in 28 Tagen)
--  * Ahrefs-Limit pro Audit (Kap. 6.2, Standard 1'000 Units)
--  * Ahrefs-Zwischenspeicher (30 Tage je Endpunkt + Parameter), nur service_role

alter table public.blog_projects
  add column if not exists min_impressions int not null default 10
    check (min_impressions between 0 and 100000),
  add column if not exists ahrefs_units_limit int not null default 1000
    check (ahrefs_units_limit between 0 and 20000);

create table if not exists public.ahrefs_cache (
  endpoint text not null,
  params_hash text not null,
  params jsonb not null,
  response jsonb not null,
  units int not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (endpoint, params_hash)
);
create index if not exists ahrefs_cache_fetched_idx on public.ahrefs_cache (fetched_at);

alter table public.ahrefs_cache enable row level security;
revoke all on public.ahrefs_cache from anon, authenticated;
grant all on public.ahrefs_cache to service_role;

-- Hintergrund-Jobs (Analyse, KI-Audit) im minütlichen Worker: Stufe, Zwischenstand,
-- Lock und Versuche (gleiches Muster wie admin_jobs).
alter table public.blog_analysis_runs
  add column if not exists stage text not null default 'lesen',
  add column if not exists state jsonb not null default '{}',
  add column if not exists attempts int not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists created_by uuid;
alter table public.keyword_audits
  add column if not exists stage text not null default 'sammeln',
  add column if not exists state jsonb not null default '{}',
  add column if not exists percent int not null default 0 check (percent between 0 and 100),
  add column if not exists events jsonb not null default '[]',
  add column if not exists attempts int not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists trigger text not null default 'manuell'
    check (trigger in ('onboarding','manuell','cron')),
  add column if not exists created_by uuid;
create index if not exists blog_analysis_runs_open_idx on public.blog_analysis_runs (status)
  where status in ('queued','running');
create index if not exists keyword_audits_open_idx on public.keyword_audits (status)
  where status in ('queued','running');

-- GA4-Datenstream des Blogs (Onboarding Schritt 6; Property bleibt clients.ga4_property)
alter table public.blog_projects add column if not exists ga4_stream_id text;

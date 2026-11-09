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

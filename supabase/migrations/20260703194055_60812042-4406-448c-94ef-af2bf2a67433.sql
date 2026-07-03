-- ============================================================================
-- AI Visibility Dashboard — Datenmodell (Spec: EzyHub-AI-Visibility-Integration)
-- ============================================================================

create table if not exists public.ai_visibility_reports (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  market            text,
  snapshot_date     date not null,
  score             int  not null,
  score_delta       int  default 0,
  mentions          int  default 0,
  mentions_delta    int  default 0,
  citations         int  default 0,
  citations_delta   int  default 0,
  cited_pages       int  default 0,
  cited_pages_delta int  default 0,
  created_at        timestamptz default now(),
  unique (client_id, snapshot_date)
);

create table if not exists public.ai_visibility_models (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  model_name text not null,
  layer      text check (layer in ('macro','custom')),
  mentions   int  default 0,
  sov        numeric default 0
);

create table if not exists public.ai_visibility_model_country (
  id        uuid primary key default gen_random_uuid(),
  model_id  uuid not null references public.ai_visibility_models(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  country   text not null,
  mentions  int  default 0
);

create table if not exists public.ai_visibility_topics (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  topic      text not null,
  visibility int  default 0,
  mentions   int  default 0,
  volume     int  default 0,
  intent     text
);

create table if not exists public.ai_visibility_prompts (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  prompt         text not null,
  platform       text,
  country        text,
  status         text,
  is_opportunity boolean default false,
  intent         text,
  brands_count   int default 0,
  sources_count  int default 0,
  response       text,
  competitors    text[] default '{}'
);

create table if not exists public.ai_visibility_sources (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  domain    text not null,
  mentions  int default 0,
  share     int default 0,
  urls      int default 0,
  traffic   int default 0
);

create table if not exists public.ai_visibility_attribution (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  engine      text not null,
  sessions    int default 0,
  conversions int default 0
);

create index if not exists idx_aivis_reports_client_date on public.ai_visibility_reports (client_id, snapshot_date desc);
create index if not exists idx_aivis_models_report        on public.ai_visibility_models (report_id);
create index if not exists idx_aivis_model_country_model  on public.ai_visibility_model_country (model_id);
create index if not exists idx_aivis_topics_report        on public.ai_visibility_topics (report_id);
create index if not exists idx_aivis_prompts_report       on public.ai_visibility_prompts (report_id);
create index if not exists idx_aivis_sources_report       on public.ai_visibility_sources (report_id);
create index if not exists idx_aivis_attribution_report   on public.ai_visibility_attribution (report_id);

alter table public.ai_visibility_reports        enable row level security;
alter table public.ai_visibility_models         enable row level security;
alter table public.ai_visibility_model_country  enable row level security;
alter table public.ai_visibility_topics         enable row level security;
alter table public.ai_visibility_prompts        enable row level security;
alter table public.ai_visibility_sources        enable row level security;
alter table public.ai_visibility_attribution    enable row level security;

drop policy if exists aivis_reports_select on public.ai_visibility_reports;
create policy aivis_reports_select on public.ai_visibility_reports
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_models_select on public.ai_visibility_models;
create policy aivis_models_select on public.ai_visibility_models
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_model_country_select on public.ai_visibility_model_country;
create policy aivis_model_country_select on public.ai_visibility_model_country
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_topics_select on public.ai_visibility_topics;
create policy aivis_topics_select on public.ai_visibility_topics
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_prompts_select on public.ai_visibility_prompts;
create policy aivis_prompts_select on public.ai_visibility_prompts
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_sources_select on public.ai_visibility_sources;
create policy aivis_sources_select on public.ai_visibility_sources
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_attribution_select on public.ai_visibility_attribution;
create policy aivis_attribution_select on public.ai_visibility_attribution
  for select to authenticated using (public.can_access_client(client_id));

-- Data-API-Zugriff (ohne diese GRANTs kann PostgREST die Tabellen trotz RLS nicht lesen)
grant select on public.ai_visibility_reports       to authenticated;
grant select on public.ai_visibility_models        to authenticated;
grant select on public.ai_visibility_model_country to authenticated;
grant select on public.ai_visibility_topics        to authenticated;
grant select on public.ai_visibility_prompts       to authenticated;
grant select on public.ai_visibility_sources       to authenticated;
grant select on public.ai_visibility_attribution   to authenticated;
grant all on public.ai_visibility_reports       to service_role;
grant all on public.ai_visibility_models        to service_role;
grant all on public.ai_visibility_model_country to service_role;
grant all on public.ai_visibility_topics        to service_role;
grant all on public.ai_visibility_prompts       to service_role;
grant all on public.ai_visibility_sources       to service_role;
grant all on public.ai_visibility_attribution   to service_role;

-- EzyRank Blog-Autopilot, Phase 1 · Fundament (09.11.2026, Bauanleitung v1.0 Kap. 5).
--
-- Sicherheitsmodell:
--  - Jede Tabelle trägt client_id (bei Kind-Tabellen per Trigger aus dem
--    Projekt abgeleitet und unveränderlich) → RLS = has_client_access(client_id).
--  - Eingeloggte Nutzer dürfen nur LESEN. Alle Schreibvorgänge und
--    Statusübergänge laufen über Serverfunktionen (service_role), nie direkt
--    aus dem Client (Kap. 5 «Übergänge nur über serverseitige Funktionen»).
--  - wp_connections ist für anon/authenticated komplett unsichtbar; der
--    Verbindungsschlüssel liegt mit secretbox verschlüsselt in key_enc
--    (bestehendes Muster statt Vault, siehe wordpress.server.ts).
--  - Feature-Flag pro Kunde: client_app_access (app 'seo') features enthält
--    'blog_autopilot' → blog_autopilot_enabled(client_id).
--  - Zugang nur per Einladung: handle_new_user legt KEINE eigene Organisation
--    mehr an (vorher wurde jedes neue Auth-Konto Owner einer leeren Org).
--
-- ACHTUNG: Lovable wendet Repo-Migrationen nicht automatisch an — manuell
-- via Lovable-SQL ausführen.

-- ── Hilfsfunktionen ─────────────────────────────────────────────────────────

create or replace function public.blog_autopilot_enabled(_client_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.client_app_access a
    where a.client_id = _client_id and a.app = 'seo'
      and coalesce(a.features, '[]'::jsonb) ? 'blog_autopilot'
  );
$$;

-- Kind-Tabellen: client_id aus dem Projekt setzen, Projekt/Kunde unveränderlich,
-- updated_at pflegen.
create or replace function public.blog_child_set_meta()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.client_id := old.client_id;
    new.created_at := old.created_at;
  else
    select p.client_id into new.client_id from public.blog_projects p where p.id = new.project_id;
    if new.client_id is null then
      raise exception 'unknown blog project %', new.project_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.blog_project_set_meta()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    new.client_id := old.client_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ── Tabellen ────────────────────────────────────────────────────────────────

create table if not exists public.blog_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null,
  name text,
  description text check (char_length(description) <= 4000),
  audiences text[] not null default '{}',
  market text not null default 'CH',
  language text not null default 'de-CH',
  local_business boolean not null default false,
  tone text not null default 'informativ' check (tone in ('informativ','gespraechig','ueberzeugend')),
  internal_links int not null default 3 check (internal_links between 0 and 5),
  cta_blocks jsonb not null default '[]',
  excluded_domains text[] not null default '{}',
  image_style text,
  publish_mode text not null default 'wp_draft' check (publish_mode in ('wp_draft','hub_only')),
  publish_time time not null default '09:00',
  timezone text not null default 'Europe/Zurich',
  articles_per_month int,
  min_volume int not null default 10,
  auto_remove_unsourced boolean not null default false,
  onboarding_step int not null default 1 check (onboarding_step between 1 and 8),
  status text not null default 'onboarding' check (status in ('onboarding','active','paused')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, domain)
);

create table if not exists public.blog_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  percent int not null default 0 check (percent between 0 and 100),
  events jsonb not null default '[]',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_competitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null,
  source text not null check (source in ('ki','manuell')),
  validated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, domain)
);

create table if not exists public.keyword_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  sources jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keyword_opportunities (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.keyword_audits(id) on delete cascade,
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword text not null,
  category text not null check (category in ('fast_vorne','neu','abgedeckt','aussortiert')),
  volume int,
  difficulty int,
  avg_position numeric,
  position_delta numeric,
  impressions int,
  parent_topic text,
  covered_by_url text,
  cluster text,
  reason text not null,
  decision text not null default 'offen' check (decision in ('offen','uebernommen','refresh','verworfen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_topics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword text not null,
  cluster text,
  article_type text check (article_type in ('ratgeber','anleitung','erklaerung','uebersicht')),
  volume int,
  difficulty int,
  opportunity_id uuid references public.keyword_opportunities(id) on delete set null,
  kind text not null default 'neu' check (kind in ('neu','refresh')),
  refresh_wp_post_id bigint,
  approved_at timestamptz,
  approved_by uuid,
  scheduled_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_articles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  topic_id uuid references public.blog_topics(id) on delete set null,
  status text not null default 'geplant' check (status in (
    'geplant','freigegeben','schreibt','faktencheck','entwurf_wp',
    'kunde_freigegeben','live','fehler')),
  title text, slug text, excerpt text,
  content_html text,
  seo_title text, meta_description text, focus_keyword text,
  schema_jsonld jsonb,
  featured_image jsonb,
  word_count int,
  wp_post_id bigint, wp_edit_url text, wp_permalink text,
  wp_category_ids bigint[], wp_tag_names text[],
  version int not null default 1,
  error text,
  scheduled_for date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.blog_articles(id) on delete cascade,
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  version int not null,
  content_html text not null,
  reason text check (reason in ('erstellt','faktencheck','ezypilot','manuell')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, version)
);

create table if not exists public.article_claims (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.blog_articles(id) on delete cascade,
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  claim_text text not null,
  claim_type text check (claim_type in ('zahl','statistik','zitat','rechtlich','preis','sonstiges')),
  source_url text,
  status text not null default 'offen' check (status in ('belegt','offen','entfernt','manuell_belegt')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null,
  value text not null,
  source_url text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.writing_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  rule text not null check (char_length(rule) <= 1000),
  source text not null check (source in ('standard','onboarding','feedback','agentur')),
  anchor_excerpt text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wp_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_url text not null,
  -- secretbox-Chiffrat (enc:<ver>:…) des ezr_-Schlüssels; nie Klartext.
  key_enc text,
  scopes text[] not null default '{read,draft}',
  plugin_version text,
  capabilities jsonb,
  status text not null default 'nicht_verbunden' check (status in (
    'nicht_verbunden','test_laeuft','verbunden','aktion_noetig')),
  last_error_code text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.blog_projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  article_id uuid references public.blog_articles(id) on delete set null,
  type text not null,
  payload jsonb,
  actor uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Indizes ─────────────────────────────────────────────────────────────────

create index if not exists blog_projects_client_idx on public.blog_projects (client_id);
create index if not exists blog_analysis_runs_project_idx on public.blog_analysis_runs (project_id, created_at desc);
create index if not exists keyword_audits_project_idx on public.keyword_audits (project_id, created_at desc);
create index if not exists keyword_opportunities_audit_idx on public.keyword_opportunities (audit_id, category);
create index if not exists keyword_opportunities_project_idx on public.keyword_opportunities (project_id);
create index if not exists blog_topics_project_idx on public.blog_topics (project_id, scheduled_for);
create index if not exists blog_articles_project_idx on public.blog_articles (project_id, status, scheduled_for);
create index if not exists article_claims_article_idx on public.article_claims (article_id, status);
create index if not exists blog_events_project_idx on public.blog_events (project_id, created_at desc);

-- ── Trigger, RLS, Rechte ────────────────────────────────────────────────────

drop trigger if exists blog_projects_meta on public.blog_projects;
create trigger blog_projects_meta before insert or update on public.blog_projects
  for each row execute function public.blog_project_set_meta();

do $$
declare
  t text;
  kinder text[] := array[
    'blog_analysis_runs','blog_competitors','keyword_audits','keyword_opportunities',
    'blog_topics','blog_articles','article_versions','article_claims','client_facts',
    'writing_rules','wp_connections','blog_events'];
  alle text[] := array['blog_projects'] || kinder;
begin
  foreach t in array kinder loop
    execute format('drop trigger if exists %I on public.%I', t || '_meta', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.blog_child_set_meta()',
      t || '_meta', t);
  end loop;

  foreach t in array alle loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    if t <> 'wp_connections' then
      -- Nur lesen; Schreiben ausschliesslich serverseitig (service_role).
      execute format('grant select on public.%I to authenticated', t);
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.has_client_access(client_id))',
        t || '_select', t);
    end if;
  end loop;
end $$;

-- ── Zugang nur per Einladung ────────────────────────────────────────────────
-- Neue Auth-Konten bekommen nur noch Profil + Legacy-Rolle. Die Organisations-
-- Mitgliedschaft setzt ausschliesslich die Einladung (/api/admin/team invite).
-- Ein trotz gesperrter Registrierung angelegtes Konto hat damit keine
-- Organisation und über RLS keinerlei Datenzugriff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  _full_name text;
begin
  _full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.email);

  insert into public.profiles (id, full_name)
  values (new.id, _full_name)
  on conflict (id) do nothing;

  if (select count(*) from public.user_roles) = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'member');
  end if;

  return new;
end;
$$;

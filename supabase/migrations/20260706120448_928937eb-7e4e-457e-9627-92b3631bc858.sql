-- ============================================================================
-- AI-Visibility v2: genauere & detailliertere Erfassung.
--   A) LLM-Judge -> Sentiment + Position je Prompt-Antwort
--   C) Share-of-Voice (eigene Marke vs. Konkurrenten) je Report
--   E) Quellen mit Layer-Kennung (macro=Ahrefs / custom=aus Antworten)
--   Konkurrenten: editierbare Fixliste je Kunde (manual) + Auto-Learning (auto)
-- RLS wie gehabt: can_access_client; Konkurrentenliste dürfen Org-Mitglieder pflegen.
-- Additiv/idempotent.
-- ============================================================================

-- A) Prompt-Antworten: Sentiment + Position (Prominenz in der Antwort)
alter table public.ai_visibility_prompts add column if not exists sentiment text
  check (sentiment is null or sentiment in ('pos','neu','neg'));
alter table public.ai_visibility_prompts add column if not exists position text
  check (position is null or position in ('top','list','passing','none'));

-- E) Quellen: woher (Ahrefs vs. aus den Modell-Antworten)
alter table public.ai_visibility_sources add column if not exists layer text default 'macro';

-- Konkurrenten je Kunde (Fixliste + Auto-Learning)
create table if not exists public.ai_visibility_competitors (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  name       text not null,
  source     text default 'manual',            -- 'manual' (gepflegt) | 'auto' (gelernt)
  active     boolean default true,
  created_at timestamptz default now(),
  unique (client_id, name)
);
create index if not exists idx_aivis_comp_client on public.ai_visibility_competitors (client_id) where active;

-- C) Share-of-Voice je Report (eine Zeile je Marke: eigene + Konkurrenten)
create table if not exists public.ai_visibility_sov (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.ai_visibility_reports(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  brand     text not null,
  is_self   boolean default false,
  mentions  int default 0,
  share     numeric default 0                  -- Prozent 0..100
);
create index if not exists idx_aivis_sov_report on public.ai_visibility_sov (report_id);

-- RLS
alter table public.ai_visibility_competitors enable row level security;
alter table public.ai_visibility_sov         enable row level security;

drop policy if exists aivis_comp_select on public.ai_visibility_competitors;
create policy aivis_comp_select on public.ai_visibility_competitors
  for select to authenticated using (public.can_access_client(client_id));
drop policy if exists aivis_comp_write on public.ai_visibility_competitors;
create policy aivis_comp_write on public.ai_visibility_competitors
  for all to authenticated
  using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

drop policy if exists aivis_sov_select on public.ai_visibility_sov;
create policy aivis_sov_select on public.ai_visibility_sov
  for select to authenticated using (public.can_access_client(client_id));
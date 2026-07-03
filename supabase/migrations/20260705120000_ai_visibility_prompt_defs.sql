-- ============================================================================
-- AI-Visibility Stufe 2: Prompt-Definitionen für den Custom-Prompt-Runner.
-- Je Kunde ein Satz Prompts (beim ersten Lauf automatisch generiert, danach
-- editierbar). Der Runner fragt damit Claude/Perplexity/Gemini ab und schreibt
-- die Ergebnisse nach ai_visibility_prompts/_topics (layer='custom').
-- RLS: kanonischer Tenant-Check can_access_client; Org-Mitglieder dürfen
-- Prompts auch pflegen (Definitionen sind Konfiguration, keine Messdaten).
-- ============================================================================
create table if not exists public.ai_visibility_prompt_defs (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  prompt     text not null,
  topic      text,
  intent     text,               -- Kommerziell | Informativ | Transaktional | Navigativ
  country    text default 'Schweiz',
  language   text default 'de',
  active     boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_aivis_prompt_defs_client on public.ai_visibility_prompt_defs (client_id) where active;

alter table public.ai_visibility_prompt_defs enable row level security;

drop policy if exists aivis_prompt_defs_select on public.ai_visibility_prompt_defs;
create policy aivis_prompt_defs_select on public.ai_visibility_prompt_defs
  for select to authenticated using (public.can_access_client(client_id));

drop policy if exists aivis_prompt_defs_write on public.ai_visibility_prompt_defs;
create policy aivis_prompt_defs_write on public.ai_visibility_prompt_defs
  for all to authenticated
  using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

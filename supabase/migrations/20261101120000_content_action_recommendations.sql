-- Cache der KI-Empfehlungen zu Content-Massnahmen (01.11.2026):
-- /api/admin/content-actions/recommendation schreibt je (Kunde, URL, Typ) das
-- letzte Ergebnis und verwendet es bis 7 Tage wieder. Nur service_role
-- (RLS an, keine Policies → für anon/authenticated unsichtbar).
create table if not exists public.content_action_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  url text not null,
  type text not null,
  keyword text,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  constraint content_action_recommendations_uniq unique (client_id, url, type)
);
alter table public.content_action_recommendations enable row level security;
revoke all on public.content_action_recommendations from anon, authenticated;
grant all on public.content_action_recommendations to service_role;

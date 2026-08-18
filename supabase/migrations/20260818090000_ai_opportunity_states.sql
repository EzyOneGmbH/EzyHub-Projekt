-- Chancen-Workflow (18.08.2026): persistenter Bearbeitungsstatus je automatisch
-- erkannter Chance. Die Chancen selbst bleiben abgeleitet (Site Health, Zitat-
-- Gaps, Prompt-Chancen, Kuration) — diese Tabelle speichert NUR den Workflow-
-- Zustand, verknüpft über einen stabilen Fingerprint (siehe aiOpportunities.ts).
--
-- ACHTUNG: Lovable wendet Repo-Migrationen nicht automatisch an — dieses File
-- wird manuell via Lovable-SQL ausgeführt (wie content_briefs, app_notifications).

create table if not exists public.ai_opportunity_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  fingerprint text not null,
  status text not null default 'offen'
    check (status in ('offen','in_bearbeitung','pausiert','erledigt','verworfen')),
  assignee text,
  note text,
  resurface_on date,
  -- Snapshot von Titel/Quelle, damit erledigte Chancen lesbar bleiben, auch
  -- wenn die Quelle (z. B. ein behobenes Site-Health-Issue) verschwunden ist.
  title text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_opportunity_states_client_fp unique (client_id, fingerprint)
);

create index if not exists ai_opportunity_states_client_idx
  on public.ai_opportunity_states (client_id, status);

-- organization_id IMMER vom Kunden ableiten (kein Client-Input maßgeblich) +
-- updated_at pflegen. Security definer, damit der Lookup RLS-unabhängig stimmt.
create or replace function public.ai_opportunity_states_set_org()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c where c.id = new.client_id;
  if new.organization_id is null then
    raise exception 'unknown client %', new.client_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ai_opportunity_states_org on public.ai_opportunity_states;
create trigger ai_opportunity_states_org
  before insert or update on public.ai_opportunity_states
  for each row execute function public.ai_opportunity_states_set_org();

-- Schreiben nur für Org-Mitglieder, die KEINE Viewer sind (Viewer = read-only).
create or replace function public.can_edit_client(_client_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.is_org_member(c.organization_id)
     and coalesce(public.org_role_of(c.organization_id)::text, '') <> 'viewer'
  from public.clients c where c.id = _client_id;
$$;

alter table public.ai_opportunity_states enable row level security;

drop policy if exists ai_opportunity_states_select on public.ai_opportunity_states;
create policy ai_opportunity_states_select on public.ai_opportunity_states
  for select using (public.can_access_client(client_id));

drop policy if exists ai_opportunity_states_write on public.ai_opportunity_states;
create policy ai_opportunity_states_write on public.ai_opportunity_states
  for all using (public.can_edit_client(client_id))
  with check (public.can_edit_client(client_id));

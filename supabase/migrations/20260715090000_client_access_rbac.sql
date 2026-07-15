-- Mitarbeiter-Zugriffe (RBAC-Erweiterung, 2026-07-15)
-- Ziel: SuperAdmin(owner)/admin sehen alles; "member" = Mitarbeiter sieht NUR
-- zugewiesene Kunden, darf Audits starten, aber KEINE Kunden-Einstellungen
-- aendern. viewer bleibt reiner Nur-Lese-Stakeholder.

-- 1) Zuweisungstabelle: welcher Nutzer welchen Kunden sieht.
create table if not exists public.client_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists client_access_user_idx on public.client_access(user_id);
create index if not exists client_access_client_idx on public.client_access(client_id);
alter table public.client_access enable row level security;

-- 2) Zugriffs-Helper: Admin (owner/admin) sieht ALLES; sonst nur zugewiesene Kunden.
create or replace function public.has_client_access(_client_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.clients c
    where c.id = _client_id and public.is_org_admin(c.organization_id)
  ) or exists (
    select 1 from public.client_access ca
    where ca.client_id = _client_id and ca.user_id = auth.uid()
  );
$$;

-- 3) RLS auf client_access: Mitglieder lesen (eigene/zur Org), nur Admin schreibt.
drop policy if exists client_access_select on public.client_access;
create policy client_access_select on public.client_access
  for select using (public.is_org_member(organization_id));
drop policy if exists client_access_admin_write on public.client_access;
create policy client_access_admin_write on public.client_access
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- 4) SELECT-Policies auf Zuweisung filtern (Admin sieht alles, Mitglied nur zugewiesen).
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select using (
    public.is_org_admin(organization_id)
    or (public.is_org_member(organization_id) and public.has_client_access(id))
  );

drop policy if exists audit_select on public.audit_runs;
create policy audit_select on public.audit_runs
  for select using (
    public.is_org_admin(organization_id)
    or (public.is_org_member(organization_id) and public.has_client_access(client_id))
  );

drop policy if exists ci_select on public.client_integrations;
create policy ci_select on public.client_integrations
  for select using (
    public.is_org_admin(organization_id)
    or (public.is_org_member(organization_id) and public.has_client_access(client_id))
  );

drop policy if exists cd_select on public.customer_defaults;
create policy cd_select on public.customer_defaults
  for select using (
    public.is_org_admin(organization_id)
    or (public.is_org_member(organization_id) and (client_id is null or public.has_client_access(client_id)))
  );

-- 5) Kunden-EINSTELLUNGEN nur owner/admin (member verliert die Bearbeitung).
--    client_integrations + customer_defaults sind bereits admin-only (ci/cd_admin_write).
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- 6) Audits per User-Session nur auf zugewiesenen Kunden (Agent-Service nutzt
--    service_role und umgeht RLS ohnehin -> reine UI-Absicherung).
drop policy if exists audit_insert on public.audit_runs;
create policy audit_insert on public.audit_runs
  for insert with check (
    public.can_run_audits(organization_id)
    and auth.uid() = triggered_by
    and public.has_client_access(client_id)
  );

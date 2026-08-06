create table if not exists public.client_app_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  app text not null check (app in ('seo','geo','ads','reakt')),
  enabled boolean not null default true,
  features jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (client_id, app)
);

create index if not exists client_app_access_client_idx on public.client_app_access(client_id);
create index if not exists client_app_access_org_idx on public.client_app_access(organization_id);

alter table public.client_app_access enable row level security;

grant select, insert, update, delete on public.client_app_access to authenticated;
grant all on public.client_app_access to service_role;

drop policy if exists caa_select on public.client_app_access;
create policy caa_select on public.client_app_access
  for select using (
    public.is_org_admin(organization_id)
    or (public.is_org_member(organization_id) and public.has_client_access(client_id))
  );

drop policy if exists caa_admin_write on public.client_app_access;
create policy caa_admin_write on public.client_app_access
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (public.is_org_member(organization_id) and public.can_run_audits(organization_id));
-- Admin-Aenderungsprotokoll (17.08.2026), MANUELL via Lovable-SQL angewendet
-- (Lovable wendet Repo-Migrationen nicht automatisch an — Datei = Doku/Referenz).
-- Serverseitige DB-Trigger protokollieren JEDEN Schreibweg (UI, API, Service-
-- Role) mit Feld-Whitelist je Tabelle; Secrets/Configs (client_integrations.
-- config, oauth-Tokens) werden NIE geloggt. RLS ohne Policies: Zugriff nur
-- ueber die Service-Route /api/admin/audit-log (owner/admin).
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  at timestamptz not null default now(),
  target_table text not null,
  target_id text,
  client_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb
);
alter table public.admin_audit_log enable row level security;
create index if not exists admin_audit_log_org_client_idx
  on public.admin_audit_log (organization_id, client_id, at desc);

create or replace function public.admin_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cols text[] := tg_argv;
  c text;
  oldj jsonb := '{}'::jsonb;
  newj jsonb := '{}'::jsonb;
  oldrec jsonb; newrec jsonb; rec jsonb;
  org uuid; cid uuid;
begin
  oldrec := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  newrec := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
  rec := coalesce(newrec, oldrec);
  foreach c in array cols loop
    if oldrec is not null then oldj := oldj || jsonb_build_object(c, oldrec -> c); end if;
    if newrec is not null then newj := newj || jsonb_build_object(c, newrec -> c); end if;
  end loop;
  if tg_op = 'UPDATE' and oldj = newj then
    return new; -- Aenderung ausserhalb der Whitelist -> kein Rauschen
  end if;
  org := nullif(rec ->> 'organization_id', '')::uuid;
  cid := nullif(rec ->> 'client_id', '')::uuid;
  -- clients-Zeilen: die eigene id IST der Kunde (fuers Kundendetail-Protokoll).
  if cid is null and tg_table_name = 'clients' then
    cid := nullif(rec ->> 'id', '')::uuid;
  end if;
  if org is null and cid is not null then
    select organization_id into org from public.clients where id = cid;
  end if;
  insert into public.admin_audit_log
    (organization_id, user_id, target_table, target_id, client_id, action, old_value, new_value)
  values (
    org, auth.uid(), tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id', rec ->> 'client_id'),
    cid, lower(tg_op),
    nullif(oldj, '{}'::jsonb), nullif(newj, '{}'::jsonb)
  );
  return coalesce(new, old);
end $$;

drop trigger if exists audit_app_access on public.app_access;
create trigger audit_app_access after insert or update or delete on public.app_access
  for each row execute function public.admin_audit_trigger('user_id','app');
drop trigger if exists audit_client_app_access on public.client_app_access;
create trigger audit_client_app_access after insert or update or delete on public.client_app_access
  for each row execute function public.admin_audit_trigger('app','enabled','features');
drop trigger if exists audit_client_integrations on public.client_integrations;
create trigger audit_client_integrations after insert or update or delete on public.client_integrations
  for each row execute function public.admin_audit_trigger('provider','enabled');
drop trigger if exists audit_app_users on public.app_users;
create trigger audit_app_users after insert or update or delete on public.app_users
  for each row execute function public.admin_audit_trigger('user_id','role');
drop trigger if exists audit_client_access on public.client_access;
create trigger audit_client_access after insert or update or delete on public.client_access
  for each row execute function public.admin_audit_trigger('user_id','client_id');
drop trigger if exists audit_ads_autopilot_config on public.ads_autopilot_config;
create trigger audit_ads_autopilot_config after insert or update or delete on public.ads_autopilot_config
  for each row execute function public.admin_audit_trigger('kill_switch','autonomy_level','observe_only','monthly_budget_chf','target_cpa_chf','target_roas','no_touch_campaigns');
drop trigger if exists audit_clients_config on public.clients;
create trigger audit_clients_config after update on public.clients
  for each row execute function public.admin_audit_trigger('gsc_property','ga4_property','canonry_project','google_ads_customer');

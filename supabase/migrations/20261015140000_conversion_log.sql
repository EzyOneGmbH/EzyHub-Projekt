-- Conversion-Log (15.10.2026, Volkan): telefonische Leads je Kunde (zuerst
-- Studioforma). Erfassen dürfen alle Logins mit Zugriff auf den Kunden — auch
-- Kunden-Logins (viewer) —, «eingetragen von» setzt die DB (nicht fälschbar).
-- Eigene Einträge darf man ändern/löschen, das Team (kein viewer) alle.
--
-- Dazu login_ansicht: beschränkt einzelne Logins auf eine Ansicht (heute nur
-- 'conversion_log' — diese Logins sehen in EzyHub NUR /conversion-log).
--
-- ACHTUNG: Lovable wendet Repo-Migrationen nicht automatisch an — manuell
-- via Lovable-SQL ausführen.

create table if not exists public.conversion_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  datum date not null default (now() at time zone 'Europe/Zurich')::date,
  firma text not null default '' check (char_length(firma) <= 200),
  telefon text not null default '' check (char_length(telefon) <= 60),
  person text not null default '' check (char_length(person) <= 200),
  grund text not null default '' check (char_length(grund) <= 2000),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversion_log_client_idx
  on public.conversion_log (client_id, datum desc, created_at desc);

-- organization_id vom Kunden ableiten; Ersteller beim INSERT aus dem Login
-- setzen und bei UPDATE unveränderlich halten.
create or replace function public.conversion_log_set_meta()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c where c.id = new.client_id;
  if new.organization_id is null then
    raise exception 'unknown client %', new.client_id;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_email := coalesce(auth.jwt() ->> 'email', new.created_by_email);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
    new.client_id := old.client_id;
    new.organization_id := old.organization_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists conversion_log_meta on public.conversion_log;
create trigger conversion_log_meta
  before insert or update on public.conversion_log
  for each row execute function public.conversion_log_set_meta();

alter table public.conversion_log enable row level security;

drop policy if exists conversion_log_select on public.conversion_log;
create policy conversion_log_select on public.conversion_log
  for select to authenticated using (public.has_client_access(client_id));

drop policy if exists conversion_log_insert on public.conversion_log;
create policy conversion_log_insert on public.conversion_log
  for insert to authenticated with check (public.has_client_access(client_id));

drop policy if exists conversion_log_update on public.conversion_log;
create policy conversion_log_update on public.conversion_log
  for update to authenticated
  using (
    public.has_client_access(client_id)
    and (created_by = auth.uid() or public.can_edit_client(client_id))
  )
  with check (public.has_client_access(client_id));

drop policy if exists conversion_log_delete on public.conversion_log;
create policy conversion_log_delete on public.conversion_log
  for delete to authenticated
  using (
    public.has_client_access(client_id)
    and (created_by = auth.uid() or public.can_edit_client(client_id))
  );

-- Ansichts-Beschränkung je Login.
create table if not exists public.login_ansicht (
  user_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ansicht text not null check (ansicht in ('conversion_log')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

alter table public.login_ansicht enable row level security;

drop policy if exists login_ansicht_select on public.login_ansicht;
create policy login_ansicht_select on public.login_ansicht
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin(organization_id));

drop policy if exists login_ansicht_write on public.login_ansicht;
create policy login_ansicht_write on public.login_ansicht
  for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

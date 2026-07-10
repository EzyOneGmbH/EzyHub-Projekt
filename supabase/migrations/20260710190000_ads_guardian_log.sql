-- Phase 1 (Erweiterungs-Brief): ads_guardian_log - Persistenz des taeglichen
-- Waechter-Laufs (rein deterministischer Melder, keine Actions/Approvals).
-- Append-only-Haertung von Anfang an: DELETE und UPDATE komplett verboten
-- (ein Log wird nie korrigiert, nur fortgeschrieben) - Trigger greift fuer
-- ALLE Rollen inkl. service_role, analog ads_changelog.
--
-- HINWEIS: Lovable wendet Repo-Migrationen NICHT automatisch an - Datei wurde
-- am 10.07.2026 manuell auf der Prod-DB ausgefuehrt (hier versioniert).

create table if not exists public.ads_guardian_log (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete restrict,
  checked_at timestamptz not null default now(),
  status     text not null check (status in ('ok','warn','critical')),
  findings   jsonb not null default '[]'::jsonb
);

create index if not exists ads_guardian_log_client_time
  on public.ads_guardian_log (client_id, checked_at desc);

-- RLS: SPA darf lesen (gleiches Muster wie ads_changelog); Schreiben nur server-seitig.
alter table public.ads_guardian_log enable row level security;
drop policy if exists ads_guardian_log_select on public.ads_guardian_log;
create policy ads_guardian_log_select on public.ads_guardian_log
  for select to authenticated using (public.can_access_client(client_id));

-- Append-only: weder DELETE noch UPDATE, fuer niemanden ohne DROP TRIGGER.
create or replace function public.ads_guardian_log_guard()
returns trigger
language plpgsql
security definer
as $$
begin
  raise exception 'ads_guardian_log ist append-only: % verboten (Waechter-Historie).', tg_op;
end
$$;

drop trigger if exists trg_ads_guardian_log_guard on public.ads_guardian_log;
create trigger trg_ads_guardian_log_guard
  before update or delete on public.ads_guardian_log
  for each row execute function public.ads_guardian_log_guard();

comment on table public.ads_guardian_log is
  'Taeglicher Ads-Waechter-Lauf (Budget-Pacing, Policy, Impressions-Absturz, Tracking) - reiner Melder, append-only.';

-- Phase 0 Zusatzauftrag (C) - Changelog-Integritaet (10.07.2026)
-- Befund: a-002-Zeilen wurden am 08.07. manuell per SQL (service_role, RLS-Bypass)
-- aus ads_approvals UND ads_changelog geloescht statt rejected. RLS kann den
-- service_role-Pfad nicht absichern -> Trigger, die fuer ALLE Rollen greifen.
--
-- 1) ads_changelog ist append-only: DELETE verboten; UPDATE nur auf die
--    Status-Felder (status, approved_by) - alle anderen Spalten unveraenderlich.
-- 2) ads_approvals werden nie geloescht - Lebenszyklus endet in
--    rejected/expired/superseded/executed/failed.
-- 3) Status-Checks erweitert: 'executing' (atomarer Idempotenz-Claim, Phase 0.3)
--    und 'superseded' (Abloesung statt Loeschung).
-- 4) client_id-FKs auf RESTRICT: ohne dies wuerde ein Client-Delete (UI-Funktion
--    existiert) via CASCADE am neuen DELETE-Trigger scheitern - RESTRICT macht
--    das Verhalten explizit statt als kryptische Trigger-Exception.
--
-- HINWEIS: Lovable wendet Repo-Migrationen NICHT automatisch an - diese Datei
-- wurde am 10.07.2026 manuell auf der Prod-DB ausgefuehrt (versioniert hier).

-- ── 3) Status-Checks ─────────────────────────────────────────────────────────
alter table public.ads_approvals drop constraint if exists ads_approvals_status_check;
alter table public.ads_approvals add constraint ads_approvals_status_check
  check (status = any (array[
    'pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text,
    'executed'::text, 'failed'::text, 'executing'::text, 'superseded'::text
  ]));

-- ── 1) ads_changelog append-only ─────────────────────────────────────────────
create or replace function public.ads_changelog_guard()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ads_changelog ist append-only: DELETE verboten (Audit-Trail). Korrekturen als neuer Eintrag (z.B. action_type audit_note).';
  end if;
  -- UPDATE: nur status + approved_by duerfen sich aendern (spaltenrobust via jsonb)
  if (to_jsonb(new) - 'status' - 'approved_by')
     is distinct from
     (to_jsonb(old) - 'status' - 'approved_by') then
    raise exception 'ads_changelog: UPDATE nur auf status/approved_by erlaubt (append-only Audit-Trail).';
  end if;
  return new;
end
$$;

drop trigger if exists trg_ads_changelog_guard on public.ads_changelog;
create trigger trg_ads_changelog_guard
  before update or delete on public.ads_changelog
  for each row execute function public.ads_changelog_guard();

-- ── 2) ads_approvals: nie loeschen ───────────────────────────────────────────
create or replace function public.ads_approvals_no_delete()
returns trigger
language plpgsql
security definer
as $$
begin
  raise exception 'ads_approvals werden nie geloescht - Status rejected/expired/superseded setzen.';
end
$$;

drop trigger if exists trg_ads_approvals_no_delete on public.ads_approvals;
create trigger trg_ads_approvals_no_delete
  before delete on public.ads_approvals
  for each row execute function public.ads_approvals_no_delete();

-- ── 4) client_id-FKs auf RESTRICT ────────────────────────────────────────────
alter table public.ads_changelog drop constraint if exists ads_changelog_client_id_fkey;
alter table public.ads_changelog add constraint ads_changelog_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.ads_approvals drop constraint if exists ads_approvals_client_id_fkey;
alter table public.ads_approvals add constraint ads_approvals_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

comment on function public.ads_changelog_guard() is
  'Append-only-Guard: blockiert DELETE komplett und UPDATE auf alle Spalten ausser status/approved_by - greift fuer ALLE Rollen inkl. service_role (RLS-Bypass-Schutz). Bewusste Aufhebung nur via DROP TRIGGER (sichtbare Huerde).';
comment on function public.ads_approvals_no_delete() is
  'Approvals sind nie loeschbar - Lebenszyklus: pending -> executing -> executed/failed bzw. rejected/expired/superseded.';

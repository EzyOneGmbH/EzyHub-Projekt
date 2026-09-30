-- Performance (30.09.2026, Volkan: «Ladegeschwindigkeit der Daten verbessern»).
-- Befund pg_stat_statements (127 Tage): Agentur-Übersicht lud je Aufruf die
-- letzten 200 audit_runs aller Kunden und entpackte dabei jedes grosse result
-- (Ø 411 ms, max 8 s, 795'000 Aufrufe). Gemessen: 4'026 ms → 123 ms.
-- Live angewendet per Lovable-SQL.

-- Je Kunde/Typ/Status der neueste Lauf direkt per Index.
create index if not exists idx_audit_runs_client_type_status_created
  on public.audit_runs (client_id, audit_type, status, created_at desc);
-- Serverseitige Scans nach Typ (z. B. onboarding-pending, 1.2 s → Index).
create index if not exists idx_audit_runs_type_created
  on public.audit_runs (audit_type, created_at desc);
-- Content-Liste je Kunde, sortiert nach Aenderung.
create index if not exists idx_ci_client_updated
  on public.content_items (client_id, updated_at desc);

-- Je Kunde NUR der neueste erfolgreiche Lauf; JSON-Felder serverseitig
-- ausgeschnitten (nur diese eine Zeile je Kunde wird entpackt).
-- security invoker: RLS von audit_runs gilt unveraendert.
create or replace function public.neueste_laeufe(_client_ids uuid[], _audit_type text, _felder text[])
returns table (client_id uuid, created_at timestamptz, felder jsonb)
language sql stable security invoker set search_path to 'public'
as $$
  select l.client_id, l.created_at,
         (select coalesce(jsonb_object_agg(f, a.result -> f), '{}'::jsonb)
            from public.audit_runs a, unnest(_felder) f where a.id = l.id) as felder
    from unnest(_client_ids) k(id)
    cross join lateral (
      select r.id, r.client_id, r.created_at from public.audit_runs r
       where r.client_id = k.id and r.audit_type = _audit_type and r.status = 'succeeded'
       order by r.created_at desc limit 1
    ) l;
$$;
grant execute on function public.neueste_laeufe(uuid[], text, text[]) to authenticated, service_role;

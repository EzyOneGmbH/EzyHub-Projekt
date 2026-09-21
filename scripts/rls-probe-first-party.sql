-- RLS-Probe First-Party-KPIs (22.09.2026): laeuft gegen die ECHTE Datenbank
-- (Lovable query_database als postgres) und prueft die Policies selbst — das
-- koennen die Vitest-Mocks nicht. Simuliert einen eingeloggten Nutzer ueber
-- `set local role authenticated` + JWT-Claims. Erwartung:
--   * Mitglied/Admin von Organisation B liest 0 Zeilen von Kunde A
--   * kpi_*-Funktionen werfen fuer B 'forbidden' (42501)
--   * Admin von Organisation A liest die Zeilen von Kunde A
-- Aufruf: Platzhalter ersetzen (USER_B = user_id eines Admins in Org B,
-- USER_A = user_id eines Admins in Org A, CLIENT_A = Kunde in Org A).
-- Ergebnis: jede Zeile der Ausgabe muss `ok` sein.

begin;

-- Testzeile fuer Kunde A (als postgres, RLS greift nicht)
insert into public.gsc_daily (client_id, date, query, page, clicks, impressions, ctr, position)
values ('CLIENT_A', '2026-09-01', 'rls-probe', 'https://probe.test/', 1, 10, 0.1, 5)
on conflict do nothing;

-- ── Fremder Mandant (Org B) ─────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'USER_B', 'role', 'authenticated')::text, true);

select case when count(*) = 0 then 'ok' else 'FEHLER: Org B sieht gsc_daily von Kunde A' end as probe_b_gsc
from public.gsc_daily where client_id = 'CLIENT_A';
select case when count(*) = 0 then 'ok' else 'FEHLER: Org B sieht ga4_landing_daily' end as probe_b_ga4
from public.ga4_landing_daily where client_id = 'CLIENT_A';
select case when count(*) = 0 then 'ok' else 'FEHLER: Org B sieht sync_status' end as probe_b_status
from public.first_party_sync_status where client_id = 'CLIENT_A';

do $$
begin
  perform * from public.kpi_datenstand('CLIENT_A');
  raise exception 'FEHLER: kpi_datenstand fuer Org B erlaubt';
exception when insufficient_privilege then
  raise notice 'ok: kpi_datenstand verweigert (42501)';
end $$;

-- ── Eigener Mandant (Org A, Admin) ──────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'USER_A', 'role', 'authenticated')::text, true);
select case when count(*) >= 1 then 'ok' else 'FEHLER: Admin A sieht eigene Zeile nicht' end as probe_a_gsc
from public.gsc_daily where client_id = 'CLIENT_A' and query = 'rls-probe';
select case when count(*) = 2 then 'ok' else 'FEHLER: kpi_datenstand fuer Admin A' end as probe_a_funktion
from public.kpi_datenstand('CLIENT_A');

rollback; -- Testzeile wieder weg

-- Portal-Sichtbarkeit je Kunde und App (Volkan 01.10.2026: «steuern, was der
-- Kunde sieht, ohne dass es uns selbst betrifft»).
-- enabled        = Kunde ist in der App aktiv (Team-Sicht + Datenläufe).
-- portal_visible = Kunden-Logins (Rolle viewer) sehen die App im Portal.
-- Default true: bestehende Freigaben verhalten sich unverändert.
alter table public.client_app_access
  add column if not exists portal_visible boolean not null default true;

comment on column public.client_app_access.portal_visible is
  'Nur Kundenportal (viewer): App im Portal sichtbar. Wirkt nicht auf Team-Sicht oder Datenläufe.';

-- Dashboard-Ausbau SEO (Brief 2026-07-11), 0.1/3: Pro-Kunde-Konfiguration.
-- brand_terms: Brand-Queries fuer den GSC Brand/Non-Brand-Split (WP2).
--   Leer -> Code-Fallback: Domain-Stamm in drei Varianten.
-- revenue_mode: reine Anzeige-Steuerung Conversions-Tab (B5) —
--   'revenue' (Default, Verhalten unveraendert) | 'clicks' (Buchungsklicks-Label).
-- Additiv + idempotent; Rollback laut Brief: Spalten bleiben (harmlos), nicht droppen.

alter table public.clients
  add column if not exists brand_terms text[] not null default '{}';

alter table public.clients
  add column if not exists revenue_mode text not null default 'revenue';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_revenue_mode_check'
  ) then
    alter table public.clients
      add constraint clients_revenue_mode_check
      check (revenue_mode in ('revenue', 'clicks'));
  end if;
end $$;

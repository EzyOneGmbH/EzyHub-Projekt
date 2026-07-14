-- KI-Sichtbarkeit: Conversion-Detail je Engine.
-- events = [{ "name": "<GA4-Key-Event>", "count": <Anzahl> }, ...] — zeigt im
-- Dashboard, WELCHE Conversion ein KI-Modell ausgelöst hat (Klick auf Kachel).
alter table public.ai_visibility_attribution
  add column if not exists events jsonb not null default '[]'::jsonb;

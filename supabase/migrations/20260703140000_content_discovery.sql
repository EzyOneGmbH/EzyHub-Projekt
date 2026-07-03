-- ============================================================================
-- Voraussetzung für automatisches Blog-Discovery (WP-Posts -> content_items).
-- (1) System-/Sync-Inserts ohne eingeloggten User erlauben.
-- (2) Idempotenter Upsert je (client_id, target_url).
-- Additiv/idempotent.
-- ============================================================================

-- (1) content_items werden künftig auch vom Discovery-Sync (service_role) angelegt,
--     ohne created_by -> Spalte nullable machen (App setzt sie weiterhin).
alter table public.content_items alter column created_by drop not null;

-- (2) Eindeutigkeit je Kunde+URL für on-conflict-Upsert. VOLLER Index (nicht
--     partiell): Supabase/PostgREST on_conflict kann ein partielles Prädikat
--     nicht ansprechen. target_url ist nullbar -> NULLs gelten als verschieden,
--     also kein Konflikt zwischen mehreren NULL-URL-Zeilen (unkritisch).
create unique index if not exists uq_ci_client_url
  on public.content_items (client_id, target_url);

-- Marker, dass ein Artikel automatisch entdeckt wurde (vs. manuell angelegt).
alter table public.content_items add column if not exists source text default 'manual';

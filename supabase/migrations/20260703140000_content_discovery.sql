-- ============================================================================
-- Voraussetzung für automatisches Blog-Discovery (WP-Posts -> content_items).
-- (1) System-/Sync-Inserts ohne eingeloggten User erlauben.
-- (2) Idempotenter Upsert je (client_id, target_url).
-- Additiv/idempotent.
-- ============================================================================

-- (1) content_items werden künftig auch vom Discovery-Sync (service_role) angelegt,
--     ohne created_by -> Spalte nullable machen (App setzt sie weiterhin).
alter table public.content_items alter column created_by drop not null;

-- (2) Eindeutigkeit je Kunde+URL für on-conflict-Upsert (nur wo URL gesetzt).
create unique index if not exists uq_ci_client_url
  on public.content_items (client_id, target_url)
  where target_url is not null;

-- Marker, dass ein Artikel automatisch entdeckt wurde (vs. manuell angelegt).
alter table public.content_items add column if not exists source text default 'manual';

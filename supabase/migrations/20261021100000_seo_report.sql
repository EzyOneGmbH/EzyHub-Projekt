-- SEO-Monatsreport für n8n «SEO Monatspräsentation» (21.10.2026).
-- Routen /api/admin/seo-clients und /api/admin/seo-report. Daten aus EzyHub,
-- DataForSEO, GSC und GA4 (kein Sistrix).
-- Domain, GSC-Property, GA4-Property und Brand-Begriffe kommen weiter aus
-- public.clients — hier liegen nur die Report-spezifischen Felder (1:1).
-- Zugriff nur serverseitig (service_role): RLS an, bewusst KEINE Policies.

create table if not exists public.seo_report_config (
  client_id uuid primary key references public.clients(id) on delete cascade,
  report_active boolean not null default false,
  strategic_keywords text[] not null default '{}',     -- leer = Top-Keywords nach Suchvolumen
  brand_regex text,                                    -- leer = clients.brand_terms
  awork_project_id uuid unique,
  website text,                                        -- leer = https://<clients.domain>
  dfs_location_code integer not null default 2756,     -- DataForSEO Labs: Schweiz
  dfs_language_code text not null default 'de',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.seo_report_config enable row level security;
revoke all on public.seo_report_config from anon, authenticated;
grant select, insert, update, delete on public.seo_report_config to service_role;

-- Ein Snapshot je Kunde und Berichtsmonat: Antwort-Cache (keine Kosten beim
-- zweiten Aufruf) und Fallback für Vormonats-Positionen, falls die
-- Keyword-Historie fehlt.
create table if not exists public.seo_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  payload jsonb not null,
  dataforseo_cost numeric(10, 4) not null default 0,   -- USD je Abruf
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, month)
);
alter table public.seo_report_snapshots enable row level security;
revoke all on public.seo_report_snapshots from anon, authenticated;
grant select, insert, update, delete on public.seo_report_snapshots to service_role;

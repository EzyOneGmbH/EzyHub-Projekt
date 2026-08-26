-- Conversion-Scout (Pilot FIH, 26.08.2026): automatische Erkennung moeglicher
-- GA4-Conversions (mailto/tel/Download) auf der Kundenseite + Freigabe-Liste.
-- NUR ORGANIC: die daraus entstehenden Key Events dienen der organischen
-- Messung (EzyRank/EzyAI Organic-Modus) und werden NIE mit Google Ads
-- verknuepft (kein Ads-Import, kein Einfluss auf Smart Bidding).
-- Jede Mailadresse/Nummer ist ein EIGENER Kandidat (kein generisches
-- "Mail-Klick"-Event) und wird einzeln freigegeben.
-- Zugriff AUSSCHLIESSLICH ueber Server-Routen (service_role): RLS aktiv ohne
-- Policies = clientseitig komplett gesperrt (Muster admin_jobs/openai_ads).
-- WICHTIG: Lovable wendet Repo-Migrationen NICHT automatisch an — dieses File
-- wurde am 26.08.2026 via Lovable query_database auf der Prod-DB ausgefuehrt.

create table if not exists public.conversion_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  candidate_type text not null,           -- 'mailto' | 'tel' | 'download' (Phase 2: 'form')
  raw_value text not null,                -- exakte Adresse/Nummer/Datei-URL, normalisiert
  label text,                             -- Anzeigename (z. B. Linktext), rein informativ
  source_url text not null,               -- Seite, auf der der Kandidat gefunden wurde
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'pending', -- 'pending' | 'approved' | 'ignored'
  conversion_value numeric,               -- Wert je Conversion (bei Freigabe gesetzt)
  conversion_currency text not null default 'CHF',
  ga4_destination_event text,             -- Event-Name in GA4 (erst nach Freigabe)
  ga4_event_create_rule text,             -- Resource-Name der Event Create Rule (Revocation)
  ga4_key_event text,                     -- Resource-Name des Key Events (Revocation)
  decided_at timestamptz,
  decided_by uuid,
  unique (client_id, candidate_type, raw_value)
);
alter table public.conversion_candidates enable row level security;

create index if not exists conversion_candidates_client_status_idx
  on public.conversion_candidates (client_id, status, last_seen_at desc);

create table if not exists public.conversion_scan_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  resolved_target_url text,               -- finale URL nach Redirect-Aufloesung
  pages_crawled integer,
  status text not null default 'running', -- 'running' | 'success' | 'error'
  error_message text,
  new_candidates_count integer,
  seen_candidates_count integer
);
alter table public.conversion_scan_runs enable row level security;

create index if not exists conversion_scan_runs_client_idx
  on public.conversion_scan_runs (client_id, started_at desc);

-- ChatGPT-Ads-Modul, Ausbau 01.09.2026 (Advertiser-API-Neuerungen):
-- Custom Audiences + Geo-Targeting je Kampagne.
-- BEREITS ANGEWENDET via Lovable query_database (Prod-DB glrgccmujzuwnhyvwxyi) —
-- diese Datei dokumentiert das Schema (Lovable wendet Repo-Migrationen nicht
-- automatisch an).

-- Geo-Targeting der Kampagne mit Anzeige-Namen (die API liefert nur IDs;
-- Namen kommen aus dem geo_lookup beim Setzen und werden hier mitgeführt).
alter table chatgpt_ads_campaigns add column if not exists targeting_locations jsonb;

-- Custom Audiences (Kundenlisten, gehasht hochgeladen). Status-Werte gem.
-- API: upload_pending | processing | publishing | ready | too_small | failed | archived
create table if not exists chatgpt_ads_audiences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  openai_audience_id text not null,
  name text not null,
  description text,
  status text not null default 'processing',
  identifier_type text,               -- email_sha256 | phone_number_sha256 | email | phone | gaid
  matched_user_count_range text,      -- under_25k | 25k_100k | ... | none
  membership_revision integer,
  identifier_count integer,           -- Anzahl hochgeladener Identifikatoren (unsere Zählung)
  raw jsonb,
  created_at timestamptz default now(),
  synced_at timestamptz default now(),
  unique (account_id, openai_audience_id)
);

-- RLS: service-role-only (keine Policies) — wie alle chatgpt_ads_*-Tabellen;
-- Kunden-Sichtbarkeit prüft die Server-Route selbst.
alter table chatgpt_ads_audiences enable row level security;
create index if not exists idx_cga_audiences_account on chatgpt_ads_audiences(account_id);

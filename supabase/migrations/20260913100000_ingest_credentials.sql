-- Mandantenfeste Ingest-Credentials (Security-Runde 3, 13.09.2026).
--
-- Ersetzt die global an Kunden verteilten Ingest-Secrets
-- (OPENAI_ADS_INGEST_SECRET / CRAWLER_INGEST_SECRET). Jedes Credential ist
-- serverseitig FEST an organization_id + client_id + purpose gebunden — eine
-- im Request angegebene clientId/Domain kann den Scope nie erweitern.
--
-- Es wird NUR der sha256-Hash des Tokens gespeichert (Muster wie
-- public_report_links). token_prefix (12 Zeichen, nicht geheim) dient der
-- Wiedererkennung in der UI. Rotation = neues Credential mit rotated_from,
-- altes bleibt bis expires_at/Widerruf gueltig (Ueberlappungsfenster).
--
-- Zugriff AUSSCHLIESSLICH ueber Server-Routen (service_role): RLS aktiv ohne
-- Policies = anon/authenticated sehen nichts.
create table if not exists public.ingest_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  purpose text not null check (purpose in ('openai_ads', 'ai_crawler')),
  token_hash text not null unique,
  token_prefix text not null,
  label text,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  rotated_from uuid references public.ingest_credentials(id) on delete set null,
  last_used_at timestamptz,
  use_count bigint not null default 0
);

create index if not exists ingest_credentials_client_purpose_idx
  on public.ingest_credentials (client_id, purpose);

alter table public.ingest_credentials enable row level security;

-- Replay-Schutz fuer Crawler-Hits: deterministischer Schluessel
-- sha256(client_id|bot|url|at-Sekunde). Neue Spalte (Altbestand = NULL, der
-- Unique-Index ignoriert NULLs) — Doppel-Einlieferungen desselben Batches
-- bleiben damit idempotent (Insert mit ignoreDuplicates).
alter table public.ai_crawler_hits add column if not exists hit_hash text;
create unique index if not exists ai_crawler_hits_hit_hash_uidx
  on public.ai_crawler_hits (hit_hash);

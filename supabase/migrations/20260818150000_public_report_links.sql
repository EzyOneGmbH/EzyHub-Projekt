-- Security-Hardening 18.08.2026, MANUELL via Lovable-SQL angewendet (Doku).
-- Oeffentliche Report-Links: Registry mit Org-Bindung, Ablauf, Widerruf und
-- Audit (created_by/at). Es wird NUR der sha256-Hash des Tokens gespeichert.
-- RLS ohne Policies = Zugriff ausschliesslich ueber /api/public/report.
create table if not exists public.public_report_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  token_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.public_report_links enable row level security;
create index if not exists public_report_links_client_idx
  on public.public_report_links (organization_id, client_id, created_at desc);

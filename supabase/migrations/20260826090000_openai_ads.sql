-- ChatGPT Ads (EzyAI Ads-Modus, 26.08.2026): OpenAI Conversions API.
-- openai_ads_config: je Kunde Pixel-ID + Conversions-API-Key (Secretbox-verschluesselt
--   in api_key_enc — Klartext-Keys landen NIE in der DB).
-- openai_ads_events: jede Conversion lokal gespeichert (eigenes Reporting —
--   OpenAI bietet keine Reporting-API), inkl. Versand-Status + Retry-Zaehler.
-- Zugriff AUSSCHLIESSLICH ueber Server-Routen (service_role): RLS aktiv ohne
-- Policies = clientseitig komplett gesperrt (Muster admin_jobs).
-- WICHTIG: Lovable wendet Repo-Migrationen NICHT automatisch an — dieses File
-- manuell im Supabase-SQL-Editor ausfuehren.

create table if not exists public.openai_ads_config (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null,
  pixel_id text not null,
  api_key_enc text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.openai_ads_config enable row level security;

create table if not exists public.openai_ads_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  oppref text,
  obref text,
  amount_cents integer,
  currency text,
  source_url text,
  action_source text not null default 'web',
  payload jsonb,
  openai_status text not null default 'pending',
  openai_response jsonb,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (client_id, event_id)
);
alter table public.openai_ads_events enable row level security;

create index if not exists openai_ads_events_client_created_idx
  on public.openai_ads_events (client_id, created_at desc);

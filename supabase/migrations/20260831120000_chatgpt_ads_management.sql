-- ChatGPT-Ads-Management (Spec «EzyAI ChatGPT Ads Modul», 31.08.2026).
-- BEREITS MANUELL via Lovable query_database angewendet (Lovable wendet
-- Repo-Migrationen nicht automatisch an) — Datei dient der Dokumentation.
-- Abweichungen zur Spec: api_key_enc (Secretbox) statt api_key_ref/n8n;
-- status statt state (API-Realität); Budget in *_micros; RLS service-role-only
-- (Kunden-Sichtbarkeit prüft /api/admin/chatgpt-ads selbst — Muster
-- openai_ads_events).

create table if not exists chatgpt_ads_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  organization_id uuid,
  openai_ad_account_id text not null unique,
  name text not null,
  currency_code text not null default 'USD',
  timezone text,
  api_key_enc text not null,
  status text not null default 'active',          -- active | paused | disconnected
  is_mock boolean not null default false,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz default now()
);

create table if not exists chatgpt_ads_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  openai_campaign_id text not null,
  name text not null,
  status text not null,                           -- active | paused | archived
  bidding_type text,
  objective text,
  budget_daily_micros bigint,
  budget_lifetime_micros bigint,
  start_time timestamptz,
  end_time timestamptz,
  raw jsonb not null,
  synced_at timestamptz default now(),
  unique (account_id, openai_campaign_id)
);

create table if not exists chatgpt_ads_ad_groups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  campaign_id uuid references chatgpt_ads_campaigns(id) on delete cascade,
  openai_ad_group_id text not null,
  name text not null,
  status text not null,
  raw jsonb not null,
  synced_at timestamptz default now(),
  unique (account_id, openai_ad_group_id)
);

create table if not exists chatgpt_ads_ads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  ad_group_id uuid references chatgpt_ads_ad_groups(id) on delete cascade,
  openai_ad_id text not null,
  name text,
  status text not null,
  review_status text,                             -- in_review | approved | rejected
  raw jsonb not null,
  synced_at timestamptz default now(),
  unique (account_id, openai_ad_id)
);

create table if not exists chatgpt_ads_insights_daily (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  scope text not null,                            -- account | campaign | ad_group | ad
  scope_openai_id text not null,
  date date not null,
  impressions bigint default 0,
  clicks bigint default 0,
  spend numeric default 0,
  conversions bigint,
  breakdown jsonb,
  unique (account_id, scope, scope_openai_id, date)
);

create table if not exists chatgpt_ads_commands (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references chatgpt_ads_accounts(id) on delete cascade,
  actor_user_id uuid,
  action text not null,                           -- pause | activate | set_budget
  target_type text not null,
  target_openai_id text not null,
  payload jsonb,
  status text not null default 'pending',         -- pending | success | failed
  error text,
  created_at timestamptz default now(),
  executed_at timestamptz
);

alter table chatgpt_ads_accounts enable row level security;
alter table chatgpt_ads_campaigns enable row level security;
alter table chatgpt_ads_ad_groups enable row level security;
alter table chatgpt_ads_ads enable row level security;
alter table chatgpt_ads_insights_daily enable row level security;
alter table chatgpt_ads_commands enable row level security;

create index if not exists idx_cga_campaigns_account on chatgpt_ads_campaigns(account_id);
create index if not exists idx_cga_insights_lookup on chatgpt_ads_insights_daily(account_id, scope, date);
create index if not exists idx_cga_commands_account on chatgpt_ads_commands(account_id, created_at desc);

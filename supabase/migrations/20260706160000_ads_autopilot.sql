-- ============================================================================
-- Google Ads Autopilot — Datenmodell (Changelog + Approval-Queue)
-- EzyHub-Konventionen:
--   * Tenancy = organizations -> clients; RLS-Check = public.can_access_client(client_id)
--     (SECURITY DEFINER, seit 20260703120000_content_tracking.sql)
--   * client_id denormalisiert -> 1 RLS-Check, kein Join
--   * SPA liest client-seitig -> SELECT-Policy fuer authenticated;
--     Autopilot schreibt/entscheidet server-seitig mit service_role (RLS-Bypass)
-- Idempotent (if not exists), benannte Indizes.
-- ============================================================================

-- ── Changelog: jede vom Autopilot vorgeschlagene/ausgefuehrte Aenderung ──────
create table if not exists public.ads_changelog (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  customer_id   text not null,                 -- Google Ads Customer ID (ohne Bindestriche)
  run_id        text not null,
  action_type   text not null,                 -- add_negative | adjust_bid | set_budget | pause_* | ...
  action_class  text not null check (action_class in ('auto-execute','approval-needed','report-only')),
  entity        text,                          -- z.B. "Search DE | Ad-Group X"
  before_value  text,
  after_value   text,
  rationale     text,                          -- MUSS die belegende Metrik nennen (Halluzinationsschutz)
  status        text not null default 'pending'
                check (status in ('pending','executed','approved','rejected','failed','dry-run')),
  approved_by   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_ads_changelog_client on public.ads_changelog(client_id);
create index if not exists idx_ads_changelog_run    on public.ads_changelog(run_id);
create index if not exists idx_ads_changelog_status on public.ads_changelog(status);
create index if not exists idx_ads_changelog_ts     on public.ads_changelog(created_at desc);

-- ── Approval-Queue: approval-needed-Actions, die auf Freigabe warten ─────────
create table if not exists public.ads_approvals (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  customer_id      text not null,
  run_id           text not null,
  action_id        text not null,              -- innerhalb des Runs eindeutig (a-001 ...)
  type             text not null,              -- budget_change | pause_campaign | bid_strategy_change | ...
  entity           text,
  current_value    text,
  proposed_value   text,
  rationale        text,
  estimated_impact text,
  payload          jsonb not null default '{}'::jsonb,   -- exakte Mutations-Parameter fuer execute
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','expired','executed','failed')),
  expires_at       timestamptz,
  decided_by       uuid,                       -- app_users.user_id, der entschieden hat
  decided_at       timestamptz,
  changelog_id     uuid references public.ads_changelog(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (run_id, action_id)
);

create index if not exists idx_ads_approvals_client on public.ads_approvals(client_id);
create index if not exists idx_ads_approvals_status on public.ads_approvals(status);
create index if not exists idx_ads_approvals_run    on public.ads_approvals(run_id);

-- ── RLS: SPA darf lesen (can_access_client); Mutationen laufen server-seitig ─
alter table public.ads_changelog enable row level security;
drop policy if exists ads_changelog_select on public.ads_changelog;
create policy ads_changelog_select on public.ads_changelog
  for select to authenticated
  using (public.can_access_client(client_id));

alter table public.ads_approvals enable row level security;
drop policy if exists ads_approvals_select on public.ads_approvals;
create policy ads_approvals_select on public.ads_approvals
  for select to authenticated
  using (public.can_access_client(client_id));

-- ── Pro-Kunde-Konfiguration des Autopilots (spaeter in der UI editierbar) ────
create table if not exists public.ads_autopilot_config (
  client_id          uuid primary key references public.clients(id) on delete cascade,
  industry           text not null default 'kmu-local'
                     check (industry in ('hotel','kmu-local','kmu-b2b','ecommerce')),
  kill_switch        boolean not null default false,
  autonomy_level     int not null default 0 check (autonomy_level between 0 and 2),
  monthly_budget_chf numeric not null default 0,
  target_cpa_chf     numeric,                       -- ODER target_roas (genau eines)
  target_roas        numeric,
  season_high        text[] not null default '{}',  -- Fenster "MM-TT..MM-TT"
  season_low         text[] not null default '{}',
  no_touch_campaigns text[] not null default '{}',
  languages          text[] not null default '{de}',
  notes              text,
  updated_at         timestamptz not null default now()
);

alter table public.ads_autopilot_config enable row level security;
drop policy if exists ads_config_select on public.ads_autopilot_config;
create policy ads_config_select on public.ads_autopilot_config
  for select to authenticated
  using (public.can_access_client(client_id));

comment on table public.ads_changelog is 'Google Ads Autopilot: Protokoll jeder vorgeschlagenen/ausgefuehrten Aenderung. Input fuer Monats-Kundenmeetings.';
comment on table public.ads_approvals is 'Google Ads Autopilot: approval-needed-Actions, die auf menschliche Freigabe warten.';
comment on table public.ads_autopilot_config is 'Google Ads Autopilot: Pro-Kunde-Policy (autonomy_level, Ziele, no_touch, Saison, Kill-Switch).';

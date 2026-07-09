-- Google Ads Autopilot — Phase 4: change-outcome-review (Autonomie-Freischalter).
-- Deterministisch gerechnet (TypeScript in EzyHub); Claude formuliert nur Zusammenfassungen.
-- Additiv + idempotent.

create table if not exists public.ads_outcome_reviews (
  id             uuid primary key default gen_random_uuid(),
  changelog_id   uuid not null references public.ads_changelog(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  action_type    text not null,
  review_window  text not null check (review_window in ('14d','30d')),
  metric_before  jsonb not null default '{}'::jsonb,  -- cost, conversions, cpa, roas, impression_share
  metric_after   jsonb not null default '{}'::jsonb,
  verdict        text not null check (verdict in ('positive','neutral','negative','inconclusive')),
  confounders    jsonb not null default '[]'::jsonb,  -- weitere Aenderungen an derselben Entitaet im Nachher-Fenster
  avoided_waste_chf numeric,                          -- nur Negatives: Kosten des Musters vor Ausschluss
  reviewed_at    timestamptz not null default now(),
  unique (changelog_id, review_window)                -- idempotenter Tagesjob
);

create index if not exists idx_ads_outcome_client on public.ads_outcome_reviews(client_id);
create index if not exists idx_ads_outcome_verdict on public.ads_outcome_reviews(verdict);
create index if not exists idx_ads_outcome_reviewed on public.ads_outcome_reviews(reviewed_at desc);

alter table public.ads_outcome_reviews enable row level security;
drop policy if exists ads_outcome_select on public.ads_outcome_reviews;
create policy ads_outcome_select on public.ads_outcome_reviews
  for select to authenticated
  using (public.can_access_client(client_id));

-- Scorecard: pro Kunde x action_type ueber das 90d-Fenster (Freischalt-Grundlage 4.3)
create or replace view public.ads_agent_scorecard as
select
  r.client_id,
  r.action_type,
  count(*)                                                  as n_total,
  count(*) filter (where r.verdict = 'positive')            as n_positive,
  count(*) filter (where r.verdict = 'neutral')             as n_neutral,
  count(*) filter (where r.verdict = 'negative')            as n_negative,
  count(*) filter (where r.verdict = 'inconclusive')        as n_inconclusive,
  -- Trefferquote = (positive+neutral) / entscheidbare Reviews (ohne inconclusive);
  -- inconclusive wird separat ueber die 50%-Datenproblem-Regel behandelt.
  case when count(*) filter (where r.verdict <> 'inconclusive') > 0
       then round( (count(*) filter (where r.verdict in ('positive','neutral')))::numeric
                 / (count(*) filter (where r.verdict <> 'inconclusive'))::numeric, 4)
       else null end                                        as hit_rate,
  coalesce(sum(r.avoided_waste_chf), 0)                     as avoided_waste_chf_sum
from public.ads_outcome_reviews r
where r.reviewed_at >= now() - interval '90 days'
group by r.client_id, r.action_type;

comment on table public.ads_outcome_reviews is
  'Phase 4: deterministische Vorher/Nachher-Reviews jeder umgesetzten Autopilot-Aenderung (14d/30d).';
comment on view public.ads_agent_scorecard is
  'Phase 4: Trefferquote + vermiedene Verschwendung pro Kunde x action_type (90d) - Grundlage der Autonomie-Freischaltung.';

-- Google Ads Autopilot — Phase 1: Sicherheits- & Datenqualitaets-Fixes.
-- Additiv + idempotent.

-- 1.1/1.4: Pro-Kunde-Schwellwerte (Tracking-Health, Conversion-Lag, Mindestbasis)
alter table public.ads_autopilot_config
  add column if not exists min_conversions_baseline int not null default 3,
  add column if not exists conversion_lag_days int not null default 7,
  add column if not exists min_conversions_for_budget_rec int not null default 5,
  add column if not exists notes_updated_at timestamptz;

comment on column public.ads_autopilot_config.min_conversions_baseline is
  'Tracking-Health: Mindest-Conversions in der 30d-Baseline (Tag -37..-8), damit 0 Conv./7d als Ausfall gilt.';
comment on column public.ads_autopilot_config.conversion_lag_days is
  'Negatives-Fenster endet vor N Tagen (Conversion-Lag; Hotels: 14).';
comment on column public.ads_autopilot_config.min_conversions_for_budget_rec is
  'Statistische Mindestbasis (Conversions/30d) fuer Budget-Empfehlungen.';
comment on column public.ads_autopilot_config.notes_updated_at is
  'Wann das notes-Feld zuletzt gepflegt wurde; Report erinnert nach 90 Tagen (Kontext-Check).';

-- 1.1: Changelog-Status 'blocked_tracking' (Tracking-Gate dokumentiert statt auszufuehren)
alter table public.ads_changelog drop constraint if exists ads_changelog_status_check;
alter table public.ads_changelog add constraint ads_changelog_status_check
  check (status in ('pending','executed','approved','rejected','failed','dry-run','blocked_tracking'));

-- Hotels: Conversion-Lag-Default 14 Tage (Buchungsvorlauf)
update public.ads_autopilot_config set conversion_lag_days = 14
where industry = 'hotel' and conversion_lag_days = 7;

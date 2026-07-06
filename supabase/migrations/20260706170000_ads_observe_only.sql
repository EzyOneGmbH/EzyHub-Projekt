-- Observe-only gate for the Google Ads Autopilot evaluation phase.
-- While observe_only = true (DEFAULT), the autopilot NEVER writes to Google Ads:
-- every planned measure is only DOCUMENTED (changelog status 'dry-run', approvals
-- kept as recommendations, execution refused). Flip to false only AFTER the
-- agent's quality has been reviewed. Additive + idempotent.

alter table public.ads_autopilot_config
  add column if not exists observe_only boolean not null default true;

comment on column public.ads_autopilot_config.observe_only is
  'Evaluations-Gate: true (Default) = Autopilot dokumentiert nur, KEINE Google-Ads-Writes, unabhaengig von autonomy_level. Erst nach Qualitaetspruefung auf false setzen.';

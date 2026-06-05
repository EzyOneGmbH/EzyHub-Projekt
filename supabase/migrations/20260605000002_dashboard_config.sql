-- Per-organization dashboard metric toggles. Empty object = everything enabled
-- (a metric is shown unless explicitly set to false). Admins edit it in Settings;
-- members read it (existing org_select / org_update RLS already covers this).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dashboard_config jsonb NOT NULL DEFAULT '{}'::jsonb;

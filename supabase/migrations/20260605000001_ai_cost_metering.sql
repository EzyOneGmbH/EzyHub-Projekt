-- AI cost metering + per-org monthly budget for agent-service skill runs.
-- Cost per run is stored in audit_runs.result->>'costUsd' (no schema change needed
-- for finalization), so the app keeps working even before this migration is applied.

-- Per-organization monthly AI budget (USD). Default 50; owners/admins can raise it.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS monthly_ai_budget_usd numeric NOT NULL DEFAULT 50;

-- Monthly AI spend per org, summed from the cost stored in each succeeded run's result JSON.
CREATE OR REPLACE FUNCTION public.org_ai_spend_this_month(_org uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(NULLIF(result->>'costUsd', '')::numeric), 0)
  FROM public.audit_runs
  WHERE organization_id = _org
    AND status = 'succeeded'
    AND started_at >= date_trunc('month', now());
$$;

-- Keep the monthly-spend aggregate fast as audit_runs grows.
CREATE INDEX IF NOT EXISTS idx_audit_runs_org_started
  ON public.audit_runs (organization_id, started_at);

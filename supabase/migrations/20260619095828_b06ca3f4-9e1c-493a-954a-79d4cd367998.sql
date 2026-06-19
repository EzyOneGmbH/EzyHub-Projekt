ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dashboard_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS monthly_ai_budget_usd numeric NOT NULL DEFAULT 50;

ALTER TABLE public.customer_defaults
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS customer_defaults_org_client_uidx
  ON public.customer_defaults (organization_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_defaults_org_null_client_uidx
  ON public.customer_defaults (organization_id)
  WHERE client_id IS NULL;

CREATE OR REPLACE FUNCTION public.org_ai_spend_this_month(_org uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    COALESCE((result->>'cost_usd')::numeric, (result->>'costUsd')::numeric, 0)
  ), 0)::numeric
  FROM public.audit_runs
  WHERE organization_id = _org
    AND created_at >= date_trunc('month', now());
$$;

REVOKE EXECUTE ON FUNCTION public.org_ai_spend_this_month(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_ai_spend_this_month(uuid) TO authenticated, service_role;
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  health_score INT CHECK (health_score BETWEEN 0 AND 100),
  deploy_count INT NOT NULL DEFAULT 0,
  summary TEXT,
  error_message TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_client ON public.agent_runs(client_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_org ON public.agent_runs(organization_id, run_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_runs_select ON public.agent_runs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
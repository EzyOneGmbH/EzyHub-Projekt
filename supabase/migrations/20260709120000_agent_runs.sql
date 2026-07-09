-- ============================================================================
-- agent_runs: deterministischer Lauf-Nachweis der autonomen Agenten.
-- Der lokale agent-service postet nach JEDEM Lauf (auch bei 0 Aenderungen) einen
-- kompakten Eintrag -> sichtbar als "Agent-Laeufe" pro Kunde. Bewusst GETRENNT
-- von audit_runs, damit die taeglichen Laeufe die Audit-/KPI-Views nicht fluten.
-- Schreibzugriff nur via service_role (Admin-Endpoint /api/admin/agent-run).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',              -- 'ok' | 'fehler' | 'partial'
  health_score INT CHECK (health_score BETWEEN 0 AND 100),
  deploy_count INT NOT NULL DEFAULT 0,
  summary TEXT,                                   -- Kurzfazit (Ergebnis-Headline)
  error_message TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),      -- Lauf-Ende
  duration_ms INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { trigger, cost_usd, num_turns, session_id }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_client ON public.agent_runs(client_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_org ON public.agent_runs(organization_id, run_at DESC);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Org-Mitglieder lesen; Schreiben ausschliesslich via service_role (kein
-- INSERT-Policy fuer authenticated -> Frontend kann nicht schreiben).
DROP POLICY IF EXISTS agent_runs_select ON public.agent_runs;
CREATE POLICY agent_runs_select ON public.agent_runs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

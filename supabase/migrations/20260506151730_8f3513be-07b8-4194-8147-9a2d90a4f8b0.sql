-- =========================================
-- EZY ONE multi-tenant schema
-- =========================================

-- Org-scoped role enum
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Audit run status
CREATE TYPE public.audit_status AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- =========================================
-- organizations
-- =========================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================
-- app_users (membership of an auth user in an organization)
-- =========================================
CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_role NOT NULL DEFAULT 'member',
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_app_users_user ON public.app_users(user_id);
CREATE INDEX idx_app_users_org ON public.app_users(organization_id);

-- =========================================
-- Security definer helpers (avoid RLS recursion)
-- =========================================
CREATE OR REPLACE FUNCTION public.is_org_member(_org UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE organization_id = _org AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_org UUID)
RETURNS public.org_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.app_users
  WHERE organization_id = _org AND user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.org_role_of(_org) IN ('owner', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_run_audits(_org UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.org_role_of(_org) IN ('owner', 'admin', 'member');
$$;

-- =========================================
-- customer_defaults (server-side only)
-- =========================================
CREATE TABLE public.customer_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================
-- clients
-- =========================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  industry TEXT,
  language TEXT NOT NULL DEFAULT 'de',
  country TEXT,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_org ON public.clients(organization_id);

-- =========================================
-- client_integrations
-- =========================================
CREATE TABLE public.client_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider)
);

CREATE INDEX idx_client_integrations_client ON public.client_integrations(client_id);

-- =========================================
-- oauth_connections (server-only, holds tokens)
-- =========================================
CREATE TABLE public.oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID,
  provider TEXT NOT NULL,
  account_email TEXT,
  scopes TEXT[],
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_connections_org ON public.oauth_connections(organization_id);
CREATE INDEX idx_oauth_connections_client ON public.oauth_connections(client_id);

-- =========================================
-- audit_runs
-- =========================================
CREATE TABLE public.audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  triggered_by UUID NOT NULL,
  status public.audit_status NOT NULL DEFAULT 'pending',
  audit_type TEXT NOT NULL DEFAULT 'seo',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_runs_org ON public.audit_runs(organization_id);
CREATE INDEX idx_audit_runs_client ON public.audit_runs(client_id);

-- =========================================
-- updated_at triggers
-- =========================================
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_app_users_updated BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_customer_defaults_updated BEFORE UPDATE ON public.customer_defaults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_client_integrations_updated BEFORE UPDATE ON public.client_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_oauth_connections_updated BEFORE UPDATE ON public.oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_audit_runs_updated BEFORE UPDATE ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- Enable RLS
-- =========================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;

-- =========================================
-- organizations policies
-- =========================================
CREATE POLICY org_select ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY org_insert ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY org_update ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(id));
CREATE POLICY org_delete ON public.organizations FOR DELETE TO authenticated
  USING (public.org_role_of(id) = 'owner');

-- =========================================
-- app_users policies
-- =========================================
CREATE POLICY app_users_select ON public.app_users FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY app_users_admin_write ON public.app_users FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- =========================================
-- customer_defaults policies (server-only: no client access)
-- RLS enabled with NO policies => only service role / SECURITY DEFINER can access.
-- =========================================

-- =========================================
-- clients policies
-- =========================================
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id) AND auth.uid() = created_by);
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id));
CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));

-- =========================================
-- client_integrations policies
-- =========================================
CREATE POLICY ci_select ON public.client_integrations FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY ci_admin_write ON public.client_integrations FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- =========================================
-- oauth_connections policies (server-only: tokens never exposed to clients)
-- RLS enabled, no policies => only service role can read/write.
-- =========================================

-- =========================================
-- audit_runs policies
-- viewers: read only; members+: can create/read; admins: can delete
-- =========================================
CREATE POLICY audit_select ON public.audit_runs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY audit_insert ON public.audit_runs FOR INSERT TO authenticated
  WITH CHECK (
    public.can_run_audits(organization_id) AND auth.uid() = triggered_by
  );
CREATE POLICY audit_update ON public.audit_runs FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id));
CREATE POLICY audit_delete ON public.audit_runs FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));
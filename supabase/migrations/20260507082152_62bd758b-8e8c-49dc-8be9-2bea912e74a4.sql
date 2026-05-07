
-- 1) Canonry project slug per client
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS canonry_project text;

-- 2) RLS for oauth_connections (currently no policies → effectively no access via anon/auth)
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_select ON public.oauth_connections;
DROP POLICY IF EXISTS oauth_admin_write ON public.oauth_connections;
CREATE POLICY oauth_select ON public.oauth_connections
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY oauth_admin_write ON public.oauth_connections
  FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- 3) RLS for customer_defaults
ALTER TABLE public.customer_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cd_select ON public.customer_defaults;
DROP POLICY IF EXISTS cd_admin_write ON public.customer_defaults;
CREATE POLICY cd_select ON public.customer_defaults
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY cd_admin_write ON public.customer_defaults
  FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- 4) Tighten legacy tables: drop "USING true" SELECT, restrict to creator/admin
DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    auth.uid() = created_by
    OR auth.uid() = assigned_to
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS content_select ON public.content_items;
CREATE POLICY content_select ON public.content_items
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

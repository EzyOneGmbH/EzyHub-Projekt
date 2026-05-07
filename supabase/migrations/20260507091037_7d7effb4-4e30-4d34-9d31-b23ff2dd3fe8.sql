-- Delete content with no client assignment (cannot be enforced under multi-tenant rules)
DELETE FROM public.content_items WHERE client_id IS NULL;

-- Make client_id required
ALTER TABLE public.content_items ALTER COLUMN client_id SET NOT NULL;

-- Drop all legacy + permissive policies
DROP POLICY IF EXISTS content_insert ON public.content_items;
DROP POLICY IF EXISTS content_update ON public.content_items;
DROP POLICY IF EXISTS content_delete ON public.content_items;
DROP POLICY IF EXISTS content_select ON public.content_items;
DROP POLICY IF EXISTS content_select_org ON public.content_items;
DROP POLICY IF EXISTS content_update_org ON public.content_items;
DROP POLICY IF EXISTS content_delete_org ON public.content_items;

-- Org-scoped policies via clients.organization_id
CREATE POLICY content_select ON public.content_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                 WHERE c.id = content_items.client_id
                 AND public.is_org_member(c.organization_id)));

CREATE POLICY content_insert ON public.content_items
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (SELECT 1 FROM public.clients c
                WHERE c.id = content_items.client_id
                AND public.is_org_admin(c.organization_id))
  );

CREATE POLICY content_update ON public.content_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                 WHERE c.id = content_items.client_id
                 AND public.is_org_admin(c.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c
                      WHERE c.id = content_items.client_id
                      AND public.is_org_admin(c.organization_id)));

CREATE POLICY content_delete ON public.content_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                 WHERE c.id = content_items.client_id
                 AND public.is_org_admin(c.organization_id)));
-- 1) Lock down oauth_connections: tokens only via service role
DROP POLICY IF EXISTS oauth_select ON public.oauth_connections;
DROP POLICY IF EXISTS oauth_admin_write ON public.oauth_connections;
-- RLS stays enabled: no policies => no access for authenticated role

-- 2) content_items: add client_id
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_items_client_id_idx ON public.content_items(client_id);

-- Extend RLS: org members can read; org admins can update/delete; org members can insert with their org's client
DROP POLICY IF EXISTS content_select_org ON public.content_items;
CREATE POLICY content_select_org ON public.content_items
  FOR SELECT TO authenticated
  USING (
    client_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = content_items.client_id
        AND public.is_org_member(c.organization_id)
    )
  );

DROP POLICY IF EXISTS content_update_org ON public.content_items;
CREATE POLICY content_update_org ON public.content_items
  FOR UPDATE TO authenticated
  USING (
    client_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = content_items.client_id
        AND public.is_org_admin(c.organization_id)
    )
  );

DROP POLICY IF EXISTS content_delete_org ON public.content_items;
CREATE POLICY content_delete_org ON public.content_items
  FOR DELETE TO authenticated
  USING (
    client_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = content_items.client_id
        AND public.is_org_admin(c.organization_id)
    )
  );
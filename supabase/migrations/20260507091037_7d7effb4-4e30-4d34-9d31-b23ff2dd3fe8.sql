-- Safe orphan-content handling for content_items.client_id NOT NULL transition.
-- Strict policy:
--   * Auto-backfill ONLY when the creator's organization has EXACTLY one client.
--   * If any organization has multiple clients AND orphan content_items exist, abort.
--   * If orphans remain (org has zero clients), abort.
--   * Never delete content. Never blanket-assign to "first" client.
-- Only after backfill+verification do we set NOT NULL and refresh RLS policies.

DO $$
DECLARE
  remaining int;
  ambiguous int;
BEGIN
  UPDATE public.content_items ci
  SET client_id = sub.client_id
  FROM (
    SELECT au.user_id,
           (SELECT c.id FROM public.clients c
            WHERE c.organization_id = au.organization_id
            LIMIT 1) AS client_id,
           (SELECT COUNT(*) FROM public.clients c
            WHERE c.organization_id = au.organization_id) AS client_count
    FROM public.app_users au
  ) sub
  WHERE ci.client_id IS NULL
    AND ci.created_by = sub.user_id
    AND sub.client_count = 1
    AND sub.client_id IS NOT NULL;

  SELECT COUNT(*) INTO ambiguous
  FROM public.content_items ci
  JOIN public.app_users au ON au.user_id = ci.created_by
  WHERE ci.client_id IS NULL
    AND (SELECT COUNT(*) FROM public.clients c WHERE c.organization_id = au.organization_id) > 1;

  IF ambiguous > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % content_items without client_id belong to organizations with multiple clients. Bitte manuell einem Kunden zuordnen.', ambiguous;
  END IF;

  SELECT COUNT(*) INTO remaining FROM public.content_items WHERE client_id IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % content_items ohne client_id verbleiben. Bitte manuell einem Kunden zuordnen.', remaining;
  END IF;
END $$;

ALTER TABLE public.content_items ALTER COLUMN client_id SET NOT NULL;

DROP POLICY IF EXISTS content_insert ON public.content_items;
DROP POLICY IF EXISTS content_update ON public.content_items;
DROP POLICY IF EXISTS content_delete ON public.content_items;
DROP POLICY IF EXISTS content_select ON public.content_items;
DROP POLICY IF EXISTS content_select_org ON public.content_items;
DROP POLICY IF EXISTS content_update_org ON public.content_items;
DROP POLICY IF EXISTS content_delete_org ON public.content_items;

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

-- Safe backfill: assign orphan content_items to a client of the same org as the creator.
-- If any orphans remain afterwards, abort with a clear message instead of deleting data.

DO $$
DECLARE
  remaining int;
BEGIN
  UPDATE public.content_items ci
  SET client_id = sub.client_id
  FROM (
    SELECT au.user_id, (
      SELECT c.id FROM public.clients c
      WHERE c.organization_id = au.organization_id
      ORDER BY c.created_at ASC
      LIMIT 1
    ) AS client_id
    FROM public.app_users au
  ) sub
  WHERE ci.client_id IS NULL
    AND ci.created_by = sub.user_id
    AND sub.client_id IS NOT NULL;

  SELECT COUNT(*) INTO remaining FROM public.content_items WHERE client_id IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % content_items without client_id remain. Bitte zuerst manuell einem Kunden zuordnen.', remaining;
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

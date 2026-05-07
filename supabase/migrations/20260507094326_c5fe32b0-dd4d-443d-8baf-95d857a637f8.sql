-- Stricter orphan-content guard: only auto-backfill when an organization has exactly one client.
-- If multiple clients exist and orphans remain, abort with a clear message.
-- This is idempotent and safe to re-run; previous migration already enforced NOT NULL.

DO $$
DECLARE
  remaining int;
  ambiguous int;
BEGIN
  -- Backfill orphans only if creator's organization has exactly one client.
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
      'Migration aborted: % content_items ohne client_id verbleiben (Org hat keinen Client). Bitte manuell zuordnen.', remaining;
  END IF;
END $$;
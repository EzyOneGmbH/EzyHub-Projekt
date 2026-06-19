-- Allow org members (not just admins) to update Google integration properties
-- on the clients table. The original clients_update policy required is_org_admin,
-- which blocked members from saving GSC/GA4/Ads settings.

-- Drop the restrictive policy
DROP POLICY IF EXISTS clients_update ON public.clients;

-- Create a new policy that allows any org member (owner, admin, or member) to
-- update clients in their organization. Viewers are still excluded.
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.organization_id = clients.organization_id
        AND au.user_id = auth.uid()
        AND au.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.organization_id = clients.organization_id
        AND au.user_id = auth.uid()
        AND au.role IN ('owner', 'admin', 'member')
    )
  );

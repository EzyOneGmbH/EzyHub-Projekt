ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS google_ads_customer text;

DROP POLICY IF EXISTS clients_update ON public.clients;

CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users au
    WHERE au.organization_id = clients.organization_id
      AND au.user_id = auth.uid()
      AND au.role IN ('owner','admin','member')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users au
    WHERE au.organization_id = clients.organization_id
      AND au.user_id = auth.uid()
      AND au.role IN ('owner','admin','member')));
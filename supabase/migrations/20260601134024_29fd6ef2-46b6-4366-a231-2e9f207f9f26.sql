
-- customer_tool_settings: restrict to owner of the linked customer (or admin)
DROP POLICY IF EXISTS tools_select ON public.customer_tool_settings;
DROP POLICY IF EXISTS tools_admin_write ON public.customer_tool_settings;

CREATE POLICY tools_select ON public.customer_tool_settings
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = customer_tool_settings.customer_id
      AND (c.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);

CREATE POLICY tools_write ON public.customer_tool_settings
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = customer_tool_settings.customer_id
      AND (c.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = customer_tool_settings.customer_id
      AND (c.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);

-- profiles: only own row
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
FOR SELECT TO authenticated
USING (auth.uid() = id);

-- user_roles: only own row (admins still covered by roles_admin_all ALL policy)
DROP POLICY IF EXISTS roles_select ON public.user_roles;
CREATE POLICY roles_select ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

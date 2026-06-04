
-- customers
DROP POLICY IF EXISTS customers_select ON public.customers;
DROP POLICY IF EXISTS customers_update ON public.customers;
DROP POLICY IF EXISTS customers_delete ON public.customers;
CREATE POLICY customers_select ON public.customers FOR SELECT USING (auth.uid() = created_by);
CREATE POLICY customers_update ON public.customers FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY customers_delete ON public.customers FOR DELETE USING (auth.uid() = created_by);

-- notes
DROP POLICY IF EXISTS notes_select ON public.notes;
DROP POLICY IF EXISTS notes_update ON public.notes;
DROP POLICY IF EXISTS notes_delete ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT USING (auth.uid() = created_by);
CREATE POLICY notes_update ON public.notes FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY notes_delete ON public.notes FOR DELETE USING (auth.uid() = created_by);

-- tasks
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_select ON public.tasks FOR SELECT USING (auth.uid() = created_by OR auth.uid() = assigned_to);
CREATE POLICY tasks_update ON public.tasks FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = assigned_to);
CREATE POLICY tasks_delete ON public.tasks FOR DELETE USING (auth.uid() = created_by);

-- customer_tool_settings (scoped via owning customer.created_by)
DROP POLICY IF EXISTS tools_select ON public.customer_tool_settings;
DROP POLICY IF EXISTS tools_write ON public.customer_tool_settings;
CREATE POLICY tools_select ON public.customer_tool_settings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tool_settings.customer_id AND c.created_by = auth.uid()));
CREATE POLICY tools_write ON public.customer_tool_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tool_settings.customer_id AND c.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_tool_settings.customer_id AND c.created_by = auth.uid()));

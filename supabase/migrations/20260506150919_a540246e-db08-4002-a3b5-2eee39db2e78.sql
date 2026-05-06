-- Content type enums
CREATE TYPE public.content_type AS ENUM ('blog', 'landing', 'geo', 'social', 'other');
CREATE TYPE public.content_status AS ENUM ('draft', 'review', 'published');

CREATE TABLE public.content_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  content_type public.content_type NOT NULL DEFAULT 'blog',
  status public.content_status NOT NULL DEFAULT 'draft',
  language TEXT NOT NULL DEFAULT 'de',
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  target_url TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_select" ON public.content_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "content_insert" ON public.content_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "content_update" ON public.content_items FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'));
CREATE POLICY "content_delete" ON public.content_items FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER content_items_updated_at BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_content_customer ON public.content_items(customer_id);
CREATE INDEX idx_content_status ON public.content_items(status);

-- Per-customer tool toggles
CREATE TABLE public.customer_tool_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tool_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, tool_key)
);

ALTER TABLE public.customer_tool_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tools_select" ON public.customer_tool_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "tools_admin_write" ON public.customer_tool_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE TRIGGER customer_tool_settings_updated_at BEFORE UPDATE ON public.customer_tool_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
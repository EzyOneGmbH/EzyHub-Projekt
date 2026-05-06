ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS gsc_property TEXT,
  ADD COLUMN IF NOT EXISTS ga4_property TEXT;
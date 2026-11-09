-- Content-Massnahmen-Workflow je Kunde schaltbar (09.11.2026). /api/admin/seo-clients
-- liefert Kunden mit report_active ODER content_actions_active; der Monatsreport
-- startet erst nach Freigabe der strategischen Keywords (report_active separat).
ALTER TABLE public.seo_report_config
  ADD COLUMN IF NOT EXISTS content_actions_active boolean NOT NULL DEFAULT false;

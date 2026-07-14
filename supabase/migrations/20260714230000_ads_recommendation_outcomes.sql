-- Phase D (Advisory-Brief): Wirkungsnachweis manuell umgesetzter Empfehlungen.
-- Deterministisch im EzyHub-Kern gerechnet (Fenster + Verdict im Code definiert,
-- nie vom LLM); je (Empfehlung, Fenster) genau EIN Ergebnis; append-only.
CREATE TABLE public.ads_recommendation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ads_recommendations(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  window_days integer NOT NULL CHECK (window_days IN (14, 30)),
  campaign text,                          -- gemessene Entitaet (Kampagnen-Ebene v1)
  metric_primary text NOT NULL,           -- z.B. roas | cpa | ctr | cost_saved
  before_value numeric,
  after_value numeric,
  delta_pct numeric,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb, -- alle Vorher/Nachher-Kennzahlen
  verdict text NOT NULL CHECK (verdict IN ('improved','neutral','worsened','inconclusive')),
  reason text NOT NULL DEFAULT '',        -- v.a. inconclusive-Begruendung (Confounder, zu wenig Daten)
  measured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, window_days)
);

CREATE INDEX idx_ads_reco_outcomes_client ON public.ads_recommendation_outcomes (client_id, measured_at DESC);

ALTER TABLE public.ads_recommendation_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_reco_outcomes_select" ON public.ads_recommendation_outcomes
  FOR SELECT USING (public.can_access_client(client_id));

-- Append-only: Ergebnisse werden nie umgeschrieben oder geloescht.
CREATE OR REPLACE FUNCTION public.ads_reco_outcomes_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'ads_recommendation_outcomes ist append-only (% nicht erlaubt)', TG_OP;
END $$;
CREATE TRIGGER trg_ads_reco_outcomes_no_update BEFORE UPDATE ON public.ads_recommendation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.ads_reco_outcomes_append_only();
CREATE TRIGGER trg_ads_reco_outcomes_no_delete BEFORE DELETE ON public.ads_recommendation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.ads_reco_outcomes_append_only();

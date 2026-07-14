-- Phase C (Advisory-Brief): Massnahmen-Register - aus Empfehlungen werden
-- verfolgbare Objekte. Append-only-Haertung wie ads_changelog: kein DELETE;
-- UPDATE nur auf die Status-/Pflege-Spalten (status, implemented_at,
-- implemented_by, implementation_note, last_seen_run) - Inhaltsfelder sind
-- unveraenderlich. Wiedererkennung: offene Empfehlung je (client, type, entity)
-- wird nicht dupliziert, sondern per last_seen_run als "erneut gesehen" markiert.
CREATE TABLE public.ads_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  run_id text NOT NULL,                  -- Lauf der Erst-Erkennung
  last_seen_run text NOT NULL,           -- juengster Lauf, der sie erneut erkannt hat
  recommendation_type text NOT NULL,     -- bid_target_adjustment | bid_strategy_change | bid_signal_gap | asset_replace | asset_coverage | asset_pinning | keyword_add | keyword_pause | keyword_match_change | ...
  entity text NOT NULL,                  -- Kampagne / Ad-Group / Asset / Keyword
  title text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  expected_impact text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','implemented','dismissed','superseded')),
  implemented_at timestamptz,
  implemented_by text,
  implementation_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Genau EINE offene Empfehlung je (client, type, entity)
CREATE UNIQUE INDEX uq_ads_recommendations_open
  ON public.ads_recommendations (client_id, recommendation_type, entity)
  WHERE status = 'open';
CREATE INDEX idx_ads_recommendations_client_status
  ON public.ads_recommendations (client_id, status, created_at DESC);

ALTER TABLE public.ads_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_recommendations_select" ON public.ads_recommendations
  FOR SELECT USING (public.can_access_client(client_id));

-- Haertung: DELETE verboten; UPDATE nur status/implemented_*/implementation_note/last_seen_run
CREATE OR REPLACE FUNCTION public.ads_recommendations_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ads_recommendations ist append-only (DELETE nicht erlaubt)';
  END IF;
  IF to_jsonb(NEW) - 'status' - 'implemented_at' - 'implemented_by' - 'implementation_note' - 'last_seen_run'
     IS DISTINCT FROM
     to_jsonb(OLD) - 'status' - 'implemented_at' - 'implemented_by' - 'implementation_note' - 'last_seen_run' THEN
    RAISE EXCEPTION 'ads_recommendations: nur Status-/Pflege-Spalten sind aenderbar';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ads_recommendations_no_delete BEFORE DELETE ON public.ads_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ads_recommendations_guard();
CREATE TRIGGER trg_ads_recommendations_guard BEFORE UPDATE ON public.ads_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.ads_recommendations_guard();

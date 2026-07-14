-- Zusatzauftrag (Advisory-Brief, nach Phase-A-Abnahme): Google-Ads-Aenderungs-
-- Events dauerhaft persistieren, damit die Gebotsstrategie-Segmentierung ueber
-- die 29-Tage-Grenze der change_event-API hinaus wachsen kann. Jeder Lauf
-- ingestiert die letzten 29 Tage idempotent (Unique auf event_resource);
-- der Perioden-Split liest kuenftig aus dieser Tabelle.
CREATE TABLE public.ads_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  customer_id text NOT NULL,
  event_resource text NOT NULL,          -- change_event.resource_name (natuerlicher Schluessel)
  occurred_at timestamptz NOT NULL,
  user_email text NOT NULL DEFAULT '',
  resource_type text NOT NULL,
  changed_fields text NOT NULL DEFAULT '',
  campaign text,                         -- aufgeloester Kampagnenname (falls zuordenbar)
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human','autopilot','google_auto','unknown')),
  is_bidding_change boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, event_resource)
);

CREATE INDEX idx_ads_change_events_client_bidding
  ON public.ads_change_events (client_id, is_bidding_change, occurred_at DESC);

ALTER TABLE public.ads_change_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_change_events_select" ON public.ads_change_events
  FOR SELECT USING (public.can_access_client(client_id));

-- Append-only-Haertung wie ads_guardian_log: weder UPDATE noch DELETE,
-- fuer ALLE Rollen inkl. service_role (Trigger umgehen RLS-Bypass).
CREATE OR REPLACE FUNCTION public.ads_change_events_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'ads_change_events ist append-only (% nicht erlaubt)', TG_OP;
END $$;

CREATE TRIGGER trg_ads_change_events_no_update BEFORE UPDATE ON public.ads_change_events
  FOR EACH ROW EXECUTE FUNCTION public.ads_change_events_append_only();
CREATE TRIGGER trg_ads_change_events_no_delete BEFORE DELETE ON public.ads_change_events
  FOR EACH ROW EXECUTE FUNCTION public.ads_change_events_append_only();

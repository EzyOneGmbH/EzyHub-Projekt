-- Befunde tragen ab jetzt eine konkrete Empfehlungs-Massnahme (User-Wunsch:
-- "Anhaltspunkt fuer die Optimierung"). Additiv, nullable; Append-only-Trigger
-- unveraendert (recommendation wird nie nachtraeglich geaendert).
ALTER TABLE public.ads_changelog ADD COLUMN IF NOT EXISTS recommendation text;

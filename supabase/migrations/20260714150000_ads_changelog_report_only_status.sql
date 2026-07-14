-- Report-only-Befunde werden ab jetzt pro Lauf ins Changelog geschrieben
-- (Sichtbarkeit im EzyHub-Ads-Tab, Abschnitt "Befunde des letzten Laufs").
-- Dazu braucht die Status-Prüfregel 'report-only'; 'superseded' analog zu
-- ads_approvals (Aufräum-Markierung ohne Umschreiben). Append-only-Trigger
-- (kein DELETE, UPDATE nur status/approved_by) bleiben unverändert.
ALTER TABLE public.ads_changelog DROP CONSTRAINT ads_changelog_status_check;
ALTER TABLE public.ads_changelog ADD CONSTRAINT ads_changelog_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text, 'executed'::text, 'approved'::text, 'rejected'::text,
    'failed'::text, 'dry-run'::text, 'blocked_tracking'::text,
    'report-only'::text, 'superseded'::text
  ]));

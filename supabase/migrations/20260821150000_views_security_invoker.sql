-- Security-Fix (21.08.2026): beide SQL-Views liefen als SECURITY DEFINER
-- (Owner postgres = RLS-Bypass für jeden Abfragenden). ads_agent_scorecard
-- hatte zusätzlich volle Grants für anon+authenticated — Cross-Org-Leck.
-- Kein Client-Code liest die Views direkt (nur Service-Role serverseitig,
-- die RLS ohnehin umgeht) — invoker-Semantik ändert daher kein Verhalten.
-- Behebt das Lovable-Security-Finding SUPA_security_definer_view, das den
-- Publish blockierte.
--
-- ACHTUNG: manuell via Lovable-SQL angewendet (Repo-Migrationen laufen nicht auto).

alter view public.content_decision set (security_invoker = true);
alter view public.ads_agent_scorecard set (security_invoker = true);
revoke all on public.ads_agent_scorecard from anon;
revoke all on public.ads_agent_scorecard from authenticated;

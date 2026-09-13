-- Ranking-Snapshot mandanteneindeutig (13.09.2026): neuer Credential-Zweck
-- rank_snapshot fuer /api/admin/rank-snapshot (kundenspezifisch, Hash-only,
-- Rotation/Ablauf/Widerruf wie openai_ads/ai_crawler). Der interne Admin-
-- Pfad bleibt (ADMIN_AUTOMATION_SECRET + X-Ezy-Organization), aber clientId
-- und organizationId sind Pflicht und werden gegen clients geprueft.
--
-- ACHTUNG: Lovable wendet Repo-Migrationen NICHT automatisch an — manuell
-- via Lovable-SQL ausfuehren (wie 20260913100000).
alter table public.ingest_credentials
  drop constraint if exists ingest_credentials_purpose_check;
alter table public.ingest_credentials
  add constraint ingest_credentials_purpose_check
  check (purpose in ('openai_ads', 'ai_crawler', 'rank_snapshot'));

-- EzyAI-Kacheln stündlich (19.11.2026): Zeitpunkt, zu dem die KI-Besucher/
-- -Conversions (GA4) zuletzt geschrieben wurden. Die Zeilen werden je Lauf
-- ersetzt (delete + insert) — der Default genügt, kein Trigger nötig.
alter table public.ai_visibility_attribution
  add column if not exists updated_at timestamptz not null default now();

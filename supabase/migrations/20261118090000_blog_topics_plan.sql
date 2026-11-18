-- Blog-Autopilot: fester Themenplan (18.11.2026). Ein Thema kann von Hand
-- geplant werden, mit Arbeitstitel, Zielgruppe, Zielfrage und dem Element,
-- das KI-Systeme zitieren sollen. Alle Spalten optional; Themen aus der
-- Analyse bleiben unverändert.

alter table public.blog_topics
  add column if not exists title text,
  add column if not exists audience text,
  add column if not exists target_question text,
  add column if not exists citable_element text;

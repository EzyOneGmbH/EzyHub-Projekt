-- Blog-Autopilot Phase 3: Schreib-Pipeline als Hintergrund-Job im minütlichen
-- Worker (gleiches Muster wie Analyse/Audit): Stufe, Zwischenstand, Lock,
-- Versuche direkt am Artikel. Pro Thema höchstens ein Artikel.

alter table public.blog_articles
  add column if not exists stage text,
  add column if not exists job jsonb not null default '{}',
  add column if not exists attempts int not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

create unique index if not exists blog_articles_topic_uidx
  on public.blog_articles (topic_id) where topic_id is not null;

create index if not exists blog_articles_job_idx
  on public.blog_articles (status, locked_until);

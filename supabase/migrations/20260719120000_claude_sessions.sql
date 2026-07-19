-- iPhone-Widget "Remote Claude Chats": Heartbeat-Registry fuer Remote-Claude-Code-Sessions.
-- Jede Session meldet sich ueber /api/claude-sessions (POST, Token-Auth) an; das
-- Scriptable-Widget auf dem iPhone liest den Status ueber dieselbe Route (GET).
-- Geschrieben und gelesen wird ausschliesslich server-seitig mit der Service-Role.
-- RLS ist aktiv, aber ohne Policies => anon/authenticated haben keinerlei Zugriff
-- (die Service-Role umgeht RLS). Additiv, degradiert sauber solange nicht angewendet
-- (Route antwortet dann mit Fehler, App bleibt unberuehrt).
--
-- HINWEIS: Lovable wendet Repo-Migrationen NICHT automatisch an - Datei muss
-- manuell auf der Prod-DB ausgefuehrt werden (hier versioniert).

create table if not exists public.claude_sessions (
  session_id   text primary key,
  label        text,
  source       text,
  status       text not null default 'active' check (status in ('active', 'ended')),
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists claude_sessions_last_seen
  on public.claude_sessions (last_seen_at desc);

alter table public.claude_sessions enable row level security;

comment on table public.claude_sessions is
  'Heartbeats von Remote-Claude-Code-Sessions (iPhone-Widget); Zugriff nur ueber Service-Role via /api/claude-sessions.';

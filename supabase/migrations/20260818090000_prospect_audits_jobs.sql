-- EzyAI Analyse (Lead-Pre-Check), MANUELL via Lovable-SQL angewendet
-- (14.08. Tabelle, 18.08. Job-Haertung) — Datei = Doku/Referenz, Lovable
-- wendet Repo-Migrationen nicht automatisch an.
--
-- prospect_audits ist zugleich der JOB: status laufend|fertig|fehler|abgebrochen,
-- stage = naechste Etappe, locked_until = Tick-Lock (verhindert Paralleltick
-- durch Worker + manuelle Ticks). RLS ohne Policies = Zugriff nur ueber die
-- Team-Route /api/agent/analyse (organization_id wird dort erzwungen).
create table if not exists public.prospect_audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  domain text not null,
  firmenname text not null default '',
  branche text default '',
  ort text default '',
  wettbewerber jsonb not null default '[]'::jsonb,
  status text not null default 'laufend',
  stage text not null default 'technik',
  progress int not null default 0,
  score int,
  dims jsonb,
  data jsonb not null default '{}'::jsonb,
  error text
);
alter table public.prospect_audits enable row level security;
create index if not exists prospect_audits_org_idx
  on public.prospect_audits (organization_id, created_at desc);

-- 18.08.: Hintergrund-Job-Haertung
alter table public.prospect_audits add column if not exists locked_until timestamptz;
create index if not exists prospect_audits_laufend_idx
  on public.prospect_audits (status, updated_at) where status = 'laufend';

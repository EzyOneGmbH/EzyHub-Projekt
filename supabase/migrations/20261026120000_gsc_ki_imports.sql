-- Search Console «Generative KI» — CSV-Importe je Kunde (26.10.2026).
-- Die GSC-API liefert den KI-Bericht nicht; der Export aus der Search Console
-- wird in EzyAI → Traffic → «Google KI» hochgeladen. Zugriff ausschliesslich
-- serverseitig (Route /api/admin/gsc-ki prueft Kunde/Team): RLS an, keine
-- Policies = nur service_role. Idempotent.
create table if not exists public.gsc_ki_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  start_date date,
  end_date date,
  compare_start date,
  compare_end date,
  tabellen jsonb not null default '{}'::jsonb,
  total_imp bigint not null default 0,
  total_imp_prev bigint,
  dateiname text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists gsc_ki_imports_client_created
  on public.gsc_ki_imports (client_id, created_at desc);
alter table public.gsc_ki_imports enable row level security;

-- Tageswerte aller Importe zusammengefuehrt (ein Wert je Kunde und Tag; der
-- neueste Import gewinnt) — damit Zeitraum und Vergleich im Portal frei
-- waehlbar sind, sobald die ganze Historie (bis 16 Monate) hochgeladen ist.
create table if not exists public.gsc_ki_tage (
  client_id uuid not null references public.clients(id) on delete cascade,
  datum date not null,
  organization_id uuid not null,
  imp bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, datum)
);
alter table public.gsc_ki_tage enable row level security;

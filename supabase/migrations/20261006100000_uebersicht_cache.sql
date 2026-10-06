-- Zwischenspeicher für die Performance-Tabellen der Agentur-Übersicht
-- (Volkan 06.10.2026: «Daten lokal zwischenspeichern, damit alles schneller lädt»).
-- Die Zeilen je Kunde und Zeitraum kosteten pro Aufruf ~10 s Live-Abfragen bei
-- GA4/GSC bzw. Google Ads. Der bisherige 5-Minuten-Speicher lag nur im
-- Arbeitsspeicher einer Server-Instanz. Jetzt gilt ein Ergebnis 60 Minuten für
-- alle Instanzen und alle Nutzer der Organisation.
-- Zugriff nur serverseitig (service_role): RLS an, bewusst KEINE Policies —
-- die API-Routen prüfen die Kundenberechtigung, bevor sie lesen.
create table if not exists public.uebersicht_cache (
  art text not null,                 -- 'seo' | 'ads'
  schluessel text not null,          -- Kunde + Zeitraum + Vergleichszeitraum
  client_id uuid not null references public.clients(id) on delete cascade,
  payload jsonb not null,
  erstellt timestamptz not null default now(),
  primary key (art, schluessel)
);
create index if not exists idx_uebersicht_cache_erstellt on public.uebersicht_cache (erstellt);
create index if not exists idx_uebersicht_cache_client on public.uebersicht_cache (client_id);
alter table public.uebersicht_cache enable row level security;
revoke all on public.uebersicht_cache from anon, authenticated;
grant select, insert, update, delete on public.uebersicht_cache to service_role;

-- Neuer erfolgreicher Messlauf (Rankings, Sistrix/Ahrefs, Google Ads) macht die
-- gespeicherten Zeilen des Kunden ungültig.
create or replace function public.uebersicht_cache_verwerfen()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.status = 'succeeded' and new.audit_type in ('rankings', 'ahrefs', 'google_ads') then
    delete from public.uebersicht_cache where client_id = new.client_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_uebersicht_cache_verwerfen on public.audit_runs;
create trigger trg_uebersicht_cache_verwerfen
  after insert or update of status on public.audit_runs
  for each row execute function public.uebersicht_cache_verwerfen();

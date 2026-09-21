-- First-Party-KPIs, Phase 2a (22.09.2026, Volkan): erstmals zeilenbasierte
-- GSC-/GA4-Daten (bisher nur JSON-Snapshots in audit_runs.result).
--   gsc_daily              Tag x Query x Page (Search Analytics, dataState final)
--   ga4_landing_daily      Tag x Landingpage x Kanal x Quelle/Medium (GA4 Data API)
--   first_party_sync_status Zustand je Kunde/Quelle (Berechtigung, Fehler, Backfill)
-- Schreiben ausschliesslich ueber service_role (Datenlauf); Lesen per RLS:
-- Org-Admin sieht alles, Mitglied nur zugewiesene Kunden (Muster client_access_rbac).
-- KPI-Auswertungen als SECURITY-DEFINER-Funktionen mit eigener Zugriffspruefung
-- (Muster get_content_dashboard) — Berechnung serverseitig, nie im Browser.
-- Datenmodell bewusst so, dass Phase 4 (CTR-Luecken, Kannibalisierung, DiD,
-- AI-Referrals ueber session_source/session_medium) ohne Migration moeglich ist.
-- Lovable wendet Repo-Migrationen NICHT automatisch an: manuell per SQL ausfuehren.

-- ── Tabellen ────────────────────────────────────────────────────────────────
create table if not exists public.gsc_daily (
  client_id   uuid not null references public.clients(id) on delete cascade,
  date        date not null,
  query       text not null,
  page        text not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         numeric(8,6) not null default 0,
  position    numeric(8,2) not null default 0,
  primary key (client_id, date, query, page)
);
create index if not exists idx_gsc_daily_client_date on public.gsc_daily (client_id, date desc);
create index if not exists idx_gsc_daily_client_page_date on public.gsc_daily (client_id, page, date);

create table if not exists public.ga4_landing_daily (
  client_id        uuid not null references public.clients(id) on delete cascade,
  date             date not null,
  landing_page     text not null,
  channel_group    text not null,
  session_source   text not null default '',
  session_medium   text not null default '',
  sessions         integer not null default 0,
  engaged_sessions integer not null default 0,
  key_events       numeric(12,2) not null default 0,
  primary key (client_id, date, landing_page, channel_group, session_source, session_medium)
);
create index if not exists idx_ga4_landing_client_date on public.ga4_landing_daily (client_id, date desc);

create table if not exists public.first_party_sync_status (
  client_id         uuid not null references public.clients(id) on delete cascade,
  quelle            text not null check (quelle in ('gsc','ga4')),
  auth_art          text check (auth_art in ('service_account','oauth')),
  zustand           text not null default 'ausstehend'
                    check (zustand in ('ok','keine_berechtigung','fehler','ausstehend')),
  letzter_erfolg_at timestamptz,
  letzter_fehler    text,
  letzter_lauf_at   timestamptz,
  backfill_bis      date,          -- bis zu welchem Tag (rueckwaerts) der Backfill fertig ist
  backfill_ziel     date,          -- aeltester gewuenschter Tag (16 Mon GSC / 14 Mon GA4)
  zeilen_gesamt     bigint not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (client_id, quelle)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.gsc_daily enable row level security;
alter table public.ga4_landing_daily enable row level security;
alter table public.first_party_sync_status enable row level security;

drop policy if exists gsc_daily_select on public.gsc_daily;
create policy gsc_daily_select on public.gsc_daily for select to authenticated
  using (public.has_client_access(client_id));

drop policy if exists ga4_landing_daily_select on public.ga4_landing_daily;
create policy ga4_landing_daily_select on public.ga4_landing_daily for select to authenticated
  using (public.has_client_access(client_id));

drop policy if exists first_party_sync_status_select on public.first_party_sync_status;
create policy first_party_sync_status_select on public.first_party_sync_status for select to authenticated
  using (public.has_client_access(client_id));
-- keine insert/update/delete-Policies: nur service_role schreibt (Datenlauf)

-- ── Zugriffspruefung fuer die KPI-Funktionen ────────────────────────────────
-- Nur Team (Owner/Admin) der Organisation des Kunden — Volkans Entscheid 22.09.
create or replace function public.first_party_zugriff(_client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- service_role = Server-Routen (requireTeamRole prueft dort Owner/Admin);
  -- direkte Aufrufe eingeloggter Nutzer nur als Org-Admin.
  select coalesce(auth.role() = 'service_role', false)
      or exists (
    select 1 from public.clients c
    where c.id = _client_id and public.is_org_admin(c.organization_id)
  );
$$;

-- ── Erwartete CTR je Position (kalibriert aus eigenen Daten, sonst Referenz) ──
-- Referenzkurve = Groessenordnungen aus oeffentlichen Studien (Fallback fuer
-- Buckets mit < 5 Queries). Eigene Kurve: Sum(clicks)/Sum(impressions) je
-- gerundeter Position ueber den Zeitraum.
create or replace function public.kpi_ctr_kurve(_client_id uuid, _von date, _bis date)
returns table (pos int, queries int, impressions bigint, clicks bigint, ctr numeric, quelle text)
language plpgsql stable security definer set search_path = public
as $$
declare
  ref numeric[] := array[0.28,0.15,0.11,0.08,0.07,0.05,0.04,0.035,0.03,0.025,
                         0.02,0.018,0.016,0.014,0.013,0.012,0.011,0.010,0.009,0.008];
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with eigen as (
    select greatest(1, least(20, round(g.position)))::int as pos,
           count(distinct g.query)::int as q,
           sum(g.impressions)::bigint as imp,
           sum(g.clicks)::bigint as cl
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between _von and _bis
    group by 1
  )
  select p.pos,
         coalesce(e.q, 0),
         coalesce(e.imp, 0),
         coalesce(e.cl, 0),
         case when coalesce(e.q,0) >= 5 and coalesce(e.imp,0) > 0
              then round(e.cl::numeric / e.imp, 6) else ref[p.pos] end,
         case when coalesce(e.q,0) >= 5 and coalesce(e.imp,0) > 0 then 'eigene' else 'referenz' end
  from generate_series(1, 20) as p(pos)
  left join eigen e on e.pos = p.pos
  order by p.pos;
end;
$$;

-- ── Kachel 1: Chancen-Keywords ──────────────────────────────────────────────
-- Queries mit gewichteter Position in [_pos_von,_pos_bis], Impressionen >= Schwelle;
-- Score = Impressionen x max(0, erwartete CTR(Zielposition) - eigene CTR).
create or replace function public.kpi_chancen_keywords(
  _client_id uuid, _von date, _bis date,
  _min_impressions int default 100, _pos_von numeric default 8, _pos_bis numeric default 20,
  _zielposition int default 5, _limit int default 25)
returns table (
  query text, impressions bigint, clicks bigint, ctr numeric, pos numeric,
  seiten int, top_page text, erwartete_ctr numeric, ctr_luecke numeric,
  potenzial_klicks numeric, score numeric)
language plpgsql stable security definer set search_path = public
as $$
declare ziel_ctr numeric;
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select k.ctr into ziel_ctr
  from public.kpi_ctr_kurve(_client_id, _von, _bis) k
  where k.pos = greatest(1, least(20, _zielposition));
  return query
  with je_query as (
    select g.query,
           sum(g.impressions)::bigint as imp,
           sum(g.clicks)::bigint as cl,
           case when sum(g.impressions) > 0
                then round(sum(g.position * g.impressions)::numeric / sum(g.impressions), 2)
                else null end as pos,
           count(distinct g.page)::int as seiten
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between _von and _bis
    group by g.query
  ),
  top_page as (
    select distinct on (g.query) g.query, g.page
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between _von and _bis
    group by g.query, g.page
    order by g.query, sum(g.clicks) desc, sum(g.impressions) desc
  )
  select q.query, q.imp, q.cl,
         case when q.imp > 0 then round(q.cl::numeric / q.imp, 6) else 0 end,
         q.pos, q.seiten, t.page,
         ziel_ctr,
         greatest(0, ziel_ctr - case when q.imp > 0 then q.cl::numeric / q.imp else 0 end),
         round(q.imp * greatest(0, ziel_ctr - case when q.imp > 0 then q.cl::numeric / q.imp else 0 end), 1),
         round(q.imp * greatest(0, ziel_ctr - case when q.imp > 0 then q.cl::numeric / q.imp else 0 end), 4)
  from je_query q
  left join top_page t on t.query = q.query
  where q.imp >= _min_impressions and q.pos between _pos_von and _pos_bis
  order by 11 desc, q.imp desc
  limit _limit;
end;
$$;

-- ── Kachel 2: Gewinner und Verlierer (Seiten, Periodenvergleich) ────────────
-- Aktuell = [_von,_bis]; Vorperiode = gleich lang, direkt davor. Top-N je Richtung
-- nach Delta Klicks (Ties: Delta Impressionen).
create or replace function public.kpi_gewinner_verlierer(
  _client_id uuid, _von date, _bis date, _limit int default 10)
returns table (
  richtung text, page text,
  clicks bigint, clicks_vorher bigint, delta_clicks bigint,
  impressions bigint, impressions_vorher bigint, delta_impressions bigint,
  pos numeric, pos_vorher numeric)
language plpgsql stable security definer set search_path = public
as $$
declare tage int := (_bis - _von) + 1;
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with akt as (
    select g.page, sum(g.clicks)::bigint cl, sum(g.impressions)::bigint imp,
           case when sum(g.impressions) > 0
                then round(sum(g.position*g.impressions)::numeric/sum(g.impressions),2) end pos
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between _von and _bis group by g.page
  ),
  vor as (
    select g.page, sum(g.clicks)::bigint cl, sum(g.impressions)::bigint imp,
           case when sum(g.impressions) > 0
                then round(sum(g.position*g.impressions)::numeric/sum(g.impressions),2) end pos
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between (_von - tage) and (_von - 1) group by g.page
  ),
  beide as (
    select coalesce(a.page, v.page) page,
           coalesce(a.cl,0) cl, coalesce(v.cl,0) clv, coalesce(a.cl,0)-coalesce(v.cl,0) dcl,
           coalesce(a.imp,0) imp, coalesce(v.imp,0) impv, coalesce(a.imp,0)-coalesce(v.imp,0) dimp,
           a.pos, v.pos posv
    from akt a full outer join vor v on v.page = a.page
  ),
  gew as (select *, 'gewinner'::text r from beide where dcl > 0 order by dcl desc, dimp desc limit _limit),
  ver as (select *, 'verlierer'::text r from beide where dcl < 0 order by dcl asc, dimp asc limit _limit)
  select r, x.page, x.cl, x.clv, x.dcl, x.imp, x.impv, x.dimp, x.pos, x.posv
  from (select * from gew union all select * from ver) x
  order by (x.r = 'verlierer'), abs(x.dcl) desc;
end;
$$;

-- ── Kachel 3: Organische Conversions je Landingpage (GA4, Organic Search) ───
create or replace function public.kpi_organic_conversions(
  _client_id uuid, _von date, _bis date, _limit int default 10)
returns table (
  landing_page text, sessions bigint, engaged_sessions bigint,
  key_events numeric, conversion_rate numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select l.landing_page,
         sum(l.sessions)::bigint,
         sum(l.engaged_sessions)::bigint,
         round(sum(l.key_events)::numeric, 2),
         case when sum(l.sessions) > 0 then round(sum(l.key_events)::numeric / sum(l.sessions), 4) else 0 end
  from public.ga4_landing_daily l
  where l.client_id = _client_id and l.date between _von and _bis
    and l.channel_group = 'Organic Search'
  group by l.landing_page
  having sum(l.sessions) > 0
  order by 4 desc, 2 desc
  limit _limit;
end;
$$;

-- Hinweis: `position` ist in RETURNS TABLE reserviert → Ausgabespalte heisst `pos`.
-- Verfuegbarkeit fuer die Kacheln: aeltester/neuester Tag je Quelle
create or replace function public.kpi_datenstand(_client_id uuid)
returns table (quelle text, von date, bis date, zeilen bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select 'gsc'::text, min(g.date), max(g.date), count(*)::bigint from public.gsc_daily g where g.client_id = _client_id
  union all
  select 'ga4'::text, min(l.date), max(l.date), count(*)::bigint from public.ga4_landing_daily l where l.client_id = _client_id;
end;
$$;

revoke all on function public.first_party_zugriff(uuid) from public;
grant execute on function public.first_party_zugriff(uuid) to authenticated, service_role;
grant execute on function public.kpi_ctr_kurve(uuid, date, date) to authenticated, service_role;
grant execute on function public.kpi_chancen_keywords(uuid, date, date, int, numeric, numeric, int, int) to authenticated, service_role;
grant execute on function public.kpi_gewinner_verlierer(uuid, date, date, int) to authenticated, service_role;
grant execute on function public.kpi_organic_conversions(uuid, date, date, int) to authenticated, service_role;
grant execute on function public.kpi_datenstand(uuid) to authenticated, service_role;

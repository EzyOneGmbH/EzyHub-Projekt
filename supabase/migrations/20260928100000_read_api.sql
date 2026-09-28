-- Read-API für ChatGPT (28.09.2026): Datenbasis + org-weite API-Tokens.
--
-- 1) rank_daily: eine Zeile je Kunde/Tag/Keyword (aus dem Rank-Snapshot-
--    Ingest /api/admin/rank-snapshot, zusätzlich zu audit_runs). Damit werden
--    kundenübergreifende Auswertungen (Verlierer/Gewinner, Sichtbarkeit) per
--    SQL möglich, ohne JSON-Payloads zu entpacken.
-- 2) Backfill aus audit_runs (rankings, succeeded) — idempotent.
-- 3) SQL-Funktionen rank_changes() und visibility_daily() (nur service_role;
--    die Read-API prüft Token + Organisation serverseitig).
-- 4) ingest_credentials: neuer Zweck read_api (Präfix ezyi_ra_), org-weit
--    (client_id null), Lifecycle-RPCs erweitert.
-- 5) read_api_log: Zugriffsprotokoll der Read-API.
--
-- ACHTUNG: Lovable wendet Repo-Migrationen NICHT automatisch an — manuell via
-- Lovable-SQL ausführen.

-- ── 1) rank_daily ────────────────────────────────────────────────────────────
create table if not exists public.rank_daily (
  client_id uuid not null references public.clients(id) on delete cascade,
  organization_id uuid not null,
  date date not null,
  keyword text not null,
  -- null = nicht in den Top 30 (bzw. keine Position gemessen)
  position numeric(6,2) null,
  pos_src text null check (pos_src in ('crawl', 'gsc')),
  local_pos numeric null,
  url text null,
  search_volume integer null,
  is_money boolean not null default false,
  device text not null default 'desktop',
  country text not null default 'CH',
  language text null,
  method text null,
  measured_at timestamptz null,
  primary key (client_id, date, keyword)
);

create index if not exists rank_daily_org_date_idx on public.rank_daily (organization_id, date);
create index if not exists rank_daily_client_date_idx on public.rank_daily (client_id, date desc);
create index if not exists rank_daily_client_kw_date_idx on public.rank_daily (client_id, keyword, date);

alter table public.rank_daily enable row level security;
-- Lesen: wer Zugriff auf den Kunden hat (Admin der Org oder zugewiesen).
-- Schreiben: keine Policies → nur service_role (Ingest/Backfill).
drop policy if exists rank_daily_select on public.rank_daily;
create policy rank_daily_select on public.rank_daily
  for select to authenticated using (public.has_client_access(client_id));

-- ── 2) Backfill aus audit_runs (idempotent, on conflict do nothing) ─────────
-- Je (client_id, Datum) die NEUESTE erfolgreiche rankings-Zeile.
insert into public.rank_daily (
  client_id, organization_id, date, keyword, position, pos_src, local_pos, url,
  search_volume, is_money, device, country, language, method, measured_at
)
select
  r.client_id,
  r.organization_id,
  r.tag,
  btrim(k->>'kw'),
  case when (k->>'pos') ~ '^\d{1,3}(\.\d+)?$' then round((k->>'pos')::numeric, 2) end,
  case when k->>'posSrc' in ('crawl', 'gsc') then k->>'posSrc' end,
  case when (k->>'posLocal') ~ '^\d{1,6}(\.\d+)?$' then (k->>'posLocal')::numeric end,
  nullif(k->>'url', ''),
  case when (k->>'volume') ~ '^\d{1,9}(\.\d+)?$' then round((k->>'volume')::numeric)::integer end,
  coalesce(k->>'isMoney' = 'true', false),
  coalesce(nullif(r.result->'measurement'->>'device', ''), 'desktop'),
  coalesce(nullif(r.result->'measurement'->>'country', ''), 'CH'),
  nullif(r.result->'measurement'->>'language', ''),
  nullif(r.result->'measurement'->>'method', ''),
  case
    when (r.result->'measurement'->>'measuredAt')
         ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$'
    then (r.result->'measurement'->>'measuredAt')::timestamptz
  end
from (
  select distinct on (a.client_id, x.tag)
         a.client_id, a.organization_id, a.result, x.tag
    from public.audit_runs a
    join public.clients c on c.id = a.client_id
    cross join lateral (
      select coalesce(a.input->>'date', a.result->>'date') as roh
    ) d
    cross join lateral (
      select case when d.roh ~ '^\d{4}-\d{2}-\d{2}$' then d.roh::date end as tag
    ) x
   where a.audit_type = 'rankings'
     and a.status = 'succeeded'
     and x.tag is not null
     and jsonb_typeof(a.result->'keywords') = 'array'
   order by a.client_id, x.tag, coalesce(a.finished_at, a.updated_at, a.created_at) desc
) r
cross join lateral jsonb_array_elements(r.result->'keywords') k
where jsonb_typeof(k) = 'object'
  and coalesce(btrim(k->>'kw'), '') <> ''
on conflict (client_id, date, keyword) do nothing;

-- ── 3a) rank_changes ─────────────────────────────────────────────────────────
-- Positionsveränderung je Kunde/Keyword zwischen dem letzten verfügbaren Tag
-- ≤ _from und dem letzten verfügbaren Tag ≤ _to (je 3 Tage Toleranz).
-- Verglichen wird NUR innerhalb derselben Messmethode (pos_src): gibt es kein
-- Paar mit gleichem pos_src, entfällt die Zeile. Bei mehreren Paaren gewinnt
-- das jüngste «nachher», dann das jüngste «vorher», dann crawl vor gsc.
-- position_before/position_after: Rohwerte (null = nicht in Top 30);
-- position_change rechnet null als 31 (positiv = Verlust); dropped_out = vorher
-- gerankt, nachher nicht mehr. Zeilen ohne Position an beiden Tagen entfallen.
-- _richtung: 'verlust' (change >= _min_loss, desc) | 'gewinn' (change <=
-- -_min_loss, asc) | 'alle' (|change| >= _min_loss, nach |change| desc);
-- danach search_volume desc. total_count = Treffer vor limit/offset.
create or replace function public.rank_changes(
  _org uuid,
  _client uuid default null,
  _from date default (current_date - 7),
  _to date default current_date,
  _min_loss numeric default 1,
  _country text default null,
  _device text default null,
  _limit integer default 100,
  _offset integer default 0,
  _richtung text default 'verlust'
) returns table (
  client_id uuid,
  keyword text,
  url text,
  position_before numeric,
  position_after numeric,
  position_change numeric,
  dropped_out boolean,
  date_before date,
  date_after date,
  pos_src text,
  search_volume integer,
  country text,
  device text,
  total_count bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_richtung text := lower(coalesce(_richtung, 'verlust'));
  v_min numeric := coalesce(_min_loss, 0);
begin
  if _org is null or _from is null or _to is null then
    raise exception '_org, _from und _to sind Pflicht' using errcode = '22023';
  end if;
  if _to <= _from then
    raise exception '_to muss nach _from liegen' using errcode = '22023';
  end if;
  if v_richtung not in ('verlust', 'gewinn', 'alle') then
    raise exception '_richtung muss verlust, gewinn oder alle sein' using errcode = '22023';
  end if;

  return query
  with basis as (
    select rd.*
      from public.rank_daily rd
     where rd.organization_id = _org
       and (_client is null or rd.client_id = _client)
       and (_country is null or rd.country = _country)
       and (_device is null or rd.device = _device)
       and rd.pos_src is not null
       and (rd.date between _from - 3 and _from or rd.date between _to - 3 and _to)
  ),
  vorher as (
    select distinct on (b.client_id, b.keyword, b.pos_src) b.*
      from basis b
     where b.date between _from - 3 and _from
     order by b.client_id, b.keyword, b.pos_src, b.date desc
  ),
  nachher as (
    select distinct on (b.client_id, b.keyword, b.pos_src) b.*
      from basis b
     where b.date between _to - 3 and _to
       and b.date > _from
     order by b.client_id, b.keyword, b.pos_src, b.date desc
  ),
  paare as (
    select distinct on (n.client_id, n.keyword)
           n.client_id,
           n.keyword,
           coalesce(n.url, v.url) as url,
           v.position as position_before,
           n.position as position_after,
           coalesce(n.position, 31) - coalesce(v.position, 31) as position_change,
           (v.position is not null and n.position is null) as dropped_out,
           v.date as date_before,
           n.date as date_after,
           n.pos_src,
           coalesce(n.search_volume, v.search_volume) as search_volume,
           n.country,
           n.device
      from nachher n
      join vorher v
        on v.client_id = n.client_id and v.keyword = n.keyword and v.pos_src = n.pos_src
     where not (v.position is null and n.position is null)
     order by n.client_id, n.keyword, n.date desc, v.date desc,
              (n.pos_src = 'crawl') desc
  ),
  gefiltert as (
    select p.*
      from paare p
     where case v_richtung
             when 'verlust' then p.position_change >= v_min
             when 'gewinn' then p.position_change <= -v_min
             else abs(p.position_change) >= v_min
           end
  )
  select g.client_id, g.keyword, g.url, g.position_before, g.position_after,
         g.position_change, g.dropped_out, g.date_before, g.date_after, g.pos_src,
         g.search_volume, g.country, g.device,
         count(*) over () as total_count
    from gefiltert g
   order by
     case when v_richtung = 'verlust' then g.position_change end desc nulls last,
     case when v_richtung = 'gewinn' then g.position_change end asc nulls last,
     case when v_richtung = 'alle' then abs(g.position_change) end desc nulls last,
     g.search_volume desc nulls last,
     g.client_id, g.keyword
   limit greatest(1, least(coalesce(_limit, 100), 1000))
  offset greatest(0, coalesce(_offset, 0));
end $$;

revoke all on function public.rank_changes(uuid, uuid, date, date, numeric, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.rank_changes(uuid, uuid, date, date, numeric, text, text, integer, integer, text) to service_role;

-- ── 3b) visibility_daily ─────────────────────────────────────────────────────
-- Tageskennzahlen eines Kunden aus rank_daily, je Tag GETRENNT nach pos_src
-- (crawl/gsc/null) — Methoden werden nie vermischt.
create or replace function public.visibility_daily(
  _org uuid,
  _client uuid,
  _from date,
  _to date
) returns table (
  date date,
  pos_src text,
  tracked bigint,
  top3 bigint,
  top10 bigint,
  top30 bigint,
  avg_position numeric,
  keywords_ranking bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if _org is null or _client is null or _from is null or _to is null then
    raise exception '_org, _client, _from und _to sind Pflicht' using errcode = '22023';
  end if;
  return query
  select rd.date,
         rd.pos_src,
         count(*) as tracked,
         count(*) filter (where rd.position <= 3) as top3,
         count(*) filter (where rd.position <= 10) as top10,
         count(*) filter (where rd.position <= 30) as top30,
         round(avg(rd.position), 2) as avg_position,
         count(rd.position) as keywords_ranking
    from public.rank_daily rd
   where rd.organization_id = _org
     and rd.client_id = _client
     and rd.date between _from and _to
   group by rd.date, rd.pos_src
   order by rd.date, rd.pos_src nulls last;
end $$;

revoke all on function public.visibility_daily(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.visibility_daily(uuid, uuid, date, date) to service_role;

-- ── 4) ingest_credentials: org-weiter Zweck read_api ────────────────────────
alter table public.ingest_credentials alter column client_id drop not null;
alter table public.ingest_credentials
  drop constraint if exists ingest_credentials_purpose_check;
alter table public.ingest_credentials
  add constraint ingest_credentials_purpose_check
  check (purpose in ('openai_ads', 'ai_crawler', 'rank_snapshot', 'read_api'));
-- read_api ist IMMER org-weit (ohne Kunde), alle anderen Zwecke IMMER kundengebunden.
alter table public.ingest_credentials
  drop constraint if exists ingest_credentials_scope_check;
alter table public.ingest_credentials
  add constraint ingest_credentials_scope_check
  check ((purpose = 'read_api') = (client_id is null));
create index if not exists ingest_credentials_org_purpose_idx
  on public.ingest_credentials (organization_id, purpose);

-- create: gleiche Signatur; für read_api wird die Organisation statt des
-- Kunden geprüft (_client_id muss null sein).
create or replace function public.ingest_credential_create(
  _organization_id uuid,
  _client_id uuid,
  _purpose text,
  _token_hash text,
  _token_prefix text,
  _label text default null,
  _expires_at timestamptz default null,
  _created_by uuid default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  r public.ingest_credentials;
begin
  if _purpose = 'read_api' then
    if _client_id is not null then
      raise exception 'read_api-Token sind org-weit (ohne Kunde)' using errcode = 'P0003';
    end if;
    if not exists (select 1 from public.organizations where id = _organization_id) then
      raise exception 'Organisation nicht gefunden' using errcode = 'P0002';
    end if;
  else
    if not exists (
      select 1 from public.clients where id = _client_id and organization_id = _organization_id
    ) then
      raise exception 'Kunde nicht in dieser Organisation' using errcode = 'P0002';
    end if;
  end if;
  insert into public.ingest_credentials
    (organization_id, client_id, purpose, token_hash, token_prefix, label, created_by, expires_at)
  values
    (_organization_id, _client_id, _purpose, _token_hash, _token_prefix, _label, _created_by, _expires_at)
  returning * into r;
  return r;
end $$;

-- rotate/revoke: neuer optionaler Parameter _organization_id (am Ende, Default
-- null — bestehende Aufrufe mit benannten Argumenten bleiben gültig). Alte
-- Signaturen werden entfernt, damit PostgREST keine Überladung auflösen muss.
--  - _client_id gesetzt: wie bisher über id + client_id (zusätzlich org, falls
--    _organization_id gesetzt).
--  - _client_id null: org-weites read_api-Token über id + organization_id.
drop function if exists public.ingest_credential_rotate(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid);
create or replace function public.ingest_credential_rotate(
  _credential_id uuid,
  _client_id uuid,
  _token_hash text,
  _token_prefix text,
  _label text default null,
  _expires_at timestamptz default null,
  _grace_until timestamptz default null,
  _created_by uuid default null,
  _organization_id uuid default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  alt public.ingest_credentials;
  neu public.ingest_credentials;
begin
  if _client_id is null and _organization_id is null then
    raise exception 'Kunde oder Organisation erforderlich' using errcode = 'P0002';
  end if;
  -- Zeile sperren: zwei gleichzeitige Rotationen erzeugen nie zwei Nachfolger.
  select * into alt from public.ingest_credentials c
   where c.id = _credential_id
     and (
       (_client_id is not null and c.client_id = _client_id
         and (_organization_id is null or c.organization_id = _organization_id))
       or
       (_client_id is null and c.organization_id = _organization_id
         and c.client_id is null and c.purpose = 'read_api')
     )
   for update;
  if not found then
    raise exception 'Credential nicht gefunden' using errcode = 'P0002';
  end if;
  if alt.revoked_at is not null then
    raise exception 'Widerrufenes Credential kann nicht rotiert werden' using errcode = 'P0003';
  end if;
  insert into public.ingest_credentials
    (organization_id, client_id, purpose, token_hash, token_prefix, label, created_by, expires_at, rotated_from)
  values
    (alt.organization_id, alt.client_id, alt.purpose, _token_hash, _token_prefix, _label, _created_by, _expires_at, alt.id)
  returning * into neu;
  -- Altes Token läuft nach der Überlappung aus — nie verlängern.
  update public.ingest_credentials
     set expires_at = least(coalesce(expires_at, 'infinity'::timestamptz), coalesce(_grace_until, now()))
   where id = alt.id;
  return neu;
end $$;

drop function if exists public.ingest_credential_revoke(uuid, uuid, text);
create or replace function public.ingest_credential_revoke(
  _credential_id uuid,
  _client_id uuid,
  _reason text default null,
  _organization_id uuid default null
) returns public.ingest_credentials
language plpgsql security definer set search_path to 'public'
as $$
declare
  r public.ingest_credentials;
begin
  if _client_id is null and _organization_id is null then
    raise exception 'Kunde oder Organisation erforderlich' using errcode = 'P0002';
  end if;
  update public.ingest_credentials c
     set revoked_at = coalesce(c.revoked_at, now()),
         revoked_reason = coalesce(c.revoked_reason, _reason)
   where c.id = _credential_id
     and (
       (_client_id is not null and c.client_id = _client_id
         and (_organization_id is null or c.organization_id = _organization_id))
       or
       (_client_id is null and c.organization_id = _organization_id
         and c.client_id is null and c.purpose = 'read_api')
     )
  returning * into r;
  if not found then
    raise exception 'Credential nicht gefunden' using errcode = 'P0002';
  end if;
  return r;
end $$;

revoke all on function public.ingest_credential_create(uuid, uuid, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ingest_credential_rotate(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ingest_credential_revoke(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.ingest_credential_create(uuid, uuid, text, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.ingest_credential_rotate(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid) to service_role;
grant execute on function public.ingest_credential_revoke(uuid, uuid, text, uuid) to service_role;

-- ── 5) read_api_log ──────────────────────────────────────────────────────────
-- Zugriffsprotokoll der Read-API (je Request eine Zeile, IP nur als gekürzter
-- sha256-Hash). Aufbewahrung: 90 Tage — Löschung manuell bzw. später per
-- Job (bewusst KEIN pg_cron-Job in dieser Migration):
--   delete from public.read_api_log where created_at < now() - interval '90 days';
create table if not exists public.read_api_log (
  id bigserial primary key,
  credential_id uuid references public.ingest_credentials(id) on delete set null,
  organization_id uuid not null,
  method text,
  path text,
  query jsonb,
  status integer,
  dauer_ms integer,
  zeilen integer,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists read_api_log_org_created_idx
  on public.read_api_log (organization_id, created_at desc);

alter table public.read_api_log enable row level security;
-- Lesen nur Owner/Admin der Organisation; Schreiben nur service_role (keine Policy).
drop policy if exists read_api_log_select on public.read_api_log;
create policy read_api_log_select on public.read_api_log
  for select to authenticated using (public.is_org_admin(organization_id));

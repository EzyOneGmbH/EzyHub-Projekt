-- ============================================================================
-- Content-Performance-Tracking & Refresh-Dashboard  (OPTION A)
-- Baut auf dem BESTEHENDEN public.content_items auf (kein Duplikat):
--   * additive Tracking-Spalten an content_items (nullable -> safe)
--   * neue Zeitreihe content_metrics (FK -> content_items.id)
--   * content_decision-View (Rolling-28 Window, korrigiert)
--   * get_content_dashboard(): SECURITY DEFINER + expliziter Zugriffs-Gate
--     -> Tenant-Isolation ohne Eingriff in die content_items-RLS
-- Tenancy = organizations -> clients (content_items.client_id).
-- Ingestion (n8n-Sync + Agent) schreibt mit service_role -> umgeht RLS.
-- Idempotent (if not exists / create or replace / add column if not exists).
-- ============================================================================

-- ── 1) content_items um Tracking-Felder erweitern (additiv, nullable) --------
alter table public.content_items add column if not exists primary_keyword text;
alter table public.content_items add column if not exists keyword_volume  int;
alter table public.content_items add column if not exists published_at     date;
alter table public.content_items add column if not exists last_refresh_at  date;
alter table public.content_items add column if not exists hub              text;
alter table public.content_items add column if not exists author           text;   -- E-E-A-T
alter table public.content_items add column if not exists intent           text
  check (intent is null or intent in ('informational','commercial','transactional','navigational'));

create index if not exists idx_ci_client on public.content_items (client_id);
create index if not exists idx_ci_kw     on public.content_items (client_id, lower(primary_keyword));

-- ── 2) Zeitreihe je Artikel/Tag (SINGLE-DAY-Rohwert; Rolling-28 = View) ------
create table if not exists public.content_metrics (
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  captured_on date not null default current_date,
  position     numeric,        -- Ø-Position Ziel-KW (GSC)
  impressions  int not null default 0,
  clicks       int not null default 0,
  ctr          numeric,        -- clicks/impressions (GSC)
  sessions     int not null default 0,   -- GA4 organic sessions
  conversions  int not null default 0,   -- GA4 (bei FiH: Spenden)
  backlinks    int,            -- Ahrefs
  ai_citations int,            -- Canonry/Perplexity
  primary key (content_item_id, captured_on)        -- idempotenter Upsert je Tag
);
create index if not exists idx_cm_item_date on public.content_metrics (content_item_id, captured_on desc);

-- ── 3) Zugriffs-Helper: Content ist client-scoped; Zugriff über die Org ------
create or replace function public.can_access_client(_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_member(
    (select c.organization_id from public.clients c where c.id = _client_id)
  );
$$;

-- ── 4) RLS auf content_metrics (neue Tabelle) -------------------------------
alter table public.content_metrics enable row level security;

drop policy if exists cm_select on public.content_metrics;
create policy cm_select on public.content_metrics
  for select to authenticated
  using (exists (
    select 1 from public.content_items ci
    where ci.id = content_metrics.content_item_id
      and public.can_access_client(ci.client_id)
  ));

-- Schreiben über die App nur für Org-Mitglieder (Sync/Agent nutzen service_role).
drop policy if exists cm_write on public.content_metrics;
create policy cm_write on public.content_metrics
  for all to authenticated
  using (exists (select 1 from public.content_items ci
                 where ci.id = content_metrics.content_item_id
                   and public.can_access_client(ci.client_id)))
  with check (exists (select 1 from public.content_items ci
                 where ci.id = content_metrics.content_item_id
                   and public.can_access_client(ci.client_id)));

-- ── 5) Entscheidungs-View (§11). content_items.status-Enum = draft/review/
--      published -> hier zählt nur 'published'. Rolling-28 als Window. ---------
create or replace view public.content_decision as
with
rolling as (
  select
    content_item_id,
    captured_on,
    sum(clicks)      over w as clicks_28,
    sum(impressions) over w as impr_28,
    avg(position)    over w as pos_28
  from public.content_metrics
  window w as (
    partition by content_item_id order by captured_on
    range between interval '27 days' preceding and current row
  )
),
cur as (
  select distinct on (content_item_id)
    content_item_id, captured_on, clicks_28, impr_28, pos_28
  from rolling
  order by content_item_id, captured_on desc
),
peak as (
  select
    content_item_id,
    max(clicks_28) as peak_clicks_28,
    min(pos_28) filter (where pos_28 is not null) as peak_position
  from rolling
  group by content_item_id
),
cannib as (
  select client_id, lower(primary_keyword) as kw
  from public.content_items
  where status = 'published' and primary_keyword is not null
  group by client_id, lower(primary_keyword)
  having count(*) > 1
)
select
  ci.id, ci.client_id, coalesce(ci.target_url,'') as url, ci.title,
  ci.primary_keyword, ci.hub, ci.language, ci.author, ci.status::text as status,
  ci.published_at, ci.last_refresh_at,
  (current_date - ci.published_at)     as age_days,
  round(c.pos_28, 1)                   as position_28,
  c.clicks_28, c.impr_28,
  pk.peak_position, pk.peak_clicks_28,
  case
    when ci.published_at is null                 then 'unpublished'
    when (current_date - ci.published_at) < 30   then 'maturing'
    when (current_date - ci.published_at) < 60   then 'gate_30'
    when (current_date - ci.published_at) < 90   then 'gate_60'
    else 'gate_90_plus'
  end as gate,
  case
    when pk.peak_clicks_28 is null or pk.peak_clicks_28 = 0            then 'kein_traffic'
    when coalesce(c.clicks_28,0) >= pk.peak_clicks_28                 then 'steigend_stabil'
    when coalesce(c.clicks_28,0) <  pk.peak_clicks_28 * (1 - 0.30)    then 'decay'   -- TUNE
    else 'stabil'
  end as trend,
  case
    when ci.published_at is null then 'unpublished'
    when (current_date - ci.published_at) < 30 then 'maturing_wait'
    when coalesce(c.impr_28,0) < 100 then 'insufficient_data'   -- TUNE noise_floor
    when exists (select 1 from cannib cn
                 where cn.client_id = ci.client_id
                   and cn.kw = lower(ci.primary_keyword)) then 'consolidate'
    when c.pos_28 is null or c.pos_28 > 100 then 'tech_fix'
    when coalesce(c.impr_28,0) >= 100 and coalesce(c.clicks_28,0) = 0
         and c.pos_28 <= 10 then 'ctr_fix'
    when c.pos_28 between 11 and 20 then 'push_expand'
    when (current_date - ci.published_at) >= 90
         and pk.peak_clicks_28 is not null
         and coalesce(c.clicks_28,0) < pk.peak_clicks_28 * (1 - 0.30) then 'refresh_decay'  -- TUNE
    when c.pos_28 <= 10 and coalesce(ci.keyword_volume,0) between 1 and 49 then 'ceiling_new_kw'  -- TUNE
    when c.pos_28 <= 10 then 'stable_hold'
    else 'monitor'
  end as recommendation
from public.content_items ci
left join cur  c  on c.content_item_id = ci.id
left join peak pk on pk.content_item_id = ci.id
where ci.status = 'published';

-- Die View NICHT direkt für Clients freigeben (content_items-RLS ist USING(true)
-- -> Direktzugriff wäre nicht tenant-isoliert). Zugriff NUR über die gated RPC.
revoke all on public.content_decision from anon, authenticated;

-- ── 6) Serving-RPC: SECURITY DEFINER + expliziter Zugriffs-Gate --------------
create or replace function public.get_content_dashboard(p_client_id uuid)
returns setof public.content_decision
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_access_client(p_client_id) then
    return;                      -- kein Zugriff -> 0 Zeilen (harter Tenant-Gate)
  end if;
  return query
    select * from public.content_decision
    where client_id = p_client_id
    order by
      case recommendation
        when 'tech_fix'       then 1
        when 'consolidate'    then 2
        when 'refresh_decay'  then 3
        when 'push_expand'    then 4
        when 'ctr_fix'        then 5
        when 'ceiling_new_kw' then 6
        else 9
      end,
      age_days desc nulls last;
end $$;

revoke all on function public.get_content_dashboard(uuid) from anon;
grant execute on function public.get_content_dashboard(uuid) to authenticated;

-- HINWEIS (separat, empfohlen): public.content_items hat SELECT-RLS USING(true)
-- = kein DB-Ebenen-Tenant-Schutz (nur App-seitig gefiltert). Für dieses Feature
-- unkritisch (Zugriff läuft über die gated RPC), aber als latentes Cross-Tenant-
-- Leck separat härten: policy content_select auf can_access_client(client_id).

-- ============================================================================
-- Coverage-Guard gegen falsches 'tech_fix' in der Anlaufphase (Befund 22.07.,
-- Hotel Baeren): Das Tracking lief erst 4 Tage, das "28-Tage-Fenster" bestand
-- also nur aus 4 Messtagen. Artikel mit wenigen Impressionen pro Woche standen
-- damit auf 0 Impressionen und fielen in die Regel "90+ Tage alt UND impr=0 ->
-- tech_fix" — obwohl die Seite laut GSC sauber indexiert ist (indexiert heisst
-- nicht sichtbar; das Urteil "unsichtbar" braucht ein echtes Messfenster).
-- Fix: 'tech_fix' wegen 0 Impressionen erst ab >=14 Messtagen im Fenster;
-- vorher ehrlich 'insufficient_data'. Neue Spalte measured_days_28 (ans ENDE
-- der Spaltenliste -> create or replace view erlaubt das) macht die Abdeckung
-- im Dashboard sichtbar. RPC wird identisch neu erstellt (Rowtype-Refresh).
-- ============================================================================
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
coverage as (
  select content_item_id, count(*) as days_28
  from public.content_metrics
  where captured_on >= current_date - 28
  group by content_item_id
),
cannib as (
  select client_id, lower(primary_keyword) as kw
  from public.content_items
  where status = 'published' and content_type = 'blog' and primary_keyword is not null
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
    when coalesce(c.clicks_28,0) <  pk.peak_clicks_28 * (1 - 0.30)    then 'decay'
    else 'stabil'
  end as trend,
  case
    when ci.published_at is null then 'unpublished'
    when (current_date - ci.published_at) < 30 then 'maturing_wait'
    -- 90+ Tage publiziert und keinerlei Impressionen = in Google unsichtbar ->
    -- Technik pruefen. ABER nur mit genug Messtagen im Fenster (Coverage-Guard),
    -- sonst ist "0 Impressionen" bloss ein zu kurzes Messfenster.
    when (current_date - ci.published_at) >= 90
         and coalesce(c.impr_28,0) = 0
         and coalesce(cov.days_28,0) >= 14 then 'tech_fix'
    when coalesce(c.impr_28,0) < 100 then 'insufficient_data'
    when exists (select 1 from cannib cn
                 where cn.client_id = ci.client_id
                   and cn.kw = lower(ci.primary_keyword)) then 'consolidate'
    when c.pos_28 is null or c.pos_28 > 100 then 'tech_fix'
    when coalesce(c.impr_28,0) >= 100 and coalesce(c.clicks_28,0) = 0
         and c.pos_28 <= 10 then 'ctr_fix'
    when c.pos_28 between 11 and 20 then 'push_expand'
    when (current_date - ci.published_at) >= 90
         and pk.peak_clicks_28 is not null
         and coalesce(c.clicks_28,0) < pk.peak_clicks_28 * (1 - 0.30) then 'refresh_decay'
    when c.pos_28 <= 10 and coalesce(ci.keyword_volume,0) between 1 and 49 then 'ceiling_new_kw'
    when c.pos_28 <= 10 then 'stable_hold'
    else 'monitor'
  end as recommendation,
  coalesce(cov.days_28, 0) as measured_days_28
from public.content_items ci
left join cur      c   on c.content_item_id  = ci.id
left join peak     pk  on pk.content_item_id = ci.id
left join coverage cov on cov.content_item_id = ci.id
where ci.status = 'published' and ci.content_type = 'blog';

revoke all on public.content_decision from anon, authenticated;

-- RPC unveraendert neu erstellen, damit der Rowtype die neue Spalte kennt.
create or replace function public.get_content_dashboard(p_client_id uuid)
returns setof public.content_decision
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_access_client(p_client_id) then
    return;
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

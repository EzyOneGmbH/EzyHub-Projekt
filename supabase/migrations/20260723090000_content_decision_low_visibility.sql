-- ============================================================================
-- Neue Kategorie low_visibility (23.07.): Nach dem 180-Tage-Backfill blieben
-- alte Artikel auf "Zu wenig Daten" haengen — das Label meinte aber nie das
-- Messfenster, sondern <100 Impressionen/28T. Fuer 90+ Tage alte Artikel MIT
-- voller Messabdeckung ist das kein Daten-, sondern ein Sichtbarkeitsproblem
-- (indexiert, aber Google spielt sie kaum aus) -> eigener, handlungsbeduerftiger
-- Fall 'low_visibility' (Keyword-Fokus/Intent/interne Links), einsortiert
-- zwischen tech_fix (0 Impr.) und insufficient_data (junge Artikel oder
-- Messfenster fuellt sich noch). RPC-Sortierung kennt low_visibility (Prio 7).
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
  where captured_on >= current_date - 120
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
    when (current_date - ci.published_at) >= 90
         and coalesce(c.impr_28,0) = 0
         and coalesce(cov.days_28,0) >= 14 then 'tech_fix'
    when (current_date - ci.published_at) >= 90
         and coalesce(c.impr_28,0) < 100
         and coalesce(cov.days_28,0) >= 14 then 'low_visibility'
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
        when 'low_visibility' then 7
        else 9
      end,
      age_days desc nulls last;
end $$;

revoke all on function public.get_content_dashboard(uuid) from anon;
grant execute on function public.get_content_dashboard(uuid) to authenticated;

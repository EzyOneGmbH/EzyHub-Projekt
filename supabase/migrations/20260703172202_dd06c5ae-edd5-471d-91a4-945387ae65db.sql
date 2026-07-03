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
  end as recommendation
from public.content_items ci
left join cur  c  on c.content_item_id = ci.id
left join peak pk on pk.content_item_id = ci.id
where ci.status = 'published' and ci.content_type = 'blog';

revoke all on public.content_decision from anon, authenticated;
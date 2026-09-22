-- First-Party GEO, Phase 4 (22.09.2026, Volkan): Auswertungen fuer die
-- GEO-Kacheln im EzyAI-Tab auf Basis der Phase-2a-Tabellen (gsc_daily,
-- ga4_landing_daily) — keine neuen Tabellen.
--   kpi_ki_referrals    GA4-Zeilen, deren Quelle/Medium eine KI-Engine sein
--                       KOENNTE (grober ILIKE-Vorfilter; die feine Zuordnung
--                       macht TS mit klassifiziereKiQuelle in src/lib/ai-referrer.ts —
--                       beide Listen deckungsgleich halten)
--   kpi_seiten_tage     Seite x Tag (Klicks/Impressionen) fuer Difference-in-Differences
--   kpi_seiten_zeitraum Seite ueber den Zeitraum (Impressionen/Klicks/gew. Position)
--                       fuer den Abgleich «zitiert vs. organisch sichtbar»
--   kpi_brand_wochen    Brand- vs. Nonbrand-Impressionen/Klicks je ISO-Woche
-- Alle SECURITY DEFINER mit first_party_zugriff-Check (Muster Phase 2a);
-- `position` ist in RETURNS TABLE reserviert → Ausgabespalte `pos`.
-- Lovable wendet Repo-Migrationen NICHT automatisch an: manuell per SQL ausfuehren.

-- ── KI-Referrals (GA4): Vorfilter auf moegliche KI-Quellen ──────────────────
create or replace function public.kpi_ki_referrals(_client_id uuid, _von date, _bis date)
returns table (
  date date, session_source text, session_medium text, landing_page text,
  sessions bigint, engaged_sessions bigint, key_events numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select l.date, l.session_source, l.session_medium, l.landing_page,
         sum(l.sessions)::bigint,
         sum(l.engaged_sessions)::bigint,
         round(sum(l.key_events)::numeric, 2)
  from public.ga4_landing_daily l
  where l.client_id = _client_id and l.date between _von and _bis
    and (
      l.session_source ilike any (array[
        '%chatgpt%', '%openai%', '%perplexity%', '%gemini.google%', '%bard.google%',
        '%copilot%', '%bing.com/chat%', '%claude%', '%you.com%', '%poe.com%',
        '%meta.ai%', '%deepseek%', '%grok%', '%x.ai%', '%phind%'])
      or l.session_medium ilike any (array['%ai-assistant%', '%ai_assistant%', '%ai-chat%'])
    )
  group by l.date, l.session_source, l.session_medium, l.landing_page
  order by l.date, l.session_source, l.landing_page;
end;
$$;

-- ── Seite x Tag (fuer DiD-Fenster) ──────────────────────────────────────────
create or replace function public.kpi_seiten_tage(_client_id uuid, _von date, _bis date)
returns table (page text, date date, clicks bigint, impressions bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select g.page, g.date, sum(g.clicks)::bigint, sum(g.impressions)::bigint
  from public.gsc_daily g
  where g.client_id = _client_id and g.date between _von and _bis
  group by g.page, g.date
  order by g.page, g.date;
end;
$$;

-- ── Seite ueber den Zeitraum (Zitate-Abgleich) ──────────────────────────────
create or replace function public.kpi_seiten_zeitraum(_client_id uuid, _von date, _bis date)
returns table (page text, impressions bigint, clicks bigint, pos numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select g.page,
         sum(g.impressions)::bigint,
         sum(g.clicks)::bigint,
         case when sum(g.impressions) > 0
              then round(sum(g.position * g.impressions)::numeric / sum(g.impressions), 2)
              else null end
  from public.gsc_daily g
  where g.client_id = _client_id and g.date between _von and _bis
  group by g.page
  order by 2 desc, 3 desc;
end;
$$;

-- ── Brand vs. Nonbrand je ISO-Woche (Montag) ────────────────────────────────
-- brand = Query enthaelt irgendeinen Begriff (ILIKE '%begriff%'); leere Begriffe
-- werden ignoriert. Ohne Begriffe ist alles nonbrand.
create or replace function public.kpi_brand_wochen(
  _client_id uuid, _von date, _bis date, _begriffe text[] default '{}')
returns table (
  woche_ab date, brand_impressions bigint, brand_clicks bigint,
  nonbrand_impressions bigint, nonbrand_clicks bigint)
language plpgsql stable security definer set search_path = public
as $$
declare begriffe text[] := (
  select coalesce(array_agg(b), '{}') from unnest(coalesce(_begriffe, '{}')) as b
  where btrim(b) <> '');
begin
  if not public.first_party_zugriff(_client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with z as (
    select date_trunc('week', g.date)::date as woche,
           g.query ilike any (
             select '%' || replace(replace(b, '%', '\%'), '_', '\_') || '%'
             from unnest(begriffe) as b) as ist_brand,
           g.impressions, g.clicks
    from public.gsc_daily g
    where g.client_id = _client_id and g.date between _von and _bis
  )
  select z.woche,
         coalesce(sum(z.impressions) filter (where z.ist_brand), 0)::bigint,
         coalesce(sum(z.clicks) filter (where z.ist_brand), 0)::bigint,
         coalesce(sum(z.impressions) filter (where not coalesce(z.ist_brand, false)), 0)::bigint,
         coalesce(sum(z.clicks) filter (where not coalesce(z.ist_brand, false)), 0)::bigint
  from z
  group by z.woche
  order by z.woche;
end;
$$;

grant execute on function public.kpi_ki_referrals(uuid, date, date) to authenticated, service_role;
grant execute on function public.kpi_seiten_tage(uuid, date, date) to authenticated, service_role;
grant execute on function public.kpi_seiten_zeitraum(uuid, date, date) to authenticated, service_role;
grant execute on function public.kpi_brand_wochen(uuid, date, date, text[]) to authenticated, service_role;

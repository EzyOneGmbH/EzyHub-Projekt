-- ============================================================================
-- Sortierung Blog-Register (User-Wunsch 23.07.): neuester Artikel IMMER oben.
-- Bisher: erst Dringlichkeits-Gruppen (tech_fix..), darin age_days desc
-- (aelteste zuerst). Neu: rein nach Publikationsdatum absteigend. Der Filter
-- "Nur handlungsbeduerftig" uebernimmt die Dringlichkeits-Sicht; die
-- Agenten-Read-Bridge (/api/admin/content-decision) sortiert weiter nach
-- Dringlichkeit (eigene ORDER-Map, unveraendert).
-- ============================================================================
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
    order by published_at desc nulls last, title asc;
end $$;

revoke all on function public.get_content_dashboard(uuid) from anon;
grant execute on function public.get_content_dashboard(uuid) to authenticated;

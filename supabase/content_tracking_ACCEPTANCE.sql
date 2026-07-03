-- ============================================================================
-- ACCEPTANCE / CROSS-TENANT-TEST — OPTION A (content_items + content_metrics)
-- MANUELL ausführen (keine Migration). Reihenfolge: erst
-- 20260703120000_content_tracking.sql anwenden, dann dies. In STAGING/Preview.
-- Der Cross-Tenant-Test ist der DONE-Gate (§9).
-- ============================================================================

-- ── 1) SEED: Test-Org + 2 Clients + Artikel (Decay / Striking / Thin) --------
do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_decay uuid; v_strike uuid; v_thin uuid; d int;
begin
  insert into public.organizations(name,slug,created_by)
    values('TEST Content Org','test-content-org',gen_random_uuid()) returning id into v_org;
  insert into public.clients(organization_id,name,created_by)
    values(v_org,'Client A',gen_random_uuid()) returning id into v_a;
  insert into public.clients(organization_id,name,created_by)
    values(v_org,'Client B',gen_random_uuid()) returning id into v_b;

  insert into public.content_items(client_id,title,status,language,created_by,target_url,primary_keyword,published_at)
    values(v_a,'Decay Artikel','published','de',gen_random_uuid(),'https://a.example/decay','decay kw',current_date-120) returning id into v_decay;
  insert into public.content_items(client_id,title,status,language,created_by,target_url,primary_keyword,published_at)
    values(v_a,'Striking Artikel','published','de',gen_random_uuid(),'https://a.example/striking','striking kw',current_date-100) returning id into v_strike;
  insert into public.content_items(client_id,title,status,language,created_by,target_url,primary_keyword,published_at)
    values(v_b,'Thin Artikel','published','de',gen_random_uuid(),'https://b.example/thin','thin kw',current_date-100) returning id into v_thin;

  for d in 0..59 loop
    insert into public.content_metrics(content_item_id,captured_on,position,impressions,clicks)
      values(v_decay,current_date-d,14,400,case when d>40 then 25 else 3 end);   -- Peak früher -> Decay
    insert into public.content_metrics(content_item_id,captured_on,position,impressions,clicks)
      values(v_strike,current_date-d,14,300,4);                                   -- Pos 14 -> push_expand
    insert into public.content_metrics(content_item_id,captured_on,position,impressions,clicks)
      values(v_thin,current_date-d,8,2,0);                                        -- <100 Impr -> insufficient_data
  end loop;
end $$;

-- ── 2) VIEW-VERIFIKATION (als service_role / SQL-Editor) ---------------------
-- Erwartung: Decay->'refresh_decay', Striking->'push_expand', Thin->'insufficient_data'
select title, gate, trend, recommendation, position_28, clicks_28, impr_28, peak_clicks_28
from public.content_decision order by title;

-- ── 3) CROSS-TENANT-TEST (harter Gate, §9) ----------------------------------
-- Die RPC ist SECURITY DEFINER + can_access_client-Gate. Als User OHNE Zugriff
-- auf Client B (kein app_users-Eintrag in dessen Org) MUSS sie 0 Zeilen liefern:
--   -- JWT simulieren:
--   select set_config('request.jwt.claims',
--     json_build_object('sub','<user_ohne_zugriff_uuid>','role','authenticated')::text, true);
--   select count(*) from public.get_content_dashboard('<Client_B_id>');   -- erwartet 0
--   -- Ein app_users-Mitglied der Org von A:
--   select count(*) from public.get_content_dashboard('<Client_A_id>');   -- erwartet > 0
-- Zusatz: direkter select auf die View ist für authenticated REVOKED -> Zugriff nur via RPC.

-- ── 4) IDEMPOTENZ ------------------------------------------------------------
-- Upsert zweimal für denselben captured_on -> kein Duplikat (PK content_item_id,captured_on).

-- ── CLEANUP ------------------------------------------------------------------
-- delete from public.organizations where slug='test-content-org';  -- CASCADE

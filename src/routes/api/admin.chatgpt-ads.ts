import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { encryptSecret, decryptSecret } from "@/server/secretbox.server";

// ChatGPT-Ads-Management (Spec 31.08.2026, «EzyAI ChatGPT Ads Modul») —
// Kampagnen-Verwaltung via OpenAI Advertiser API (api.ads.openai.com/v1).
//
// ABWEICHUNGEN ZUR SPEC (bewusst, Muster bestehendes openai-ads-Modul):
// - Sync/Write-back laufen HIER (Server-Route) statt in n8n: die Account-Keys
//   liegen Secretbox-verschluesselt in der App-DB (api_key_enc) — kein
//   Credential-Handling in n8n; n8n/agent-service triggern nur den Sync-
//   Endpoint (Bearer ADMIN_AUTOMATION_SECRET, action "sync-all").
// - RLS service-role-only (keine Policies) wie openai_ads_events; die
//   Kunden-Sichtbarkeit prueft diese Route selbst (RLS-Probe auf clients).
// - API-Realitaet statt Spec-Doku: Basis api.ads.openai.com/v1, Feld heisst
//   `status` (active|paused|archived), State-Wechsel via POST /{id}/pause
//   bzw. /activate, Budget in *_spend_limit_micros, Konto-Wahl via Header
//   OpenAI-Ad-Account, Insights via /ad_account/insights (aggregation_level).
//
// MOCK-MODUS (CH-Freischaltung ausstehend): action "connect" mit apiKey
// "mock" legt ein Demo-Konto mit deterministischen Kampagnen/Insights an
// (is_mock=true) — UI/Flows sind damit End-to-End testbar; Commands aendern
// im Mock nur die DB. Nach Freischaltung: echtes Konto verbinden, fertig.
//
// AUSBAU 01.09.2026 (API-Neuerungen, Doku developers.openai.com/ads geprüft):
// - Geo-Targeting: GET /geo_lookup/search?q= liefert Locations (country/
//   region/dma); Kampagne trägt targeting.locations.include[{id}]. Namen
//   führen wir in chatgpt_ads_campaigns.targeting_locations mit (API gibt
//   nur IDs zurück).
// - Bulk API: POST /bulk_mutation_jobs (bis 1000 Operationen, asynchron,
//   Polling GET /bulk_mutation_jobs/{id}); Fallback auf Einzel-Calls, falls
//   der Endpoint für das Konto nicht freigeschaltet ist (404/501).
// - Custom Audiences: POST /uploads (multipart, purpose=custom_audience) →
//   file_id → POST /custom_audiences; Zuweisung via targeting.custom_audiences
//   / excluded_custom_audiences. Identifikatoren werden IM BROWSER SHA-256-
//   gehasht (identifier_type email_sha256) — der Server sieht nie Klartext.
//
// GET  ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
//      -> { ok, connected, account, campaigns, insights, commands, audiences }
// POST { action: "connect" | "sync" | "sync-all" | "command" | "bulk" |
//        "geo-search" | "audience-create" | "audience-sync" | "audience-archive" }
//      connect (owner/admin): { clientId, apiKey, adAccountId? }
//      sync    (owner/admin): { clientId }
//      command (owner/admin): { clientId, cmd: "pause"|"activate"|"set_budget"|
//                               "set_targeting"|"set_audiences", targetType: "campaign",
//                               targetId, budgetDailyMicros?, locations?, includeIds?, excludeIds? }
//      bulk    (owner/admin): { clientId, cmd: "pause"|"activate", targetIds: string[] }
//      geo-search (owner/admin): { clientId, q } -> { locations }
//      audience-create (owner/admin): { clientId, name, description?, identifierType, hashes: string[] }
//      audience-sync / audience-archive (owner/admin): { clientId, audienceId? }
//      sync-all (nur Admin-Secret): alle aktiven Konten sequenziell.

const ADS_API = "https://api.ads.openai.com/v1";

async function adsFetch(
  apiKey: string,
  adAccountId: string | null,
  path: string,
  opts: { method?: string; body?: any; query?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; json: any }> {
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  // 429 → exponentielles Retry (Spec §2.5: 600/min pro Endpoint — Sync ist
  // seriell, trotzdem defensiv), 3 Versuche.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${ADS_API}${path}${qs}`, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(adAccountId ? { "OpenAI-Ad-Account": adAccountId } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 429 && attempt < 3) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json };
  }
}

// Paginierte Liste vollstaendig einsammeln (data[] + has_more/last_id).
async function adsListAll(
  apiKey: string,
  adAccountId: string,
  path: string,
  query: Record<string, string> = {},
  maxPages = 20,
): Promise<any[]> {
  const out: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const q: Record<string, string> = { limit: "100", ...query };
    if (after) q.after = after;
    const r = await adsFetch(apiKey, adAccountId, path, { query: q });
    if (!r.ok)
      throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
    const data: any[] = r.json?.data || [];
    out.push(...data);
    if (!r.json?.has_more || !data.length) break;
    after = r.json?.last_id || data[data.length - 1]?.id;
    if (!after) break;
  }
  return out;
}

// Multipart-Upload (Custom-Audience-Datei): kein JSON-Content-Type, der
// Browser-/undici-FormData setzt die Boundary selbst.
async function adsUpload(
  apiKey: string,
  adAccountId: string,
  content: string,
  filename: string,
  purpose: string,
): Promise<{ ok: boolean; status: number; json: any }> {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), filename);
  fd.append("purpose", purpose);
  const r = await fetch(`${ADS_API}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Ad-Account": adAccountId },
    body: fd,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

type GeoLocation = { id: string; name: string; type?: string; country_code?: string };

// Demo-Locations für den Mock-Modus (IDs frei gewählt, nur DB-relevant).
const MOCK_GEO: GeoLocation[] = [
  { id: "geo_ch", name: "Schweiz", type: "country", country_code: "CH" },
  { id: "geo_de", name: "Deutschland", type: "country", country_code: "DE" },
  { id: "geo_at", name: "Österreich", type: "country", country_code: "AT" },
  { id: "geo_li", name: "Liechtenstein", type: "country", country_code: "LI" },
  { id: "geo_fr", name: "Frankreich", type: "country", country_code: "FR" },
  { id: "geo_it", name: "Italien", type: "country", country_code: "IT" },
  { id: "geo_ch_zh", name: "Zürich", type: "region", country_code: "CH" },
  { id: "geo_ch_be", name: "Bern", type: "region", country_code: "CH" },
  { id: "geo_ch_bs", name: "Basel-Stadt", type: "region", country_code: "CH" },
  { id: "geo_ch_ge", name: "Genf", type: "region", country_code: "CH" },
  { id: "geo_ch_vd", name: "Waadt", type: "region", country_code: "CH" },
  { id: "geo_ch_ag", name: "Aargau", type: "region", country_code: "CH" },
  { id: "geo_ch_lu", name: "Luzern", type: "region", country_code: "CH" },
  { id: "geo_ch_sg", name: "St. Gallen", type: "region", country_code: "CH" },
  { id: "geo_ch_ti", name: "Tessin", type: "region", country_code: "CH" },
];

// Locations aus dem API-Kampagnenobjekt. Live-Befund (Ezy-One-Konto, 01.09.):
// die API liefert im include[] VOLLSTÄNDIGE Objekte ({id, name, type,
// country_code, region_code}) — die nehmen wir direkt; nur bei reinen IDs
// greifen wir auf die bei uns gespeicherten Namen zurück (Fallback: ID).
function locationsFromApi(c: any, prev: GeoLocation[] | null): GeoLocation[] {
  const known = new Map((prev || []).map((p) => [String(p.id), p]));
  return (c?.targeting?.locations?.include || []).map((x: any) => {
    const id = String(x?.id ?? x);
    if (x && typeof x === "object" && x.name)
      return {
        id,
        name: String(x.name),
        type: x.type ? String(x.type) : undefined,
        country_code: x.country_code ? String(x.country_code) : undefined,
      };
    return known.get(id) || { id, name: id };
  });
}

// Kampagne aus API-Objekt in die DB schreiben (Sync + Re-Sync nach Commands).
async function upsertCampaignFromApi(
  sb: any,
  accountId: string,
  c: any,
  prevLocations: GeoLocation[] | null,
) {
  await sb.from("chatgpt_ads_campaigns").upsert(
    {
      account_id: accountId,
      openai_campaign_id: String(c.id),
      name: String(c.name || ""),
      status: String(c.status || ""),
      bidding_type: c.bidding_type ?? null,
      objective: c.objective ?? null,
      budget_daily_micros: micros(c.budget?.daily_spend_limit_micros),
      budget_lifetime_micros: micros(c.budget?.lifetime_spend_limit_micros),
      start_time: tsToIso(c.start_time),
      end_time: tsToIso(c.end_time),
      targeting_locations: locationsFromApi(c, prevLocations),
      raw: c,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "account_id,openai_campaign_id" },
  );
}

// Custom Audiences des Kontos einsammeln (Status-Refresh). Nicht-fatal: das
// Feature kann für ein Konto noch nicht freigeschaltet sein.
async function syncAudiences(sb: any, acc: any, apiKey: string): Promise<number> {
  const list = await adsListAll(apiKey, acc.openai_ad_account_id, "/custom_audiences").catch(
    () => [] as any[],
  );
  for (const a of list) {
    await sb.from("chatgpt_ads_audiences").upsert(
      {
        account_id: acc.id,
        openai_audience_id: String(a.id),
        name: String(a.name || ""),
        description: a.description ?? null,
        status: String(a.status || "processing"),
        matched_user_count_range: a.matched_user_count_range ?? null,
        membership_revision: a.membership_revision ?? null,
        raw: a,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,openai_audience_id" },
    );
  }
  return list.length;
}

const micros = (v: any): number | null => (v == null ? null : Number(v));
const tsToIso = (v: any): string | null =>
  v == null ? null : new Date(Number(v) * 1000).toISOString();

// ── Entity-Sync (WF-1 der Spec, hier serverseitig) ───────────────────────────
async function syncAccount(sb: any, acc: any): Promise<any> {
  if (acc.is_mock) return mockSync(sb, acc);
  const apiKey = decryptSecret(acc.api_key_enc);
  const campaigns = await adsListAll(apiKey, acc.openai_ad_account_id, "/campaigns");
  // Bekannte Location-Namen je Kampagne mitführen (API liefert nur IDs).
  const { data: prevRows } = await sb
    .from("chatgpt_ads_campaigns")
    .select("openai_campaign_id, targeting_locations")
    .eq("account_id", acc.id);
  const prevLoc = new Map<string, GeoLocation[] | null>(
    (prevRows || []).map((r: any) => [String(r.openai_campaign_id), r.targeting_locations]),
  );
  for (const c of campaigns) {
    await upsertCampaignFromApi(sb, acc.id, c, prevLoc.get(String(c.id)) ?? null);
  }
  const audiences = await syncAudiences(sb, acc, apiKey);
  // Ad Groups + Ads je Kampagne (Filter-Params gem. OpenAPI-Spec).
  const { data: dbCamps } = await sb
    .from("chatgpt_ads_campaigns")
    .select("id, openai_campaign_id")
    .eq("account_id", acc.id);
  let adGroups = 0;
  let ads = 0;
  for (const dc of dbCamps || []) {
    const groups = await adsListAll(apiKey, acc.openai_ad_account_id, "/ad_groups", {
      campaign_id: dc.openai_campaign_id,
    });
    for (const g of groups) {
      adGroups++;
      const { data: gRow } = await sb
        .from("chatgpt_ads_ad_groups")
        .upsert(
          {
            account_id: acc.id,
            campaign_id: dc.id,
            openai_ad_group_id: String(g.id),
            name: String(g.name || ""),
            status: String(g.status || ""),
            raw: g,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "account_id,openai_ad_group_id" },
        )
        .select("id")
        .single();
      const adList = await adsListAll(apiKey, acc.openai_ad_account_id, "/ads", {
        ad_group_id: String(g.id),
      });
      for (const a of adList) {
        ads++;
        await sb.from("chatgpt_ads_ads").upsert(
          {
            account_id: acc.id,
            ad_group_id: gRow?.id ?? null,
            openai_ad_id: String(a.id),
            name: a.name ?? null,
            status: String(a.status || ""),
            review_status: a.review_status ?? null,
            raw: a,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "account_id,openai_ad_id" },
        );
      }
    }
  }
  // Insights (WF-2): letzte 14 Tage taeglich auf Kampagnen-Ebene — deckt den
  // Attribution-Nachlauf grosszuegig ab; unique-Constraint macht es idempotent.
  const since = new Date(Date.now() - 14 * 864e5);
  const ins = await adsFetch(apiKey, acc.openai_ad_account_id, "/ad_account/insights", {
    query: {
      time_granularity: "daily",
      aggregation_level: "campaign",
      limit: "2000",
      "time_ranges[]": `${since.toISOString().slice(0, 10)}..${new Date().toISOString().slice(0, 10)}`,
    },
  });
  let insightRows = 0;
  if (ins.ok) {
    for (const row of ins.json?.data || []) {
      const day = row.readable_time?.slice(0, 10) || tsToIso(row.start_time)?.slice(0, 10);
      const campId = row.campaign_id || row.id;
      if (!day || !campId) continue;
      insightRows++;
      await sb.from("chatgpt_ads_insights_daily").upsert(
        {
          account_id: acc.id,
          scope: "campaign",
          scope_openai_id: String(campId),
          date: day,
          impressions: Number(row.campaign_impressions ?? row.impressions ?? 0),
          clicks: Number(row.campaign_clicks ?? row.clicks ?? 0),
          spend: Number(row.campaign_spend ?? row.spend ?? 0),
          conversions: row.conversions != null ? Number(row.conversions) : null,
        },
        { onConflict: "account_id,scope,scope_openai_id,date" },
      );
    }
  }
  await sb
    .from("chatgpt_ads_accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", acc.id);
  return { campaigns: campaigns.length, adGroups, ads, insightRows, audiences };
}

// ── Mock-Sync: deterministische Demo-Daten fuer UI/E2E bis zur Freischaltung ─
async function mockSync(sb: any, acc: any): Promise<any> {
  const CAMPS = [
    { id: "cmp_mock_brand", name: "Brand Awareness CH", bidding: "cpm", daily: 50_000_000 },
    { id: "cmp_mock_leads", name: "Lead-Gen Beratung", bidding: "conversions", daily: 80_000_000 },
    { id: "cmp_mock_promo", name: "Herbst-Promo", bidding: "cpc", daily: 30_000_000 },
  ];
  for (const [i, c] of CAMPS.entries()) {
    await sb.from("chatgpt_ads_campaigns").upsert(
      {
        account_id: acc.id,
        openai_campaign_id: c.id,
        name: c.name,
        status: i === 2 ? "paused" : "active",
        bidding_type: c.bidding,
        objective: "traffic",
        budget_daily_micros: c.daily,
        // Demo: Brand-Kampagne auf die Schweiz ausgerichtet, Rest weltweit.
        targeting_locations: i === 0 ? [MOCK_GEO[0]] : [],
        raw: {
          id: c.id,
          mock: true,
          targeting: i === 0 ? { locations: { include: [{ id: MOCK_GEO[0].id }] } } : {},
        },
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,openai_campaign_id", ignoreDuplicates: true },
    );
  }
  // 30 Tage deterministische Insights je Kampagne (Seed = Tagesindex).
  let insightRows = 0;
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    for (const [i, c] of CAMPS.entries()) {
      if (i === 2 && d < 5) continue; // pausierte Kampagne: zuletzt ohne Daten
      const base = 400 + ((d * 37 + i * 91) % 350);
      const clicks = Math.round(base * (0.02 + (i % 3) * 0.01));
      insightRows++;
      await sb.from("chatgpt_ads_insights_daily").upsert(
        {
          account_id: acc.id,
          scope: "campaign",
          scope_openai_id: c.id,
          date: day,
          impressions: base * 10,
          clicks,
          spend: Math.round(base * 0.9) / 10,
          conversions: i === 1 ? Math.max(0, Math.round(clicks * 0.08)) : null,
        },
        { onConflict: "account_id,scope,scope_openai_id,date" },
      );
    }
  }
  await sb
    .from("chatgpt_ads_accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", acc.id);
  return { campaigns: CAMPS.length, adGroups: 0, ads: 0, insightRows, mock: true };
}

// ── Command-Ausfuehrung (WF-3): Audit-Zeile + API-Call + Re-Sync ─────────────
async function runCommand(
  sb: any,
  acc: any,
  cmd: string,
  targetId: string,
  payload: any,
  actorUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await sb
    .from("chatgpt_ads_commands")
    .insert({
      account_id: acc.id,
      actor_user_id: actorUserId,
      action: cmd,
      target_type: "campaign",
      target_openai_id: targetId,
      payload: payload ?? null,
    })
    .select("id")
    .single();
  const finish = async (ok: boolean, error?: string) => {
    await sb
      .from("chatgpt_ads_commands")
      .update({
        status: ok ? "success" : "failed",
        error: error ?? null,
        executed_at: new Date().toISOString(),
      })
      .eq("id", row?.id);
    return ok ? { ok: true as const } : { ok: false as const, error };
  };

  // Targeting-Payloads normalisieren (Locations mit Namen, Audience-IDs).
  const locations: GeoLocation[] = Array.isArray(payload?.locations)
    ? payload.locations
        .filter((l: any) => l && l.id)
        .map((l: any) => ({
          id: String(l.id),
          name: String(l.name || l.id),
          type: l.type ? String(l.type) : undefined,
          country_code: l.country_code ? String(l.country_code) : undefined,
        }))
    : [];
  const idList = (v: any): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  const includeIds = idList(payload?.includeIds);
  const excludeIds = idList(payload?.excludeIds).filter((id) => !includeIds.includes(id));

  if (acc.is_mock) {
    // Mock: nur DB-Status/Budget/Targeting aendern — kein API-Call.
    const { data: cur } = await sb
      .from("chatgpt_ads_campaigns")
      .select("raw")
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", targetId)
      .maybeSingle();
    const raw = { ...(cur?.raw || {}) };
    const targeting = { ...(raw.targeting || {}) };
    let upd: any;
    if (cmd === "set_budget") {
      upd = { budget_daily_micros: Number(payload?.budgetDailyMicros || 0) || null };
    } else if (cmd === "set_targeting") {
      targeting.locations = { include: locations.map((l) => ({ id: l.id })) };
      upd = { targeting_locations: locations, raw: { ...raw, targeting } };
    } else if (cmd === "set_audiences") {
      targeting.custom_audiences = { ids: includeIds };
      targeting.excluded_custom_audiences = { ids: excludeIds };
      upd = { raw: { ...raw, targeting } };
    } else {
      upd = { status: cmd === "pause" ? "paused" : "active" };
    }
    await sb
      .from("chatgpt_ads_campaigns")
      .update({ ...upd, synced_at: new Date().toISOString() })
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", targetId);
    return finish(true);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(acc.api_key_enc);
  } catch (e: any) {
    return finish(false, `Key nicht lesbar: ${String(e?.message || e)}`);
  }
  let r: { ok: boolean; status: number; json: any };
  if (cmd === "pause" || cmd === "activate") {
    r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}/${cmd}`, {
      method: "POST",
    });
  } else if (cmd === "set_budget") {
    const daily = Number(payload?.budgetDailyMicros || 0);
    if (!daily) return finish(false, "budgetDailyMicros erforderlich");
    r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`, {
      method: "POST",
      body: { budget: { daily_spend_limit_micros: daily } },
    });
  } else if (cmd === "set_targeting" || cmd === "set_audiences") {
    // Bestehendes targeting-Objekt holen und nur den betroffenen Teil
    // ersetzen — sonst würde ein Locations-Update die Audiences löschen.
    const g0 = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`);
    if (!g0.ok) return finish(false, `Kampagne nicht lesbar (HTTP ${g0.status})`);
    const targeting = { ...(g0.json?.targeting || {}) };
    if (cmd === "set_targeting") {
      targeting.locations = { include: locations.map((l) => ({ id: l.id })) };
    } else {
      targeting.custom_audiences = { ids: includeIds };
      targeting.excluded_custom_audiences = { ids: excludeIds };
    }
    r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`, {
      method: "POST",
      body: { targeting },
    });
  } else {
    return finish(false, `Unbekanntes Kommando: ${cmd}`);
  }
  if (!r.ok) return finish(false, `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  // Betroffenes Objekt sofort re-syncen (kein Fire-and-Forget, Spec §4 WF-3).
  const g = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`);
  if (g.ok && g.json?.id) {
    // Namen der eben gesetzten Locations behalten (API liefert nur IDs).
    const { data: prev } = await sb
      .from("chatgpt_ads_campaigns")
      .select("targeting_locations")
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", targetId)
      .maybeSingle();
    const prevLoc = cmd === "set_targeting" ? locations : prev?.targeting_locations || null;
    await upsertCampaignFromApi(sb, acc.id, g.json, prevLoc);
  }
  return finish(true);
}

// ── Bulk (Bulk API): viele Kampagnen auf einmal pausieren/aktivieren ─────────
async function runBulk(
  sb: any,
  acc: any,
  cmd: "pause" | "activate",
  targetIds: string[],
  actorUserId: string | null,
): Promise<{ ok: boolean; error?: string; done: number; failed: string[] }> {
  const status = cmd === "pause" ? "paused" : "active";
  const { data: row } = await sb
    .from("chatgpt_ads_commands")
    .insert({
      account_id: acc.id,
      actor_user_id: actorUserId,
      action: `bulk_${cmd}`,
      target_type: "campaign",
      target_openai_id: `${targetIds.length} Kampagnen`,
      payload: { targetIds },
    })
    .select("id")
    .single();
  const finish = async (ok: boolean, done: number, failed: string[], error?: string) => {
    await sb
      .from("chatgpt_ads_commands")
      .update({
        status: ok ? "success" : "failed",
        error: error ?? (failed.length ? `${failed.length} fehlgeschlagen` : null),
        payload: { targetIds, done, failed },
        executed_at: new Date().toISOString(),
      })
      .eq("id", row?.id);
    return { ok, error, done, failed };
  };

  if (acc.is_mock) {
    await sb
      .from("chatgpt_ads_campaigns")
      .update({ status, synced_at: new Date().toISOString() })
      .eq("account_id", acc.id)
      .in("openai_campaign_id", targetIds);
    return finish(true, targetIds.length, []);
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(acc.api_key_enc);
  } catch (e: any) {
    return finish(false, 0, targetIds, `Key nicht lesbar: ${String(e?.message || e)}`);
  }
  const failed: string[] = [];
  let done = 0;
  const job = await adsFetch(apiKey, acc.openai_ad_account_id, "/bulk_mutation_jobs", {
    method: "POST",
    body: {
      partial_failure: true,
      operations: targetIds.map((id, i) => ({
        operation_id: `op-${i}-${id}`,
        type: "campaign.update",
        target_resource_id: id,
        input: { status },
      })),
    },
  });
  if (job.ok && job.json?.id) {
    // Asynchron: Job-Status pollen (max. ~40 s), dann Operationen auswerten.
    let st = String(job.json.status || "pending");
    for (let i = 0; i < 20 && (st === "pending" || st === "in_progress"); i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const g = await adsFetch(
        apiKey,
        acc.openai_ad_account_id,
        `/bulk_mutation_jobs/${job.json.id}`,
      );
      st = String(g.json?.status || st);
    }
    const ops = await adsFetch(
      apiKey,
      acc.openai_ad_account_id,
      `/bulk_mutation_jobs/${job.json.id}/operations`,
      { query: { limit: "1000" } },
    );
    for (const op of ops.json?.data || []) {
      const id = String(op.target_resource_id || op.resource_id || "");
      if (op.status === "failed") failed.push(id || op.operation_id);
      else done++;
    }
    if (st === "pending" || st === "in_progress")
      return finish(false, done, failed, "Bulk-Job noch nicht abgeschlossen — später syncen");
  } else if (job.status === 404 || job.status === 501 || job.status === 403) {
    // Bulk API für dieses Konto (noch) nicht verfügbar → sequenziell.
    for (const id of targetIds) {
      const r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${id}/${cmd}`, {
        method: "POST",
      });
      if (r.ok) done++;
      else failed.push(id);
    }
  } else {
    return finish(
      false,
      0,
      targetIds,
      `HTTP ${job.status}: ${JSON.stringify(job.json)?.slice(0, 200)}`,
    );
  }
  // Re-Sync der betroffenen Kampagnen.
  const { data: prevRows } = await sb
    .from("chatgpt_ads_campaigns")
    .select("openai_campaign_id, targeting_locations")
    .eq("account_id", acc.id)
    .in("openai_campaign_id", targetIds);
  const prevLoc = new Map<string, GeoLocation[] | null>(
    (prevRows || []).map((r: any) => [String(r.openai_campaign_id), r.targeting_locations]),
  );
  for (const id of targetIds) {
    const g = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${id}`);
    if (g.ok && g.json?.id)
      await upsertCampaignFromApi(sb, acc.id, g.json, prevLoc.get(id) ?? null);
  }
  return finish(failed.length === 0, done, failed);
}

// ── Custom Audiences ─────────────────────────────────────────────────────────
const AUDIENCE_ID_TYPES = ["email_sha256", "phone_number_sha256"];

// Grössenklasse wie die API sie liefert — im Mock aus unserer Zählung.
const mockRange = (n: number) =>
  n < 25_000 ? "under_25k" : n < 100_000 ? "25k_100k" : n < 500_000 ? "100k_500k" : "500k_1m";

async function createAudience(
  sb: any,
  acc: any,
  input: { name: string; description: string; identifierType: string; hashes: string[] },
): Promise<{ ok: boolean; error?: string; audience?: any }> {
  const now = new Date().toISOString();
  if (acc.is_mock) {
    const id = `caud_mock_${Date.now().toString(36)}`;
    const { data } = await sb
      .from("chatgpt_ads_audiences")
      .insert({
        account_id: acc.id,
        openai_audience_id: id,
        name: input.name,
        description: input.description || null,
        status: "ready",
        identifier_type: input.identifierType,
        matched_user_count_range: mockRange(input.hashes.length),
        membership_revision: 1,
        identifier_count: input.hashes.length,
        raw: { id, mock: true },
        synced_at: now,
      })
      .select("*")
      .single();
    return { ok: true, audience: data };
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(acc.api_key_enc);
  } catch (e: any) {
    return { ok: false, error: `Key nicht lesbar: ${String(e?.message || e)}` };
  }
  // CSV mit Spaltenkopf = identifier_type (Doku: email_sha256 / phone_number_sha256).
  const csv = `${input.identifierType}\n${input.hashes.join("\n")}\n`;
  const filename = `audience-${Date.now()}.csv`;
  const up = await adsUpload(apiKey, acc.openai_ad_account_id, csv, filename, "custom_audience");
  const fileId = up.json?.file_id || up.json?.id;
  if (!up.ok || !fileId) return { ok: false, error: `Upload fehlgeschlagen (HTTP ${up.status})` };
  const cr = await adsFetch(apiKey, acc.openai_ad_account_id, "/custom_audiences", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description || undefined,
      file_id: fileId,
      identifier_type: input.identifierType,
      filename,
      mimetype: "text/csv",
      file_size: Buffer.byteLength(csv, "utf8"),
    },
  });
  if (!cr.ok || !cr.json?.id)
    return {
      ok: false,
      error: `Audience nicht erstellt (HTTP ${cr.status}): ${JSON.stringify(cr.json)?.slice(0, 160)}`,
    };
  const a = cr.json;
  const { data } = await sb
    .from("chatgpt_ads_audiences")
    .upsert(
      {
        account_id: acc.id,
        openai_audience_id: String(a.id),
        name: String(a.name || input.name),
        description: a.description ?? input.description ?? null,
        status: String(a.status || "upload_pending"),
        identifier_type: input.identifierType,
        matched_user_count_range: a.matched_user_count_range ?? null,
        membership_revision: a.membership_revision ?? null,
        identifier_count: input.hashes.length,
        raw: a,
        synced_at: now,
      },
      { onConflict: "account_id,openai_audience_id" },
    )
    .select("*")
    .single();
  return { ok: true, audience: data };
}

async function archiveAudience(
  sb: any,
  acc: any,
  audienceId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!acc.is_mock) {
    let apiKey: string;
    try {
      apiKey = decryptSecret(acc.api_key_enc);
    } catch (e: any) {
      return { ok: false, error: `Key nicht lesbar: ${String(e?.message || e)}` };
    }
    const r = await adsFetch(
      apiKey,
      acc.openai_ad_account_id,
      `/custom_audiences/${audienceId}/archive`,
      { method: "POST" },
    );
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  }
  await sb
    .from("chatgpt_ads_audiences")
    .update({ status: "archived", synced_at: new Date().toISOString() })
    .eq("account_id", acc.id)
    .eq("openai_audience_id", audienceId);
  return { ok: true };
}

async function requireUser(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

const isDayStr = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const Route = createFileRoute("/api/admin/chatgpt-ads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const { data: client } = await (auth.userClient ?? (supabaseAdmin as any))
          .from("clients")
          .select("id, name")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const sb = supabaseAdmin as any;
        const { data: acc } = await sb
          .from("chatgpt_ads_accounts")
          .select(
            "id, openai_ad_account_id, name, currency_code, status, is_mock, last_synced_at, last_sync_error",
          )
          .eq("client_id", clientId)
          .maybeSingle();
        if (!acc) return Response.json({ ok: true, connected: false });

        const qsStart = u.searchParams.get("start");
        const qsEnd = u.searchParams.get("end");
        const end = isDayStr(qsEnd) ? qsEnd : new Date().toISOString().slice(0, 10);
        const start = isDayStr(qsStart)
          ? qsStart
          : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

        const [{ data: campaigns }, { data: insights }, { data: commands }, { data: audiences }] =
          await Promise.all([
            sb
              .from("chatgpt_ads_campaigns")
              // targeting (Audience-IDs) direkt aus raw per JSON-Pfad — spart
              // das komplette raw-Objekt in der Antwort.
              .select(
                "openai_campaign_id, name, status, bidding_type, objective, budget_daily_micros, budget_lifetime_micros, synced_at, targeting_locations, targeting:raw->targeting",
              )
              .eq("account_id", acc.id)
              .neq("status", "archived")
              .order("name"),
            sb
              .from("chatgpt_ads_insights_daily")
              .select("scope_openai_id, date, impressions, clicks, spend, conversions")
              .eq("account_id", acc.id)
              .eq("scope", "campaign")
              .gte("date", start)
              .lte("date", end)
              .order("date"),
            sb
              .from("chatgpt_ads_commands")
              .select("action, target_openai_id, status, error, created_at")
              .eq("account_id", acc.id)
              .order("created_at", { ascending: false })
              .limit(20),
            sb
              .from("chatgpt_ads_audiences")
              .select(
                "openai_audience_id, name, description, status, identifier_type, matched_user_count_range, identifier_count, created_at, synced_at",
              )
              .eq("account_id", acc.id)
              .order("created_at", { ascending: false }),
          ]);
        return Response.json({
          ok: true,
          connected: true,
          account: acc,
          campaigns: campaigns || [],
          insights: insights || [],
          commands: commands || [],
          audiences: audiences || [],
        });
      },

      POST: async ({ request }) => {
        // sync-all (Cron) laeuft mit Admin-Secret, alles andere owner/admin.
        const admin = process.env.ADMIN_AUTOMATION_SECRET;
        const rawAuth = request.headers.get("authorization") || "";
        const isAdminSecret = !!admin && rawAuth === `Bearer ${admin}`;
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Body ungültig" }, { status: 400 });
        }
        const action = String(body?.action || "");
        const sb = supabaseAdmin as any;

        if (action === "sync-all") {
          if (!isAdminSecret)
            return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          const { data: accounts } = await sb
            .from("chatgpt_ads_accounts")
            .select("*")
            .eq("status", "active");
          const results: any[] = [];
          for (const acc of accounts || []) {
            try {
              results.push({ account: acc.name, ...(await syncAccount(sb, acc)) });
            } catch (e: any) {
              const msg = String(e?.message || e).slice(0, 300);
              // 401 = Key entzogen/abgelaufen -> Konto trennen (Spec §4 WF-1).
              const upd: any = { last_sync_error: msg };
              if (/HTTP 401/.test(msg)) upd.status = "disconnected";
              await sb.from("chatgpt_ads_accounts").update(upd).eq("id", acc.id);
              results.push({ account: acc.name, error: msg });
            }
          }
          return Response.json({ ok: true, results });
        }

        const ctx = await requireTeamRole(request, "admin");
        if (ctx instanceof Response) return ctx;
        const clientId = String(body?.clientId || "");
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "clientId ungültig" }, { status: 400 });
        const { data: own } = await sb
          .from("clients")
          .select("id, name, organization_id")
          .eq("id", clientId)
          .eq("organization_id", ctx.organizationId)
          .maybeSingle();
        if (!own)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        if (action === "connect") {
          const apiKey = String(body?.apiKey || "").trim();
          if (!apiKey)
            return Response.json({ ok: false, error: "apiKey erforderlich" }, { status: 400 });
          let accountMeta: { id: string; name: string; currency: string; tz: string | null };
          let isMock = false;
          if (apiKey.toLowerCase() === "mock") {
            isMock = true;
            accountMeta = {
              id: `mock_${clientId.slice(0, 8)}`,
              name: `${own.name} (Demo)`,
              currency: "USD",
              tz: "Europe/Zurich",
            };
          } else {
            // Key gegen die echte API validieren; /ad_account liefert Metadaten.
            const probe = await adsFetch(apiKey, null, "/ad_account");
            if (!probe.ok || !probe.json?.id)
              return Response.json(
                {
                  ok: false,
                  error: `Key ungültig oder Konto nicht erreichbar (HTTP ${probe.status})`,
                },
                { status: 400 },
              );
            accountMeta = {
              id: String(probe.json.id),
              name: String(probe.json.name || own.name),
              currency: String(probe.json.currency_code || "USD"),
              tz: probe.json.timezone ?? null,
            };
          }
          const { data: acc, error } = await sb
            .from("chatgpt_ads_accounts")
            .upsert(
              {
                client_id: clientId,
                organization_id: own.organization_id,
                openai_ad_account_id: accountMeta.id,
                name: accountMeta.name,
                currency_code: accountMeta.currency,
                timezone: accountMeta.tz,
                api_key_enc: encryptSecret(apiKey),
                status: "active",
                is_mock: isMock,
              },
              { onConflict: "openai_ad_account_id" },
            )
            .select("*")
            .single();
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          const sync = await syncAccount(sb, acc).catch((e: any) => ({
            error: String(e?.message || e).slice(0, 300),
          }));
          return Response.json({ ok: true, account: accountMeta, sync });
        }

        // sync + command brauchen ein verbundenes Konto.
        const { data: acc } = await sb
          .from("chatgpt_ads_accounts")
          .select("*")
          .eq("client_id", clientId)
          .maybeSingle();
        if (!acc)
          return Response.json({ ok: false, error: "Kein Konto verbunden" }, { status: 409 });

        if (action === "sync") {
          try {
            return Response.json({ ok: true, sync: await syncAccount(sb, acc) });
          } catch (e: any) {
            const msg = String(e?.message || e).slice(0, 300);
            await sb.from("chatgpt_ads_accounts").update({ last_sync_error: msg }).eq("id", acc.id);
            return Response.json({ ok: false, error: msg }, { status: 502 });
          }
        }

        if (action === "command") {
          const cmd = String(body?.cmd || "");
          const targetId = String(body?.targetId || "");
          if (
            !["pause", "activate", "set_budget", "set_targeting", "set_audiences"].includes(cmd) ||
            !targetId
          )
            return Response.json({ ok: false, error: "cmd/targetId ungültig" }, { status: 400 });
          const res = await runCommand(
            sb,
            acc,
            cmd,
            targetId,
            {
              budgetDailyMicros: body?.budgetDailyMicros,
              locations: body?.locations,
              includeIds: body?.includeIds,
              excludeIds: body?.excludeIds,
            },
            ctx.userId ?? null,
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "bulk") {
          const cmd = String(body?.cmd || "");
          const targetIds: string[] = Array.isArray(body?.targetIds)
            ? body.targetIds
                .map((x: any) => String(x))
                .filter(Boolean)
                .slice(0, 1000)
            : [];
          if ((cmd !== "pause" && cmd !== "activate") || !targetIds.length)
            return Response.json({ ok: false, error: "cmd/targetIds ungültig" }, { status: 400 });
          const res = await runBulk(sb, acc, cmd, targetIds, ctx.userId ?? null);
          return Response.json(
            { ok: res.ok, done: res.done, failed: res.failed, error: res.error },
            { status: res.ok ? 200 : 502 },
          );
        }

        if (action === "geo-search") {
          const q = String(body?.q || "").trim();
          if (q.length < 2) return Response.json({ ok: true, locations: [] });
          if (acc.is_mock) {
            const ql = q.toLowerCase();
            return Response.json({
              ok: true,
              locations: MOCK_GEO.filter(
                (l) =>
                  l.name.toLowerCase().includes(ql) || (l.country_code || "").toLowerCase() === ql,
              ).slice(0, 8),
            });
          }
          let apiKey: string;
          try {
            apiKey = decryptSecret(acc.api_key_enc);
          } catch (e: any) {
            return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
          }
          const r = await adsFetch(apiKey, acc.openai_ad_account_id, "/geo_lookup/search", {
            query: { q, limit: "8" },
          });
          if (!r.ok)
            return Response.json({ ok: false, error: `HTTP ${r.status}` }, { status: 502 });
          const locations: GeoLocation[] = (r.json?.data || r.json?.results || []).map(
            (l: any) => ({
              id: String(l.id),
              name: String(l.canonical_name || l.name || l.id),
              type: l.type ? String(l.type) : undefined,
              country_code: l.country_code ? String(l.country_code) : undefined,
            }),
          );
          return Response.json({ ok: true, locations });
        }

        if (action === "audience-create") {
          const name = String(body?.name || "").trim();
          const description = String(body?.description || "").trim();
          const identifierType = String(body?.identifierType || "email_sha256");
          // Nur 64-stellige Hex-Hashes akzeptieren — Klartext kommt hier nie an.
          const hashes: string[] = Array.from(
            new Set(
              (Array.isArray(body?.hashes) ? body.hashes : [])
                .map((h: any) => String(h).trim().toLowerCase())
                .filter((h: string) => /^[0-9a-f]{64}$/.test(h)),
            ),
          );
          if (name.length < 3)
            return Response.json(
              { ok: false, error: "Name muss mindestens 3 Zeichen haben" },
              { status: 400 },
            );
          if (!AUDIENCE_ID_TYPES.includes(identifierType))
            return Response.json({ ok: false, error: "identifierType ungültig" }, { status: 400 });
          if (!hashes.length)
            return Response.json(
              { ok: false, error: "Keine gültigen Identifikatoren" },
              { status: 400 },
            );
          if (hashes.length > 200_000)
            return Response.json(
              { ok: false, error: "Maximal 200'000 Identifikatoren je Upload" },
              { status: 400 },
            );
          const res = await createAudience(sb, acc, { name, description, identifierType, hashes });
          return res.ok
            ? Response.json({ ok: true, audience: res.audience })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "audience-sync") {
          if (acc.is_mock) return Response.json({ ok: true, audiences: 0 });
          try {
            const n = await syncAudiences(sb, acc, decryptSecret(acc.api_key_enc));
            return Response.json({ ok: true, audiences: n });
          } catch (e: any) {
            return Response.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
          }
        }

        if (action === "audience-archive") {
          const audienceId = String(body?.audienceId || "");
          if (!audienceId)
            return Response.json({ ok: false, error: "audienceId erforderlich" }, { status: 400 });
          const res = await archiveAudience(sb, acc, audienceId);
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        return Response.json({ ok: false, error: `Unbekannte action: ${action}` }, { status: 400 });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { encryptSecret, decryptSecret } from "@/server/secretbox.server";
import { zeitraum, zeitraumAusParams } from "@/lib/date-range";

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
//
// AUSBAU 13.09.2026 (Spec v2.3.0, 78 Endpunkte — Diff gegen unsere 15 Pfade):
// - Conversions-Setup per API: /conversions/pixels, /conversions/event_settings,
//   /conversions/api_keys (CAPI-Key → openai_ads_config.api_key_enc) und
//   GET /conversions/events?pid= (Stichprobe der letzten ~15 Min mit Kanal
//   pixel_sdk|server_to_server = LIVE-Verifikation des Website-Snippets).
//   Actions: conv-setup-get, conv-pixel-create, conv-key-create,
//   conv-event-create, conv-sample. Command set_conversion_events hängt
//   Event-Settings an eine Kampagne (conversion_event_setting_ids).
// - Insights mit den neuen Metriken (cpa, post_click_cvr, order_created_roas,
//   order_created_attributed_sales; attributed_sales_count ist DEPRECATED).
// - Ad-Vorschau: POST /ads/{id}/preview → iframe-HTML (action ad-preview);
//   GET liefert die Anzeigen je Kampagne mit Creative + Review-Status.
// - Bulk API ist laut Doku «limited preview, pro Konto freigeschaltet» und
//   nicht in der Spec — der 404-Fallback auf Einzel-Calls ist der Normalfall.
// Mock: Conversions-Setup wird in chatgpt_ads_accounts.mock_state persistiert.

const ADS_API = "https://api.ads.openai.com/v1";

async function adsFetch(
  apiKey: string,
  adAccountId: string | null,
  path: string,
  opts: {
    method?: string;
    body?: any;
    query?: Record<string, string | string[]>;
    headers?: Record<string, string>;
  } = {},
): Promise<{ ok: boolean; status: number; json: any }> {
  // Array-Werte als wiederholte Parameter (time_ranges[]=…&fields[]=…).
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query || {}))
    for (const one of Array.isArray(v) ? v : [v]) sp.append(k, one);
  const qs = opts.query ? `?${sp}` : "";
  // 429 → exponentielles Retry (Spec §2.5: 600/min pro Endpoint — Sync ist
  // seriell, trotzdem defensiv), 3 Versuche.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${ADS_API}${path}${qs}`, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(adAccountId ? { "OpenAI-Ad-Account": adAccountId } : {}),
        ...(opts.headers || {}),
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
  // Konto-Metadaten (Review-Status, Integrity, URL) für die Konto-Karte (13.09.).
  const meta = await fetchAccountMeta(apiKey, acc.openai_ad_account_id);
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
  // BUGFIX 13.09. (Ezy One zeigte 0 Spend): time_ranges[] ist ein JSON-Objekt
  // ({type:"date_range",since,until,timezone}), nicht "since..until" — der
  // alte Aufruf lief auf 400 und wurde still verworfen. Und ohne fields[]
  // liefert die API NUR impressions; clicks/spend/conversions müssen explizit
  // angefordert werden. Fehler landen jetzt sichtbar in insightsError.
  // 31 Tage (15.09.: Dashboard-Trend 30T wie im Ads Manager; ein Call, limit 2000).
  const since = new Date(Date.now() - 31 * 864e5);
  const timeRange = JSON.stringify({
    type: "date_range",
    since: since.toISOString().slice(0, 10),
    until: new Date().toISOString().slice(0, 10),
    timezone: acc.timezone || "UTC",
  });
  // Alle drei Ebenen (15.09., Ads-Manager-Nachbau: Tabs Kampagnen/
  // Anzeigengruppen/Anzeigen brauchen je eigene Zeilen). Ein Call je Ebene.
  const EXTRA_FIELDS = [
    "conversions",
    "cpa",
    "post_click_cvr",
    "order_created_roas",
    "order_created_attributed_sales",
  ];
  const LEVELS: Array<{ level: string; scope: string; idKey: string }> = [
    { level: "campaign", scope: "campaign", idKey: "campaign_id" },
    { level: "ad_group", scope: "ad_group", idKey: "ad_group_id" },
    { level: "ad", scope: "ad", idKey: "ad_id" },
  ];
  let insightRows = 0;
  let insightsError: string | null = null;
  for (const L of LEVELS) {
    const core = [
      `${L.level}.id`,
      `${L.level}.name`,
      "metadata.readable_time",
      `${L.level}.impressions`,
      `${L.level}.clicks`,
      `${L.level}.spend`,
    ];
    const insightsQuery = (fields: string[]) => ({
      time_granularity: "daily",
      aggregation_level: L.level,
      limit: "2000",
      "time_ranges[]": [timeRange],
      "fields[]": fields,
    });
    let ins = await adsFetch(apiKey, acc.openai_ad_account_id, "/ad_account/insights", {
      query: insightsQuery([...core, ...EXTRA_FIELDS]),
    });
    // Falls ein Attributions-Feld für das Konto unbekannt ist (400): Kern-Felder.
    if (!ins.ok && ins.status === 400)
      ins = await adsFetch(apiKey, acc.openai_ad_account_id, "/ad_account/insights", {
        query: insightsQuery(core),
      });
    if (!ins.ok) {
      insightsError = `Insights (${L.level}) HTTP ${ins.status}: ${JSON.stringify(ins.json)?.slice(0, 200)}`;
      continue;
    }
    for (const row of ins.json?.data || []) {
      const day = row.readable_time?.slice(0, 10) || tsToIso(row.start_time)?.slice(0, 10);
      // id kodiert Zeitfenster+Entity ("start=…:end=…:entity_id=cmpn_…") —
      // <level>_id ist das saubere Feld, entity_id der Fallback.
      const entId = row[L.idKey] || String(row.id || "").match(/entity_id=([^:]+)/)?.[1] || null;
      if (!day || !entId) continue;
      insightRows++;
      await sb.from("chatgpt_ads_insights_daily").upsert(
        {
          account_id: acc.id,
          scope: L.scope,
          scope_openai_id: String(entId),
          date: day,
          impressions: Number(row[`${L.level}_impressions`] ?? row.impressions ?? 0),
          clicks: Number(row[`${L.level}_clicks`] ?? row.clicks ?? 0),
          spend: Number(row[`${L.level}_spend`] ?? row.spend ?? 0),
          conversions: row.conversions != null ? Number(row.conversions) : null,
          // Neue Attributions-Metriken (Spec v2.3.0); attributed_sales_amount
          // nur als Fallback (deprecated).
          attributed_sales: numOrNull(
            row.order_created_attributed_sales ?? row.attributed_sales_amount,
          ),
          roas: numOrNull(row.order_created_roas ?? row.roas),
          cpa: numOrNull(row.cpa),
          post_click_cvr: numOrNull(row.post_click_cvr),
        },
        { onConflict: "account_id,scope,scope_openai_id,date" },
      );
    }
    // CTC (30 T.) = Click-through-Conversions je Tag/Entity — nicht-fatal
    // (Endpoint kann für ein Konto fehlen).
    const cv = await adsFetch(apiKey, acc.openai_ad_account_id, "/conversions/insights", {
      method: "POST",
      body: {
        aggregation_level: L.level,
        time_granularity: "daily",
        // /conversions/insights erwartet unix_range (Doku-Beispiel), nicht
        // date_range wie /ad_account/insights — sonst 400 und CTC bleibt leer.
        time_ranges: [
          {
            type: "unix_range",
            start: String(Math.floor(since.getTime() / 1000)),
            end: String(Math.floor(Date.now() / 1000)),
          },
        ],
        group_by_entity: true,
      },
    });
    if (cv.ok)
      for (const row of cv.json?.data || []) {
        const day = String(row.date || "").slice(0, 10);
        const entId = row.entity_id ? String(row.entity_id) : null;
        if (!day || !entId) continue;
        await sb
          .from("chatgpt_ads_insights_daily")
          .update({ ctc: Number(row.click_through_conversions ?? row.conversions ?? 0) })
          .eq("account_id", acc.id)
          .eq("scope", L.scope)
          .eq("scope_openai_id", entId)
          .eq("date", day);
      }
  }
  await sb
    .from("chatgpt_ads_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: insightsError,
      ...(meta ? { meta } : {}),
    })
    .eq("id", acc.id);
  return { campaigns: campaigns.length, adGroups, ads, insightRows, audiences, insightsError };
}

type AccountMeta = {
  status: string | null;
  url: string | null;
  review: { status: string; reason: string | null } | null;
  integrity: { status: string; reason: string | null } | null;
  fetched_at: string;
};
async function fetchAccountMeta(apiKey: string, adAccountId: string): Promise<AccountMeta | null> {
  const r = await adsFetch(apiKey, adAccountId, "/ad_account");
  if (!r.ok || !r.json?.id) return null;
  const j = r.json;
  const rv = (x: any) =>
    x && x.status ? { status: String(x.status), reason: x.reason ? String(x.reason) : null } : null;
  return {
    status: j.status ? String(j.status) : null,
    url: j.url ? String(j.url) : null,
    review: rv(j.review),
    integrity: rv(j.account_integrity_review?.review),
    fetched_at: new Date().toISOString(),
  };
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
  // Demo-Anzeigengruppen + Anzeigen (für Drilldown + Vorschau, 13.09.).
  const { data: dbCamps } = await sb
    .from("chatgpt_ads_campaigns")
    .select("id, openai_campaign_id")
    .eq("account_id", acc.id);
  const campDbId = new Map<string, string>(
    (dbCamps || []).map((r: any) => [String(r.openai_campaign_id), String(r.id)]),
  );
  const ADS: Record<string, Array<{ id: string; name: string; title: string; body: string }>> = {
    cmp_mock_brand: [
      {
        id: "ad_mock_brand_1",
        name: "Brand 1",
        title: "Die Agentur für KI-Sichtbarkeit",
        body: "Werde in ChatGPT & Co. gefunden — messbar, Schweiz-fokussiert.",
      },
      {
        id: "ad_mock_brand_2",
        name: "Brand 2",
        title: "Sichtbar in der KI-Suche",
        body: "Erwähnungen und Zitate in ChatGPT statt nur Google-Rankings.",
      },
    ],
    cmp_mock_leads: [
      {
        id: "ad_mock_leads_1",
        name: "Beratung",
        title: "Kostenlose KI-Sichtbarkeits-Analyse",
        body: "In 48 h erfährst du, wie ChatGPT über dein Unternehmen spricht.",
      },
    ],
    cmp_mock_promo: [
      {
        id: "ad_mock_promo_1",
        name: "Herbst",
        title: "Herbst-Aktion: Erstgespräch gratis",
        body: "Bis Ende Oktober — jetzt Termin sichern.",
      },
    ],
  };
  let adGroups = 0;
  let ads = 0;
  for (const c of CAMPS) {
    const cid = campDbId.get(c.id);
    if (!cid) continue;
    adGroups++;
    const { data: gRow } = await sb
      .from("chatgpt_ads_ad_groups")
      .upsert(
        {
          account_id: acc.id,
          campaign_id: cid,
          openai_ad_group_id: `adg_${c.id}`,
          name: `${c.name} – Gruppe A`,
          status: "active",
          raw: { id: `adg_${c.id}`, mock: true },
          synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id,openai_ad_group_id" },
      )
      .select("id")
      .single();
    for (const [j, a] of (ADS[c.id] || []).entries()) {
      ads++;
      await sb.from("chatgpt_ads_ads").upsert(
        {
          account_id: acc.id,
          ad_group_id: gRow?.id ?? null,
          openai_ad_id: a.id,
          name: a.name,
          status: j === 1 ? "paused" : "active",
          review_status: j === 1 ? "in_review" : "approved",
          raw: {
            id: a.id,
            mock: true,
            creative: {
              type: "chat_card",
              title: a.title,
              body: a.body,
              target_url: "https://www.ezyone.ch/",
            },
          },
          synced_at: new Date().toISOString(),
        },
        { onConflict: "account_id,openai_ad_id" },
      );
    }
  }
  // 30 Tage deterministische Insights je Kampagne (Seed = Tagesindex).
  let insightRows = 0;
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    for (const [i, c] of CAMPS.entries()) {
      if (i === 2 && d < 5) continue; // pausierte Kampagne: zuletzt ohne Daten
      const base = 400 + ((d * 37 + i * 91) % 350);
      const clicks = Math.round(base * (0.02 + (i % 3) * 0.01));
      const spend = Math.round(base * 0.9) / 10;
      const conv =
        i === 1
          ? Math.max(0, Math.round(clicks * 0.08))
          : i === 2
            ? Math.round(clicks * 0.03)
            : null;
      // Promo-Kampagne: Käufe mit Umsatz (ROAS-Demo), Lead-Kampagne: nur Leads.
      const sales = i === 2 && conv ? Math.round(conv * 89.5 * 100) / 100 : null;
      insightRows++;
      await sb.from("chatgpt_ads_insights_daily").upsert(
        {
          account_id: acc.id,
          scope: "campaign",
          scope_openai_id: c.id,
          date: day,
          impressions: base * 10,
          clicks,
          spend,
          conversions: conv,
          attributed_sales: sales,
          roas: sales != null && spend ? Math.round((sales / spend) * 100) / 100 : null,
          cpa: conv ? Math.round((spend / conv) * 100) / 100 : null,
          post_click_cvr: conv && clicks ? Math.round((conv / clicks) * 10000) / 10000 : null,
        },
        { onConflict: "account_id,scope,scope_openai_id,date" },
      );
    }
  }
  // Ebenen Anzeigengruppe/Anzeige (15.09.): Kampagnenzeilen auf die Anzeigen
  // verteilen (Gewichte deterministisch), Gruppe = Summe.
  const { data: campRows } = await sb
    .from("chatgpt_ads_insights_daily")
    .select("scope_openai_id, date, impressions, clicks, spend, conversions")
    .eq("account_id", acc.id)
    .eq("scope", "campaign");
  for (const cr of campRows || []) {
    const list = ADS[cr.scope_openai_id] || [];
    if (!list.length) continue;
    const weights = list.map((_, j) => (j === 0 ? 0.6 : 0.4 / (list.length - 1)));
    for (const [j, a] of list.entries()) {
      const w = list.length === 1 ? 1 : weights[j];
      const conv = cr.conversions != null ? Math.round(Number(cr.conversions) * w) : null;
      await sb.from("chatgpt_ads_insights_daily").upsert(
        {
          account_id: acc.id,
          scope: "ad",
          scope_openai_id: a.id,
          date: cr.date,
          impressions: Math.round(Number(cr.impressions) * w),
          clicks: Math.round(Number(cr.clicks) * w),
          spend: Math.round(Number(cr.spend) * w * 100) / 100,
          conversions: conv,
          ctc: conv,
        },
        { onConflict: "account_id,scope,scope_openai_id,date" },
      );
    }
    await sb.from("chatgpt_ads_insights_daily").upsert(
      {
        account_id: acc.id,
        scope: "ad_group",
        scope_openai_id: `adg_${cr.scope_openai_id}`,
        date: cr.date,
        impressions: Number(cr.impressions),
        clicks: Number(cr.clicks),
        spend: Number(cr.spend),
        conversions: cr.conversions,
        ctc: cr.conversions,
      },
      { onConflict: "account_id,scope,scope_openai_id,date" },
    );
  }
  await sb
    .from("chatgpt_ads_accounts")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", acc.id);
  return { campaigns: CAMPS.length, adGroups, ads, insightRows, mock: true };
}

const numOrNull = (v: any): number | null =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

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
  const eventSettingIds = idList(payload?.eventSettingIds);
  // Ausschluss-Regionen (Spec v2.3.0: targeting.excluded_locations.include).
  const excludedLocations: GeoLocation[] = Array.isArray(payload?.excludedLocations)
    ? payload.excludedLocations
        .filter((l: any) => l && l.id && !locations.some((x) => x.id === String(l.id)))
        .map((l: any) => ({
          id: String(l.id),
          name: String(l.name || l.id),
          type: l.type ? String(l.type) : undefined,
          country_code: l.country_code ? String(l.country_code) : undefined,
        }))
    : [];

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
      // Mock speichert die Ausschlüsse mit Namen (wie die echte API sie liefert).
      targeting.excluded_locations = { include: excludedLocations };
      upd = { targeting_locations: locations, raw: { ...raw, targeting } };
    } else if (cmd === "set_audiences") {
      targeting.custom_audiences = { ids: includeIds };
      targeting.excluded_custom_audiences = { ids: excludeIds };
      upd = { raw: { ...raw, targeting } };
    } else if (cmd === "set_conversion_events") {
      upd = { raw: { ...raw, conversion_event_setting_ids: eventSettingIds } };
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
      targeting.excluded_locations = { include: excludedLocations.map((l) => ({ id: l.id })) };
    } else {
      targeting.custom_audiences = { ids: includeIds };
      targeting.excluded_custom_audiences = { ids: excludeIds };
    }
    r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`, {
      method: "POST",
      body: { targeting },
    });
  } else if (cmd === "set_conversion_events") {
    // Event-Settings an die Kampagne hängen (Spec v2.3.0: conversion_event_setting_ids).
    r = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`, {
      method: "POST",
      body: { conversion_event_setting_ids: eventSettingIds },
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

// ── Vollsteuerung (13.09., «alles aus EzyHub»): Anlegen/Bearbeiten/Status auf
//    allen Ebenen, Bild-Upload, Segment-Reporting, Konto-Ebene ──────────────
type EntityKind = "campaign" | "ad_group" | "ad";
const ENTITY_PATH: Record<EntityKind, string> = {
  campaign: "/campaigns",
  ad_group: "/ad_groups",
  ad: "/ads",
};
const ENTITY_TABLE: Record<EntityKind, string> = {
  campaign: "chatgpt_ads_campaigns",
  ad_group: "chatgpt_ads_ad_groups",
  ad: "chatgpt_ads_ads",
};
const ENTITY_ID_COL: Record<EntityKind, string> = {
  campaign: "openai_campaign_id",
  ad_group: "openai_ad_group_id",
  ad: "openai_ad_id",
};

// Audit-Zeile in chatgpt_ads_commands (wie runCommand), generisch für alle Ebenen.
async function withAudit<T extends { ok: boolean; error?: string }>(
  sb: any,
  acc: any,
  action: string,
  targetType: string,
  targetId: string,
  payload: any,
  actorUserId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const { data: row } = await sb
    .from("chatgpt_ads_commands")
    .insert({
      account_id: acc.id,
      actor_user_id: actorUserId,
      action,
      target_type: targetType,
      target_openai_id: targetId,
      payload: payload ?? null,
    })
    .select("id")
    .single();
  let res: T;
  try {
    res = await fn();
  } catch (e: any) {
    res = { ok: false, error: String(e?.message || e).slice(0, 300) } as T;
  }
  await sb
    .from("chatgpt_ads_commands")
    .update({
      status: res.ok ? "success" : "failed",
      error: res.ok ? null : (res.error ?? "Fehler"),
      executed_at: new Date().toISOString(),
    })
    .eq("id", row?.id);
  return res;
}

const httpErr = (r: { status: number; json: any }) =>
  `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 220)}`;

// Objekt nach Änderung frisch aus der API in die DB schreiben.
async function resyncEntity(sb: any, acc: any, apiKey: string, kind: EntityKind, id: string) {
  const g = await adsFetch(apiKey, acc.openai_ad_account_id, `${ENTITY_PATH[kind]}/${id}`);
  if (!g.ok || !g.json?.id) return;
  const j = g.json;
  if (kind === "campaign") {
    const { data: prev } = await sb
      .from("chatgpt_ads_campaigns")
      .select("targeting_locations")
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", id)
      .maybeSingle();
    await upsertCampaignFromApi(sb, acc.id, j, prev?.targeting_locations || null);
  } else if (kind === "ad_group") {
    const { data: camp } = await sb
      .from("chatgpt_ads_campaigns")
      .select("id")
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", String(j.campaign_id || ""))
      .maybeSingle();
    await sb.from("chatgpt_ads_ad_groups").upsert(
      {
        account_id: acc.id,
        campaign_id: camp?.id ?? null,
        openai_ad_group_id: String(j.id),
        name: String(j.name || ""),
        status: String(j.status || ""),
        raw: j,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,openai_ad_group_id" },
    );
  } else {
    const { data: grp } = await sb
      .from("chatgpt_ads_ad_groups")
      .select("id")
      .eq("account_id", acc.id)
      .eq("openai_ad_group_id", String(j.ad_group_id || ""))
      .maybeSingle();
    await sb.from("chatgpt_ads_ads").upsert(
      {
        account_id: acc.id,
        ad_group_id: grp?.id ?? null,
        openai_ad_id: String(j.id),
        name: j.name ?? null,
        status: String(j.status || ""),
        review_status: j.review_status ?? null,
        raw: j,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,openai_ad_id" },
    );
  }
}

const unixOrNull = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Date.parse(String(v)) / 1000;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const locIds = (v: any) =>
  Array.isArray(v) ? v.filter((l: any) => l && l.id).map((l: any) => ({ id: String(l.id) })) : [];
const locFull = (v: any): GeoLocation[] =>
  Array.isArray(v)
    ? v
        .filter((l: any) => l && l.id)
        .map((l: any) => ({
          id: String(l.id),
          name: String(l.name || l.id),
          type: l.type ? String(l.type) : undefined,
          country_code: l.country_code ? String(l.country_code) : undefined,
        }))
    : [];

// Bild für eine Anzeige hochladen (POST /upload, multipart) → file_id.
async function uploadImage(
  apiKey: string,
  adAccountId: string,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<{ ok: boolean; status: number; json: any }> {
  const fd = new FormData();
  fd.append("file", new Blob([bytes as unknown as BlobPart], { type: mime }), filename);
  const r = await fetch(`${ADS_API}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Ad-Account": adAccountId },
    body: fd,
    signal: AbortSignal.timeout(60_000),
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

// Demo-Segmentzahlen aus den gespeicherten Tages-Insights ableiten.
const MOCK_SPLIT: Record<string, Array<[string, number]>> = {
  country: [
    ["Switzerland", 0.72],
    ["Germany", 0.18],
    ["Austria", 0.07],
    ["Other", 0.03],
  ],
  device: [
    ["mobile", 0.61],
    ["desktop", 0.36],
    ["tablet", 0.03],
  ],
  platform: [
    ["chatgpt_web", 0.55],
    ["chatgpt_ios", 0.3],
    ["chatgpt_android", 0.15],
  ],
};

// ── Conversions-Setup + Ad-Vorschau (Spec v2.3.0, 13.09.) ───────────────────
type ConvPixel = { id: string; name: string; pixel_id: string; client_type?: string };
type ConvEventSetting = {
  id: string;
  name: string;
  event_type: string;
  custom_event_name: string | null;
  attribution_window_days: number;
  source_ids: string[];
  campaigns: Array<{ id: string; name: string }>;
  archived: boolean;
};
type MockState = { pixels: ConvPixel[]; event_settings: ConvEventSetting[] };

// Standard-Events gem. Doku «Supported Events» + custom.
const CONV_EVENT_TYPES = [
  "lead_created",
  "order_created",
  "registration_completed",
  "appointment_scheduled",
  "subscription_created",
  "trial_started",
  "checkout_started",
  "contents_viewed",
  "items_added",
  "page_viewed",
  "custom",
];

async function mockStateGet(sb: any, acc: any): Promise<MockState> {
  const { data } = await sb
    .from("chatgpt_ads_accounts")
    .select("mock_state")
    .eq("id", acc.id)
    .maybeSingle();
  const st = data?.mock_state || {};
  return { pixels: st.pixels || [], event_settings: st.event_settings || [] };
}
async function mockStateSet(sb: any, acc: any, st: MockState): Promise<void> {
  await sb.from("chatgpt_ads_accounts").update({ mock_state: st }).eq("id", acc.id);
}

function normEventSetting(e: any): ConvEventSetting {
  return {
    id: String(e.id),
    name: String(e.name || ""),
    event_type: String(e.event_type || ""),
    custom_event_name: e.custom_event_name ?? null,
    attribution_window_days: Number(e.attribution_window_days || 0),
    source_ids: Array.isArray(e.source_ids) ? e.source_ids.map(String) : [],
    campaigns: Array.isArray(e.campaigns)
      ? e.campaigns.map((c: any) => ({ id: String(c.id), name: String(c.name || c.id) }))
      : [],
    archived: !!e.archived,
  };
}

// Pixel/Event-Settings des Kontos + hinterlegte Pixel-ID des Kunden.
async function convSetupGet(
  sb: any,
  acc: any,
  clientId: string,
): Promise<{
  ok: boolean;
  error?: string;
  pixels?: ConvPixel[];
  eventSettings?: ConvEventSetting[];
  configuredPixelId?: string | null;
  hasCapiKey?: boolean;
  campaigns?: Array<{ id: string; name: string; status: string; eventSettingIds: string[] }>;
  isMock?: boolean;
}> {
  const { data: cfg } = await sb
    .from("openai_ads_config")
    .select("pixel_id, api_key_enc")
    .eq("client_id", clientId)
    .maybeSingle();
  const configuredPixelId = cfg?.pixel_id || null;
  const hasCapiKey = !!cfg?.api_key_enc;
  // Kampagnen mit ihren Event-Setting-IDs (aus raw) — für die Zuweisung im UI.
  const { data: campRows } = await sb
    .from("chatgpt_ads_campaigns")
    .select("openai_campaign_id, name, status, ids:raw->conversion_event_setting_ids")
    .eq("account_id", acc.id)
    .neq("status", "archived")
    .order("name");
  const campaigns = (campRows || []).map((c: any) => ({
    id: String(c.openai_campaign_id),
    name: String(c.name || ""),
    status: String(c.status || ""),
    eventSettingIds: Array.isArray(c.ids) ? c.ids.map(String) : [],
  }));
  if (acc.is_mock) {
    const st = await mockStateGet(sb, acc);
    return {
      ok: true,
      pixels: st.pixels,
      eventSettings: st.event_settings,
      campaigns,
      configuredPixelId,
      hasCapiKey,
      isMock: true,
    };
  }
  const apiKey = decryptSecret(acc.api_key_enc);
  const [pix, evs] = await Promise.all([
    adsListAll(apiKey, acc.openai_ad_account_id, "/conversions/pixels"),
    adsListAll(apiKey, acc.openai_ad_account_id, "/conversions/event_settings"),
  ]);
  return {
    ok: true,
    pixels: pix.map((p: any) => ({
      id: String(p.id),
      name: String(p.name || ""),
      pixel_id: String(p.pixel_id || ""),
      client_type: p.client_type,
    })),
    eventSettings: evs.map(normEventSetting),
    campaigns,
    configuredPixelId,
    hasCapiKey,
  };
}

// Pixel-ID beim Kunden hinterlegen (openai_ads_config) — Snippet-Karte und
// CAPI-Ingest lesen von dort.
async function adoptPixel(sb: any, clientId: string, organizationId: string, pixelId: string) {
  const { data: ex } = await sb
    .from("openai_ads_config")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (ex)
    await sb
      .from("openai_ads_config")
      .update({ pixel_id: pixelId, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
  else
    await sb.from("openai_ads_config").insert({
      client_id: clientId,
      organization_id: organizationId,
      pixel_id: pixelId,
      enabled: true,
    });
}

// Demo-Vorschau: Chat-Card-Optik aus dem Creative.
function mockPreviewHtml(ad: any): string {
  const cr = ad?.raw?.creative || {};
  const esc = (s: any) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c,
    );
  return `<!doctype html><html><body style="margin:0;font-family:system-ui,sans-serif;background:#f7f7f8;padding:16px">
<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #e5e5ea;border-radius:14px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,.05)">
<div style="font-size:10.5px;color:#8b8da3;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Gesponsert · Demo-Vorschau</div>
<div style="font-size:15px;font-weight:700;color:#111;margin-bottom:4px">${esc(cr.title)}</div>
<div style="font-size:13px;color:#444;line-height:1.5;margin-bottom:10px">${esc(cr.body)}</div>
<div style="font-size:12px;color:#77008C;font-weight:600">${esc(cr.target_url || "")} →</div>
</div></body></html>`;
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
            "id, openai_ad_account_id, name, currency_code, status, is_mock, last_synced_at, last_sync_error, meta",
          )
          .eq("client_id", clientId)
          .maybeSingle();
        if (!acc) return Response.json({ ok: true, connected: false });

        // Zeitraum (13.09.2026, Vereinheitlichung): exakt + inklusiv, Default
        // 30 Tage; ungueltig/verdreht/Zukunft/zu lang → 400 statt Naeherung.
        let zr;
        try {
          zr = zeitraumAusParams(u.searchParams, { defaultDays: 30, maxDays: 366 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 400 },
          );
        }
        const { startDate: start, endDate: end } = zr;

        // scopes=all (15.09., Ads-Manager-Tabs): Insights aller Ebenen; Default
        // bleibt campaign, damit Summen im Dashboard nicht doppelt zählen.
        const allScopes = u.searchParams.get("scopes") === "all";
        const [{ data: campaigns }, { data: insights }, { data: commands }, { data: audiences }] =
          await Promise.all([
            sb
              .from("chatgpt_ads_campaigns")
              // targeting (Audience-IDs) direkt aus raw per JSON-Pfad — spart
              // das komplette raw-Objekt in der Antwort.
              .select(
                "openai_campaign_id, name, status, bidding_type, objective, budget_daily_micros, budget_lifetime_micros, start_time, end_time, synced_at, targeting_locations, targeting:raw->targeting, conversion_event_setting_ids:raw->conversion_event_setting_ids",
              )
              .eq("account_id", acc.id)
              .neq("status", "archived")
              .order("name"),
            sb
              .from("chatgpt_ads_insights_daily")
              .select(
                "scope, scope_openai_id, date, impressions, clicks, spend, conversions, ctc, attributed_sales, roas, cpa, post_click_cvr",
              )
              .eq("account_id", acc.id)
              .in("scope", allScopes ? ["campaign", "ad_group", "ad"] : ["campaign"])
              .gte("date", start)
              .lte("date", end)
              .order("date"),
            sb
              .from("chatgpt_ads_commands")
              .select("action, target_openai_id, target_type, status, error, created_at, payload")
              .eq("account_id", acc.id)
              .order("created_at", { ascending: false })
              .limit(allScopes ? 200 : 20),
            sb
              .from("chatgpt_ads_audiences")
              .select(
                "openai_audience_id, name, description, status, identifier_type, matched_user_count_range, identifier_count, created_at, synced_at",
              )
              .eq("account_id", acc.id)
              .order("created_at", { ascending: false }),
          ]);
        // Anzeigen je Kampagne (Drilldown + Vorschau, 13.09.): Ad → Gruppe → Kampagne.
        const [{ data: groups }, { data: adRows }] = await Promise.all([
          sb
            .from("chatgpt_ads_ad_groups")
            .select(
              "id, openai_ad_group_id, name, status, campaign_id, bidding_config:raw->bidding_config, context_hints:raw->context_hints, campaigns:chatgpt_ads_campaigns(openai_campaign_id)",
            )
            .eq("account_id", acc.id)
            .neq("status", "archived"),
          sb
            .from("chatgpt_ads_ads")
            .select(
              "openai_ad_id, ad_group_id, name, status, review_status, creative:raw->creative, lpc:raw->landing_page_configuration",
            )
            .eq("account_id", acc.id)
            .neq("status", "archived"),
        ]);
        const groupById = new Map<string, { name: string; campaignId: string | null }>(
          (groups || []).map((g: any) => [
            String(g.id),
            { name: String(g.name || ""), campaignId: g.campaigns?.openai_campaign_id ?? null },
          ]),
        );
        const adGroups = (groups || []).map((g: any) => ({
          openai_ad_group_id: String(g.openai_ad_group_id),
          name: String(g.name || ""),
          status: String(g.status || ""),
          campaign_id: g.campaigns?.openai_campaign_id ?? null,
          bidding_config: g.bidding_config ?? null,
          context_hints: Array.isArray(g.context_hints) ? g.context_hints.map(String) : [],
        }));
        const groupOpenaiId = new Map<string, string>(
          (groups || []).map((g: any) => [String(g.id), String(g.openai_ad_group_id)]),
        );
        const ads = (adRows || []).map((a: any) => {
          const g = a.ad_group_id ? groupById.get(String(a.ad_group_id)) : undefined;
          const cr = a.creative || {};
          return {
            openai_ad_id: a.openai_ad_id,
            name: a.name,
            status: a.status,
            review_status: a.review_status,
            ad_group_name: g?.name ?? null,
            ad_group_id: a.ad_group_id ? (groupOpenaiId.get(String(a.ad_group_id)) ?? null) : null,
            campaign_id: g?.campaignId ?? null,
            creative: {
              type: cr.type ?? null,
              title: cr.title ?? null,
              body: cr.body ?? null,
              target_url: cr.target_url ?? cr.url ?? null,
              file_id: cr.file_id ?? null,
            },
            query_string_template: a.lpc?.query_string_template ?? null,
          };
        });
        return Response.json({
          ok: true,
          connected: true,
          range: { from: zr.startDate, to: zr.endDate, days: zr.days },
          account: acc,
          campaigns: campaigns || [],
          insights: insights || [],
          commands: commands || [],
          audiences: audiences || [],
          ads,
          adGroups,
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
            // Multi-Konto (13.09.): hängen mehrere Konten am Key, Liste zur
            // Auswahl zurückgeben (chooseAccount) — der Client sendet dann
            // adAccountId mit und wir wählen per Header OpenAI-Ad-Account.
            const chosen = String(body?.adAccountId || "").trim() || null;
            const probe = await adsFetch(apiKey, chosen, "/ad_account");
            if (!probe.ok || !probe.json?.id) {
              const list = await adsFetch(apiKey, null, "/ad_accounts", {
                query: { limit: "100" },
              });
              const accounts = (list.json?.data || []).map((a: any) => ({
                id: String(a.id),
                name: String(a.name || a.id),
                currency: String(a.currency_code || ""),
                status: a.status ? String(a.status) : null,
                review: a.review?.status ? String(a.review.status) : null,
              }));
              if (list.ok && accounts.length > 0)
                return Response.json({ ok: true, chooseAccount: accounts });
              return Response.json(
                {
                  ok: false,
                  error: `Key ungültig oder Konto nicht erreichbar (HTTP ${probe.status})`,
                },
                { status: 400 },
              );
            }
            if (!chosen) {
              // Auch ohne Auswahl prüfen, ob der Key mehrere Konten sieht.
              const list = await adsFetch(apiKey, null, "/ad_accounts", {
                query: { limit: "100" },
              });
              const accounts = (list.json?.data || []).map((a: any) => ({
                id: String(a.id),
                name: String(a.name || a.id),
                currency: String(a.currency_code || ""),
                status: a.status ? String(a.status) : null,
                review: a.review?.status ? String(a.review.status) : null,
              }));
              if (list.ok && accounts.length > 1)
                return Response.json({ ok: true, chooseAccount: accounts });
            }
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
            ![
              "pause",
              "activate",
              "set_budget",
              "set_targeting",
              "set_audiences",
              "set_conversion_events",
            ].includes(cmd) ||
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
              eventSettingIds: body?.eventSettingIds,
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

        // ── Conversions-Setup per API (13.09.) ─────────────────────────────
        if (action === "conv-setup-get") {
          try {
            return Response.json(await convSetupGet(sb, acc, clientId));
          } catch (e: any) {
            return Response.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
          }
        }

        if (action === "conv-pixel-create") {
          const name = String(body?.name || "").trim() || `${own.name} Website`;
          let pixel: ConvPixel;
          if (acc.is_mock) {
            const st = await mockStateGet(sb, acc);
            pixel = {
              id: `cpx_mock_${Date.now().toString(36)}`,
              name,
              pixel_id: `pix_${clientId.slice(0, 8)}_${st.pixels.length + 1}`,
              client_type: "web",
            };
            st.pixels.push(pixel);
            await mockStateSet(sb, acc, st);
          } else {
            const r = await adsFetch(
              decryptSecret(acc.api_key_enc),
              acc.openai_ad_account_id,
              "/conversions/pixels",
              { method: "POST", body: { name, client_type: "web" } },
            );
            if (!r.ok || !r.json?.pixel_id)
              return Response.json(
                { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}` },
                { status: 502 },
              );
            pixel = {
              id: String(r.json.id),
              name: String(r.json.name || name),
              pixel_id: String(r.json.pixel_id),
              client_type: r.json.client_type,
            };
          }
          // Standard: die neue Pixel-ID gleich beim Kunden hinterlegen.
          if (body?.adopt !== false)
            await adoptPixel(sb, clientId, own.organization_id, pixel.pixel_id);
          return Response.json({ ok: true, pixel });
        }

        if (action === "conv-pixel-adopt") {
          const pixelId = String(body?.pixelId || "").trim();
          if (!pixelId)
            return Response.json({ ok: false, error: "pixelId erforderlich" }, { status: 400 });
          await adoptPixel(sb, clientId, own.organization_id, pixelId);
          return Response.json({ ok: true });
        }

        if (action === "conv-key-create") {
          // Conversions-API-Key erzeugen und verschlüsselt beim Kunden speichern —
          // der Klartext wird NICHT zurückgegeben (Secretbox-Muster).
          if (acc.is_mock) {
            const { data: ex } = await sb
              .from("openai_ads_config")
              .select("client_id")
              .eq("client_id", clientId)
              .maybeSingle();
            if (!ex)
              return Response.json(
                { ok: false, error: "Zuerst ein Pixel anlegen (Demo)" },
                { status: 409 },
              );
            await sb
              .from("openai_ads_config")
              .update({ api_key_enc: encryptSecret(`mock_capi_${Date.now()}`) })
              .eq("client_id", clientId);
            return Response.json({ ok: true });
          }
          const r = await adsFetch(
            decryptSecret(acc.api_key_enc),
            acc.openai_ad_account_id,
            "/conversions/api_keys",
            { method: "POST", body: { name: `EzyHub ${own.name}`.slice(0, 60) } },
          );
          if (!r.ok || !r.json?.api_key)
            return Response.json(
              { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}` },
              { status: 502 },
            );
          const { data: ex } = await sb
            .from("openai_ads_config")
            .select("client_id")
            .eq("client_id", clientId)
            .maybeSingle();
          if (!ex)
            return Response.json(
              { ok: false, error: "Zuerst ein Pixel anlegen/übernehmen" },
              { status: 409 },
            );
          await sb
            .from("openai_ads_config")
            .update({ api_key_enc: encryptSecret(String(r.json.api_key)) })
            .eq("client_id", clientId);
          return Response.json({ ok: true });
        }

        if (action === "conv-event-create") {
          const name = String(body?.name || "").trim();
          const eventType = String(body?.eventType || "");
          const customEventName = String(body?.customEventName || "").trim();
          const windowDays = Math.min(90, Math.max(1, Number(body?.attributionWindowDays || 30)));
          const sourceIds: string[] = Array.isArray(body?.sourceIds)
            ? body.sourceIds.map((x: any) => String(x)).filter(Boolean)
            : [];
          if (name.length < 2 || !CONV_EVENT_TYPES.includes(eventType) || !sourceIds.length)
            return Response.json(
              { ok: false, error: "name, eventType und mindestens ein Pixel erforderlich" },
              { status: 400 },
            );
          if (eventType === "custom" && !customEventName)
            return Response.json(
              { ok: false, error: "customEventName erforderlich" },
              { status: 400 },
            );
          const payload: any = {
            name,
            event_type: eventType,
            attribution_window_days: windowDays,
            source_ids: sourceIds,
          };
          if (eventType === "custom") payload.custom_event_name = customEventName;
          if (acc.is_mock) {
            const st = await mockStateGet(sb, acc);
            const ev = normEventSetting({
              id: `ces_mock_${Date.now().toString(36)}`,
              ...payload,
              campaigns: [],
            });
            st.event_settings.push(ev);
            await mockStateSet(sb, acc, st);
            return Response.json({ ok: true, eventSetting: ev });
          }
          const r = await adsFetch(
            decryptSecret(acc.api_key_enc),
            acc.openai_ad_account_id,
            "/conversions/event_settings",
            { method: "POST", body: payload },
          );
          if (!r.ok || !r.json?.id)
            return Response.json(
              { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}` },
              { status: 502 },
            );
          return Response.json({ ok: true, eventSetting: normEventSetting(r.json) });
        }

        if (action === "conv-sample") {
          // Live-Verifikation: Stichprobe der bei OpenAI eingegangenen Events
          // (letzte ~15 Min) — zeigt, ob Pixel (pixel_sdk) bzw. CAPI
          // (server_to_server) wirklich ankommen. Nicht cachen.
          let pixelId = String(body?.pixelId || "").trim();
          if (!pixelId) {
            const { data: cfg } = await sb
              .from("openai_ads_config")
              .select("pixel_id")
              .eq("client_id", clientId)
              .maybeSingle();
            pixelId = cfg?.pixel_id || "";
          }
          if (!pixelId)
            return Response.json(
              { ok: false, error: "Keine Pixel-ID hinterlegt" },
              { status: 409 },
            );
          if (acc.is_mock) {
            // Demo: eigene CAPI-Events des Kunden als «eingegangen» spiegeln.
            const { data: evs } = await sb
              .from("openai_ads_events")
              .select("event_type, created_at, sent_at, action_source")
              .eq("client_id", clientId)
              .order("created_at", { ascending: false })
              .limit(20);
            const events = (evs || []).map((e: any) => ({
              event_type: e.event_type,
              custom_event_name: null,
              api_channel: "server_to_server",
              event_timestamp_ms: e.created_at ? new Date(e.created_at).getTime() : null,
              received_at_ms: e.sent_at ? new Date(e.sent_at).getTime() : null,
              action_source: e.action_source || "website",
            }));
            return Response.json({ ok: true, pixelId, events, mock: true });
          }
          const r = await adsFetch(
            decryptSecret(acc.api_key_enc),
            acc.openai_ad_account_id,
            "/conversions/events",
            { query: { pid: pixelId, limit: "50" } },
          );
          if (!r.ok)
            return Response.json(
              { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}` },
              { status: 502 },
            );
          const events = (r.json?.data || []).map((e: any) => ({
            event_type: e.event_type ?? null,
            custom_event_name: e.custom_event_name ?? null,
            api_channel: e.api_channel ?? null,
            event_timestamp_ms: numOrNull(e.event_timestamp_ms),
            received_at_ms: numOrNull(e.received_at_ms),
            action_source: e.action_source ?? null,
          }));
          return Response.json({ ok: true, pixelId, events });
        }

        // ── Ad-Vorschau (13.09.) ──────────────────────────────────────────
        if (action === "ad-preview") {
          const adId = String(body?.adId || "");
          if (!adId)
            return Response.json({ ok: false, error: "adId erforderlich" }, { status: 400 });
          const { data: ad } = await sb
            .from("chatgpt_ads_ads")
            .select("openai_ad_id, raw")
            .eq("account_id", acc.id)
            .eq("openai_ad_id", adId)
            .maybeSingle();
          if (!ad) return Response.json({ ok: false, error: "Anzeige unbekannt" }, { status: 404 });
          if (acc.is_mock)
            return Response.json({ ok: true, html: mockPreviewHtml(ad), mock: true });
          const r = await adsFetch(
            decryptSecret(acc.api_key_enc),
            acc.openai_ad_account_id,
            `/ads/${encodeURIComponent(adId)}/preview`,
            { method: "POST", body: {} },
          );
          const html = r.json?.data?.[0]?.body;
          if (!r.ok || !html)
            return Response.json(
              { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}` },
              { status: 502 },
            );
          return Response.json({ ok: true, html: String(html) });
        }

        // ── Vollsteuerung (13.09.) ────────────────────────────────────────
        const actor = ctx.userId ?? null;
        const keyOf = (): string | Response => {
          try {
            return decryptSecret(acc.api_key_enc);
          } catch (e: any) {
            return Response.json(
              { ok: false, error: `Key nicht lesbar: ${String(e?.message || e)}` },
              { status: 500 },
            );
          }
        };

        if (action === "image-upload") {
          const b64 = String(body?.dataBase64 || "");
          const mime = String(body?.mimeType || "image/jpeg");
          const filename = String(body?.fileName || "ad.jpg").replace(/[^\w.-]/g, "_");
          if (!/^image\/(jpeg|png|webp)$/.test(mime))
            return Response.json({ ok: false, error: "Nur JPEG, PNG oder WebP" }, { status: 400 });
          if (!b64 || b64.length > 8_000_000)
            return Response.json({ ok: false, error: "Bild fehlt oder > 6 MB" }, { status: 400 });
          if (acc.is_mock)
            return Response.json({ ok: true, fileId: `file_mock_${Date.now().toString(36)}` });
          const key = keyOf();
          if (key instanceof Response) return key;
          const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
          const r = await uploadImage(key, acc.openai_ad_account_id, bytes, mime, filename);
          if (!r.ok || !r.json?.file_id)
            return Response.json({ ok: false, error: httpErr(r) }, { status: 502 });
          return Response.json({ ok: true, fileId: String(r.json.file_id) });
        }

        if (action === "campaign-create") {
          const name = String(body?.name || "").trim();
          const objective = String(body?.objective || "reach");
          const biddingType = String(body?.biddingType || "impressions");
          const status = body?.status === "active" ? "active" : "paused";
          const daily = Number(body?.budgetDailyMicros || 0) || null;
          const lifetime = Number(body?.budgetLifetimeMicros || 0) || null;
          if (name.length < 3)
            return Response.json(
              { ok: false, error: "Name: mindestens 3 Zeichen" },
              { status: 400 },
            );
          if (!["reach", "clicks", "conversions"].includes(objective))
            return Response.json({ ok: false, error: "objective ungültig" }, { status: 400 });
          if (!["impressions", "clicks", "conversions"].includes(biddingType))
            return Response.json({ ok: false, error: "biddingType ungültig" }, { status: 400 });
          if (!daily && !lifetime)
            return Response.json({ ok: false, error: "Budget erforderlich" }, { status: 400 });
          if ((daily && daily < 1_000_000) || (lifetime && lifetime < 1_000_000))
            return Response.json({ ok: false, error: "Budget: mindestens 1.00" }, { status: 400 });
          const eventSettingIds = Array.isArray(body?.eventSettingIds)
            ? body.eventSettingIds.map(String).filter(Boolean)
            : [];
          if (biddingType === "conversions" && !eventSettingIds.length)
            return Response.json(
              { ok: false, error: "Conversions-Gebot braucht ein Conversion-Event" },
              { status: 400 },
            );
          const locations = locFull(body?.locations);
          const excluded = locFull(body?.excludedLocations).filter(
            (l) => !locations.some((x) => x.id === l.id),
          );
          const targeting: any = {};
          if (locations.length) targeting.locations = { include: locIds(locations) };
          if (excluded.length) targeting.excluded_locations = { include: locIds(excluded) };
          const inc = Array.isArray(body?.includeIds) ? body.includeIds.map(String) : [];
          const exc = Array.isArray(body?.excludeIds)
            ? body.excludeIds.map(String).filter((x: string) => !inc.includes(x))
            : [];
          if (inc.length) targeting.custom_audiences = { ids: inc };
          if (exc.length) targeting.excluded_custom_audiences = { ids: exc };
          const payload: any = {
            name,
            status,
            objective,
            bidding_type: biddingType,
            budget: {
              ...(daily ? { daily_spend_limit_micros: daily } : {}),
              ...(lifetime ? { lifetime_spend_limit_micros: lifetime } : {}),
            },
          };
          const st = unixOrNull(body?.startTime);
          const et = unixOrNull(body?.endTime);
          if (st) payload.start_time = st;
          if (et) payload.end_time = et;
          if (Object.keys(targeting).length) payload.targeting = targeting;
          if (eventSettingIds.length) payload.conversion_event_setting_ids = eventSettingIds;
          if (String(body?.description || "").trim())
            payload.description = String(body.description).trim();
          const res = await withAudit(
            sb,
            acc,
            "campaign_create",
            "campaign",
            name,
            payload,
            actor,
            async () => {
              if (acc.is_mock) {
                const id = `cmp_mock_${Date.now().toString(36)}`;
                await upsertCampaignFromApi(
                  sb,
                  acc.id,
                  {
                    ...payload,
                    id,
                    mock: true,
                    targeting: {
                      ...targeting,
                      excluded_locations: { include: excluded },
                    },
                  },
                  locations,
                );
                return { ok: true, id };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              const r = await adsFetch(key, acc.openai_ad_account_id, "/campaigns", {
                method: "POST",
                body: payload,
              });
              if (!r.ok || !r.json?.id) return { ok: false, error: httpErr(r) };
              await upsertCampaignFromApi(sb, acc.id, r.json, locations);
              return { ok: true, id: String(r.json.id) };
            },
          );
          return res.ok
            ? Response.json({ ok: true, id: (res as any).id })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "adgroup-create") {
          const campaignId = String(body?.campaignId || "");
          const name = String(body?.name || "").trim();
          const status = body?.status === "active" ? "active" : "paused";
          const billing = body?.billingEventType === "click" ? "click" : "impression";
          const strategy = String(body?.strategy || "");
          const maxBid = Number(body?.maxBidMicros || 0) || null;
          if (!campaignId || name.length < 3)
            return Response.json({ ok: false, error: "campaignId/name ungültig" }, { status: 400 });
          if (
            strategy &&
            !["fixed_bid", "maximize_clicks", "maximize_conversions"].includes(strategy)
          )
            return Response.json({ ok: false, error: "strategy ungültig" }, { status: 400 });
          if (strategy === "fixed_bid" && !maxBid)
            return Response.json(
              { ok: false, error: "Festgebot braucht maxBidMicros" },
              { status: 400 },
            );
          const bidding_config: any = { billing_event_type: billing };
          if (strategy) bidding_config.strategy = strategy;
          if (maxBid) bidding_config.max_bid_micros = maxBid;
          const payload: any = { campaign_id: campaignId, name, status, bidding_config };
          const hints = Array.isArray(body?.contextHints)
            ? body.contextHints
                .map((x: any) => String(x).trim())
                .filter(Boolean)
                .slice(0, 10)
            : [];
          if (hints.length) payload.context_hints = hints;
          const res = await withAudit(
            sb,
            acc,
            "ad_group_create",
            "ad_group",
            name,
            payload,
            actor,
            async () => {
              const { data: camp } = await sb
                .from("chatgpt_ads_campaigns")
                .select("id")
                .eq("account_id", acc.id)
                .eq("openai_campaign_id", campaignId)
                .maybeSingle();
              if (!camp) return { ok: false, error: "Kampagne unbekannt" };
              if (acc.is_mock) {
                const id = `adg_mock_${Date.now().toString(36)}`;
                await sb.from("chatgpt_ads_ad_groups").insert({
                  account_id: acc.id,
                  campaign_id: camp.id,
                  openai_ad_group_id: id,
                  name,
                  status,
                  raw: { ...payload, id, mock: true },
                  synced_at: new Date().toISOString(),
                });
                return { ok: true, id };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              const r = await adsFetch(key, acc.openai_ad_account_id, "/ad_groups", {
                method: "POST",
                body: payload,
              });
              if (!r.ok || !r.json?.id) return { ok: false, error: httpErr(r) };
              await resyncEntity(sb, acc, key, "ad_group", String(r.json.id));
              return { ok: true, id: String(r.json.id) };
            },
          );
          return res.ok
            ? Response.json({ ok: true, id: (res as any).id })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "ad-create" || action === "ad-update") {
          const isUpdate = action === "ad-update";
          const adGroupId = String(body?.adGroupId || "");
          const adId = String(body?.adId || "");
          const name = String(body?.name || "").trim();
          const title = String(body?.title || "").trim();
          const text = String(body?.body || "").trim();
          const targetUrl = String(body?.targetUrl || "").trim();
          const fileId = String(body?.fileId || "").trim() || null;
          const status = body?.status === "active" ? "active" : "paused";
          // Abfrageparameter der Landingpage (Ads Manager «Anzeige bearbeiten»):
          // Vorlagen {campaign_id} {ad_group_id} {ad_id} {ad_account_id} {oppref}.
          const qst =
            body?.queryStringTemplate === undefined
              ? undefined
              : String(body.queryStringTemplate || "")
                  .trim()
                  .replace(/^\?/, "");
          if ((isUpdate && !adId) || (!isUpdate && !adGroupId))
            return Response.json({ ok: false, error: "adGroupId/adId fehlt" }, { status: 400 });
          if (!isUpdate && name.length < 3)
            return Response.json(
              { ok: false, error: "Name: mindestens 3 Zeichen" },
              { status: 400 },
            );
          if (title.length < (isUpdate ? 1 : 3) || title.length > 50)
            return Response.json({ ok: false, error: "Titel: 3–50 Zeichen" }, { status: 400 });
          if (text.length > 100)
            return Response.json(
              { ok: false, error: "Text: maximal 100 Zeichen" },
              { status: 400 },
            );
          if (targetUrl && !/^https?:\/\/\S+$/i.test(targetUrl))
            return Response.json({ ok: false, error: "Ziel-URL ungültig" }, { status: 400 });
          const creative: any = { type: "chat_card", title, body: text };
          if (targetUrl) creative.target_url = targetUrl;
          if (fileId) creative.file_id = fileId;
          const res = await withAudit(
            sb,
            acc,
            isUpdate ? "ad_update" : "ad_create",
            "ad",
            isUpdate ? adId : name,
            { creative, adGroupId, status },
            actor,
            async () => {
              if (acc.is_mock) {
                if (isUpdate) {
                  const { data: cur } = await sb
                    .from("chatgpt_ads_ads")
                    .select("raw")
                    .eq("account_id", acc.id)
                    .eq("openai_ad_id", adId)
                    .maybeSingle();
                  if (!cur) return { ok: false, error: "Anzeige unbekannt" };
                  const prevCr = cur.raw?.creative || {};
                  await sb
                    .from("chatgpt_ads_ads")
                    .update({
                      ...(name ? { name } : {}),
                      review_status: "in_review",
                      raw: {
                        ...cur.raw,
                        creative: { ...prevCr, ...creative, file_id: fileId ?? prevCr.file_id },
                        ...(qst !== undefined
                          ? {
                              landing_page_configuration: qst
                                ? { query_string_template: qst }
                                : null,
                            }
                          : {}),
                      },
                      synced_at: new Date().toISOString(),
                    })
                    .eq("account_id", acc.id)
                    .eq("openai_ad_id", adId);
                  return { ok: true, id: adId };
                }
                const { data: grp } = await sb
                  .from("chatgpt_ads_ad_groups")
                  .select("id")
                  .eq("account_id", acc.id)
                  .eq("openai_ad_group_id", adGroupId)
                  .maybeSingle();
                if (!grp) return { ok: false, error: "Anzeigengruppe unbekannt" };
                const id = `ad_mock_${Date.now().toString(36)}`;
                await sb.from("chatgpt_ads_ads").insert({
                  account_id: acc.id,
                  ad_group_id: grp.id,
                  openai_ad_id: id,
                  name,
                  status,
                  review_status: "in_review",
                  raw: {
                    id,
                    mock: true,
                    creative,
                    status,
                    ...(qst ? { landing_page_configuration: { query_string_template: qst } } : {}),
                  },
                  synced_at: new Date().toISOString(),
                });
                return { ok: true, id };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              if (isUpdate) {
                // Creative ist beim Update ein Ganzes (type/title/body Pflicht):
                // fehlendes Bild aus dem Bestand übernehmen.
                if (!fileId) {
                  const g0 = await adsFetch(key, acc.openai_ad_account_id, `/ads/${adId}`);
                  if (g0.ok && g0.json?.creative?.file_id)
                    creative.file_id = g0.json.creative.file_id;
                }
                const r = await adsFetch(key, acc.openai_ad_account_id, `/ads/${adId}`, {
                  method: "POST",
                  body: {
                    ...(name ? { name } : {}),
                    creative,
                    ...(qst !== undefined
                      ? { landing_page_configuration: qst ? { query_string_template: qst } : null }
                      : {}),
                  },
                });
                if (!r.ok) return { ok: false, error: httpErr(r) };
                await resyncEntity(sb, acc, key, "ad", adId);
                return { ok: true, id: adId };
              }
              const r = await adsFetch(key, acc.openai_ad_account_id, "/ads", {
                method: "POST",
                body: {
                  ad_group_id: adGroupId,
                  name,
                  status,
                  creative,
                  ...(qst ? { landing_page_configuration: { query_string_template: qst } } : {}),
                },
              });
              if (!r.ok || !r.json?.id) return { ok: false, error: httpErr(r) };
              await resyncEntity(sb, acc, key, "ad", String(r.json.id));
              return { ok: true, id: String(r.json.id) };
            },
          );
          return res.ok
            ? Response.json({ ok: true, id: (res as any).id })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "entity-command") {
          const kind = String(body?.kind || "") as EntityKind;
          const id = String(body?.id || "");
          const cmd = String(body?.cmd || "");
          if (!ENTITY_PATH[kind] || !id || !["pause", "activate", "archive"].includes(cmd))
            return Response.json({ ok: false, error: "kind/id/cmd ungültig" }, { status: 400 });
          const res = await withAudit(
            sb,
            acc,
            `${kind}_${cmd}`,
            kind,
            id,
            null,
            actor,
            async () => {
              const status =
                cmd === "pause" ? "paused" : cmd === "activate" ? "active" : "archived";
              if (acc.is_mock) {
                await sb
                  .from(ENTITY_TABLE[kind])
                  .update({ status, synced_at: new Date().toISOString() })
                  .eq("account_id", acc.id)
                  .eq(ENTITY_ID_COL[kind], id);
                return { ok: true };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              const r = await adsFetch(
                key,
                acc.openai_ad_account_id,
                `${ENTITY_PATH[kind]}/${id}/${cmd}`,
                { method: "POST" },
              );
              if (!r.ok) return { ok: false, error: httpErr(r) };
              await resyncEntity(sb, acc, key, kind, id);
              return { ok: true };
            },
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "campaign-update") {
          // Name, Laufzeitbudget, Start/Ende, Beschreibung — Tagesbudget bleibt
          // beim bestehenden Command set_budget.
          const id = String(body?.campaignId || "");
          if (!id) return Response.json({ ok: false, error: "campaignId fehlt" }, { status: 400 });
          const upd: any = {};
          if (body?.name != null) {
            const n = String(body.name).trim();
            if (n.length < 3)
              return Response.json(
                { ok: false, error: "Name: mindestens 3 Zeichen" },
                { status: 400 },
              );
            upd.name = n;
          }
          if (body?.description != null) upd.description = String(body.description).trim() || null;
          if (body?.budgetLifetimeMicros !== undefined) {
            const v = Number(body.budgetLifetimeMicros || 0);
            if (v && v < 1_000_000)
              return Response.json(
                { ok: false, error: "Laufzeitbudget: mindestens 1.00" },
                { status: 400 },
              );
            upd.budget = { ...(v ? { lifetime_spend_limit_micros: v } : {}) };
            if (body?.budgetDailyMicros)
              upd.budget.daily_spend_limit_micros = Number(body.budgetDailyMicros);
          }
          if (body?.startTime !== undefined) upd.start_time = unixOrNull(body.startTime);
          if (body?.endTime !== undefined) upd.end_time = unixOrNull(body.endTime);
          if (!Object.keys(upd).length)
            return Response.json({ ok: false, error: "Nichts zu ändern" }, { status: 400 });
          const res = await withAudit(
            sb,
            acc,
            "campaign_update",
            "campaign",
            id,
            upd,
            actor,
            async () => {
              if (acc.is_mock) {
                const { data: cur } = await sb
                  .from("chatgpt_ads_campaigns")
                  .select("raw")
                  .eq("account_id", acc.id)
                  .eq("openai_campaign_id", id)
                  .maybeSingle();
                if (!cur) return { ok: false, error: "Kampagne unbekannt" };
                const dbUpd: any = {
                  raw: { ...cur.raw, ...upd },
                  synced_at: new Date().toISOString(),
                };
                if (upd.name) dbUpd.name = upd.name;
                if (upd.budget) {
                  dbUpd.budget_lifetime_micros = upd.budget.lifetime_spend_limit_micros ?? null;
                  if (upd.budget.daily_spend_limit_micros)
                    dbUpd.budget_daily_micros = upd.budget.daily_spend_limit_micros;
                }
                if ("start_time" in upd) dbUpd.start_time = tsToIso(upd.start_time);
                if ("end_time" in upd) dbUpd.end_time = tsToIso(upd.end_time);
                await sb
                  .from("chatgpt_ads_campaigns")
                  .update(dbUpd)
                  .eq("account_id", acc.id)
                  .eq("openai_campaign_id", id);
                return { ok: true };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              if (upd.budget && !upd.budget.daily_spend_limit_micros) {
                // Tagesbudget beim Laufzeit-Update mitsenden, sonst würde es gelöscht.
                const g0 = await adsFetch(key, acc.openai_ad_account_id, `/campaigns/${id}`);
                const d = g0.json?.budget?.daily_spend_limit_micros;
                if (d) upd.budget.daily_spend_limit_micros = d;
              }
              const r = await adsFetch(key, acc.openai_ad_account_id, `/campaigns/${id}`, {
                method: "POST",
                body: upd,
              });
              if (!r.ok) return { ok: false, error: httpErr(r) };
              await resyncEntity(sb, acc, key, "campaign", id);
              return { ok: true };
            },
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "adgroup-update") {
          const id = String(body?.adGroupId || "");
          if (!id) return Response.json({ ok: false, error: "adGroupId fehlt" }, { status: 400 });
          const upd: any = {};
          if (body?.name != null) {
            const n = String(body.name).trim();
            if (n.length < 3)
              return Response.json(
                { ok: false, error: "Name: mindestens 3 Zeichen" },
                { status: 400 },
              );
            upd.name = n;
          }
          if (body?.strategy !== undefined || body?.billingEventType !== undefined) {
            const strategy = String(body?.strategy || "");
            const billing = body?.billingEventType === "click" ? "click" : "impression";
            const maxBid = Number(body?.maxBidMicros || 0) || null;
            if (
              strategy &&
              !["fixed_bid", "maximize_clicks", "maximize_conversions"].includes(strategy)
            )
              return Response.json({ ok: false, error: "strategy ungültig" }, { status: 400 });
            if (strategy === "fixed_bid" && !maxBid)
              return Response.json(
                { ok: false, error: "Festgebot braucht maxBidMicros" },
                { status: 400 },
              );
            upd.bidding_config = { billing_event_type: billing };
            if (strategy) upd.bidding_config.strategy = strategy;
            if (maxBid) upd.bidding_config.max_bid_micros = maxBid;
          }
          if (!Object.keys(upd).length)
            return Response.json({ ok: false, error: "Nichts zu ändern" }, { status: 400 });
          const res = await withAudit(
            sb,
            acc,
            "ad_group_update",
            "ad_group",
            id,
            upd,
            actor,
            async () => {
              if (acc.is_mock) {
                const { data: cur } = await sb
                  .from("chatgpt_ads_ad_groups")
                  .select("raw")
                  .eq("account_id", acc.id)
                  .eq("openai_ad_group_id", id)
                  .maybeSingle();
                if (!cur) return { ok: false, error: "Anzeigengruppe unbekannt" };
                await sb
                  .from("chatgpt_ads_ad_groups")
                  .update({
                    ...(upd.name ? { name: upd.name } : {}),
                    raw: { ...cur.raw, ...upd },
                    synced_at: new Date().toISOString(),
                  })
                  .eq("account_id", acc.id)
                  .eq("openai_ad_group_id", id);
                return { ok: true };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              const r = await adsFetch(key, acc.openai_ad_account_id, `/ad_groups/${id}`, {
                method: "POST",
                body: upd,
              });
              if (!r.ok) return { ok: false, error: httpErr(r) };
              await resyncEntity(sb, acc, key, "ad_group", id);
              return { ok: true };
            },
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "insights-breakdown") {
          // Aufschlüsselung nach Land/Gerät/Plattform — ein Segment je Request
          // (Doku), live abgefragt, nicht gespeichert.
          const segment = String(body?.segment || "country");
          if (!["country", "device", "platform"].includes(segment))
            return Response.json({ ok: false, error: "segment ungültig" }, { status: 400 });
          const campaignId = String(body?.campaignId || "").trim() || null;
          // granularity "daily" (15.09., Dashboard-Trend mit Segmentierung):
          // Zeilen tragen zusätzlich date.
          const daily = body?.granularity === "daily";
          // Zeitraum exakt validiert (Reihenfolge, Zukunft, max. 366 Tage).
          let zrB;
          try {
            zrB = zeitraum({
              startDate: String(body?.start || ""),
              endDate: String(body?.end || ""),
              maxDays: 366,
            });
          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 400 },
            );
          }
          const { startDate: start, endDate: end } = zrB;
          if (acc.is_mock) {
            let q = sb
              .from("chatgpt_ads_insights_daily")
              .select("date, impressions, clicks, spend, conversions")
              .eq("account_id", acc.id)
              .eq("scope", "campaign")
              .gte("date", start)
              .lte("date", end);
            if (campaignId) q = q.eq("scope_openai_id", campaignId);
            const { data: rowsDb } = await q;
            const tot = (rowsDb || []).reduce(
              (a: any, r: any) => ({
                imp: a.imp + Number(r.impressions || 0),
                clk: a.clk + Number(r.clicks || 0),
                sp: a.sp + Number(r.spend || 0),
                cv: a.cv + Number(r.conversions || 0),
              }),
              { imp: 0, clk: 0, sp: 0, cv: 0 },
            );
            if (daily) {
              const byDay: Record<string, any> = {};
              for (const r0 of rowsDb || []) {
                const d = (byDay[r0.date] ??= { imp: 0, clk: 0, sp: 0, cv: 0 });
                d.imp += Number(r0.impressions || 0);
                d.clk += Number(r0.clicks || 0);
                d.sp += Number(r0.spend || 0);
                d.cv += Number(r0.conversions || 0);
              }
              const rows = Object.entries(byDay)
                .sort(([a], [b]) => a.localeCompare(b))
                .flatMap(([date, d]: any) =>
                  MOCK_SPLIT[segment].map(([label, f]) => ({
                    date,
                    label,
                    impressions: Math.round(d.imp * f),
                    clicks: Math.round(d.clk * f),
                    spend: Math.round(d.sp * f * 100) / 100,
                    conversions: Math.round(d.cv * f),
                  })),
                );
              return Response.json({ ok: true, segment, rows, mock: true });
            }
            const rows = MOCK_SPLIT[segment].map(([label, f]) => ({
              label,
              impressions: Math.round(tot.imp * f),
              clicks: Math.round(tot.clk * f),
              spend: Math.round(tot.sp * f * 100) / 100,
              conversions: Math.round(tot.cv * f),
            }));
            return Response.json({ ok: true, segment, rows, mock: true });
          }
          const key = keyOf();
          if (key instanceof Response) return key;
          const labelField =
            segment === "country"
              ? "country.name"
              : segment === "device"
                ? "device.type"
                : "platform";
          const fields = [
            labelField,
            ...(daily ? ["metadata.readable_time"] : []),
            `${segment}.impressions`,
            `${segment}.clicks`,
            `${segment}.spend`,
            "conversions",
          ];
          const path = campaignId ? `/campaigns/${campaignId}/insights` : "/ad_account/insights";
          const tr = JSON.stringify({
            type: "date_range",
            since: start,
            until: end,
            timezone: acc.timezone || "UTC",
          });
          let r = await adsFetch(key, acc.openai_ad_account_id, path, {
            query: {
              time_granularity: daily ? "daily" : "none",
              aggregation_level: campaignId ? "campaign" : "ad_account",
              limit: "500",
              "time_ranges[]": [tr],
              "segments[]": [segment],
              "fields[]": fields,
            },
          });
          if (!r.ok && r.status === 400)
            r = await adsFetch(key, acc.openai_ad_account_id, path, {
              query: {
                time_granularity: daily ? "daily" : "none",
                aggregation_level: campaignId ? "campaign" : "ad_account",
                limit: "500",
                "time_ranges[]": [tr],
                "segments[]": [segment],
                "fields[]": fields.slice(0, 4),
              },
            });
          if (!r.ok) return Response.json({ ok: false, error: httpErr(r) }, { status: 502 });
          const rows = (r.json?.data || []).map((row: any) => ({
            ...(daily
              ? { date: row.readable_time?.slice(0, 10) || tsToIso(row.start_time)?.slice(0, 10) }
              : {}),
            label: String(row.country_name ?? row.device_type ?? row.platform ?? "?"),
            impressions: Number(row[`${segment}_impressions`] ?? row.impressions ?? 0),
            clicks: Number(row[`${segment}_clicks`] ?? row.clicks ?? 0),
            spend: Number(row[`${segment}_spend`] ?? row.spend ?? 0),
            conversions: row.conversions != null ? Number(row.conversions) : null,
          }));
          return Response.json({ ok: true, segment, rows });
        }

        if (action === "account-command") {
          const cmd = String(body?.cmd || "");
          if (cmd !== "pause" && cmd !== "activate")
            return Response.json({ ok: false, error: "cmd ungültig" }, { status: 400 });
          const res = await withAudit(
            sb,
            acc,
            `account_${cmd}`,
            "ad_account",
            acc.openai_ad_account_id,
            null,
            actor,
            async () => {
              if (acc.is_mock) {
                const meta = { ...(acc.meta || {}), status: cmd === "pause" ? "paused" : "active" };
                await sb.from("chatgpt_ads_accounts").update({ meta }).eq("id", acc.id);
                return { ok: true };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              const r = await adsFetch(key, acc.openai_ad_account_id, `/ad_account/${cmd}`, {
                method: "POST",
              });
              if (!r.ok) return { ok: false, error: httpErr(r) };
              const meta = await fetchAccountMeta(key, acc.openai_ad_account_id);
              if (meta) await sb.from("chatgpt_ads_accounts").update({ meta }).eq("id", acc.id);
              return { ok: true };
            },
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        if (action === "audience-modify") {
          // Liste ergänzen/entfernen (Spec v2.3.0: /add, /remove mit Inline-
          // Identifiern ≤ 10'000 je Request, Idempotency-Key Pflicht). Hashes
          // kommen wie beim Upload nur als 64-Hex an.
          const audienceId = String(body?.audienceId || "");
          const op = body?.op === "remove" ? "remove" : "add";
          const identifierType = String(body?.identifierType || "email_sha256");
          const hashes: string[] = Array.from(
            new Set(
              (Array.isArray(body?.hashes) ? body.hashes : [])
                .map((h: any) => String(h).trim().toLowerCase())
                .filter((h: string) => /^[0-9a-f]{64}$/.test(h)),
            ),
          );
          if (!audienceId || !AUDIENCE_ID_TYPES.includes(identifierType) || !hashes.length)
            return Response.json(
              { ok: false, error: "audienceId, identifierType und Hashes erforderlich" },
              { status: 400 },
            );
          if (hashes.length > 200_000)
            return Response.json(
              { ok: false, error: "Maximal 200'000 je Vorgang" },
              { status: 400 },
            );
          const res = await withAudit(
            sb,
            acc,
            `audience_${op}`,
            "custom_audience",
            audienceId,
            { count: hashes.length, identifierType },
            actor,
            async () => {
              if (acc.is_mock) {
                const { data: cur } = await sb
                  .from("chatgpt_ads_audiences")
                  .select("identifier_count")
                  .eq("account_id", acc.id)
                  .eq("openai_audience_id", audienceId)
                  .maybeSingle();
                if (!cur) return { ok: false, error: "Zielgruppe unbekannt" };
                const n = Math.max(
                  0,
                  Number(cur.identifier_count || 0) +
                    (op === "add" ? hashes.length : -hashes.length),
                );
                await sb
                  .from("chatgpt_ads_audiences")
                  .update({
                    identifier_count: n,
                    status: "processing",
                    synced_at: new Date().toISOString(),
                  })
                  .eq("account_id", acc.id)
                  .eq("openai_audience_id", audienceId);
                return { ok: true, operations: 1 };
              }
              const key = keyOf();
              if (key instanceof Response) return { ok: false, error: "Key nicht lesbar" };
              let ops = 0;
              for (let i = 0; i < hashes.length; i += 10_000) {
                const chunk = hashes.slice(i, i + 10_000);
                const g0 = await adsFetch(
                  key,
                  acc.openai_ad_account_id,
                  `/custom_audiences/${audienceId}`,
                );
                const rev = g0.json?.membership_revision ?? g0.json?.revision;
                const r = await adsFetch(
                  key,
                  acc.openai_ad_account_id,
                  `/custom_audiences/${audienceId}/${op}`,
                  {
                    method: "POST",
                    headers: { "Idempotency-Key": crypto.randomUUID() },
                    body: {
                      identifier_type: identifierType,
                      identifiers: chunk.map((h) => ({
                        identifier_type: identifierType,
                        identifier: h,
                      })),
                      ...(rev != null ? { expected_revision: Number(rev) } : {}),
                    },
                  },
                );
                if (!r.ok) return { ok: false, error: httpErr(r) };
                ops++;
              }
              await syncAudiences(sb, acc, key);
              return { ok: true, operations: ops };
            },
          );
          return res.ok
            ? Response.json({ ok: true, operations: (res as any).operations })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        return Response.json({ ok: false, error: `Unbekannte action: ${action}` }, { status: 400 });
      },
    },
  },
});

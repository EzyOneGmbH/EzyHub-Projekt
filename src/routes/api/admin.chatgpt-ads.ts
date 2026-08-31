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
// GET  ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
//      -> { ok, connected, account, campaigns, insights, commands }
// POST { action: "connect" | "sync" | "sync-all" | "command", ... }
//      connect (owner/admin): { clientId, apiKey, adAccountId? }
//      sync    (owner/admin): { clientId }
//      command (owner/admin): { clientId, cmd: "pause"|"activate"|"set_budget",
//                               targetType: "campaign", targetId, budgetDailyMicros? }
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

const micros = (v: any): number | null => (v == null ? null : Number(v));
const tsToIso = (v: any): string | null =>
  v == null ? null : new Date(Number(v) * 1000).toISOString();

// ── Entity-Sync (WF-1 der Spec, hier serverseitig) ───────────────────────────
async function syncAccount(sb: any, acc: any): Promise<any> {
  if (acc.is_mock) return mockSync(sb, acc);
  const apiKey = decryptSecret(acc.api_key_enc);
  const campaigns = await adsListAll(apiKey, acc.openai_ad_account_id, "/campaigns");
  for (const c of campaigns) {
    await sb.from("chatgpt_ads_campaigns").upsert(
      {
        account_id: acc.id,
        openai_campaign_id: String(c.id),
        name: String(c.name || ""),
        status: String(c.status || ""),
        bidding_type: c.bidding_type ?? null,
        objective: c.objective ?? null,
        budget_daily_micros: micros(c.budget?.daily_spend_limit_micros),
        budget_lifetime_micros: micros(c.budget?.lifetime_spend_limit_micros),
        start_time: tsToIso(c.start_time),
        end_time: tsToIso(c.end_time),
        raw: c,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,openai_campaign_id" },
    );
  }
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
  return { campaigns: campaigns.length, adGroups, ads, insightRows };
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
        raw: { id: c.id, mock: true },
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

  if (acc.is_mock) {
    // Mock: nur DB-Status/Budget aendern — kein API-Call.
    const upd: any =
      cmd === "set_budget"
        ? { budget_daily_micros: Number(payload?.budgetDailyMicros || 0) || null }
        : { status: cmd === "pause" ? "paused" : "active" };
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
  } else {
    return finish(false, `Unbekanntes Kommando: ${cmd}`);
  }
  if (!r.ok) return finish(false, `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}`);
  // Betroffenes Objekt sofort re-syncen (kein Fire-and-Forget, Spec §4 WF-3).
  const g = await adsFetch(apiKey, acc.openai_ad_account_id, `/campaigns/${targetId}`);
  if (g.ok && g.json?.id) {
    const c = g.json;
    await sb
      .from("chatgpt_ads_campaigns")
      .update({
        name: String(c.name || ""),
        status: String(c.status || ""),
        budget_daily_micros: micros(c.budget?.daily_spend_limit_micros),
        budget_lifetime_micros: micros(c.budget?.lifetime_spend_limit_micros),
        raw: c,
        synced_at: new Date().toISOString(),
      })
      .eq("account_id", acc.id)
      .eq("openai_campaign_id", targetId);
  }
  return finish(true);
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

        const [{ data: campaigns }, { data: insights }, { data: commands }] = await Promise.all([
          sb
            .from("chatgpt_ads_campaigns")
            .select(
              "openai_campaign_id, name, status, bidding_type, objective, budget_daily_micros, budget_lifetime_micros, synced_at",
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
        ]);
        return Response.json({
          ok: true,
          connected: true,
          account: acc,
          campaigns: campaigns || [],
          insights: insights || [],
          commands: commands || [],
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
          if (!["pause", "activate", "set_budget"].includes(cmd) || !targetId)
            return Response.json({ ok: false, error: "cmd/targetId ungültig" }, { status: 400 });
          const res = await runCommand(
            sb,
            acc,
            cmd,
            targetId,
            { budgetDailyMicros: body?.budgetDailyMicros },
            ctx.userId ?? null,
          );
          return res.ok
            ? Response.json({ ok: true })
            : Response.json({ ok: false, error: res.error }, { status: 502 });
        }

        return Response.json({ ok: false, error: `Unbekannte action: ${action}` }, { status: 400 });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Content-Performance-Sync (agentenunabhängig). Läuft server-seitig mit dem
// service_role-Client (Lovable Cloud hält den Key intern; n8n/extern kommt NICHT
// an die DB). Wiederverwendung der bestehenden populate-Bausteine:
//   getGoogleAccessToken(client) -> per-Kunde GSC/GA4-Token (kein OAuth-Setup nötig)
// Zwei Phasen je Kunde:
//   1) discover : WP-REST /wp/v2/posts -> upsert content_items (alle publizierten
//                 Blogartikel, auch die direkt auf der Kundenseite erstellten)
//   2) metrics  : GSC (date+page + top-query) + GA4 (date+pagePath) in WENIGEN
//                 Calls je Kunde -> upsert content_metrics (captured_on =
//                 heute-5..heute-3, holt Cron-Ausfaelle selbst nach) und
//                 primary_keyword-Backfill aus der GSC-Top-Query
// Secret-gated (ADMIN_AUTOMATION_SECRET), keine willkürliche SQL, keine Deletes.

const Body = z.object({
  client: z.string().optional(), // Name (ilike) oder uuid
  all: z.boolean().optional(),
  jobs: z.array(z.enum(["discover", "metrics", "inspect", "backfill", "sitemaps"])).optional(),
  perPage: z.number().int().min(1).max(100).default(100), // WP-Posts pro Seite
  maxPages: z.number().int().min(1).max(20).default(10), // WP-Pagination-Cap
  // URL-Inspections je Kunde und Lauf. Default bewusst 25: jede Inspection
  // kostet ~1,5s, und der Lovable-Gateway kappt bei ~300s — mit 50 lief
  // Studioforma (95 Artikel) im Test in den Timeout. 25/Lauf rotiert den
  // Bestand in wenigen Tagen durch und bleibt weit unter der GSC-Quota.
  inspectLimit: z.number().int().min(1).max(200).default(25),
  backfillDays: z.number().int().min(28).max(480).default(90), // GSC-Historie (max ~16 Monate)
  // Sitemap-Einreichung (Nutzerentscheid 04.08.):
  //   "auto"  = nur bei Kunden mit autonom geschaltetem SEO-Agenten einreichen,
  //             alle anderen nur beobachten. Das ist der Regelfall.
  //   true    = erzwingen (bewusster Admin-Eingriff)
  //   false   = nie einreichen, reiner Report
  submitSitemaps: z.union([z.boolean(), z.literal("auto")]).default("auto"),
  // Ad-hoc-Indexpruefung beliebiger URLs des Kunden (Diagnose). Ohne diesen
  // Parameter prueft inspect wie gewohnt die Blogartikel aus content_items.
  // Anlass: Bei FIH war die Frage "ist /blog/ selbst im Index?" nicht
  // beantwortbar, weil /blog/ kein content_item ist — und eine site:-Abfrage
  // ist dafuer kein Beweis. Ergebnis wird NICHT gespeichert (kein Artikel).
  inspectUrls: z.array(z.string().url()).max(20).optional(),
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const nowIso = () => new Date().toISOString();
// Referenztag = heute-3 (letzter vollständiger GSC-Tag), YYYY-MM-DD.
function refDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}
// Referenzspanne heute-5..heute-3: nimmt bei einem Cron-Ausfall die zwei
// Vortage automatisch mit (Selbstheilung der Zeitreihe, upsert ist idempotent).
function refDates(): string[] {
  const out: string[] = [];
  for (let back = 5; back >= 3; back--) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
// GA4 liefert das date-Dimension-Format YYYYMMDD -> YYYY-MM-DD.
const ga4Date = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
// URL normalisieren für Map-Matching (ohne Protokoll/trailing slash, lowercase).
function normUrl(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
function pathOf(u: string): string {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}
const cleanDomain = (d: string) =>
  String(d || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

// ── 1) Discovery: publizierte WP-Posts -> content_items ─────────────────────
async function jobDiscover(c: any, perPage: number, maxPages: number) {
  const domain = cleanDomain(c.domain);
  if (!domain) return { skipped: "keine Domain" };
  const rows: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = `https://${domain}/wp-json/wp/v2/posts?status=publish&per_page=${perPage}&page=${page}&_fields=id,link,title,date`;
    let res: Response;
    try {
      res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      return { error: redactSecrets(e), imported: rows.length };
    }
    if (res.status === 400) break; // WP: Seite über letzter -> Ende der Pagination
    if (!res.ok) return { error: `WP HTTP ${res.status}`, imported: rows.length };
    const posts: any[] = await res.json().catch(() => []);
    if (!Array.isArray(posts) || posts.length === 0) break;
    for (const p of posts) {
      const link = String(p?.link || "");
      if (!link) continue;
      rows.push({
        client_id: c.id,
        title: p?.title?.rendered ? String(p.title.rendered) : "(ohne Titel)",
        target_url: link,
        published_at: String(p?.date || "").slice(0, 10) || null,
        status: "published",
        content_type: "blog",
        language: c.language || "de",
        source: "discovered",
      });
    }
    if (posts.length < perPage) break;
  }
  if (!rows.length) return { imported: 0 };
  // Idempotent: braucht den partial unique index (client_id, target_url) aus
  // 20260703140000_content_discovery.sql. WP-Datum ist maßgeblich für published_at.
  const { error } = await supabaseAdmin
    .from("content_items")
    .upsert(rows as never, { onConflict: "client_id,target_url", ignoreDuplicates: false });
  if (error) return { error: error.message, attempted: rows.length };
  return { imported: rows.length };
}

// ── 2) Metrics: GSC + GA4 (wenige Calls) -> content_metrics ─────────────────
async function jobMetrics(c: any) {
  // Nur Kunden mit publiziertem, entdecktem/manuellem Content.
  const { data: items } = await supabaseAdmin
    .from("content_items")
    .select("id, target_url, primary_keyword")
    .eq("client_id", c.id)
    .eq("status", "published")
    .not("target_url", "is", null);
  if (!items || !items.length) return { skipped: "keine Artikel" };

  const refs = refDates(); // heute-5 .. heute-3
  const ref = refs[refs.length - 1];
  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const gApi = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok)
      throw new Error(`HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}`);
    return (await r.json()) as any;
  };

  // --- GSC: page-level Metriken je Tag der Referenzspanne (1 Call) ---
  const gscByDayUrl = new Map<string, any>(); // key: `${date}|${normUrl}`
  const topQueryByUrl = new Map<string, string>();
  let gscFailed = false;
  if (c.gsc_property) {
    const gscUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      c.gsc_property,
    )}/searchAnalytics/query`;
    try {
      const pg = await gApi(gscUrl, {
        startDate: refs[0],
        endDate: ref,
        dimensions: ["date", "page"],
        rowLimit: 25000,
      });
      for (const row of pg.rows ?? [])
        gscByDayUrl.set(`${row.keys?.[0] ?? ""}|${normUrl(row.keys?.[1] ?? "")}`, row);
    } catch {
      // Call fehlgeschlagen -> GSC-Spalten NICHT mit Nullen ueberschreiben.
      gscFailed = true;
    }
    // Top-Query je Seite über 28 Tage (1 Call) -> primary_keyword-Backfill.
    // rowLimit = GSC-Maximum: bei grossen Properties (Studioforma) fielen
    // klickarme Blog-Seiten sonst hinter dem 5000er-Cut raus -> kein Keyword.
    try {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const pq = await gApi(gscUrl, {
        startDate: start.toISOString().slice(0, 10),
        endDate: ref,
        dimensions: ["page", "query"],
        rowLimit: 25000,
        orderBy: [{ field: "clicks", descending: true }],
      });
      for (const row of pq.rows ?? []) {
        const key = normUrl(row.keys?.[0] ?? "");
        if (!topQueryByUrl.has(key) && row.keys?.[1]) topQueryByUrl.set(key, String(row.keys[1]));
      }
    } catch {
      /* optional */
    }
  }

  // --- GA4: sessions/conversions je Tag+pagePath (1 Call) ---
  const ga4ByDayPath = new Map<string, { sessions: number; conversions: number }>(); // key: `${date}|${path}`
  let ga4Failed = false;
  if (c.ga4_property) {
    const propertyId = String(c.ga4_property).replace(/^properties\//, "");
    const ga4Url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
      propertyId,
    )}:runReport`;
    try {
      const rep = await gApi(ga4Url, {
        dateRanges: [{ startDate: refs[0], endDate: ref }],
        dimensions: [{ name: "date" }, { name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        limit: 3000,
      });
      for (const row of rep.rows ?? []) {
        const day = ga4Date(String(row.dimensionValues?.[0]?.value ?? ""));
        const p = String(row.dimensionValues?.[1]?.value ?? "").replace(/\/+$/, "") || "/";
        ga4ByDayPath.set(`${day}|${p.toLowerCase()}`, {
          sessions: Number(row.metricValues?.[0]?.value ?? 0),
          conversions: Number(row.metricValues?.[1]?.value ?? 0),
        });
      }
    } catch {
      // Call fehlgeschlagen -> GA4-Spalten NICHT mit Nullen ueberschreiben.
      ga4Failed = true;
    }
  }
  if (gscFailed && ga4Failed) return { error: "GSC- und GA4-Abruf fehlgeschlagen" };

  // --- Rows bauen + upserten (je Artikel × Referenztag). Bei fehlgeschlagenem
  // GSC-/GA4-Call fehlen dessen Spalten im Payload -> Upsert laesst Bestand stehen. ---
  const metricRows: any[] = [];
  const kwUpdates: Array<{ id: string; primary_keyword: string }> = [];
  for (const it of items) {
    const key = normUrl(it.target_url);
    const path = pathOf(it.target_url).toLowerCase();
    for (const day of refs) {
      const g = gscByDayUrl.get(`${day}|${key}`);
      const ga = ga4ByDayPath.get(`${day}|${path}`);
      const row: any = { content_item_id: it.id, captured_on: day };
      if (!gscFailed) {
        row.position = g ? (g.position ?? null) : null;
        row.impressions = g ? Math.round(g.impressions ?? 0) : 0;
        row.clicks = g ? Math.round(g.clicks ?? 0) : 0;
        row.ctr = g ? (g.ctr ?? null) : null;
      }
      if (!ga4Failed) {
        row.sessions = ga ? ga.sessions : 0;
        row.conversions = ga ? ga.conversions : 0;
      }
      metricRows.push(row);
    }
    const tq = topQueryByUrl.get(key);
    if (tq && (!it.primary_keyword || it.primary_keyword === "")) {
      kwUpdates.push({ id: it.id, primary_keyword: tq });
    }
  }

  let upserted = 0;
  if (metricRows.length) {
    const { error } = await supabaseAdmin
      .from("content_metrics")
      .upsert(metricRows as never, { onConflict: "content_item_id,captured_on" });
    if (error) return { error: error.message };
    upserted = metricRows.length;
  }
  // primary_keyword-Backfill (nur leere).
  for (const k of kwUpdates) {
    await supabaseAdmin
      .from("content_items")
      .update({ primary_keyword: k.primary_keyword })
      .eq("id", k.id)
      .or("primary_keyword.is.null,primary_keyword.eq.");
  }
  return {
    articles: items.length,
    metrics: upserted,
    keywords: kwUpdates.length,
    days: refs,
    ...(gscFailed ? { gscFailed: true } : {}),
    ...(ga4Failed ? { ga4Failed: true } : {}),
  };
}

// ── 2b) Backfill: GSC-Historie einmalig nachladen (date+page, N Tage) ────────
// Grund (22.07., Hotel Baeren): Die Messung beginnt erst mit der Kunden-
// Anbindung — ein 500 Tage alter Artikel stand nach 4 Messtagen auf "Zu wenig
// Daten", obwohl GSC die Historie laengst kennt. Dieser Job fuellt
// content_metrics rueckwirkend, ohne bestehende Sync-Tage zu ueberschreiben
// (ignoreDuplicates). Es werden Zeilen fuer ALLE Tage geschrieben (auch
// 0-Impression-Tage): die Coverage-Zaehlung (measured_days_28) braucht sie,
// sonst blieben genau die unsichtbaren Artikel auf "Zu wenig Daten" haengen.
// GA4 wird nicht rueckgefuellt (sekundaer; fehlende Spalten -> Insert-Default 0).
async function jobBackfill(c: any, days: number) {
  if (!c.gsc_property) return { skipped: "keine GSC-Property" };
  const { data: items } = await supabaseAdmin
    .from("content_items")
    .select("id, target_url")
    .eq("client_id", c.id)
    .eq("status", "published")
    .eq("content_type", "blog")
    .not("target_url", "is", null);
  if (!items || !items.length) return { skipped: "keine Artikel" };
  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const end = refDate(); // letzter vollstaendiger GSC-Tag
  const startD = new Date();
  startD.setDate(startD.getDate() - 3 - days);
  const start = startD.toISOString().slice(0, 10);
  const gscUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    c.gsc_property,
  )}/searchAnalytics/query`;
  const byDayUrl = new Map<string, any>();
  for (let startRow = 0; startRow < 75_000; startRow += 25_000) {
    const r = await fetch(gscUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start,
        endDate: end,
        dimensions: ["date", "page"],
        rowLimit: 25_000,
        startRow,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok)
      return { error: `GSC HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}` };
    const j = (await r.json()) as any;
    const rows = j.rows ?? [];
    for (const row of rows)
      byDayUrl.set(`${row.keys?.[0] ?? ""}|${normUrl(row.keys?.[1] ?? "")}`, row);
    if (rows.length < 25_000) break;
  }
  const allDays: string[] = [];
  for (const d = new Date(start); d.toISOString().slice(0, 10) <= end; d.setDate(d.getDate() + 1))
    allDays.push(d.toISOString().slice(0, 10));
  const rows: any[] = [];
  for (const it of items) {
    const key = normUrl(it.target_url);
    for (const day of allDays) {
      const g = byDayUrl.get(`${day}|${key}`);
      rows.push({
        content_item_id: it.id,
        captured_on: day,
        position: g ? (g.position ?? null) : null,
        impressions: g ? Math.round(g.impressions ?? 0) : 0,
        clicks: g ? Math.round(g.clicks ?? 0) : 0,
        ctr: g ? (g.ctr ?? null) : null,
      });
    }
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const { error } = await supabaseAdmin.from("content_metrics").upsert(chunk as never, {
      onConflict: "content_item_id,captured_on",
      ignoreDuplicates: true,
    });
    if (error) return { error: error.message, written };
    written += chunk.length;
  }
  return { articles: items.length, days: allDays.length, rows: rows.length, from: start, to: end };
}

// ── 3) Inspect: GSC URL-Inspection-API -> echtes Google-Index-Urteil ────────
// Seit 04.08. IM Default-Jobset (mit kleinem Limit) und das Urteil wird in
// content_items PERSISTIERT. Vorher lief der Job nie automatisch und sein
// Ergebnis lebte nur im HTTP-Response — deshalb blieb monatelang unbemerkt,
// dass bei Faith in Humanity KEIN einziger Artikel im Google-Index war.
// Quota: 2000 Inspections/Tag je Property, wir bleiben mit dem Default-Limit
// weit darunter.
// Kandidaten-Reihenfolge: am laengsten nicht geprueft zuerst (nie geprueft
// ganz vorn) — so rotiert der Regellauf ueber den gesamten Bestand, statt
// immer dieselben Artikel zu befragen.
async function jobInspect(c: any, limit: number, urls?: string[]) {
  if (!c.gsc_property) return { skipped: "keine GSC-Property" };
  // Ad-hoc-Modus: uebergebene URLs pruefen statt der Artikel aus dem Register.
  // id = null markiert "gehoert zu keinem content_item" -> nicht speichern.
  const items = urls?.length
    ? urls.map((u) => ({ id: null as string | null, target_url: u, index_checked_at: null }))
    : (
        await supabaseAdmin
          .from("content_items")
          .select("id, target_url, index_checked_at")
          .eq("client_id", c.id)
          .eq("status", "published")
          .eq("content_type", "blog")
          .not("target_url", "is", null)
          .order("index_checked_at", { ascending: true, nullsFirst: true })
          .limit(limit)
      ).data;
  if (!items || !items.length) return { skipped: "keine Artikel" };

  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }

  const results: any[] = [];
  for (const it of items) {
    try {
      const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionUrl: it.target_url, siteUrl: c.gsc_property }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) {
        // Fehler NICHT als "nicht indexiert" speichern — sonst faerbt eine
        // Quota-/Token-Stoerung das Dashboard rot. Zeile bleibt unveraendert.
        results.push({
          url: it.target_url,
          error: `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}`,
        });
        continue;
      }
      const j = (await r.json()) as any;
      const s = j?.inspectionResult?.indexStatusResult ?? {};
      const verdict = s.verdict ?? null; // PASS = indexiert
      const coverage = s.coverageState ?? null; // z.B. "URL is unknown to Google"
      // Nur echte Artikel fortschreiben — Ad-hoc-URLs haben keine Zeile.
      if (it.id) {
        await supabaseAdmin
          .from("content_items")
          .update({
            index_verdict: verdict,
            index_coverage: coverage,
            index_checked_at: nowIso(),
            index_last_crawl: s.lastCrawlTime ?? null,
          } as never)
          .eq("id", it.id);
      }
      results.push({
        url: it.target_url,
        verdict,
        coverage,
        robots: s.robotsTxtState ?? null,
        lastCrawl: s.lastCrawlTime ?? null,
        googleCanonical: s.googleCanonical ?? null,
      });
    } catch (e) {
      results.push({ url: it.target_url, error: redactSecrets(e) });
    }
  }
  return {
    inspected: results.length,
    indexed: results.filter((x) => x.verdict === "PASS").length,
    notIndexed: results.filter((x) => x.verdict && x.verdict !== "PASS").length,
    // "unbekannt" ist der schwerwiegendste Fall: Google hat die URL nie
    // gesehen — das ist ein Auffindbarkeits-, kein Qualitaetsproblem.
    unknownToGoogle: results.filter((x) => /unknown to Google/i.test(x.coverage || "")).length,
    results,
  };
}

// ── 4) Sitemaps: in der Search Console eingereicht? ─────────────────────────
// Zweiter Teil desselben Befunds: Bei FIH stand die Sitemap NUR in der
// robots.txt. Google verarbeitet sie so zwar irgendwann, aber deutlich
// traeger als eine eingereichte Sitemap — genau deshalb blieben die
// Blogartikel unentdeckt, waehrend die (aelteren, verlinkten) Kernseiten
// laengst im Index waren.
// Der Job liest die Sitemap-URLs aus der robots.txt des Kunden, vergleicht sie
// mit den in der GSC eingereichten und reicht Fehlende per PUT nach.
// submit=false => reiner Report, es wird nichts eingereicht.
async function jobSitemaps(c: any, submitMode: boolean | "auto") {
  if (!c.gsc_property) return { skipped: "keine GSC-Property" };
  const domain = cleanDomain(c.domain);
  if (!domain) return { skipped: "keine Domain" };

  // Autonomie-Gate: einreichen nur, wenn dieser Kunde einen SEO-Agenten hat,
  // der auf autonom geschaltet ist (metadata.seo_autonom, gepflegt vom
  // agent-service via /api/admin/client-flags). Kunden ohne Agent — z.B.
  // Embassy Jewel — werden ausschliesslich beobachtet.
  const autonom = (c.metadata as any)?.seo_autonom === true;
  const submit = submitMode === "auto" ? autonom : submitMode;

  // 1) Sitemap-URLs der Website ermitteln (robots.txt ist die Selbstauskunft).
  // Dedupliziert: mehrere Kunden-robots.txt (ezyhotel.ch, timeout-memberclub.com)
  // nennen dieselbe Sitemap doppelt — ohne Dedup wuerde sie zweimal
  // eingereicht und zweimal als "fehlend" gemeldet.
  const seen = new Set<string>();
  const declared: string[] = [];
  const addDeclared = (u: string) => {
    const key = normUrl(u);
    if (key && !seen.has(key)) {
      seen.add(key);
      declared.push(u);
    }
  };
  try {
    const rb = await fetch(`https://${domain}/robots.txt`, { signal: AbortSignal.timeout(15_000) });
    if (rb.ok) {
      const txt = await rb.text();
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
        if (m) addDeclared(m[1].trim());
      }
    }
  } catch {
    /* robots.txt optional — Fallback unten */
  }
  // Fallback: WordPress-Standard, wenn die robots.txt nichts nennt.
  if (!declared.length) {
    for (const cand of [
      `https://${domain}/wp-sitemap.xml`,
      `https://${domain}/sitemap_index.xml`,
    ]) {
      try {
        const r = await fetch(cand, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
          addDeclared(cand);
          break;
        }
      } catch {
        /* naechster Kandidat */
      }
    }
  }
  if (!declared.length) return { skipped: "keine Sitemap gefunden" };

  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    c.gsc_property,
  )}/sitemaps`;

  // 2) Bereits eingereichte Sitemaps holen.
  let submitted: string[] = [];
  try {
    const r = await fetch(base, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok)
      return {
        error: `GSC-Sitemapliste HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}`,
      };
    const j = (await r.json()) as any;
    submitted = (j.sitemap ?? []).map((s: any) => String(s.path || ""));
  } catch (e) {
    return { error: redactSecrets(e) };
  }

  const missing = declared.filter((d) => !submitted.some((s) => normUrl(s) === normUrl(d)));
  if (!submit)
    return {
      declared,
      submitted,
      missing,
      submittedNow: [],
      modus:
        submitMode === "auto"
          ? "beobachten (kein autonomer SEO-Agent)"
          : "beobachten (abgeschaltet)",
    };

  // 3) Fehlende nachreichen (PUT ist idempotent; Google akzeptiert nur
  //    Sitemaps innerhalb der Property).
  const submittedNow: string[] = [];
  const errors: any[] = [];
  let scopeMissing = false;
  for (const url of missing) {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(url)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        submittedNow.push(url);
        continue;
      }
      const body = (await r.text().catch(() => "")).slice(0, 200);
      // Der haeufigste und einzig strukturelle Fehlerfall: unsere Google-
      // Verbindung hat nur den Lese-Scope (webmasters.readonly). Einreichen
      // braucht den Schreib-Scope (webmasters) — das erfordert eine neue
      // Einwilligung je Kunde und ist nichts, was der Lauf selbst loesen kann.
      // Deshalb hier als klarer Klartext-Hinweis statt als roher 403-Dump.
      if (r.status === 403 && /insufficient authentication scopes/i.test(body)) {
        scopeMissing = true;
        errors.push({
          url,
          error:
            "Google-Verbindung hat nur Lese-Rechte (webmasters.readonly). Zum Einreichen ist der Scope 'webmasters' noetig — Kunde muss die Google-Verbindung neu freigeben.",
        });
        continue;
      }
      errors.push({ url, error: `HTTP ${r.status}: ${body.slice(0, 120)}` });
    } catch (e) {
      errors.push({ url, error: redactSecrets(e) });
    }
  }
  // 4) Verwaiste Sitemaps aus der GSC entfernen.
  // Anlass (FIH, 04.08.): Nach der Yoast-Installation ersetzte
  // sitemap_index.xml die Core-Sitemap wp-sitemap.xml — die alte war aber in
  // der GSC eingereicht und lieferte fortan einen Redirect, was dort als
  // Fehler auflaeuft. Ohne dieses Aufraeumen bleibt bei jedem Sitemap-Wechsel
  // eine Karteileiche zurueck.
  // Bewusst konservativ: entfernt wird NUR, was die Website selbst nicht mehr
  // deklariert UND live nicht mehr mit 200 antwortet. Eine voruebergehend
  // nicht erreichbare Sitemap wird dadurch nicht geloescht.
  const removed: string[] = [];
  for (const s of submitted) {
    if (declared.some((d) => normUrl(d) === normUrl(s))) continue; // weiterhin deklariert
    let lebt = true;
    try {
      const probe = await fetch(s, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      lebt = probe.status === 200;
    } catch {
      lebt = true; // im Zweifel NICHT loeschen
    }
    if (lebt) continue;
    try {
      const r = await fetch(`${base}/${encodeURIComponent(s)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) removed.push(s);
    } catch {
      /* nicht kritisch */
    }
  }

  return {
    declared,
    submitted,
    missing,
    submittedNow,
    ...(removed.length ? { removed } : {}),
    modus: submitMode === "auto" ? "autonom (SEO-Agent)" : "erzwungen",
    ...(scopeMissing ? { scopeMissing: true } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

export const Route = createFileRoute("/api/admin/content-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const {
          client: sel,
          all,
          jobs,
          perPage,
          maxPages,
          inspectLimit,
          backfillDays,
          submitSitemaps,
          inspectUrls,
        } = parsed.data;
        // Seit 04.08. gehoert die Indexpruefung zum Regellauf: ohne sie faellt
        // nicht auf, wenn Google publizierte Artikel gar nicht kennt. inspect
        // rotiert ueber den Bestand (aelteste Pruefung zuerst), sitemaps
        // stellt sicher, dass Google die Sitemap ueberhaupt kennt.
        const wanted =
          jobs && jobs.length ? jobs : (["discover", "metrics", "inspect", "sitemaps"] as const);

        const query = supabaseAdmin
          .from("clients")
          .select(
            "id, name, domain, organization_id, gsc_property, ga4_property, language, metadata",
          );
        let clients: any[] = [];
        // Pausierte Kunden (Admin-Status "paused") überspringen Sammel-Läufe.
        if (all)
          clients = ((await query).data || []).filter(
            (c: any) => (c?.metadata ?? {})?.status !== "paused",
          );
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else
          return Response.json(
            { ok: false, error: "client oder all erforderlich" },
            { status: 400 },
          );
        if (!clients.length)
          return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

        const results: any[] = [];
        for (const c of clients) {
          const jr: Record<string, unknown> = {};
          for (const j of wanted) {
            try {
              if (j === "discover") jr.discover = await jobDiscover(c, perPage, maxPages);
              else if (j === "metrics") jr.metrics = await jobMetrics(c);
              else if (j === "inspect") jr.inspect = await jobInspect(c, inspectLimit, inspectUrls);
              else if (j === "backfill") jr.backfill = await jobBackfill(c, backfillDays);
              else if (j === "sitemaps") jr.sitemaps = await jobSitemaps(c, submitSitemaps);
            } catch (e) {
              jr[j] = { error: redactSecrets(e) };
            }
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return Response.json({ ok: true, count: clients.length, results, capturedOn: refDate() });
      },
    },
  },
});

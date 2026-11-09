// Content-Massnahmen für Automationen (01.11.2026): Server-Teil der Admin-Routen
// /api/admin/content-actions (Liste) und /api/admin/content-actions/recommendation
// (KI-Empfehlung). Liest nur bestehende Daten (content_decision, content_metrics,
// clients, GSC, DataForSEO, Live-Seite); schreibt einzig den Cache
// content_action_recommendations.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled } from "./integrations.server";
import { googleToken } from "./seo-report-quellen.server";
import { gscRows } from "./gsc.server";
import { generateViaSubscription } from "./claude-generate.server";
import { recordApiCost } from "./api-cost.server";
import { diagnoseNichtIndexiert, type DiagnoseCheck } from "./content-diagnose.server";
import { contentProbe } from "./content-probe.server";
import {
  REC_FOCUS,
  REC_PLAYBOOK,
  REC_TEXTE,
  baueAktionen,
  erkenneSprache,
  ohneEszett,
  SPRACH_NAME,
  type Sprache,
  type ContentAction,
} from "@/lib/contentMassnahmen";

const sb = supabaseAdmin as any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CACHE_TAGE = 7;
const MODELL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export type Kunde = {
  id: string;
  name: string;
  domain: string | null;
  gsc_property: string | null;
  organization_id: string | null;
};

export async function ladeKunde(id: string): Promise<Kunde | null> {
  if (!UUID.test(id || "")) return null;
  const { data } = await sb
    .from("clients")
    .select("id, name, domain, gsc_property, organization_id")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const minusTage = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
};

/** Offene Massnahmen = content_decision-Zeilen des Kunden (dieselbe Quelle wie das Modul). */
export async function ladeAktionen(clientId: string): Promise<{
  actions: ContentAction[];
  period: { start: string; end: string };
}> {
  const { data, error } = await sb.from("content_decision").select("*").eq("client_id", clientId);
  if (error) throw new Error(`content_decision: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // Fensterende = jüngster Messtag der Artikel (rollierende 28 Tage der View)
  let end = "";
  const ids = rows.map((r) => String(r.id));
  if (ids.length) {
    const { data: m } = await sb
      .from("content_metrics")
      .select("captured_on")
      .in("content_item_id", ids)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    end = m?.captured_on ? String(m.captured_on).slice(0, 10) : "";
  }
  if (!end) end = minusTage(ymd(new Date()), 3);
  return { actions: baueAktionen(rows), period: { start: minusTage(end, 27), end } };
}

// ── Live-Seite ──────────────────────────────────────────────────────────────

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Liest höchstens maxBytes des Antwort-Bodys (Rest wird abgebrochen). Grosse
 * Seiten (z. B. myswitzerland.com) komplett zu laden, sprengte das Worker-Limit
 * (Cloudflare 1102).
 */
export async function textBegrenzt(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let out = "";
  let n = 0;
  try {
    while (n < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      n += value.byteLength;
      out += dec.decode(value, { stream: true });
    }
  } catch {
    /* Abbruch/Timeout: bisher Gelesenes verwenden */
  } finally {
    reader.cancel().catch(() => {});
  }
  return out.slice(0, maxBytes);
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type SeitenSnapshot =
  | { error: string }
  | {
      titleTag: string;
      metaDescription: string;
      modified: string;
      h1: string;
      headings: string[];
      wordCount: number;
      excerpt: string;
      /** direkt = eigener Abruf; dataforseo = Ersatzweg, wenn die Website unseren Server sperrt */
      quelle: "direkt" | "dataforseo";
      /** <html lang> bzw. og:locale (2 Buchstaben), "" = unbekannt */
      lang?: string;
    };

type SnapshotOpts = {
  timeoutMs?: number;
  maxHeadings?: number;
  excerptChars?: number;
  /** Bei Sperre (403/429/Netzfehler) über DataForSEO abrufen (kostet ~0.0003 USD). */
  dfsFallback?: boolean;
  /** false = nicht über den agent-service (Standard: zuerst agent-service, 09.11.2026) */
  viaAgent?: boolean;
};

/**
 * Live-Snapshot eines Artikels: Title-Tag, Meta-Description, H2/H3, Wortzahl, Text.
 * Gemeinsam mit /api/content/refresh-brief («Mit KI erstellen»).
 */
export async function fetchPageSnapshot(
  url: string,
  opts: SnapshotOpts = {},
): Promise<SeitenSnapshot> {
  // Zuerst über den agent-service (Cloud-PC): kein Worker-Limit, keine IP-Sperre;
  // er fällt bei Sperren selbst auf DataForSEO zurück.
  if (opts.viaAgent !== false) {
    const p = await contentProbe(
      { snapshots: [{ url, maxHeadings: opts.maxHeadings, excerptChars: opts.excerptChars }] },
      (opts.timeoutMs ?? 15_000) + 45_000,
    );
    if (p?.snapshots[0]) {
      dfsKosten += p.cost_dfs || 0;
      return p.snapshots[0];
    }
  }
  const direkt = await direktSnapshot(url, opts);
  if (!("error" in direkt) || !opts.dfsFallback) return direkt;
  // hotelbernina.ch u. a. sperren Rechenzentrums-IPs (unabhängig vom User-Agent:
  // lokal 200 mit Bot-, Browser- und Googlebot-Kennung, vom Server 403) → DataForSEO
  const dfs = await dfsSnapshot(url, opts);
  return "error" in dfs ? { error: `${direkt.error}; DataForSEO: ${dfs.error}` } : dfs;
}

async function direktSnapshot(url: string, opts: SnapshotOpts): Promise<SeitenSnapshot> {
  try {
    const laden = (ua: string) =>
      fetch(url, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        headers: { "User-Agent": ua, "Accept-Language": "de-CH,de;q=0.9" },
      });
    let res = await laden("EzyHubContentBot/1.0 (+https://ezyone.ch)");
    // Manche Hoster/WAFs sperren Bot-Kennungen (hotelbernina.ch: 403) → zweiter Versuch
    if (res.status === 403 || res.status === 429) res = await laden(BROWSER_UA);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await textBegrenzt(res, 400_000);
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").replace(/\s+/g, " ").trim();
    const heads: string[] = [];
    for (const m of html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const t = strip(m[2]).slice(0, 140);
      if (t) heads.push(`H${m[1]}: ${t}`);
      if (heads.length >= (opts.maxHeadings ?? 25)) break;
    }
    // Nur Überschriften gefragt (SERP-Seiten) → Textaufbereitung sparen (Worker-CPU)
    const bodyText =
      opts.excerptChars === 0
        ? ""
        : strip(
            html
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
              .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
          );
    return {
      quelle: "direkt",
      lang: (
        html.match(/<html[^>]*\slang=["']?([a-z]{2})/i)?.[1] ||
        html.match(/<meta[^>]+property=["']og:locale["'][^>]+content=["']([a-z]{2})/i)?.[1] ||
        ""
      ).toLowerCase(),
      h1: strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").slice(0, 200),
      titleTag: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
      metaDescription:
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
        pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      modified: pick(
        /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']*)["']/i,
      ),
      headings: heads,
      wordCount: bodyText ? bodyText.split(" ").length : 0,
      excerpt: bodyText.slice(0, opts.excerptChars ?? 1500),
    };
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 120) };
  }
}

// ── DataForSEO On-Page (Ersatzweg für gesperrte Seiten) ─────────────────────

let dfsKosten = 0;
/** DataForSEO-Kosten aus agent-service-Abrufen mitzählen. */
export function addDfsKosten(n: number) {
  dfsKosten += Number(n) || 0;
}

/** Seit dem letzten Aufruf angefallene DataForSEO-On-Page-Kosten (USD), danach 0. */
export function holeDfsKosten(): number {
  const k = dfsKosten;
  dfsKosten = 0;
  return k;
}

export async function dfsPost(
  pfad: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<any | null> {
  const auth = dfsAuth();
  if (!auth) return null;
  try {
    const r = await fetch(`https://api.dataforseo.com/v3/${pfad}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j: any = await r.json().catch(() => null);
    dfsKosten += Number(j?.cost) || 0;
    const t = j?.tasks?.[0];
    if (!r.ok || !t || Number(t.status_code) >= 40000) return null;
    return t.result?.[0]?.items?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Status, Meta, Canonical, robots-Meta einer Seite laut DataForSEO (instant_pages). */
export async function dfsSeitenInfo(url: string, timeoutMs = 30_000) {
  const it = await dfsPost("on_page/instant_pages", [{ url, enable_javascript: false }], timeoutMs);
  if (!it) return null;
  const checks = it.checks ?? {};
  const noindex = Object.entries(checks).some(([k, v]) => /no_?index/i.test(k) && v === true);
  return {
    status: Number(it.status_code) || 0,
    title: String(it.meta?.title ?? ""),
    description: String(it.meta?.description ?? ""),
    canonical: String(it.meta?.canonical ?? ""),
    h1: (it.meta?.htags?.h1 ?? []).map(String),
    h2: (it.meta?.htags?.h2 ?? []).map(String),
    h3: (it.meta?.htags?.h3 ?? []).map(String),
    wordCount: Number(it.meta?.content?.plain_text_word_count) || 0,
    modified: String(it.last_modified?.meta_tag ?? ""),
    noindex,
  };
}

/** Haupttext einer Seite als Markdown laut DataForSEO (content_parsing). */
export async function dfsMarkdown(url: string, timeoutMs = 30_000): Promise<string | null> {
  const it = await dfsPost(
    "on_page/content_parsing/live",
    [{ url, markdown_view: true }],
    timeoutMs,
  );
  const md = it?.page_as_markdown;
  return typeof md === "string" && md.trim() ? md : null;
}

const ohneMarkdown = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

async function dfsSnapshot(url: string, opts: SnapshotOpts): Promise<SeitenSnapshot> {
  const t = Math.max(10_000, opts.timeoutMs ?? 15_000) + 10_000;
  const [info, md] = await Promise.all([
    dfsSeitenInfo(url, t),
    opts.excerptChars === 0 ? Promise.resolve(null) : dfsMarkdown(url, t),
  ]);
  if (!info && !md) return { error: "nicht abrufbar" };
  if (info && info.status >= 400) return { error: `HTTP ${info.status}` };
  const heads: string[] = info
    ? [...info.h2.map((h: string) => `H2: ${h}`), ...info.h3.map((h: string) => `H3: ${h}`)]
    : [...(md ?? "").matchAll(/^(#{2,3})\s+(.+)$/gm)].map((m) => `H${m[1].length}: ${m[2]}`);
  const text = md ? ohneMarkdown(md) : "";
  return {
    quelle: "dataforseo",
    titleTag: info?.title ?? "",
    metaDescription: info?.description ?? "",
    modified: info?.modified ?? "",
    h1: info?.h1?.[0] ?? md?.match(/^#\s+(.+)$/m)?.[1] ?? "",
    headings: heads.map((h) => h.slice(0, 140)).slice(0, opts.maxHeadings ?? 25),
    wordCount: info?.wordCount || (text ? text.split(" ").length : 0),
    excerpt: text.slice(0, opts.excerptChars ?? 1500),
  };
}

// ── GSC ─────────────────────────────────────────────────────────────────────

type GscKontext = {
  queries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
  starkeSeiten: Array<{ url: string; clicks: number }>;
  hinweis?: string;
};

const rund1 = (n: number) => Math.round(n * 10) / 10;

export async function gscKontext(
  k: Kunde,
  url: string,
  period: { start: string; end: string },
): Promise<GscKontext> {
  const site = k.gsc_property;
  if (!site) return { queries: [], starkeSeiten: [], hinweis: "keine GSC-Property" };
  const token = await googleToken(k.id);
  if (!token) return { queries: [], starkeSeiten: [], hinweis: "Google nicht verbunden" };
  const basis = {
    site,
    accessToken: token,
    startDate: period.start,
    endDate: period.end,
    timeoutMs: 20_000,
  };
  const [q, p] = await Promise.allSettled([
    gscRows({
      ...basis,
      dimensions: ["query"],
      rowLimit: 30,
      filter: {
        dimensionFilterGroups: [{ filters: [{ dimension: "page", expression: url }] }],
      },
    }),
    gscRows({ ...basis, dimensions: ["page"], rowLimit: 60 }),
  ]);
  const norm = (u: string) => u.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return {
    queries:
      q.status === "fulfilled"
        ? q.value.rows.map((r) => ({
            query: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            position: rund1(r.position),
          }))
        : [],
    starkeSeiten:
      p.status === "fulfilled"
        ? p.value.rows
            .map((r) => ({ url: r.keys[0], clicks: r.clicks }))
            .filter((r) => r.clicks > 0 && norm(r.url) !== norm(url))
            .slice(0, 40)
        : [],
    hinweis:
      q.status === "rejected" || p.status === "rejected"
        ? "GSC teilweise nicht abrufbar"
        : undefined,
  };
}

// ── DataForSEO: Top 5 Google Schweiz ─────────────────────────────────────────

export type SerpTreffer = {
  position: number;
  url: string;
  title: string;
  headings: string[];
};

/** google.com/goto?url=… → Ziel-URL (302 von www.google.com); null = kein goto-Link / nicht auflösbar. */
/** «https://www.ticino.ch › commons › details» → URL; gekürzt («…») → nur Domain. */
export function urlAusBreadcrumb(b: unknown): string | null {
  const teile = String(b ?? "")
    .split(/\s*›\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  const basis = teile[0] ?? "";
  if (!/^https?:\/\/[^/\s]+$/i.test(basis)) return null;
  const pfad = teile.slice(1);
  if (!pfad.length || pfad.some((x) => /\.\.\.|…/.test(x) || /\s/.test(x))) return `${basis}/`;
  return `${basis}/${pfad.join("/")}`;
}

export async function gotoAufloesen(url: string): Promise<string | null> {
  if (!/^https?:\/\/(www\.)?google\.[a-z.]+\/goto\?/i.test(url)) return null;
  try {
    const r = await fetch(url.replace(/^https?:\/\/(www\.)?google\./i, "https://www.google."), {
      redirect: "manual",
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(8_000),
    });
    const fremd = (u: string) =>
      /^https?:\/\//.test(u) && !/\/\/([a-z0-9-]+\.)*(google|gstatic|googleusercontent)\./i.test(u);
    const loc = (r.headers.get("location") || "").replace(/&amp;/g, "&");
    if (fremd(loc)) return loc;
    // Von Rechenzentrums-IPs antwortet Google teils mit einer Hinweisseite statt 302:
    // erste fremde URL aus Links bzw. Meta-Refresh nehmen.
    const html = await textBegrenzt(r, 200_000);
    for (const m of html.matchAll(/(?:href=|url=)["']?(https?:\/\/[^"'<>\s]+)/gi)) {
      const u = m[1].replace(/&amp;/g, "&");
      if (fremd(u)) return u;
    }
    return null;
  } catch {
    return null;
  }
}

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN,
    pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

export async function serpTop5(
  keyword: string,
  sprache: string,
  eigeneDomain: string | null,
): Promise<{ treffer: SerpTreffer[]; cost: number; error?: string; hinweis?: string }> {
  const auth = dfsAuth();
  if (!auth) return { treffer: [], cost: 0, error: "DATAFORSEO_LOGIN/PASSWORD fehlt" };
  try {
    const r = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keyword, location_code: 2756, language_code: sprache, device: "desktop", depth: 10 },
      ]),
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await r.json().catch(() => null);
    const t = j?.tasks?.[0];
    const cost = Number(j?.cost) || 0;
    if (!r.ok || !t) return { treffer: [], cost, error: `DataForSEO HTTP ${r.status}` };
    if (Number(t.status_code) >= 40000)
      return { treffer: [], cost, error: `DataForSEO ${t.status_code}: ${t.status_message}` };
    const roh: any[] = (t.result?.[0]?.items ?? [])
      .filter((i: any) => i?.type === "organic")
      .slice(0, 9);
    // DataForSEO liefert teils google.com/goto?url=…-Links statt der Ziel-URL
    // Aufgelöst wird über den agent-service (Cloud-PC bekommt die 302 von Google)
    let ungeloest = 0;
    const gotoUrls = roh.map((i) => String(i.url || "")).filter((u) => /\/goto\?/.test(u));
    const gp = gotoUrls.length ? await contentProbe({ goto: gotoUrls }, 25_000) : null;
    const aufloesen = (u: string) => (gp ? Promise.resolve(gp.goto[u] ?? null) : gotoAufloesen(u));
    const items = await Promise.all(
      roh.map(async (i) => {
        const istGoto = /\/goto\?/.test(String(i.url || ""));
        let echt = await aufloesen(String(i.url || ""));
        if (!echt && istGoto) {
          // Google leitet Rechenzentrums-IPs nicht weiter → Adresse aus dem Breadcrumb
          echt = urlAusBreadcrumb(i.breadcrumb);
          ungeloest++;
          // Kein Breadcrumb → Domain aus DataForSEO; ohne brauchbare Domain Treffer verwerfen
          if (!echt) {
            const d = String(i.domain || "").trim();
            if (!d || /(^|\.)google\./i.test(d)) return null;
            echt = `https://${d}/`;
          }
          let dom2 = i.domain;
          try {
            dom2 = new URL(echt).hostname;
          } catch {
            /* bleibt */
          }
          // Nur Domain bekannt → keine Überschriften der Startseite als «Wettbewerber-Inhalt»
          return { ...i, url: echt, domain: dom2, nurDomain: new URL(echt).pathname === "/" };
        }
        if (!echt) return i;
        let domain = i.domain;
        try {
          domain = new URL(echt).hostname;
        } catch {
          /* bleibt */
        }
        return { ...i, url: echt, domain };
      }),
    );
    const dom = (eigeneDomain || "").replace(/^www\./, "").toLowerCase();
    const top = items
      .filter((i): i is NonNullable<typeof i> => i != null && !/\/goto\?/.test(String(i.url || "")))
      .filter(
        (i) =>
          !dom ||
          !String(i.domain || "")
            .toLowerCase()
            .endsWith(dom),
      )
      .slice(0, 5);
    // Wettbewerberseiten in EINEM agent-service-Aufruf (Worker-Limit 1102);
    // ohne agent-service wie bisher einzeln im Worker
    const zuLaden = top.filter((i) => !i.nurDomain).map((i) => String(i.url));
    const bp = zuLaden.length
      ? await contentProbe(
          { snapshots: zuLaden.map((u) => ({ url: u, maxHeadings: 30, excerptChars: 0 })) },
          55_000,
        )
      : null;
    if (bp) dfsKosten += bp.cost_dfs || 0;
    const snaps = await Promise.all(
      top.map((i) => {
        if (i.nurDomain) return Promise.resolve({ error: "nur Domain" } as SeitenSnapshot);
        const ausAgent = bp?.snapshots[zuLaden.indexOf(String(i.url))];
        if (ausAgent) return Promise.resolve(ausAgent as SeitenSnapshot);
        return fetchPageSnapshot(String(i.url), {
          timeoutMs: 12_000,
          maxHeadings: 30,
          excerptChars: 0,
          viaAgent: false,
        });
      }),
    );
    return {
      treffer: top.map((i, n) => ({
        position: Number(i.rank_absolute ?? i.rank_group ?? n + 1),
        url: String(i.url),
        title: String(i.title ?? ""),
        headings: "headings" in snaps[n] ? (snaps[n] as any).headings : [],
      })),
      cost,
      hinweis: ungeloest
        ? `${ungeloest} Google-Weiterleitungslink(s) nicht auflösbar — URL aus dem Breadcrumb`
        : undefined,
    };
  } catch (e) {
    return { treffer: [], cost: 0, error: String((e as Error)?.message || e).slice(0, 140) };
  }
}

// ── Empfehlung ──────────────────────────────────────────────────────────────

export type Empfehlung = {
  summary: string;
  title_variants: string[];
  meta_description: string;
  sections_to_add: Array<{ h2: string; answer_first: string; points: string[] }>;
  sections_to_update: Array<{ heading: string; change: string }>;
  internal_links: Array<{ from_url: string; from_title: string; anchor: string }>;
  faq: Array<{ q: string; a: string }>;
  eeat: string[];
  serp_top5: Array<{ position: number; url: string; title: string }>;
  /** Live-Artikel abrufbar (direkt oder über DataForSEO) */
  article_fetched: boolean;
};

/** Antwort für type «not_indexed»: Diagnose statt Content-Empfehlung. */
export type Diagnose = {
  summary: string;
  diagnosis: DiagnoseCheck[];
  internal_links: Array<{ from_url: string; from_title: string; anchor: string }>;
  article_fetched: boolean;
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Erstes JSON-Objekt aus einer Modellantwort (auch in ```json-Blöcken). */
export function jsonAusText(text: string): any | null {
  const roh = text.replace(/```(?:json)?/gi, "");
  const a = roh.indexOf("{");
  const b = roh.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(roh.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Modellantwort → festes Schema; interne Links nur aus der erlaubten Liste. */
export function normalisiereEmpfehlung(
  j: any,
  erlaubt: Array<{ url: string; title?: string }>,
  serp: SerpTreffer[],
  articleFetched = true,
): Empfehlung {
  const norm = (u: string) =>
    u
      .replace(/[#?].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  const map = new Map(erlaubt.map((e) => [norm(e.url), e]));
  const links = arr(j?.internal_links)
    .map((l) => ({ from_url: s(l?.from_url), from_title: s(l?.from_title), anchor: s(l?.anchor) }))
    .filter((l) => l.from_url && l.anchor && map.has(norm(l.from_url)))
    .map((l) => ({ ...l, from_url: map.get(norm(l.from_url))!.url }));
  const seen = new Set<string>();
  const frage = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9äöüéèà]+/g, " ")
      .trim();
  const h2s = new Set(arr(j?.sections_to_add).map((x) => frage(s(x?.h2))));
  return ohneEszett({
    summary: s(j?.summary),
    title_variants: arr(j?.title_variants).map(s).filter(Boolean).slice(0, 3),
    meta_description: s(j?.meta_description),
    sections_to_add: arr(j?.sections_to_add)
      .map((x) => ({
        h2: s(x?.h2),
        answer_first: s(x?.answer_first),
        points: arr(x?.points).map(s).filter(Boolean),
      }))
      .filter((x) => x.h2 && x.answer_first),
    sections_to_update: arr(j?.sections_to_update)
      .map((x) => ({ heading: s(x?.heading), change: s(x?.change) }))
      .filter((x) => x.heading && x.change),
    internal_links: links.filter((l) => !seen.has(l.from_url) && !!seen.add(l.from_url)),
    faq: arr(j?.faq)
      .map((x) => ({ q: s(x?.q), a: s(x?.a) }))
      .filter((x) => x.q && x.a && !h2s.has(frage(x.q))),
    eeat: arr(j?.eeat).map(s).filter(Boolean),
    serp_top5: serp.map((t) => ({ position: t.position, url: t.url, title: t.title })),
    article_fetched: articleFetched,
  });
}

/** Interne Links aus einer Modellantwort, nur aus der erlaubten Liste, je Quelle einmal. */
export function erlaubteLinks(
  roh: unknown,
  erlaubt: Array<{ url: string; title?: string }>,
): Array<{ from_url: string; from_title: string; anchor: string }> {
  const norm = (u: string) =>
    u
      .replace(/[#?].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  const map = new Map(erlaubt.map((e) => [norm(e.url), e]));
  const seen = new Set<string>();
  return arr(roh)
    .map((l) => ({ from_url: s(l?.from_url), from_title: s(l?.from_title), anchor: s(l?.anchor) }))
    .filter((l) => l.from_url && l.anchor && map.has(norm(l.from_url)))
    .map((l) => {
      const e = map.get(norm(l.from_url))!;
      return { ...l, from_url: e.url, from_title: l.from_title || e.title || "" };
    })
    .filter((l) => !seen.has(l.from_url) && !!seen.add(l.from_url));
}

/** «Pontresina Tourismus: Wo die Alpen …» → «pontresina tourismus» */
export function keywordAusTitel(t: string): string {
  const kopf = String(t || "")
    .split(/\s[–—|-]\s|[:?!|]/)[0]
    .replace(/[«»"“”„()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return kopf.split(" ").slice(0, 6).join(" ");
}

/** Haupt-Keyword: GSC-Suchanfrage mit den meisten Klicks (sonst Impressionen), sonst aus Title/H1. */
export function hauptKeyword(
  queries: Array<{ query: string; clicks: number; impressions: number }>,
  titel: string[],
): { keyword: string; quelle: "gsc" | "titel" } | null {
  const q = [...queries]
    .filter((x) => x.query && x.impressions > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)[0];
  if (q) return { keyword: q.query, quelle: "gsc" };
  for (const t of titel) {
    const k = keywordAusTitel(t);
    if (k.length >= 3) return { keyword: k, quelle: "titel" };
  }
  return null;
}

/** Fehlende Pflichtteile; leer = vollständig. */
export function luecken(e: Empfehlung | Diagnose): string[] {
  const f: string[] = [];
  if ("diagnosis" in e) {
    if (!e.summary) f.push("summary");
    if (!e.diagnosis.length) f.push("diagnosis");
    return f;
  }
  if (!e.summary) f.push("summary");
  if (e.title_variants.length < 3) f.push("title_variants");
  if (!e.meta_description) f.push("meta_description");
  return f;
}

const SPRACHEN: Record<string, string> = { de: "de", en: "en", fr: "fr", it: "it" };

export type EmpfehlungsAnfrage = {
  kunde: Kunde;
  url: string;
  rec: string;
  /** optional: ohne Keyword Haupt-Keyword aus GSC bzw. Title/H1 */
  keyword?: string;
  deadline: number; // Date.now()-Zeitpunkt, bis zu dem fertig sein muss
};

export async function erstelleEmpfehlung(a: EmpfehlungsAnfrage): Promise<{
  recommendation: Empfehlung | Diagnose;
  cost: { dataforseo: number };
  hinweise: string[];
  keyword: string;
  keyword_quelle: "eingabe" | "gsc" | "titel";
  /** Artikelsprache (an der Seite erkannt) */
  sprache?: string;
}> {
  const { kunde, url, rec } = a;
  const hinweise: string[] = [];
  holeDfsKosten();
  const { data: zeile } = await sb
    .from("content_decision")
    .select("*")
    .eq("client_id", kunde.id)
    .eq("url", url)
    .maybeSingle();
  // content_items.language ist nur die Kundensprache → bloss letzter Rückfall
  const spracheDb = (SPRACHEN[
    String(zeile?.language || "de")
      .slice(0, 2)
      .toLowerCase()
  ] ?? "de") as Sprache;
  const { period } = await ladeAktionen(kunde.id);

  const eingabe = (a.keyword || "").trim();
  if (rec === "not_indexed") return diagnose(a, zeile, period, eingabe, hinweise);

  // Mit Keyword läuft die SERP parallel; ohne wird es erst aus GSC/Title abgeleitet
  // Artikelabruf (ggf. über DataForSEO, bis ~30 s) läuft parallel zu GSC → SERP.
  // Ohne Keyword startet die SERP, sobald GSC da ist; nur ohne GSC-Daten wird auf
  // den Artikel (H1/Title) gewartet.
  const snapP = fetchPageSnapshot(url, {
    timeoutMs: 15_000,
    maxHeadings: 40,
    excerptChars: 4000,
    dfsFallback: true,
  });
  // Artikelsprache (09.11.2026): <html lang>/og:locale bzw. Wörter im Text,
  // sonst Titel aus dem CMS, sonst Kundensprache. SERP und Formulierungen folgen ihr.
  const spracheP: Promise<Sprache> = snapP.then(
    (sn) =>
      ("error" in sn
        ? null
        : erkenneSprache(sn.lang, [sn.titleTag, sn.h1, sn.excerpt.slice(0, 1500)].join(" "))) ??
      erkenneSprache("", String(zeile?.title || "")) ??
      spracheDb,
  );
  const gscP = gscKontext(kunde, url, period).catch(
    () => ({ queries: [], starkeSeiten: [], hinweis: "GSC-Fehler" }) as GscKontext,
  );
  let keyword = eingabe;
  let keyword_quelle: "eingabe" | "gsc" | "titel" = "eingabe";
  const serpP = eingabe
    ? spracheP.then((sp) => serpTop5(eingabe, sp, kunde.domain))
    : (async () => {
        const g = await gscP;
        let k = hauptKeyword(g.queries, [String(zeile?.title || "")]);
        if (!k || k.quelle === "titel") {
          const sn = await snapP;
          k =
            hauptKeyword(g.queries, [
              "error" in sn ? "" : sn.h1,
              String(zeile?.title || ""),
              "error" in sn ? "" : sn.titleTag,
            ]) ?? k;
        }
        if (!k)
          throw new Error("Kein keyword angegeben und keines aus GSC oder Title/H1 ableitbar");
        keyword = k.keyword;
        keyword_quelle = k.quelle;
        return serpTop5(keyword, await spracheP, kunde.domain);
      })();
  const [snap, gsc, serp, sprache] = await Promise.all([snapP, gscP, serpP, spracheP]);
  const articleFetched = !("error" in snap);
  if ("error" in snap) hinweise.push(`Live-Artikel nicht abrufbar (${snap.error})`);
  else if (snap.quelle === "dataforseo")
    hinweise.push("Live-Artikel über DataForSEO abgerufen (Website sperrt unseren Server)");
  const knapp = (t: string, n: number) => (t.length > n ? t.slice(0, n) + " …" : t);
  if (gsc.hinweis) hinweise.push(gsc.hinweis);
  if (serp.error) hinweise.push(serp.error);
  if (serp.hinweis) hinweise.push(serp.hinweis);

  const pb = REC_PLAYBOOK[rec];
  // Zwei kleinere, parallele KI-Aufrufe statt eines grossen (01.11.2026): ein
  // Gesamt-Aufruf brauchte >110 s (13k Ausgabe-Tokens) — so bleibt die Route
  // unter 150 s.
  const basisSystem =
    "Du bist Senior-SEO-Editor einer Schweizer Agentur. Du bekommst die Bewertungsdaten, den Live-Zustand EINES Blog-Artikels, seine GSC-Suchanfragen, die Top 5 der Google-SERP (Schweiz) mit deren Überschriften und eine Liste starker Seiten derselben Domain. " +
    "Du schreibst eine konkrete, sofort umsetzbare Empfehlung fuer GENAU diesen Artikel — keine Allgemeinplaetze. Fehlende Unterthemen benennst du konkret aus dem Vergleich mit den Überschriften der Top 5. " +
    "Alle Daten liegen vor: verwende KEINE Werkzeuge, rufe keine Webseiten ab, antworte sofort. " +
    (sprache === "de"
      ? "Sprache: Deutsch (Schweiz), ss statt ß. "
      : `Der Artikel ist auf ${SPRACH_NAME[sprache]}. Alle Formulierungsvorschläge auf ${SPRACH_NAME[sprache]}: title_variants, meta_description, sections_to_add (h2, answer_first, points), faq (q, a) und anchor. Erklärungen auf Deutsch (Schweiz, ss statt ß): summary, sections_to_update.change und eeat. sections_to_update.heading exakt wie im Artikel. `) +
    "Erfinde keine Fakten über den Kunden (Preise, Angebote, Auszeichnungen); wo Fakten fehlen, Platzhalter in eckigen Klammern. " +
    "Überlege kurz und antworte direkt. Antworte NUR mit einem JSON-Objekt (kein Text davor oder danach, kein Markdown) mit genau diesen Feldern: ";
  const systemA =
    basisSystem +
    '{"summary": "2–3 Sätze, was der Artikel braucht", "title_variants": ["genau 3 Varianten, max. 60 Zeichen, Keyword vorn"], "meta_description": "150–160 Zeichen", ' +
    '"sections_to_update": [{"heading": "bestehende Überschrift exakt wie im Artikel", "change": "was konkret ändern"}], ' +
    '"internal_links": [{"from_url": "NUR aus der Liste STARKE SEITEN", "from_title": "Titel/Thema der Quellseite", "anchor": "Ankertext"}], ' +
    '"eeat": ["konkrete E-E-A-T-Massnahmen"]}. sections_to_update: 2–4; internal_links: 2–4, from_url zwingend aus der Liste, sonst weglassen; eeat: 2–4.';
  const systemB =
    basisSystem +
    '{"sections_to_add": [{"h2": "Frage als H2", "answer_first": "fertiger erster Absatz aus 8–10 Sätzen, MINDESTENS 135 und höchstens 170 Wörter (zähle nach), Antwort im ersten Satz", "points": ["3–5 Unterpunkte"]}]}. 2–3 Abschnitte zu Unterthemen, die die Top 5 abdecken und dieser Artikel nicht.';
  // Teil B aufgeteilt (01.11.2026): ein Aufruf für alle Abschnitte brauchte bei
  // Campagnola >100 s. Jetzt: kurzer Plan (H2-Fragen), dann je Abschnitt parallel.
  const systemBPlan =
    basisSystem +
    '{"h2": ["Frage als H2"]}. Genau 3 Fragen (als H2 formuliert) zu Unterthemen, die die Top 5 abdecken und dieser Artikel nicht — verschiedene Themen, keine Überschneidung. NUR die Fragen, keine Texte.';
  const systemBAbschnitt = (h2: string, andere: string[]) =>
    basisSystem +
    `{"h2": "${h2.replace(/"/g, "'")}", "answer_first": "fertiger erster Absatz aus 8–10 Sätzen, MINDESTENS 135 und höchstens 170 Wörter (zähle nach), Antwort im ersten Satz", "points": ["3–5 Unterpunkte"]}. Schreibe GENAU EINEN neuen Abschnitt zur H2 «${h2}».` +
    (andere.length
      ? ` Die Themen ${andere.map((x) => `«${x}»`).join(", ")} behandeln andere Abschnitte — nicht wiederholen.`
      : "");
  const systemC =
    basisSystem +
    '{"faq": [{"q": "Frage", "a": "Antwort 40–60 Wörter"}]}. 3–5 FAQ zu konkreten Nutzerfragen aus den GSC-Suchanfragen und zum Ziel-Keyword — kurze Detailfragen (Preise, Anreise, Dauer, Saison o. ä.), keine breiten Unterthemen.';

  const live =
    "error" in snap
      ? `Live-Text nicht verfügbar (technischer Abruf aus unserem Rechenzentrum gesperrt — Besucher und Google sehen die Seite normal). Erwähne den Abruf NIRGENDS (nicht in summary, eeat oder change). sections_to_update leer lassen ([]), da die bestehenden Überschriften unbekannt sind; arbeite mit Titel, Keyword, GSC-Daten und SERP.`
      : `Title-Tag: ${snap.titleTag || "—"} (${snap.titleTag.length} Zeichen)
Meta-Description: ${snap.metaDescription || "FEHLT"} (${snap.metaDescription.length} Zeichen)
Zuletzt geändert: ${snap.modified || "—"} · Wortzahl (grob): ${snap.wordCount}
Überschriften:
${snap.headings.join("\n") || "—"}
Text (Auszug): ${snap.excerpt || "—"}`;

  const prompt = `ARTIKEL
Titel (CMS): ${zeile?.title || "—"}
URL: ${url}
Kunde: ${kunde.name} (${kunde.domain || "—"})
Ziel-Keyword: ${keyword}
Sprache des Artikels: ${SPRACH_NAME[sprache]}

MASSNAHME (Regel-Engine, 28-Tage-Fenster ${period.start}–${period.end})
${REC_TEXTE[rec]?.t ?? rec}
Befund: ${pb?.befund ?? "—"}
So gehst du vor: ${(pb?.schritte ?? []).join(" | ")}
Klicks 28T: ${zeile?.clicks_28 ?? 0} (Peak ${zeile?.peak_clicks_28 ?? 0}) · Impressionen 28T: ${zeile?.impr_28 ?? 0} · Ø-Position: ${zeile?.position_28 ?? "—"}

LIVE-ZUSTAND DER SEITE
${live}

GSC-SUCHANFRAGEN DIESER SEITE (28 Tage, nach Klicks)
${gsc.queries.map((q) => `${q.query}: ${q.clicks} Klicks, ${q.impressions} Impr., Pos ${q.position}`).join("\n") || "keine Daten"}

TOP 5 GOOGLE SCHWEIZ für «${keyword}»
${
  serp.treffer
    .map(
      (t) =>
        `#${t.position} ${t.title} — ${t.url}\n${t.headings.slice(0, 20).join("\n") || "(Überschriften nicht abrufbar)"}`,
    )
    .join("\n\n") || "nicht verfügbar"
}

STARKE SEITEN DERSELBEN DOMAIN (GSC-Klicks 28T) — einzige erlaubte Quellen für internal_links
${gsc.starkeSeiten.map((p) => `${p.url} (${p.clicks} Klicks)`).join("\n") || "keine"}

FOKUS
${REC_FOCUS[rec] || "Beurteile anhand der Daten, welche Massnahme sinnvoll ist."}`;

  // Obergrenze gegen ausufernde Seiten (Prompt-Grösse treibt die Laufzeit)
  const kurzPrompt = knapp(prompt, 24_000);
  const rest = () => a.deadline - Date.now();
  const teil = async (system: string, label: string, maxMs?: number): Promise<any | null> => {
    const viaSub = await generateViaSubscription({
      system,
      prompt: kurzPrompt,
      model: MODELL,
      clientId: kunde.id,
      clientName: kunde.name,
      label,
      maxTurns: 3,
      effort: "low",
      timeoutMs: Math.min(maxMs ?? Infinity, Math.max(20_000, rest() - 10_000)),
    });
    const j = viaSub?.text ? jsonAusText(viaSub.text) : null;
    if (j) return j;
    hinweise.push(`${label}: agent-service ohne gültiges JSON`);
    // Direktweg über das API-Guthaben, wenn der agent-service nichts Brauchbares liefert
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || rest() < 25_000) return null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODELL,
          max_tokens: 4000,
          system,
          messages: [{ role: "user", content: kurzPrompt }],
        }),
        signal: AbortSignal.timeout(Math.max(10_000, rest() - 5_000)),
      });
      if (!res.ok) {
        hinweise.push(`${label}: Anthropic HTTP ${res.status}`);
        return null;
      }
      const out: any = await res.json();
      await recordApiCost({
        provider: "Claude",
        tokensIn: Number(out.usage?.input_tokens || 0),
        tokensOut: Number(out.usage?.output_tokens || 0),
      });
      return jsonAusText(
        (out.content ?? [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text ?? "")
          .join("\n"),
      );
    } catch (e) {
      hinweise.push(`${label}: ${String((e as Error)?.message || e).slice(0, 80)}`);
      return null;
    }
  };
  const teilB = async (): Promise<any | null> => {
    const plan = await teil(systemBPlan, "Content-Massnahme B-Plan", 40_000);
    const fragen: string[] = [...new Set(arr(plan?.h2).map(s).filter(Boolean))].slice(0, 3);
    // Ohne Plan: alter Einzelaufruf für alle Abschnitte
    if (!fragen.length) return teil(systemB, "Content-Massnahme B");
    const teile = await Promise.all(
      fragen.map((h, i) =>
        teil(
          systemBAbschnitt(
            h,
            fragen.filter((x) => x !== h),
          ),
          `Content-Massnahme B${i + 1}`,
        ),
      ),
    );
    const abschnitte = teile
      .map((t, i) => (t ? { ...t, h2: s(t.h2) || fragen[i] } : null))
      .filter(Boolean);
    return abschnitte.length ? { sections_to_add: abschnitte } : null;
  };
  const [ja, jb, jc] = await Promise.all([
    teil(systemA, "Content-Massnahme A"),
    teilB(),
    teil(systemC, "Content-Massnahme C"),
  ]);
  const fehlt = [!ja && "Teil A", !jb && "Teil B", !jc && "Teil C"].filter(Boolean);
  if (fehlt.length)
    throw new Error(
      `KI-Antwort leer oder kein gültiges JSON (${fehlt.join(", ")}; ${hinweise.join("; ")})`.slice(
        0,
        300,
      ),
    );
  const j = { ...ja, sections_to_add: jb.sections_to_add, faq: jc.faq };

  const erlaubt = gsc.starkeSeiten.map((p) => ({ url: p.url }));
  return {
    recommendation: normalisiereEmpfehlung(j, erlaubt, serp.treffer, articleFetched),
    cost: { dataforseo: rund4(serp.cost + holeDfsKosten()) },
    hinweise,
    keyword,
    keyword_quelle,
    sprache,
  };
}

const rund4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Ein JSON-Teil über das Claude-Abo (agent-service); null bei Fehler. */
async function kiJson(
  kunde: Kunde,
  system: string,
  prompt: string,
  label: string,
  timeoutMs: number,
): Promise<any | null> {
  const r = await generateViaSubscription({
    system,
    prompt,
    model: MODELL,
    clientId: kunde.id,
    clientName: kunde.name,
    label,
    maxTurns: 3,
    effort: "low",
    timeoutMs,
  });
  return r?.text ? jsonAusText(r.text) : null;
}

/** type «not_indexed»: Diagnose der Index-Hürden + interne Links von indexierten Seiten. */
async function diagnose(
  a: EmpfehlungsAnfrage,
  zeile: any,
  period: { start: string; end: string },
  eingabe: string,
  hinweise: string[],
) {
  const { kunde, url } = a;
  const gsc = await gscKontext(kunde, url, period).catch(
    () => ({ queries: [], starkeSeiten: [], hinweis: "GSC-Fehler" }) as GscKontext,
  );
  if (gsc.hinweis) hinweise.push(gsc.hinweis);
  const d = await diagnoseNichtIndexiert({ kunde, url, starkeSeiten: gsc.starkeSeiten });
  hinweise.push(...d.hinweise);

  let keyword = eingabe;
  let keyword_quelle: "eingabe" | "gsc" | "titel" = "eingabe";
  if (!keyword) {
    const k = hauptKeyword(gsc.queries, [d.artikelTitel, String(zeile?.title || "")]);
    keyword = k?.keyword ?? "";
    keyword_quelle = k?.quelle ?? "titel";
  }

  // Linkquellen: indexiert (GSC-Klicks), abrufbar und noch ohne Link auf den Artikel
  const kandidaten = d.linkQuellen.filter((l) => l.verlinkt === false);
  const erlaubt = kandidaten.map((l) => ({ url: l.url, title: l.title }));
  const fehler = d.checks.filter((c) => c.ok === false);
  const offen = d.checks.filter((c) => c.ok === null);

  const system =
    "Du bist technischer SEO einer Schweizer Agentur. Ein Blog-Artikel ist nicht im Google-Index. Du bekommst die Ergebnisse automatischer Prüfungen und eine Liste indexierter Seiten derselben Domain, die den Artikel noch NICHT verlinken. " +
    "Alle Daten liegen vor: verwende KEINE Werkzeuge, antworte sofort. Deutsch (Schweiz), ss statt ß. Erfinde nichts, stütze dich nur auf die Prüfergebnisse. Punkte mit «NICHT PRÜFBAR» sind unbekannt — weder als Ursache noch als in Ordnung darstellen; falls relevant, empfehle sie manuell zu prüfen. " +
    'Antworte NUR mit JSON: {"summary": "2–4 Sätze: wahrscheinlichste Ursache(n) und die nächsten Schritte in Reihenfolge (z. B. Indexierung in GSC beantragen, Sitemap einreichen, intern verlinken)", ' +
    '"internal_links": [{"from_url": "NUR aus der Liste KANDIDATEN", "from_title": "Titel der Quellseite", "anchor": "natürlicher Ankertext zum Thema des Artikels"}]}. internal_links: 2–4, thematisch passende Quellen zuerst.';
  const prompt = `ARTIKEL
URL: ${url}
Titel: ${d.artikelTitel || zeile?.title || "—"}
Haupt-Keyword: ${keyword || "—"}
Kunde: ${kunde.name} (${kunde.domain || "—"})

PRÜFUNGEN
${d.checks.map((c) => `${c.ok === true ? "OK" : c.ok === false ? "FEHLER" : "NICHT PRÜFBAR"} ${c.check}: ${c.detail}`).join("\n")}

KANDIDATEN (indexiert, GSC-Klicks 28T, verlinken den Artikel noch nicht)
${kandidaten.map((l) => `${l.url} — ${l.title || "ohne Titel"} (${l.clicks} Klicks)`).join("\n") || "keine"}`;

  const rest = a.deadline - Date.now();
  const j =
    rest > 25_000
      ? await kiJson(
          kunde,
          system,
          prompt,
          "Content-Massnahme Diagnose",
          Math.max(20_000, rest - 15_000),
        )
      : null;
  if (!j) hinweise.push("Diagnose-Text ohne KI erstellt (agent-service ohne gültiges JSON)");

  let links = erlaubteLinks(j?.internal_links, erlaubt);
  if (!links.length && kandidaten.length && keyword)
    links = kandidaten.slice(0, 3).map((l) => ({
      from_url: l.url,
      from_title: l.title,
      anchor: keyword,
    }));
  const summary =
    s(j?.summary) ||
    (fehler.length
      ? `Auffällig: ${fehler.map((c) => `${c.check} (${c.detail})`).join("; ")}. Diese Punkte beheben, danach in der GSC die Indexierung beantragen.`
      : "Technisch keine Hürde gefunden. In der GSC die Indexierung beantragen und den Artikel von starken Seiten intern verlinken.") +
      (offen.length ? ` Nicht prüfbar: ${offen.map((c) => c.check).join(", ")}.` : "");

  const recommendation: Diagnose = ohneEszett({
    summary,
    diagnosis: d.checks,
    internal_links: links,
    article_fetched: d.articleFetched,
  });
  return {
    recommendation,
    cost: { dataforseo: rund4(holeDfsKosten()) },
    hinweise,
    keyword,
    keyword_quelle: keyword_quelle as "eingabe" | "gsc" | "titel",
  };
}

// ── Cache ───────────────────────────────────────────────────────────────────

export async function ladeCache(clientId: string, url: string, type: string) {
  const ab = new Date(Date.now() - CACHE_TAGE * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("content_action_recommendations")
    .select("payload, generated_at, keyword")
    .eq("client_id", clientId)
    .eq("url", url)
    .eq("type", type)
    .gte("generated_at", ab)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

export async function speichereCache(
  clientId: string,
  url: string,
  type: string,
  keyword: string,
  payload: Empfehlung | Diagnose,
  generatedAt: string,
) {
  const { error } = await sb
    .from("content_action_recommendations")
    .upsert(
      { client_id: clientId, url, type, keyword, payload, generated_at: generatedAt },
      { onConflict: "client_id,url,type" },
    );
  if (error) throw new Error(`Cache: ${error.message}`);
}

export { isProviderEnabled };

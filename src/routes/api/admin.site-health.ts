import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Site Health (05.08.2026, Searchable-Nachbau "Site Audits"):
// KOSTENLOSE Live-Audits der Kunden-Website, ohne Agenten-Lauf.
//
// Modi:
//  - quick: Startseite + robots.txt + llms.txt + Sitemap (~10 s)
//  - deep:  zusätzlich bis zu 15 Unterseiten aus der Sitemap (Fallback:
//           interne Links der Startseite); Content-/AEO-Checks je Seite,
//           Issues seitenübergreifend aggregiert (~30-60 s)
//
// Scores: drei Säulen mit den Searchable-Gewichten (Technical 30 % /
// Content 35 % / AEO 35 %), Schwellen 90/70/50/30.
//
// GET  ?client=<uuid>           → letzter gespeicherter Audit (oder null)
// POST {client, mode?}          → Audit ausführen + speichern; gleicher Modus
//                                 < 10 Min alt → gecachte Antwort (Hoster-
//                                 Schonung — Lektion FIH: Burst = IP-Sperre).
//
// Auth: eingeloggter User (RLS-Kundensicht) ODER Bearer ADMIN_AUTOMATION_SECRET.

type Pillar = "technical" | "content" | "aeo";
type Severity = "kritisch" | "hoch" | "mittel" | "niedrig";
type CheckOut = {
  id: string; label: string; pillar: Pillar; weight: number; severity: Severity;
  tipp: string; status: "ok" | "warn" | "fail"; detail: string;
  pagesAffected?: string[];
};

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

async function resolveClient(userClient: any | null, clientId: string) {
  const sb = userClient ?? (supabaseAdmin as any);
  const { data } = await sb.from("clients").select("id, name, domain").eq("id", clientId).maybeSingle();
  return data ?? null;
}

export const AI_BOTS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Bytespider", "meta-externalagent", "Amazonbot"];
export const CRITICAL_BOTS = new Set(["GPTBot", "ClaudeBot", "PerplexityBot"]);

// EzyAI-Analyse (14.08.): Voller Bot-Katalog fuer das "AI-Crawler-Zugriff"-Panel
// (je Bot: erlaubt / blockiert / nicht spezifiziert — Prinzip wie externe
// robots.txt-Checker). "Erlaubt" = eigener User-agent-Block ohne Disallow: /.
export const AI_BOT_DEFS: Array<{ name: string; owner: string }> = [
  { name: "GPTBot", owner: "OpenAI" },
  { name: "ChatGPT-User", owner: "OpenAI" },
  { name: "OAI-SearchBot", owner: "OpenAI" },
  { name: "ClaudeBot", owner: "Anthropic" },
  { name: "anthropic-ai", owner: "Anthropic" },
  { name: "PerplexityBot", owner: "Perplexity" },
  { name: "Perplexity-User", owner: "Perplexity" },
  { name: "Google-Extended", owner: "Google (Gemini)" },
  { name: "GoogleOther", owner: "Google" },
  { name: "Bytespider", owner: "ByteDance" },
  { name: "CCBot", owner: "Common Crawl" },
  { name: "cohere-ai", owner: "Cohere" },
  { name: "meta-externalagent", owner: "Meta" },
  { name: "Amazonbot", owner: "Amazon" },
  { name: "Applebot-Extended", owner: "Apple" },
];
export type BotDetail = { name: string; owner: string; status: "erlaubt" | "blockiert" | "unspezifiziert"; eigeneRegel: boolean };
export function botDetailsFor(robotsTxt: string): BotDetail[] {
  return AI_BOT_DEFS.map((b) => {
    const eigeneRegel = new RegExp(`^user-agent:\\s*${b.name}\\s*$`, "im").test(robotsTxt);
    const blocked = botBlocked(robotsTxt, b.name);
    return { name: b.name, owner: b.owner, status: blocked ? "blockiert" : eigeneRegel ? "erlaubt" : "unspezifiziert", eigeneRegel };
  });
}

export function botBlocked(robots: string, bot: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.trim());
  let applies = false, blocked = false, starBlocked = false, inStar = false;
  for (const l of lines) {
    const ua = l.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      const v = ua[1].trim().toLowerCase();
      applies = v === bot.toLowerCase();
      inStar = v === "*";
      continue;
    }
    const dis = l.match(/^disallow:\s*(.*)$/i);
    if (dis) {
      const p = dis[1].trim();
      if (p === "/" && applies) blocked = true;
      if (p === "/" && inStar) starBlocked = true;
    }
    const allow = l.match(/^allow:\s*\/\s*$/i);
    if (allow && applies) blocked = false;
  }
  const hasOwnGroup = new RegExp(`^user-agent:\\s*${bot}\\s*$`, "im").test(robots);
  return hasOwnGroup ? blocked : starBlocked;
}

type Fetched = { ok: boolean; status: number; text: string; ms: number; finalUrl: string };
export async function fetchText(url: string, timeoutMs = 15000): Promise<Fetched> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EzyHubSiteHealth/1.0; +https://ezyhub.ch)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, text, ms: Date.now() - t0, finalUrl: r.url || url };
  } catch {
    return { ok: false, status: 0, text: "", ms: Date.now() - t0, finalUrl: url };
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Seiten-Analyse: Kennzahlen aus dem HTML einer einzelnen Seite ────────────
function analyzeHtml(html: string, domain: string) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
  const words = stripped.split(/\s+/).filter((w) => w.length > 1).length;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "";
  const imgs = html.match(/<img[^>]*>/gi) || [];
  // Fix 14.08.: alt="" (leer) ist bei dekorativen Bildern KORREKT (a11y-Praxis,
  // wie Lighthouse) — bemaengelt wird nur ein komplett FEHLENDES alt-Attribut.
  const imgsNoAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  const jsonLdBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const ldTypes = new Set<string>();
  for (const b of jsonLdBlocks) {
    for (const m of b.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) ldTypes.add(m[1]);
    // Fix 14.08. (Befund ezyone.ch): Yoast/RankMath schreiben "@type" auch als
    // ARRAY ("@type":["Organization","Person"]) — die wurden bisher uebersehen
    // und Organization-Schema faelschlich als "fehlt" gemeldet.
    for (const m of b.matchAll(/"@type"\s*:\s*\[([^\]]*)\]/g)) {
      for (const t of m[1].matchAll(/"([^"]+)"/g)) ldTypes.add(t[1]);
    }
  }
  return {
    title, metaDesc, words,
    h1Count: (html.match(/<h1[\s>]/gi) || []).length,
    h2Count: (html.match(/<h2[\s>]/gi) || []).length,
    imgs: imgs.length, imgsNoAlt,
    internalLinks: (html.match(new RegExp(`<a[^>]+href=["'](?:https?://(?:www\\.)?${domain.replace(/\./g, "\\.")})?/[^"']*["']`, "gi")) || []).length,
    ldTypes,
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    og: /<meta[^>]+property=["']og:(?:title|image)["']/i.test(html),
    langAttr: /<html[^>]+lang=/i.test(html),
    lists: (html.match(/<(?:ul|ol)[\s>]/gi) || []).length,
    questionHeadings: (html.match(/<h[23][^>]*>[^<]*\?/gi) || []).length,
  };
}
type PageMetrics = ReturnType<typeof analyzeHtml>;

// Seiten-Checks (Content/AEO): Bewertung 1 / 0.5 / 0 je Seite.
const PAGE_CHECKS: Array<{
  id: string; label: string; pillar: Pillar; weight: number; severity: Severity; tipp: string;
  score: (m: PageMetrics) => number; detail: (m: PageMetrics) => string;
}> = [
  { id: "title", label: "Seitentitel gesetzt und sinnvoll lang", pillar: "content", weight: 3, severity: "hoch",
    tipp: "Title mit 15–60 Zeichen formulieren — die wichtigste Zeile in Suche und KI-Zitaten.",
    score: (m) => (m.title.length >= 15 && m.title.length <= 60 ? 1 : m.title ? 0.5 : 0),
    detail: (m) => (m.title ? `${m.title.length} Zeichen` : "fehlt") },
  { id: "metadesc", label: "Meta-Description gesetzt (50–160 Zeichen)", pillar: "content", weight: 2, severity: "mittel",
    tipp: "Meta-Description ergänzen — die Kurzfassung der Seite für Suche und KI.",
    score: (m) => (m.metaDesc.length >= 50 && m.metaDesc.length <= 160 ? 1 : m.metaDesc ? 0.5 : 0),
    detail: (m) => (m.metaDesc ? `${m.metaDesc.length} Zeichen` : "fehlt") },
  { id: "h1", label: "Genau eine H1-Überschrift", pillar: "content", weight: 2, severity: "mittel",
    tipp: "Eine einzige H1 je Seite — sie benennt das Hauptthema.",
    score: (m) => (m.h1Count === 1 ? 1 : m.h1Count > 1 ? 0.5 : 0),
    detail: (m) => `${m.h1Count} H1` },
  { id: "structure", label: "Inhalts-Struktur (H2-Zwischentitel)", pillar: "content", weight: 1, severity: "niedrig",
    tipp: "Inhalte mit H2-Zwischentiteln gliedern — KI zitiert klar strukturierte Abschnitte.",
    score: (m) => (m.h2Count >= 2 ? 1 : m.h2Count === 1 ? 0.5 : 0),
    detail: (m) => `${m.h2Count} H2` },
  { id: "wordcount", label: "Ausreichender Textumfang", pillar: "content", weight: 2, severity: "mittel",
    tipp: "Mindestens ~300 Wörter echten Text — sehr dünne Seiten werden selten zitiert.",
    score: (m) => (m.words >= 300 ? 1 : m.words >= 120 ? 0.5 : 0),
    detail: (m) => `~${m.words} Wörter` },
  { id: "imgalt", label: "Bilder mit Alt-Texten", pillar: "content", weight: 1, severity: "niedrig",
    tipp: "Alt-Texte ergänzen (Quick Win) — Zugänglichkeit + Bilder-Suche + KI-Kontext.",
    score: (m) => (m.imgs === 0 || m.imgsNoAlt / m.imgs <= 0.2 ? 1 : m.imgsNoAlt / m.imgs <= 0.5 ? 0.5 : 0),
    detail: (m) => (m.imgs ? `${m.imgsNoAlt}/${m.imgs} ohne Alt` : "keine Bilder") },
  { id: "og", label: "Open-Graph-Tags (Vorschau)", pillar: "content", weight: 1, severity: "niedrig",
    tipp: "og:title/og:image setzen — bestimmt die Vorschau in Chats und Social Media.",
    score: (m) => (m.og ? 1 : 0), detail: (m) => (m.og ? "vorhanden" : "fehlen") },
  { id: "canonical", label: "Canonical-Tag", pillar: "technical", weight: 1, severity: "mittel",
    tipp: "Canonical-Link setzen, damit Suchmaschinen die Hauptversion kennen.",
    score: (m) => (m.canonical ? 1 : 0), detail: (m) => (m.canonical ? "vorhanden" : "fehlt") },
  { id: "schema", label: "Strukturierte Daten (Schema.org)", pillar: "aeo", weight: 3, severity: "hoch",
    tipp: "JSON-LD ergänzen — Grundfutter für Knowledge Graph und KI-Antworten.",
    score: (m) => (m.ldTypes.size > 0 ? 1 : 0),
    detail: (m) => (m.ldTypes.size ? [...m.ldTypes].slice(0, 4).join(", ") : "kein JSON-LD") },
  { id: "faq", label: "Antwort-Format (FAQ/Frage-Abschnitte)", pillar: "aeo", weight: 2, severity: "mittel",
    tipp: "FAQ-Abschnitte mit echten Fragen als Überschrift (+ FAQPage-Schema).",
    score: (m) => ([...m.ldTypes].some((t) => /faqpage|howto|question/i.test(t)) || m.questionHeadings > 0 ? 1 : m.lists > 0 ? 0.5 : 0),
    detail: (m) => ([...m.ldTypes].some((t) => /faqpage|howto/i.test(t)) ? "FAQ/HowTo-Schema" : m.questionHeadings ? `${m.questionHeadings} Frage-Überschriften` : m.lists ? "nur Listen" : "keine") },
];

// Sitemap → Seitenliste (eine Index-Ebene wird verfolgt).
async function collectPages(base: string, domain: string, sitemap: Fetched, homeHtml: string, max = 50): Promise<string[]> {
  const urls = new Set<string>();
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  let sitemapXml = sitemap.ok ? sitemap.text : "";
  if (sitemapXml && /<sitemapindex/i.test(sitemapXml)) {
    const children = locs(sitemapXml).slice(0, 2);
    sitemapXml = "";
    for (const c of children) {
      await pause(300);
      const r = await fetchText(c, 10000);
      if (r.ok) sitemapXml += r.text;
    }
  }
  for (const u of sitemapXml ? locs(sitemapXml) : []) {
    try {
      const p = new URL(u);
      if (!p.hostname.replace(/^www\./, "").endsWith(domain)) continue;
      if (/\.(jpg|jpeg|png|gif|webp|pdf|xml|svg)$/i.test(p.pathname)) continue;
      // Trailing-Slash normalisieren, sonst wird /seite und /seite/ doppelt geprüft.
      const norm = p.pathname.replace(/\/+$/, "");
      if (!norm) continue;
      urls.add(`https://${domain}${norm}`);
    } catch { /* kaputte URL überspringen */ }
  }
  // Fallback: interne Links der Startseite.
  if (urls.size === 0 && homeHtml) {
    for (const m of homeHtml.matchAll(/<a[^>]+href=["']([^"'#?]+)["']/gi)) {
      const href = m[1];
      let path = "";
      if (href.startsWith("/")) path = href;
      else if (href.includes(domain)) { try { path = new URL(href).pathname; } catch { continue; } }
      if (!path || /\.(jpg|jpeg|png|gif|webp|pdf|xml|svg|zip)$/i.test(path)) continue;
      const norm = path.replace(/\/+$/, "");
      if (!norm) continue;
      urls.add(`https://${domain}${norm}`);
    }
  }
  return [...urls]
    .sort((a, b) => (a.split("/").length - b.split("/").length) || (a.length - b.length))
    .slice(0, max);
}

// EzyAI-Analyse (14.08.2026): der Mess-Kern ist domain-basiert und wird auch
// vom Prospect-Audit (prospect-audit.server.ts) genutzt — Kunden-Auflösung,
// Cache und Persistenz bleiben Sache der Aufrufer.
export async function runSiteHealthForDomain(domain: string, mode: "quick" | "deep") {
  const base = `https://${domain}`;
  // Sequenziell mit Pausen — Kunden-Hoster sperren bei Burst-Abrufen.
  const home = await fetchText(base);
  await pause(400);
  const robots = await fetchText(`${base}/robots.txt`, 10000);
  await pause(400);
  const llms = await fetchText(`${base}/llms.txt`, 8000);
  await pause(400);
  const sitemap = await fetchText(`${base}/sitemap.xml`, 10000);

  // Seiten sammeln: Startseite immer; deep zusätzlich bis 50 Unterseiten.
  // Zeit-Wächter: das Hosting kappt Requests bei ~300 s — bei Zeitknappheit
  // (langsamer Hoster) wird ehrlich mit Teilergebnis abgebrochen.
  const started = Date.now();
  const TIME_BUDGET_MS = 220_000;
  const pageUrls: string[] = [base];
  if (mode === "deep") pageUrls.push(...await collectPages(base, domain, sitemap, home.text));
  const pageResults: Array<{ url: string; fetched: Fetched; metrics: PageMetrics | null }> = [
    { url: base, fetched: home, metrics: home.ok ? analyzeHtml(home.text, domain) : null },
  ];
  let truncated = 0;
  for (const u of pageUrls.slice(1)) {
    if (Date.now() - started > TIME_BUDGET_MS) { truncated = pageUrls.length - 1 - (pageResults.length - 1); break; }
    await pause(350);
    const f = await fetchText(u, 12000);
    pageResults.push({ url: u, fetched: f, metrics: f.ok ? analyzeHtml(f.text, domain) : null });
  }
  const okPages = pageResults.filter((p) => p.metrics);
  const homeMetrics = pageResults[0].metrics;

  const checks: CheckOut[] = [];
  const push = (c: Omit<CheckOut, "status" | "detail"> & { status: CheckOut["status"]; detail: string; pagesAffected?: string[] }) => checks.push(c as CheckOut);
  const pathOf = (u: string) => { try { return new URL(u).pathname || "/"; } catch { return u; } };

  // ── Globale Technical-Checks ────────────────────────────────────────
  push({ id: "https", label: "Website über HTTPS erreichbar", pillar: "technical", weight: 3, severity: "kritisch",
    tipp: "SSL-Zertifikat/Weiterleitung prüfen — ohne HTTPS werten Google wie KI-Systeme die Seite ab.",
    status: home.ok ? "ok" : "fail", detail: home.ok ? `HTTP ${home.status} in ${home.ms} ms` : `Startseite nicht ladbar (HTTP ${home.status})` });
  push({ id: "speed", label: "Antwortzeit der Startseite", pillar: "technical", weight: 2, severity: "hoch",
    tipp: "Server-Antwortzeit über Caching/Hosting verbessern — langsame Seiten lesen KI-Crawler seltener vollständig.",
    status: home.ms < 1500 ? "ok" : home.ms < 4000 ? "warn" : "fail", detail: `${home.ms} ms bis zur Antwort` });
  push({ id: "robots", label: "robots.txt vorhanden", pillar: "technical", weight: 2, severity: "hoch",
    tipp: "robots.txt anlegen — sie steuert, welche Crawler (auch KI-Bots) die Seite lesen dürfen.",
    status: robots.ok ? "ok" : "fail", detail: robots.ok ? "vorhanden" : `fehlt (HTTP ${robots.status})` });
  const sitemapInRobots = /^sitemap:/im.test(robots.text || "");
  push({ id: "sitemap", label: "XML-Sitemap auffindbar", pillar: "technical", weight: 2, severity: "mittel",
    tipp: "Sitemap unter /sitemap.xml bereitstellen und in der robots.txt verlinken.",
    status: sitemap.ok || sitemapInRobots ? "ok" : "fail",
    detail: sitemap.ok ? "/sitemap.xml erreichbar" : sitemapInRobots ? "in robots.txt verlinkt" : "weder /sitemap.xml noch robots-Eintrag" });
  push({ id: "viewport", label: "Mobile Viewport konfiguriert", pillar: "technical", weight: 2, severity: "hoch",
    tipp: "<meta name=viewport> ergänzen — ohne sie ist die Seite mobil kaum nutzbar.",
    status: homeMetrics?.viewport ? "ok" : "fail", detail: homeMetrics?.viewport ? "vorhanden" : "fehlt" });
  push({ id: "lang", label: "Sprache im HTML deklariert", pillar: "technical", weight: 1, severity: "niedrig",
    tipp: "<html lang=…> setzen — hilft Suche und Screenreadern.",
    status: homeMetrics?.langAttr ? "ok" : "fail", detail: homeMetrics?.langAttr ? "vorhanden" : "fehlt" });
  if (mode === "deep" && truncated > 0) {
    // Gewicht 0: reine Info, verfälscht keinen Score.
    push({ id: "coverage", label: "Seiten-Abdeckung des Tiefen-Audits", pillar: "technical", weight: 0, severity: "niedrig",
      tipp: "Der Hoster antwortete langsam — der Audit stoppte am Zeitbudget. Erneut ausführen prüft wieder von vorn.",
      status: "warn", detail: `${pageResults.length} geprüft, ${truncated} übersprungen (Zeitbudget)` });
  }
  if (mode === "deep") {
    const broken = pageResults.filter((p) => !p.fetched.ok);
    push({ id: "pagesok", label: "Alle geprüften Seiten erreichbar", pillar: "technical", weight: 2, severity: "hoch",
      tipp: "Nicht erreichbare Seiten aus der Sitemap entfernen oder reparieren (4xx/5xx).",
      status: broken.length === 0 ? "ok" : broken.length <= 2 ? "warn" : "fail",
      detail: `${pageResults.length - broken.length}/${pageResults.length} erreichbar`,
      pagesAffected: broken.map((p) => pathOf(p.url)).slice(0, 10) });
  }
  // Interne Verlinkung der Startseite (Content, global).
  push({ id: "intlinks", label: "Interne Verlinkung der Startseite", pillar: "content", weight: 1, severity: "mittel",
    tipp: "Wichtige Unterseiten von der Startseite verlinken — Crawler entdecken Inhalte über interne Links.",
    status: (homeMetrics?.internalLinks ?? 0) >= 10 ? "ok" : (homeMetrics?.internalLinks ?? 0) >= 4 ? "warn" : "fail",
    detail: `${homeMetrics?.internalLinks ?? 0} interne Links` });

  // ── Seiten-Checks (Content/AEO) über alle geprüften Seiten ─────────
  for (const def of PAGE_CHECKS) {
    const scored = okPages.map((p) => ({ path: pathOf(p.url), s: def.score(p.metrics!) }));
    const avg = scored.length ? scored.reduce((a, x) => a + x.s, 0) / scored.length : 0;
    const affected = scored.filter((x) => x.s < 1).map((x) => x.path);
    const status: CheckOut["status"] = avg >= 0.85 ? "ok" : avg >= 0.5 ? "warn" : "fail";
    const detail = okPages.length === 1 && okPages[0].metrics
      ? def.detail(okPages[0].metrics)
      : `${scored.length - affected.length}/${scored.length} Seiten in Ordnung`;
    push({ id: def.id, label: def.label, pillar: def.pillar, weight: def.weight, severity: def.severity,
      tipp: def.tipp, status, detail, ...(affected.length && okPages.length > 1 ? { pagesAffected: affected.slice(0, 10) } : {}) });
  }

  // ── Globale AEO-Checks ──────────────────────────────────────────────
  const blockedBots = robots.ok ? AI_BOTS.filter((b) => botBlocked(robots.text, b)) : [];
  const criticalBlocked = blockedBots.filter((b) => CRITICAL_BOTS.has(b));
  push({ id: "aibots", label: "KI-Crawler in robots.txt erlaubt", pillar: "aeo", weight: 3, severity: "kritisch",
    tipp: "Blockierte KI-Bots freigeben — wer GPTBot/ClaudeBot/PerplexityBot aussperrt, kommt in deren Antworten kaum vor.",
    status: criticalBlocked.length ? "fail" : blockedBots.length ? "warn" : "ok",
    detail: blockedBots.length ? `blockiert: ${blockedBots.join(", ")}` : "kein KI-Bot gesperrt" });
  const allLdTypes = new Set<string>(okPages.flatMap((p) => [...p.metrics!.ldTypes]));
  push({ id: "orgschema", label: "Organisations-/LocalBusiness-Schema", pillar: "aeo", weight: 2, severity: "mittel",
    tipp: "Organization- oder LocalBusiness-Markup mit Name, Logo und Adresse hinterlegen.",
    status: [...allLdTypes].some((t) => /organization|localbusiness|hotel|store|restaurant/i.test(t)) ? "ok" : "fail",
    detail: [...allLdTypes].some((t) => /organization|localbusiness|hotel|store|restaurant/i.test(t)) ? "vorhanden" : "fehlt" });
  push({ id: "llms", label: "llms.txt vorhanden", pillar: "aeo", weight: 1, severity: "niedrig",
    tipp: "Optional: llms.txt mit Kurzbeschreibung + wichtigsten Seiten — einzelne KI-Crawler lesen sie, Google ignoriert sie.",
    status: llms.ok ? "ok" : "warn", detail: llms.ok ? "vorhanden" : "fehlt (optional)" });

  // ── Scores (Searchable-Gewichte 30/35/35) ───────────────────────────
  const pillarScore = (p: Pillar) => {
    const list = checks.filter((c) => c.pillar === p);
    const max = list.reduce((a, c) => a + c.weight, 0) || 1;
    const got = list.reduce((a, c) => a + c.weight * (c.status === "ok" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
    return Math.round((got / max) * 100);
  };
  const technical = pillarScore("technical"), content = pillarScore("content"), aeo = pillarScore("aeo");
  const overall = Math.round(0.3 * technical + 0.35 * content + 0.35 * aeo);
  const issues = checks
    .filter((c) => c.status !== "ok")
    .map((c) => ({ id: c.id, label: c.label, pillar: c.pillar, status: c.status,
      severity: c.status === "warn" && c.severity === "kritisch" ? "hoch" : c.severity,
      detail: c.detail, tipp: c.tipp, ...(c.pagesAffected?.length ? { pages: c.pagesAffected } : {}) }))
    .sort((a, b) => ["kritisch", "hoch", "mittel", "niedrig"].indexOf(a.severity) - ["kritisch", "hoch", "mittel", "niedrig"].indexOf(b.severity));

  // Seiten-Tabelle: Einzel-Score je Seite aus den Seiten-Checks.
  const pages = pageResults.map((p) => {
    if (!p.metrics) return { path: pathOf(p.url), status: p.fetched.status, ms: p.fetched.ms, score: 0, title: "", issues: PAGE_CHECKS.length };
    const max = PAGE_CHECKS.reduce((a, c) => a + c.weight, 0);
    const got = PAGE_CHECKS.reduce((a, c) => a + c.weight * c.score(p.metrics!), 0);
    const bad = PAGE_CHECKS.filter((c) => c.score(p.metrics!) < 1).length;
    return { path: pathOf(p.url), status: p.fetched.status, ms: p.fetched.ms,
      score: Math.round((got / max) * 100), title: p.metrics.title.slice(0, 80), issues: bad };
  });

  return { url: base, mode, scores: { overall, technical, content, aeo }, checks, issues, pages,
    blockedBots, criticalBlocked, homeHtml: home.text,
    robotsOk: robots.ok, botDetails: robots.ok ? botDetailsFor(robots.text) : [] };
}

export const Route = createFileRoute("/api/admin/site-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acc = await requireAccess(request);
        if (acc instanceof Response) return acc;
        const clientId = new URL(request.url).searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const client = await resolveClient(acc.userClient, clientId);
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const { data } = await (supabaseAdmin as any)
          .from("site_health_audits")
          .select("at, url, mode, scores, checks, issues, pages")
          .eq("client_id", clientId)
          .order("at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return Response.json({ ok: true, audit: data ?? null });
      },

      POST: async ({ request }) => {
        const acc = await requireAccess(request);
        if (acc instanceof Response) return acc;
        const body: any = await request.json().catch(() => ({}));
        const clientId = String(body?.client || "");
        const mode: "quick" | "deep" = body?.mode === "deep" ? "deep" : "quick";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const client = await resolveClient(acc.userClient, clientId);
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const domain = String(client.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        if (!domain) return Response.json({ ok: false, error: "Kunde hat keine Domain hinterlegt" }, { status: 400 });

        // Gleicher Modus < 10 Min alt → gecachte Antwort (Hoster-Schonung).
        const { data: last } = await (supabaseAdmin as any)
          .from("site_health_audits")
          .select("at, url, mode, scores, checks, issues, pages")
          .eq("client_id", clientId)
          .eq("mode", mode)
          .order("at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (last && Date.now() - new Date(last.at).getTime() < 10 * 60_000)
          return Response.json({ ok: true, audit: last, cached: true });

        // Mess-Kern ist ausgelagert (EzyAI-Analyse nutzt ihn domain-basiert mit).
        const audit = await runSiteHealthForDomain(domain, mode);
        const row = { client_id: clientId, url: audit.url, mode, scores: audit.scores, checks: audit.checks, issues: audit.issues, pages: audit.pages };
        const { data: saved, error } = await (supabaseAdmin as any)
          .from("site_health_audits")
          .insert(row)
          .select("at, url, mode, scores, checks, issues, pages")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, audit: saved });
      },
    },
  },
});

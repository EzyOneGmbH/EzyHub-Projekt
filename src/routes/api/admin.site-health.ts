import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Site Health (05.08.2026, Searchable-Nachbau "Site Audits"):
// On-demand-Audit der Kunden-Website — KOSTENLOSE Live-Checks (Startseite,
// robots.txt, llms.txt, sitemap.xml), aggregiert zu drei Säulen mit den
// Searchable-Gewichten (Technical 30 % / Content 35 % / AEO 35 %) plus
// Issue-Liste mit Severity (kritisch/hoch/mittel/niedrig).
//
// GET  ?client=<uuid>          → letzter gespeicherter Audit (oder null)
// POST {client}                → Audit jetzt ausführen + speichern;
//                                läuft der letzte Audit < 10 Min, wird er
//                                zurückgegeben (kein Hoster-Hammering —
//                                Lektion FIH: zu schnelle Abrufe = IP-Sperre).
//
// Auth: eingeloggter User (RLS-Kundensicht) ODER Bearer ADMIN_AUTOMATION_SECRET
// (für Tests/Automatisierung).

type CheckDef = {
  id: string;
  label: string;
  pillar: "technical" | "content" | "aeo";
  weight: number; // Gewicht innerhalb der Säule
  severity: "kritisch" | "hoch" | "mittel" | "niedrig"; // wenn nicht bestanden
  tipp: string;
};
type CheckResult = CheckDef & { status: "ok" | "warn" | "fail"; detail: string };

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null }; // Voll-Zugriff
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

const AI_BOTS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Bytespider", "meta-externalagent", "Amazonbot"];
const CRITICAL_BOTS = new Set(["GPTBot", "ClaudeBot", "PerplexityBot"]);

// robots.txt: ist der Bot durch "Disallow: /" in seiner UA-Gruppe (oder *) gesperrt?
function botBlocked(robots: string, bot: string): boolean {
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
  // Explizite Bot-Gruppe gewinnt; sonst zählt die *-Gruppe.
  const hasOwnGroup = new RegExp(`^user-agent:\\s*${bot}\\s*$`, "im").test(robots);
  return hasOwnGroup ? blocked : starBlocked;
}

async function fetchText(url: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; text: string; ms: number; finalUrl: string }> {
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

function runAudit(domain: string, home: Awaited<ReturnType<typeof fetchText>>, robots: Awaited<ReturnType<typeof fetchText>>, llms: Awaited<ReturnType<typeof fetchText>>, sitemap: Awaited<ReturnType<typeof fetchText>>) {
  const html = home.text || "";
  const lower = html.toLowerCase();
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
  const words = stripped.split(/\s+/).filter((w) => w.length > 1).length;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "";
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  const imgs = html.match(/<img[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length;
  const internalLinks = (html.match(new RegExp(`<a[^>]+href=["'](?:https?://(?:www\\.)?${domain.replace(/\./g, "\\.")})?/[^"']*["']`, "gi")) || []).length;
  const jsonLdBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const ldTypes = new Set<string>();
  for (const b of jsonLdBlocks) for (const m of b.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) ldTypes.add(m[1]);
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const og = /<meta[^>]+property=["']og:(?:title|image)["']/i.test(html);
  const langAttr = /<html[^>]+lang=/i.test(html);
  const lists = (html.match(/<(?:ul|ol)[\s>]/gi) || []).length;
  const questionHeadings = (html.match(/<h[23][^>]*>[^<]*\?/gi) || []).length;
  const sitemapInRobots = /^sitemap:/im.test(robots.text || "");
  const blockedBots = robots.ok ? AI_BOTS.filter((b) => botBlocked(robots.text, b)) : [];
  const criticalBlocked = blockedBots.filter((b) => CRITICAL_BOTS.has(b));

  const R = (def: CheckDef, status: CheckResult["status"], detail: string): CheckResult => ({ ...def, status, detail });
  const checks: CheckResult[] = [];

  // ── Technical (Säule 30 %) ──────────────────────────────────────────────
  checks.push(R({ id: "https", label: "Website über HTTPS erreichbar", pillar: "technical", weight: 3, severity: "kritisch", tipp: "SSL-Zertifikat/Weiterleitung prüfen — ohne HTTPS werten Google wie KI-Systeme die Seite ab." },
    home.ok ? "ok" : "fail", home.ok ? `HTTP ${home.status} in ${home.ms} ms` : `Startseite nicht ladbar (HTTP ${home.status})`));
  checks.push(R({ id: "speed", label: "Antwortzeit der Startseite", pillar: "technical", weight: 2, severity: "hoch", tipp: "Server-Antwortzeit über Caching/Hosting verbessern — langsame Seiten werden von KI-Crawlern seltener vollständig gelesen." },
    home.ms < 1500 ? "ok" : home.ms < 4000 ? "warn" : "fail", `${home.ms} ms bis zur Antwort`));
  checks.push(R({ id: "robots", label: "robots.txt vorhanden", pillar: "technical", weight: 2, severity: "hoch", tipp: "robots.txt anlegen — sie steuert, welche Crawler (auch KI-Bots) die Seite lesen dürfen." },
    robots.ok ? "ok" : "fail", robots.ok ? "vorhanden" : `fehlt (HTTP ${robots.status})`));
  checks.push(R({ id: "sitemap", label: "XML-Sitemap auffindbar", pillar: "technical", weight: 2, severity: "mittel", tipp: "Sitemap unter /sitemap.xml bereitstellen und in der robots.txt verlinken." },
    sitemap.ok || sitemapInRobots ? "ok" : "fail", sitemap.ok ? "/sitemap.xml erreichbar" : sitemapInRobots ? "in robots.txt verlinkt" : "weder /sitemap.xml noch robots-Eintrag"));
  checks.push(R({ id: "canonical", label: "Canonical-Tag auf der Startseite", pillar: "technical", weight: 1, severity: "mittel", tipp: "Canonical-Link setzen, damit Suchmaschinen die Hauptversion der Seite kennen." },
    canonical ? "ok" : "fail", canonical ? "vorhanden" : "fehlt"));
  checks.push(R({ id: "viewport", label: "Mobile Viewport konfiguriert", pillar: "technical", weight: 2, severity: "hoch", tipp: "<meta name=viewport> ergänzen — ohne sie ist die Seite auf Mobilgeräten kaum nutzbar." },
    viewport ? "ok" : "fail", viewport ? "vorhanden" : "fehlt"));
  checks.push(R({ id: "lang", label: "Sprache im HTML deklariert", pillar: "technical", weight: 1, severity: "niedrig", tipp: "<html lang=…> setzen — hilft Suchmaschinen und Screenreadern bei der Sprachzuordnung." },
    langAttr ? "ok" : "fail", langAttr ? "vorhanden" : "fehlt"));

  // ── Content (Säule 35 %) ────────────────────────────────────────────────
  checks.push(R({ id: "title", label: "Seitentitel gesetzt und sinnvoll lang", pillar: "content", weight: 3, severity: "hoch", tipp: "Title mit 15–60 Zeichen formulieren — er ist die wichtigste Zeile in Suche und KI-Zitaten." },
    title.length >= 15 && title.length <= 60 ? "ok" : title.length > 0 ? "warn" : "fail", title ? `${title.length} Zeichen: „${title.slice(0, 60)}"` : "fehlt"));
  checks.push(R({ id: "metadesc", label: "Meta-Description gesetzt (50–160 Zeichen)", pillar: "content", weight: 2, severity: "mittel", tipp: "Meta-Description ergänzen — sie liefert Suchmaschinen und KI die Kurzfassung der Seite." },
    metaDesc.length >= 50 && metaDesc.length <= 160 ? "ok" : metaDesc.length > 0 ? "warn" : "fail", metaDesc ? `${metaDesc.length} Zeichen` : "fehlt"));
  checks.push(R({ id: "h1", label: "Genau eine H1-Überschrift", pillar: "content", weight: 2, severity: "mittel", tipp: "Eine einzige H1 je Seite — sie benennt das Hauptthema für Leser, Suche und KI." },
    h1Count === 1 ? "ok" : h1Count > 1 ? "warn" : "fail", `${h1Count} H1 gefunden`));
  checks.push(R({ id: "structure", label: "Inhalts-Struktur (H2-Zwischentitel)", pillar: "content", weight: 1, severity: "niedrig", tipp: "Inhalte mit H2-Zwischentiteln gliedern — KI-Systeme zitieren bevorzugt klar strukturierte Abschnitte." },
    h2Count >= 2 ? "ok" : h2Count === 1 ? "warn" : "fail", `${h2Count} H2 gefunden`));
  checks.push(R({ id: "wordcount", label: "Textumfang der Startseite", pillar: "content", weight: 2, severity: "mittel", tipp: "Mindestens ~300 Wörter echten Text bieten — sehr dünne Seiten werden selten zitiert." },
    words >= 300 ? "ok" : words >= 120 ? "warn" : "fail", `~${words} Wörter`));
  checks.push(R({ id: "imgalt", label: "Bilder mit Alt-Texten", pillar: "content", weight: 1, severity: "niedrig", tipp: "Alt-Texte ergänzen (Quick Win) — Zugänglichkeit + Bilder-Suche + KI-Kontext." },
    imgs.length === 0 || imgsNoAlt / imgs.length <= 0.2 ? "ok" : imgsNoAlt / imgs.length <= 0.5 ? "warn" : "fail", imgs.length ? `${imgsNoAlt}/${imgs.length} ohne Alt-Text` : "keine Bilder auf der Startseite"));
  checks.push(R({ id: "og", label: "Open-Graph-Tags (Social/KI-Vorschau)", pillar: "content", weight: 1, severity: "niedrig", tipp: "og:title/og:image setzen — bestimmt die Vorschau in Chats, Social Media und teils KI-Antworten." },
    og ? "ok" : "fail", og ? "vorhanden" : "fehlen"));
  checks.push(R({ id: "intlinks", label: "Interne Verlinkung", pillar: "content", weight: 1, severity: "mittel", tipp: "Wichtige Unterseiten von der Startseite verlinken — Crawler entdecken Inhalte über interne Links." },
    internalLinks >= 10 ? "ok" : internalLinks >= 4 ? "warn" : "fail", `${internalLinks} interne Links gefunden`));

  // ── AEO / AI-Readiness (Säule 35 %) ─────────────────────────────────────
  checks.push(R({ id: "aibots", label: "KI-Crawler in robots.txt erlaubt", pillar: "aeo", weight: 3, severity: "kritisch", tipp: "Blockierte KI-Bots freigeben — wer GPTBot/ClaudeBot/PerplexityBot aussperrt, kommt in deren Antworten kaum vor." },
    criticalBlocked.length ? "fail" : blockedBots.length ? "warn" : "ok",
    blockedBots.length ? `blockiert: ${blockedBots.join(", ")}` : "kein KI-Bot gesperrt"));
  checks.push(R({ id: "schema", label: "Strukturierte Daten (Schema.org)", pillar: "aeo", weight: 3, severity: "hoch", tipp: "JSON-LD ergänzen (Organization/LocalBusiness + passende Typen) — Grundfutter für Knowledge Graph und KI-Antworten." },
    ldTypes.size > 0 ? "ok" : "fail", ldTypes.size ? [...ldTypes].slice(0, 6).join(", ") : "kein JSON-LD gefunden"));
  checks.push(R({ id: "orgschema", label: "Organisations-/LocalBusiness-Schema", pillar: "aeo", weight: 2, severity: "mittel", tipp: "Organization- oder LocalBusiness-Markup mit Name, Logo und Adresse hinterlegen." },
    [...ldTypes].some((t) => /organization|localbusiness|hotel|store|restaurant/i.test(t)) ? "ok" : "fail",
    [...ldTypes].some((t) => /organization|localbusiness|hotel|store|restaurant/i.test(t)) ? "vorhanden" : "fehlt"));
  checks.push(R({ id: "faq", label: "Antwort-Format (FAQ/Frage-Abschnitte)", pillar: "aeo", weight: 2, severity: "mittel", tipp: "FAQ-Abschnitte mit echten Fragen als Überschrift (+ FAQPage-Schema) — das Format, das KI-Systeme direkt übernehmen." },
    [...ldTypes].some((t) => /faqpage|howto|question/i.test(t)) || questionHeadings > 0 ? "ok" : lists > 0 ? "warn" : "fail",
    [...ldTypes].some((t) => /faqpage|howto/i.test(t)) ? "FAQ/HowTo-Schema vorhanden" : questionHeadings ? `${questionHeadings} Frage-Überschriften` : lists ? `${lists} Listen, aber keine Frage-Abschnitte` : "keine Antwort-Formate erkennbar"));
  checks.push(R({ id: "llms", label: "llms.txt vorhanden", pillar: "aeo", weight: 1, severity: "niedrig", tipp: "Optional: llms.txt mit Kurzbeschreibung + wichtigsten Seiten — einzelne KI-Crawler lesen sie, Google ignoriert sie." },
    llms.ok ? "ok" : "warn", llms.ok ? "vorhanden" : "fehlt (optional)"));

  // ── Scores: ok=1, warn=0.5, fail=0 — gewichtet je Säule; Gesamt nach
  //    Searchable-Gewichten (Technical 30 % / Content 35 % / AEO 35 %). ──
  const pillarScore = (p: CheckResult["pillar"]) => {
    const list = checks.filter((c) => c.pillar === p);
    const max = list.reduce((a, c) => a + c.weight, 0) || 1;
    const got = list.reduce((a, c) => a + c.weight * (c.status === "ok" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
    return Math.round((got / max) * 100);
  };
  const technical = pillarScore("technical");
  const content = pillarScore("content");
  const aeo = pillarScore("aeo");
  const overall = Math.round(0.3 * technical + 0.35 * content + 0.35 * aeo);
  const issues = checks
    .filter((c) => c.status !== "ok")
    .map((c) => ({ id: c.id, label: c.label, pillar: c.pillar, severity: c.status === "warn" && c.severity === "kritisch" ? "hoch" : c.severity, status: c.status, detail: c.detail, tipp: c.tipp }))
    .sort((a, b) => ["kritisch", "hoch", "mittel", "niedrig"].indexOf(a.severity) - ["kritisch", "hoch", "mittel", "niedrig"].indexOf(b.severity));

  return { scores: { overall, technical, content, aeo }, checks, issues };
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
          .select("at, url, scores, checks, issues")
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
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const client = await resolveClient(acc.userClient, clientId);
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const domain = String(client.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        if (!domain) return Response.json({ ok: false, error: "Kunde hat keine Domain hinterlegt" }, { status: 400 });

        // Frischer Audit < 10 Min? Dann den liefern (kein Hoster-Hammering).
        const { data: last } = await (supabaseAdmin as any)
          .from("site_health_audits")
          .select("at, url, scores, checks, issues")
          .eq("client_id", clientId)
          .order("at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (last && Date.now() - new Date(last.at).getTime() < 10 * 60_000)
          return Response.json({ ok: true, audit: last, cached: true });

        const base = `https://${domain}`;
        // Sequenziell mit kleinen Pausen — Kunden-Hoster sperren bei Burst-Abrufen.
        const home = await fetchText(base);
        await new Promise((r) => setTimeout(r, 400));
        const robots = await fetchText(`${base}/robots.txt`, 10000);
        await new Promise((r) => setTimeout(r, 400));
        const llms = await fetchText(`${base}/llms.txt`, 8000);
        await new Promise((r) => setTimeout(r, 400));
        const sitemap = await fetchText(`${base}/sitemap.xml`, 10000);

        const result = runAudit(domain, home, robots, llms, sitemap);
        const row = { client_id: clientId, url: base, scores: result.scores, checks: result.checks, issues: result.issues };
        const { data: saved, error } = await (supabaseAdmin as any)
          .from("site_health_audits")
          .insert(row)
          .select("at, url, scores, checks, issues")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, audit: saved });
      },
    },
  },
});

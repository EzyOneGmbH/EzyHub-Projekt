// Blog-Autopilot Phase 2: Website-Analyse (Bauanleitung Kap. 6.1, Onboarding
// Schritt 2). Läuft als Stufen-Job im minütlichen Worker; jede Phase ist
// einzeln wiederholbar und passt ins Zeitbudget eines Ticks:
//   lesen       Startseite + Sitemap (max. 20 Seiten), Text, Links, Sprache
//   profil      Claude: Angebot, Zielgruppen, Ton, Regeln, Cluster, CTA, Bildstil
//   mitbewerber Claude mit Websuche: Kandidaten finden und prüfen, Erreichbarkeit
//   abschluss   Ergebnis zusammenstellen, KI-Mitbewerber speichern
// KI-Aufrufe nur serverseitig, Tokens in api_cost_daily.
import { z } from "zod";
import { KiLaeuftNoch, runnerAktiv, runnerText } from "@/server/ki-runner.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordApiCost } from "@/server/api-cost.server";
import { blogEvent, normalisiereDomain } from "@/server/blog-autopilot.server";
import { ANALYSE_PHASEN, ANALYSE_STUFEN, BILDSTILE, SPRACHEN } from "@/ezy/data/blogAutopilot";

const SB = supabaseAdmin as any;
const UA = "Mozilla/5.0 (compatible; EzyHubBot/1.0; +https://ezyhub.ch)";
const MAX_SEITEN = 20;
const TEXT_PRO_SEITE = 3000;
const MAX_VERSUCHE = 3;
const PHASEN = ["lesen", "profil", "mitbewerber", "abschluss"] as const;
type Phase = (typeof PHASEN)[number];

// ── Reine Helfer (vitest) ───────────────────────────────────────────────────

const ENT: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ss",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
};
export function entitaeten(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
}

export function htmlZuText(html: string): string {
  return entitaeten(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function metaAus(html: string) {
  const g = (re: RegExp) => entitaeten((html.match(re)?.[1] || "").trim());
  return {
    title: g(/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, " "),
    description: g(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i),
    h1: htmlZuText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ""),
    lang: g(/<html[^>]*\slang=["']([^"']+)["']/i),
  };
}

/** <loc>-Einträge einer Sitemap; index=true, wenn es eine Sitemap-Index-Datei ist. */
export function sitemapLocs(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => entitaeten(m[1]));
  return { index: /<sitemapindex/i.test(xml), locs };
}

const WICHTIG =
  /(ueber|uber|about|wir|team|projekt|angebot|leistung|dienst|service|spend|helfen|mission|geschichte|kontakt|preise|produkt)/i;
const AUSSCHLUSS =
  /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)$|\/(tag|category|kategorie|author|autor|page|feed|wp-json|wp-content|cart|checkout|warenkorb|konto|account|login)\b|[?#]/i;

/** Bis zu max Unterseiten derselben Domain wählen: wichtige und flache zuerst. */
export function waehleSeiten(urls: string[], domain: string, max: number): string[] {
  const host = (u: string) => {
    try {
      return normalisiereDomain(new URL(u).host);
    } catch {
      return "";
    }
  };
  const eindeutig = [...new Set(urls.map((u) => u.replace(/\/+$/, "/")))];
  const kandidaten = eindeutig.filter((u) => {
    if (host(u) !== domain || AUSSCHLUSS.test(u)) return false;
    try {
      return new URL(u).pathname !== "/";
    } catch {
      return false;
    }
  });
  const tiefe = (u: string) => new URL(u).pathname.split("/").filter(Boolean).length;
  return kandidaten
    .map((u) => ({ u, s: (WICHTIG.test(u) ? 0 : 10) + tiefe(u) * 2 + u.length / 100 }))
    .sort((a, b) => a.s - b.s)
    .slice(0, max)
    .map((x) => x.u);
}

const CTA_RE =
  /(spend|donat|raisenow|unterst[uü]tz|helfen|mitglied|kontakt|termin|anfrage|offerte|buchen|kaufen|shop|jetzt|newsletter|beratung)/i;

/** Link-Kandidaten für den Call to Action (Text + absolute URL, nur https). */
export function ctaKandidaten(html: string, basis: string): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = htmlZuText(m[2]).replace(/\s+/g, " ").slice(0, 80);
    let url: string;
    try {
      url = new URL(entitaeten(m[1]), basis).toString();
    } catch {
      continue;
    }
    if (!/^https:\/\//i.test(url)) continue;
    if (!CTA_RE.test(text) && !CTA_RE.test(url)) continue;
    if (!out.some((o) => o.url === url)) out.push({ url, text });
    if (out.length >= 15) break;
  }
  return out;
}

export function jsonAusText(text: string): any {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("KI-Antwort ohne JSON");
  return JSON.parse(text.slice(a, b + 1));
}

// ── KI-Profil (tolerant geparst) ────────────────────────────────────────────

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .catch("");

export const ProfilSchema = z.object({
  name: text(200),
  description: text(4000),
  audiences: z
    .array(z.string())
    .transform((a) =>
      a
        .map((s) => s.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 4),
    )
    .catch([]),
  market: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^[A-Z]{2}$/.test(s))
    .catch("CH"),
  language: z.enum(SPRACHEN).catch("de-CH"),
  local_business: z.boolean().catch(false),
  tone: z.enum(["informativ", "gespraechig", "ueberzeugend"]).catch("informativ"),
  tone_reason: text(300),
  rules: z
    .array(z.string())
    .transform((a) =>
      a
        .map((s) => s.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 6),
    )
    .catch([]),
  clusters: z
    .array(
      z.object({
        name: text(80),
        seeds: z
          .array(z.string())
          .transform((a) =>
            a
              .map((s) => s.trim().toLowerCase().slice(0, 80))
              .filter(Boolean)
              .slice(0, 6),
          )
          .catch([]),
      }),
    )
    .transform((a) => a.filter((c) => c.name).slice(0, 6))
    .catch([]),
  cta: z
    .object({ label: text(80), url: z.string(), text: text(300) })
    .nullable()
    .catch(null),
  image_style: z.enum(BILDSTILE.map((b) => b.id) as [string, ...string[]]).catch("fotografisch"),
  competitor_hints: z.array(z.string()).catch([]),
});
export type Profil = z.infer<typeof ProfilSchema>;

/** CTA nur übernehmen, wenn die URL wirklich auf der Website verlinkt ist. */
export function pruefeProfil(roh: unknown, links: Array<{ url: string }>): Profil {
  const p = ProfilSchema.parse(roh ?? {});
  if (p.cta && !links.some((l) => l.url === p.cta!.url)) p.cta = null;
  return p;
}

// ── Website lesen ───────────────────────────────────────────────────────────

async function holen(url: string, timeoutMs = 10_000) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = r.headers.get("content-type") || "";
    const body = r.ok ? await r.text() : "";
    return { ok: r.ok, status: r.status, url: r.url || url, ct, body: body.slice(0, 1_500_000) };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url,
      ct: "",
      body: "",
      fehler: String((e as Error)?.message || e),
    };
  }
}

async function sitemapUrls(basis: string): Promise<string[]> {
  const robots = await holen(`${basis}/robots.txt`, 6000);
  const ausRobots = robots.ok
    ? [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
    : [];
  const start = ausRobots.length
    ? ausRobots
    : [`${basis}/sitemap.xml`, `${basis}/sitemap_index.xml`, `${basis}/wp-sitemap.xml`];
  const urls: string[] = [];
  const offen = [...start];
  let abrufe = 0;
  while (offen.length && abrufe < 6 && urls.length < 500) {
    const sm = offen.shift()!;
    abrufe++;
    const r = await holen(sm, 8000);
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    const { index, locs } = sitemapLocs(r.body);
    if (index) {
      // Seiten-Sitemaps zuerst, dann Beiträge
      const sortiert = [...locs].sort(
        (a, b) => Number(!/page/i.test(a)) - Number(!/page/i.test(b)),
      );
      offen.push(...sortiert.slice(0, 4));
    } else urls.push(...locs);
    if (ausRobots.length === 0 && urls.length) break;
  }
  return urls;
}

export type Seite = { url: string; title: string; description: string; h1: string; text: string };

export async function leseWebsite(domain: string) {
  const basis = `https://${domain}`;
  const start = await holen(`${basis}/`, 12_000);
  if (!start.ok || !/html/i.test(start.ct))
    throw new Error(
      `Website nicht erreichbar (${start.status || (start as any).fehler || "keine Antwort"})`,
    );
  const echteBasis = new URL(start.url).origin;
  const meta = metaAus(start.body);
  const seiten: Seite[] = [
    { url: start.url, ...meta, text: htmlZuText(start.body).slice(0, TEXT_PRO_SEITE) },
  ];
  const links = ctaKandidaten(start.body, start.url);

  const ausSitemap = await sitemapUrls(echteBasis);
  const ausStartseite = [...start.body.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => {
    try {
      return new URL(entitaeten(m[1]), start.url).toString();
    } catch {
      return "";
    }
  });
  const auswahl = waehleSeiten([...ausSitemap, ...ausStartseite], domain, MAX_SEITEN - 1);
  for (let i = 0; i < auswahl.length; i += 4) {
    const teil = await Promise.all(auswahl.slice(i, i + 4).map((u) => holen(u, 10_000)));
    for (const r of teil) {
      if (!r.ok || !/html/i.test(r.ct)) continue;
      const m = metaAus(r.body);
      seiten.push({
        url: r.url,
        title: m.title,
        description: m.description,
        h1: m.h1,
        text: htmlZuText(r.body).slice(0, TEXT_PRO_SEITE),
      });
      for (const l of ctaKandidaten(r.body, r.url))
        if (links.length < 15 && !links.some((x) => x.url === l.url)) links.push(l);
    }
  }
  return { seiten, links, lang: meta.lang, sitemap_urls: ausSitemap.length };
}

// ── Claude ──────────────────────────────────────────────────────────────────

const MODELL = () => process.env.BLOG_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const SUCH_TOOL = () =>
  /sonnet-5|sonnet-4-6|opus-4-[678]|opus-5|fable/.test(MODELL())
    ? "web_search_20260209"
    : "web_search_20250305";

export async function claudeText(opts: {
  system: string;
  prompt: string;
  maxTokens: number;
  websuche?: number;
  timeoutMs: number;
  modell?: string;
}): Promise<string> {
  if (runnerAktiv()) return runnerText(opts);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("KI ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt)");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELL(),
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      ...(opts.websuche
        ? { tools: [{ type: SUCH_TOOL(), name: "web_search", max_uses: opts.websuche }] }
        : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!r.ok)
    throw new Error(`Claude HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const j: any = await r.json();
  await recordApiCost({
    provider: "Claude",
    tokensIn: Number(j?.usage?.input_tokens || 0),
    tokensOut: Number(j?.usage?.output_tokens || 0),
  });
  return (j?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => String(b.text || ""))
    .join("\n");
}

const SYSTEM =
  "Du analysierst Websites für einen Blog-Autopiloten einer Schweizer SEO-Agentur. " +
  "Antworte ausschliesslich mit einem JSON-Objekt, ohne Erklärung davor oder danach. " +
  "Schreibe Deutsch mit Schweizer Rechtschreibung (immer «ss», nie «ß»), sofern die Website nicht anders spricht. " +
  "Erfinde nichts: nur, was die Website belegt.";

export function profilPrompt(
  domain: string,
  lese: { seiten: Seite[]; links: any[]; lang: string },
) {
  const seiten = lese.seiten
    .map(
      (s, i) =>
        `### Seite ${i + 1}: ${s.url}\nTitel: ${s.title}\nH1: ${s.h1}\nBeschreibung: ${s.description}\n${s.text}`,
    )
    .join("\n\n");
  return `Website: ${domain} (html lang="${lese.lang || "?"}")

${seiten}

### Verlinkte Aktions-Links (nur aus diesen darf der CTA stammen)
${lese.links.map((l) => `- ${l.text || "(ohne Text)"} → ${l.url}`).join("\n") || "(keine)"}

Gib dieses JSON zurück:
{
  "name": "Name der Organisation/Firma",
  "description": "Was sie macht, 3–6 Sätze, sachlich, max. 1200 Zeichen",
  "audiences": ["1–4 Zielgruppen, je eine Zeile, konkret (wer, warum)"],
  "market": "ISO-Ländercode des Hauptmarkts, z. B. CH",
  "language": "eine von ${SPRACHEN.join(", ")}",
  "local_business": true/false (Kunden vor allem aus einer Region/Ort?),
  "tone": "informativ | gespraechig | ueberzeugend",
  "tone_reason": "ein Satz, warum dieser Ton zur Website passt",
  "rules": ["3–6 Schreibregeln, die zur Marke passen (z. B. Anrede, Begriffe, Tabus)"],
  "clusters": [{"name": "Themen-Cluster für den Blog", "seeds": ["2–5 deutsche Such-Keywords"]}],
  "cta": {"label": "Button-Text", "url": "EXAKT eine URL aus der Link-Liste", "text": "ein kurzer Satz"} oder null,
  "image_style": "eine von ${BILDSTILE.map((b) => b.id).join(", ")}",
  "competitor_hints": ["Domains von Mitbewerbern, falls auf der Website erwähnt, sonst leer"]
}
3–6 Cluster. Seeds sind echte Suchbegriffe, die Menschen bei Google eingeben würden.`;
}

export const MitbewerberSchema = z.object({
  bestaetigt: z.array(z.object({ domain: z.string(), grund: z.string().catch("") })).catch([]),
  unbestaetigt: z.array(z.object({ domain: z.string(), grund: z.string().catch("") })).catch([]),
});

/** Domains normalisieren, eigene und doppelte entfernen, auf max begrenzen. */
export function bereinigeMitbewerber(
  roh: z.infer<typeof MitbewerberSchema>,
  eigene: string,
  max = 8,
) {
  const gesehen = new Set<string>([eigene]);
  const fix = (l: Array<{ domain: string; grund: string }>) =>
    l
      .map((c) => ({ domain: normalisiereDomain(c.domain), grund: c.grund.slice(0, 200) }))
      .filter((c) => c.domain && !gesehen.has(c.domain) && (gesehen.add(c.domain), true));
  const bestaetigt = fix(roh.bestaetigt).slice(0, max);
  const unbestaetigt = fix(roh.unbestaetigt).slice(0, max);
  return { bestaetigt, unbestaetigt };
}

function mitbewerberPrompt(domain: string, p: Profil) {
  return `Wir analysieren ${domain}: ${p.name}.
Angebot: ${p.description}
Markt: ${p.market}, Sprache: ${p.language}${p.local_business ? ", lokal tätig" : ""}
Themen: ${p.clusters.map((c) => c.name).join(", ")}
Hinweise von der Website: ${p.competitor_hints.join(", ") || "keine"}

Suche im Web nach 3–8 echten Mitbewerbern: Organisationen oder Firmen mit gleichem Angebot im gleichen Markt,
die um dieselben Leser bzw. Kunden werben. Keine Verzeichnisse, Medien, Social-Media-Seiten, Behörden oder Marktplätze.
Prüfe jede Domain anhand der Suchergebnisse. Unsichere Kandidaten kommen in "unbestaetigt".

Antworte nur mit:
{"bestaetigt":[{"domain":"beispiel.ch","grund":"ein Satz"}],"unbestaetigt":[{"domain":"…","grund":"…"}]}`;
}

async function erreichbar(domain: string): Promise<boolean> {
  const r = await holen(`https://${domain}/`, 8000);
  return r.ok;
}

// ── Stufen-Job ──────────────────────────────────────────────────────────────

const label = (k: string) => ANALYSE_STUFEN.find((s) => s.key === k)!;

function ereignisse(phase: Phase, details: Record<string, string>) {
  const at = new Date().toISOString();
  return ANALYSE_PHASEN[phase].map((k) => ({
    at,
    key: k,
    label: label(k).label,
    percent: label(k).percent,
    status: "fertig",
    detail: details[k] ?? "",
  }));
}

async function fuehrePhaseAus(run: any, project: any): Promise<{ next: Phase | null; patch: any }> {
  const state = run.state || {};
  const phase = run.stage as Phase;
  if (phase === "lesen") {
    const lese = await leseWebsite(project.domain);
    return {
      next: "profil",
      patch: {
        state: { ...state, lese },
        percent: 20,
        events: [
          ...(run.events || []),
          ...ereignisse("lesen", {
            lesen: `${lese.seiten.length} Seiten gelesen${lese.sitemap_urls ? `, Sitemap mit ${lese.sitemap_urls} Adressen` : ""}`,
          }),
        ],
      },
    };
  }
  if (phase === "profil") {
    const roh = await claudeText({
      system: SYSTEM,
      prompt: profilPrompt(project.domain, state.lese),
      maxTokens: 3000,
      timeoutMs: 100_000,
    });
    const profil = pruefeProfil(jsonAusText(roh), state.lese?.links ?? []);
    return {
      next: "mitbewerber",
      patch: {
        state: { ...state, profil },
        percent: 45,
        events: [
          ...(run.events || []),
          ...ereignisse("profil", {
            angebot: profil.name || "Angebot erkannt",
            zielgruppen: `${profil.audiences.length} Zielgruppen`,
          }),
        ],
      },
    };
  }
  if (phase === "mitbewerber") {
    const profil: Profil = state.profil;
    let liste = { bestaetigt: [] as any[], unbestaetigt: [] as any[] };
    try {
      const roh = await claudeText({
        system: SYSTEM,
        prompt: mitbewerberPrompt(project.domain, profil),
        maxTokens: 2000,
        websuche: 4,
        timeoutMs: 110_000,
      });
      liste = bereinigeMitbewerber(MitbewerberSchema.parse(jsonAusText(roh)), project.domain);
    } catch (e) {
      if (e instanceof KiLaeuftNoch) throw e;
      // Suche fehlgeschlagen: Hinweise von der Website als «nicht bestätigt» zeigen
      liste = bereinigeMitbewerber(
        {
          bestaetigt: [],
          unbestaetigt: profil.competitor_hints.map((d) => ({
            domain: d,
            grund: "Auf der Website erwähnt",
          })),
        },
        project.domain,
      );
    }
    const pruef = await Promise.all(liste.bestaetigt.map((c) => erreichbar(c.domain)));
    const bestaetigt = liste.bestaetigt.filter((_, i) => pruef[i]);
    const unbestaetigt = [
      ...liste.bestaetigt
        .filter((_, i) => !pruef[i])
        .map((c) => ({ ...c, grund: "Website nicht erreichbar" })),
      ...liste.unbestaetigt,
    ];
    return {
      next: "abschluss",
      patch: {
        state: { ...state, mitbewerber: { bestaetigt, unbestaetigt } },
        percent: 75,
        events: [
          ...(run.events || []),
          ...ereignisse("mitbewerber", {
            mitbewerber_suchen: `${bestaetigt.length + unbestaetigt.length} Kandidaten`,
            mitbewerber_pruefen: `${bestaetigt.length} bestätigt`,
          }),
        ],
      },
    };
  }
  // abschluss
  const profil: Profil = state.profil;
  const mb = state.mitbewerber ?? { bestaetigt: [], unbestaetigt: [] };
  const { data: vorhanden } = await SB.from("blog_competitors")
    .select("domain")
    .eq("project_id", project.id);
  const schon = new Set((vorhanden ?? []).map((c: any) => c.domain));
  const neu = [
    ...mb.bestaetigt.map((c: any) => ({ domain: c.domain, validated: true })),
    ...mb.unbestaetigt.map((c: any) => ({ domain: c.domain, validated: false })),
  ].filter((c) => !schon.has(c.domain));
  if (neu.length)
    await SB.from("blog_competitors").insert(
      neu.map((c) => ({
        project_id: project.id,
        domain: c.domain,
        source: "ki",
        validated: c.validated,
      })),
    );
  const result = {
    name: profil.name,
    description: profil.description,
    audiences: profil.audiences,
    market: profil.market,
    language: profil.language,
    local_business: profil.local_business,
    tone: profil.tone,
    tone_reason: profil.tone_reason,
    rule_suggestions: profil.rules,
    clusters: profil.clusters,
    cta: profil.cta,
    cta_candidates: state.lese?.links ?? [],
    image_style: profil.image_style,
    competitors: mb,
    pages_read: (state.lese?.seiten ?? []).length,
  };
  return {
    next: null,
    patch: {
      result,
      percent: 100,
      events: [
        ...(run.events || []),
        ...ereignisse("abschluss", {
          tonalitaet: profil.tone,
          cluster: `${profil.clusters.length} Cluster`,
          fertig: "Felder vorbefüllt",
        }),
      ],
    },
  };
}

/** Offene Analysen abarbeiten (eine Phase pro Claim, solange Budget reicht). */
export async function tickeBlogAnalysen(budgetMs: number) {
  const start = Date.now();
  const out = { getickt: 0, fertig: 0, fehler: 0 };
  for (let i = 0; i < 8; i++) {
    if (budgetMs - (Date.now() - start) < 115_000) break;
    const nowIso = new Date().toISOString();
    const { data: rows } = await SB.from("blog_analysis_runs")
      .select("id")
      .in("status", ["queued", "running"])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("updated_at", { ascending: true })
      .limit(1);
    const next = rows?.[0];
    if (!next) break;
    const { data: run } = await SB.from("blog_analysis_runs")
      .update({
        status: "running",
        locked_until: new Date(Date.now() + 4 * 60_000).toISOString(),
        updated_at: nowIso,
      })
      .eq("id", next.id)
      .in("status", ["queued", "running"])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select("*")
      .maybeSingle();
    if (!run) continue;
    out.getickt++;
    if (!run.started_at)
      await SB.from("blog_analysis_runs").update({ started_at: nowIso }).eq("id", run.id);
    const { data: project } = await SB.from("blog_projects")
      .select("*")
      .eq("id", run.project_id)
      .maybeSingle();
    try {
      if (!project) throw new Error("Projekt fehlt");
      const { next: weiter, patch } = await fuehrePhaseAus(run, project);
      const fertig = weiter === null;
      await SB.from("blog_analysis_runs")
        .update({
          ...patch,
          stage: weiter ?? "abschluss",
          status: fertig ? "done" : "running",
          attempts: 0,
          error: null,
          locked_until: null,
          ...(fertig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      if (fertig) {
        out.fertig++;
        await blogEvent(
          run.project_id,
          "analysis.done",
          { run_id: run.id, dauer_ms: Date.now() - new Date(run.created_at).getTime() },
          run.created_by ?? null,
        );
      }
    } catch (e) {
      if (e instanceof KiLaeuftNoch) {
        // Runner-Job läuft noch: kein Fehlversuch, nächster Takt holt ab
        await SB.from("blog_analysis_runs")
          .update({ locked_until: null, updated_at: new Date().toISOString() })
          .eq("id", run.id);
        continue;
      }
      const attempts = (Number(run.attempts) || 0) + 1;
      const endgueltig = attempts >= MAX_VERSUCHE;
      const msg = String((e as Error)?.message || e).slice(0, 300);
      await SB.from("blog_analysis_runs")
        .update({
          attempts,
          status: endgueltig ? "failed" : "running",
          error: msg,
          locked_until: endgueltig ? null : new Date(Date.now() + 45_000).toISOString(),
          ...(endgueltig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      if (endgueltig) {
        out.fehler++;
        await blogEvent(
          run.project_id,
          "onboarding.analysis_failed",
          { run_id: run.id, stage: run.stage, error: msg },
          run.created_by ?? null,
        );
      }
    }
  }
  return out;
}

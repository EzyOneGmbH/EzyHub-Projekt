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
import {
  REC_FOCUS,
  REC_PLAYBOOK,
  REC_TEXTE,
  baueAktionen,
  ohneEszett,
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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type SeitenSnapshot =
  | { error: string }
  | {
      titleTag: string;
      metaDescription: string;
      modified: string;
      headings: string[];
      wordCount: number;
      excerpt: string;
    };

/**
 * Live-Snapshot eines Artikels: Title-Tag, Meta-Description, H2/H3, Wortzahl, Text.
 * Gemeinsam mit /api/content/refresh-brief («Mit KI erstellen»).
 */
export async function fetchPageSnapshot(
  url: string,
  opts: { timeoutMs?: number; maxHeadings?: number; excerptChars?: number } = {},
): Promise<SeitenSnapshot> {
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
    const html = (await res.text()).slice(0, 400_000);
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").replace(/\s+/g, " ").trim();
    const heads: string[] = [];
    for (const m of html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const t = strip(m[2]).slice(0, 140);
      if (t) heads.push(`H${m[1]}: ${t}`);
      if (heads.length >= (opts.maxHeadings ?? 25)) break;
    }
    const bodyText = strip(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
    );
    return {
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
    const html = await r.text().catch(() => "");
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
    let ungeloest = 0;
    const items = await Promise.all(
      roh.map(async (i) => {
        const istGoto = /\/goto\?/.test(String(i.url || ""));
        let echt = await gotoAufloesen(String(i.url || ""));
        if (!echt && istGoto) {
          // Google leitet Rechenzentrums-IPs nicht weiter → Adresse aus dem Breadcrumb
          echt = urlAusBreadcrumb(i.breadcrumb);
          ungeloest++;
          if (!echt) return i;
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
      .filter(
        (i) =>
          !dom ||
          !String(i.domain || "")
            .toLowerCase()
            .endsWith(dom),
      )
      .slice(0, 5);
    const snaps = await Promise.all(
      top.map((i) =>
        i.nurDomain
          ? Promise.resolve({ error: "nur Domain" } as SeitenSnapshot)
          : fetchPageSnapshot(String(i.url), {
              timeoutMs: 12_000,
              maxHeadings: 30,
              excerptChars: 0,
            }),
      ),
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
  });
}

/** Fehlende Pflichtteile; leer = vollständig. */
export function luecken(e: Empfehlung): string[] {
  const f: string[] = [];
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
  keyword: string;
  deadline: number; // Date.now()-Zeitpunkt, bis zu dem fertig sein muss
};

export async function erstelleEmpfehlung(a: EmpfehlungsAnfrage): Promise<{
  recommendation: Empfehlung;
  cost: { dataforseo: number };
  hinweise: string[];
}> {
  const { kunde, url, rec, keyword } = a;
  const hinweise: string[] = [];
  const { data: zeile } = await sb
    .from("content_decision")
    .select("*")
    .eq("client_id", kunde.id)
    .eq("url", url)
    .maybeSingle();
  const sprache =
    SPRACHEN[
      String(zeile?.language || "de")
        .slice(0, 2)
        .toLowerCase()
    ] ?? "de";
  const { period } = await ladeAktionen(kunde.id);

  const [snap, gsc, serp] = await Promise.all([
    fetchPageSnapshot(url, { timeoutMs: 15_000, maxHeadings: 40, excerptChars: 4000 }),
    gscKontext(kunde, url, period).catch(
      () => ({ queries: [], starkeSeiten: [], hinweis: "GSC-Fehler" }) as GscKontext,
    ),
    serpTop5(keyword, sprache, kunde.domain),
  ]);
  if ("error" in snap) hinweise.push(`Live-Artikel nicht abrufbar (${snap.error})`);
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
    "Sprache: Deutsch (Schweiz), ss statt ß, ausser der Artikel ist in einer anderen Sprache — dann Title, Meta, Abschnitte und FAQ in der Artikelsprache, summary/change/eeat auf Deutsch. " +
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
Sprache: ${sprache}

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
  const teil = async (system: string, label: string): Promise<any | null> => {
    const viaSub = await generateViaSubscription({
      system,
      prompt: kurzPrompt,
      model: MODELL,
      clientId: kunde.id,
      clientName: kunde.name,
      label,
      maxTurns: 3,
      timeoutMs: Math.max(20_000, rest() - 30_000),
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
  const [ja, jb, jc] = await Promise.all([
    teil(systemA, "Content-Massnahme A"),
    teil(systemB, "Content-Massnahme B"),
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
    recommendation: normalisiereEmpfehlung(j, erlaubt, serp.treffer),
    cost: { dataforseo: serp.cost },
    hinweise,
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
  payload: Empfehlung,
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

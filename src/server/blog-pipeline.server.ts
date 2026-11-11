// Blog-Autopilot Phase 3: Schreib-Pipeline (Bauanleitung Kap. 6.3/6.4). Läuft
// als Stufen-Job im minütlichen Worker, eine Stufe pro Claim, jede einzeln
// wiederholbar (gleiches Muster wie Analyse und KI-Audit):
//   brief      Projekt, Regeln, Fakten, Website-Auszüge, interne Links,
//              Kategorien, Bild-Kandidaten, bei Refresh der Originaltext
//   recherche  Claude mit Websuche: Quellen mit URL (ohne Mitbewerber)
//   entwurf    Claude: Artikel als JSON, Behauptungen mit <span data-claim>
//   pruefen    Faktencheck, Links (nofollow, erreichbar, keine Mitbewerber),
//              CTA-Block fest einsetzen, Version speichern
//   wordpress  Entwurf über den Connector (Kommentare/Pings zu erzwingt das
//              Plugin ab 2.0.1), Status entwurf_wp
// Modi: «neu» (neuer Artikel), «refresh» (bestehender Blogartikel → neue
// Fassung als separater Entwurf «[Überarbeitung] …», das Original bleibt
// unberührt), «vorschlag» (Projekt-/Landingpage → nur Ergänzungsvorschläge
// im Hub, nichts nach WordPress).
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, normalisiereDomain } from "@/server/blog-autopilot.server";
import { claudeText, htmlZuText, jsonAusText } from "@/server/blog-analysis.server";
import { KiLaeuftNoch } from "@/server/ki-runner.server";
import { decryptSecret } from "@/server/secretbox.server";
import { ezrRequest } from "@/server/ezyrank-wp.server";

const SB = supabaseAdmin as any;
const UA = "Mozilla/5.0 (compatible; EzyHubBot/1.0; +https://ezyhub.ch)";
export const STUFEN = ["brief", "recherche", "entwurf", "pruefen", "wordpress"] as const;
export type Stufe = (typeof STUFEN)[number];
export type Modus = "neu" | "refresh" | "vorschlag";
const MAX_VERSUCHE = 3;
/** Gleichzeitig laufende Artikel je Projekt (Schutz vor Doppelklick/Kosten). */
export const MAX_PARALLEL = 2;
/** Plugin-Version, ab der Bilder der eigenen Mediathek angenommen werden. */
const PLUGIN_EIGENE_BILDER = "2.0.1";

// ── Reine Helfer (vitest) ───────────────────────────────────────────────────

/** Datum JJJJ-MM-TT in Zürich, optional plus Tage. */
export function datumZuerich(d: Date = new Date(), plusTage = 0): string {
  const t = new Date(d.getTime() + plusTage * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

/** URL vergleichbar machen: ohne Schema, www, Query, Anker, Schluss-Slash. */
export function normUrl(u: string): string {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export function hostVonUrl(u: string): string {
  try {
    return normalisiereDomain(new URL(u).hostname);
  } catch {
    return "";
  }
}

/** Gleiche Domain oder Subdomain davon? */
export function gehoertZu(host: string, domain: string): boolean {
  const h = normalisiereDomain(host);
  const d = normalisiereDomain(domain);
  return !!h && !!d && (h === d || h.endsWith(`.${d}`));
}

/** Neu, Refresh eines Blogartikels oder nur Vorschläge (Projekt-/Landingpage). */
export function modusFuer(
  kind: string | null | undefined,
  coveredUrl: string | null | undefined,
  blogUrls: Iterable<string>,
): Modus {
  if (kind !== "refresh" || !coveredUrl) return "neu";
  const set = new Set([...blogUrls].map(normUrl));
  return set.has(normUrl(coveredUrl)) ? "refresh" : "vorschlag";
}

export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type Cta = { label?: string; text?: string; url?: string; position?: string };

export function ctaHtml(cta: Cta): string {
  const text = cta.text ? `<p>${esc(cta.text)}</p>` : "";
  const knopf = cta.url
    ? `<p><a class="ezyrank-cta-button" href="${esc(cta.url)}"><strong>${esc(cta.label || "Mehr erfahren")}</strong></a></p>`
    : "";
  return `<div class="ezyrank-cta">${text}${knopf}</div>`;
}

const CTA_RE = /<div class="ezyrank-cta">[\s\S]*?<\/div>/gi;

/** CTA-Block genau einmal: alte Blöcke und Platzhalter entfernen, dann einsetzen
 *  (Platzhalter {{cta}} bei position «mitte», sonst am Ende). */
export function setzeCta(html: string, cta: Cta | null | undefined): string {
  let h = String(html || "").replace(CTA_RE, "");
  const hatPlatzhalter = /\{\{cta\}\}/i.test(h);
  if (!cta?.url && !cta?.text) return h.replace(/(<p>\s*)?\{\{cta\}\}(\s*<\/p>)?/gi, "");
  const block = ctaHtml(cta);
  if (cta.position === "mitte" && hatPlatzhalter) {
    let erst = true;
    return h.replace(/(<p>\s*)?\{\{cta\}\}(\s*<\/p>)?/gi, () => {
      if (!erst) return "";
      erst = false;
      return block;
    });
  }
  h = h.replace(/(<p>\s*)?\{\{cta\}\}(\s*<\/p>)?/gi, "");
  return `${h.trim()}\n${block}`;
}

export function zaehleCta(html: string): number {
  return (String(html || "").match(/<div class="ezyrank-cta">/gi) || []).length;
}

/** Modell-HTML aufräumen: kein h1, kein script/style, keine Inline-Handler. */
export function bereinigeHtml(html: string): string {
  return String(html || "")
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "<h2>$1</h2>")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/```(html)?/gi, "")
    .trim();
}

export function hrefsVon(html: string): string[] {
  const out: string[] = [];
  for (const m of String(html || "").matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) out.push(m[1]);
  return out;
}

/**
 * Links prüfen: eigene Domain bleibt (ohne nofollow); extern nur, wenn nicht
 * gesperrt (Mitbewerber/Ausschlussliste) und erreichbar, dann mit
 * rel="nofollow noopener". Sonst wird der Link entfernt, der Text bleibt.
 */
export function bereinigeLinks(
  html: string,
  opts: { eigen: string; gesperrt: string[]; erreichbar: (url: string) => boolean },
): { html: string; entfernt: string[] } {
  const entfernt: string[] = [];
  const out = String(html || "").replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (ganz, attrs: string, inner: string) => {
      if (/class="ezyrank-cta-button"/.test(attrs)) return ganz;
      const href = (attrs.match(/\bhref="([^"]*)"/i) || [])[1] || "";
      if (!href || href.startsWith("#") || /^(mailto|tel):/i.test(href)) return ganz;
      if (!/^https?:\/\//i.test(href)) {
        entfernt.push(href);
        return inner;
      }
      const host = hostVonUrl(href);
      if (gehoertZu(host, opts.eigen)) return `<a href="${href}">${inner}</a>`;
      if (opts.gesperrt.some((d) => gehoertZu(host, d)) || !opts.erreichbar(href)) {
        entfernt.push(href);
        return inner;
      }
      return `<a href="${href}" rel="nofollow noopener">${inner}</a>`;
    },
  );
  return { html: out, entfernt };
}

export type Claim = {
  n: number;
  text: string;
  typ: "zahl" | "statistik" | "zitat" | "rechtlich" | "preis" | "sonstiges";
  source_url: string | null;
  status: "belegt" | "offen" | "entfernt";
};

const CLAIM_SPAN = /<span data-claim="(\d+)">([\s\S]*?)<\/span>/gi;
const ZAHL_RE =
  /(\d[\d'’.,]*\s*(%|prozent|chf|fr\.|franken|mio\.?|millionen|milliarden|liter))|(\b\d{3,}\b)|(\b\d+[.,]\d+\b)/i;

function satzListe(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ«"„0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Faktencheck (Kap. 6.3 Punkt 4): Jede markierte Behauptung braucht eine
 * Quelle aus der Recherche, aus client_facts oder von der eigenen Website.
 * Unmarkierte Sätze mit Zahlen, Prozenten oder Beträgen werden zusätzlich
 * als offene Behauptung erfasst.
 */
export function pruefeBehauptungen(opts: {
  html: string;
  claims: Array<{ n: number; typ?: string; quelle_url?: string | null }>;
  quellen: Iterable<string>;
  eigen: string;
}): Claim[] {
  const erlaubt = new Set([...opts.quellen].map(normUrl));
  const meta = new Map(opts.claims.map((c) => [Number(c.n), c]));
  const out: Claim[] = [];
  const typen = new Set(["zahl", "statistik", "zitat", "rechtlich", "preis", "sonstiges"]);
  for (const m of String(opts.html || "").matchAll(CLAIM_SPAN)) {
    const n = Number(m[1]);
    const c = meta.get(n);
    const url = c?.quelle_url ? String(c.quelle_url) : null;
    const belegt = !!url && (erlaubt.has(normUrl(url)) || gehoertZu(hostVonUrl(url), opts.eigen));
    out.push({
      n,
      text: htmlZuText(m[2]).slice(0, 600),
      typ: (typen.has(String(c?.typ)) ? c!.typ : "sonstiges") as Claim["typ"],
      source_url: url,
      status: belegt ? "belegt" : "offen",
    });
  }
  // unmarkierte Zahlen
  const ohneSpans = String(opts.html || "")
    .replace(CLAIM_SPAN, " ")
    .replace(CTA_RE, " ")
    // Links nur als Text; Überschriften enthalten keine Belege
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, " ");
  let n = 1000;
  for (const satz of satzListe(htmlZuText(ohneSpans))) {
    if (ZAHL_RE.test(satz))
      out.push({
        n: n++,
        text: satz.slice(0, 600),
        typ: "zahl",
        source_url: null,
        status: "offen",
      });
  }
  return out;
}

/** Markierungen auflösen (für WordPress); Behauptungen in «entfernen» fallen samt Text weg. */
export function loeseClaims(html: string, entfernen: Set<number> = new Set()): string {
  return String(html || "")
    .replace(CLAIM_SPAN, (_g, n: string, inner: string) => (entfernen.has(Number(n)) ? "" : inner))
    .replace(/<p>\s*<\/p>/g, "");
}

/** Einzelne Behauptungen entfernen, die übrigen Markierungen bleiben (Hub-Ansicht). */
export function entferneClaims(html: string, entfernen: Set<number>): string {
  return String(html || "")
    .replace(CLAIM_SPAN, (g, n: string) => (entfernen.has(Number(n)) ? "" : g))
    .replace(/<p>\s*<\/p>/g, "");
}

/** Unmarkierten Satz (Text) aus dem HTML entfernen, wenn er wörtlich in einem Absatz steht. */
export function entferneSatz(html: string, satz: string): { html: string; ok: boolean } {
  const ziel = satz.trim();
  let ok = false;
  const out = String(html || "").replace(
    /<(p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (g, tag, attrs, inner) => {
      if (ok || !htmlZuText(inner).includes(ziel)) return g;
      const text = htmlZuText(inner);
      if (/<[a-z]/i.test(inner) && text.trim() !== ziel) return g; // Absatz mit Markup: nur ganz
      ok = true;
      const rest = text.replace(ziel, "").trim();
      return rest ? `<${tag}${attrs}>${esc(rest)}</${tag}>` : "";
    },
  );
  return { html: out.replace(/<p>\s*<\/p>/g, ""), ok };
}

export function woerter(html: string): number {
  return htmlZuText(html).split(/\s+/).filter(Boolean).length;
}

export type Kategorie = { id: number; name: string; slug: string; count?: number };

const UNKATEGORISIERT = /^(uncategorized|allgemein|unkategorisiert|non-classe|senza-categoria)$/i;

/** Gewählte Kategorie prüfen; nie «Uncategorized», wenn andere passen. */
export function waehleKategorie(
  gewaehlt: unknown,
  kategorien: Kategorie[],
  vorgabe?: number[],
): number[] {
  const brauchbar = kategorien.filter((k) => !UNKATEGORISIERT.test(k.slug));
  const ids = (Array.isArray(gewaehlt) ? gewaehlt : [gewaehlt]).map(Number).filter(Boolean);
  const ok = ids.filter((id) => brauchbar.some((k) => k.id === id));
  if (ok.length) return ok.slice(0, 2);
  const v = (vorgabe ?? []).filter((id) => brauchbar.some((k) => k.id === id));
  if (v.length) return v.slice(0, 2);
  if (!brauchbar.length) return [];
  return [[...brauchbar].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0].id];
}

/** Semver-Vergleich a >= b (nur Zahlen). */
export function versionAb(a: string | null | undefined, b: string): boolean {
  const pa = String(a || "0")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return true;
}

export function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Schweizer Rechtschreibung: ß → ss (de-CH). */
export function schweiz(s: string, sprache: string): string {
  return /^de-CH/i.test(sprache) ? String(s ?? "").replace(/ß/g, "ss") : String(s ?? "");
}

const tok = (s: string) =>
  String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9äöüéèàç]+/)
    .filter((w) => w.length >= 4);

/** Relevanz grob über gemeinsame Wörter (für interne Links und Seiten-Auszüge). */
export function relevanz(a: string, b: string): number {
  const x = new Set(tok(a));
  return tok(b).filter((w) => x.has(w) || [...x].some((y) => y.startsWith(w.slice(0, 6)))).length;
}

// ── KI-Ausgaben (tolerant) ──────────────────────────────────────────────────

const t = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .catch("");

export const RechercheSchema = z.object({
  quellen: z
    .array(
      z.object({
        url: t(500),
        titel: t(200),
        fakten: z.array(t(400)).catch([]),
      }),
    )
    .catch([]),
});

export const EntwurfSchema = z.object({
  title: t(120),
  slug: t(90),
  seo_title: t(70),
  meta_description: t(170),
  excerpt: t(400),
  focus_keyword: t(100),
  content_html: z.string().catch(""),
  claims: z
    .array(
      z.object({
        n: z.coerce.number().catch(0),
        typ: t(20),
        quelle_url: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
  category_ids: z.array(z.coerce.number()).catch([]),
  tags: z.array(t(60)).catch([]),
  featured_image_url: z.string().nullable().catch(null),
  featured_image_alt: t(200),
});

// ── Netz ────────────────────────────────────────────────────────────────────

async function holeJson(url: string, timeoutMs = 10_000): Promise<any> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function holeHtml(url: string, timeoutMs = 10_000): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  }
}

async function erreichbar(url: string): Promise<boolean> {
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetch(url, {
        method,
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (r.status < 400) return true;
      if (method === "GET") return false;
    } catch {
      if (method === "GET") return false;
    }
  }
  return false;
}

/** Original über die öffentliche WP-REST-API (Beitrag per Slug), sonst HTML-Text. */
async function ladeOriginal(url: string) {
  const u = new URL(url);
  const slug = u.pathname.split("/").filter(Boolean).pop() || "";
  const basis = `${u.protocol}//${u.host}/wp-json/wp/v2`;
  const posts = slug
    ? await holeJson(
        `${basis}/posts?slug=${encodeURIComponent(slug)}&_fields=id,title,content,categories,featured_media,link`,
      )
    : null;
  const p = Array.isArray(posts) ? posts[0] : null;
  if (p) {
    let bild: { url: string; alt: string } | null = null;
    if (p.featured_media) {
      const m = await holeJson(`${basis}/media/${p.featured_media}?_fields=source_url,alt_text`);
      if (m?.source_url) bild = { url: m.source_url, alt: String(m.alt_text || "") };
    }
    return {
      wp_id: Number(p.id),
      titel: htmlZuText(String(p.title?.rendered || "")),
      text: htmlZuText(String(p.content?.rendered || "")).slice(0, 12_000),
      kategorien: (p.categories ?? []).map(Number),
      bild,
    };
  }
  const html = await holeHtml(url);
  const titel = htmlZuText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  return {
    wp_id: null,
    titel,
    text: htmlZuText(html).slice(0, 12_000),
    kategorien: [],
    bild: null,
  };
}

/** Bild-Kandidaten aus der öffentlichen Mediathek (Suche nach Keyword-Wörtern). */
async function bildKandidaten(domain: string, keyword: string) {
  const basis = `https://${domain}/wp-json/wp/v2/media`;
  const woerter = [...new Set(tok(keyword))].slice(0, 3);
  const out = new Map<string, { url: string; alt: string; titel: string }>();
  for (const w of [...woerter, ""]) {
    const j = await holeJson(
      `${basis}?media_type=image&per_page=20${w ? `&search=${encodeURIComponent(w)}` : ""}&_fields=source_url,alt_text,title,media_details`,
    );
    for (const m of Array.isArray(j) ? j : []) {
      const url = m?.media_details?.sizes?.large?.source_url || m?.source_url;
      if (!url || out.has(url)) continue;
      const breite = Number(m?.media_details?.width || 0);
      if (breite && breite < 600) continue;
      out.set(url, {
        url,
        alt: String(m.alt_text || ""),
        titel: htmlZuText(String(m.title?.rendered || "")),
      });
    }
    if (out.size >= 20) break;
  }
  return [...out.values()].slice(0, 20);
}

async function wpVerbindung(projectId: string) {
  const { data: wp } = await SB.from("wp_connections")
    .select("site_url, key_enc, status, plugin_version, scopes")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!wp?.key_enc) return null;
  return {
    conn: { siteUrl: wp.site_url as string, key: decryptSecret(wp.key_enc) },
    status: wp.status as string,
    plugin_version: (wp.plugin_version as string) || null,
  };
}

// ── Stufen ──────────────────────────────────────────────────────────────────

type StufeErgebnis = {
  job: any;
  patch?: Record<string, unknown>;
  /** Artikel endet hier (fertig oder wartet auf Faktencheck). */
  ende?: boolean;
};

async function brief(article: any, project: any): Promise<StufeErgebnis> {
  const { data: topic } = article.topic_id
    ? await SB.from("blog_topics").select("*").eq("id", article.topic_id).maybeSingle()
    : { data: null };
  if (!topic?.approved_at) throw new Error("Thema ist nicht freigegeben");
  const { data: opp } = topic.opportunity_id
    ? await SB.from("keyword_opportunities")
        .select("reason, covered_by_url, category, avg_position, impressions")
        .eq("id", topic.opportunity_id)
        .maybeSingle()
    : { data: null };
  const { data: items } = await SB.from("content_items")
    .select("target_url, title")
    .eq("client_id", project.client_id)
    .eq("content_type", "blog")
    .eq("status", "published");
  const blog = (items ?? []).filter((i: any) => i.target_url);
  const modus = modusFuer(
    topic.kind,
    opp?.covered_by_url,
    blog.map((i: any) => i.target_url),
  );

  const [{ data: regeln }, { data: fakten }, { data: mitbewerber }, { data: ana }] =
    await Promise.all([
      SB.from("writing_rules").select("rule").eq("project_id", project.id).eq("active", true),
      SB.from("client_facts").select("label, value, source_url").eq("project_id", project.id),
      SB.from("blog_competitors").select("domain").eq("project_id", project.id),
      SB.from("blog_analysis_runs")
        .select("state")
        .eq("project_id", project.id)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const original =
    opp?.covered_by_url && modus !== "neu" ? await ladeOriginal(opp.covered_by_url) : null;

  // Website-Auszüge: Startseite + relevanteste Seiten (Fakten über den Kunden)
  const seiten: Array<{ url: string; title: string; text: string }> =
    ana?.state?.lese?.seiten ?? [];
  const sortiert = [...seiten].sort(
    (a, b) =>
      relevanz(topic.keyword, `${b.title} ${b.text.slice(0, 1500)}`) -
      relevanz(topic.keyword, `${a.title} ${a.text.slice(0, 1500)}`),
  );
  const auszuege = [
    ...seiten.slice(0, 1),
    ...sortiert.filter((s) => s.url !== seiten[0]?.url).slice(0, 4),
  ].map((s) => ({ url: s.url, titel: s.title, text: String(s.text || "").slice(0, 1800) }));

  // interne Links: thematisch passende eigene Artikel (nicht das Original)
  const links = blog
    .filter(
      (i: any) => !opp?.covered_by_url || normUrl(i.target_url) !== normUrl(opp.covered_by_url),
    )
    .map((i: any) => ({
      url: i.target_url as string,
      titel: String(i.title || ""),
      r: relevanz(topic.keyword, i.title || ""),
    }))
    .sort((a: any, b: any) => b.r - a.r)
    .slice(0, 12)
    .map(({ url, titel }: any) => ({ url, titel }));

  let kategorien: Kategorie[] = [];
  let plugin_version: string | null = null;
  if (project.publish_mode !== "hub_only" && modus !== "vorschlag") {
    const wp = await wpVerbindung(project.id);
    if (wp) {
      plugin_version = wp.plugin_version;
      const tx = await ezrRequest(wp.conn, "GET", "/taxonomies");
      if (tx.ok)
        kategorien = (tx.data?.categories ?? []).map((k: any) => ({
          id: Number(k.id),
          name: String(k.name),
          slug: String(k.slug),
          count: Number(k.count || 0),
        }));
    }
  }
  const bilder = modus === "vorschlag" ? [] : await bildKandidaten(project.domain, topic.keyword);
  if (original?.bild && !bilder.some((b) => b.url === original.bild!.url))
    bilder.unshift({
      url: original.bild.url,
      alt: original.bild.alt,
      titel: "Bild des Originalartikels",
    });

  const gesperrt = [
    ...new Set([
      ...(mitbewerber ?? []).map((m: any) => normalisiereDomain(m.domain)),
      ...(project.excluded_domains ?? []).map((d: string) => normalisiereDomain(d)),
    ]),
  ].filter(Boolean);

  const b = {
    modus,
    keyword: topic.keyword,
    cluster: topic.cluster ?? null,
    article_type: topic.article_type ?? null,
    grund: opp?.reason ?? null,
    position: opp?.avg_position ?? null,
    original_url: opp?.covered_by_url ?? null,
    original,
    regeln: (regeln ?? []).map((r: any) => r.rule),
    fakten: fakten ?? [],
    auszuege,
    links,
    kategorien,
    bilder,
    gesperrt,
    plugin_version,
  };
  return {
    job: { ...article.job, modus, brief: b },
    patch: { focus_keyword: topic.keyword },
  };
}

const SYSTEM_RECHERCHE =
  "Du recherchierst Fakten für einen Blogartikel einer Schweizer SEO-Agentur. " +
  "Nutze die Websuche. Antworte ausschliesslich mit einem JSON-Objekt, ohne Text davor oder danach. " +
  "Nimm nur Quellen auf, die du tatsächlich gefunden hast, mit exakter URL. Erfinde keine URLs, Zahlen oder Zitate.";

export function recherchePrompt(project: any, b: any): string {
  return [
    `Thema/Keyword: «${b.keyword}»`,
    `Markt: ${project.market || "CH"}, Sprache: ${project.language || "de-CH"}`,
    `Zielgruppen: ${(project.audiences ?? []).join(" | ")}`,
    `Auftraggeber: ${project.name || project.domain} (${project.domain}). ${String(project.description || "").slice(0, 600)}`,
    b.original ? `Bestehender Artikel (wird überarbeitet): «${b.original.titel}»` : "",
    "",
    "Finde 4 bis 8 seriöse, aktuelle Quellen (Behörden, UN/WHO/UNICEF, Statistikämter, Fachstellen, Studien, Qualitätsmedien) mit belastbaren Fakten und Zahlen zum Thema.",
    `Keine Quellen von diesen Domains (Mitbewerber): ${b.gesperrt.join(", ") || "–"}.`,
    "Pro Quelle 1 bis 4 Fakten als kurze, wörtlich belegbare Aussagen (mit Jahr, wenn vorhanden).",
    "",
    'Format: {"quellen":[{"url":"https://…","titel":"…","fakten":["…"]}]}',
  ]
    .filter((z) => z !== "")
    .join("\n");
}

async function recherche(article: any, project: any, restMs: number): Promise<StufeErgebnis> {
  const b = article.job?.brief;
  if (b?.modus === "vorschlag") return { job: { ...article.job, recherche: { quellen: [] } } };
  const text = await claudeText({
    system: SYSTEM_RECHERCHE,
    prompt: recherchePrompt(project, b),
    maxTokens: 3000,
    websuche: 6,
    timeoutMs: Math.max(20_000, Math.min(restMs - 15_000, 100_000)),
  });
  const roh = RechercheSchema.parse(jsonAusText(text));
  const quellen = roh.quellen.filter(
    (q) =>
      /^https:\/\//i.test(q.url) &&
      !b.gesperrt.some((d: string) => gehoertZu(hostVonUrl(q.url), d)) &&
      q.fakten.length > 0,
  );
  return { job: { ...article.job, recherche: { quellen: quellen.slice(0, 10) } } };
}

const SYSTEM_ENTWURF =
  "Du bist Senior-Redaktor:in einer Schweizer SEO-Agentur und schreibst Blogartikel für Kundenwebsites. " +
  "Antworte ausschliesslich mit einem JSON-Objekt, ohne Text davor oder danach und ohne Markdown-Codeblock. " +
  "Schreibe hilfreich, konkret und menschlich, ohne Floskeln und ohne KI-typische Wendungen. " +
  "Erfinde nichts: Fakten nur aus den gelieferten Quellen, Kundenfakten und Website-Auszügen.";

export function entwurfPrompt(project: any, b: any, quellen: any[]): string {
  const cta = (project.cta_blocks ?? [])[0];
  const deCH = /^de-CH/i.test(project.language || "de-CH");
  const gemeinsam = [
    `Auftraggeber: ${project.name || project.domain} (https://${project.domain})`,
    `Beschreibung: ${String(project.description || "").slice(0, 1500)}`,
    `Zielgruppen: ${(project.audiences ?? []).join(" | ")}`,
    `Sprache: ${project.language || "de-CH"}${deCH ? " – Schweizer Rechtschreibung: immer «ss», nie «ß»; Anführungszeichen «…»" : ""}`,
    `Ton: ${project.tone || "informativ"}. Anrede (du/Sie) wie auf der Website (siehe Auszüge).`,
    `Bildstil: ${project.image_style || "–"}`,
    "",
    "Schreibregeln (verbindlich):",
    ...b.regeln.map((r: string) => `- ${r}`),
    "- Keine anderen Hilfswerke, Mitbewerber oder Vergleichslisten mit Mitbewerbern.",
    `- Niemals auf diese Domains verlinken oder sie nennen: ${b.gesperrt.join(", ") || "–"}`,
    "",
    "Kundenfakten:",
    ...(b.fakten.length
      ? b.fakten.map(
          (f: any) => `- ${f.label}: ${f.value}${f.source_url ? ` (${f.source_url})` : ""}`,
        )
      : ["- keine"]),
    "",
    "Website-Auszüge (Fakten über den Auftraggeber; als Quelle die jeweilige URL angeben):",
    ...b.auszuege.map((a: any) => `### ${a.url}\n${a.titel}\n${a.text}`),
  ];
  if (b.modus === "vorschlag") {
    return [
      ...gemeinsam,
      "",
      `AUFGABE: Die Seite ${b.original_url} rankt für «${b.keyword}» auf Position ${b.position ?? "?"}. ${b.grund ?? ""}`,
      "Es ist eine Projekt-/Landingpage (Page-Builder). Schreibe KEINEN neuen Artikel, sondern konkrete Ergänzungsvorschläge, damit die Seite für das Keyword besser rankt:",
      "neuer Title und Meta-Description, 2–4 fehlende Abschnitte (Überschrift + 2–4 Sätze Textvorschlag), 3–5 FAQ mit kurzen Antworten, interne Links, die auf die Seite zeigen sollten.",
      "",
      `Aktueller Inhalt der Seite «${b.original?.titel ?? ""}»:`,
      String(b.original?.text ?? "").slice(0, 8000),
      "",
      "Interne Artikel, die auf die Seite verlinken könnten:",
      ...b.links.map((l: any) => `- ${l.titel}: ${l.url}`),
      "",
      'Format: {"title":"Vorschläge: …","seo_title":"… (max. 60 Zeichen)","meta_description":"… (max. 155 Zeichen)","excerpt":"Zusammenfassung in 2 Sätzen","content_html":"<h2>…</h2><p>…</p><ul><li>…</li></ul>"}',
    ].join("\n");
  }
  return [
    ...gemeinsam,
    "",
    b.modus === "refresh"
      ? `AUFGABE: Überarbeite den bestehenden Artikel ${b.original_url} («${b.original?.titel ?? ""}»). Er rankt für «${b.keyword}» auf Position ${b.position ?? "?"}. ${b.grund ?? ""} Behalte die guten Teile und den Kern, schliesse Lücken zur Suchintention, aktualisiere Fakten, verbessere Struktur, Einstieg und Überschriften. Ergebnis ist der vollständige neue Text.`
      : `AUFGABE: Schreibe einen neuen Blogartikel zum Keyword «${b.keyword}»${b.article_type ? ` (Typ: ${b.article_type})` : ""}.${b.grund ? ` Hintergrund: ${b.grund}` : ""}`,
    b.original ? `\nBestehender Text:\n${String(b.original.text).slice(0, 10_000)}` : "",
    "",
    "Recherchierte Quellen (nur diese URLs als externe Links/Belege verwenden):",
    ...(quellen.length
      ? quellen.map(
          (q: any) =>
            `- ${q.titel} – ${q.url}\n${q.fakten.map((f: string) => `  · ${f}`).join("\n")}`,
        )
      : ["- keine"]),
    "",
    `Interne Links: Baue ${project.internal_links ?? 3} passende interne Links natürlich in den Text ein, nur aus dieser Liste (exakte URL):`,
    ...b.links.map((l: any) => `- ${l.titel}: ${l.url}`),
    "",
    "Aufbau und Form:",
    "- 1200 bis 1800 Wörter. Einstieg beantwortet die Suchfrage in den ersten 2–3 Sätzen.",
    "- Gliederung mit <h2>/<h3> (kein <h1>), kurze Absätze <p>, Listen <ul>/<ol> wo sinnvoll, am Schluss ein kurzes Fazit.",
    "- Fokus-Keyword im ersten Absatz, in mindestens einer <h2> und natürlich im Text (kein Keyword-Stuffing).",
    '- Externe Quellen als <a href="…">sprechender Ankertext</a> direkt bei der Aussage.',
    '- Jede Behauptung mit Zahl, Statistik, Preis, Zitat oder rechtlicher Aussage MUSS so markiert sein: <span data-claim="1">…Aussage…</span> (fortlaufend nummeriert) und in «claims» mit ihrer Quelle stehen (URL aus den Quellen oder aus den Website-Auszügen). Ohne Quelle: Aussage weglassen.',
    cta
      ? `- Schreibe KEINEN eigenen Spendenaufruf/Call-to-Action-Block: der feste Block «${cta.label}» wird automatisch ${cta.position === "mitte" ? "an der Stelle {{cta}} (setze {{cta}} einmal als eigenen Absatz an eine passende Stelle)" : "am Ende"} eingefügt.`
      : "",
    "",
    "Kategorien (wähle 1, höchstens 2 passende IDs; nie «Uncategorized»/«Allgemein»):",
    ...(b.kategorien.length ? b.kategorien.map((k: any) => `- ${k.id}: ${k.name}`) : ["- keine"]),
    "",
    "Beitragsbild: wähle das passendste aus dieser Liste (exakte URL) und schreibe einen beschreibenden Alt-Text; passt keines, null:",
    ...(b.bilder.length
      ? b.bilder.map((i: any) => `- ${i.url} | ${i.titel} | ${i.alt}`)
      : ["- keine"]),
    "",
    'Format: {"title":"H1/Beitragstitel","slug":"kurzer-slug-mit-keyword","seo_title":"max. 60 Zeichen","meta_description":"max. 155 Zeichen, mit Keyword und Nutzen","excerpt":"2 Sätze","focus_keyword":"…","content_html":"<p>…</p>","claims":[{"n":1,"typ":"zahl|statistik|zitat|rechtlich|preis|sonstiges","quelle_url":"https://…"}],"category_ids":[12],"tags":["…"],"featured_image_url":"https://…|null","featured_image_alt":"…"}',
  ]
    .filter((z) => z !== "")
    .join("\n");
}

async function entwurf(article: any, project: any, restMs: number): Promise<StufeErgebnis> {
  const b = article.job?.brief;
  const quellen = article.job?.recherche?.quellen ?? [];
  const text = await claudeText({
    system: SYSTEM_ENTWURF,
    prompt: entwurfPrompt(project, b, quellen),
    maxTokens: 12_000,
    timeoutMs: Math.max(20_000, Math.min(restMs - 15_000, 100_000)),
    modell: process.env.BLOG_SCHREIB_MODELL || "opus",
  });
  const e = EntwurfSchema.parse(jsonAusText(text));
  if (woerter(e.content_html) < (b.modus === "vorschlag" ? 80 : 400))
    throw new Error("KI-Entwurf zu kurz oder leer");
  return { job: { ...article.job, entwurf: e } };
}

async function pruefen(article: any, project: any): Promise<StufeErgebnis> {
  const b = article.job?.brief;
  const e = article.job?.entwurf;
  const quellen: any[] = article.job?.recherche?.quellen ?? [];
  const sprache = project.language || "de-CH";
  let html = schweiz(bereinigeHtml(e.content_html), sprache);

  // Links: Erreichbarkeit extern prüfen (parallel, einmal je URL)
  const extern = [
    ...new Set(
      hrefsVon(html).filter(
        (h) => /^https?:\/\//i.test(h) && !gehoertZu(hostVonUrl(h), project.domain),
      ),
    ),
  ];
  const ok = new Map<string, boolean>();
  await Promise.all(extern.slice(0, 25).map(async (u) => ok.set(u, await erreichbar(u))));
  const links = bereinigeLinks(html, {
    eigen: project.domain,
    gesperrt: b.gesperrt,
    erreichbar: (u) => ok.get(u) === true,
  });
  html = links.html;

  const istVorschlag = b.modus === "vorschlag";
  const claims = istVorschlag
    ? []
    : pruefeBehauptungen({
        html,
        claims: e.claims,
        quellen: [
          ...quellen.map((q) => q.url),
          ...b.fakten.map((f: any) => f.source_url).filter(Boolean),
          ...b.auszuege.map((a: any) => a.url),
        ],
        eigen: project.domain,
      });
  const entfernen = new Set<number>(
    project.auto_remove_unsourced
      ? claims.filter((c) => c.status === "offen" && c.n < 1000).map((c) => c.n)
      : [],
  );
  const endClaims = claims.map((c) =>
    entfernen.has(c.n) ? { ...c, status: "entfernt" as const } : c,
  );
  html = entferneClaims(html, entfernen);
  if (!istVorschlag) html = setzeCta(html, (project.cta_blocks ?? [])[0]);

  const offen = endClaims.filter((c) => c.status === "offen");
  await SB.from("article_claims").delete().eq("article_id", article.id);
  if (endClaims.length)
    await SB.from("article_claims").insert(
      endClaims.map((c) => ({
        article_id: article.id,
        project_id: article.project_id,
        client_id: article.client_id,
        claim_text: c.text,
        claim_type: c.typ,
        source_url: c.source_url,
        status: c.status,
        note: c.n >= 1000 ? "ohne Markierung" : `span:${c.n}`,
      })),
    );
  await SB.from("article_versions").upsert(
    {
      article_id: article.id,
      project_id: article.project_id,
      client_id: article.client_id,
      version: 1,
      content_html: loeseClaims(html),
      reason: "erstellt",
    },
    { onConflict: "article_id,version" },
  );

  const kategorie = waehleKategorie(e.category_ids, b.kategorien, b.original?.kategorien);
  const bild =
    e.featured_image_url && b.bilder.some((i: any) => i.url === e.featured_image_url)
      ? { url: e.featured_image_url, alt: schweiz(e.featured_image_alt || "", sprache) }
      : null;
  const patch = {
    title: schweiz(e.title, sprache),
    slug: slugify(e.slug || e.title),
    excerpt: schweiz(e.excerpt, sprache),
    content_html: html,
    seo_title: schweiz(e.seo_title, sprache),
    meta_description: schweiz(e.meta_description, sprache),
    focus_keyword: e.focus_keyword || b.keyword,
    word_count: woerter(loeseClaims(html)),
    wp_category_ids: kategorie,
    wp_tag_names: (e.tags ?? []).slice(0, 6),
    featured_image: bild,
  };
  const job = {
    ...article.job,
    pruefung: {
      links_entfernt: links.entfernt,
      claims_offen: offen.length,
      claims_belegt: endClaims.filter((c) => c.status === "belegt").length,
      cta: zaehleCta(html),
    },
  };
  const nurHub = istVorschlag || project.publish_mode === "hub_only";
  if (offen.length) return { job, patch: { ...patch, status: "faktencheck" }, ende: true };
  if (nurHub) return { job, patch: { ...patch, status: "entwurf_wp" }, ende: true };
  return { job, patch };
}

/** Artikel als WordPress-Entwurf (Kap. 6.4). Auch für «Änderungen senden». */
export async function sendeAnWordpress(article: any, project: any) {
  const wp = await wpVerbindung(project.id);
  if (!wp) throw new Error("WordPress ist nicht verbunden");
  const modus = article.job?.modus ?? "neu";
  const eigeneBilder = versionAb(wp.plugin_version, PLUGIN_EIGENE_BILDER);
  const body: Record<string, unknown> = {
    external_id: article.id,
    title: modus === "refresh" ? `[Überarbeitung] ${article.title}` : article.title,
    slug: modus === "refresh" ? `${article.slug}-ueberarbeitung` : article.slug,
    status: "draft",
    content_html: loeseClaims(article.content_html),
    excerpt: article.excerpt,
    seo: {
      title: article.seo_title,
      description: article.meta_description,
      focus_keyword: article.focus_keyword,
    },
    category_ids: article.wp_category_ids ?? [],
    tags: article.wp_tag_names ?? [],
    // Vorgabe Ezy One; das Plugin erzwingt es ab 2.0.1 ohnehin
    comment_status: "closed",
    ping_status: "closed",
  };
  if (article.featured_image?.url && eigeneBilder) body.featured_image = article.featured_image;
  const r = await ezrRequest(wp.conn, "POST", "/posts", body, 60_000);
  if (!r.ok) throw new Error(`WordPress: ${r.code} – ${r.message}`);
  return {
    wp_post_id: Number(r.data?.post_id) || null,
    wp_edit_url: r.data?.edit_url ?? null,
    wp_permalink: r.data?.permalink ?? null,
    bild_gesendet: !!body.featured_image,
  };
}

async function wordpress(article: any, project: any): Promise<StufeErgebnis> {
  const r = await sendeAnWordpress(article, project);
  return {
    job: {
      ...article.job,
      wordpress: { bild_gesendet: r.bild_gesendet, at: new Date().toISOString() },
    },
    patch: {
      wp_post_id: r.wp_post_id,
      wp_edit_url: r.wp_edit_url,
      wp_permalink: r.wp_permalink,
      status: "entwurf_wp",
    },
    ende: true,
  };
}

// ── Planung und Takt ────────────────────────────────────────────────────────

/** Artikel anlegen (Status freigegeben, Stufe brief). Doppelte pro Thema verhindert der Unique-Index. */
export async function legeArtikelAn(topic: any, trigger: "cron" | "manuell", actor: string | null) {
  const { data, error } = await SB.from("blog_articles")
    .insert({
      project_id: topic.project_id,
      client_id: topic.client_id,
      topic_id: topic.id,
      status: "freigegeben",
      stage: "brief",
      focus_keyword: topic.keyword,
      scheduled_for: topic.scheduled_for,
      job: { trigger },
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (data)
    await blogEvent(topic.project_id, "article.queued", { topic_id: topic.id, trigger }, actor);
  return data;
}

/** Täglicher Vorlauf (Kap. 6.3): Themen bis morgen (Zürich) werden geschrieben. */
export async function planeArtikel(jetzt = new Date()): Promise<number> {
  const bis = datumZuerich(jetzt, 1);
  const { data: projekte } = await SB.from("blog_projects").select("id").eq("status", "active");
  const ids = (projekte ?? []).map((p: any) => p.id);
  if (!ids.length) return 0;
  const { data: themen } = await SB.from("blog_topics")
    .select("*")
    .in("project_id", ids)
    .not("approved_at", "is", null)
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", bis)
    .gte("scheduled_for", datumZuerich(jetzt, -14))
    .order("scheduled_for", { ascending: true })
    .limit(20);
  if (!themen?.length) return 0;
  const { data: vorhanden } = await SB.from("blog_articles")
    .select("topic_id")
    .in(
      "topic_id",
      themen.map((t: any) => t.id),
    );
  const schon = new Set((vorhanden ?? []).map((a: any) => a.topic_id));
  let n = 0;
  for (const t of themen) {
    if (schon.has(t.id)) continue;
    if (await legeArtikelAn(t, "cron", null)) n++;
  }
  return n;
}

const OFFEN = ["freigegeben", "schreibt"];

export async function tickeBlogArtikel(budgetMs: number) {
  const start = Date.now();
  const out = { getickt: 0, fertig: 0, fehler: 0 };
  for (let i = 0; i < 8; i++) {
    const rest = budgetMs - (Date.now() - start);
    if (rest < 45_000) break;
    const nowIso = new Date().toISOString();
    const { data: rows } = await SB.from("blog_articles")
      .select("id")
      .in("status", OFFEN)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("updated_at", { ascending: true })
      .limit(1);
    if (!rows?.[0]) break;
    const { data: article } = await SB.from("blog_articles")
      .update({
        status: "schreibt",
        locked_until: new Date(Date.now() + 5 * 60_000).toISOString(),
        updated_at: nowIso,
      })
      .eq("id", rows[0].id)
      .in("status", OFFEN)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select("*")
      .maybeSingle();
    if (!article) continue;
    out.getickt++;
    const { data: project } = await SB.from("blog_projects")
      .select("*")
      .eq("id", article.project_id)
      .maybeSingle();
    const stage: Stufe = (STUFEN as readonly string[]).includes(article.stage)
      ? article.stage
      : "brief";
    try {
      if (!project) throw new Error("Projekt fehlt");
      const r =
        stage === "brief"
          ? await brief(article, project)
          : stage === "recherche"
            ? await recherche(article, project, rest)
            : stage === "entwurf"
              ? await entwurf(article, project, rest)
              : stage === "pruefen"
                ? await pruefen(article, project)
                : await wordpress({ ...article }, project);
      const naechste = r.ende ? null : (STUFEN[STUFEN.indexOf(stage) + 1] ?? null);
      const fertig = !naechste;
      await SB.from("blog_articles")
        .update({
          ...(r.patch ?? {}),
          job: r.job,
          stage: naechste ?? stage,
          attempts: 0,
          error: null,
          locked_until: null,
          ...(article.started_at ? {} : { started_at: nowIso }),
          ...(fertig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", article.id);
      if (fertig) {
        out.fertig++;
        const status = String((r.patch as any)?.status ?? "entwurf_wp");
        await blogEvent(
          article.project_id,
          status === "faktencheck" ? "article.factcheck_open" : "article.draft_ready",
          {
            article_id: article.id,
            modus: r.job?.modus,
            offen: r.job?.pruefung?.claims_offen ?? 0,
          },
          null,
        );
      }
    } catch (e) {
      if (e instanceof KiLaeuftNoch) {
        // Runner arbeitet noch: kein Fehlversuch, ein späterer Takt holt ab
        await SB.from("blog_articles")
          .update({
            locked_until: new Date(Date.now() + 30_000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", article.id);
        continue;
      }
      const attempts = (Number(article.attempts) || 0) + 1;
      const endgueltig = attempts >= MAX_VERSUCHE;
      const msg = String((e as Error)?.message || e).slice(0, 300);
      await SB.from("blog_articles")
        .update({
          attempts,
          status: endgueltig ? "fehler" : "schreibt",
          error: msg,
          locked_until: endgueltig ? null : new Date(Date.now() + 60_000).toISOString(),
          ...(endgueltig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", article.id);
      if (endgueltig) {
        out.fehler++;
        await blogEvent(
          article.project_id,
          "article.failed",
          { article_id: article.id, stage, error: msg },
          null,
        );
      }
    }
  }
  return out;
}

// ── Faktencheck auflösen (POST /api/blog/claims/:id/resolve) ────────────────

/**
 * Behauptung belegen (Quelle mit URL) oder entfernen (Satz fällt weg). Sind
 * danach keine offenen Behauptungen mehr da, läuft der Artikel weiter: in die
 * Stufe wordpress bzw. direkt «entwurf_wp» bei «nur in EzyHub».
 */
export async function loeseBehauptung(opts: {
  claim: any;
  aktion: "belegen" | "entfernen";
  quelleUrl?: string | null;
  actor: string | null;
}) {
  const { claim } = opts;
  const { data: article } = await SB.from("blog_articles")
    .select("*")
    .eq("id", claim.article_id)
    .maybeSingle();
  if (!article) throw new Error("Artikel nicht gefunden");
  let html = String(article.content_html || "");
  let hinweis: string | null = null;
  if (opts.aktion === "entfernen") {
    const n = /^span:(\d+)$/.exec(String(claim.note || ""));
    if (n) html = entferneClaims(html, new Set([Number(n[1])]));
    else {
      const r = entferneSatz(html, String(claim.claim_text || ""));
      html = r.html;
      if (!r.ok) hinweis = "Satz nicht automatisch gefunden – bitte im Text prüfen";
    }
  }
  await SB.from("article_claims")
    .update(
      opts.aktion === "belegen"
        ? { status: "manuell_belegt", source_url: opts.quelleUrl ?? null }
        : { status: "entfernt" },
    )
    .eq("id", claim.id);
  const { data: rest } = await SB.from("article_claims")
    .select("id")
    .eq("article_id", article.id)
    .eq("status", "offen");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (html !== article.content_html) {
    patch.content_html = html;
    patch.word_count = woerter(loeseClaims(html));
  }
  let weiter = false;
  if (!rest?.length && article.status === "faktencheck") {
    const { data: project } = await SB.from("blog_projects")
      .select("publish_mode")
      .eq("id", article.project_id)
      .maybeSingle();
    const nurHub = project?.publish_mode === "hub_only" || article.job?.modus === "vorschlag";
    Object.assign(
      patch,
      nurHub
        ? { status: "entwurf_wp" }
        : {
            status: "freigegeben",
            stage: "wordpress",
            attempts: 0,
            locked_until: null,
            finished_at: null,
          },
    );
    weiter = true;
  }
  await SB.from("blog_articles").update(patch).eq("id", article.id);
  await blogEvent(
    article.project_id,
    opts.aktion === "belegen" ? "claim.sourced" : "claim.removed",
    { article_id: article.id, claim_id: claim.id, weiter },
    opts.actor,
  );
  return { offen: rest?.length ?? 0, weiter, hinweis };
}

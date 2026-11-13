// Blog-Autopilot: KI-Sichtbarkeit im Blog-Dashboard. Liest die letzte Messung
// des Kunden (ai_visibility_reports, ai_visibility_prompts) und ordnet die
// zitierten Seiten der eigenen Domain den Live-Artikeln des Blogs zu: Welcher
// Artikel wird von welchem KI-System bei welcher Frage als Quelle genannt.
// Gemessen wird hier nichts. Jede Abfrage ist auf den Kunden des Projekts
// begrenzt (client_id).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalisiereDomain } from "@/server/blog-autopilot.server";

const SB = supabaseAdmin as any;
const MAX_FRAGEN = 20;
const MAX_WEITERE = 8;
const SEITE = 1000;
const MAX_SEITEN = 6;

export type KiZitat = { url: string; frage: string; system: string };
export type KiFrage = { frage: string; system: string };
export type KiSeite = { url: string; fragen: KiFrage[]; systeme: string[] };
export type KiArtikel = KiSeite & { id: string; titel: string };

const kurz = (s: unknown, n = 200): string =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

/** URL auf Host (ohne www.) und Pfad (ohne Schrägstrich am Ende) kürzen:
 *  Protokoll, Abfrage (utm_source usw.) und Anker fallen weg. Pure. */
export function urlSchluessel(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let pfad = u.pathname.replace(/\/+$/, "");
    try {
      pfad = decodeURI(pfad);
    } catch {
      /* Pfad bleibt, wie er ist */
    }
    return host + pfad.toLowerCase();
  } catch {
    return "";
  }
}

/** Gehört die URL zur Domain des Kunden (auch Subdomains)? Pure. */
export function eigeneUrl(raw: unknown, domain: string): boolean {
  const host = urlSchluessel(raw).split("/")[0];
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

/**
 * Alle Zitate der eigenen Domain aus einer Messung sammeln. Pure.
 * Quellen: Google AI Overviews und AI Mode (parts.sa.aio|aim.answers[].refs),
 * echte Antworten von ChatGPT und Gemini (parts.sa.aiSearch[].sources), die
 * Prompt-Antworten (source_urls: nur echte URLs, dort stehen auch Markennamen)
 * und die Liste der zitierten Seiten (parts.sa.urls, ohne Frage).
 */
export function sammleZitate(parts: any, prompts: any[], domainRoh: string): KiZitat[] {
  const domain = normalisiereDomain(domainRoh);
  const out: KiZitat[] = [];
  if (!domain) return out;
  const nimm = (url: unknown, frage: unknown, system: string) => {
    if (eigeneUrl(url, domain)) out.push({ url: String(url), frage: kurz(frage), system });
  };
  const sa = parts?.sa ?? {};
  for (const [feld, system] of [
    ["aio", "Google AI Overviews"],
    ["aim", "Google AI Mode"],
  ] as const)
    for (const a of Array.isArray(sa[feld]?.answers) ? sa[feld].answers : [])
      for (const ref of Array.isArray(a?.refs) ? a.refs : []) nimm(ref?.u, a?.kw, system);
  for (const a of Array.isArray(sa.aiSearch) ? sa.aiSearch : [])
    for (const q of Array.isArray(a?.sources) ? a.sources : [])
      nimm(q?.u, a?.kw, kurz(a?.engine, 40) || "KI-Suche");
  for (const p of Array.isArray(prompts) ? prompts : [])
    for (const u of Array.isArray(p?.source_urls) ? p.source_urls : [])
      nimm(u, p?.prompt, kurz(p?.platform, 40) || "KI-System");
  for (const u of Array.isArray(sa.urls) ? sa.urls : []) nimm(u, "", "");
  return out;
}

/** Zitate je Seite bündeln und den Live-Artikeln zuordnen. Pure. */
export function ordneZu(
  zitate: KiZitat[],
  artikel: { id: string; titel: string; urls: (string | null | undefined)[] }[],
): { artikel: KiArtikel[]; weitere: KiSeite[] } {
  const seiten = new Map<string, KiSeite>();
  for (const z of zitate) {
    const k = urlSchluessel(z.url);
    if (!k) continue;
    let s = seiten.get(k);
    if (!s) seiten.set(k, (s = { url: z.url.split(/[?#]/)[0], fragen: [], systeme: [] }));
    if (z.system && !s.systeme.includes(z.system)) s.systeme.push(z.system);
    if (
      z.frage &&
      s.fragen.length < MAX_FRAGEN &&
      !s.fragen.some((f) => f.frage === z.frage && f.system === z.system)
    )
      s.fragen.push({ frage: z.frage, system: z.system });
  }
  const vergeben = new Set<string>();
  const treffer: KiArtikel[] = [];
  for (const a of artikel) {
    const schluessel = a.urls.map(urlSchluessel).filter(Boolean);
    const k = schluessel.find((x) => seiten.has(x) && !vergeben.has(x));
    if (!k) continue;
    vergeben.add(k);
    treffer.push({ id: a.id, titel: a.titel, ...seiten.get(k)! });
  }
  const gewicht = (s: KiSeite) => s.fragen.length * 10 + s.systeme.length;
  treffer.sort((a, b) => gewicht(b) - gewicht(a));
  const weitere = [...seiten.entries()]
    .filter(([k]) => !vergeben.has(k))
    .map(([, s]) => s)
    .sort((a, b) => gewicht(b) - gewicht(a));
  return { artikel: treffer, weitere };
}

const zahlOderNull = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

/** Auswertung für das Blog-Dashboard. Ohne Messung: { gemessen: false }. */
export async function kiAuswertung(project: {
  id: string;
  client_id: string;
}): Promise<Record<string, unknown>> {
  const clientId = project.client_id;
  const { data: berichte } = await SB.from("ai_visibility_reports")
    .select(
      "id, snapshot_date, score, score_delta, mentions, mentions_delta, citations, citations_delta, cited_pages, cited_pages_delta, parts",
    )
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const bericht = Array.isArray(berichte) ? berichte[0] : null;
  if (!bericht) return { gemessen: false };

  const [{ data: kunde }, { data: artikelRoh }] = await Promise.all([
    SB.from("clients").select("domain").eq("id", clientId).maybeSingle(),
    SB.from("blog_articles")
      .select("id, title, focus_keyword, wp_permalink, status, job")
      .eq("project_id", project.id)
      .eq("status", "live"),
  ]);

  const prompts: any[] = [];
  for (let i = 0; i < MAX_SEITEN; i++) {
    const { data } = await SB.from("ai_visibility_prompts")
      .select("prompt, platform, source_urls")
      .eq("client_id", clientId)
      .eq("report_id", bericht.id)
      .order("id", { ascending: true })
      .range(i * SEITE, (i + 1) * SEITE - 1);
    const zeilen: any[] = Array.isArray(data) ? data : [];
    prompts.push(...zeilen);
    if (zeilen.length < SEITE) break;
  }

  const live: any[] = Array.isArray(artikelRoh) ? artikelRoh : [];
  const zitate = sammleZitate(bericht.parts, prompts, String(kunde?.domain ?? ""));
  const { artikel, weitere } = ordneZu(
    zitate,
    live.map((a) => ({
      id: String(a.id),
      titel: String(a.title || a.focus_keyword || "Ohne Titel"),
      urls: [a.wp_permalink, a.job?.brief?.original_url],
    })),
  );
  return {
    gemessen: true,
    stand: bericht.snapshot_date ?? null,
    score: zahlOderNull(bericht.score),
    scoreDelta: zahlOderNull(bericht.score_delta),
    erwaehnungen: zahlOderNull(bericht.mentions),
    erwaehnungenDelta: zahlOderNull(bericht.mentions_delta),
    zitate: zahlOderNull(bericht.citations),
    zitateDelta: zahlOderNull(bericht.citations_delta),
    seiten: zahlOderNull(bericht.cited_pages),
    seitenDelta: zahlOderNull(bericht.cited_pages_delta),
    artikelLive: live.length,
    artikel,
    weitere: weitere.slice(0, MAX_WEITERE),
    weitereAnzahl: weitere.length,
  };
}

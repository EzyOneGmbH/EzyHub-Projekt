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
const MAX_VERLAUF = 12;
const MAX_FRAGEN_LISTE = 40;

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

export type KiBasis = {
  fragen: number;
  systeme: string[];
  marke: { gefragt: number; erkannt: number };
};

/**
 * Worauf die Messung beruht: Anzahl allgemeiner Fragen (ohne Markennamen, nur
 * sie zählen für den Score), die befragten KI-Systeme und wie oft die Marke
 * bei Fragen nach ihr selbst erkannt wurde. Pure.
 */
export function messBasis(prompts: any[]): KiBasis {
  const basis: KiBasis = { fragen: 0, systeme: [], marke: { gefragt: 0, erkannt: 0 } };
  for (const p of Array.isArray(prompts) ? prompts : []) {
    const system = kurz(p?.platform, 40);
    if (system && !basis.systeme.includes(system)) basis.systeme.push(system);
    if (p?.prompt_type === "brand") {
      basis.marke.gefragt++;
      if (String(p?.status ?? "").trim()) basis.marke.erkannt++;
    } else basis.fragen++;
  }
  basis.systeme.sort();
  return basis;
}

export type KiSystemStand = { name: string; gefragt: number; beantwortet: number; grund?: string };

/** Fehlertext eines Anbieters in einen kurzen, festen Grund übersetzen. Der
 *  Rohtext (Anbieter-JSON, Request-IDs) verlässt den Server nie. Pure. */
export function grundKlar(roh: unknown): string {
  const t = String(roh ?? "").toLowerCase();
  if (/credit|balance|billing|payment|guthaben/.test(t)) return "Kein Guthaben";
  if (/quota|rate.?limit|429|exhaust|too many/.test(t)) return "Kontingent erschöpft";
  if (/kein key|api.?key|401|403|unauthor|forbidden|permission/.test(t)) return "Kein Zugang";
  return "Keine Antwort";
}

/**
 * Stand je KI-System aus parts.eng: über alle Abschnitte der Messung summiert.
 * Den Grund für ein stummes System sieht nur die Agentur. Pure.
 */
export function systemStaende(eng: unknown, agentur: boolean): KiSystemStand[] {
  const summe = new Map<string, { gefragt: number; beantwortet: number; fehler: string }>();
  if (eng && typeof eng === "object")
    for (const teil of Object.values(eng as Record<string, any>))
      for (const [nameRoh, st] of Object.entries((teil as Record<string, any>) || {})) {
        const name = kurz(nameRoh, 40);
        if (!name) continue;
        const z = summe.get(name) ?? { gefragt: 0, beantwortet: 0, fehler: "" };
        z.gefragt += Number(st?.gefragt || 0);
        z.beantwortet += Number(st?.beantwortet || 0);
        if (!z.fehler && st?.fehler) z.fehler = String(st.fehler);
        summe.set(name, z);
      }
  return [...summe.entries()]
    .filter(([, z]) => z.gefragt > 0)
    .map(([name, z]) => ({
      name,
      gefragt: z.gefragt,
      beantwortet: Math.min(z.beantwortet, z.gefragt),
      ...(agentur && z.beantwortet === 0 ? { grund: grundKlar(z.fehler) } : {}),
    }))
    .sort((a, b) => b.beantwortet - a.beantwortet || a.name.localeCompare(b.name));
}

export type KiErgebnis = "zitiert" | "erwaehnt" | "nicht";
export type KiFrageStand = {
  frage: string;
  thema: string;
  genannt: boolean;
  systeme: { name: string; ergebnis: KiErgebnis }[];
};

/**
 * Die gemessenen allgemeinen Fragen (ohne Markenfragen) mit dem Ergebnis je
 * KI-System. Zuerst die Fragen mit Nennung, dann die ohne. Pure.
 */
export function frageStaende(prompts: any[]): {
  fragen: KiFrageStand[];
  anzahl: number;
  ohneNennung: number;
} {
  const nach = new Map<string, KiFrageStand>();
  for (const p of Array.isArray(prompts) ? prompts : []) {
    if (p?.prompt_type === "brand") continue;
    const frage = kurz(p?.prompt);
    if (!frage) continue;
    let f = nach.get(frage);
    if (!f)
      nach.set(frage, (f = { frage, thema: kurz(p?.topic, 60), genannt: false, systeme: [] }));
    const status = String(p?.status ?? "").trim();
    const ergebnis: KiErgebnis =
      status === "Referenziert" ? "zitiert" : status ? "erwaehnt" : "nicht";
    if (ergebnis !== "nicht") f.genannt = true;
    const name = kurz(p?.platform, 40) || "KI-System";
    if (!f.systeme.some((x) => x.name === name)) f.systeme.push({ name, ergebnis });
  }
  const alle = [...nach.values()];
  const mit = alle.filter((f) => f.genannt);
  const ohne = alle.filter((f) => !f.genannt);
  return {
    fragen: [...mit, ...ohne].slice(0, MAX_FRAGEN_LISTE),
    anzahl: alle.length,
    ohneNennung: ohne.length,
  };
}

/** Auswertung für das Blog-Dashboard. Ohne Messung: { gemessen: false }. */
export async function kiAuswertung(
  project: {
    id: string;
    client_id: string;
  },
  opts: { agentur?: boolean } = {},
): Promise<Record<string, unknown>> {
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

  const [{ data: kunde }, { data: artikelRoh }, { data: verlaufRoh }] = await Promise.all([
    SB.from("clients").select("domain").eq("id", clientId).maybeSingle(),
    SB.from("blog_articles")
      .select("id, title, focus_keyword, wp_permalink, status, job")
      .eq("project_id", project.id)
      .eq("status", "live"),
    SB.from("ai_visibility_reports")
      .select("snapshot_date, score, mentions, citations")
      .eq("client_id", clientId)
      .order("snapshot_date", { ascending: false })
      .limit(MAX_VERLAUF),
  ]);

  const prompts: any[] = [];
  for (let i = 0; i < MAX_SEITEN; i++) {
    const { data } = await SB.from("ai_visibility_prompts")
      .select("prompt, platform, source_urls, prompt_type, status, topic")
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
  const verlauf = (Array.isArray(verlaufRoh) ? verlaufRoh : [])
    .filter((b: any) => b?.snapshot_date)
    .map((b: any) => ({
      datum: String(b.snapshot_date).slice(0, 10),
      score: zahlOderNull(b.score),
      erwaehnungen: zahlOderNull(b.mentions),
      zitate: zahlOderNull(b.citations),
    }))
    .sort((a: any, b: any) => a.datum.localeCompare(b.datum))
    .slice(-MAX_VERLAUF);
  const fragen = frageStaende(prompts);
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
    basis: messBasis(prompts),
    verlauf,
    systemStand: systemStaende(bericht.parts?.eng, !!opts.agentur),
    fragen: fragen.fragen,
    fragenAnzahl: fragen.anzahl,
    fragenOhneNennung: fragen.ohneNennung,
    artikelLive: live.length,
    artikel,
    weitere: weitere.slice(0, MAX_WEITERE),
    weitereAnzahl: weitere.length,
  };
}

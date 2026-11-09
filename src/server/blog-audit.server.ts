// Blog-Autopilot Phase 2: KI-Audit für Keyword-Chancen (Bauanleitung Kap. 6.2).
// Stufen-Job im minütlichen Worker (keyword_audits):
//   sammeln   Search Console (28 Tage + Vorperiode), publizierte Artikel
//   ahrefs    Keyword-Ideen je Seed aus den Themen-Clustern (+ Domain-Keywords,
//             wenn keine Search Console); 30 Tage Cache, Units-Budget je Audit
//   bewerten  Regeln (fast_vorne / neu / abgedeckt) + Suchintention per Claude
//             (passt nicht → aussortiert)
//   speichern keyword_opportunities + Quellen (GSC, Ahrefs-Units, Artikel)
// Wöchentlich montags automatisch für aktive Projekte (planeWochenAudits).
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, normalisiereDomain } from "@/server/blog-autopilot.server";
import { claudeText, jsonAusText } from "@/server/blog-analysis.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { gscRows, GSC_END_LAG_DAYS } from "@/server/gsc.server";

const SB = supabaseAdmin as any;
const AHREFS = "https://api.ahrefs.com/v3";
const CACHE_TAGE = 30;
const MAX_VERSUCHE = 3;
/** Units je Zeile (Ahrefs-Doku: volume 10, difficulty 10, Grundpreis ~2). */
export const UNITS_PRO_ZEILE = 22;

// ── Reine Helfer (vitest) ───────────────────────────────────────────────────

const STOPP = new Set(
  "der die das den dem des und oder in im am an auf aus bei für fuer mit von vom zu zum zur ein eine einer eines einem ist sind wie was wo wer warum the of to for and a".split(
    " ",
  ),
);
export function tokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPP.has(t));
}
export function aehnlichkeit(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let schnitt = 0;
  for (const t of A) if (B.has(t)) schnitt++;
  return schnitt / (A.size + B.size - schnitt);
}
export const normKw = (k: string) => tokens(k).join(" ");

export type GscQuery = {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
  page: string | null;
  position_prev: number | null;
};

/** GSC-Zeilen (query,page) zu einer Zeile je Suchanfrage verdichten. */
export function verdichteGsc(
  rows: Array<{ keys: string[]; impressions: number; clicks: number; position: number }>,
  vorher: Map<string, number> = new Map(),
): GscQuery[] {
  const m = new Map<string, { imp: number; clk: number; posSum: number; top: [string, number] }>();
  for (const r of rows) {
    const [q, page] = r.keys;
    const e = m.get(q) ?? { imp: 0, clk: 0, posSum: 0, top: ["", -1] as [string, number] };
    e.imp += r.impressions;
    e.clk += r.clicks;
    e.posSum += r.position * r.impressions;
    if (r.impressions > e.top[1]) e.top = [page ?? "", r.impressions];
    m.set(q, e);
  }
  return [...m.entries()]
    .map(([query, e]) => ({
      query,
      impressions: e.imp,
      clicks: e.clk,
      position: e.imp ? Math.round((e.posSum / e.imp) * 10) / 10 : 0,
      page: e.top[0] || null,
      position_prev: vorher.get(query) ?? null,
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

export type Artikel = { url: string; title: string; keywords: string[] };

/** Deckt ein publizierter Artikel das Keyword ab? → URL oder null. */
export function abgedecktVon(
  keyword: string,
  artikel: Artikel[],
  gscSeite?: string | null,
): string | null {
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (gscSeite) {
    const treffer = artikel.find((a) => norm(a.url) === norm(gscSeite));
    if (treffer) return treffer.url;
  }
  let best: { url: string; s: number } | null = null;
  for (const a of artikel) {
    const s = Math.max(
      ...[...a.keywords, a.title].filter(Boolean).map((k) => aehnlichkeit(keyword, k)),
      0,
    );
    if (s >= 0.5 && (!best || s > best.s)) best = { url: a.url, s };
  }
  return best?.url ?? null;
}

/** Marken-Suchanfragen (Name/Domain) gehören nicht in den Themenplan. */
export function istMarke(query: string, name: string, domain: string): boolean {
  const marke = [...tokens(name), ...tokens(normalisiereDomain(domain).split(".")[0] || "")].filter(
    (t) => t.length >= 4,
  );
  const q = tokens(query);
  return marke.some((t) => q.includes(t)) || q.join("").includes(tokens(name).join(""));
}

export type Kandidat = {
  keyword: string;
  category: "fast_vorne" | "neu" | "abgedeckt" | "aussortiert";
  volume: number | null;
  difficulty: number | null;
  avg_position: number | null;
  position_delta: number | null;
  impressions: number | null;
  parent_topic: string | null;
  covered_by_url: string | null;
  cluster: string | null;
  reason: string;
};

/** Regel-Kategorien ohne KI (Kap. 6.2). Suchintention prüft danach Claude. */
export function kategorisiere(opts: {
  gsc: GscQuery[];
  ideen: Array<{
    keyword: string;
    volume: number | null;
    difficulty: number | null;
    parent_topic: string | null;
    cluster: string | null;
  }>;
  artikel: Artikel[];
  minVolume: number;
  minImpressions: number;
  name: string;
  domain: string;
}): Kandidat[] {
  const out = new Map<string, Kandidat>();
  for (const q of opts.gsc) {
    if (istMarke(q.query, opts.name, opts.domain)) continue;
    if (q.position < 4 || q.position > 20 || q.impressions < opts.minImpressions) continue;
    const key = normKw(q.query);
    if (!key || out.has(key)) continue;
    out.set(key, {
      keyword: q.query,
      category: "fast_vorne",
      volume: null,
      difficulty: null,
      avg_position: q.position,
      position_delta:
        q.position_prev != null ? Math.round((q.position_prev - q.position) * 10) / 10 : null,
      impressions: q.impressions,
      parent_topic: null,
      covered_by_url: q.page,
      cluster: null,
      reason: `Position ${q.position.toLocaleString("de-CH")} mit ${q.impressions} Impressionen in 28 Tagen – ein Refresh kann auf Seite 1 bringen.`,
    });
    if (out.size >= 15) break;
  }
  const gscNachKey = new Map(opts.gsc.map((q) => [normKw(q.query), q]));
  for (const i of opts.ideen) {
    const key = normKw(i.keyword);
    if (!key || out.has(key)) continue;
    if ((i.volume ?? 0) < opts.minVolume) continue;
    if (istMarke(i.keyword, opts.name, opts.domain)) continue;
    const g = gscNachKey.get(key);
    if (g && g.position < 4) continue; // rankt schon top 3
    const url = abgedecktVon(i.keyword, opts.artikel, g?.page);
    out.set(key, {
      keyword: i.keyword,
      category: url ? "abgedeckt" : "neu",
      volume: i.volume,
      difficulty: i.difficulty,
      avg_position: g?.position ?? null,
      position_delta: null,
      impressions: g?.impressions ?? null,
      parent_topic: i.parent_topic,
      covered_by_url: url,
      cluster: i.cluster,
      reason: url
        ? `Ein publizierter Artikel deckt das Thema schon ab – besser auffrischen als neu schreiben.`
        : `${i.volume} Suchen pro Monat${i.difficulty != null ? `, Schwierigkeit ${i.difficulty}` : ""}; noch kein Artikel dazu.`,
    });
  }
  return [...out.values()];
}

/** Gleichmässig verteilte Termine (Werktage) ab morgen nach Kontingent. */
export function verteileTermine(anzahl: number, proMonat: number, ab: Date = new Date()): string[] {
  const abstand = Math.max(1, Math.floor(30 / Math.max(1, proMonat)));
  const out: string[] = [];
  const d = new Date(Date.UTC(ab.getUTCFullYear(), ab.getUTCMonth(), ab.getUTCDate() + 1));
  for (let i = 0; i < anzahl; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + abstand);
  }
  return out;
}

// ── Ahrefs mit Cache und Budget ─────────────────────────────────────────────

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ahrefsAbruf(
  endpoint: string,
  params: Record<string, string>,
  unitsProZeile: number,
): Promise<{ rows: any[]; units: number; cache: boolean }> {
  const hash = await sha256(endpoint + JSON.stringify(Object.entries(params).sort()));
  const { data: c } = await SB.from("ahrefs_cache")
    .select("response, fetched_at")
    .eq("endpoint", endpoint)
    .eq("params_hash", hash)
    .maybeSingle();
  if (c && Date.now() - new Date(c.fetched_at).getTime() < CACHE_TAGE * 86_400_000)
    return { rows: c.response?.keywords ?? [], units: 0, cache: true };
  const key = process.env.AHREFS_API_KEY;
  if (!key) throw new Error("Ahrefs ist nicht konfiguriert (AHREFS_API_KEY fehlt)");
  const url = new URL(`${AHREFS}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok)
    throw new Error(
      `Ahrefs ${endpoint} HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}`,
    );
  const j: any = await r.json();
  const rows = j?.keywords ?? [];
  const units = rows.length * unitsProZeile;
  await SB.from("ahrefs_cache").upsert(
    {
      endpoint,
      params_hash: hash,
      params,
      response: { keywords: rows },
      units,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "endpoint,params_hash" },
  );
  return { rows, units, cache: false };
}

// ── Stufen ──────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
const tageZurueck = (n: number) => new Date(Date.now() - n * 86_400_000);

async function sammeln(audit: any, project: any) {
  const { data: client } = await SB.from("clients")
    .select("gsc_property")
    .eq("id", project.client_id)
    .maybeSingle();
  let gsc: GscQuery[] = [];
  let gscStatus = "nicht verbunden";
  if (client?.gsc_property) {
    try {
      const { accessToken } = await getGoogleAccessToken(project.client_id);
      const ende = tageZurueck(GSC_END_LAG_DAYS);
      const basis = { site: client.gsc_property, accessToken, timeoutMs: 20_000 };
      const [jetzt, vorher] = await Promise.all([
        gscRows({
          ...basis,
          startDate: iso(tageZurueck(GSC_END_LAG_DAYS + 27)),
          endDate: iso(ende),
          dimensions: ["query", "page"],
          rowLimit: 3000,
        }),
        gscRows({
          ...basis,
          startDate: iso(tageZurueck(GSC_END_LAG_DAYS + 55)),
          endDate: iso(tageZurueck(GSC_END_LAG_DAYS + 28)),
          dimensions: ["query"],
          rowLimit: 3000,
        }),
      ]);
      gsc = verdichteGsc(jetzt.rows, new Map(vorher.rows.map((r) => [r.keys[0], r.position])));
      gscStatus = "ok";
    } catch (e) {
      gscStatus = `Fehler: ${String((e as Error)?.message || e).slice(0, 120)}`;
    }
  }
  const { data: items } = await SB.from("content_items")
    .select("target_url, title, primary_keyword, keywords")
    .eq("client_id", project.client_id)
    .eq("content_type", "blog")
    .eq("status", "published");
  const artikel: Artikel[] = (items ?? [])
    .filter((i: any) => i.target_url)
    .map((i: any) => ({
      url: i.target_url,
      title: i.title ?? "",
      keywords: [i.primary_keyword, ...(i.keywords ?? [])].filter(Boolean),
    }));
  const { data: ana } = await SB.from("blog_analysis_runs")
    .select("result")
    .eq("project_id", project.id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const clusters: Array<{ name: string; seeds: string[] }> = ana?.result?.clusters ?? [];
  return {
    state: { gsc: gsc.slice(0, 800), gscStatus, artikel, clusters },
    events: [
      {
        key: "sammeln",
        label: "Daten sammeln",
        detail: `${gsc.length} Suchanfragen (Search Console ${gscStatus}), ${artikel.length} publizierte Artikel`,
      },
    ],
    percent: 25,
  };
}

/** Seeds reihum aus den Clustern, max. 10. */
export function seedsAus(clusters: Array<{ name: string; seeds: string[] }>, max = 10) {
  const out: Array<{ seed: string; cluster: string }> = [];
  for (let i = 0; out.length < max && i < 6; i++)
    for (const c of clusters) {
      const s = c.seeds?.[i];
      if (s && !out.some((o) => o.seed === s) && out.length < max)
        out.push({ seed: s, cluster: c.name });
    }
  return out;
}

async function ahrefsStufe(audit: any, project: any) {
  const st = audit.state;
  const budget = Number(project.ahrefs_units_limit ?? 1000);
  const land = String(project.market || "CH").toLowerCase();
  let units = 0;
  let cacheTreffer = 0;
  const ideen: any[] = [];
  const seeds = seedsAus(st.clusters ?? []);
  const proSeed = Math.max(
    3,
    Math.min(8, Math.floor((budget * 0.8) / Math.max(1, seeds.length) / UNITS_PRO_ZEILE)),
  );
  for (const s of seeds) {
    if (units + proSeed * UNITS_PRO_ZEILE > budget) break;
    const r = await ahrefsAbruf(
      "keywords-explorer/matching-terms",
      {
        select: "keyword,volume,difficulty,parent_topic",
        country: land,
        keywords: s.seed,
        limit: String(proSeed),
        order_by: "volume:desc",
        where: JSON.stringify({ field: "volume", is: ["gte", Number(project.min_volume ?? 10)] }),
      },
      UNITS_PRO_ZEILE,
    );
    units += r.units;
    if (r.cache) cacheTreffer++;
    for (const k of r.rows) ideen.push({ ...k, cluster: s.cluster });
  }
  // Ohne Search Console: Domain-Keywords aus Ahrefs als Ersatz für «fast vorne»
  let domainKw: GscQuery[] = [];
  if (st.gscStatus !== "ok" && units + 20 * 12 <= budget) {
    const r = await ahrefsAbruf(
      "site-explorer/organic-keywords",
      {
        select: "keyword,best_position,best_position_url,volume",
        target: project.domain,
        mode: "subdomains",
        country: land,
        date: iso(new Date()),
        limit: "20",
        order_by: "volume:desc",
      },
      12,
    );
    units += r.units;
    domainKw = r.rows
      .filter((k: any) => k.keyword && k.best_position)
      .map((k: any) => ({
        query: k.keyword,
        impressions: Number(k.volume ?? 0),
        clicks: 0,
        position: Number(k.best_position),
        page: k.best_position_url ?? null,
        position_prev: null,
      }));
  }
  return {
    state: { ...st, ideen, domainKw, units, cacheTreffer },
    events: [
      {
        key: "ahrefs",
        label: "Keywords recherchieren",
        detail: `${ideen.length} Ideen aus ${seeds.length} Seeds · ${units} Ahrefs-Units${cacheTreffer ? `, ${cacheTreffer}× aus Cache` : ""}`,
      },
    ],
    percent: 55,
  };
}

const IntentSchema = z.object({
  pruefung: z
    .array(
      z.object({
        keyword: z.string(),
        passt: z.boolean().catch(true),
        grund: z.string().catch(""),
        cluster: z.string().nullable().catch(null),
        artikeltyp: z
          .enum(["ratgeber", "anleitung", "erklaerung", "uebersicht"])
          .nullable()
          .catch(null),
      }),
    )
    .catch([]),
});

export async function pruefeSuchintention(
  project: any,
  kandidaten: Kandidat[],
  clusters: string[],
) {
  const liste = kandidaten
    .filter((k) => k.category === "neu" || k.category === "abgedeckt")
    .slice(0, 60);
  if (!liste.length) return new Map<string, z.infer<typeof IntentSchema>["pruefung"][number]>();
  const roh = await claudeText({
    system:
      "Du prüfst Keyword-Chancen für den Blog eines Kunden einer Schweizer SEO-Agentur. Antworte nur mit JSON. Schweizer Rechtschreibung (ss statt ß).",
    prompt: `Kunde: ${project.name || project.domain}
Angebot: ${project.description || "(keine Beschreibung)"}
Zielgruppen: ${(project.audiences ?? []).join("; ") || "-"}
Themen-Cluster: ${clusters.join(", ") || "-"}

Prüfe für jedes Keyword, ob die Suchintention zum Angebot passt: Würde ein Blogartikel dieses Kunden
die Suchenden sinnvoll bedienen? "Hauptthema" ist das übergeordnete Thema laut Ahrefs; weicht es klar vom
Angebot ab (z. B. Gartenbrunnen statt Trinkwasser-Hilfe), passt das Keyword nicht.

${liste.map((k) => `- ${k.keyword} | Hauptthema: ${k.parent_topic ?? "-"} | Volumen: ${k.volume ?? "-"}`).join("\n")}

Antworte so:
{"pruefung":[{"keyword":"…","passt":true,"grund":"ein kurzer Satz","cluster":"einer der Cluster oder null","artikeltyp":"ratgeber|anleitung|erklaerung|uebersicht"}]}`,
    maxTokens: 4000,
    timeoutMs: 100_000,
  });
  const p = IntentSchema.parse(jsonAusText(roh)).pruefung;
  return new Map(p.map((x) => [normKw(x.keyword), x]));
}

async function bewerten(audit: any, project: any) {
  const st = audit.state;
  const kandidaten = kategorisiere({
    gsc: [...(st.gsc ?? []), ...(st.domainKw ?? [])],
    ideen: st.ideen ?? [],
    artikel: st.artikel ?? [],
    minVolume: Number(project.min_volume ?? 10),
    minImpressions: Number(project.min_impressions ?? 10),
    name: project.name || "",
    domain: project.domain,
  });
  let intentFehler: string | null = null;
  try {
    const intent = await pruefeSuchintention(
      project,
      kandidaten,
      (st.clusters ?? []).map((c: any) => c.name),
    );
    for (const k of kandidaten) {
      const i = intent.get(normKw(k.keyword));
      if (!i) continue;
      if (i.cluster && !k.cluster) k.cluster = i.cluster;
      (k as any).artikeltyp = i.artikeltyp;
      if (!i.passt) {
        k.category = "aussortiert";
        k.reason = `Suchintention passt nicht: ${i.grund || (k.parent_topic ? `Hauptthema «${k.parent_topic}»` : "anderes Thema")}.`;
      }
    }
  } catch (e) {
    intentFehler = String((e as Error)?.message || e).slice(0, 160);
  }
  const zahl = (c: string) => kandidaten.filter((k) => k.category === c).length;
  return {
    state: { ...st, kandidaten, intentFehler },
    events: [
      {
        key: "bewerten",
        label: "Chancen bewerten",
        detail: `${zahl("fast_vorne")} fast vorne, ${zahl("neu")} neu, ${zahl("abgedeckt")} abgedeckt, ${zahl("aussortiert")} aussortiert${intentFehler ? " (Suchintention nicht geprüft)" : ""}`,
      },
    ],
    percent: 85,
  };
}

async function speichern(audit: any, project: any) {
  const st = audit.state;
  const k: Kandidat[] = st.kandidaten ?? [];
  if (k.length)
    await SB.from("keyword_opportunities").insert(
      k.map((x) => ({
        audit_id: audit.id,
        project_id: project.id,
        keyword: x.keyword.slice(0, 200),
        category: x.category,
        volume: x.volume,
        difficulty: x.difficulty,
        avg_position: x.avg_position,
        position_delta: x.position_delta,
        impressions: x.impressions,
        parent_topic: x.parent_topic,
        covered_by_url: x.covered_by_url,
        cluster: x.cluster,
        reason: x.reason.slice(0, 500),
        decision: "offen",
      })),
    );
  const sources = {
    gsc_keywords: (st.gsc ?? []).length,
    gsc_status: st.gscStatus,
    ahrefs_units: st.units ?? 0,
    ahrefs_cache_hits: st.cacheTreffer ?? 0,
    published_articles: (st.artikel ?? []).length,
    market: project.market,
    intent_checked: !st.intentFehler,
  };
  return {
    sources,
    events: [{ key: "fertig", label: "Fertig", detail: `${k.length} Chancen gespeichert` }],
    percent: 100,
  };
}

const STUFEN = ["sammeln", "ahrefs", "bewerten", "speichern"] as const;

export async function tickeKeywordAudits(budgetMs: number) {
  const start = Date.now();
  const out = { getickt: 0, fertig: 0, fehler: 0 };
  for (let i = 0; i < 8; i++) {
    if (budgetMs - (Date.now() - start) < 110_000) break;
    const nowIso = new Date().toISOString();
    const { data: rows } = await SB.from("keyword_audits")
      .select("id")
      .in("status", ["queued", "running"])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("updated_at", { ascending: true })
      .limit(1);
    if (!rows?.[0]) break;
    const { data: audit } = await SB.from("keyword_audits")
      .update({
        status: "running",
        locked_until: new Date(Date.now() + 4 * 60_000).toISOString(),
        updated_at: nowIso,
      })
      .eq("id", rows[0].id)
      .in("status", ["queued", "running"])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select("*")
      .maybeSingle();
    if (!audit) continue;
    out.getickt++;
    const { data: project } = await SB.from("blog_projects")
      .select("*")
      .eq("id", audit.project_id)
      .maybeSingle();
    try {
      if (!project) throw new Error("Projekt fehlt");
      const stage = (STUFEN as readonly string[]).includes(audit.stage) ? audit.stage : "sammeln";
      const r: any =
        stage === "sammeln"
          ? await sammeln(audit, project)
          : stage === "ahrefs"
            ? await ahrefsStufe(audit, project)
            : stage === "bewerten"
              ? await bewerten(audit, project)
              : await speichern(audit, project);
      const naechste = STUFEN[STUFEN.indexOf(stage as any) + 1] ?? null;
      const events = [
        ...(audit.events ?? []),
        ...r.events.map((e: any) => ({ ...e, at: new Date().toISOString(), status: "fertig" })),
      ];
      await SB.from("keyword_audits")
        .update({
          ...(r.state ? { state: r.state } : {}),
          ...(r.sources ? { sources: r.sources } : {}),
          events,
          percent: r.percent,
          stage: naechste ?? "speichern",
          status: naechste ? "running" : "done",
          attempts: 0,
          error: null,
          locked_until: null,
          ...(audit.started_at ? {} : { started_at: nowIso }),
          ...(naechste ? {} : { finished_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", audit.id);
      if (!naechste) {
        out.fertig++;
        await blogEvent(
          audit.project_id,
          "audit.done",
          { audit_id: audit.id, trigger: audit.trigger },
          audit.created_by ?? null,
        );
      }
    } catch (e) {
      const attempts = (Number(audit.attempts) || 0) + 1;
      const endgueltig = attempts >= MAX_VERSUCHE;
      const msg = String((e as Error)?.message || e).slice(0, 300);
      await SB.from("keyword_audits")
        .update({
          attempts,
          status: endgueltig ? "failed" : "running",
          error: msg,
          locked_until: endgueltig ? null : new Date(Date.now() + 45_000).toISOString(),
          ...(endgueltig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", audit.id);
      if (endgueltig) {
        out.fehler++;
        await blogEvent(
          audit.project_id,
          "audit.failed",
          { audit_id: audit.id, stage: audit.stage, error: msg },
          audit.created_by ?? null,
        );
      }
    }
  }
  return out;
}

/** Ist es Montag in Zürich? (Wochen-Audit, Kap. 6.2) */
export function istMontagZuerich(d = new Date()): boolean {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", weekday: "short" }).format(d) ===
    "Mon"
  );
}

/** Montags: für jedes aktive Projekt einen Audit anlegen, falls der letzte älter als 6 Tage ist. */
export async function planeWochenAudits(jetzt = new Date()): Promise<number> {
  if (!istMontagZuerich(jetzt)) return 0;
  const { data: projekte } = await SB.from("blog_projects").select("id").eq("status", "active");
  let neu = 0;
  for (const p of projekte ?? []) {
    const { data: letzter } = await SB.from("keyword_audits")
      .select("id, created_at, status")
      .eq("project_id", p.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      letzter &&
      (["queued", "running"].includes(letzter.status) ||
        jetzt.getTime() - new Date(letzter.created_at).getTime() < 6 * 86_400_000)
    )
      continue;
    await SB.from("keyword_audits").insert({ project_id: p.id, trigger: "cron" });
    neu++;
  }
  return neu;
}

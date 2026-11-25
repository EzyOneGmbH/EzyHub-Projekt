// Blog-Tab «Optimierung»: alle veröffentlichten Artikel mit einer Einschätzung,
// ob sich eine Überarbeitung lohnt, und der Auftrag «Mit KI optimieren». Die
// Überarbeitung läuft durch die normale Pipeline (Modus «refresh»): Entwurf,
// Prüfung durch Ezy One, erst die Freigabe ersetzt den Artikel auf der Website.
import { blogEingerichtet } from "@/ezy/data/blogAutopilot";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, istAgentur, type BlogKontext } from "@/server/blog-autopilot.server";
import {
  MAX_PARALLEL,
  datumZuerich,
  gehoertZu,
  hostVonUrl,
  normUrl,
} from "@/server/blog-pipeline.server";

const SB = supabaseAdmin as any;

type Antwort = { status: number; body: Record<string, unknown> };
const fehler = (status: number, error: string, mehr: Record<string, unknown> = {}): Antwort => ({
  status,
  body: { ok: false, error, ...mehr },
});

const OFFEN = ["freigegeben", "schreibt", "faktencheck", "entwurf_wp", "kunde_freigegeben"];
const MONATE_ALT = 12;

export type Stufe = "hoch" | "mittel" | "ok";
export type Einschaetzung = { stufe: Stufe; grund: string };

/** Lohnt sich eine Überarbeitung? Ranking-Chance und Indexierung gehen vor Alter. */
export function einschaetzung(s: {
  chance?: { keyword: string; position: number | null } | null;
  indexVerdict?: string | null;
  zuletzt?: string | null;
  heute: Date;
}): Einschaetzung {
  if (s.chance) {
    const pos = s.chance.position != null ? Math.round(Number(s.chance.position)) : null;
    return {
      stufe: "hoch",
      grund: pos
        ? `Rankt auf Position ${pos} für «${s.chance.keyword}»`
        : `Fast vorne für «${s.chance.keyword}»`,
    };
  }
  if (s.indexVerdict && s.indexVerdict !== "PASS")
    return { stufe: "hoch", grund: "Nicht bei Google indexiert" };
  const t = s.zuletzt ? new Date(s.zuletzt).getTime() : NaN;
  if (Number.isFinite(t)) {
    const grenze = new Date(s.heute);
    grenze.setMonth(grenze.getMonth() - MONATE_ALT);
    if (t < grenze.getTime())
      return { stufe: "mittel", grund: `Seit über ${MONATE_ALT} Monaten nicht überarbeitet` };
  }
  return { stufe: "ok", grund: "Keine Auffälligkeit" };
}

/** URL des Originals, zu dem ein Artikel die Überarbeitung ist (sonst null). */
function originalVon(a: any): string | null {
  const u = a.opt_url ?? a.job?.optimierung?.url;
  if (u) return String(u);
  const modus = a.modus ?? a.job?.modus;
  const b = a.brief_url ?? a.job?.brief?.original_url;
  return modus === "refresh" && b ? String(b) : null;
}

const zustandVon = (status: string): "laeuft" | "bereit" | "fehler" =>
  status === "fehler"
    ? "fehler"
    : ["freigegeben", "schreibt"].includes(status)
      ? "laeuft"
      : "bereit";

function titelAusUrl(url: string): string {
  try {
    const teile = new URL(url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(teile.pop() ?? url).replace(/[-_]+/g, " ") || url;
  } catch {
    return url;
  }
}

const spaeter = (a?: string | null, b?: string | null): string | null =>
  !a ? (b ?? null) : !b ? a : String(a) > String(b) ? a : b;

/**
 * Liste für den Tab: je veröffentlichter URL eine Zeile. `articles` sind die
 * Blog-Artikel des Projekts (flach: modus, herkunft, review, opt_url, brief_url),
 * `opps` die Chancen des letzten Audits, `items` die Inhalte des Kunden.
 */
export function baueListe(e: {
  articles: any[];
  opps: any[];
  items: any[];
  kunde: boolean;
  heute: Date;
}) {
  const itemJe = new Map<string, any>();
  for (const i of e.items) if (i.target_url) itemJe.set(normUrl(i.target_url), i);

  const oppJe = new Map<string, any>();
  for (const o of e.opps) {
    if (!o.covered_by_url || o.category !== "fast_vorne") continue;
    const k = normUrl(o.covered_by_url);
    const alt = oppJe.get(k);
    if (!alt || Number(o.impressions ?? 0) > Number(alt.impressions ?? 0)) oppJe.set(k, o);
  }

  // veröffentlicht: je URL eine Zeile, der im Hub geschriebene Artikel geht vor
  const liveJe = new Map<string, any>();
  for (const a of e.articles) {
    if (a.status !== "live" || !a.wp_permalink) continue;
    const k = normUrl(a.wp_permalink);
    const alt = liveJe.get(k);
    if (!alt || (alt.herkunft === "extern" && a.herkunft !== "extern")) liveJe.set(k, a);
  }

  // Überarbeitungen: die jüngste offene je Original
  const offenJe = new Map<string, any>();
  for (const a of e.articles) {
    if (a.status === "live") continue;
    const u = originalVon(a);
    if (!u) continue;
    if (e.kunde && !(a.review || a.status === "kunde_freigegeben")) continue;
    const k = normUrl(u);
    const alt = offenJe.get(k);
    if (!alt || String(a.created_at ?? "") > String(alt.created_at ?? "")) offenJe.set(k, a);
  }

  const zeilen = [...liveJe.entries()].map(([k, a]) => {
    const item = itemJe.get(k);
    const opp = oppJe.get(k);
    const offen = offenJe.get(k);
    const extern = a.herkunft === "extern";
    const ueberarbeitetAm = !extern && originalVon(a) ? (a.published_at ?? null) : null;
    const veroeffentlicht = extern
      ? (item?.published_at ?? a.published_at ?? null)
      : ueberarbeitetAm
        ? (item?.published_at ?? a.published_at ?? null)
        : (a.published_at ?? item?.published_at ?? null);
    const zuletzt = spaeter(spaeter(veroeffentlicht, item?.last_refresh_at), ueberarbeitetAm);
    return {
      id: a.id,
      title: a.title || item?.title || titelAusUrl(a.wp_permalink),
      url: a.wp_permalink,
      published_at: veroeffentlicht,
      extern,
      einschaetzung: einschaetzung({
        chance: opp ? { keyword: opp.keyword, position: opp.avg_position ?? null } : null,
        indexVerdict: item?.index_verdict ?? null,
        zuletzt,
        heute: e.heute,
      }),
      keyword: opp?.keyword ?? null,
      position: opp?.avg_position ?? null,
      impressions: opp?.impressions ?? null,
      ueberarbeitung: offen
        ? { id: offen.id, status: offen.status, zustand: zustandVon(offen.status) }
        : null,
      ueberarbeitet_am: ueberarbeitetAm,
    };
  });

  const rang: Record<Stufe, number> = { hoch: 0, mittel: 1, ok: 2 };
  return zeilen.sort((x, y) => {
    const d = rang[x.einschaetzung.stufe] - rang[y.einschaetzung.stufe];
    if (d) return d;
    if (x.einschaetzung.stufe === "hoch")
      return Number(y.impressions ?? 0) - Number(x.impressions ?? 0);
    const a = String(x.published_at ?? "");
    const b = String(y.published_at ?? "");
    return x.einschaetzung.stufe === "mittel" ? a.localeCompare(b) : b.localeCompare(a);
  });
}

/** «Mit KI optimieren»: legt die Überarbeitung eines veröffentlichten Artikels an. */
export async function starteOptimierung(
  project: any,
  ctx: BlogKontext,
  articleId: string,
): Promise<Antwort> {
  if (!istAgentur(ctx)) return fehler(403, "Nur für Ezy One");
  if (!blogEingerichtet(project.status))
    return fehler(409, "Der Autopilot ist noch nicht gestartet");

  const { data: artikel } = await SB.from("blog_articles")
    .select("id, status, title, focus_keyword, wp_permalink")
    .eq("id", articleId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!artikel || artikel.status !== "live" || !artikel.wp_permalink)
    return fehler(404, "Artikel nicht gefunden");
  const url = String(artikel.wp_permalink);
  // Der Brief ruft diese URL ab: nur die Website des Kunden, nie etwas anderes.
  if (!/^https?:\/\//i.test(url) || !gehoertZu(hostVonUrl(url), project.domain ?? ctx.domain))
    return fehler(400, "Der Artikel liegt nicht auf der Website dieses Kunden.");

  const { data: offene } = await SB.from("blog_articles")
    .select("id, status, job")
    .eq("project_id", project.id)
    .in("status", OFFEN);
  const schon = (offene ?? []).find((a: any) => {
    const u = originalVon(a);
    return !!u && normUrl(u) === normUrl(url);
  });
  if (schon)
    return fehler(409, "Für diesen Artikel gibt es bereits eine Überarbeitung.", {
      article: { id: schon.id },
    });
  const laufend = (offene ?? []).filter((a: any) => ["freigegeben", "schreibt"].includes(a.status));
  if (laufend.length >= MAX_PARALLEL)
    return fehler(429, "Es werden bereits Artikel geschrieben. Bitte kurz warten.");

  // Thema: die passende Chance aus dem letzten Audit, sonst das bekannte Keyword
  const { data: audit } = await SB.from("keyword_audits")
    .select("id")
    .eq("project_id", project.id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: opps } = audit
    ? await SB.from("keyword_opportunities")
        .select("id, keyword, category, impressions, covered_by_url")
        .eq("audit_id", audit.id)
    : { data: [] };
  const treffer = (opps ?? [])
    .filter(
      (o: any) =>
        o.covered_by_url &&
        o.category !== "aussortiert" &&
        normUrl(o.covered_by_url) === normUrl(url),
    )
    .sort(
      (a: any, b: any) =>
        Number(b.category === "fast_vorne") - Number(a.category === "fast_vorne") ||
        Number(b.impressions ?? 0) - Number(a.impressions ?? 0),
    )[0];
  const { data: items } = await SB.from("content_items")
    .select("target_url, title, primary_keyword")
    .eq("client_id", project.client_id)
    .eq("content_type", "blog")
    .eq("status", "published");
  const item = (items ?? []).find(
    (i: any) => i.target_url && normUrl(i.target_url) === normUrl(url),
  );
  const keyword = String(
    treffer?.keyword ||
      item?.primary_keyword ||
      artikel.focus_keyword ||
      artikel.title ||
      item?.title ||
      titelAusUrl(url),
  )
    .trim()
    .slice(0, 120);

  const jetzt = new Date().toISOString();
  const heute = datumZuerich();
  const { data: topic, error: tFehler } = await SB.from("blog_topics")
    .insert({
      project_id: project.id,
      client_id: project.client_id,
      keyword,
      kind: "refresh",
      opportunity_id: treffer?.id ?? null,
      approved_at: jetzt,
      approved_by: ctx.userId,
      scheduled_for: heute,
    })
    .select("*")
    .maybeSingle();
  if (tFehler || !topic) return fehler(500, "Speichern fehlgeschlagen");

  const { data: neu, error: aFehler } = await SB.from("blog_articles")
    .insert({
      project_id: project.id,
      client_id: project.client_id,
      topic_id: topic.id,
      status: "freigegeben",
      stage: "brief",
      focus_keyword: keyword,
      scheduled_for: heute,
      job: { trigger: "manuell", optimierung: { url, artikel_id: artikel.id } },
    })
    .select("id")
    .maybeSingle();
  if (aFehler || !neu) {
    // Thema zurücknehmen: sonst würde der Plan es ohne Bezug zum Original einreihen
    await SB.from("blog_topics")
      .update({ approved_at: null, scheduled_for: null })
      .eq("id", topic.id);
    return fehler(500, "Speichern fehlgeschlagen");
  }

  await blogEvent(
    project.id,
    "article.optimize_requested",
    { url, artikel_id: artikel.id, topic_id: topic.id },
    ctx.userId,
    neu.id,
  );
  return { status: 200, body: { ok: true, article: { id: neu.id } } };
}

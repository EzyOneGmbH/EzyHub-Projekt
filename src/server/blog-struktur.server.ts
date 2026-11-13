// Blog-Autopilot: «Themen-Autorität» und «Interne Verlinkung» im
// Blog-Dashboard. Themen: je Themen-Cluster, wie viele Artikel live und
// geplant sind und wie viele offene Chancen es noch gibt. Verlinkung: je
// Live-Artikel die internen Links im Text und die Links, die aus anderen
// Blog-Artikeln auf ihn zeigen. Gelesen werden nur Daten des eigenen Projekts,
// es wird nichts abgerufen und nichts verändert.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { eigeneUrl, urlSchluessel } from "@/server/blog-ki.server";

const SB = supabaseAdmin as any;
const MAX_LIVE = 60;
const MAX_VORSCHLAEGE = 2;
/** Ab so vielen Live-Artikeln gilt ein Thema als gut abgedeckt. */
export const THEMA_STARK = 3;

const schluessel = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

const woerter = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9äöüéèàç]+/)
      .filter((w) => w.length >= 4),
  );

/** Wie viele Wörter (ab 4 Zeichen) zwei Texte gemeinsam haben. Pure. */
export function gemeinsameWoerter(a: string, b: string): number {
  const x = woerter(a);
  return [...woerter(b)].filter((w) => x.has(w)).length;
}

/**
 * Interne Links eines Artikels: Ziele auf der eigenen Domain als
 * URL-Schlüssel, ohne Doppelte und ohne den Artikel selbst. Pure.
 */
export function interneLinks(html: unknown, artikelUrl: string, domain: string): string[] {
  const selbst = urlSchluessel(artikelUrl);
  const ziele = new Set<string>();
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!href) continue;
    let ziel = "";
    try {
      ziel = new URL(href, artikelUrl || undefined).toString();
    } catch {
      continue;
    }
    const k = urlSchluessel(ziel);
    if (k && k !== selbst && eigeneUrl(ziel, domain)) ziele.add(k);
  }
  return [...ziele];
}

type ThemaZeile = { name: string; live: number; geplant: number; chancen: number; stufe: string };

/** Themen-Cluster mit Artikeln und offenen Chancen zusammenführen. Pure. */
export function themenUebersicht(
  cluster: Array<{ name?: unknown }>,
  topics: Array<{ id: string; cluster?: unknown }>,
  artikel: Array<{ topic_id?: unknown; status?: unknown }>,
  chancen: Array<{ cluster?: unknown }>,
): { themen: ThemaZeile[]; ohneThema: { live: number; geplant: number } } {
  const zeilen = new Map<string, ThemaZeile>();
  const zeile = (name: unknown) => {
    const k = schluessel(name);
    if (!k) return null;
    if (!zeilen.has(k))
      zeilen.set(k, { name: String(name).trim(), live: 0, geplant: 0, chancen: 0, stufe: "leer" });
    return zeilen.get(k)!;
  };
  for (const c of cluster) zeile(c?.name);

  const ohneThema = { live: 0, geplant: 0 };
  const themaVon = new Map(topics.map((t) => [String(t.id), t.cluster]));
  const mitArtikel = new Set<string>();
  for (const a of artikel) {
    const tid = a.topic_id ? String(a.topic_id) : "";
    if (tid) mitArtikel.add(tid);
    const ziel = zeile(themaVon.get(tid)) ?? ohneThema;
    if (a.status === "live") ziel.live++;
    else ziel.geplant++;
  }
  // Freigegebene Themen, zu denen noch kein Artikel angelegt ist.
  for (const t of topics)
    if (!mitArtikel.has(String(t.id))) (zeile(t.cluster) ?? ohneThema).geplant++;
  for (const c of chancen) {
    const z = zeile(c.cluster);
    if (z) z.chancen++;
  }
  const themen = [...zeilen.values()].map((z) => ({
    ...z,
    stufe: z.live >= THEMA_STARK ? "stark" : z.live > 0 ? "aufbau" : "leer",
  }));
  return { themen, ohneThema };
}

/** Auswertung für das Blog-Dashboard. */
export async function strukturAuswertung(project: {
  id: string;
  client_id: string;
  domain?: string | null;
  internal_links?: number | null;
}): Promise<Record<string, unknown>> {
  const [{ data: ana }, { data: topics }, { data: alle }, { data: liveRoh }, { data: audit }] =
    await Promise.all([
      SB.from("blog_analysis_runs")
        .select("result")
        .eq("project_id", project.id)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      SB.from("blog_topics").select("id, cluster").eq("project_id", project.id).limit(2000),
      SB.from("blog_articles")
        .select("id, topic_id, status")
        .eq("project_id", project.id)
        .limit(2000),
      SB.from("blog_articles")
        .select("id, title, focus_keyword, wp_permalink, content_html, job")
        .eq("project_id", project.id)
        .eq("status", "live")
        .order("published_at", { ascending: false })
        .limit(MAX_LIVE),
      SB.from("keyword_audits")
        .select("id")
        .eq("project_id", project.id)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  let chancen: any[] = [];
  if (audit?.id) {
    const { data } = await SB.from("keyword_opportunities")
      .select("cluster, category, decision")
      .eq("project_id", project.id)
      .eq("audit_id", audit.id)
      .eq("decision", "offen")
      .limit(5000);
    chancen = (Array.isArray(data) ? data : []).filter(
      (c) => c.category === "neu" || c.category === "fast_vorne",
    );
  }
  const uebersicht = themenUebersicht(
    Array.isArray(ana?.result?.clusters) ? ana.result.clusters : [],
    Array.isArray(topics) ? topics : [],
    Array.isArray(alle) ? alle : [],
    chancen,
  );

  const roh = String(project.domain ?? "").trim();
  const domain = urlSchluessel(/^https?:\/\//i.test(roh) ? roh : `https://${roh}`).split("/")[0];
  const live = (Array.isArray(liveRoh) ? liveRoh : [])
    .map((a: any) => {
      const refresh = a.job?.modus === "refresh";
      const url = String((refresh && a.job?.brief?.original_url) || a.wp_permalink || "");
      return {
        id: String(a.id),
        titel: String(a.title || a.focus_keyword || "Ohne Titel"),
        text: `${a.title ?? ""} ${a.focus_keyword ?? ""}`,
        key: urlSchluessel(url),
        ziele: domain ? interneLinks(a.content_html, url, domain) : [],
      };
    })
    .filter((a) => a.key);

  const artikel = live.map((a) => {
    const quellen = live.filter((b) => b.id !== a.id && b.ziele.includes(a.key));
    const vorschlaege =
      quellen.length > 0
        ? []
        : live
            .filter((b) => b.id !== a.id)
            .map((b) => ({ id: b.id, titel: b.titel, n: gemeinsameWoerter(a.text, b.text) }))
            .filter((b) => b.n > 0)
            .sort((x, y) => y.n - x.n)
            .slice(0, MAX_VORSCHLAEGE)
            .map(({ id, titel }) => ({ id, titel }));
    return {
      id: a.id,
      titel: a.titel,
      ausgehend: a.ziele.length,
      eingehend: quellen.length,
      vorschlaege,
    };
  });

  return {
    ...uebersicht,
    stark: THEMA_STARK,
    links: { ziel: Number(project.internal_links ?? 3), artikel },
  };
}

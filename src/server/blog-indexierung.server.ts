// Blog-Autopilot: Live-Artikel bei den Suchmaschinen melden.
// IndexNow (Bing, Yandex, Seznam, Naver) läuft über das WordPress-Plugin, weil
// die Schlüsseldatei auf der Kunden-Domain liegen muss. Google nimmt nicht an
// IndexNow teil: dort wird die Sitemap in der Search Console neu eingereicht.
// Eine Meldung ist eine Bitte, keine Garantie. Nichts hier wirft: Ein Fehler
// darf das Veröffentlichen nie aufhalten.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent } from "@/server/blog-autopilot.server";
import { PLUGIN_LIVE, versionAb } from "@/server/blog-pipeline.server";
import { ezrRequest } from "@/server/ezyrank-wp.server";

const SB = supabaseAdmin as any;
const GSC = "https://searchconsole.googleapis.com";
const MAX_SITEMAPS = 2;

export type IndexTeil = { ok: boolean; grund?: string; status?: number; sitemaps?: string[] };
export type Indexierung = {
  at: string;
  url: string;
  indexnow: IndexTeil;
  google: IndexTeil;
  pruefung?: {
    at: string;
    verdict: string | null;
    coverageState: string | null;
    lastCrawlTime: string | null;
  };
};
type WpZugang = {
  conn: { siteUrl: string; key: string };
  plugin_version?: string | null;
  scopes?: string[];
} | null;

const kurz = (s: unknown): string => String(s ?? "").slice(0, 160);

/** Antwort des Plugins ({ ok, status, error? }) in unsere Form bringen. Pure. */
export function ausPlugin(roh: any): IndexTeil {
  if (!roh || typeof roh !== "object")
    return { ok: false, grund: "Keine Rückmeldung von WordPress" };
  return roh.ok
    ? { ok: true, status: Number(roh.status) || 200 }
    : {
        ok: false,
        status: Number(roh.status) || 0,
        grund: kurz(roh.error || "IndexNow hat abgelehnt"),
      };
}

/** Sitemap-Zeilen aus einer robots.txt lesen (dedupliziert). Pure. */
export function sitemapsAusRobots(txt: string): string[] {
  const out: string[] = [];
  for (const zeile of String(txt || "").split(/\r?\n/)) {
    const m = zeile.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m && /^https?:\/\//i.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

async function indexnowUeberPlugin(wp: WpZugang, postId: number | null): Promise<IndexTeil> {
  if (!wp || !postId) return { ok: false, grund: "Kein WordPress-Beitrag verbunden" };
  if (!versionAb(wp.plugin_version, PLUGIN_LIVE))
    return { ok: false, grund: `Plugin ab Version ${PLUGIN_LIVE} nötig` };
  if (wp.scopes && !wp.scopes.includes("publish"))
    return { ok: false, grund: "«Veröffentlichen» ist im Plugin nicht erlaubt" };
  try {
    const r = await ezrRequest<any>(wp.conn, "POST", `/posts/${postId}/indexnow`, {});
    if (!r) return { ok: false, grund: "Keine Rückmeldung von WordPress" };
    return r.ok ? ausPlugin(r.data?.indexnow) : { ok: false, grund: kurz(r.message) };
  } catch (e) {
    return {
      ok: false,
      grund: kurz(e instanceof Error ? e.message : "WordPress nicht erreichbar"),
    };
  }
}

async function googleZugang(
  clientId: string | null | undefined,
): Promise<{ token: string; property: string } | { grund: string }> {
  if (!clientId) return { grund: "Search Console ist nicht verbunden" };
  try {
    const { data } = await SB.from("clients")
      .select("gsc_property")
      .eq("id", clientId)
      .maybeSingle();
    const property = data?.gsc_property ? String(data.gsc_property) : "";
    if (!property) return { grund: "Search Console ist nicht verbunden" };
    const { getGoogleAccessToken } = await import("@/server/google-tokens.server");
    const { accessToken } = await getGoogleAccessToken(clientId);
    return { token: accessToken, property };
  } catch {
    return { grund: "Google-Zugang ist abgelaufen oder fehlt" };
  }
}

/** Sitemap in der Search Console neu einreichen: Google holt sie danach frisch ab. */
async function meldeGoogle(clientId: string | null | undefined, url: string): Promise<IndexTeil> {
  const z = await googleZugang(clientId);
  if ("grund" in z) return { ok: false, grund: z.grund };
  try {
    const basis = `${GSC}/webmasters/v3/sites/${encodeURIComponent(z.property)}/sitemaps`;
    const kopf = { Authorization: `Bearer ${z.token}` };
    let liste: string[] = [];
    const r = await fetch(basis, { headers: kopf, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j: any = await r.json().catch(() => ({}));
      liste = (j?.sitemap ?? []).map((s: any) => String(s?.path || "")).filter(Boolean);
    } else if (r.status === 401 || r.status === 403) {
      return { ok: false, status: r.status, grund: "Google-Zugriff auf die Property fehlt" };
    }
    if (!liste.length) {
      // Noch nichts eingereicht: die Website nennt ihre Sitemap in der robots.txt.
      const origin = new URL(url).origin;
      try {
        const rb = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
        if (rb.ok) liste = sitemapsAusRobots(await rb.text());
      } catch {
        /* robots.txt ist optional */
      }
      if (!liste.length) liste = [`${origin}/wp-sitemap.xml`];
    }
    const gemeldet: string[] = [];
    let grund = "";
    for (const sm of liste.slice(0, MAX_SITEMAPS)) {
      const p = await fetch(`${basis}/${encodeURIComponent(sm)}`, {
        method: "PUT",
        headers: kopf,
        signal: AbortSignal.timeout(8000),
      });
      if (p.ok) gemeldet.push(sm);
      else if (p.status === 403)
        grund = "Google-Verbindung hat nur Lesezugriff: bitte neu verbinden";
      else if (!grund) grund = `Search Console meldet HTTP ${p.status}`;
    }
    return gemeldet.length
      ? { ok: true, sitemaps: gemeldet }
      : { ok: false, grund: grund || "Keine Sitemap gefunden" };
  } catch {
    return { ok: false, grund: "Search Console nicht erreichbar" };
  }
}

async function speichere(articleId: string, indexierung: Indexierung): Promise<void> {
  try {
    const { data } = await SB.from("blog_articles").select("job").eq("id", articleId).maybeSingle();
    await SB.from("blog_articles")
      .update({ job: { ...(data?.job ?? {}), indexierung } })
      .eq("id", articleId);
  } catch {
    /* Anzeige fehlt dann, die Meldung selbst ist draussen */
  }
}

/**
 * Live-URL melden und das Ergebnis am Artikel ablegen (job.indexierung).
 * `indexnow`: Ergebnis, das das Plugin beim Veröffentlichen schon mitgeliefert
 * hat; fehlt es, fragt der Hub das Plugin (ab 2.1.0).
 */
export async function meldeIndexierung(o: {
  article: any;
  project: any;
  url: string | null | undefined;
  wp?: WpZugang;
  postId?: number | null;
  indexnow?: unknown;
  actor: string | null;
}): Promise<Indexierung | null> {
  try {
    const url = String(o.url || "");
    if (!/^https?:\/\//i.test(url)) return null;
    const indexnow =
      o.indexnow !== undefined
        ? ausPlugin(o.indexnow)
        : await indexnowUeberPlugin(o.wp ?? null, o.postId ?? null);
    const google = await meldeGoogle(o.project?.client_id, url);
    const indexierung: Indexierung = { at: new Date().toISOString(), url, indexnow, google };
    await speichere(o.article.id, indexierung);
    if (indexnow.ok || google.ok)
      await blogEvent(
        o.article.project_id,
        "article.index_requested",
        { url, indexnow: indexnow.ok, google: google.ok },
        o.actor,
        o.article.id,
      );
    return indexierung;
  } catch {
    return null;
  }
}

/** Bei Google nachsehen, ob die URL im Index ist (URL-Prüfung der Search Console). */
export async function pruefeIndexierung(o: {
  article: any;
  project: any;
  url: string;
}): Promise<{ indexierung: Indexierung } | { grund: string }> {
  const z = await googleZugang(o.project?.client_id);
  if ("grund" in z) return { grund: z.grund };
  try {
    const r = await fetch(`${GSC}/v1/urlInspection/index:inspect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${z.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: o.url, siteUrl: z.property, languageCode: "de-CH" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok)
      return {
        grund:
          r.status === 403
            ? "Google-Zugriff auf die Property fehlt"
            : r.status === 429
              ? "Das Tageslimit der Google-Prüfung ist erreicht"
              : `Search Console meldet HTTP ${r.status}`,
      };
    const j: any = await r.json().catch(() => ({}));
    const s = j?.inspectionResult?.indexStatusResult ?? {};
    const alt: Partial<Indexierung> = o.article.job?.indexierung ?? {};
    const indexierung: Indexierung = {
      at: alt.at ?? "",
      url: o.url,
      indexnow: alt.indexnow ?? { ok: false, grund: "Noch nicht gemeldet" },
      google: alt.google ?? { ok: false, grund: "Noch nicht gemeldet" },
      pruefung: {
        at: new Date().toISOString(),
        verdict: s.verdict ? String(s.verdict) : null,
        coverageState: s.coverageState ? String(s.coverageState) : null,
        lastCrawlTime: s.lastCrawlTime ? String(s.lastCrawlTime) : null,
      },
    };
    await speichere(o.article.id, indexierung);
    return { indexierung };
  } catch {
    return { grund: "Search Console nicht erreichbar" };
  }
}

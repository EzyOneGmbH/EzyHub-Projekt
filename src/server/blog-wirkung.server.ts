// Blog-Autopilot: «Wirkung je Artikel» im Blog-Dashboard. Für jeden
// Live-Artikel die Werte der Search Console in den ersten Tagen nach dem
// Live-Gang; bei Überarbeitungen zusätzlich gleich viele Tage davor, damit
// sichtbar wird, was die Überarbeitung gebracht hat. Abgefragt wird nur die
// Property des Kunden und nur Seiten seiner eigenen Domain.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hostVon } from "@/server/blog-google.server";
import { eigeneUrl } from "@/server/blog-ki.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { GSC_END_LAG_DAYS, gscTotals } from "@/server/gsc.server";

const SB = supabaseAdmin as any;
export const WIRKUNG_TAGE = 28;
const MAX_ARTIKEL = 12;
const GLEICHZEITIG = 4;
const TAG = 86_400_000;

type Zeitraum = { startDate: string; endDate: string };
type Werte = { clicks: number; impressions: number; ctr: number; position: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (tag: string, n: number) => iso(new Date(Date.parse(`${tag}T00:00:00Z`) + n * TAG));

/**
 * Zeiträume nach und vor dem Live-Gang. Gemessen werden höchstens
 * WIRKUNG_TAGE Tage ab dem Live-Tag, davor gleich viele Tage. Liegen noch
 * keine Daten vor (Google liefert mit Verzug), null. Pure.
 */
export function wirkungFenster(
  liveSeit: unknown,
  heute: Date,
): { tage: number; nach: Zeitraum; vor: Zeitraum } | null {
  const t = Date.parse(String(liveSeit ?? ""));
  if (!Number.isFinite(t)) return null;
  const start = iso(new Date(t));
  const letzter = iso(new Date(heute.getTime() - GSC_END_LAG_DAYS * TAG));
  const volles = plus(start, WIRKUNG_TAGE - 1);
  const ende = volles < letzter ? volles : letzter;
  if (ende < start) return null;
  const tage = Math.round((Date.parse(ende) - Date.parse(start)) / TAG) + 1;
  return {
    tage,
    nach: { startDate: start, endDate: ende },
    vor: { startDate: plus(start, -tage), endDate: plus(start, -1) },
  };
}

/**
 * Regulärer Ausdruck für genau diese Seite: http oder https, mit oder ohne
 * www., mit oder ohne Schrägstrich am Ende. Ohne gültige URL: "". Pure.
 */
export function seitenMuster(raw: unknown): string {
  try {
    const u = new URL(String(raw ?? ""));
    if (!/^https?:$/.test(u.protocol)) return "";
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `^https?://(www\\.)?${esc(host)}${esc(u.pathname.replace(/\/+$/, ""))}/?$`;
  } catch {
    return "";
  }
}

const kurz = (t: Werte): Werte => ({
  clicks: t.clicks,
  impressions: t.impressions,
  ctr: t.ctr,
  position: t.position,
});

/** Auswertung für das Blog-Dashboard. Ohne Search Console: { verbunden: false }. */
export async function wirkungAuswertung(
  project: { id: string; client_id: string },
  heute: Date = new Date(),
): Promise<Record<string, unknown>> {
  const clientId = project.client_id;
  const { data: kunde } = await SB.from("clients")
    .select("gsc_property")
    .eq("id", clientId)
    .maybeSingle();
  const site = String(kunde?.gsc_property ?? "");
  const host = hostVon(site);
  if (!site || !host) return { verbunden: false };

  const { data: roh } = await SB.from("blog_articles")
    .select("id, title, focus_keyword, wp_permalink, published_at, job")
    .eq("project_id", project.id)
    .eq("status", "live")
    .order("published_at", { ascending: false })
    .limit(MAX_ARTIKEL);
  const live: any[] = (Array.isArray(roh) ? roh : []).filter((a) => a.published_at);
  if (!live.length) return { verbunden: true, tage: WIRKUNG_TAGE, artikel: [] };

  let accessToken: string;
  try {
    ({ accessToken } = await getGoogleAccessToken(clientId));
  } catch {
    return { verbunden: false };
  }

  const eine = async (a: any) => {
    const refresh = a.job?.modus === "refresh";
    const url = String((refresh && a.job?.brief?.original_url) || a.wp_permalink || "");
    const zeile = {
      id: String(a.id),
      titel: String(a.title || a.focus_keyword || "Ohne Titel"),
      modus: refresh ? "refresh" : "neu",
      liveSeit: a.published_at as string,
      tage: 0,
      nach: null as Werte | null,
      vor: null as Werte | null,
      grund: null as "frisch" | "url" | "fehler" | null,
    };
    const muster = eigeneUrl(url, host) ? seitenMuster(url) : "";
    if (!muster) return { ...zeile, grund: "url" as const };
    const f = wirkungFenster(a.published_at, heute);
    if (!f) return { ...zeile, grund: "frisch" as const };
    const basis = {
      site,
      accessToken,
      timeoutMs: 20_000,
      filter: {
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: "page" as const,
                operator: "includingRegex" as const,
                expression: muster,
              },
            ],
          },
        ],
      },
    };
    try {
      const [nach, vor] = await Promise.all([
        gscTotals({ ...basis, ...f.nach }),
        refresh ? gscTotals({ ...basis, ...f.vor }) : null,
      ]);
      return { ...zeile, tage: f.tage, nach: kurz(nach), vor: vor ? kurz(vor) : null };
    } catch {
      // Keine Google-Fehlertexte nach aussen (können Property-Namen enthalten).
      return { ...zeile, tage: f.tage, grund: "fehler" as const };
    }
  };

  const artikel: Awaited<ReturnType<typeof eine>>[] = [];
  for (let i = 0; i < live.length; i += GLEICHZEITIG)
    artikel.push(...(await Promise.all(live.slice(i, i + GLEICHZEITIG).map(eine))));
  return { verbunden: true, tage: WIRKUNG_TAGE, artikel };
}

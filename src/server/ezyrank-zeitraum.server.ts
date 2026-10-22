// EzyRank-Dashboard: Stand eines Zeitraums (22.10.2026, Abgleich mit dem
// SEO-Report-Endpoint). Gleiche Funktionen wie /api/admin/seo-report:
//   Rankings      letzte DataForSEO-Messung (pos_src crawl) bis Zeitraum-Ende
//                 (letzterMesstagIm, positionenAm, verteilungAusRankDaily)
//   GSC je KW     Suchanfragen des Zeitraums (gscPeriode) — Ø-Position nur als
//                 eigene Spalte, nie als Ranking
//   Brand-Split   brand_regex aus seo_report_config, Rückfall clients.brand_terms
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  brandErkenner,
  brandRegexFuer,
  brandWidget,
  gscJeQueryVoll,
  hauptmessung,
  istDfsZeile,
  letzterMesstagIm,
  positionenAm,
  verteilungAusRankDaily,
  volumenJeKeyword,
  type GscZeile,
  type RankZeile,
} from "@/lib/seoReport";
import { googleToken, gscPeriode, ladeRankTage, ladeRankZeilen } from "./seo-report-quellen.server";

/** GSC-Daten sind erst nach ~3 Tagen vollständig (wie Report und gsc-import). */
const GSC_VERZUG_TAGE = 3;
/** Fenster, in dem die letzte Messung vor dem Zeitraum-Ende gesucht wird. */
const MESS_FENSTER_TAGE = 30;
/** Non-Brand-Suchanfragen ohne Tracking, die als Zusatzzeilen geliefert werden. */
const GSC_ZUSATZ_MAX = 1000;

const minusTage = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const kleiner = (a: string, b: string) => (a < b ? a : b);

export type ZeitraumQuellen = {
  rankZeilen: (von: string, bis: string) => Promise<RankZeile[]>;
  rankTage: (tage: string[]) => Promise<RankZeile[]>;
  googleToken: () => Promise<string | null>;
  gscZeilen: (token: string, von: string, bis: string) => Promise<GscZeile[]>;
};

export type ZeitraumKunde = { id: string; gsc_property: string | null; brand_regex: string | null };

export async function ladeZeitraumKunde(clientId: string): Promise<ZeitraumKunde | null> {
  const sb = supabaseAdmin as any;
  const [{ data: c }, { data: k }] = await Promise.all([
    sb.from("clients").select("id, gsc_property, brand_terms").eq("id", clientId).maybeSingle(),
    sb.from("seo_report_config").select("brand_regex").eq("client_id", clientId).maybeSingle(),
  ]);
  if (!c) return null;
  return { id: c.id, gsc_property: c.gsc_property || null, brand_regex: brandRegexFuer(c, k) };
}

export function echteZeitraumQuellen(k: ZeitraumKunde): ZeitraumQuellen {
  return {
    rankZeilen: (von, bis) => ladeRankZeilen(k.id, von, bis),
    rankTage: (tage) => ladeRankTage(k.id, tage),
    googleToken: () => googleToken(k.id),
    gscZeilen: async (t, von, bis) =>
      (await gscPeriode(String(k.gsc_property), t, von, bis)).queries,
  };
}

/** Letzter Messtag bis `bis` (Fenster: Zeitraum, mindestens 30 Tage). */
function messtagBis(zeilen: RankZeile[], bis: string, von?: string | null): string | null {
  const fensterVon = kleiner(von || bis, minusTage(bis, MESS_FENSTER_TAGE));
  return letzterMesstagIm(zeilen, fensterVon, bis);
}

export async function berechneZeitraumStand(
  k: ZeitraumKunde,
  zr: { von: string; bis: string; vergleichBis: string | null; heute: string },
  q: ZeitraumQuellen,
) {
  const errors: Array<{ source: string; message: string }> = [];
  const fehler = (source: string, e: unknown) =>
    errors.push({ source, message: String((e as Error)?.message || e).slice(0, 160) });
  const istBrand = brandErkenner(k.brand_regex);

  // ── Rankings: letzte DataForSEO-Messung bis Zeitraum-Ende ─────────────────
  const ladeVon = minusTage(kleiner(zr.von, minusTage(zr.bis, MESS_FENSTER_TAGE)), 60);
  let zeilen: RankZeile[] = [];
  try {
    zeilen = await q.rankZeilen(ladeVon, zr.bis);
  } catch (e) {
    fehler("rank_daily", e);
  }
  const messtag = messtagBis(zeilen, zr.bis, zr.von);
  const tag7 = messtag ? messtagBis(zeilen, minusTage(messtag, 7)) : null;
  const tag28 = messtag ? messtagBis(zeilen, minusTage(messtag, 28)) : null;
  let vergleichTag: string | null = null;
  if (zr.vergleichBis) {
    try {
      const vz =
        zr.vergleichBis >= ladeVon
          ? zeilen
          : await q.rankZeilen(minusTage(zr.vergleichBis, MESS_FENSTER_TAGE), zr.vergleichBis);
      vergleichTag = messtagBis(vz, zr.vergleichBis);
    } catch (e) {
      fehler("rank_daily", e);
    }
  }
  if (vergleichTag && vergleichTag === messtag) vergleichTag = null; // kein Delta gegen sich selbst

  let tagesZeilen: RankZeile[] = [];
  const tage = [messtag, vergleichTag].filter((t): t is string => !!t);
  if (tage.length) {
    try {
      tagesZeilen = await q.rankTage(tage);
    } catch (e) {
      fehler("rank_daily", e);
    }
  }

  // ── GSC des Zeitraums ──────────────────────────────────────────────────────
  const gscBis = kleiner(zr.bis, minusTage(zr.heute, GSC_VERZUG_TAGE));
  let gscRows: GscZeile[] | null = null;
  if (k.gsc_property && zr.von <= gscBis) {
    try {
      const token = await q.googleToken();
      if (token) gscRows = await q.gscZeilen(token, zr.von, gscBis);
      else errors.push({ source: "gsc", message: "Google nicht verbunden" });
    } catch (e) {
      fehler("gsc", e);
    }
  }
  const gscMap = gscRows ? gscJeQueryVoll(gscRows) : null;

  // ── Keyword-Zeilen: alle am Messtag getrackten Keywords ────────────────────
  const aktuell = positionenAm(zeilen, messtag);
  const p7 = positionenAm(zeilen, tag7);
  const p28 = positionenAm(zeilen, tag28);
  const volumen = volumenJeKeyword([...zeilen, ...tagesZeilen]);
  const getrackt = new Map<string, string>();
  for (const r of hauptmessung(tagesZeilen.filter((z) => z.date === messtag)))
    getrackt.set(r.keyword.trim().toLowerCase(), r.keyword);
  const urlAmTag = new Map<string, string | null>();
  for (const r of tagesZeilen)
    if (r.date === messtag && istDfsZeile(r)) urlAmTag.set(r.keyword.trim().toLowerCase(), r.url);
  const keywords = [...getrackt].map(([kl, kw]) => {
    const g = gscMap?.get(kl) ?? null;
    return {
      kw,
      position: aktuell.get(kl)?.position ?? null,
      url: aktuell.get(kl)?.url ?? urlAmTag.get(kl) ?? null,
      volume: volumen.get(kl) ?? null,
      posPrev7: p7.get(kl)?.position ?? null,
      posPrev28: p28.get(kl)?.position ?? null,
      gsc: g,
    };
  });
  const gscNur = gscMap
    ? [...gscMap]
        .filter(([kl, g]) => !getrackt.has(kl) && !istBrand(kl) && g.impressions >= 10)
        .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
        .slice(0, GSC_ZUSATZ_MAX)
        .map(([query, g]) => ({ query, ...g }))
    : [];

  return {
    ok: true as const,
    period: { from: zr.von, to: zr.bis },
    rankings: {
      measured_on: messtag,
      compare_measured_on: vergleichTag,
      prev7_measured_on: tag7,
      prev28_measured_on: tag28,
      distribution: {
        current: verteilungAusRankDaily(tagesZeilen, messtag),
        previous: verteilungAusRankDaily(tagesZeilen, vergleichTag),
      },
      keywords,
    },
    gsc: gscRows
      ? {
          range: { from: zr.von, to: gscBis },
          brand_regex: k.brand_regex,
          ...brandWidget(gscRows, istBrand),
          queries_untracked: gscNur,
        }
      : null,
    errors,
  };
}

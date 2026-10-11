// Stündlicher Gratis-Takt EzyRank (Volkan 11.10.2026: «bei EzyRank alles was
// nichts kostet ebenfalls stündlich aktualisieren»).
// Kostenlose Quellen: Search Console, GA4, PageSpeed (Google-APIs ohne Gebühr).
// Kostenpflichtig und deshalb NICHT hier: Ahrefs/Sistrix (Sichtbarkeit,
// Backlinks), DataForSEO (Rankings-Vollcrawl). Die wöchentliche
// DFS-Volumenanreicherung in gsc_queries hat einen eigenen 6.5-Tage-Schutz.
// Ablauf: pg_cron ruft alle 5 Minuten; je Aufruf werden die am längsten nicht
// aktualisierten Kunden nacheinander über /api/admin/populate (ersetzeHeute =
// eine Zeile pro Tag, laufend aktualisiert) bedient, bis das Zeitbudget voll
// ist. So ist jeder Kunde etwa stündlich dran, ohne Lastspitze.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const GRATIS_SEO_JOBS = ["gsc", "gsc_queries", "pagespeed", "seo_history"] as const;
export const GRATIS_GA4_JOBS = ["ga4", "ga4_traffic", "ga4_conversions"] as const;
// «Zuletzt bearbeitet» = Protokollzeile populate_meta: sie entsteht bei JEDEM
// Versuch (auch wenn Google gerade nicht antwortet) — sonst würde ein Kunde ohne
// funktionierende Verbindung alle 5 Minuten erneut drankommen.
const LEITTYP = ["populate_meta"];
export const MIN_ABSTAND_MS = 50 * 60 * 1000;
const ZEITBUDGET_MS = 230_000;

type Kunde = {
  id: string;
  name: string;
  domain: string | null;
  gsc_property: string | null;
  ga4_property: string | null;
};

/** Welche Gratis-Jobs ein Kunde bekommt (App-Freischaltung wie im Sammellauf). */
export function gratisJobsFuer(k: Kunde, appsAus: Set<string>): string[] {
  const jobs: string[] = [];
  if (!appsAus.has("seo")) {
    if (k.gsc_property) jobs.push("gsc", "gsc_queries");
    if (k.domain) jobs.push("pagespeed");
    if (k.gsc_property || k.ga4_property) jobs.push("seo_history");
  }
  if (k.ga4_property && !(appsAus.has("seo") && appsAus.has("geo"))) jobs.push(...GRATIS_GA4_JOBS);
  return jobs;
}

/** Reihenfolge: am längsten nicht aktualisiert zuerst; frisch (< 50 min) raus. */
export function reihenfolge(
  kunden: Array<{ id: string; jobs: string[] }>,
  zuletzt: Map<string, number>,
  jetzt = Date.now(),
): string[] {
  return kunden
    .filter((k) => k.jobs.length > 0)
    .filter((k) => jetzt - (zuletzt.get(k.id) ?? 0) >= MIN_ABSTAND_MS)
    .sort((a, b) => (zuletzt.get(a.id) ?? 0) - (zuletzt.get(b.id) ?? 0))
    .map((k) => k.id);
}

export async function gratisTakt(origin: string, secret: string) {
  const t0 = Date.now();
  const sb = supabaseAdmin as any;
  const [{ data: kunden }, { data: zugriff }, { data: laeufe }] = await Promise.all([
    sb.from("clients").select("id, name, domain, gsc_property, ga4_property"),
    sb.from("client_app_access").select("client_id, app, enabled"),
    sb
      .from("audit_runs")
      .select("client_id, created_at")
      .in("audit_type", LEITTYP)
      .eq("status", "succeeded")
      .gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString()),
  ]);
  const aus = new Map<string, Set<string>>();
  for (const z of zugriff ?? [])
    if (z.enabled === false) {
      if (!aus.has(z.client_id)) aus.set(z.client_id, new Set());
      aus.get(z.client_id)!.add(String(z.app));
    }
  const zuletzt = new Map<string, number>();
  for (const l of laeufe ?? []) {
    const t = Date.parse(l.created_at);
    if (t > (zuletzt.get(l.client_id) ?? 0)) zuletzt.set(l.client_id, t);
  }
  const mitJobs = (kunden ?? []).map((k: Kunde) => ({
    id: k.id,
    jobs: gratisJobsFuer(k, aus.get(k.id) ?? new Set()),
  }));
  const jobsVon = new Map(mitJobs.map((k: { id: string; jobs: string[] }) => [k.id, k.jobs]));
  const warteschlange = reihenfolge(mitJobs, zuletzt);

  const erledigt: string[] = [];
  let fehler = 0;
  for (const id of warteschlange) {
    if (Date.now() - t0 > ZEITBUDGET_MS) break;
    try {
      const r = await fetch(`${origin}/api/admin/populate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          client: id,
          jobs: jobsVon.get(id),
          ersetzeHeute: true,
          minIntervalHours: 0.8,
          days: 28,
        }),
        signal: AbortSignal.timeout(Math.max(10_000, ZEITBUDGET_MS - (Date.now() - t0))),
      });
      if (r.ok) erledigt.push(id);
      else fehler++;
    } catch {
      fehler++;
    }
  }
  return {
    kunden: (kunden ?? []).length,
    faellig: warteschlange.length,
    erledigt: erledigt.length,
    fehler,
    ms: Date.now() - t0,
  };
}

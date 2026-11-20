// EzyBrain-Spiegel (20.11.2026): lädt die Daten eines Kunden für brain-export.ts.
// Nur lesend. Es werden ausschliesslich die unten genannten Spalten geholt: keine
// Zugangsdaten, keine Property-IDs, keine Roh-Ereignisse der Attribution und keine
// Personendaten aus dem Conversion-Log.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { baueBrainSeiten, type BrainDaten, type BrainSeite } from "./brain-export";

const sb = (): any => supabaseAdmin as any;

const AUDIT_TYPEN = [
  "gsc_summary",
  "gsc_queries",
  "ga4_summary",
  "ga4_traffic",
  "ga4_conversions",
  "ahrefs",
  "google_ads",
  "pagespeed",
];

async function zeilen(q: PromiseLike<{ data: any; error: any }>): Promise<Record<string, any>[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, any>[];
}

const tagMinus = (ymd: string, tage: number): string => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - tage);
  return d.toISOString().slice(0, 10);
};

export async function ladeBrainDaten(clientId: string): Promise<BrainDaten | null> {
  const { data: client, error } = await sb()
    .from("clients")
    .select("id, name, domain")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!client) return null;

  const audits: BrainDaten["audits"] = {};
  const auditLauf = Promise.all(
    AUDIT_TYPEN.map(async (t) => {
      const r = await zeilen(
        sb()
          .from("audit_runs")
          .select("result, finished_at")
          .eq("client_id", clientId)
          .eq("audit_type", t)
          .eq("status", "succeeded")
          .order("created_at", { ascending: false })
          .limit(1),
      );
      if (r[0]?.result && typeof r[0].result === "object")
        audits[t] = { result: r[0].result, finished_at: r[0].finished_at ?? null };
    }),
  );

  const rankLauf = (async () => {
    const neu = await zeilen(
      sb()
        .from("rank_daily")
        .select("date")
        .eq("client_id", clientId)
        .order("date", { ascending: false })
        .limit(1),
    );
    const rankDatum: string | null = neu[0]?.date ?? null;
    if (!rankDatum) return { rankDatum, rank: [], rankVorDatum: null, rankVor: [] };
    const felder = "keyword, position, url, search_volume, is_money";
    const vor = await zeilen(
      sb()
        .from("rank_daily")
        .select("date")
        .eq("client_id", clientId)
        .lte("date", tagMinus(rankDatum, 28))
        .order("date", { ascending: false })
        .limit(1),
    );
    const rankVorDatum: string | null = vor[0]?.date ?? null;
    const [rank, rankVor] = await Promise.all([
      zeilen(
        sb()
          .from("rank_daily")
          .select(felder)
          .eq("client_id", clientId)
          .eq("date", rankDatum)
          .limit(1000),
      ),
      rankVorDatum
        ? zeilen(
            sb()
              .from("rank_daily")
              .select("keyword, position")
              .eq("client_id", clientId)
              .eq("date", rankVorDatum)
              .limit(1000),
          )
        : Promise.resolve([]),
    ]);
    return { rankDatum, rank, rankVorDatum, rankVor };
  })();

  const kiLauf = (async () => {
    const aivReports = await zeilen(
      sb()
        .from("ai_visibility_reports")
        .select(
          "id, market, snapshot_date, score, score_delta, mentions, citations, cited_pages, created_at",
        )
        .eq("client_id", clientId)
        .order("snapshot_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(120),
    );
    const ids: string[] = [];
    const gesehen = new Set<string>();
    for (const r of aivReports) {
      const k = String(r.market ?? "");
      if (gesehen.has(k)) continue;
      gesehen.add(k);
      if (ids.length < 6) ids.push(String(r.id));
    }
    if (!ids.length)
      return { aivReports, aivModels: [], aivSov: [], aivSources: [], aivAttribution: [] };
    const [aivModels, aivSov, aivSources, aivAttribution] = await Promise.all([
      zeilen(
        sb()
          .from("ai_visibility_models")
          .select("report_id, model_name, mentions, sov")
          .in("report_id", ids)
          .limit(500),
      ),
      zeilen(
        sb()
          .from("ai_visibility_sov")
          .select("report_id, brand, is_self, mentions, share")
          .in("report_id", ids)
          .limit(500),
      ),
      zeilen(
        sb()
          .from("ai_visibility_sources")
          .select("report_id, domain, mentions, share")
          .in("report_id", ids)
          .order("mentions", { ascending: false })
          .limit(300),
      ),
      // Bewusst ohne events/visitors.
      zeilen(
        sb()
          .from("ai_visibility_attribution")
          .select("report_id, engine, sessions, conversions")
          .in("report_id", ids)
          .limit(200),
      ),
    ]);
    return { aivReports, aivModels, aivSov, aivSources, aivAttribution };
  })();

  const mitClient = (tabelle: string, spalten: string) =>
    sb().from(tabelle).select(spalten).eq("client_id", clientId);

  const [
    ,
    rank,
    ki,
    opportunities,
    convEvents,
    convValues,
    convLabels,
    convLog,
    aivCompetitors,
    blogTopics,
    blogArticles,
    contentItems,
    siteHealth,
    facts,
  ] = await Promise.all([
    auditLauf,
    rankLauf,
    kiLauf,
    zeilen(
      mitClient(
        "keyword_opportunities",
        "keyword, category, decision, volume, difficulty, avg_position, cluster",
      )
        .order("volume", { ascending: false, nullsFirst: false })
        .limit(300),
    ),
    zeilen(mitClient("client_conversion_events", "event_name, modus").limit(200)),
    zeilen(mitClient("client_conversion_values", "event_name, value, currency").limit(200)),
    zeilen(mitClient("client_event_labels", "event_name, label").limit(200)),
    // Nur das Datum: Firma, Person, Telefon und E-Mail werden nicht geladen.
    zeilen(mitClient("conversion_log", "datum").order("datum", { ascending: false }).limit(1000)),
    zeilen(mitClient("ai_visibility_competitors", "name, active").limit(100)),
    zeilen(
      mitClient(
        "blog_topics",
        "title, keyword, cluster, article_type, volume, scheduled_for, approved_at",
      )
        .order("scheduled_for", { ascending: true, nullsFirst: false })
        .limit(200),
    ),
    zeilen(
      mitClient(
        "blog_articles",
        "title, status, focus_keyword, word_count, published_at, wp_permalink, created_at",
      )
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    zeilen(
      mitClient(
        "content_items",
        "title, content_type, primary_keyword, keyword_volume, published_at, index_verdict, target_url",
      )
        .in("content_type", ["blog", "win", "report"])
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(200),
    ),
    zeilen(
      mitClient("site_health_audits", "at, url, scores").order("at", { ascending: false }).limit(1),
    ),
    zeilen(
      mitClient("client_facts", "label, value, verified_at, created_at")
        .order("created_at", { ascending: true })
        .limit(200),
    ),
  ]);

  return {
    client: { id: String(client.id), name: String(client.name ?? ""), domain: client.domain },
    audits,
    ...rank,
    ...ki,
    opportunities,
    convEvents,
    convValues,
    convLabels,
    convLogDaten: convLog.map((r) => String(r.datum ?? "")).filter(Boolean),
    aivCompetitors,
    blogTopics,
    blogArticles,
    contentItems,
    siteHealth: siteHealth[0] ?? null,
    facts,
  };
}

export async function brainSeitenFuerKunde(
  clientId: string,
  stand = new Date().toISOString(),
): Promise<{ name: string; seiten: BrainSeite[] } | null> {
  const d = await ladeBrainDaten(clientId);
  if (!d) return null;
  return { name: d.client.name, seiten: baueBrainSeiten(d, stand) };
}

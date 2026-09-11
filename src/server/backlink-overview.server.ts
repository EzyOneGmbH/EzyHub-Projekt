// Backlink-/Autoritäts-Overview — gemeinsame Logik für /api/ahrefs/overview
// (on-demand aus dem Panel) und den 12h-Populate-Job jobAhrefs (alle Kunden).
//
// 2026-09-09: zurück auf Ahrefs (Volkan: Abo läuft ohnehin für Brand Radar,
// DataForSEO kostet pro Call — der 12h-Populate war ~50 USD/Monat nur für
// dieses Panel). Ahrefs liefert die ROHEN v3-Antworten wie vor der Ablösung
// vom 06.08. (useEzyLatestRun/RankDashboards lesen beide Formen), plus
// source:"ahrefs". Die DataForSEO-Variante bleibt als Rückweg erhalten:
// BACKLINK_PROVIDER=dataforseo in der Lovable-Env schaltet ohne Code zurück.
//   Ahrefs:      site-explorer/domain-rating | backlinks-stats | refdomains-history | metrics
//   DataForSEO:  backlinks/summary | backlinks/history | labs domain_rank_overview

const DFS_BASE = "https://api.dataforseo.com/v3";
const AHREFS_BASE = "https://api.ahrefs.com/v3";

export type BacklinkProvider = "ahrefs" | "dataforseo";

export function backlinkProvider(): BacklinkProvider {
  return process.env.BACKLINK_PROVIDER === "dataforseo" ? "dataforseo" : "ahrefs";
}

export function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN,
    pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

export function ahrefsAuth(): string | null {
  const key = process.env.AHREFS_API_KEY;
  return key ? `Bearer ${key}` : null;
}

// Auth passend zum aktiven Provider; `missing` nennt die fehlende Env-Variable
// für die 503-/skipped-Meldung der Aufrufer.
export function backlinkAuth(): {
  provider: BacklinkProvider;
  auth: string | null;
  missing: string;
} {
  const provider = backlinkProvider();
  return provider === "dataforseo"
    ? { provider, auth: dfsAuth(), missing: "DATAFORSEO_LOGIN/PASSWORD" }
    : { provider, auth: ahrefsAuth(), missing: "AHREFS_API_KEY" };
}

type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; rate_limited?: boolean };

// Generischer DataForSEO-Live-Call (Basic-Auth, Task-Array-Body). Gibt das erste
// result-Objekt zurück; Fehler (inkl. task-level status_code) werden gefangen.
async function dfsCall<T = any>(
  path: string,
  task: Record<string, unknown>,
  auth: string,
  timeoutMs = 12000,
): Promise<SectionResult<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DFS_BASE}/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: ctrl.signal,
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const taskObj = j?.tasks?.[0];
    if (!taskObj || (taskObj.status_code && taskObj.status_code >= 40000)) {
      return {
        ok: false,
        error: `DFS ${taskObj?.status_code ?? "?"}: ${String(taskObj?.status_message ?? "kein Ergebnis").slice(0, 120)}`,
      };
    }
    return { ok: true, data: (taskObj.result?.[0] ?? null) as T };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

// Ahrefs-v3-GET (Bearer). Der Key darf nie in Fehlertexten landen — Antwort-
// Texte werden gekürzt, ein 429 wird als rate_limited markiert.
async function ahrefsCall<T = any>(
  path: string,
  params: Record<string, string>,
  auth: string,
  timeoutMs = 12000,
): Promise<SectionResult<T>> {
  const url = new URL(`${AHREFS_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const rate_limited = res.status === 429;
      return {
        ok: false,
        rate_limited,
        error: rate_limited
          ? "Ahrefs rate limit reached (HTTP 429)"
          : `HTTP ${res.status}: ${text.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 160)}`,
      };
    }
    return { ok: true, data: (await res.json().catch(() => null)) as T };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeDomain(raw: string): string {
  return String(raw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

// Sistrix-Sichtbarkeitsindex (11.09.2026, Volkan): fuer die KPI-Kachel «Visibility
// Index». Der Key liegt nur im agent-service (SISTRIX_API_KEY), deshalb ueber
// dessen Route /sistrix-visibility (AGENT_BASE_URL + AGENT_SHARED_SECRET, 20-h-
// Cache dort). Fehler sind nie fatal — dann bleibt das Feld null.
export type SistrixVisibility = {
  visibility_index: number;
  date: string | null;
  country: string;
  source: "sistrix";
};
export async function fetchSistrixVisibility(
  domain: string,
  country = "ch",
): Promise<SistrixVisibility | null> {
  const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret || !domain) return null;
  try {
    const r = await fetch(
      `${base}/sistrix-visibility?domain=${encodeURIComponent(domain)}&country=${encodeURIComponent(country)}`,
      { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(40_000) },
    );
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.ok || typeof j.visibility_index !== "number") return null;
    return {
      visibility_index: j.visibility_index,
      date: j.date ?? null,
      country,
      source: "sistrix",
    };
  } catch {
    return null;
  }
}

export type BacklinkOverview = {
  generated_at: string;
  domain: string;
  source: BacklinkProvider;
  rate_limited: boolean;
  /** Sistrix-Sichtbarkeitsindex (CH) — null, wenn nicht abrufbar. */
  sistrix: SistrixVisibility | null;
  domain_rating: Record<string, unknown> | null;
  backlinks_stats: Record<string, unknown> | null;
  refdomains_history: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  errors: Record<string, string | null>;
  all_failed: boolean;
};

// Provider-Weiche: Standard Ahrefs, DataForSEO nur per BACKLINK_PROVIDER.
export async function fetchBacklinkOverview(
  domain: string,
  auth: string,
  provider: BacklinkProvider = backlinkProvider(),
): Promise<BacklinkOverview> {
  const [overview, sistrix] = await Promise.all([
    provider === "dataforseo"
      ? fetchBacklinkOverviewDfs(domain, auth)
      : fetchBacklinkOverviewAhrefs(domain, auth),
    fetchSistrixVisibility(domain),
  ]);
  return { ...overview, sistrix };
}

// Ahrefs: 4 Abrufe parallel, Rohantworten unverändert durchreichen (Form wie
// vor dem 06.08.: domain_rating.domain_rating.domain_rating, backlinks_stats.
// metrics.live_refdomains, refdomains_history.refdomains[], metrics.metrics.org_traffic).
// Ahrefs kennt kein "heute" (bad date) -> gestern; mode=subdomains, damit eine
// nackte Domain auch www/Hosts einsammelt.
export async function fetchBacklinkOverviewAhrefs(
  domain: string,
  auth: string,
): Promise<BacklinkOverview> {
  const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  // Sequenziell mit Wiederholung bei 429 (11.09.: vier parallele Abrufe liefen
  // in das Ahrefs-Rate-Limit, obwohl das Kontingent bei 17 % lag) — 2 Retries
  // mit 4 s/8 s Pause je Sektion, danach bleibt die Sektion leer.
  const withRetry = async <T>(fn: () => Promise<SectionResult<T>>): Promise<SectionResult<T>> => {
    let last: SectionResult<T> = await fn();
    for (let i = 0; i < 2 && !last.ok && last.rate_limited; i++) {
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
      last = await fn();
    }
    return last;
  };
  const dr = await withRetry(() =>
    ahrefsCall("site-explorer/domain-rating", { target: domain, date }, auth),
  );
  const bl = await withRetry(() =>
    ahrefsCall("site-explorer/backlinks-stats", { target: domain, date, mode: "subdomains" }, auth),
  );
  const rd = await withRetry(() =>
    ahrefsCall(
      "site-explorer/refdomains-history",
      { target: domain, date_from: dateFrom, history_grouping: "weekly", mode: "subdomains" },
      auth,
    ),
  );
  const mt = await withRetry(() =>
    ahrefsCall("site-explorer/metrics", { target: domain, date, mode: "subdomains" }, auth),
  );

  const sections = [dr, bl, rd, mt];
  return {
    generated_at: new Date().toISOString(),
    domain,
    source: "ahrefs",
    sistrix: null,
    rate_limited: sections.some((s) => !s.ok && s.rate_limited === true),
    domain_rating: dr.ok ? dr.data : null,
    backlinks_stats: bl.ok ? bl.data : null,
    refdomains_history: rd.ok ? rd.data : null,
    metrics: mt.ok ? mt.data : null,
    errors: {
      domain_rating: dr.ok ? null : dr.error,
      backlinks_stats: bl.ok ? null : bl.error,
      refdomains_history: rd.ok ? null : rd.error,
      metrics: mt.ok ? null : mt.error,
    },
    all_failed: sections.every((s) => !s.ok),
  };
}

// DataForSEO (Rückweg): 3 Abrufe, in die Panel-Schlüssel gemappt.
export async function fetchBacklinkOverviewDfs(
  domain: string,
  auth: string,
): Promise<BacklinkOverview> {
  const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  // Parallel: Summary (rank + Backlinks), History (Refdomains 90d), Labs (organisch CH).
  const [summary, history, labs] = await Promise.all([
    dfsCall(
      "backlinks/summary/live",
      { target: domain, include_subdomains: true, backlinks_status_type: "live" },
      auth,
    ),
    dfsCall("backlinks/history/live", { target: domain, date_from: dateFrom }, auth),
    dfsCall(
      "dataforseo_labs/google/domain_rank_overview/live",
      { target: domain, location_code: 2756, language_code: "de" },
      auth,
    ),
  ]);

  const s: any = summary.ok ? summary.data : null;
  const domain_rating = s
    ? {
        rank: s.rank ?? null,
        backlinks: s.backlinks ?? null,
        referring_domains: s.referring_domains ?? null,
        _hinweis: "DataForSEO-Rank (0–1000), ersetzt Ahrefs Domain Rating",
      }
    : null;
  const backlinks_stats = s
    ? {
        backlinks: s.backlinks ?? null,
        referring_domains: s.referring_domains ?? null,
        referring_main_domains: s.referring_main_domains ?? null,
        referring_domains_nofollow: s.referring_domains_nofollow ?? null,
        broken_backlinks: s.broken_backlinks ?? null,
        referring_pages: s.referring_pages ?? null,
      }
    : null;
  const histItems = history.ok ? ((history.data as any)?.items ?? []) : [];
  const refdomains_history = history.ok
    ? {
        items: (histItems as any[]).map((it) => ({
          date: it.date,
          referring_domains: it.referring_domains,
          backlinks: it.backlinks,
        })),
      }
    : null;
  const org = labs.ok ? ((labs.data as any)?.items?.[0]?.metrics?.organic ?? null) : null;
  const metrics = org
    ? {
        organic_traffic_etv: org.etv ?? null,
        organic_keywords: org.count ?? null,
        pos_1: org.pos_1 ?? null,
        pos_2_3: org.pos_2_3 ?? null,
        pos_4_10: org.pos_4_10 ?? null,
      }
    : null;

  return {
    generated_at: new Date().toISOString(),
    domain,
    source: "dataforseo",
    sistrix: null,
    rate_limited: false,
    domain_rating,
    backlinks_stats,
    refdomains_history,
    metrics,
    errors: {
      domain_rating: summary.ok ? null : summary.error,
      backlinks_stats: summary.ok ? null : summary.error,
      refdomains_history: history.ok ? null : history.error,
      metrics: labs.ok ? null : labs.error,
    },
    all_failed: !summary.ok && !history.ok && !labs.ok,
  };
}

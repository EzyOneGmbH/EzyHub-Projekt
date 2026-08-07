// Backlink-/Autoritäts-Overview via DataForSEO — gemeinsame Logik für
// /api/ahrefs/overview (on-demand aus dem Panel) und
// /api/admin/backlink-backfill (Durchlauf über alle Kunden).
// 2026-08-07 aus ahrefs.overview.ts extrahiert (Ahrefs-Ablösung 06.08.).
//   - backlinks/summary/live               -> rank (DR-Ersatz) + Backlinks/Refdomains
//   - backlinks/history/live               -> Referring-Domains-Verlauf (90 Tage)
//   - dataforseo_labs domain_rank_overview -> organischer Traffic/Keywords (CH)

const DFS_BASE = "https://api.dataforseo.com/v3";

export function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

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
      return { ok: false, error: `DFS ${taskObj?.status_code ?? "?"}: ${String(taskObj?.status_message ?? "kein Ergebnis").slice(0, 120)}` };
    }
    return { ok: true, data: (taskObj.result?.[0] ?? null) as T };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeDomain(raw: string): string {
  return String(raw).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

export type BacklinkOverview = {
  generated_at: string;
  domain: string;
  source: "dataforseo";
  rate_limited: false;
  domain_rating: Record<string, unknown> | null;
  backlinks_stats: Record<string, unknown> | null;
  refdomains_history: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  errors: Record<string, string | null>;
  all_failed: boolean;
};

// Führt die 3 DataForSEO-Abrufe für eine (bereits normalisierte) Domain aus und
// mappt sie in die bestehenden Panel-Schlüssel (Panel zeigt rohes JSON).
export async function fetchBacklinkOverview(domain: string, auth: string): Promise<BacklinkOverview> {
  const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  // Parallel: Summary (rank + Backlinks), History (Refdomains 90d), Labs (organisch CH).
  const [summary, history, labs] = await Promise.all([
    dfsCall("backlinks/summary/live", { target: domain, include_subdomains: true, backlinks_status_type: "live" }, auth),
    dfsCall("backlinks/history/live", { target: domain, date_from: dateFrom }, auth),
    dfsCall("dataforseo_labs/google/domain_rank_overview/live", { target: domain, location_code: 2756, language_code: "de" }, auth),
  ]);

  const s: any = summary.ok ? summary.data : null;
  const domain_rating = s
    ? { rank: s.rank ?? null, backlinks: s.backlinks ?? null, referring_domains: s.referring_domains ?? null, _hinweis: "DataForSEO-Rank (0–1000), ersetzt Ahrefs Domain Rating" }
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
    ? { items: (histItems as any[]).map((it) => ({ date: it.date, referring_domains: it.referring_domains, backlinks: it.backlinks })) }
    : null;
  const org = labs.ok ? ((labs.data as any)?.items?.[0]?.metrics?.organic ?? null) : null;
  const metrics = org
    ? { organic_traffic_etv: org.etv ?? null, organic_keywords: org.count ?? null, pos_1: org.pos_1 ?? null, pos_2_3: org.pos_2_3 ?? null, pos_4_10: org.pos_4_10 ?? null }
    : null;

  return {
    generated_at: new Date().toISOString(),
    domain,
    source: "dataforseo",
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

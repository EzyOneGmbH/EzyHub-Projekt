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
//                + referring-domains (Spam-Anteil via `is_spam`, API-Stand 09/2026)
//   DataForSEO:  backlinks/summary | backlinks/history | labs domain_rank_overview
//
// 2026-09-21 (API-Stand 09/2026): Ahrefs liefert auf den Backlink-Endpunkten
// das Feld `is_spam` (boolean, «Backlink stammt von einer bekannten Spam-
// Domain»; in Select UND Where-Filter erlaubt — Schema per offiziellem
// Referenz-Doc verifiziert). Der Overview weist damit den Spam-Anteil aus
// (spam.spamDomains / spam.spamAnteil) und blendet Spam-Domains in der
// Top-Liste per Where-Filter aus (Parameter ohneSpam, Default true).

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

/** Spam-Kennzahlen aus Ahrefs `is_spam` (nur Provider ahrefs, sonst null). */
export type BacklinkSpamInfo = {
  /** Anzahl live verlinkender Domains mit is_spam=true (gedeckelt, s. capped). */
  spamDomains: number;
  /** Anteil 0..1 an den live Referring Domains (backlinks_stats.live_refdomains); null ohne Basis. */
  spamAnteil: number | null;
  /** Basis der Anteilsrechnung (live_refdomains). */
  liveRefdomains: number | null;
  /** true = Zähl-Limit erreicht, spamDomains ist eine Untergrenze. */
  capped: boolean;
  /** Ob die Top-Liste (referring_domains) Spam-Domains per Where-Filter ausschliesst. */
  ohneSpam: boolean;
};

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
  /** Top-Referring-Domains (Ahrefs, Rohantwort `refdomains[]` inkl. is_spam); null bei DataForSEO. */
  referring_domains: Record<string, unknown> | null;
  /** Spam-Anteil (Ahrefs is_spam); null bei DataForSEO oder Fehler. */
  spam: BacklinkSpamInfo | null;
  errors: Record<string, string | null>;
  all_failed: boolean;
};

export type BacklinkOverviewOptions = {
  /** Spam-Domains (is_spam=true) aus der Top-Liste ausschliessen. Default true. */
  ohneSpam?: boolean;
};

// Provider-Weiche: Standard Ahrefs, DataForSEO nur per BACKLINK_PROVIDER.
export async function fetchBacklinkOverview(
  domain: string,
  auth: string,
  provider: BacklinkProvider = backlinkProvider(),
  opts: BacklinkOverviewOptions = {},
): Promise<BacklinkOverview> {
  const [overview, sistrix] = await Promise.all([
    provider === "dataforseo"
      ? fetchBacklinkOverviewDfs(domain, auth)
      : fetchBacklinkOverviewAhrefs(domain, auth, opts),
    fetchSistrixVisibility(domain),
  ]);
  return { ...overview, sistrix };
}

// Zähl-Deckel für die Spam-Zählung: Ahrefs verrechnet je gelieferter Zeile
// eine Unit — die Zählung läuft deshalb NUR über is_spam=true-Zeilen (bei
// seriösen Profilen wenige) und ist auf AHREFS_SPAM_COUNT_LIMIT gedeckelt.
const SPAM_COUNT_LIMIT = Math.max(50, Number(process.env.AHREFS_SPAM_COUNT_LIMIT ?? 1000) || 1000);
// Grösse der Top-Referring-Domains-Liste (DR absteigend).
const TOP_REFDOMAINS_LIMIT = Math.max(
  5,
  Number(process.env.AHREFS_TOP_REFDOMAINS_LIMIT ?? 25) || 25,
);

/** Reine Rechenfunktion (testbar): Spam-Zeilen + live_refdomains -> Kennzahlen. */
export function berechneSpam(
  spamRows: number,
  liveRefdomains: number | null | undefined,
  ohneSpam: boolean,
  limit: number = SPAM_COUNT_LIMIT,
): BacklinkSpamInfo {
  const basis =
    typeof liveRefdomains === "number" && Number.isFinite(liveRefdomains) && liveRefdomains > 0
      ? liveRefdomains
      : null;
  const spamDomains = Math.max(0, Math.floor(spamRows));
  return {
    spamDomains,
    spamAnteil: basis ? Math.min(1, Math.round((spamDomains / basis) * 10000) / 10000) : null,
    liveRefdomains: basis,
    capped: spamDomains >= limit,
    ohneSpam,
  };
}

/** Kontingent-Auskunft `subscription-info/limits-and-usage` (kostenlos, keine
 *  Units). Felder gemäss offiziellem Schema (verifiziert 21.09.2026). */
export type AhrefsUnits = {
  subscription: string | null;
  units_limit_api_key: number | null;
  units_usage_api_key: number | null;
  units_limit_workspace: number | null;
  units_usage_workspace: number | null;
  /** Anteil 0..1 des API-Key-Kontingents (null bei unlimitiert). */
  verbrauchAnteil: number | null;
  usage_reset_date: string | null;
  api_key_expiration_date: string | null;
};

export function parseAhrefsUnits(raw: unknown): AhrefsUnits | null {
  const l = (raw as any)?.limits_and_usage;
  if (!l || typeof l !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const limit = num(l.units_limit_api_key);
  const usage = num(l.units_usage_api_key);
  return {
    subscription: str(l.subscription),
    units_limit_api_key: limit,
    units_usage_api_key: usage,
    units_limit_workspace: num(l.units_limit_workspace),
    units_usage_workspace: num(l.units_usage_workspace),
    verbrauchAnteil:
      limit && limit > 0 && usage != null ? Math.round((usage / limit) * 10000) / 10000 : null,
    usage_reset_date: str(l.usage_reset_date),
    api_key_expiration_date: str(l.api_key_expiration_date),
  };
}

export async function fetchAhrefsLimits(
  auth: string,
  timeoutMs = 8000,
): Promise<
  { ok: true; units: AhrefsUnits; status: number } | { ok: false; error: string; status?: number }
> {
  const r = await ahrefsCall("subscription-info/limits-and-usage", {}, auth, timeoutMs);
  if (!r.ok) return { ok: false, error: r.error, status: r.rate_limited ? 429 : undefined };
  const units = parseAhrefsUnits(r.data);
  return units
    ? { ok: true, units, status: 200 }
    : { ok: false, error: "limits_and_usage fehlt in der Antwort", status: 200 };
}

// Ahrefs: 4 Abrufe parallel, Rohantworten unverändert durchreichen (Form wie
// vor dem 06.08.: domain_rating.domain_rating.domain_rating, backlinks_stats.
// metrics.live_refdomains, refdomains_history.refdomains[], metrics.metrics.org_traffic).
// Ahrefs kennt kein "heute" (bad date) -> gestern; mode=subdomains, damit eine
// nackte Domain auch www/Hosts einsammelt.
export async function fetchBacklinkOverviewAhrefs(
  domain: string,
  auth: string,
  opts: BacklinkOverviewOptions = {},
): Promise<BacklinkOverview> {
  const ohneSpam = opts.ohneSpam !== false;
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

  // Spam (API-Stand 09/2026, Feld `is_spam`): zwei Abrufe auf referring-domains.
  //  a) Zählung: NUR is_spam=true-Zeilen (history=live), select=domain — Units
  //     fallen je gelieferter Zeile an, deshalb gedeckelt (SPAM_COUNT_LIMIT).
  //  b) Top-Liste nach DR (TOP_REFDOMAINS_LIMIT Zeilen) inkl. is_spam; bei
  //     ohneSpam werden Spam-Domains per Where-Filter ausgeschlossen.
  const whereSpam = JSON.stringify({ field: "is_spam", is: ["eq", true] });
  const whereKeinSpam = JSON.stringify({ field: "is_spam", is: ["eq", false] });
  const sp = await withRetry(() =>
    ahrefsCall<{ refdomains?: unknown[] }>(
      "site-explorer/referring-domains",
      {
        target: domain,
        mode: "subdomains",
        history: "live",
        select: "domain",
        where: whereSpam,
        limit: String(SPAM_COUNT_LIMIT),
      },
      auth,
    ),
  );
  const td = await withRetry(() =>
    ahrefsCall<{ refdomains?: unknown[] }>(
      "site-explorer/referring-domains",
      {
        target: domain,
        mode: "subdomains",
        history: "live",
        select: "domain,domain_rating,links_to_target,first_seen,is_spam",
        order_by: "domain_rating:desc",
        limit: String(TOP_REFDOMAINS_LIMIT),
        ...(ohneSpam ? { where: whereKeinSpam } : {}),
      },
      auth,
    ),
  );

  const liveRefdomains = bl.ok ? Number((bl.data as any)?.metrics?.live_refdomains) : NaN;
  const spam = sp.ok
    ? berechneSpam(
        Array.isArray(sp.data?.refdomains) ? sp.data.refdomains.length : 0,
        Number.isFinite(liveRefdomains) ? liveRefdomains : null,
        ohneSpam,
      )
    : null;

  // all_failed/rate_limited bewerten weiterhin nur die vier Kern-Sektionen —
  // die Spam-Abrufe sind Zusatzinformation und dürfen den Lauf nicht «failed» machen.
  const sections = [dr, bl, rd, mt];
  return {
    generated_at: new Date().toISOString(),
    domain,
    source: "ahrefs",
    sistrix: null,
    rate_limited: [...sections, sp, td].some((s) => !s.ok && s.rate_limited === true),
    domain_rating: dr.ok ? dr.data : null,
    backlinks_stats: bl.ok ? bl.data : null,
    refdomains_history: rd.ok ? rd.data : null,
    metrics: mt.ok ? mt.data : null,
    referring_domains: td.ok ? (td.data as Record<string, unknown>) : null,
    spam,
    errors: {
      domain_rating: dr.ok ? null : dr.error,
      backlinks_stats: bl.ok ? null : bl.error,
      refdomains_history: rd.ok ? null : rd.error,
      metrics: mt.ok ? null : mt.error,
      referring_domains: td.ok ? null : td.error,
      spam: sp.ok ? null : sp.error,
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
    // is_spam ist Ahrefs-spezifisch — im DataForSEO-Rückweg nicht verfügbar.
    referring_domains: null,
    spam: null,
    errors: {
      domain_rating: summary.ok ? null : summary.error,
      backlinks_stats: summary.ok ? null : summary.error,
      refdomains_history: history.ok ? null : history.error,
      metrics: labs.ok ? null : labs.error,
      referring_domains: null,
      spam: null,
    },
    all_failed: !summary.ok && !history.ok && !labs.ok,
  };
}

// Seitenabrufe der Content-Massnahmen über den agent-service (09.11.2026).
// Im Worker sprengten Diagnose-Crawls und SERP-Seiten das Cloudflare-Limit
// (Fehler 1102), und manche Hoster sperren Rechenzentrums-IPs (hotelbernina.ch).
// Der agent-service (Cloud-PC) ruft ab, parst und fällt bei Sperren selbst auf
// DataForSEO On-Page zurück; der Worker bekommt nur kompakte Ergebnisse.
// null = agent-service nicht konfiguriert/erreichbar → Aufrufer nutzt den alten Weg.

export type ProbeSnapshot =
  | { error: string }
  | {
      quelle: "direkt" | "dataforseo";
      lang?: string;
      titleTag: string;
      metaDescription: string;
      modified: string;
      h1: string;
      headings: string[];
      wordCount: number;
      excerpt: string;
    };

export type ProbeSeite = {
  quelle: "direkt" | "dataforseo" | null;
  status: number;
  location: string;
  xRobots: string;
  /** X-Robots-Tag gelesen (nur beim direkten Abruf möglich) */
  xRobotsGeprueft: boolean;
  /** Inhalt der Meta-robots-Tags; null = nicht gelesen */
  metaRobots: string | null;
  /** noindex laut DataForSEO; null = nicht über DataForSEO geprüft */
  noindex: boolean | null;
  /** Canonical der Seite ("" = keins gesetzt); null = nicht ermittelbar */
  canonical: string | null;
  title: string;
};

export type ProbeDiagnose = {
  seite: ProbeSeite;
  robots: { status: number; gesperrt: boolean; text: string };
  sitemap: { gefunden: string | null; geprueft: number; abrufbar: boolean };
  links: Array<{ url: string; title: string; verlinkt: boolean | null; quelle: string | null }>;
};

export type ProbeAntwort = {
  ok: true;
  snapshots: ProbeSnapshot[];
  goto: Record<string, string | null>;
  diagnose: ProbeDiagnose | null;
  cost_dfs: number;
};

export async function contentProbe(
  body: {
    snapshots?: Array<{ url: string; maxHeadings?: number; excerptChars?: number }>;
    goto?: string[];
    diagnose?: { url: string; linkSources?: string[]; sitemapCandidates?: string[] };
  },
  timeoutMs = 60_000,
): Promise<ProbeAntwort | null> {
  const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret) return null;
  try {
    const r = await fetch(`${base}/content-probe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as ProbeAntwort | { ok: false };
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

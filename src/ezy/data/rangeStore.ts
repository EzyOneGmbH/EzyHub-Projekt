// Geteilter Datumsfilter + Range-Cache (2026-08-10, Volkan-Wunsch).
//
// 1) EIN Zeitraum über alle Apps: EzyRank, EzyAI & Co. lesen/schreiben denselben
//    localStorage-Eintrag — wer in einer App "7 Tage" wählt, sieht überall 7 Tage.
//    Eigene Zeiträume (Kalender) überleben jetzt auch den Reload (start/end als ISO;
//    vorher wurden nur label+days gespeichert und der Zeitraum beim Restore verfälscht).
//
// 2) SWR-Cache für Range-Abfragen: useRangeData liefert einen gecachten Stand
//    SOFORT (auch abgelaufen) und aktualisiert still im Hintergrund — Filterwechsel
//    fühlen sich nach dem ersten Laden instant an. Cache lebt in localStorage,
//    begrenzt auf MAX_ENTRIES, Einträge älter als PRUNE_MS fliegen raus.

import { useEffect, useRef, useState } from "react";

// ── Geteilter Zeitraum ───────────────────────────────────────────────────────
const RANGE_LS = "ezy.dateRange.v2";

export type SharedRange = {
  label: string;
  days: number;
  preset: string; // "7d" | "14d" | "30d" | "90d" | "custom"
  start?: string; // ISO — nur bei preset "custom" maßgeblich
  end?: string;
};

export function loadSharedRange(): SharedRange | null {
  try {
    const raw = localStorage.getItem(RANGE_LS);
    if (!raw) return null;
    const r = JSON.parse(raw) as SharedRange;
    if (!r || !Number.isFinite(r.days) || r.days < 1) return null;
    return r;
  } catch {
    return null;
  }
}

export function saveSharedRange(r: SharedRange): void {
  try {
    localStorage.setItem(RANGE_LS, JSON.stringify(r));
  } catch {
    /* Quota/Privacy-Mode — Filter funktioniert trotzdem, nur ohne Persistenz */
  }
}

// ── Aufgelöster Zeitraum (18.08.2026, EzyAI-Vereinheitlichung) ───────────────
// Macht aus dem gespeicherten SharedRange konkrete Start/Ende-Daten:
// Presets = "letzte N Tage bis heute", Custom = exakte gespeicherte Daten
// (überlebt so den App-Wechsel unverfälscht — vorher rundete EzyAI auf 7/30/90).

export type ResolvedRange = {
  days: number;
  start: Date;
  end: Date;
  preset: string;
  label: string;
};

export function resolveRange(r: SharedRange | null, now: Date = new Date()): ResolvedRange {
  if (r?.preset === "custom" && r.start && r.end) {
    const start = new Date(r.start);
    const end = new Date(r.end);
    if (!isNaN(+start) && !isNaN(+end) && start <= end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 864e5) + 1);
      return { days, start, end, preset: "custom", label: r.label || "Eigener Zeitraum" };
    }
  }
  const days = r && Number.isFinite(r.days) && r.days >= 1 ? Math.min(365, Math.round(r.days)) : 30;
  return {
    days,
    start: new Date(now.getTime() - (days - 1) * 864e5),
    end: now,
    preset: r?.preset && r.preset !== "custom" ? r.preset : `${days}d`,
    label: r?.label || `${days} Tage`,
  };
}

/** Direkt angrenzende Vorperiode gleicher Länge (für Vergleichs-KPIs). */
export function previousPeriod(range: { start: Date; end: Date; days: number }): {
  start: Date;
  end: Date;
} {
  const end = new Date(range.start.getTime() - 864e5);
  const start = new Date(end.getTime() - (range.days - 1) * 864e5);
  return { start, end };
}

/** Lokales Datum als YYYY-MM-DD (bewusst NICHT toISOString — das kippt in UTC). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Navigations-Typ ──────────────────────────────────────────────────────────
/**
 * true bei Seiten-Reload oder Vor/Zurück — dann stellen die Apps die letzte
 * Kunden-Auswahl wieder her. Frische Einstiege (Login, App-Wechsel per Link)
 * starten in "Alle Kunden" (Volkan 11.08.).
 */
export function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return nav?.type === "reload" || nav?.type === "back_forward";
  } catch {
    return false;
  }
}

// ── SWR-Cache ────────────────────────────────────────────────────────────────
const CACHE_PREFIX = "ezy.rangecache.v1:";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // frisch genug für Dashboard-Zwecke
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;

type CacheEntry = { at: number; data: unknown };

// Direkter Zugriff für Komponenten mit eigener Fetch-/Fehlerlogik (EzyAI-Panels):
// cacheGet liefert {at,data} (auch abgelaufen — Anzeige sofort, still neu laden),
// cachePut schreibt nur ERFOLGREICHE Antworten. TTL für "frisch genug"-Checks.
export const RANGE_TTL_MS = DEFAULT_TTL_MS;
export function cacheGet(key: string): { at: number; data: unknown } | null {
  return readCache(key);
}
export function cachePut(key: string, data: unknown): void {
  writeCache(key, data);
}

function readCache(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    return e && Number.isFinite(e.at) ? e : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown): void {
  const entry: CacheEntry = { at: Date.now(), data };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota voll → Cache-Namespace leeren und einmal erneut versuchen.
    try {
      pruneCache(true);
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      /* dann eben ohne Cache */
    }
  }
  pruneCache(false);
}

function pruneCache(aggressive: boolean): void {
  try {
    const keys: Array<{ k: string; at: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(CACHE_PREFIX)) continue;
      let at = 0;
      try {
        at = (JSON.parse(localStorage.getItem(k) || "{}") as CacheEntry).at || 0;
      } catch {
        /* kaputter Eintrag → at=0 → wird entfernt */
      }
      keys.push({ k, at });
    }
    const now = Date.now();
    const stale = keys.filter((e) => aggressive || now - e.at > PRUNE_MS);
    for (const e of stale) localStorage.removeItem(e.k);
    const rest = keys.filter((e) => !stale.includes(e)).sort((a, b) => a.at - b.at);
    while (rest.length > MAX_ENTRIES) {
      const oldest = rest.shift();
      if (oldest) localStorage.removeItem(oldest.k);
    }
  } catch {
    /* localStorage nicht verfügbar */
  }
}

/**
 * SWR-Hook: liefert { data, loading, refresh }.
 * - key null/leer → Hook ist inaktiv (data null).
 * - Gecachter Stand wird sofort geliefert; ist er älter als ttlMs, läuft die
 *   fetcher-Funktion still im Hintergrund und ersetzt Cache + State.
 * - fetcher, die null/undefined liefern oder werfen, überschreiben den Cache NICHT.
 */
export function useRangeData<T>(
  key: string | null,
  fetcher: () => Promise<T | null | undefined>,
  ttlMs: number = DEFAULT_TTL_MS,
): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0); // refresh() erzwingt einen Neu-Lauf
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    if (!key) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = readCache(key);
    if (cached) setData(cached.data as T);
    else setData(null);
    const fresh = cached && Date.now() - cached.at < ttlMs && tick === 0;
    if (fresh) {
      setLoading(false);
      return;
    }
    setLoading(!cached); // mit Cache im Bild kein Spinner — stilles Revalidate
    (async () => {
      try {
        const next = await fetcherRef.current();
        if (!alive) return;
        if (next != null) {
          writeCache(key, next);
          setData(next);
        }
      } catch {
        /* Netz-/Auth-Fehler: gecachter Stand bleibt stehen */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, ttlMs, tick]);

  return { data, loading, refresh: () => setTick((t) => t + 1) };
}

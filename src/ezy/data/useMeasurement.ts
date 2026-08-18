// Externe Messläufe aus dem Dashboard (EzyRank-Ausbau 2026-08-18).
// KLARE TRENNUNG: "Daten neu laden" liest nur den Datenbankstand (useEzyLatestRun
// refresh) — DIESER Hook startet tatsächlich einen externen Datenlauf (POST an
// eine bestehende Server-Route, z. B. /api/google/pagespeed). Status
// idle/running/success/error + Doppelstart-Guard (modulweit, überlebt Remounts).
import { useCallback, useEffect, useRef, useState } from "react";
import { ezyFetch } from "./api";

export type MeasurementStatus = "idle" | "running" | "success" | "error";

export type MeasurementState = {
  status: MeasurementStatus;
  /** Verständliche Fehlermeldung des letzten Versuchs (nur bei status error). */
  error: string | null;
  startedAt: number | null;
};

// Modulweiter In-Flight-Guard: key -> laufendes Promise. Verhindert parallele
// Doppelstarts derselben Messung (auch über Komponenten-Remounts hinweg).
const inflight = new Map<string, Promise<unknown>>();

/** Pure Guard-Logik (separat testbar): startet fn nur, wenn key nicht läuft. */
export function startGuarded<T>(key: string, fn: () => Promise<T>): { started: boolean; promise: Promise<T> } {
  const existing = inflight.get(key);
  if (existing) return { started: false, promise: existing as Promise<T> };
  const p = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return { started: true, promise: p };
}

/** true, wenn für diesen Key gerade eine Messung läuft. */
export function isMeasurementRunning(key: string): boolean {
  return inflight.has(key);
}

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/**
 * Startet eine externe Messung über eine bestehende POST-Route.
 * kind ist ein stabiler Bezeichner (z. B. "pagespeed"), der zusammen mit der
 * clientId den Doppelstart-Guard bildet.
 */
export function useMeasurement(
  clientId: string | undefined,
  kind: string,
  path: string,
  buildBody?: () => Record<string, unknown>,
): { state: MeasurementState; start: () => Promise<boolean> } {
  const key = `${clientId || "?"}|${kind}`;
  const [state, setState] = useState<MeasurementState>(() => ({
    status: isMeasurementRunning(key) ? "running" : "idle",
    error: null,
    startedAt: null,
  }));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!clientId || !isUuid(clientId)) {
      setState({ status: "error", error: "Kunde ohne gültige ID — Messung nicht möglich", startedAt: null });
      return false;
    }
    const startedAt = Date.now();
    const { started, promise } = startGuarded(key, async () => {
      const body = { clientId, ...(buildBody ? buildBody() : {}) };
      const res = await ezyFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      return j;
    });
    // Auch beim Anhängen an einen bereits laufenden Lauf: Status zeigen,
    // aber KEIN zweiter POST (started === false).
    setState({ status: "running", error: null, startedAt });
    try {
      await promise;
      if (alive.current) setState({ status: "success", error: null, startedAt });
      return true;
    } catch (e: any) {
      if (alive.current)
        setState({ status: "error", error: e?.message || "Messung fehlgeschlagen", startedAt });
      return false;
    } finally {
      void started; // Guard-Ergebnis bewusst ungenutzt — Promise ist geteilt.
    }
  }, [clientId, key, path, buildBody]);

  return { state, start };
}

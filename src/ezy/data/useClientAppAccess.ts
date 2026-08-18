// Admin-Umbau 06.08.: Kunde↔App-Zugriff + Funktions-Freischaltung
// (client_app_access). Lesend für alle Rollen (RLS scoped), schreibend nur
// owner/admin. WICHTIG: Solange die Migration nicht angewendet ist (Tabelle
// fehlt), meldet der Hook legacy=true und alle Ableitungen verhalten sich wie
// bisher (jede App aktiv, alle Funktionen frei) — nichts bricht.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { EzyAppId } from "./appRegistry";

export type ClientAppRow = {
  client_id: string;
  app: EzyAppId;
  enabled: boolean;
  features: string[];
};

export type ClientAppMap = Map<string, Map<string, { enabled: boolean; features: string[] }>>;

/** Keine Zeile = App aktiv (Legacy-Default, kein Seeding nötig). */
export function appEnabledFor(map: ClientAppMap | null, clientId: string, app: string): boolean {
  const e = map?.get(clientId)?.get(app);
  return e ? e.enabled : true;
}

/** enabled + leere features-Liste = ALLE Funktionen frei (Legacy-Default). */
export function featureEnabledFor(
  map: ClientAppMap | null,
  clientId: string,
  app: string,
  feature: string,
): boolean {
  const e = map?.get(clientId)?.get(app);
  if (!e) return true;
  if (!e.enabled) return false;
  return e.features.length === 0 || e.features.includes(feature);
}

export function useClientAppAccess() {
  const { user, organizationId } = useAuth();
  const [rows, setRows] = useState<ClientAppRow[]>([]);
  const [legacy, setLegacy] = useState(false); // Tabelle (noch) nicht vorhanden
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    // Supabase-Types kennen die neue Tabelle noch nicht — as any wie app_access.
    const { data, error } = await (supabase as any)
      .from("client_app_access")
      .select("client_id, app, enabled, features");
    if (error) {
      // 42P01 = Tabelle fehlt (Migration noch nicht angewendet) → Legacy-Modus.
      setLegacy(true);
      setRows([]);
    } else {
      setLegacy(false);
      setRows(
        (data ?? []).map((r: any) => ({
          client_id: r.client_id,
          app: r.app,
          enabled: r.enabled !== false,
          features: Array.isArray(r.features) ? r.features : [],
        })),
      );
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const map: ClientAppMap = useMemo(() => {
    const m: ClientAppMap = new Map();
    for (const r of rows) {
      if (!m.has(r.client_id)) m.set(r.client_id, new Map());
      m.get(r.client_id)!.set(r.app, { enabled: r.enabled, features: r.features });
    }
    return m;
  }, [rows]);

  /** Upsert (nur Admin — RLS enforced). features unverändert lassen: undefined. */
  const setAccess = useCallback(
    async (clientId: string, app: string, patch: { enabled?: boolean; features?: string[] }) => {
      const existing = map.get(clientId)?.get(app);
      const next = {
        organization_id: organizationId,
        client_id: clientId,
        app,
        enabled: patch.enabled ?? existing?.enabled ?? true,
        features: patch.features ?? existing?.features ?? [],
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("client_app_access")
        .upsert(next, { onConflict: "client_id,app" });
      if (!error) await reload();
      return error?.message ?? null;
    },
    [map, organizationId, reload],
  );

  return { rows, map, legacy, loading, reload, setAccess };
}

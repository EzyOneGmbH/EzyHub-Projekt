// Plattform (01.08.): Bulk-Service-Matrix — welche Kunden haben welchen
// Service aktiv? EINE Query über client_integrations statt N Einzel-Hooks;
// Auflösung identisch zu useEzyServiceSettings (expliziter Eintrag gewinnt,
// Google-Kinder erben von der groben "google"-Zeile). Genutzt, um die
// Kunden-Auswahl je App zu filtern (EzyPerformance → nur google-ads-Kunden).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SERVICE_PARENT, type ServiceKey } from "@/lib/services";

export function useEzyServiceMatrix() {
  const { organizationId, loading: authLoading } = useAuth();
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>> | null>(null);

  useEffect(() => {
    if (authLoading || !organizationId) return;
    let alive = true;
    supabase
      .from("client_integrations")
      .select("client_id, provider, enabled")
      .eq("organization_id", organizationId)
      .then(({ data }) => {
        if (!alive) return;
        const m: Record<string, Record<string, boolean>> = {};
        for (const r of data ?? []) {
          const cid = String(r.client_id);
          (m[cid] = m[cid] || {})[String(r.provider)] = !!r.enabled;
        }
        setMatrix(m);
      });
    return () => {
      alive = false;
    };
  }, [authLoading, organizationId]);

  /** true, wenn MINDESTENS EINER der Keys für den Kunden aktiv ist.
   *  Während die Matrix lädt: true (nicht filtern → kein Flackern/Leer-Zustand). */
  const hasService = useCallback(
    (clientId: string, keys: string[]) => {
      if (!matrix) return true;
      const raw = matrix[clientId] || {};
      return keys.some((k) => {
        if (Object.prototype.hasOwnProperty.call(raw, k)) return raw[k] === true;
        if (SERVICE_PARENT[k as ServiceKey] === "google") return raw.google === true;
        return false;
      });
    },
    [matrix],
  );

  return { hasService, loading: matrix === null || authLoading };
}

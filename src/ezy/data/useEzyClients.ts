import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/** Reference-shape Client (matches normalizeClientShape in EzyOneApp). */
export type EzyClient = {
  id: string;
  name: string;
  domain: string;
  status: "active" | "paused";
  industry: string;
  contactEmail: string;
  contactPhone: string;
  monthlyBudget: number;
  tags: string[];
  targetLocations: string[];
  notes: string;
  defaults: { language: string; tone: string; reportTemplate: string; visibleTabs?: string[] };
  score: number;
  keywords: number;
  traffic: number;
  aiVisitors: number;
  revenue: number;
  gscSiteUrl: string;
  ga4PropertyId: string;
  ga4MeasurementId: string;
  googleAdsCustomer: string; // clients.google_ads_customer (fix 2026-07-14: wurde nie zurueckgelesen)
  canonryProject: string;
  startDate: string;
  // Dashboard-Ausbau 2026-07-11 (WP2/B5): Brand-Terms fuer den GSC-Split +
  // Umsatz-Modus ('revenue' = vollstaendiges Umsatz-Tracking | 'clicks' = nur Buchungsklicks).
  brandTerms: string[];
  revenueMode: "revenue" | "clicks";
};

const DEFAULT_DEFAULTS = { language: "Deutsch", tone: "Professionell", reportTemplate: "Standard" };

/** Map a Supabase clients row to the reference EzyClient shape. */
function rowToClient(r: any): EzyClient {
  const domain = String(r.domain ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
  const m = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, any>;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    domain,
    status: m.status === "paused" || r.status === "paused" ? "paused" : "active",
    industry: String(r.industry ?? ""),
    contactEmail: String(m.contactEmail ?? ""),
    contactPhone: String(m.contactPhone ?? ""),
    monthlyBudget: Number(m.monthlyBudget ?? 0) || 0,
    tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
    targetLocations: Array.isArray(m.targetLocations)
      ? m.targetLocations.map(String)
      : r.country
        ? [String(r.country)]
        : [],
    notes: String(r.notes ?? ""),
    defaults: {
      ...DEFAULT_DEFAULTS,
      ...(m.defaults && typeof m.defaults === "object" ? m.defaults : {}),
      language:
        (m.defaults && m.defaults.language) || (r.language === "en" ? "English" : "Deutsch"),
    },
    score: Number(m.score ?? 0) || 0,
    keywords: Number(m.keywords ?? 0) || 0,
    traffic: Number(m.traffic ?? 0) || 0,
    aiVisitors: Number(m.aiVisitors ?? 0) || 0,
    revenue: Number(m.revenue ?? 0) || 0,
    gscSiteUrl: String(r.gsc_property ?? ""),
    ga4PropertyId: String(r.ga4_property ?? ""),
    ga4MeasurementId: String(m.ga4MeasurementId ?? ""),
    googleAdsCustomer: String(r.google_ads_customer ?? ""),
    canonryProject: String(r.canonry_project ?? ""),
    startDate: String(m.startDate ?? r.created_at ?? "").slice(0, 10),
    brandTerms: Array.isArray(r.brand_terms) ? r.brand_terms.map(String) : [],
    revenueMode: r.revenue_mode === "clicks" ? "clicks" : "revenue",
  };
}

function clientToRow(c: Partial<EzyClient>, organizationId: string, createdBy: string) {
  const metadata = {
    status: c.status ?? "active",
    contactEmail: c.contactEmail ?? "",
    contactPhone: c.contactPhone ?? "",
    monthlyBudget: Number(c.monthlyBudget ?? 0) || 0,
    tags: c.tags ?? [],
    targetLocations: c.targetLocations ?? [],
    ga4MeasurementId: c.ga4MeasurementId ?? "",
    score: Number(c.score ?? 0) || 0,
    keywords: Number(c.keywords ?? 0) || 0,
    traffic: Number(c.traffic ?? 0) || 0,
    aiVisitors: Number(c.aiVisitors ?? 0) || 0,
    revenue: Number(c.revenue ?? 0) || 0,
    startDate: c.startDate ?? null,
    defaults: c.defaults ?? null,
  };
  return {
    organization_id: organizationId,
    created_by: createdBy,
    name: c.name ?? "",
    domain: c.domain ?? null,
    industry: c.industry ?? null,
    notes: c.notes ?? null,
    country: c.targetLocations?.[0] ?? null,
    language: c.defaults?.language === "English" ? "en" : "de",
    gsc_property: c.gscSiteUrl ?? null,
    ga4_property: c.ga4PropertyId ?? null,
    canonry_project: c.canonryProject ?? null,
    brand_terms: Array.isArray(c.brandTerms) ? c.brandTerms : [],
    revenue_mode: c.revenueMode === "clicks" ? "clicks" : "revenue",
    // Nur schreiben wenn bekannt — sonst wuerde ein Speichern ohne dieses Feld
    // den vom Google-Panel gesetzten Wert nullen (fix 2026-07-14).
    ...(c.googleAdsCustomer !== undefined
      ? { google_ads_customer: c.googleAdsCustomer || null }
      : {}),
    metadata,
  };
}

import { DEFAULT_ON_SERVICES, type ServiceKey } from "@/lib/services";

// "anthropic" ist das Agent-Backbone (kein UI-Service) und immer aktiv.
const ALWAYS_ON = ["anthropic"] as const;

/**
 * Seedet client_integrations fuer einen NEUEN Kunden anhand der ausgewaehlten
 * Services. Nicht gewaehlte Dienste bleiben ohne Zeile = deaktiviert (Default),
 * bis sie spaeter im Integrationen-Panel aktiviert werden.
 */
async function seedSelectedIntegrations(
  organizationId: string,
  clientId: string,
  services: ServiceKey[],
) {
  try {
    const enabledKeys = services.length ? services : DEFAULT_ON_SERVICES;
    const providers = [...new Set([...ALWAYS_ON, ...enabledKeys])];
    const { data: existing } = await supabase
      .from("client_integrations")
      .select("provider")
      .eq("client_id", clientId)
      .in("provider", providers);
    const have = new Set((existing ?? []).map((r: any) => r.provider));
    const rows = providers
      .filter((p) => !have.has(p))
      .map((provider) => ({
        organization_id: organizationId,
        client_id: clientId,
        provider,
        enabled: true,
      }));
    if (rows.length) await supabase.from("client_integrations").insert(rows);
  } catch {
    /* non-fatal */
  }
}

export function useEzyClients() {
  const { user, organizationId, loading: authLoading } = useAuth();
  const [clients, setClients] = useState<EzyClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (error) setError(error.message);
    else {
      setError(null);
      // Alphabetisch mit de-CH-Collation (Umlaute korrekt einsortiert) —
      // Kundenreihenfolge ist überall alphabetisch (Volkan 13.08.).
      setClients(
        (data ?? [])
          .map(rowToClient)
          .sort((a, b) =>
            String(a.name).localeCompare(String(b.name), "de-CH", { sensitivity: "base" }),
          ),
      );
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const upsert = useCallback(
    async (next: EzyClient) => {
      if (!organizationId || !user) throw new Error("Nicht eingeloggt");
      const row = clientToRow(next, organizationId, user.id);
      const isNew = !next.id || !clients.some((c) => c.id === next.id);
      if (isNew) {
        const { data, error } = await supabase.from("clients").insert(row).select().single();
        if (error) throw error;
        const mapped = rowToClient(data);
        // Ausgewaehlte Services (transient am Client-Objekt) -> client_integrations.
        const selected = Array.isArray((next as any).services)
          ? ((next as any).services as ServiceKey[])
          : [];
        await seedSelectedIntegrations(organizationId, mapped.id, selected);
        // Auto-provision a Canonry (GEO) project for every new client (best-effort).
        try {
          const session = (await supabase.auth.getSession()).data.session;
          await fetch("/api/canonry/create-project", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token ?? ""}`,
            },
            body: JSON.stringify({ clientId: mapped.id }),
          });
        } catch {
          /* non-fatal — GEO can be provisioned later via the admin endpoint */
        }
        setClients((p) => [mapped, ...p]);
        return mapped;
      } else {
        const { data, error } = await supabase
          .from("clients")
          .update(row)
          .eq("id", next.id)
          .select()
          .single();
        if (error) throw error;
        const mapped = rowToClient(data);
        setClients((p) => p.map((c) => (c.id === mapped.id ? mapped : c)));
        return mapped;
      }
    },
    [clients, organizationId, user],
  );

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) throw error;
    setClients((p) => p.filter((c) => c.id !== id));
  }, []);

  return { clients, loading, error, reload, upsert, remove };
}

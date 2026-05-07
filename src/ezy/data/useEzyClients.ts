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
  defaults: { language: string; tone: string; reportTemplate: string };
  score: number;
  keywords: number;
  traffic: number;
  aiVisitors: number;
  revenue: number;
  gscSiteUrl: string;
  ga4PropertyId: string;
  ga4MeasurementId: string;
  canonryProject: string;
  startDate: string;
};

const DEFAULT_DEFAULTS = { language: "Deutsch", tone: "Professionell", reportTemplate: "Standard" };

/** Map a Supabase clients row to the reference EzyClient shape. */
function rowToClient(r: any): EzyClient {
  const domain = String(r.domain ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    domain,
    status: r.status === "paused" ? "paused" : "active",
    industry: String(r.industry ?? ""),
    contactEmail: "",
    contactPhone: "",
    monthlyBudget: 0,
    tags: [],
    targetLocations: r.country ? [String(r.country)] : [],
    notes: String(r.notes ?? ""),
    defaults: { ...DEFAULT_DEFAULTS, language: r.language === "en" ? "English" : "Deutsch" },
    score: 0,
    keywords: 0,
    traffic: 0,
    aiVisitors: 0,
    revenue: 0,
    gscSiteUrl: String(r.gsc_property ?? ""),
    ga4PropertyId: String(r.ga4_property ?? ""),
    ga4MeasurementId: "",
    canonryProject: String(r.canonry_project ?? ""),
    startDate: String(r.created_at ?? "").slice(0, 10),
  };
}

function clientToRow(c: Partial<EzyClient>, organizationId: string, createdBy: string) {
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
  };
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
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setClients((data ?? []).map(rowToClient));
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
        setClients((p) => [rowToClient(data), ...p]);
        return rowToClient(data);
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

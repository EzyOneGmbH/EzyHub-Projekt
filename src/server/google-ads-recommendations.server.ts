import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Phase C (Advisory-Brief): Massnahmen-Register. Empfehlungen der Analyse-Module
// werden verfolgbare Objekte mit Identitaet und Statuszyklus:
//   open -> implemented | dismissed | superseded
// Wiedererkennung statt Duplikat: je (client, recommendation_type, entity) gibt es
// hoechstens EINE offene Empfehlung; ein erneuter Lauf erhoeht nur last_seen_run.
// Statuswechsel schreiben NUR Status-Felder (DB-Trigger erzwingt das) und
// beruehren NIE das Ads-Konto.

export const RECOMMENDATION_TYPES = [
  "bid_target_adjustment",
  "bid_strategy_change",
  "bid_signal_gap",
  "asset_replace",
  "asset_coverage",
  "asset_pinning",
  "keyword_add",
  "keyword_pause",
  "keyword_match_change",
  "other",
  "test_dummy", // nur fuer Abnahme-/Zyklustests
] as const;

export type RecommendationInput = {
  recommendation_type: string;
  entity: string;
  title: string;
  rationale?: string;
  expected_impact?: string;
};

export async function submitRecommendations(p: {
  clientId: string;
  runId: string;
  recommendations: RecommendationInput[];
}): Promise<{ ok: boolean; created: number; recognized: number; errors: string[] }> {
  const out = { ok: true, created: 0, recognized: 0, errors: [] as string[] };

  const { data: openRows, error } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, recommendation_type, entity")
    .eq("client_id", p.clientId)
    .eq("status", "open");
  if (error) return { ok: false, created: 0, recognized: 0, errors: [error.message] };
  const openByKey = new Map((openRows ?? []).map((r) => [`${r.recommendation_type}::${r.entity}`, r.id]));

  const seenThisCall = new Set<string>();
  for (const r of p.recommendations) {
    const key = `${r.recommendation_type}::${r.entity}`;
    if (seenThisCall.has(key)) continue; // Duplikat im selben Aufruf
    seenThisCall.add(key);

    const existingId = openByKey.get(key);
    if (existingId) {
      // Wiedererkannt: nur last_seen_run bumpen (Trigger erlaubt genau das).
      const { error: e } = await supabaseAdmin
        .from("ads_recommendations")
        .update({ last_seen_run: p.runId })
        .eq("id", existingId);
      if (e) out.errors.push(`${key}: ${e.message}`);
      else out.recognized += 1;
      continue;
    }
    const { error: e } = await supabaseAdmin.from("ads_recommendations").insert({
      client_id: p.clientId,
      run_id: p.runId,
      last_seen_run: p.runId,
      recommendation_type: r.recommendation_type,
      entity: r.entity,
      title: r.title,
      rationale: r.rationale ?? "",
      expected_impact: r.expected_impact ?? null,
    });
    if (e) out.errors.push(`${key}: ${e.message}`);
    else out.created += 1;
  }
  if (out.errors.length) out.ok = false;
  return out;
}

export async function setRecommendationStatus(p: {
  id: string;
  status: "implemented" | "dismissed" | "superseded";
  by?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; httpStatus: number; error?: string; status?: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, status")
    .eq("id", p.id)
    .maybeSingle();
  if (error) return { ok: false, httpStatus: 500, error: error.message };
  if (!row) return { ok: false, httpStatus: 404, error: "Empfehlung nicht gefunden" };
  if (row.status !== "open")
    return { ok: false, httpStatus: 409, error: `Empfehlung ist bereits '${row.status}'` };

  const { error: e, data: updated } = await supabaseAdmin
    .from("ads_recommendations")
    .update({
      status: p.status,
      implemented_at: p.status === "implemented" ? new Date().toISOString() : null,
      implemented_by: p.by ?? null,
      implementation_note: p.note ?? null,
    })
    .eq("id", p.id)
    .eq("status", "open")
    .select("id");
  if (e) return { ok: false, httpStatus: 500, error: e.message };
  if (!updated || updated.length === 0)
    return { ok: false, httpStatus: 409, error: "Empfehlung wurde parallel entschieden" };
  return { ok: true, httpStatus: 200, status: p.status };
}

// Report-Pflichtblock "Offene Massnahmen" (Brief Phase C): offen / umgesetzt /
// verworfen (Fenster ~ letzte Wochenkadenz), Top 5 offene, Alter der aeltesten.
export async function openRecommendationsBlock(clientId: string): Promise<{
  open: number;
  implementedLast8d: number;
  dismissedLast8d: number;
  top5: Array<{ title: string; recommendation_type: string; entity: string; expected_impact: string | null; ageDays: number }>;
  oldestOpenDays: number | null;
}> {
  const since = new Date(Date.now() - 8 * 86400000).toISOString();
  const [openRes, implRes, dismRes] = await Promise.all([
    supabaseAdmin
      .from("ads_recommendations")
      .select("title, recommendation_type, entity, expected_impact, created_at")
      .eq("client_id", clientId)
      .eq("status", "open")
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("ads_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "implemented")
      .gte("implemented_at", since),
    supabaseAdmin
      .from("ads_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "dismissed")
      .gte("created_at", since),
  ]);
  const rows = openRes.data ?? [];
  const age = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return {
    open: rows.length,
    implementedLast8d: implRes.count ?? 0,
    dismissedLast8d: dismRes.count ?? 0,
    top5: rows
      .filter((r) => r.recommendation_type !== "test_dummy")
      .slice(0, 5)
      .map((r) => ({
        title: r.title,
        recommendation_type: r.recommendation_type,
        entity: r.entity,
        expected_impact: r.expected_impact,
        ageDays: age(r.created_at),
      })),
    oldestOpenDays: rows.length ? age(rows[0].created_at) : null,
  };
}

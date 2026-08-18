import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { adsQuery } from "./google-ads-autopilot.server";

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
  const openByKey = new Map(
    (openRows ?? []).map((r) => [`${r.recommendation_type}::${r.entity}`, r.id]),
  );

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase D: Wirkungsnachweis manueller Umsetzungen. ALLES deterministisch im
// Kern: Fenster-Laengen, Metriken je Empfehlungstyp und Verdict-Regeln stehen
// im Code - nie vom LLM gewaehlt. Der Agent zitiert Verdicts nur.
// Verdicts: improved | neutral | worsened | inconclusive - lieber ehrlich
// unentscheidbar (zu wenig Daten, Confounder) als falsch kausal.

export const OUTCOME_WINDOWS = [14, 30] as const;
const NEUTRAL_BAND = 0.1; // +-10% = neutral
const MIN_COST_FOR_VERDICT = 50; // CHF ueber beide Fenster, sonst zu wenig Daten

// Primaermetrik je Empfehlungstyp (Brief D): bid_* -> ROAS/CPA, asset_* -> CTR,
// keyword_pause -> eingesparte Kosten (ohne Conversion-Verlust), Rest -> CPA.
export const PRIMARY_METRIC: Record<string, "roas" | "cpa" | "ctr" | "cost_saved"> = {
  bid_target_adjustment: "roas",
  bid_strategy_change: "roas",
  bid_signal_gap: "cpa",
  asset_replace: "ctr",
  asset_coverage: "ctr",
  asset_pinning: "ctr",
  keyword_add: "cpa",
  keyword_pause: "cost_saved",
  keyword_match_change: "cpa",
  test_dummy: "roas",
  other: "cpa",
};

export type OutcomeWindowAgg = {
  costChf: number;
  conversions: number;
  conversionValue: number;
  clicks: number;
  impressions: number;
};

// Kampagne aus der Empfehlungs-Entitaet ableiten (v1: Kampagnen-Ebene).
// "Kampagne | AdGroup | Keyword" -> "Kampagne"; freie Entitaeten (z.B. ein
// Keyword-Gap oder "PMax Asset-Gruppe: X") sind nicht kampagnen-messbar -> null.
export function parseCampaignFromEntity(entity: string): string | null {
  const first = entity.split(" | ")[0]?.trim() ?? "";
  if (!first) return null;
  // Beschreibende Entitaeten ("PMax Asset-Gruppe: X", "Brand-Terms DE/EN") sind
  // KEINE Kampagnennamen - Ausschluss VOR der Praefix-Heuristik.
  if (/asset-gruppe|asset gruppe/i.test(first) || first.includes(":")) return null;
  // Heuristik: Kampagnennamen in diesem Konto-Schema beginnen mit Typ-Praefix
  if (/^(SN|PMax|Demand Gen)\b/i.test(first)) return first;
  return null;
}

// Verdict aus Vorher/Nachher-Fenstern (pure, testbar).
export function verdictFromWindows(
  recommendationType: string,
  before: OutcomeWindowAgg,
  after: OutcomeWindowAgg,
): {
  metric: string;
  before: number | null;
  after: number | null;
  deltaPct: number | null;
  verdict: "improved" | "neutral" | "worsened" | "inconclusive";
  reason: string;
} {
  const metric = PRIMARY_METRIC[recommendationType] ?? "cpa";
  if (before.costChf + after.costChf < MIN_COST_FOR_VERDICT)
    return {
      metric,
      before: null,
      after: null,
      deltaPct: null,
      verdict: "inconclusive",
      reason: `zu wenig Daten (Kosten beider Fenster < CHF ${MIN_COST_FOR_VERDICT})`,
    };

  const r2 = (n: number) => Math.round(n * 10000) / 10000;
  const roas = (w: OutcomeWindowAgg) => (w.costChf > 0 ? w.conversionValue / w.costChf : null);
  const cpa = (w: OutcomeWindowAgg) => (w.conversions > 0 ? w.costChf / w.conversions : null);
  const ctr = (w: OutcomeWindowAgg) => (w.impressions > 0 ? w.clicks / w.impressions : null);

  let b: number | null, a: number | null, higherIsBetter: boolean;
  if (metric === "roas") {
    b = roas(before);
    a = roas(after);
    higherIsBetter = true;
  } else if (metric === "cpa") {
    b = cpa(before);
    a = cpa(after);
    higherIsBetter = false;
  } else if (metric === "ctr") {
    b = ctr(before);
    a = ctr(after);
    higherIsBetter = true;
  } else {
    // cost_saved (keyword_pause): Kosten muessen sinken, ohne Conversions zu verlieren.
    const costDelta = before.costChf > 0 ? (after.costChf - before.costChf) / before.costChf : null;
    const convDelta =
      before.conversions > 0 ? (after.conversions - before.conversions) / before.conversions : 0;
    if (costDelta == null)
      return {
        metric,
        before: r2(before.costChf),
        after: r2(after.costChf),
        deltaPct: null,
        verdict: "inconclusive",
        reason: "keine Vorher-Kosten als Basis",
      };
    const verdict =
      costDelta < -NEUTRAL_BAND && convDelta > -NEUTRAL_BAND
        ? "improved"
        : costDelta > NEUTRAL_BAND
          ? "worsened"
          : convDelta < -NEUTRAL_BAND
            ? "worsened"
            : "neutral";
    return {
      metric,
      before: r2(before.costChf),
      after: r2(after.costChf),
      deltaPct: r2(costDelta * 100),
      verdict,
      reason: `Kosten ${(costDelta * 100).toFixed(0)}%, Conversions ${(convDelta * 100).toFixed(0)}%`,
    };
  }

  if (b == null && a == null)
    return {
      metric,
      before: null,
      after: null,
      deltaPct: null,
      verdict: "inconclusive",
      reason: `Primaermetrik ${metric} in beiden Fenstern nicht berechenbar (keine Basisdaten)`,
    };
  if (b == null || a == null || b === 0)
    return {
      metric,
      before: b == null ? null : r2(b),
      after: a == null ? null : r2(a),
      deltaPct: null,
      verdict: "inconclusive",
      reason: `Primaermetrik ${metric} nur in einem Fenster berechenbar`,
    };

  const delta = (a - b) / b;
  const improvedDir = higherIsBetter ? delta > NEUTRAL_BAND : delta < -NEUTRAL_BAND;
  const worsenedDir = higherIsBetter ? delta < -NEUTRAL_BAND : delta > NEUTRAL_BAND;
  return {
    metric,
    before: r2(b),
    after: r2(a),
    deltaPct: r2(delta * 100),
    verdict: improvedDir ? "improved" : worsenedDir ? "worsened" : "neutral",
    reason: `${metric} ${b.toFixed(3)} -> ${a.toFixed(3)} (${(delta * 100).toFixed(0)}%)`,
  };
}

// Zuordnungs-Vorschlaege: Konto-Aenderungen (ads_change_events, 14 Tage) gegen
// OFFENE Empfehlungen matchen (Entitaet + plausible Aenderungsart). NUR ein
// Vorschlag - die Bestaetigung ("als umgesetzt markieren") ist menschlich.
const PLAUSIBLE: Record<string, (e: { resourceType: string; isBidding: boolean }) => boolean> = {
  bid_target_adjustment: (e) => e.isBidding,
  bid_strategy_change: (e) => e.isBidding,
  bid_signal_gap: (e) => e.isBidding || /CONVERSION/i.test(e.resourceType),
  keyword_add: (e) => /CRITERION/i.test(e.resourceType),
  keyword_pause: (e) => /CRITERION/i.test(e.resourceType),
  keyword_match_change: (e) => /CRITERION/i.test(e.resourceType),
  asset_replace: (e) => /\bAD\b|AD_GROUP_AD|ASSET/i.test(e.resourceType),
  asset_coverage: (e) => /\bAD\b|AD_GROUP_AD|ASSET/i.test(e.resourceType),
  asset_pinning: (e) => /\bAD\b|AD_GROUP_AD|ASSET/i.test(e.resourceType),
};

export function matchImplementationSuggestions(
  openRecs: Array<{ id: string; recommendation_type: string; entity: string; title: string }>,
  events: Array<{
    campaign: string | null;
    occurred_at: string;
    user_email: string;
    resource_type: string;
    is_bidding_change: boolean;
  }>,
): Array<{
  recommendationId: string;
  title: string;
  entity: string;
  eventAt: string;
  eventUser: string;
  eventResourceType: string;
}> {
  const out: Array<{
    recommendationId: string;
    title: string;
    entity: string;
    eventAt: string;
    eventUser: string;
    eventResourceType: string;
  }> = [];
  for (const rec of openRecs) {
    const plausible = PLAUSIBLE[rec.recommendation_type] ?? (() => true);
    const firstSeg = rec.entity.split(" | ")[0]?.trim() ?? rec.entity;
    const hit = events.find(
      (e) =>
        e.campaign &&
        (rec.entity.includes(e.campaign) || e.campaign.includes(firstSeg)) &&
        plausible({ resourceType: e.resource_type, isBidding: e.is_bidding_change }),
    );
    if (hit)
      out.push({
        recommendationId: rec.id,
        title: rec.title,
        entity: rec.entity,
        eventAt: String(hit.occurred_at),
        eventUser: hit.user_email,
        eventResourceType: hit.resource_type,
      });
    if (out.length >= 5) break;
  }
  return out;
}

// Faellige Messungen rechnen (opportunistisch je Run; idempotent via Unique).
export async function computeRecommendationOutcomes(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
): Promise<{ measured: number; skipped: number }> {
  const res = { measured: 0, skipped: 0 };
  const { data: recs } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, recommendation_type, entity, implemented_at")
    .eq("client_id", clientId)
    .eq("status", "implemented")
    .not("implemented_at", "is", null);
  if (!recs?.length) return res;

  const { data: done } = await supabaseAdmin
    .from("ads_recommendation_outcomes")
    .select("recommendation_id, window_days")
    .eq("client_id", clientId);
  const doneKeys = new Set((done ?? []).map((d) => `${d.recommendation_id}|${d.window_days}`));

  for (const rec of recs) {
    const impl = new Date(rec.implemented_at as string);
    for (const w of OUTCOME_WINDOWS) {
      if (doneKeys.has(`${rec.id}|${w}`)) continue;
      const afterEnd = new Date(impl.getTime() + w * 86400000);
      if (afterEnd.getTime() > Date.now()) {
        res.skipped += 1;
        continue;
      } // Fenster laeuft noch

      const campaign = parseCampaignFromEntity(rec.entity);
      const insertBase = {
        recommendation_id: rec.id,
        client_id: clientId,
        window_days: w,
        campaign,
      };
      if (!campaign) {
        await supabaseAdmin.from("ads_recommendation_outcomes").insert({
          ...insertBase,
          metric_primary: PRIMARY_METRIC[rec.recommendation_type] ?? "cpa",
          verdict: "inconclusive",
          reason: "Entitaet nicht auf Kampagnen-Ebene messbar (v1 misst Kampagnen)",
        });
        res.measured += 1;
        continue;
      }

      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const day = 86400000;
      const beforeFrom = iso(new Date(impl.getTime() - w * day));
      const beforeTo = iso(new Date(impl.getTime() - day));
      const afterFrom = iso(impl);
      const afterTo = iso(new Date(impl.getTime() + (w - 1) * day));
      const agg = async (from: string, to: string): Promise<OutcomeWindowAgg> => {
        const r = await adsQuery(
          clientId,
          googleAdsCustomer,
          `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions
           FROM campaign WHERE campaign.name = '${campaign.replace(/'/g, "\\'")}' AND segments.date BETWEEN '${from}' AND '${to}'`,
        );
        const out: OutcomeWindowAgg = {
          costChf: 0,
          conversions: 0,
          conversionValue: 0,
          clicks: 0,
          impressions: 0,
        };
        for (const row of r.rows ?? []) {
          out.costChf += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
          out.conversions += Number(row.metrics?.conversions ?? 0);
          out.conversionValue += Number(row.metrics?.conversionsValue ?? 0);
          out.clicks += Number(row.metrics?.clicks ?? 0);
          out.impressions += Number(row.metrics?.impressions ?? 0);
        }
        return out;
      };
      const before = await agg(beforeFrom, beforeTo);
      const after = await agg(afterFrom, afterTo);

      // Confounder-Guard: weitere Konto-Aenderungen an derselben Kampagne im
      // Nachher-Fenster (ausserhalb +-2 Tage um die Umsetzung selbst) -> inconclusive.
      const { data: conf } = await supabaseAdmin
        .from("ads_change_events")
        .select("occurred_at")
        .eq("client_id", clientId)
        .eq("campaign", campaign)
        .gte("occurred_at", new Date(impl.getTime() + 2 * day).toISOString())
        .lte("occurred_at", afterEnd.toISOString())
        .limit(1);
      let v = verdictFromWindows(rec.recommendation_type, before, after);
      if ((conf?.length ?? 0) > 0 && v.verdict !== "inconclusive")
        v = {
          ...v,
          verdict: "inconclusive",
          reason: `Confounder: weitere Aenderungen an "${campaign}" im Messfenster - Wirkung nicht isolierbar (${v.reason})`,
        };

      await supabaseAdmin.from("ads_recommendation_outcomes").insert({
        ...insertBase,
        metric_primary: v.metric,
        before_value: v.before,
        after_value: v.after,
        delta_pct: v.deltaPct,
        metrics: { before, after } as unknown as Json,
        verdict: v.verdict,
        reason: v.reason,
      });
      res.measured += 1;
    }
  }
  return res;
}

// Report-Pflichtblock "Offene Massnahmen" (Brief Phase C): offen / umgesetzt /
// verworfen (Fenster ~ letzte Wochenkadenz), Top 5 offene, Alter der aeltesten.
export async function openRecommendationsBlock(clientId: string): Promise<{
  implementationSuggestions: Array<{
    recommendationId: string;
    title: string;
    entity: string;
    eventAt: string;
    eventUser: string;
    eventResourceType: string;
  }>;
  implemented: Array<{
    title: string;
    recommendation_type: string;
    entity: string;
    implementedAt: string | null;
    outcomes: Array<{
      window_days: number;
      verdict: string;
      delta_pct: number | null;
      metric_primary: string;
      reason: string;
    }>;
  }>;
  verdictsByType: Record<
    string,
    { improved: number; neutral: number; worsened: number; inconclusive: number }
  >;
  open: number;
  implementedLast8d: number;
  dismissedLast8d: number;
  top5: Array<{
    title: string;
    recommendation_type: string;
    entity: string;
    expected_impact: string | null;
    ageDays: number;
  }>;
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

  // Phase D: Zuordnungs-Vorschlaege (Bestaetigung Mensch) + Verdicts umgesetzter
  const { data: openFull } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, recommendation_type, entity, title")
    .eq("client_id", clientId)
    .eq("status", "open");
  const { data: events } = await supabaseAdmin
    .from("ads_change_events")
    .select("campaign, occurred_at, user_email, resource_type, is_bidding_change")
    .eq("client_id", clientId)
    .gte("occurred_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(100);
  const implementationSuggestions = matchImplementationSuggestions(
    openFull ?? [],
    (events ?? []) as never,
  );

  const { data: implRows } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, title, recommendation_type, entity, implemented_at")
    .eq("client_id", clientId)
    .eq("status", "implemented")
    .order("implemented_at", { ascending: false })
    .limit(10);
  const implIds = (implRows ?? []).map((r) => r.id);
  const { data: outcomes } = implIds.length
    ? await supabaseAdmin
        .from("ads_recommendation_outcomes")
        .select("recommendation_id, window_days, verdict, delta_pct, metric_primary, reason")
        .in("recommendation_id", implIds)
    : { data: [] as never[] };
  const outByRec = new Map<
    string,
    Array<{
      window_days: number;
      verdict: string;
      delta_pct: number | null;
      metric_primary: string;
      reason: string;
    }>
  >();
  for (const o of outcomes ?? []) {
    const l = outByRec.get(o.recommendation_id) ?? [];
    l.push(o as never);
    outByRec.set(o.recommendation_id, l);
  }
  const implemented = (implRows ?? []).map((r) => ({
    title: r.title,
    recommendation_type: r.recommendation_type,
    entity: r.entity,
    implementedAt: r.implemented_at,
    outcomes: (outByRec.get(r.id) ?? []).sort((a, b) => a.window_days - b.window_days),
  }));

  // Trefferquote je Typ (30d-Verdict bevorzugt, sonst 14d); test_dummy ausgenommen
  const { data: allImpl } = await supabaseAdmin
    .from("ads_recommendations")
    .select("id, recommendation_type")
    .eq("client_id", clientId)
    .eq("status", "implemented")
    .neq("recommendation_type", "test_dummy");
  const allIds = (allImpl ?? []).map((r) => r.id);
  const { data: allOut } = allIds.length
    ? await supabaseAdmin
        .from("ads_recommendation_outcomes")
        .select("recommendation_id, window_days, verdict")
        .in("recommendation_id", allIds)
    : { data: [] as never[] };
  const typeById = new Map((allImpl ?? []).map((r) => [r.id, r.recommendation_type]));
  const best = new Map<string, { window: number; verdict: string }>();
  for (const o of allOut ?? []) {
    const cur = best.get(o.recommendation_id);
    if (!cur || o.window_days > cur.window)
      best.set(o.recommendation_id, { window: o.window_days, verdict: o.verdict });
  }
  const verdictsByType: Record<
    string,
    { improved: number; neutral: number; worsened: number; inconclusive: number }
  > = {};
  for (const [recId, v] of best) {
    const ty = typeById.get(recId) ?? "other";
    const agg2 = (verdictsByType[ty] ??= { improved: 0, neutral: 0, worsened: 0, inconclusive: 0 });
    agg2[v.verdict as keyof typeof agg2] += 1;
  }

  return {
    implementationSuggestions,
    implemented,
    verdictsByType,
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

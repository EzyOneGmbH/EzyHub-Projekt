import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { adsQuery, loadConfig, normalizeTerm } from "./google-ads-autopilot.server";

// Phase 2: Deterministische Nachpruefung + Queueing semantischer Negative-
// Vorschlaege (LLM-bewertet im agent-service). Leitplanken (nicht verhandelbar):
// - IMMER approval-needed, nie auto-execute - unabhaengig vom autonomy_level.
// - Eigener action_type 'negative_keyword_semantic' (Scorecard getrennt).
// - Max. 15 Vorschlaege pro Run (eigenes Limit).
// - Konfliktcheck (blockiert der Term konvertierende Begriffe -> verwerfen),
//   no_touch, Dedupe gegen bestehende Negatives + offene Approvals.

export const MAX_SEMANTIC_PER_RUN = 15;
export const SEMANTIC_ACTION_TYPE = "negative_keyword_semantic";

export type SemanticProposal = {
  term: string;
  campaign: string;
  adGroup?: string;
  kategorie: string;
  begruendung: string;
  matchType: "EXACT" | "PHRASE";
  costChf: number;
  clicks: number;
};

export type SemanticCheckContext = {
  noTouch: Set<string>;
  convertingTerms: Array<{ term: string; campaign: string }>; // normalisiert
  existingNegatives: Set<string>; // normalisiert
  pendingKeys: Set<string>; // `${type}::${entity}` offener Approvals
};

export type SemanticDecision =
  | { action: "queue"; proposal: SemanticProposal }
  | { action: "reject"; proposal: SemanticProposal; reason: string };

// Pure, testbar: wendet alle deterministischen Leitplanken an.
export function checkSemanticProposals(proposals: SemanticProposal[], ctx: SemanticCheckContext): SemanticDecision[] {
  const out: SemanticDecision[] = [];
  const seenThisRun = new Set<string>();
  let queued = 0;
  for (const p of proposals) {
    const norm = normalizeTerm(p.term);
    if (!norm) {
      out.push({ action: "reject", proposal: p, reason: "leerer/unbrauchbarer Begriff" });
      continue;
    }
    if (ctx.noTouch.has(p.campaign.trim())) {
      out.push({ action: "reject", proposal: p, reason: `Kampagne "${p.campaign}" ist no_touch` });
      continue;
    }
    if (seenThisRun.has(norm)) {
      out.push({ action: "reject", proposal: p, reason: "Duplikat im selben Run" });
      continue;
    }
    if (ctx.existingNegatives.has(norm)) {
      out.push({ action: "reject", proposal: p, reason: "bereits als Negative vorhanden" });
      continue;
    }
    // Konfliktcheck: EXACT blockiert nur den exakten Begriff; PHRASE blockiert
    // jeden konvertierenden Begriff, der das Muster enthaelt.
    const conflict =
      p.matchType === "PHRASE"
        ? ctx.convertingTerms.find((t) => t.term.includes(norm))
        : ctx.convertingTerms.find((t) => t.term === norm);
    if (conflict) {
      out.push({
        action: "reject",
        proposal: p,
        reason: `Konflikt: wuerde konvertierenden Begriff "${conflict.term}" (Kampagne "${conflict.campaign}") blockieren`,
      });
      continue;
    }
    const dedupKey = `${SEMANTIC_ACTION_TYPE}::${p.campaign} | ${p.term}`;
    if (ctx.pendingKeys.has(dedupKey)) {
      out.push({ action: "reject", proposal: p, reason: "identischer Vorschlag wartet bereits auf Freigabe" });
      continue;
    }
    if (queued >= MAX_SEMANTIC_PER_RUN) {
      out.push({ action: "reject", proposal: p, reason: `Limit ${MAX_SEMANTIC_PER_RUN}/Run erreicht - naechster Lauf` });
      continue;
    }
    seenThisRun.add(norm);
    ctx.pendingKeys.add(dedupKey);
    queued += 1;
    out.push({ action: "queue", proposal: p });
  }
  return out;
}

export async function queueSemanticNegatives(p: {
  clientId: string;
  runId: string;
  proposals: SemanticProposal[];
}): Promise<{
  ok: boolean;
  queued: number;
  rejected: Array<{ term: string; reason: string }>;
  actions: Array<{ actionId: string; term: string; campaign: string; kategorie: string; costChf: number }>;
  error?: string;
}> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, google_ads_customer")
    .eq("id", p.clientId)
    .maybeSingle();
  if (!client) return { ok: false, queued: 0, rejected: [], actions: [], error: "Client not found" };
  const cfg = await loadConfig(p.clientId);
  const customerId = String(client.google_ads_customer ?? "").replace(/\D/g, "");

  // Konfliktbasis: konvertierende Suchbegriffe der letzten 37 Tage (Lag-robust).
  const conv = await adsQuery(
    p.clientId,
    client.google_ads_customer,
    `SELECT search_term_view.search_term, campaign.name, metrics.conversions
     FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.conversions > 0 LIMIT 500`,
  );
  const convertingTerms = (conv.rows ?? []).map((r) => ({
    term: normalizeTerm(String(r.searchTermView?.searchTerm ?? "")),
    campaign: String(r.campaign?.name ?? ""),
  }));

  // Bestehende Kampagnen-Negatives (Dedupe-Basis).
  const negs = await adsQuery(
    p.clientId,
    client.google_ads_customer,
    `SELECT campaign_criterion.keyword.text FROM campaign_criterion
     WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' LIMIT 1000`,
  );
  const existingNegatives = new Set(
    (negs.rows ?? []).map((r) => normalizeTerm(String(r.campaignCriterion?.keyword?.text ?? ""))).filter(Boolean),
  );

  // Offene Approvals (Dedupe).
  const { data: openAppr } = await supabaseAdmin
    .from("ads_approvals")
    .select("type, entity")
    .eq("client_id", p.clientId)
    .eq("status", "pending");
  const pendingKeys = new Set((openAppr ?? []).map((a) => `${a.type}::${a.entity ?? ""}`));

  const decisions = checkSemanticProposals(p.proposals, {
    noTouch: new Set(cfg.no_touch_campaigns.map((c) => c.trim()).filter(Boolean)),
    convertingTerms,
    existingNegatives,
    pendingKeys,
  });

  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const result = { ok: true, queued: 0, rejected: [] as Array<{ term: string; reason: string }>, actions: [] as Array<{ actionId: string; term: string; campaign: string; kategorie: string; costChf: number }> };

  for (const d of decisions) {
    if (d.action === "reject") {
      result.rejected.push({ term: d.proposal.term, reason: d.reason });
      // Verworfene Konflikte transparent ins Changelog (report-only, wie Rule 1).
      if (d.reason.startsWith("Konflikt")) {
        await supabaseAdmin.from("ads_changelog").insert({
          client_id: p.clientId, customer_id: customerId, run_id: p.runId,
          action_type: "negative_conflict", action_class: "report-only",
          entity: `${d.proposal.campaign} | semantisch`, before_value: "",
          after_value: `NICHT ausschliessen: "${d.proposal.term}"`,
          rationale: `${d.reason} - semantischer Vorschlag (${d.proposal.kategorie}) verworfen.`,
          status: "rejected",
        });
      }
      continue;
    }
    const pr = d.proposal;
    const entity = `${pr.campaign} | ${pr.term}`;
    const rationale =
      `Semantischer Vorschlag (Kategorie: ${pr.kategorie}): ${pr.begruendung} ` +
      `Der Begriff hat bisher CHF ${pr.costChf.toFixed(2)} gekostet (${pr.clicks} Klicks) ohne eine einzige Conversion. ` +
      `Ausschluss als ${pr.matchType === "PHRASE" ? "Phrase (blockiert das gesamte Wortmuster)" : "Exact (blockiert nur genau diesen Begriff)"} - ` +
      `LLM-bewertet, deshalb IMMER Freigabe durch einen Menschen.`;
    const actionId = `s-${String(result.queued + 1).padStart(3, "0")}`;
    const { data: logRow } = await supabaseAdmin
      .from("ads_changelog")
      .insert({
        client_id: p.clientId, customer_id: customerId, run_id: p.runId,
        action_type: SEMANTIC_ACTION_TYPE, action_class: "approval-needed", entity,
        before_value: "", after_value: `+ "${pr.term}" (negative ${pr.matchType.toLowerCase()})`,
        rationale, status: "pending",
      })
      .select("id").maybeSingle();
    await supabaseAdmin.from("ads_approvals").insert({
      client_id: p.clientId, customer_id: customerId, run_id: p.runId, action_id: actionId,
      type: SEMANTIC_ACTION_TYPE, entity, current_value: "", proposed_value: `+ "${pr.term}" (negative ${pr.matchType.toLowerCase()})`,
      rationale, estimated_impact: `Vermeidet kuenftige Verschwendung (~CHF ${pr.costChf.toFixed(0)}/30d des Begriffs)`,
      payload: { kind: "negative", campaign: pr.campaign, term: pr.term, matchType: pr.matchType, semantic: true },
      status: "pending", expires_at: expires, changelog_id: logRow?.id ?? null,
    });
    result.queued += 1;
    result.actions.push({ actionId, term: pr.term, campaign: pr.campaign, kategorie: pr.kategorie, costChf: pr.costChf });
  }
  return result;
}

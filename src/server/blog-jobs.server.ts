// Blog-Autopilot: Hintergrund-Jobs im minütlichen Worker. Zuerst Website-
// Analysen (jemand wartet live im Onboarding), dann KI-Audits; montags werden
// die Wochen-Audits aktiver Projekte angelegt. Danach die Schreib-Pipeline
// (Themen bis morgen werden eingeplant). Ohne offene Jobs kehrt der Tick
// sofort zurück.
import type { TickErgebnis } from "./worker-scheduler.server";
import { tickeBlogAnalysen } from "./blog-analysis.server";
import { planeWochenAudits, tickeKeywordAudits } from "./blog-audit.server";
import { planeArtikel, planeNachpruefung, tickeBlogArtikel } from "./blog-pipeline.server";

export async function tickeBlogJobs(budgetMs: number): Promise<TickErgebnis> {
  const start = Date.now();
  await planeWochenAudits().catch(() => 0);
  const a = await tickeBlogAnalysen(budgetMs);
  const b = await tickeKeywordAudits(budgetMs - (Date.now() - start));
  await planeArtikel().catch(() => 0);
  await planeNachpruefung().catch(() => 0);
  const c = await tickeBlogArtikel(budgetMs - (Date.now() - start));
  return {
    getickt: a.getickt + b.getickt + c.getickt,
    fertig: a.fertig + b.fertig + c.fertig,
    fehler: a.fehler + b.fehler + c.fehler,
  };
}

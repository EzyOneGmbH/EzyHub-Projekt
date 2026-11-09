// Blog-Autopilot: Hintergrund-Jobs im minütlichen Worker (Website-Analyse,
// später KI-Audit). Ohne offene Jobs kehrt der Tick sofort zurück.
import type { TickErgebnis } from "./worker-scheduler.server";
import { tickeBlogAnalysen } from "./blog-analysis.server";

export async function tickeBlogJobs(budgetMs: number): Promise<TickErgebnis> {
  return tickeBlogAnalysen(budgetMs);
}

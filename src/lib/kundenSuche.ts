// Kundensuche in den Agentur-Übersichten (EzyRank, EzyPerformance, EzyAI).
// Filtert nur die Liste, die für die Rolle ohnehin geladen ist.

/** Klein, ohne Akzente/Umlaut-Punkte, getrimmt: «Zürich» passt auf «zurich». */
export function normSuche(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Jedes Suchwort muss in einem der Felder vorkommen; leere Suche passt immer. */
export function passtZurSuche(suche: unknown, ...felder: unknown[]): boolean {
  const worte = normSuche(suche).split(/\s+/).filter(Boolean);
  if (!worte.length) return true;
  const text = felder.map(normSuche).join(" ");
  return worte.every((w) => text.includes(w));
}

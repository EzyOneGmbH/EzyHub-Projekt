// Chancen-Workflow (18.08.2026): Status-Modell + stabiler Fingerprint.
//
// Die Chancen-Queue in EzyAI ist ABGELEITET (Site Health, KI-Zitat-Gaps,
// Prompt-Chancen, Kurations-Aufgaben) — es gibt keine Chancen-Tabelle mit
// eigenen IDs. Damit ein gesetzter Status (in Bearbeitung, erledigt, …) einen
// Reload und den nächsten Messlauf überlebt, bekommt jede Chance einen
// deterministischen Fingerprint aus ihrer Art + ihrem stabilen Kern (z. B.
// Issue-ID, Rivalen-Name, Prompt-Text). Gleiches Signal ⇒ gleicher Fingerprint
// ⇒ gleicher Workflow-Zustand in ai_opportunity_states.

export type OppStatus = "offen" | "in_bearbeitung" | "pausiert" | "erledigt" | "verworfen";

export const OPP_STATUS: Array<{ id: OppStatus; label: string; color: string }> = [
  { id: "offen", label: "Offen", color: "#6366f1" },
  { id: "in_bearbeitung", label: "In Bearbeitung", color: "#f59e0b" },
  { id: "pausiert", label: "Pausiert", color: "#64748b" },
  { id: "erledigt", label: "Erledigt", color: "#0f9d6c" },
  { id: "verworfen", label: "Verworfen", color: "#9ca3af" },
];

// FNV-1a (32 Bit) — klein, deterministisch, ohne Dependencies. Kollisionen
// sind bei den wenigen Dutzend Chancen pro Kunde praktisch ausgeschlossen,
// zumal der Fingerprint zusätzlich die Chancen-Art als Präfix trägt.
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Kern normalisieren, damit kosmetische Unterschiede (Whitespace, Groß-/
// Kleinschreibung) den Fingerprint nicht ändern.
function normalizeKey(key: string): string {
  return String(key || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function oppFingerprint(kind: string, key: string): string {
  return `${kind}:${fnv1a(normalizeKey(key))}`;
}

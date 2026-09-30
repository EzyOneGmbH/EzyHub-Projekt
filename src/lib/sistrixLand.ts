// Sistrix-Land je Kunde (30.09.2026, Volkan): welcher Sistrix-Sichtbarkeitsindex
// fuer den Visibility Index gilt. Standard Schweiz; Romandie-Kunden mit
// franzoesischer Website (z. B. Hotel des Horlogers) haben im CH-Index oft 0 und
// werden ueber den franzoesischen Index gemessen. Gespeichert in
// clients.metadata.sistrix_country; fehlend = «ch».

export const SISTRIX_LAND_FELD = "sistrix_country";

export type SistrixLandId = "ch" | "fr" | "de" | "at" | "it";

export const SISTRIX_LAENDER: ReadonlyArray<{ id: SistrixLandId; label: string }> = [
  { id: "ch", label: "Schweiz" },
  { id: "fr", label: "Frankreich" },
  { id: "de", label: "Deutschland" },
  { id: "at", label: "Österreich" },
  { id: "it", label: "Italien" },
];

export const SISTRIX_LAND_STANDARD: SistrixLandId = "ch";

export function istSistrixLand(v: unknown): v is SistrixLandId {
  return SISTRIX_LAENDER.some((l) => l.id === v);
}

/** Sistrix-Land eines Kunden aus metadata (Standard «ch»). */
export function sistrixLandVon(metadata: unknown): SistrixLandId {
  if (!metadata || typeof metadata !== "object") return SISTRIX_LAND_STANDARD;
  const v = String((metadata as Record<string, unknown>)[SISTRIX_LAND_FELD] ?? "")
    .trim()
    .toLowerCase();
  return istSistrixLand(v) ? v : SISTRIX_LAND_STANDARD;
}

export function sistrixLandLabel(id: string | null | undefined): string {
  return SISTRIX_LAENDER.find((l) => l.id === id)?.label ?? "Schweiz";
}

/** Neues metadata-Objekt mit gesetztem Land — Standard «ch» entfernt das Feld. */
export function mitSistrixLand(metadata: unknown, land: SistrixLandId): Record<string, unknown> {
  const basis =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  if (land === SISTRIX_LAND_STANDARD) delete basis[SISTRIX_LAND_FELD];
  else basis[SISTRIX_LAND_FELD] = land;
  return basis;
}

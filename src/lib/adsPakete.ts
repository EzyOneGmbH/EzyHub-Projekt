// EzyPerformance-Pakete (28.09.2026, Volkan): Leistungsstufe je Ads-Kunde.
// Gespeichert in clients.metadata.ads_package; fehlend = kein Paket.

export const ADS_PAKET_FELD = "ads_package";

export type AdsPaketId = "starter" | "medium" | "performance";

export const ADS_PAKETE: ReadonlyArray<{ id: AdsPaketId; label: string }> = [
  { id: "starter", label: "Starter" },
  { id: "medium", label: "Medium" },
  { id: "performance", label: "Performance" },
];

export function istAdsPaket(v: unknown): v is AdsPaketId {
  return ADS_PAKETE.some((p) => p.id === v);
}

/** Paket eines Kunden aus metadata (tolerant gegen Gross-/Kleinschreibung). */
export function adsPaketVon(metadata: unknown): AdsPaketId | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = String((metadata as Record<string, unknown>)[ADS_PAKET_FELD] ?? "")
    .trim()
    .toLowerCase();
  return istAdsPaket(v) ? v : null;
}

export function adsPaketLabel(id: AdsPaketId | null | undefined): string {
  return ADS_PAKETE.find((p) => p.id === id)?.label ?? "Kein Paket";
}

/** Neues metadata-Objekt mit gesetztem/entferntem Paket — alle anderen Felder bleiben. */
export function mitAdsPaket(metadata: unknown, paket: AdsPaketId | null): Record<string, unknown> {
  const basis =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  if (paket) basis[ADS_PAKET_FELD] = paket;
  else delete basis[ADS_PAKET_FELD];
  return basis;
}

// Typ-Begleiter für SeoAgencyTable.jsx (Muster wie ToolActions.d.ts) — nötig,
// damit TS-Testdateien die Komponente importieren können.
import type { ComponentType } from "react";

export declare const SeoAgencyTable: ComponentType<{
  clients: Array<{ id: string; name?: string; domain?: string | null; [k: string]: unknown }>;
  dateRange: {
    start?: Date | string | null;
    end?: Date | string | null;
    compare?: { start?: Date | string | null; end?: Date | string | null } | null;
    compareMode?: string | null;
  } | null;
  onSelect?: (id: string) => void;
  onCompareMode?: ((mode: string) => void) | null;
}>;

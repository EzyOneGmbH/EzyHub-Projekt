// Typ-Begleiter für ConversionScoutPanel.jsx (Muster wie SeoAgencyTable.d.ts) — nötig,
// damit TS-Testdateien die Komponente importieren können.
import type { ComponentType } from "react";

declare const ConversionScoutPanel: ComponentType<{
  selectedClient: { id: string; [k: string]: unknown } | null;
}>;
export default ConversionScoutPanel;

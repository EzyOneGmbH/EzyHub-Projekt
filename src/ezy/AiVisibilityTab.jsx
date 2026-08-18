// KI-Sichtbarkeits-Tab (aus EzyOneApp.jsx extrahiert, 18.08.2026): schlanker
// Wrapper um AIVisibilityDashboard — /ezyai laedt damit nicht mehr den
// Monolith-Chunk.
import AIVisibilityReport, { AIVisibilitySkeleton } from "@/ezy/AIVisibilityDashboard.jsx";
import { useEzyAIVisibility } from "@/ezy/data/useEzyAIVisibility";
import { useEzyLatestRun, ga4ConversionsFromResult } from "@/ezy/data/useEzyLatestRun";

export function AiVisibilityTab({ selectedClient, navStyle, onReviewPrompts }) {
  const { data, loading, error } = useEzyAIVisibility(
    selectedClient?.id,
    selectedClient?.domain || selectedClient?.name,
  );
  // Conversion-Einzelzeilen (Titel/Datum/Wert/Land/Gerät) aus DEMSELBEN
  // ga4_conversions-Lauf wie der Conversions-Tab — das Attribution-Panel
  // filtert sie clientseitig nach KI-Quellen (identische Datenbasis).
  const { run: convRun } = useEzyLatestRun(selectedClient?.id, "ga4_conversions");
  const convRows = convRun ? (ga4ConversionsFromResult(convRun.result)?.rows ?? []) : [];
  // EINE kombinierte Ansicht: Ahrefs + Semrush + Canonry + Prompt-Runner werden im
  // Backend/Loader zusammengeführt (Canonry-Provider fließen in die Modell-Verteilung,
  // -Quellen, -Konkurrenten). Kein separater GEO-Tab / keine gestapelte Sektion mehr.
  if (loading) return <AIVisibilitySkeleton />;
  // AI-Zitationen-Panel (Modul 2, Stadt-/Kategorie-Ebene) auf Wunsch entfernt (04.08.).
  return (
    <AIVisibilityReport data={data && !error ? data : null} convRows={convRows} navStyle={navStyle} onReviewPrompts={onReviewPrompts} />
  );
}

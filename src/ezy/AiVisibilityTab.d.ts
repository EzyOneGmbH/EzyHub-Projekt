// Typdeklaration fuer den extrahierten KI-Sichtbarkeits-Tab (18.08.2026).
import type { ReactElement } from "react";

export declare function AiVisibilityTab(props: {
  selectedClient: { id: string; name?: string; domain?: string } | null;
  /** Navigations-Variante des Reports (z. B. "topbar"). */
  navStyle?: string;
  onReviewPrompts?: () => void;
}): ReactElement;

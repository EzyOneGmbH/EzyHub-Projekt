// Typdeklaration fuer den extrahierten KI-Sichtbarkeits-Tab (18.08.2026).
import type { ComponentType, ReactElement, ReactNode } from "react";

export declare function AiVisibilityTab(props: {
  selectedClient: { id: string; name?: string; domain?: string } | null;
  /** Navigations-Variante des Reports (z. B. "topbar"). */
  navStyle?: string;
  onReviewPrompts?: () => void;
  /** Datumsfilter des Hubs (23.09.): Conversions-Tab laedt Besucher/Conversions live fuer diesen Zeitraum. */
  range?: { days: number; start: Date; end: Date; preset: string; label: string };
  /** Zusatz-Tabs neben Conversions (14.09.): z. B. Traffic — rendern ihren Inhalt selbst. */
  extraTabs?: Array<{
    id: string;
    label: string;
    icon?: ComponentType<any>;
    render: () => ReactNode;
  }>;
}): ReactElement;

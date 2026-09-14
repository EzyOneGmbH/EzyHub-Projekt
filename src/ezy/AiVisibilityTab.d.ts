// Typdeklaration fuer den extrahierten KI-Sichtbarkeits-Tab (18.08.2026).
import type { ComponentType, ReactElement, ReactNode } from "react";

export declare function AiVisibilityTab(props: {
  selectedClient: { id: string; name?: string; domain?: string } | null;
  /** Navigations-Variante des Reports (z. B. "topbar"). */
  navStyle?: string;
  onReviewPrompts?: () => void;
  /** Zusatz-Tabs neben Conversions (14.09.): z. B. Traffic — rendern ihren Inhalt selbst. */
  extraTabs?: Array<{
    id: string;
    label: string;
    icon?: ComponentType<any>;
    render: () => ReactNode;
  }>;
}): ReactElement;

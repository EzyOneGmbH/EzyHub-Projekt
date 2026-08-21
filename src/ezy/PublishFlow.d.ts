// Typ-Begleiter für PublishFlow.jsx (Muster wie EzyOneApp.d.ts) — nötig, damit
// TS-Testdateien (Integrationstests 2026-08-21) die Komponente importieren können.
import type { ComponentType } from "react";

declare const WordPressPublishModal: ComponentType<{
  clientId: string;
  defaultTitle?: string;
  markdown?: string;
  onClose?: () => void;
  notify?: (msg: string, type?: string) => void;
  zIndex?: number;
}>;
export default WordPressPublishModal;

export function friendlyWpError(msg: unknown): string;

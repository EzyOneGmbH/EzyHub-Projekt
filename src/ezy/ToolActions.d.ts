// Typ-Begleiter für ToolActions.jsx (Muster wie EzyOneApp.d.ts) — nötig, damit
// TS-Testdateien (Integrationstests 2026-08-21) die Komponente importieren können.
import type { ComponentType } from "react";

declare const ToolActions: ComponentType<{
  text?: string | null;
  raw?: unknown;
  filename?: string;
  notify?: (msg: string, type?: string) => void;
  onSaveDraft?: () => void | Promise<void>;
  draftState?: { saved: boolean; saving: boolean };
  onOpenEditor?: () => void;
  onWordPress?: () => void;
  onClose?: () => void;
}>;
export default ToolActions;

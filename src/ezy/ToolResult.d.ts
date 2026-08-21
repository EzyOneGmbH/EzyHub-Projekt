// Typ-Begleiter für ToolResult.jsx (Muster wie EzyOneApp.d.ts) — nötig, damit
// TS-Testdateien (Integrationstests 2026-08-21) die Komponente importieren können.
import type { ComponentType } from "react";
import type { ToolRunResult } from "@/ezy/data/runTool";

export function MdView(props: { md: string }): ReturnType<ComponentType>;

declare const ToolResultView: ComponentType<{ result: ToolRunResult | null }>;
export default ToolResultView;

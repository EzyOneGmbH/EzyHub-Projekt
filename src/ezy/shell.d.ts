// Typ-Oberflaeche der Redesign-Shell (21.08.2026) — Implementierung ist .jsx.
import type * as React from "react";

export const APP_GLYPHS: Record<
  "seo" | "geo" | "analyse" | "ads" | "reakt" | "admin",
  React.ComponentType<{ size?: number; color?: string }>
>;
export const EzyHexMark: React.ComponentType<{ size?: number }>;
export const AppRail: React.ComponentType<any>;
export const SegmentedTabs: React.ComponentType<any>;
export const StatusPill: React.ComponentType<any>;
export const PosBadge: React.ComponentType<{ pos: number | string }>;
export const ScoreRing: React.ComponentType<{
  value: number;
  size?: number;
  color?: string;
  label?: string;
}>;
export const ToggleSwitch: React.ComponentType<any>;

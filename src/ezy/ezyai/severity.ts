// Severity-/Score-Darstellung fuer EzyAI (QS-Runde 13.09.2026): aus ezyai.tsx
// herausgeloest, gemeinsam genutzt von SiteHealthPanel, NotificationsBell und
// den Chancen-Panels.
export const SEV_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  kritisch: { bg: "#fde8e8", fg: "#b91c1c", label: "Kritisch" },
  hoch: { bg: "#fdf0e3", fg: "#b45309", label: "Hoch" },
  mittel: { bg: "#fdf6e3", fg: "#8a6d1b", label: "Mittel" },
  niedrig: { bg: "#e8f0fd", fg: "#1d4ed8", label: "Niedrig" },
};
export const scoreColor = (v: number) =>
  v >= 90 ? "#0f9d6c" : v >= 70 ? "#6aa84f" : v >= 50 ? "#d97706" : v >= 30 ? "#ea580c" : "#dc2626";
export const scoreLabel = (v: number) =>
  v >= 90
    ? "Ausgezeichnet"
    : v >= 70
      ? "Gut"
      : v >= 50
        ? "Befriedigend"
        : v >= 30
          ? "Schlecht"
          : "Kritisch";

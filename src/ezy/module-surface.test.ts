// Modularisierung 2 (21.08.2026): sichert die Lazy-Import-Oberflaeche ab —
// jede Komponente, die EzyOneApp per React.lazy nachlaedt, muss von ihrem
// Modul exportiert werden (ein Tippfehler wuerde sonst erst beim Tab-Klick
// in Produktion knallen).
import { describe, it, expect } from "vitest";

const ERWARTET: Record<string, string[]> = {
  "./AdminClients": ["AgentRunsPanel", "ClientsPage", "MatrixPage", "ClientReadinessPanel"],
  "./AdminSettings": ["SettingsPage", "SystemCheckPanel"],
  "./AdsDashboardModule": ["AdsDashboard"],
  "./ContentModule": ["ContentPage", "RefreshRadar", "ReportsPage", "ContentEditor"],
  "./RankDashboards": [
    "AgencyOverview",
    "ConvDashboard",
    "OverviewDashboard",
    "SeoDashboard",
    "GeoDashboard",
  ],
  "./ui-kit": ["Modal", "Inp", "TabBar", "KpiCard", "ChartCard", "DateRangePicker", "seriesDelta"],
};

describe("Bereichs-Module exportieren ihre Lazy-Oberflaeche", () => {
  for (const [mod, namen] of Object.entries(ERWARTET)) {
    // 30s-Timeout: der erste Import eines grossen Moduls transformiert kalt >5s.
    it(mod, { timeout: 30_000 }, async () => {
      const m: Record<string, unknown> = await import(/* @vite-ignore */ mod);
      for (const n of namen) {
        expect(typeof m[n], `${mod} → ${n}`).toMatch(/function|object/);
      }
    });
  }
});

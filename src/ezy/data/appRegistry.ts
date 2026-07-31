// Plattform-Umbau Phase 1 (2026-07-31): zentrale App-Definition für Launcher
// und App-Switcher. Deep-Links zeigen vorerst auf die heutigen Ansichten —
// eigene Routen-Namespaces kommen in Phase 2/3.
export type EzyAppId = "seo" | "geo" | "ads" | "reakt" | "admin";

export type EzyAppDef = {
  id: EzyAppId;
  name: string;
  desc: string;
  icon: string; // Emoji reicht für Phase 1 — Icons folgen mit den App-Shells
  color: string;
  tint: string;
  /** Ziel innerhalb der heutigen App: /dashboard?app=<id> wird dort gemappt */
  href: string;
  /** Nur owner/admin (isOrgAdmin) — nicht über app_access schaltbar */
  adminOnly?: boolean;
};

// Produktnamen (Volkan 31.07.): EzyRank/EzyAI/EzyPerformance = etablierte
// Produktlinien (awork-Projekttypen); Reaktivierung/Admin haben keine.
export const EZY_APPS: EzyAppDef[] = [
  {
    id: "seo",
    name: "EzyRank",
    desc: "SEO: Rankings, GSC-Suchbegriffe, Blog / Refresh-Radar, Conversions",
    icon: "🔍",
    color: "#38bdf8",
    tint: "rgba(56,189,248,.15)",
    href: "/dashboard?app=seo",
  },
  {
    id: "geo",
    name: "EzyAI",
    desc: "KI-Sichtbarkeit: aivis-Score, 6-Engine-Prompts, Marken-Check",
    icon: "🤖",
    color: "#a78bfa",
    tint: "rgba(167,139,250,.15)",
    href: "/ezyai", // Phase 2: eigene App-Route (vorher /dashboard?app=geo)
  },
  {
    id: "ads",
    name: "EzyPerformance",
    desc: "Ads: Google-Ads-Dashboard, Autopilot-Reports, Budgets",
    icon: "📢",
    color: "#fb923c",
    tint: "rgba(251,146,60,.15)",
    href: "/dashboard?app=ads",
  },
  {
    id: "reakt",
    name: "Reaktivierung",
    desc: "GEO-Beweis-Kampagnen: Läufe, Entwürfe, Zeitplan",
    icon: "✉️",
    color: "#34d399",
    tint: "rgba(52,211,153,.15)",
    href: "/dashboard?app=reakt",
  },
  {
    id: "admin",
    name: "Admin",
    desc: "Kunden & Services, Team & Zugriffe, Agenten, Einstellungen",
    icon: "⚙️",
    color: "#94a3b8",
    tint: "rgba(148,163,184,.15)",
    href: "/dashboard?app=admin",
    adminOnly: true,
  },
];

/** Startzustand in der heutigen EzyOneApp je App (Phase-1-Deep-Link).
 *  geo fehlt bewusst: EzyAI ist seit Phase 2 eine eigene Route (/ezyai) —
 *  alte ?app=geo-Links leitet EzyOneApp dorthin um. */
export const APP_START: Record<string, { page: string; tab?: string }> = {
  seo: { page: "dashboard", tab: "seo" },
  ads: { page: "dashboard", tab: "ads" },
  reakt: { page: "dashboard", tab: "runs" },
  admin: { page: "clients" },
};

/** Umkehrung für den Switcher: in welcher App steckt der Nutzer gerade? */
export function currentAppOf(page: string, tab: string): EzyAppId {
  if (page === "clients" || page === "team" || page === "settings" || page === "agents") return "admin";
  if (page === "dashboard") {
    if (tab === "ads") return "ads";
    if (tab === "runs") return "reakt";
  }
  return "seo";
}

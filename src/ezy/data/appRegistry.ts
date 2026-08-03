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
    color: "#0284c7", // Light Studio: kräftigere Akzente für hellen Grund (03.08.)
    tint: "rgba(2,132,199,.10)",
    href: "/ezyrank", // Phase 3: eigene App-Route
  },
  {
    id: "geo",
    name: "EzyAI",
    desc: "KI-Sichtbarkeit: aivis-Score, 6-Engine-Prompts, Marken-Check",
    icon: "🤖",
    color: "#7c3aed",
    tint: "rgba(124,58,237,.10)",
    href: "/ezyai", // Phase 2: eigene App-Route (vorher /dashboard?app=geo)
  },
  {
    id: "ads",
    name: "EzyPerformance",
    desc: "Ads: Google-Ads-Dashboard, Autopilot-Reports, Budgets",
    icon: "📢",
    color: "#ea580c",
    tint: "rgba(234,88,12,.10)",
    href: "/ezyperformance", // Phase 3: eigene App-Route
  },
  {
    id: "reakt",
    name: "Reaktivierung",
    desc: "GEO-Beweis-Kampagnen: Läufe, Entwürfe, Zeitplan",
    icon: "✉️",
    color: "#059669",
    tint: "rgba(5,150,105,.10)",
    href: "/reakt", // Phase 3: Interims-Route (echte UI kommt in Phase 4)
  },
  {
    id: "admin",
    name: "Admin",
    desc: "Kunden & Services, Team & Zugriffe, Agenten, Einstellungen",
    icon: "⚙️",
    color: "#64748b",
    tint: "rgba(100,116,139,.12)",
    href: "/admin", // Phase 3: eigene App-Route
    adminOnly: true,
  },
];

/** Phase 3 (31.07.): EzyOneApp wird zur Engine — jeder Scope filtert die
 *  Haupt-Navigation (pages) und die Dashboard-Tabs (tabs) der jeweiligen App.
 *  Conversions bewusst in EzyRank UND EzyPerformance (Volkan-Entscheid 31.07.).
 *  copilot/tools bleiben app-übergreifend verfügbar. */
export const APP_SCOPES: Record<string, { pages: string[]; tabs: string[]; primary: string; home: string; services?: string[] }> = {
  seo: {
    pages: ["dashboard", "copilot", "tasks", "tools", "content"],
    tabs: ["overview", "seo", "blog", "conversions"],
    primary: "seo", // umgeht die Kunden-Tab-Auswahl (Kern-Tab der App)
    home: "/ezyrank",
    // kein services-Filter: SEO ist das Kernprodukt — alle Kunden sichtbar
  },
  ads: {
    // Volkan 01.08.: NUR Ads — ohne Übersicht/Conversions (Conversions lebt in EzyRank)
    pages: ["dashboard", "copilot", "tools"],
    tabs: ["ads"],
    primary: "ads",
    home: "/ezyperformance",
    services: ["google-ads"], // nur Kunden mit aktiviertem Google-Ads-Service
  },
  reakt: {
    pages: ["dashboard"],
    tabs: ["runs"],
    primary: "runs",
    home: "/reakt",
  },
  admin: {
    pages: ["dashboard", "clients", "team", "agents", "settings", "copilot", "tools"],
    tabs: ["runs"],
    primary: "runs",
    home: "/admin",
  },
};

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

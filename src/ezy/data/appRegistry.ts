// Plattform-Umbau Phase 1 (2026-07-31): zentrale App-Definition für Launcher
// und App-Switcher. Deep-Links zeigen vorerst auf die heutigen Ansichten —
// eigene Routen-Namespaces kommen in Phase 2/3.
export type EzyAppId = "seo" | "geo" | "analyse" | "ads" | "reakt" | "admin";

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
  /** Rein internes Team-Tool: taucht NIE in Kunden-App-Matrizen/Portal auf */
  internalOnly?: boolean;
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
    // EzyAI – Analyse (14.08.2026): Pre-Onboarding-Schnellaudit fuer Leads —
    // rein internes Team-Tool (nie kundenfaehig, internalOnly).
    id: "analyse",
    name: "Analyse",
    desc: "Lead-Pre-Check: AI-Sichtbarkeit, SiteHealth, Entität, Benchmark",
    icon: "📡",
    color: "#77008C",
    tint: "rgba(119,0,140,.10)",
    href: "/ezyai-analyse",
    internalOnly: true,
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
export const APP_SCOPES: Record<
  string,
  {
    pages: string[];
    tabs: string[];
    primary: string;
    home: string;
    services?: string[];
    skillCats?: string[];
  }
> = {
  seo: {
    // Projekt/AWORK "tasks" vorerst deaktiviert (Volkan 22.08.) — bei Bedarf
    // wieder ergänzen (+ NAV-Zeile in EzyOneApp).
    // Content-Tab deaktiviert (Volkan 24.08.): NUR die NAV-Zeile in EzyOneApp
    // ist auskommentiert; "content" bleibt hier im Scope, damit der Deep-Link
    // "Im Editor weiterbearbeiten" (ToolRunner → Entwurf) nicht vom
    // Scope-Guard auf das Dashboard zurückgeworfen wird.
    pages: ["dashboard", "copilot", "tools", "content"],
    // Volkan 10.08.: Übersicht-Tab raus — EzyRank startet direkt im SEO-Tab.
    // Local Grid (17.08.): Maps-Heatmap aus dem Geo-Grid-Scan, opt-in je Kunde.
    tabs: ["seo", "blog", "localgrid", "conversions"],
    primary: "seo", // umgeht die Kunden-Tab-Auswahl (Kern-Tab der App)
    home: "/ezyrank",
    // kein services-Filter: SEO ist das Kernprodukt — alle Kunden sichtbar
    // App-Split (Volkan 06.08.): EzyRank = SEO/Content — KEINE geo-(KI)- und
    // keine Ads-Skills mehr; die leben in EzyAI bzw. EzyPerformance.
    skillCats: [
      "audit",
      "technical",
      "content",
      "obsidian",
      "skills-seo",
      "skills-blog",
      "skills-obsidian",
    ],
  },
  ads: {
    // Volkan 01.08.: NUR Ads — ohne Übersicht/Conversions (Conversions lebt in EzyRank)
    pages: ["dashboard", "copilot", "tools"],
    tabs: ["ads"],
    primary: "ads",
    home: "/ezyperformance",
    services: ["google-ads"], // nur Kunden mit aktiviertem Google-Ads-Service
    // App-Split (Volkan 06.08.): EzyPerformance = nur Ads-Skills.
    skillCats: ["skills-ads"],
  },
  reakt: {
    pages: ["dashboard"],
    tabs: ["runs"],
    primary: "runs",
    home: "/reakt",
  },
  admin: {
    // Admin-Umbau (Volkan 06.08.): reiner Verwaltungs-Bereich — Dashboard/
    // Copilot/AI-Tools raus. "agents" bleibt im Scope (erreichbar über
    // Einstellungen → Agenten & Automatisierung), aber nicht in der Nav.
    pages: ["clients", "team", "matrix", "settings", "agents"],
    tabs: [],
    primary: "clients",
    home: "/admin",
  },
};

/** Funktions-Katalog je App (Admin-Umbau 06.08.): welche Funktionen ein Kunde
 *  freigeschaltet bekommen kann (client_app_access.features). Die IDs sind an
 *  Dashboard-Tabs/Seiten der Engine ausgerichtet, damit das Portal-Gating
 *  (Rolle viewer = Kunden-Login) sie direkt anwenden kann. Leerer Katalog
 *  (reakt) = App ist rein intern und nie kundenfähig. */
export const APP_FEATURES: Record<EzyAppId, Array<{ id: string; label: string }>> = {
  seo: [
    // "overview" entfernt (Volkan 10.08.): der Übersicht-Tab existiert in
    // EzyRank nicht mehr — TAB_APP_FEATURE behält den Eintrag fürs Gating alter Stände.
    { id: "seo", label: "Rankings & GSC-Suchbegriffe" },
    { id: "blog", label: "Blog / Refresh-Radar" },
    { id: "localgrid", label: "Local Grid (Maps-Heatmap)" },
    { id: "conversions", label: "Conversions" },
    { id: "reports", label: "Reports" },
  ],
  // EzyAI-Inhalte einzeln schaltbar (27.08., Volkan «pro WebApp entscheiden,
  // welche Inhalte gesehen werden dürfen»). Bestehende Freischaltungen mit dem
  // alten Sammel-Eintrag "aivis" bleiben gültig (FEATURE_LEGACY_ALIAS).
  geo: [
    { id: "aivis-insights", label: "Insights (KI-Sichtbarkeit)" },
    { id: "aivis-analytics", label: "LLM Analytics & Traffic" },
    { id: "aivis-prompts", label: "Your Prompts" },
    { id: "aivis-chancen", label: "Chancen" },
    { id: "aivis-briefs", label: "Content" },
    { id: "aivis-sitehealth", label: "Site Health & Issues" },
  ],
  analyse: [],
  ads: [{ id: "ads", label: "Ads-Dashboard" }],
  reakt: [],
  admin: [],
};

/** Welche Kundensichtbarkeits-App hinter einem Dashboard-Tab steht (Portal-
 *  Gating): Tab sichtbar ⇔ App für den Kunden aktiv UND Feature freigeschaltet. */
export const TAB_APP_FEATURE: Record<string, { app: EzyAppId; feature: string }> = {
  overview: { app: "seo", feature: "overview" },
  seo: { app: "seo", feature: "seo" },
  blog: { app: "seo", feature: "blog" },
  localgrid: { app: "seo", feature: "localgrid" },
  conversions: { app: "seo", feature: "conversions" },
  ads: { app: "ads", feature: "ads" },
  // Portal-Gating fuer den Dashboard-Tab «KI-Sichtbarkeit» (27.08.).
  aivis: { app: "geo", feature: "aivis-insights" },
};

/** EzyAI-Bereich → Funktions-Schalter (App-Zugriff, App geo). Bereiche ohne
 *  Eintrag sind nie gated. */
export const GEO_SECTION_FEATURE: Record<string, string> = {
  "aeo-insights": "aivis-insights",
  "llm-analytics": "aivis-analytics",
  traffic: "aivis-analytics",
  "your-prompts": "aivis-prompts",
  opportunities: "aivis-chancen",
  content: "aivis-briefs",
  "site-health": "aivis-sitehealth",
  issues: "aivis-sitehealth",
};

/** Alt-Freischaltungen: der fruehere Sammel-Eintrag deckt alle Nachfolger ab —
 *  sonst wuerde eine bestehende features-Liste ["aivis"] nach dem Katalog-
 *  Split ploetzlich ALLE EzyAI-Bereiche sperren. */
export const FEATURE_LEGACY_ALIAS: Record<string, string> = {
  "aivis-insights": "aivis",
  "aivis-analytics": "aivis",
  "aivis-prompts": "aivis",
  "aivis-chancen": "aivis",
  "aivis-briefs": "aivis",
  "aivis-sitehealth": "aivis",
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
  if (
    page === "clients" ||
    page === "team" ||
    page === "matrix" ||
    page === "settings" ||
    page === "agents"
  )
    return "admin";
  if (page === "dashboard") {
    if (tab === "ads") return "ads";
    if (tab === "runs") return "reakt";
  }
  return "seo";
}

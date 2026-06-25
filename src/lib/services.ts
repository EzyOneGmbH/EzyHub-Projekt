// Service-Katalog (granulare Integrationen pro Kunde).
// Quelle der Wahrheit fuer UI (Anlegen-Formular + Integrationen-Panel),
// Enablement-Pruefung (isProviderEnabled) und Auto-Connect (agent-service).
//
// Gespeichert wird in client_integrations(provider, enabled). Die feinen Keys
// (ga4/gsc/google-ads/gtm/gbp) haben das grobe "google" als Eltern, damit
// bestehende Routen, die isProviderEnabled(clientId,"google") pruefen, weiter
// funktionieren und Alt-Kunden (nur "google"-Zeile) abwaertskompatibel bleiben.

export type ServiceKey =
  | "ga4"
  | "gsc"
  | "google-ads"
  | "gtm"
  | "gbp"
  | "bing"
  | "wordpress"
  | "canonry"
  | "ahrefs"
  | "perplexity";

export type ServiceDef = {
  key: ServiceKey;
  label: string;
  /** Grobes Eltern-Provider (fuer Abwaertskompatibilitaet); null = eigenstaendig. */
  parent: "google" | null;
  /** Wie der Dienst verbunden wird (UI-Hinweis). */
  connect: "auto" | "oauth" | "credentials";
  /** Standardmaessig beim Anlegen vorausgewaehlt. */
  defaultOn: boolean;
  hint: string;
};

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    key: "ga4",
    label: "Google Analytics 4",
    parent: "google",
    connect: "auto",
    defaultOn: true,
    hint: "Auto-Connect via Service-Account (ga4_property setzen + SA als Betrachter).",
  },
  {
    key: "gsc",
    label: "Search Console",
    parent: "google",
    connect: "oauth",
    defaultOn: true,
    hint: "Google-OAuth (Search Console).",
  },
  {
    key: "google-ads",
    label: "Google Ads",
    parent: "google",
    connect: "credentials",
    defaultOn: false,
    hint: "Google Ads API: Customer-ID + Developer-Token.",
  },
  {
    key: "gtm",
    label: "Tag Manager",
    parent: "google",
    connect: "oauth",
    defaultOn: false,
    hint: "Google-OAuth (tagmanager.readonly).",
  },
  {
    key: "gbp",
    label: "Google Business Profile",
    parent: "google",
    connect: "oauth",
    defaultOn: false,
    hint: "Google-OAuth (business.manage).",
  },
  {
    key: "bing",
    label: "Bing Webmaster",
    parent: null,
    connect: "auto",
    defaultOn: true,
    hint: "Auto-Connect via globalen Bing-Key; Site muss in Bing Webmaster verifiziert sein.",
  },
  {
    key: "wordpress",
    label: "WordPress",
    parent: null,
    connect: "credentials",
    defaultOn: false,
    hint: "WP REST + Application Password pro Kunde.",
  },
  {
    key: "canonry",
    label: "Canonry (GEO)",
    parent: null,
    connect: "auto",
    defaultOn: true,
    hint: "GEO/AI-Visibility-Projekt wird automatisch angelegt.",
  },
  {
    key: "ahrefs",
    label: "Ahrefs",
    parent: null,
    connect: "auto",
    defaultOn: true,
    hint: "Globaler Ahrefs-Key.",
  },
  {
    key: "perplexity",
    label: "Perplexity",
    parent: null,
    connect: "auto",
    defaultOn: true,
    hint: "Globaler Perplexity-Key (AI-Visibility).",
  },
];

export const SERVICE_KEYS: ServiceKey[] = SERVICE_CATALOG.map((s) => s.key);

/** Feine Google-Kinder, die das grobe "google" abdecken. */
export const GOOGLE_CHILDREN: ServiceKey[] = SERVICE_CATALOG.filter(
  (s) => s.parent === "google",
).map((s) => s.key);

/** Parent-Lookup je feinem Key (oder null). */
export const SERVICE_PARENT: Record<string, "google" | null> = Object.fromEntries(
  SERVICE_CATALOG.map((s) => [s.key, s.parent]),
);

/** Default-Auswahl beim Anlegen eines neuen Kunden. */
export const DEFAULT_ON_SERVICES: ServiceKey[] = SERVICE_CATALOG.filter((s) => s.defaultOn).map(
  (s) => s.key,
);

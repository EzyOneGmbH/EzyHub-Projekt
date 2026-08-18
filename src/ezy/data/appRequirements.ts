// Admin-Ausbau «Einsatzbereitschaft» (17.08.2026): EINE zentrale Definition,
// was eine App je Kunde braucht (Services, Integration, Datenlauf, Portal) —
// genutzt von der Readiness-API, dem Kundendetail-Panel und der
// Konfigurationsvalidierung. Keine Duplikate in Komponenten.
//
// Bewertung ist eine PURE Funktion ueber einem Ist-Zustands-Snapshot, damit
// Server (client-readiness-Route) und Tests dieselbe Logik nutzen.
import type { EzyAppId } from "./appRegistry";

export type Severity = "kritisch" | "empfohlen";
export type GesamtStatus = "bereit" | "unvollstaendig" | "fehler" | "deaktiviert";

export type ReadinessSnapshot = {
  /** App je Kunde freigeschaltet? (client_app_access-Semantik: keine Zeile = aktiv) */
  appEnabled: Partial<Record<EzyAppId, boolean>>;
  /** client_integrations: provider -> enabled */
  services: Record<string, boolean>;
  /** oauth_connections vorhanden (Tokens bleiben serverseitig!) */
  oauth: { google: boolean; wordpress: boolean };
  /** Konfig-Felder aus clients */
  felder: {
    gsc_property?: string | null;
    ga4_property?: string | null;
    canonry_project?: string | null;
    google_ads_customer?: string | null;
  };
  /** letzter erfolgreicher Lauf je audit_type (ISO) */
  lastRuns: Record<string, string | null>;
  /** Anzahl Portal-Nutzer (Rolle viewer mit client_access auf diesen Kunden) */
  portalUsers: number;
  /** Local-Grid-Feature aktiv (client_app_access seo.features) */
  localGridOn: boolean;
  /** Standort hinterlegt (Voraussetzung Local Grid / GBP) */
  standortVorhanden: boolean;
  /** Referenz-Zeitpunkt (Injektion fuer Tests) */
  now?: number;
};

export type CheckErgebnis = {
  id: string;
  label: string;
  severity: Severity;
  ok: boolean;
  detail: string;
  /** Konkrete Abhilfe, wenn nicht ok (zentral definiert, UI rendert nur) */
  aktion?: { id: AktionId; label: string };
};

export type AppReadiness = {
  app: EzyAppId;
  status: GesamtStatus;
  checks: CheckErgebnis[];
};

export type AktionId =
  | "service_aktivieren"
  | "google_verbinden"
  | "property_waehlen"
  | "wordpress_verbinden"
  | "app_freischalten"
  | "portal_einladen"
  | "datenlauf_starten";

const TAGE = 24 * 60 * 60 * 1000;

function laufOk(
  lastRuns: Record<string, string | null>,
  types: string[],
  maxAgeDays: number,
  now: number,
) {
  let neuester: number | null = null;
  for (const t of types) {
    const iso = lastRuns[t];
    if (!iso) continue;
    const ts = Date.parse(iso);
    if (!Number.isNaN(ts) && (neuester === null || ts > neuester)) neuester = ts;
  }
  if (neuester === null) return { ok: false, detail: "noch kein erfolgreicher Lauf" };
  const alterTage = Math.floor((now - neuester) / TAGE);
  return {
    ok: alterTage <= maxAgeDays,
    detail: alterTage === 0 ? "heute" : `vor ${alterTage} Tag${alterTage === 1 ? "" : "en"}`,
  };
}

// ── Anforderungs-Katalog je kundenfaehiger App ──────────────────────────────
// seo (EzyRank): Kernprodukt — laeuft ohne Kundenintegration, Google-Anbindung
//   (GSC/GA4) und frische Datenlaeufe machen es erst richtig nuetzlich.
// geo (EzyAI): braucht zwingend einen GEO-Service (canonry|perplexity) — ohne
//   ihn erscheint der Kunde in EzyAI gar nicht (bestehendes Gate).
// ads (EzyPerformance): braucht zwingend den google-ads-Service + Ads-Kunden-Nr.
export const READINESS_APPS: EzyAppId[] = ["seo", "geo", "ads"];

export function evaluateReadiness(s: ReadinessSnapshot): AppReadiness[] {
  const now = s.now ?? Date.now();
  const out: AppReadiness[] = [];
  const svcOn = (p: string) => s.services[p] === true;

  const push = (app: EzyAppId, checks: Array<Omit<CheckErgebnis, "id"> & { id: string }>) => {
    const enabled = s.appEnabled[app] !== false; // keine Zeile = aktiv
    const appCheck: CheckErgebnis = {
      id: "app",
      label: "App freigeschaltet",
      severity: "kritisch",
      ok: enabled,
      detail: enabled ? "aktiv" : "deaktiviert",
      ...(enabled ? {} : { aktion: { id: "app_freischalten", label: "App freischalten" } }),
    };
    const alle = [appCheck, ...checks];
    let status: GesamtStatus;
    if (!enabled) status = "deaktiviert";
    else if (alle.some((c) => c.severity === "kritisch" && !c.ok)) status = "fehler";
    else if (alle.some((c) => !c.ok)) status = "unvollstaendig";
    else status = "bereit";
    out.push({ app, status, checks: alle });
  };

  // EzyRank (seo)
  {
    const google = s.oauth.google;
    const props = !!(s.felder.gsc_property || s.felder.ga4_property);
    const lauf = laufOk(s.lastRuns, ["populate_meta", "rankings", "gsc_summary"], 8, now);
    push("seo", [
      {
        id: "integration",
        label: "Google verbunden (GSC/GA4)",
        severity: "empfohlen",
        ok: google,
        detail: google ? "verbunden" : "keine Google-Verbindung",
        ...(google ? {} : { aktion: { id: "google_verbinden", label: "Google verbinden" } }),
      },
      {
        id: "property",
        label: "GSC/GA4-Property gewählt",
        severity: "empfohlen",
        ok: props,
        detail: props
          ? [s.felder.gsc_property && "GSC", s.felder.ga4_property && "GA4"]
              .filter(Boolean)
              .join(" + ")
          : "keine Property hinterlegt",
        ...(props ? {} : { aktion: { id: "property_waehlen", label: "Property wählen" } }),
      },
      {
        id: "run",
        label: "Aktueller Datenlauf",
        severity: "empfohlen",
        ok: lauf.ok,
        detail: lauf.detail,
        ...(lauf.ok ? {} : { aktion: { id: "datenlauf_starten", label: "Datenlauf starten" } }),
      },
      portalCheck(s),
    ]);
  }

  // EzyAI (geo)
  {
    const svc = svcOn("canonry") || svcOn("perplexity");
    const lauf = laufOk(
      s.lastRuns,
      ["canonry_ai_visibility", "llm_responses", "ai_citations"],
      7,
      now,
    );
    push("geo", [
      {
        id: "service",
        label: "GEO-Service aktiv (Canonry oder Perplexity)",
        severity: "kritisch",
        ok: svc,
        detail: svc
          ? ["canonry", "perplexity"].filter(svcOn).join(" + ")
          : "kein GEO-Service — Kunde erscheint nicht in EzyAI",
        ...(svc ? {} : { aktion: { id: "service_aktivieren", label: "Service aktivieren" } }),
      },
      {
        id: "run",
        label: "Aktueller KI-Sichtbarkeits-Lauf",
        severity: "empfohlen",
        ok: lauf.ok,
        detail: lauf.detail,
        ...(lauf.ok ? {} : { aktion: { id: "datenlauf_starten", label: "Datenlauf starten" } }),
      },
      portalCheck(s),
    ]);
  }

  // EzyPerformance (ads)
  {
    const svc = svcOn("google-ads");
    const kunde = !!s.felder.google_ads_customer;
    const lauf = laufOk(s.lastRuns, ["google_ads"], 8, now);
    push("ads", [
      {
        id: "service",
        label: "Google-Ads-Service aktiv",
        severity: "kritisch",
        ok: svc,
        detail: svc ? "aktiv" : "deaktiviert — Kunde erscheint nicht in EzyPerformance",
        ...(svc ? {} : { aktion: { id: "service_aktivieren", label: "Service aktivieren" } }),
      },
      {
        id: "adskunde",
        label: "Ads-Kundennummer hinterlegt",
        severity: "kritisch",
        ok: kunde,
        detail: kunde ? String(s.felder.google_ads_customer) : "fehlt",
        ...(kunde ? {} : { aktion: { id: "property_waehlen", label: "Kundennummer eintragen" } }),
      },
      {
        id: "run",
        label: "Aktueller Ads-Datenlauf",
        severity: "empfohlen",
        ok: lauf.ok,
        detail: lauf.detail,
        ...(lauf.ok ? {} : { aktion: { id: "datenlauf_starten", label: "Datenlauf starten" } }),
      },
      portalCheck(s),
    ]);
  }

  return out;
}

function portalCheck(s: ReadinessSnapshot): CheckErgebnis {
  const ok = s.portalUsers > 0;
  return {
    id: "portal",
    label: "Portalzugang vorhanden",
    severity: "empfohlen",
    ok,
    detail: ok
      ? `${s.portalUsers} Kunden-Login${s.portalUsers === 1 ? "" : "s"}`
      : "kein Kunden-Login eingeladen",
    ...(ok ? {} : { aktion: { id: "portal_einladen", label: "Portalzugang einladen" } }),
  };
}

// ── Konfigurationsvalidierung (vor dem Speichern) ───────────────────────────
export type ValidierungsWarnung = { kritisch: boolean; text: string };

/** App fuer den Kunden freischalten: fehlen kritische Voraussetzungen? */
export function warneBeimAppAktivieren(app: EzyAppId, s: ReadinessSnapshot): ValidierungsWarnung[] {
  const r = evaluateReadiness({ ...s, appEnabled: { ...s.appEnabled, [app]: true } }).find(
    (x) => x.app === app,
  );
  if (!r) return [];
  return r.checks
    .filter((c) => c.id !== "app" && !c.ok && c.severity === "kritisch")
    .map((c) => ({ kritisch: true, text: `${c.label}: ${c.detail}` }));
}

/** Service deaktivieren: haengt eine aktive App daran? */
export function warneBeimServiceDeaktivieren(
  provider: string,
  s: ReadinessSnapshot,
): ValidierungsWarnung[] {
  const nachher: ReadinessSnapshot = { ...s, services: { ...s.services, [provider]: false } };
  const out: ValidierungsWarnung[] = [];
  for (const app of READINESS_APPS) {
    if (s.appEnabled[app] === false) continue;
    const vorher = evaluateReadiness(s).find((x) => x.app === app)!;
    const danach = evaluateReadiness(nachher).find((x) => x.app === app)!;
    if (vorher.status !== "fehler" && danach.status === "fehler") {
      const check = danach.checks.find((c) => c.severity === "kritisch" && !c.ok);
      out.push({
        kritisch: true,
        text: `${appLabel(app)} ist für diesen Kunden aktiv, verliert damit aber die Voraussetzung (${check?.label ?? provider}).`,
      });
    }
  }
  return out;
}

/** Local Grid aktivieren ohne Standort/GBP. */
export function warneBeimLocalGrid(s: ReadinessSnapshot): ValidierungsWarnung[] {
  return s.standortVorhanden
    ? []
    : [
        {
          kritisch: true,
          text: "Local Grid braucht einen hinterlegten Standort (GBP) — beim Kunden ist keiner erfasst.",
        },
      ];
}

export function appLabel(app: EzyAppId): string {
  return app === "seo"
    ? "EzyRank"
    : app === "geo"
      ? "EzyAI"
      : app === "ads"
        ? "EzyPerformance"
        : app;
}

export const STATUS_LABEL: Record<GesamtStatus, string> = {
  bereit: "bereit",
  unvollstaendig: "unvollständig",
  fehler: "Fehler",
  deaktiviert: "deaktiviert",
};

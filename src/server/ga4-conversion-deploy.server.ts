// Conversion-Scout — Schicht 3: GA4 Deployment Executor (26.08.2026).
// Wird NUR durch manuelle Freigabe im Conversions-Tab ausgeloest (nie vom
// Scan selbst). Legt je Kandidat eine Event Create Rule (v1alpha, am
// Web-Datastream) + ein Key Event (v1beta, inkl. Standardwert) an; bei
// Entzug werden beide wieder geloescht.
//
// Event-Quellen je Kandidatentyp:
//  - mailto/tel  → benoetigt das GTM-Basisevent `outbound_contact_click`
//                  mit Parameter `contact_target` (Schicht 1, einmalig je
//                  Kunde — siehe Spec Abschnitt 5.6).
//  - download    → nutzt GA4 Enhanced Measurement `file_download` mit
//                  Parameter `link_url` (Standard aktiv) — KEIN GTM noetig.
//  - crossdomain → nutzt GA4 Enhanced Measurement Outbound-Klick (`click` mit
//                  `link_domain` = Checkout-Host, Standard aktiv) — KEIN GTM
//                  noetig. Misst die Kauf-/Spenden-ABSICHT (Klick auf den
//                  externen Checkout, z. B. RaiseNow). Der ECHTE Purchase mit
//                  Betrag entsteht erst als Groundwork (zwei einmalige Schritte,
//                  siehe crossDomainGroundwork()): (a) Zielhost in die GA4-
//                  Cross-Domain-Domains aufnehmen (GA4 Tag-Settings → «Configure
//                  your domains»), (b) der Zielhost muss unser GA4-Tag mitladen
//                  (RaiseNow-seitige GA4-Einstellung + Purchase-Event).
//
// NUR ORGANIC: Key Events werden bewusst NICHT in Google Ads importiert.
// Auth: Kunden-OAuth (analytics.edit) — Verbindungen, die noch mit dem alten
// readonly-Scope erteilt wurden, liefern 403 → Kunde einmal neu verbinden.
import { getGoogleAccessToken } from "@/server/google-tokens.server";

const ADMIN_BETA = "https://analyticsadmin.googleapis.com/v1beta";
const ADMIN_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha";
const MAX_KEY_EVENTS = 30; // hartes GA4-Limit je Standard-Property

type Candidate = {
  candidate_type: "mailto" | "tel" | "download" | string;
  raw_value: string;
  conversion_value: number | null;
  conversion_currency: string | null;
  display_name?: string | null; // Wunschname → wird zum GA4-Eventnamen
};

function scopeFriendly(status: number, body: string): string | null {
  if (status === 403 && /insufficient|PERMISSION_DENIED|scope/i.test(body))
    return (
      "Google-Verbindung hat kein GA4-Schreibrecht (alter readonly-Scope) — " +
      "bitte Google fuer diesen Kunden einmal NEU verbinden (Onboarding → Google)."
    );
  return null;
}

async function gaFetch(token: string, url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) {
    const friendly = scopeFriendly(r.status, text);
    throw new Error(friendly || `GA4 ${r.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

// GA4-Standard-/Systemevents: ein Wunschname darf nicht mit ihnen kollidieren,
// sonst wuerden sich die Zaehlungen mit echten Auto-Events vermischen.
const RESERVED_EVENTS = new Set([
  "purchase",
  "click",
  "file_download",
  "form_submit",
  "form_start",
  "page_view",
  "session_start",
  "first_visit",
  "scroll",
  "user_engagement",
  "view_search_results",
  "video_start",
  "video_progress",
  "video_complete",
  "outbound_contact_click",
]);

/** GA4-Eventname: a-z0-9_, beginnt mit Buchstabe, max. 40 Zeichen.
 *  customName (Volkan 31.08.): vom Menschen vergebener Anzeigename — wird
 *  slugifiziert und ERSETZT den Auto-Namen, damit die Conversion in GA4 und
 *  im Conversions-Tab unter dem Wunschnamen erscheint. */
export function buildDestinationEvent(type: string, rawValue: string, customName?: string): string {
  if (customName) {
    let s = customName
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40)
      .replace(/_+$/g, "");
    if (s) {
      if (!/^[a-z]/.test(s)) s = ("c_" + s).slice(0, 40);
      if (RESERVED_EVENTS.has(s)) s = ("conv_" + s).slice(0, 40);
      return s;
    }
  }
  let slug = "";
  if (type === "mailto") slug = rawValue.split("@")[0];
  else if (type === "tel") slug = "nr_" + rawValue.replace(/\D/g, "").slice(-4);
  else if (type === "crossdomain")
    slug = rawValue; // Host, z. B. donate.raisenow.io
  else if (type === "cta") {
    // Zielseiten-URL → letzter Pfadteil (z. B. /kontakt/ → kontakt).
    try {
      const segs = new URL(rawValue).pathname.split("/").filter(Boolean);
      slug = segs[segs.length - 1] || "seite";
    } catch {
      slug = "seite";
    }
  } else {
    const file = rawValue.split("/").pop() || "datei";
    slug = file.replace(/\.[a-z0-9]+$/i, "");
  }
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefix =
    type === "mailto"
      ? "conv_mail_"
      : type === "tel"
        ? "conv_tel_"
        : type === "crossdomain"
          ? "conv_ext_"
          : type === "cta"
            ? "conv_page_"
            : "conv_dl_";
  const name = (prefix + (slug || "x")).slice(0, 40).replace(/_+$/g, "");
  return /^[a-z]/.test(name) ? name : "c_" + name.slice(0, 38);
}

/** Die zwei einmaligen Schritte, damit aus der Cross-Domain-Klick-Absicht der
 *  ECHTE Purchase (mit Betrag) wird. Bewusst manuell: die GA4-Domains-Liste
 *  hat kein Admin-API-Feld, und der Zielhost (RaiseNow) liegt ausserhalb
 *  unseres Zugriffs. Single-Source fuer UI + Doku. */
export function crossDomainGroundwork(host: string): string[] {
  return [
    `GA4 → Datenstreams → Web → «Tag-Einstellungen konfigurieren» → «Konfiguriere deine Domains»: ${host} hinzufügen (verhindert Self-Referral, aktiviert das _gl-Linking).`,
    `Im Ziel-Konto (${host}, z. B. RaiseNow) unser GA4-Tag mitladen und ein purchase-Event mit Betrag senden — erst dann erscheint der echte Umsatz statt nur der Klick-Absicht.`,
  ];
}

async function findWebStream(token: string, propertyId: string): Promise<string> {
  const j = await gaFetch(token, `${ADMIN_BETA}/properties/${propertyId}/dataStreams?pageSize=50`);
  const web = (j.dataStreams || []).find((s: any) => s.type === "WEB_DATA_STREAM");
  if (!web?.name) throw new Error("Kein Web-Datastream in der GA4-Property gefunden");
  return String(web.name); // properties/{p}/dataStreams/{s}
}

/** Freigabe → Event Create Rule + Key Event anlegen. */
export async function deployToGa4(
  clientId: string,
  propertyIdRaw: string,
  candidate: Candidate,
): Promise<{ destinationEvent: string; ruleName: string; keyEventName: string }> {
  const propertyId = String(propertyIdRaw).replace(/^properties\//, "");
  const { accessToken: token } = await getGoogleAccessToken(clientId);

  // Hartes GA4-Limit (30 Key Events je Property) VOR dem Anlegen pruefen.
  const existing = await gaFetch(
    token,
    `${ADMIN_BETA}/properties/${propertyId}/keyEvents?pageSize=200`,
  );
  const keyEvents: any[] = existing.keyEvents || [];
  if (keyEvents.length >= MAX_KEY_EVENTS)
    throw new Error(
      `GA4-Limit erreicht: ${keyEvents.length}/${MAX_KEY_EVENTS} Key Events — ` +
        "erst ein bestehendes Key Event entfernen, dann erneut freigeben.",
    );

  const destinationEvent = buildDestinationEvent(
    candidate.candidate_type,
    candidate.raw_value,
    candidate.display_name || undefined,
  );
  const streamName = await findWebStream(token, propertyId);

  // Bedingungen je Typ:
  //  download    → Enhanced-Measurement `file_download` + link_url
  //  crossdomain → Enhanced-Measurement Outbound-Klick `click` + link_domain
  //  cta         → `page_view` + page_location CONTAINS Zielpfad (Aufruf der
  //                CTA-Zielseite; KEIN GTM noetig — misst erreichte Ziele,
  //                nicht den Button-Klick selbst)
  //  mailto/tel  → GTM-Basisevent `outbound_contact_click` + contact_target
  let eventConditions: Array<{ field: string; comparisonType: string; value: string }>;
  if (candidate.candidate_type === "download")
    eventConditions = [
      { field: "event_name", comparisonType: "EQUALS", value: "file_download" },
      { field: "link_url", comparisonType: "EQUALS", value: candidate.raw_value },
    ];
  else if (candidate.candidate_type === "crossdomain")
    eventConditions = [
      { field: "event_name", comparisonType: "EQUALS", value: "click" },
      { field: "link_domain", comparisonType: "EQUALS", value: candidate.raw_value },
    ];
  else if (candidate.candidate_type === "cta") {
    let path = candidate.raw_value;
    try {
      path = new URL(candidate.raw_value).pathname || "/";
    } catch {
      /* raw_value bleibt */
    }
    eventConditions = [
      { field: "event_name", comparisonType: "EQUALS", value: "page_view" },
      { field: "page_location", comparisonType: "CONTAINS", value: path },
    ];
  } else
    eventConditions = [
      { field: "event_name", comparisonType: "EQUALS", value: "outbound_contact_click" },
      { field: "contact_target", comparisonType: "EQUALS", value: candidate.raw_value },
    ];

  const rule = await gaFetch(token, `${ADMIN_ALPHA}/${streamName}/eventCreateRules`, {
    method: "POST",
    body: JSON.stringify({ destinationEvent, eventConditions, sourceCopyParameters: true }),
  });

  let keyEventName = "";
  try {
    const body: any = { eventName: destinationEvent, countingMethod: "ONCE_PER_EVENT" };
    if (candidate.conversion_value && candidate.conversion_value > 0)
      body.defaultValue = {
        numericValue: candidate.conversion_value,
        currencyCode: candidate.conversion_currency || "CHF",
      };
    const ke = await gaFetch(token, `${ADMIN_BETA}/properties/${propertyId}/keyEvents`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    keyEventName = String(ke.name || "");
  } catch (e) {
    // Key Event fehlgeschlagen → Rule zuruecknehmen, kein halber Zustand.
    await gaFetch(token, `${ADMIN_ALPHA}/${rule.name}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }

  return { destinationEvent, ruleName: String(rule.name || ""), keyEventName };
}

/** Entzug der Freigabe → Key Event + Event Create Rule wieder loeschen. */
export async function revokeFromGa4(
  clientId: string,
  refs: { ruleName: string | null; keyEventName: string | null },
): Promise<void> {
  const { accessToken: token } = await getGoogleAccessToken(clientId);
  // 404 tolerieren — manuell Geloeschtes blockiert den Entzug nicht.
  const ignore404 = (e: unknown) => {
    if (!/GA4 404/.test(String((e as Error)?.message || e))) throw e;
  };
  if (refs.keyEventName)
    await gaFetch(token, `${ADMIN_BETA}/${refs.keyEventName}`, { method: "DELETE" }).catch(
      ignore404,
    );
  if (refs.ruleName)
    await gaFetch(token, `${ADMIN_ALPHA}/${refs.ruleName}`, { method: "DELETE" }).catch(ignore404);
}

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

/** GA4-Eventname: a-z0-9_, beginnt mit Buchstabe, max. 40 Zeichen. */
export function buildDestinationEvent(type: string, rawValue: string): string {
  let slug = "";
  if (type === "mailto") slug = rawValue.split("@")[0];
  else if (type === "tel") slug = "nr_" + rawValue.replace(/\D/g, "").slice(-4);
  else {
    const file = rawValue.split("/").pop() || "datei";
    slug = file.replace(/\.[a-z0-9]+$/i, "");
  }
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefix = type === "mailto" ? "conv_mail_" : type === "tel" ? "conv_tel_" : "conv_dl_";
  const name = (prefix + (slug || "x")).slice(0, 40).replace(/_+$/g, "");
  return /^[a-z]/.test(name) ? name : "c_" + name.slice(0, 38);
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

  const destinationEvent = buildDestinationEvent(candidate.candidate_type, candidate.raw_value);
  const isDownload = candidate.candidate_type === "download";
  const streamName = await findWebStream(token, propertyId);

  const rule = await gaFetch(token, `${ADMIN_ALPHA}/${streamName}/eventCreateRules`, {
    method: "POST",
    body: JSON.stringify({
      destinationEvent,
      eventConditions: isDownload
        ? [
            { field: "event_name", comparisonType: "EQUALS", value: "file_download" },
            { field: "link_url", comparisonType: "EQUALS", value: candidate.raw_value },
          ]
        : [
            { field: "event_name", comparisonType: "EQUALS", value: "outbound_contact_click" },
            { field: "contact_target", comparisonType: "EQUALS", value: candidate.raw_value },
          ],
      sourceCopyParameters: true,
    }),
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

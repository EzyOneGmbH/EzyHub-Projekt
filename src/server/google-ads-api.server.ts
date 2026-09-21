// Google-Ads-API-Version an EINEM Ort (21.09.2026, Volkan).
//
// Stand: v25 (Release 22.07.2026, Sunset ca. August 2027). v24 (Release
// April 2026) wird ca. Mai 2027 abgeschaltet — alle Aufrufer (Snapshot,
// Autopilot, Mutationen, Outcome-Review, Keyword-Planner, Kundenliste)
// bauen ihre Basis-URL ueber adsApiBase(), damit ein Versionswechsel ein
// Einzeiler bleibt. Notfall-Override ohne Deployment: Env
// GOOGLE_ADS_API_VERSION=v24 (Format vNN; alles andere wird ignoriert).
//
// Quellen: https://ads-developers.googleblog.com/2026/07/announcing-v25-of-google-ads-api.html
//          https://developers.google.com/google-ads/api/docs/release-notes

export const GOOGLE_ADS_API_VERSION_DEFAULT = "v25";
export const GOOGLE_ADS_API_HOST = "https://googleads.googleapis.com";

const VERSION_RE = /^v\d{1,3}$/;

/** Aktive API-Version: Env-Override GOOGLE_ADS_API_VERSION oder Default. */
export function googleAdsApiVersion(env: NodeJS.ProcessEnv = process.env): string {
  const roh = String(env.GOOGLE_ADS_API_VERSION ?? "")
    .trim()
    .toLowerCase();
  return VERSION_RE.test(roh) ? roh : GOOGLE_ADS_API_VERSION_DEFAULT;
}

/** Basis-URL, z. B. https://googleads.googleapis.com/v25 (zur Aufrufzeit ausgewertet). */
export function adsApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return `${GOOGLE_ADS_API_HOST}/${googleAdsApiVersion(env)}`;
}

// Google-Auswahllisten (GSC-Sites, GA4-Properties, Ads-Kunden) zeigen alles,
// was das verbundene Google-Konto sieht — oft das Agentur-Konto mit ALLEN
// Kunden. Darum nur für Agentur-Rollen; Kunden-Logins (viewer) bekommen 403.
export function darfGoogleListen(role: string | null | undefined): boolean {
  return !!role && role !== "viewer";
}

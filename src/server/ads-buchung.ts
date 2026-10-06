// Klassifizierung Buchung (Hauptziel) vs. uebrige Conversions — geteilt von
// Agentur-Tabelle (google-ads-overview) und Ads-Report (google-ads-report).

// Buchung = Conversion-Aktion der Kategorie «Kauf» (Buchungsmaschinen melden
// Hotelbuchungen als PURCHASE). Aktionen ohne sprechende Kategorie zaehlen nur
// per Name als Buchung — Anfragen/Leads («Buchungsanfrage») bewusst nicht.
const BUCHUNG_KATEGORIEN = new Set(["PURCHASE", "STORE_SALE"]);
const UNSPEZIFISCH = new Set(["", "DEFAULT", "UNKNOWN", "UNSPECIFIED"]);
const BUCHUNG_NAME = /buchung|booking|reservation|reservierung|purchase|kauf|bestellung/i;
const ANFRAGE_NAME = /anfrage|inquiry|enquiry|request|kontakt|contact|lead|formular|form/i;

export function istBuchung(category: unknown, name: unknown): boolean {
  const cat = String(category ?? "").toUpperCase();
  if (BUCHUNG_KATEGORIEN.has(cat)) return true;
  if (!UNSPEZIFISCH.has(cat)) return false;
  const n = String(name ?? "");
  return BUCHUNG_NAME.test(n) && !ANFRAGE_NAME.test(n);
}

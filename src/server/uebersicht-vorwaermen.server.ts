// Stündliches Vorwärmen der Agentur-Übersicht (Volkan 11.10.2026: «Übersichts-
// Dashboard soll alle Stunde aktualisiert werden»).
// Rechnet für alle Kunden die Performance-Zeilen (SEO + Ads) der gängigen
// Zeiträume bis heute frisch und legt sie in uebersicht_cache ab. Die Übersicht
// öffnet dadurch immer mit einem höchstens eine Stunde alten Stand, ohne
// Wartezeit. Rankings/Sichtbarkeit stammen weiter aus den Messläufen (nachts) —
// stündliches Neumessen bei DataForSEO/Ahrefs würde pro Lauf Geld kosten.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled } from "./integrations.server";
import { adsFenster } from "./google-ads.server";
import { fetchSeoOverviewZeile } from "./seo-overview.server";
import { fetchAdsOverviewZeile } from "./google-ads-overview.server";
import { letzteTageBisGestern } from "@/lib/date-range";

/** Zeiträume der Kopfzeile, die vorgewärmt werden (30 Tage = Standard zuerst). */
export const VORWAERM_TAGE = [30, 7, 90] as const;
const PARALLEL = 4;
const ZEITBUDGET_MS = 240_000;

/** «Letzte N Tage bis gestern» wie im Browser (Schweizer Datum, 14.10.2026). */
export function fensterLetzteTage(tage: number, jetztMs: number = Date.now()) {
  return letzteTageBisGestern(tage, jetztMs);
}

type Ergebnis = { seo: number; ads: number; fehler: number; abgebrochen: boolean; ms: number };

export async function waermeUebersichtVor(): Promise<Ergebnis> {
  const t0 = Date.now();
  const sb = supabaseAdmin as any;
  const { data: kunden } = await sb
    .from("clients")
    .select("id, ga4_property, gsc_property, google_ads_customer");
  const liste: Array<{
    id: string;
    ga4_property: string | null;
    gsc_property: string | null;
    google_ads_customer: string | null;
  }> = kunden ?? [];
  const ergebnis: Ergebnis = { seo: 0, ads: 0, fehler: 0, abgebrochen: false, ms: 0 };
  const googleAn = new Map<string, boolean>();
  for (const k of liste) googleAn.set(k.id, await isProviderEnabled(k.id, "google"));

  const aufgaben: Array<() => Promise<void>> = [];
  for (const tage of VORWAERM_TAGE) {
    const range = fensterLetzteTage(tage);
    const fenster = adsFenster(range, null);
    for (const k of liste) {
      aufgaben.push(async () => {
        const z = await fetchSeoOverviewZeile(k, fenster, !!googleAn.get(k.id), { frisch: true });
        if (z.error) ergebnis.fehler++;
        else ergebnis.seo++;
      });
      if (k.google_ads_customer && googleAn.get(k.id))
        aufgaben.push(async () => {
          const z = await fetchAdsOverviewZeile(k.id, k.google_ads_customer, range, null, {
            frisch: true,
          });
          if (z.error) ergebnis.fehler++;
          else ergebnis.ads++;
        });
    }
  }
  for (let i = 0; i < aufgaben.length; i += PARALLEL) {
    if (Date.now() - t0 > ZEITBUDGET_MS) {
      ergebnis.abgebrochen = true;
      break;
    }
    await Promise.all(
      aufgaben.slice(i, i + PARALLEL).map((a) =>
        a().catch(() => {
          ergebnis.fehler++;
        }),
      ),
    );
  }
  ergebnis.ms = Date.now() - t0;
  return ergebnis;
}

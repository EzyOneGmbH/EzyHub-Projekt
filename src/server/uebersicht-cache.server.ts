// Persistenter Zwischenspeicher für die Performance-Tabellen (06.10.2026).
// Zweistufig: Arbeitsspeicher der Instanz (schnell) + Tabelle uebersicht_cache
// (gilt für alle Instanzen und Nutzer). Fehler beim Cache dürfen den Abruf nie
// verhindern — dann wird einfach live gerechnet.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const UEBERSICHT_CACHE_MS = 60 * 60 * 1000;
const AUFRAEUMEN_MS = 2 * 24 * 60 * 60 * 1000;
const SPEICHER_MS = 5 * 60 * 1000;

type Art = "seo" | "ads";
const speicher = new Map<string, { at: number; payload: unknown }>();

export async function cacheLesen<T>(art: Art, schluessel: string): Promise<T | null> {
  const k = `${art}|${schluessel}`;
  const m = speicher.get(k);
  // Instanz-Speicher nur kurz: neue Messläufe verwerfen die Tabelle per Trigger.
  if (m && Date.now() - m.at < SPEICHER_MS) return m.payload as T;
  try {
    const seit = new Date(Date.now() - UEBERSICHT_CACHE_MS).toISOString();
    const { data } = await (supabaseAdmin as any)
      .from("uebersicht_cache")
      .select("payload, erstellt")
      .eq("art", art)
      .eq("schluessel", schluessel)
      .gte("erstellt", seit)
      .maybeSingle();
    if (!data?.payload) return null;
    speicher.set(k, { at: Date.now(), payload: data.payload });
    return data.payload as T;
  } catch {
    return null;
  }
}

export async function cacheSchreiben(
  art: Art,
  schluessel: string,
  clientId: string,
  payload: unknown,
): Promise<void> {
  speicher.set(`${art}|${schluessel}`, { at: Date.now(), payload });
  try {
    await (supabaseAdmin as any).from("uebersicht_cache").upsert(
      {
        art,
        schluessel,
        client_id: clientId,
        payload,
        erstellt: new Date().toISOString(),
      },
      { onConflict: "art,schluessel" },
    );
    // Gelegentlich alte Einträge entfernen (kein eigener Cron nötig).
    if (Math.random() < 0.02) {
      await (supabaseAdmin as any)
        .from("uebersicht_cache")
        .delete()
        .lt("erstellt", new Date(Date.now() - AUFRAEUMEN_MS).toISOString());
    }
  } catch {
    /* Cache ist best effort */
  }
}

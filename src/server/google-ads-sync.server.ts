// Google-Ads Auto-Sync (Volkan 06.10.2026): pg_cron ruft alle 4 Stunden
// /api/admin/ads-sync auf. Fuer jeden Kunden mit verknuepftem Google-Ads-Konto
// wird ein Snapshot gespeichert (audit_runs, audit_type "google_ads") — exakt
// mit dem Zeitraum, den das Dashboard standardmaessig abfragt: «letzte N Tage
// bis heute» in Schweizer Zeit, verglichen mit der gleich langen Vorperiode.
// So sehen auch Kunden (die selbst nie abrufen) hoechstens 4 h alte Zahlen.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled } from "@/server/integrations.server";
import { fetchAdsSnapshot } from "@/server/google-ads.server";
import { addDays, heuteYmd } from "@/lib/date-range";

export const SYNC_ZEITZONE = "Europe/Zurich";

/** Kalenderdatum (YYYY-MM-DD) in Schweizer Zeit — wie isoDay() im Browser. */
export function zuercherHeute(jetztMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SYNC_ZEITZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(jetztMs));
}

export type SyncFenster = {
  days: number;
  startDate: string;
  endDate: string;
  compareStart: string;
  compareEnd: string;
};

/**
 * Zeitraum wie resolveRange()/previousPeriod() im Dashboard: N Tage bis heute
 * (inklusive), Vorperiode direkt davor. Liegt der Schweizer Tag vor dem UTC-Tag
 * (00–02 Uhr Ortszeit), wuerde der Server «endDate in der Zukunft» melden —
 * dann null (der Cron laeuft bewusst nicht in diesem Fenster).
 */
export function syncFenster(days: number, jetztMs: number = Date.now()): SyncFenster | null {
  if (!Number.isInteger(days) || days < 1 || days > 366) return null;
  const endDate = zuercherHeute(jetztMs);
  if (endDate > heuteYmd(jetztMs)) return null;
  const startDate = addDays(endDate, -(days - 1));
  const compareEnd = addDays(startDate, -1);
  const compareStart = addDays(compareEnd, -(days - 1));
  return { days, startDate, endDate, compareStart, compareEnd };
}

/**
 * Standard je Lauf (erster Cron-Lauf 06.10.: 4 Presets x 31 Kunden passen nicht
 * ins 4-Minuten-Budget): 30 + 7 Tage immer, dazu abwechselnd 14 bzw. 90 Tage —
 * so ist jeder Zeitraum hoechstens 8 h alt.
 */
export function standardPresets(jetztMs: number = Date.now()): number[] {
  const lauf = Math.floor(jetztMs / (4 * 3_600_000));
  return [30, 7, lauf % 2 === 0 ? 14 : 90];
}

/** Erlaubte Preset-Liste aus dem Request (Duplikate/Unsinn raus, Reihenfolge bleibt). */
export function syncPresets(roh: unknown, jetztMs: number = Date.now()): number[] {
  const liste = Array.isArray(roh) && roh.length ? roh : standardPresets(jetztMs);
  const out: number[] = [];
  for (const v of liste) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 366 && !out.includes(n)) out.push(n);
  }
  return out;
}

type Kunde = {
  id: string;
  name: string | null;
  organization_id: string;
  google_ads_customer: string;
};
export type SyncZeile = {
  kunde: string;
  days: number;
  ok: boolean;
  fehler?: string;
  uebersprungen?: string;
};

/**
 * Alle verknuepften Kunden fuer alle Presets abrufen und speichern. Reihenfolge:
 * erst alle Kunden im ersten Preset (Standard 30 Tage), dann das naechste.
 * Laeuft das Zeitbudget ab, werden keine neuen Abrufe mehr gestartet (offen).
 */
export async function synchronisiereAlleAdsKunden(opts: {
  presets: number[];
  budgetMs: number;
  parallel?: number;
  jetztMs?: number;
}) {
  const start = Date.now();
  const parallel = Math.max(1, Math.min(8, opts.parallel ?? 6));
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, name, organization_id, google_ads_customer")
    .not("google_ads_customer", "is", null)
    .neq("google_ads_customer", "");
  const kunden = ((data ?? []) as Kunde[]).filter((k) => /\d/.test(k.google_ads_customer));

  // triggered_by ist Pflicht: Owner/Admin der jeweiligen Organisation.
  const ausloeser = new Map<string, string | null>();
  async function ausloeserFuer(orgId: string): Promise<string | null> {
    if (ausloeser.has(orgId)) return ausloeser.get(orgId)!;
    const { data: users } = await supabaseAdmin
      .from("app_users")
      .select("user_id, role")
      .eq("organization_id", orgId)
      .limit(50);
    const liste = (users ?? []) as { user_id: string; role: string }[];
    const u = liste.find((x) => x.role === "owner") || liste.find((x) => x.role === "admin");
    ausloeser.set(orgId, u?.user_id ?? null);
    return u?.user_id ?? null;
  }

  const aktiv = new Map<string, boolean>();
  const aufgaben: { k: Kunde; f: SyncFenster }[] = [];
  for (const days of opts.presets) {
    const f = syncFenster(days, opts.jetztMs);
    if (!f) continue;
    for (const k of kunden) aufgaben.push({ k, f });
  }

  const zeilen: SyncZeile[] = [];
  let offen = 0;
  async function eine({ k, f }: { k: Kunde; f: SyncFenster }): Promise<SyncZeile> {
    const kunde = k.name || k.id;
    if (!aktiv.has(k.id)) aktiv.set(k.id, await isProviderEnabled(k.id, "google"));
    if (!aktiv.get(k.id))
      return { kunde, days: f.days, ok: false, uebersprungen: "Google deaktiviert" };
    const user = await ausloeserFuer(k.organization_id);
    if (!user) return { kunde, days: f.days, ok: false, uebersprungen: "kein Owner/Admin" };
    const snap = await fetchAdsSnapshot(
      k.id,
      k.google_ads_customer,
      { startDate: f.startDate, endDate: f.endDate },
      { start: f.compareStart, end: f.compareEnd },
    );
    if (!snap.ok || !snap.result)
      return {
        kunde,
        days: f.days,
        ok: false,
        fehler: snap.skipped || snap.error || "Abruf fehlgeschlagen",
      };
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin.from("audit_runs").insert({
      client_id: k.id,
      organization_id: k.organization_id,
      triggered_by: user,
      audit_type: "google_ads",
      status: "succeeded",
      input: {
        days: snap.result.days,
        range: snap.result.range,
        prevRange: snap.result.prevRange,
        source: "pg_cron",
      },
      result: snap.result as never,
      started_at: nowIso,
      finished_at: nowIso,
    });
    if (error) return { kunde, days: f.days, ok: false, fehler: error.message };
    return { kunde, days: f.days, ok: true };
  }

  for (let i = 0; i < aufgaben.length; i += parallel) {
    if (Date.now() - start > opts.budgetMs) {
      offen = aufgaben.length - i;
      break;
    }
    const block = await Promise.all(
      aufgaben.slice(i, i + parallel).map((a) =>
        eine(a).catch((e: unknown) => ({
          kunde: a.k.name || a.k.id,
          days: a.f.days,
          ok: false,
          fehler: String((e as Error)?.message || e).slice(0, 300),
        })),
      ),
    );
    zeilen.push(...block);
  }

  return {
    kunden: kunden.length,
    presets: opts.presets,
    gespeichert: zeilen.filter((z) => z.ok).length,
    fehler: zeilen.filter((z) => z.fehler).length,
    uebersprungen: zeilen.filter((z) => z.uebersprungen).length,
    offen,
    dauerMs: Date.now() - start,
    zeilen: zeilen.filter((z) => !z.ok),
  };
}

// EzyPerformance-Uebersicht (06.10.2026, Abloesung Data-Studio-Dashboard):
// reines Datenmodell aus dem google_ads-Snapshot (inkl. extras.report).
// Keine React-/Supabase-Importe — vitest-gedeckt.

export type Ton = "gut" | "schlecht" | "neutral";

export const pctDelta = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || !(prev > 0) ? null : Math.round(((cur - prev) / prev) * 1000) / 10;

/** Delta-Tonalitaet: up = steigen ist gut, down = sinken ist gut. */
export function deltaTon(d: number | null, richtung: "up" | "down" | "neutral"): Ton {
  if (d == null || d === 0 || richtung === "neutral") return "neutral";
  return (richtung === "up") === d > 0 ? "gut" : "schlecht";
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export type Snapshot = {
  totals: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
  };
  prev: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
  };
  campaigns: Array<{
    name: string;
    status: string;
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
    roas: number;
  }>;
  report: any | null;
};

/** Art einer Conversion-Aktion: Hauptziel (Buchung), Soft Conversion (Anfrage,
 *  Kontakt, Buchung gestartet …) oder Google-Unternehmensprofil (lokale Aktionen,
 *  modellierte Ladenbesuche, Wegbeschreibungen — keine Anfragen, zaehlen nicht
 *  zu «Alle Conversions», sonst dominieren sie die Soft Conversions). */
export type ConvArt = "haupt" | "soft" | "profil";
const PROFIL_KATEGORIEN = new Set(["STORE_VISIT", "GET_DIRECTIONS"]);
const PROFIL_NAME =
  /^(local actions|lokale aktionen)|ladenbesuch|store visit|wegbeschreibung|directions/i;
export function convArt(a: { booking?: boolean; category?: string; name?: string }): ConvArt {
  if (a.booking) return "haupt";
  if (
    PROFIL_KATEGORIEN.has(String(a.category || "").toUpperCase()) ||
    PROFIL_NAME.test(String(a.name || ""))
  )
    return "profil";
  return "soft";
}

/** Kennzahlen der Uebersicht (Buchungen = Hauptziel-Aktionen; Fallback Gesamt-Conversions). */
export function kennzahlen(s: Snapshot) {
  const acts: any[] = s.report?.conversionActions ?? [];
  const hat = acts.length > 0;
  const sum = (f: (a: any) => boolean, k: string) =>
    acts.filter(f).reduce((x, a) => x + num(a[k]), 0);
  const buchungen = hat ? sum((a) => a.booking, "count") : s.totals.conversions;
  const buchungenPrev = hat ? sum((a) => a.booking, "prevCount") : s.prev.conversions;
  const wert = hat ? sum((a) => a.booking, "value") : s.totals.conversionValue;
  const wertPrev = hat ? sum((a) => a.booking, "prevValue") : s.prev.conversionValue;
  const keinProfil = (a: any) => convArt(a) !== "profil";
  const alle = hat ? sum(keinProfil, "count") : s.totals.conversions;
  const allePrev = hat ? sum(keinProfil, "prevCount") : s.prev.conversions;
  const profil = hat ? sum((a) => convArt(a) === "profil", "count") : 0;
  const t = s.totals;
  const p = s.prev;
  const ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  const ctrPrev = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
  const cpc = t.clicks > 0 ? t.cost / t.clicks : 0;
  const cpcPrev = p.clicks > 0 ? p.cost / p.clicks : 0;
  const avg = buchungen > 0 ? wert / buchungen : 0;
  const avgPrev = buchungenPrev > 0 ? wertPrev / buchungenPrev : 0;
  const roas = t.cost > 0 ? t.conversionValue / t.cost : 0;
  const roasPrev = p.cost > 0 ? p.conversionValue / p.cost : 0;
  return {
    // Konto misst keine Buchungen (nur Anrufe/Anfragen/Profil-Aktionen).
    ohneBuchung: hat && !acts.some((a) => a.booking),
    buchungen,
    buchungenPrev,
    wert,
    wertPrev,
    avg,
    avgPrev,
    alle,
    allePrev,
    soft: Math.max(0, alle - buchungen),
    profil,
    ctr,
    ctrPrev,
    cpc,
    cpcPrev,
    roas,
    roasPrev,
    kostenProBuchung: buchungen > 0 ? t.cost / buchungen : 0,
    d: {
      buchungen: pctDelta(buchungen, buchungenPrev),
      wert: pctDelta(wert, wertPrev),
      avg: pctDelta(avg, avgPrev),
      alle: pctDelta(alle, allePrev),
      impressions: pctDelta(t.impressions, p.impressions),
      clicks: pctDelta(t.clicks, p.clicks),
      ctr: pctDelta(ctr, ctrPrev),
      cpc: pctDelta(cpc, cpcPrev),
      roas: pctDelta(roas, roasPrev),
      umsatz: pctDelta(t.conversionValue, p.conversionValue),
      kosten: pctDelta(t.cost, p.cost),
    },
  };
}

export function topKampagnen(s: Snapshot) {
  const umsatz = s.campaigns.reduce((x, c) => x + num(c.conversionValue), 0);
  return s.campaigns
    .filter((c) => num(c.conversionValue) > 0)
    .sort((a, b) => b.conversionValue - a.conversionValue)
    .map((c) => ({
      ...c,
      anteil: umsatz > 0 ? (c.conversionValue / umsatz) * 100 : 0,
      roas: c.cost > 0 ? c.conversionValue / c.cost : 0,
    }));
}

const KATEGORIE: Record<string, string> = {
  PURCHASE: "Kauf",
  STORE_SALE: "Verkauf im Geschäft",
  SUBMIT_LEAD_FORM: "Formular",
  CONTACT: "Kontakt",
  PHONE_CALL_LEAD: "Anruf",
  IMPORTED_LEAD: "Importierter Lead",
  QUALIFIED_LEAD: "Qualifizierter Lead",
  BOOK_APPOINTMENT: "Terminbuchung",
  REQUEST_QUOTE: "Angebotsanfrage",
  GET_DIRECTIONS: "Wegbeschreibung",
  OUTBOUND_CLICK: "Klick auf externe Seite",
  PAGE_VIEW: "Seitenaufruf",
  BEGIN_CHECKOUT: "Buchung gestartet",
  ADD_TO_CART: "In den Warenkorb",
  SIGNUP: "Anmeldung",
  ENGAGEMENT: "Interaktion",
  STORE_VISIT: "Ladenbesuch",
  DOWNLOAD: "Download",
  DEFAULT: "Sonstige",
};
export const kategorieLabel = (k: string) => KATEGORIE[String(k || "").toUpperCase()] || "Sonstige";

export function conversionZeilen(s: Snapshot) {
  const acts: any[] = s.report?.conversionActions ?? [];
  // Anteil ohne Unternehmensprofil-Aktionen (sonst verschwinden die Buchungen).
  const alle = acts.filter((a) => convArt(a) !== "profil").reduce((x, a) => x + num(a.count), 0);
  return acts.map((a) => ({
    name: String(a.name),
    kategorie: kategorieLabel(a.category),
    art: convArt(a),
    hauptziel: !!a.booking,
    anzahl: num(a.count),
    delta: pctDelta(num(a.count), num(a.prevCount)),
    neu: num(a.prevCount) === 0 && num(a.count) > 0,
    anteil: convArt(a) === "profil" ? null : alle > 0 ? (num(a.count) / alle) * 100 : 0,
    wert: num(a.value),
    kostenJe: convArt(a) !== "profil" && num(a.count) > 0 ? s.totals.cost / num(a.count) : null,
  }));
}

// ── Herkunft ────────────────────────────────────────────────────────────────

const LAND_DE = (() => {
  try {
    return new Intl.DisplayNames(["de-CH"], { type: "region" });
  } catch {
    return null;
  }
})();
export const landName = (code: string, fallback: string) => {
  try {
    return (code && LAND_DE?.of(code.toUpperCase())) || fallback;
  } catch {
    return fallback;
  }
};
/** «aus der Schweiz», «aus Deutschland», «aus den USA» … */
export function ausLand(code: string, name: string) {
  const c = String(code || "").toUpperCase();
  if (["CH", "TR", "SK", "UA", "MN", "CZ", "DO"].includes(c)) return `aus der ${name}`;
  if (["US", "NL", "AE", "PH", "MV", "SC"].includes(c)) return `aus den ${name}`;
  return `aus ${name}`;
}

export function herkunft(s: Snapshot) {
  const geo = s.report?.geo;
  if (!geo) return null;
  const laender = (geo.countries ?? []).map((l: any) => ({
    ...l,
    anzeige: landName(l.countryCode, l.name),
  }));
  const total = laender.reduce((x: number, l: any) => x + num(l.conversions), 0);
  const wert = laender.reduce((x: number, l: any) => x + num(l.value), 0);
  const mitBuchung = laender.filter((l: any) => num(l.conversions) > 0);
  const staedte = (geo.cities ?? [])
    .filter((c: any) => num(c.conversions) > 0)
    .sort((a: any, b: any) => b.conversions - a.conversions || b.value - a.value)
    .map((c: any) => ({ ...c, land: landName(c.countryCode, c.countryCode) }));
  return {
    laender: laender.map((l: any) => ({
      ...l,
      anteil: total > 0 ? (l.conversions / total) * 100 : 0,
    })),
    regionen: geo.regions ?? [],
    staedte,
    total,
    wert,
    anzahlLaender: mitBuchung.length,
  };
}

// ── Wer bucht? ──────────────────────────────────────────────────────────────

const ALTER = [
  ["AGE_RANGE_18_24", "18–24"],
  ["AGE_RANGE_25_34", "25–34"],
  ["AGE_RANGE_35_44", "35–44"],
  ["AGE_RANGE_45_54", "45–54"],
  ["AGE_RANGE_55_64", "55–64"],
  ["AGE_RANGE_65_UP", "65+"],
] as const;
const GESCHLECHT = [
  ["FEMALE", "Frauen"],
  ["MALE", "Männer"],
] as const;
const GERAET = [
  ["MOBILE", "Smartphone"],
  ["DESKTOP", "Computer"],
  ["TABLET", "Tablet"],
] as const;

/** Anteile je Gruppe (ohne «unbekannt»); Basis Buchungen, sonst Klicks. */
function anteile(
  rows: any[] | undefined,
  gruppen: ReadonlyArray<readonly [string, string]>,
  rest?: string,
) {
  const r = rows ?? [];
  const wert = (key: string, k: "conversions" | "clicks") =>
    r.filter((x) => x.key === key).reduce((s, x) => s + num(x[k]), 0);
  const restWert = (k: "conversions" | "clicks") =>
    rest
      ? r
          .filter(
            (x) =>
              !gruppen.some(([g]) => g === x.key) &&
              !/UNDETERMINED|UNKNOWN|UNSPECIFIED/.test(x.key),
          )
          .reduce((s, x) => s + num(x[k]), 0)
      : 0;
  const bekannt = (k: "conversions" | "clicks") =>
    gruppen.reduce((s, [g]) => s + wert(g, k), 0) + restWert(k);
  const basis: "conversions" | "clicks" = bekannt("conversions") > 0 ? "conversions" : "clicks";
  const summe = bekannt(basis);
  const gesamt = r.reduce((s, x) => s + num(x[basis]), 0);
  const liste = [...gruppen.map(([k, label]) => ({ key: k, label, wert: wert(k, basis) }))];
  if (rest && restWert(basis) > 0) liste.push({ key: "REST", label: rest, wert: restWert(basis) });
  return {
    basis,
    leer: summe === 0,
    unbekanntAnteil: gesamt > 0 ? ((gesamt - summe) / gesamt) * 100 : 0,
    gruppen: liste.map((g) => ({ ...g, anteil: summe > 0 ? (g.wert / summe) * 100 : 0 })),
  };
}

export function zielgruppe(s: Snapshot) {
  const a = s.report?.audience;
  if (!a) return null;
  return {
    alter: anteile(a.age, ALTER),
    geschlecht: anteile(a.gender, GESCHLECHT),
    geraet: anteile(a.device, GERAET, "Andere"),
  };
}

// ── Suchbegriffe ────────────────────────────────────────────────────────────

const GENERISCH = new Set([
  "hotel",
  "hotels",
  "boutique",
  "design",
  "resort",
  "restaurant",
  "garni",
  "lodge",
  "spa",
  "wellness",
  "apart",
  "the",
  "and",
  "und",
  "der",
  "die",
  "das",
  "gmbh",
  "ag",
  "bb",
  "b&b",
]);

/** Markenbegriffe aus Brand-Terms + markanten Namensteilen (z. B. «b5», «campagnola»). */
export function markenBegriffe(name: string, brandTerms: string[] = []) {
  const teile = String(name || "")
    .toLowerCase()
    .split(/[^a-z0-9äöüéèàç]+/i)
    .filter((t) => t && !GENERISCH.has(t) && (t.length >= 4 || /\d/.test(t)));
  return [...new Set([...brandTerms.map((b) => b.toLowerCase().trim()).filter(Boolean), ...teile])];
}
export const istMarke = (term: string, marken: string[]) => {
  const t = ` ${String(term || "").toLowerCase()} `;
  return marken.some((m) =>
    m.includes(" ")
      ? t.includes(m)
      : new RegExp(`[^a-z0-9]${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`, "i").test(t),
  );
};

// ── Das Wichtigste auf einen Blick ──────────────────────────────────────────

const chf0 = (v: number) => `CHF ${Math.round(v).toLocaleString("de-CH")}`;
const chf2 = (v: number) => `CHF ${v.toFixed(2)}`;
const p1 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v))} %`;
const ganz = (v: number) => Math.round(v).toLocaleString("de-CH");

export type Erkenntnis = { ton: "gut" | "warnung" | "info"; titel: string; text: string };

export function wichtigste(s: Snapshot): Erkenntnis[] {
  const k = kennzahlen(s);
  const out: Erkenntnis[] = [];
  // 1) Buchungen
  if (k.buchungen > 0) {
    const d = k.d.buchungen;
    const mehr =
      d == null
        ? ""
        : d >= 0
          ? `${Math.abs(Math.round(d))} % mehr als in der Vorperiode.`
          : `${Math.abs(Math.round(d))} % weniger als in der Vorperiode.`;
    out.push({
      ton: d == null || d >= 0 ? "gut" : "warnung",
      titel: `${ganz(k.buchungen)} ${k.buchungen === 1 ? "Buchung" : "Buchungen"}${mehr ? ": " + mehr : "."}`,
      text: `Kosten pro Buchung ${chf0(k.kostenProBuchung)} bei einem Buchungswert von Ø ${chf0(k.avg)}.`,
    });
  } else if (k.ohneBuchung) {
    out.push({
      ton: "info",
      titel: "Buchungen werden in Google Ads nicht gemessen.",
      text: `Gemessen werden ${ganz(k.alle)} Conversions wie Anrufe und Anfragen bei ${ganz(s.totals.clicks)} Klicks für ${chf0(s.totals.cost)}.`,
    });
  } else {
    out.push({
      ton: "info",
      titel: "Noch keine Buchungen im Zeitraum.",
      text: `${ganz(s.totals.clicks)} Klicks für ${chf0(s.totals.cost)} — Buchungen erscheinen hier, sobald die Buchungsmaschine Conversions meldet.`,
    });
  }
  // 2) Kosten-Effizienz: auffaelligste Bewegung
  const { cpc, ctr, roas, umsatz } = k.d;
  if (cpc != null && cpc > 15) {
    out.push({
      ton: "warnung",
      titel: `Klicks sind deutlich teurer geworden: Ø CPC ${p1(cpc)} auf ${chf2(k.cpc)}${ctr != null ? `, CTR ${p1(ctr)}` : ""}.`,
      text:
        umsatz != null && umsatz < -5
          ? `Der Umsatz ist um ${Math.abs(Math.round(umsatz))} % gesunken — Gebote und Suchbegriffe prüfen.`
          : "Der Umsatz ist bisher stabil, sollte aber beobachtet werden.",
    });
  } else if (roas != null && roas < -15) {
    out.push({
      ton: "warnung",
      titel: `Der ROAS ist um ${Math.abs(Math.round(roas))} % gesunken.`,
      text: `Jeder Franken bringt aktuell CHF ${k.roas.toFixed(2)} statt CHF ${k.roasPrev.toFixed(2)} zurück.`,
    });
  } else if (roas != null && roas > 15) {
    out.push({
      ton: "gut",
      titel: `Der ROAS ist um ${Math.round(roas)} % gestiegen.`,
      text: `Jeder Franken bringt jetzt CHF ${k.roas.toFixed(2)} zurück (Vorperiode CHF ${k.roasPrev.toFixed(2)}).`,
    });
  } else if (cpc != null && cpc < -15) {
    out.push({
      ton: "gut",
      titel: `Klicks sind günstiger geworden: Ø CPC ${p1(cpc)} auf ${chf2(k.cpc)}.`,
      text: "Gleiches Budget bringt mehr Besuche auf die Website.",
    });
  } else if (k.roas > 0) {
    out.push({
      ton: k.roas >= 1 ? "gut" : "warnung",
      titel:
        k.roas >= 1 ? "Die Werbung ist profitabel." : "Die Werbung liegt unter der Gewinnschwelle.",
      text: `ROAS ${k.roas.toFixed(2).replace(".", ",")}× — Kosten und Ertrag ${roas == null ? "im Zeitraum" : "ähnlich wie in der Vorperiode"}.`,
    });
  }
  // 3) Herkunft
  const h = herkunft(s);
  if (h && h.total > 0) {
    const [erst, zweit, dritt] = h.laender.filter((l: any) => l.conversions > 0);
    const stadt = h.staedte.find((c: any) => c.countryCode === erst.countryCode);
    const danach = [zweit, dritt].filter(Boolean).map((l: any) => l.anzeige);
    out.push({
      ton: "info",
      titel: `${Math.round(erst.anteil)} % der Buchungen kommen ${ausLand(erst.countryCode, erst.anzeige)}${stadt ? `, vor allem aus ${stadt.name}` : ""}.`,
      text: danach.length
        ? `Dahinter folgen ${danach.join(" und ")}.`
        : "Andere Länder spielen noch keine Rolle.",
    });
  }
  return out.slice(0, 3);
}

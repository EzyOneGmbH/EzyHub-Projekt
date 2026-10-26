// Search Console «Generative KI» — Import des CSV-Exports (Volkan 26.10.2026).
// Die Search-Console-API kennt fuer den KI-Bericht (KI-Übersichten + KI-Modus)
// keinen Typ (getestet: aiOverview/aiMode/generativeAi/ai/… → 400). Daher:
// in der Search Console «Exportieren → CSV herunterladen» (ZIP mit Seiten,
// Ländern, Geräten, Diagramm, Filter) und hier einlesen. Rein, ohne DOM —
// vitest-gedeckt.

export type KiTabelle = "page" | "country" | "device" | "date";
export type KiZeile = { key: string; imp: number; impPrev: number | null };
export type KiImport = {
  tabellen: Partial<Record<KiTabelle, KiZeile[]>>;
  startDate: string | null;
  endDate: string | null;
  compareStart: string | null;
  compareEnd: string | null;
  totalImp: number;
  totalImpPrev: number | null;
  dateien: string[];
};

// Byte-Order-Mark am Dateianfang (GSC-Exporte beginnen damit)
const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

// ── ZIP (nur «stored» und «deflate») über die eingebaute DecompressionStream ──
export async function entpackeZip(
  buf: ArrayBuffer,
): Promise<Array<{ name: string; text: string }>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End-of-central-directory suchen (Signatur 0x06054b50, max. 64 KB Kommentar)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Keine gültige ZIP-Datei");
  const anzahl = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Array<{ name: string; text: string }> = [];
  const utf8 = new TextDecoder("utf-8");
  for (let n = 0; n < anzahl; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt");
    const methode = v.getUint16(p + 10, true);
    const gross = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const kommLen = v.getUint16(p + 32, true);
    const lokal = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + kommLen;
    if (name.endsWith("/")) continue;
    const lNameLen = v.getUint16(lokal + 26, true);
    const lExtraLen = v.getUint16(lokal + 28, true);
    const start = lokal + 30 + lNameLen + lExtraLen;
    const daten = bytes.subarray(start, start + gross);
    let roh: Uint8Array;
    if (methode === 0) roh = daten;
    else if (methode === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const strom = new Blob([daten]).stream().pipeThrough(ds);
      roh = new Uint8Array(await new Response(strom).arrayBuffer());
    } else throw new Error(`ZIP-Methode ${methode} nicht unterstützt`);
    out.push({ name, text: utf8.decode(roh).replace(BOM, "") });
  }
  return out;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
export function parseCsv(text: string): string[][] {
  const t = text.replace(BOM, "");
  const erste = t.split(/\r?\n/, 1)[0] || "";
  // Trenner: Komma (GSC-Standard), sonst Semikolon/Tab (Excel-Umspeicherung)
  const trenner = [",", ";", "\t"].sort((a, b) => erste.split(b).length - erste.split(a).length)[0];
  const zeilen: string[][] = [];
  let feld = "";
  let zeile: string[] = [];
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          feld += '"';
          i++;
        } else inQ = false;
      } else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === trenner) {
      zeile.push(feld);
      feld = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld);
      if (zeile.some((x) => x.trim() !== "")) zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else feld += c;
  }
  zeile.push(feld);
  if (zeile.some((x) => x.trim() !== "")) zeilen.push(zeile);
  return zeilen;
}

// «1’234», «1,234», «1.234», «1234» → 1234 (Impressionen sind ganze Zahlen)
export function zahl(s: string): number | null {
  const t = String(s ?? "")
    .trim()
    .replace(/[\s'’.,]/g, "");
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

const ART: Array<[KiTabelle | "filter", RegExp]> = [
  ["page", /seite|page|url/i],
  ["country", /l(ä|ae|a)nder|land|countr/i],
  ["device", /ger(ä|ae|a)t|device/i],
  ["date", /diagramm|chart|datum|date/i],
  ["filter", /filter/i],
];
export function tabellenArt(dateiname: string, kopf: string[] = []): KiTabelle | "filter" | null {
  const basis = dateiname.split("/").pop() || dateiname;
  for (const [art, re] of ART) if (re.test(basis)) return art;
  const k0 = kopf[0] || "";
  for (const [art, re] of ART) if (re.test(k0)) return art;
  return null;
}

const VORHER = /vorherig|previous|vorher|vergleich|compar/i;

/** Eine Tabelle (Kopf + Zeilen) → KiZeilen. Erste Spalte = Schlüssel. */
export function leseTabelle(rows: string[][]): KiZeile[] {
  if (rows.length < 2) return [];
  const kopf = rows[0];
  const impSpalten = kopf
    .map((h, i) => ({ h, i }))
    .filter((x) => x.i > 0 && /impression/i.test(x.h));
  // Ohne «Impressionen»-Spalte: erste numerische Spalte nehmen
  const kandidaten = impSpalten.length
    ? impSpalten
    : kopf
        .map((h, i) => ({ h, i }))
        .filter((x) => x.i > 0 && rows.slice(1, 6).some((r) => zahl(r[x.i]) !== null))
        .slice(0, 2);
  if (!kandidaten.length) return [];
  const vorher = kandidaten.find((x) => VORHER.test(x.h));
  const aktuell = kandidaten.find((x) => x !== vorher) || kandidaten[0];
  const out: KiZeile[] = [];
  for (const r of rows.slice(1)) {
    const key = String(r[0] ?? "").trim();
    const imp = zahl(r[aktuell.i]);
    if (!key || imp === null) continue;
    out.push({ key, imp, impPrev: vorher ? (zahl(r[vorher.i]) ?? 0) : null });
  }
  return out;
}

// Datum «2026-10-26», «26.10.2026», «26. Okt. 2026», «Oct 26, 2026» → ISO
const MONATE: Record<string, number> = {
  jan: 1,
  feb: 2,
  mär: 3,
  mar: 3,
  mrz: 3,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};
export function isoDatum(s: string): string | null {
  const t = String(s || "").trim();
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/(\d{1,2})\.?\s+([A-Za-zäÄ]{3})[a-zä]*\.?\s+(\d{4})/);
  if (m && MONATE[m[2].toLowerCase()])
    return `${m[3]}-${String(MONATE[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONATE[m[1].toLowerCase()])
    return `${m[3]}-${String(MONATE[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Alle Dateien (aus ZIP oder einzeln) → ein Import. */
export function baueImport(dateien: Array<{ name: string; text: string }>): KiImport {
  const tabellen: KiImport["tabellen"] = {};
  let startDate: string | null = null;
  let endDate: string | null = null;
  let compareStart: string | null = null;
  let compareEnd: string | null = null;
  for (const d of dateien) {
    const rows = parseCsv(d.text);
    const art = tabellenArt(d.name, rows[0]);
    if (art === "filter") {
      // Filter.csv: Zeitraum-Zeile(n) mit Datumsangaben
      const daten = rows
        .flat()
        .map(isoDatum)
        .filter((x): x is string => !!x);
      if (daten.length >= 2) {
        [startDate, endDate] = [daten[0], daten[1]];
        if (daten.length >= 4) [compareStart, compareEnd] = [daten[2], daten[3]];
      }
      continue;
    }
    if (!art) continue;
    let zeilen = leseTabelle(rows);
    if (art === "date")
      zeilen = zeilen
        .map((z) => ({ ...z, key: isoDatum(z.key) || z.key }))
        .sort((a, b) => a.key.localeCompare(b.key));
    else zeilen.sort((a, b) => b.imp - a.imp);
    if (zeilen.length) tabellen[art] = zeilen;
  }
  // Zeitraum aus dem Diagramm, falls der Filter keinen hergab
  const tage = (tabellen.date || []).map((z) => z.key).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  if (!startDate && tage.length) {
    startDate = tage[0];
    endDate = tage[tage.length - 1];
  }
  // Totale: Diagramm (Tagessumme) ist vollständig; sonst Geräte/Länder
  const quelle = tabellen.date || tabellen.device || tabellen.country || tabellen.page || [];
  const totalImp = quelle.reduce((s, z) => s + z.imp, 0);
  const mitPrev = quelle.some((z) => z.impPrev !== null);
  return {
    tabellen,
    startDate,
    endDate,
    compareStart,
    compareEnd,
    totalImp,
    totalImpPrev: mitPrev ? quelle.reduce((s, z) => s + (z.impPrev || 0), 0) : null,
    dateien: dateien.map((d) => d.name),
  };
}

// ── Historie (Tageswerte) ────────────────────────────────────────────────────
export type KiTag = { datum: string; imp: number };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const plusTage = (iso: string, n: number) =>
  new Date(utc(iso) + n * 86_400_000).toISOString().slice(0, 10);
export const tageZwischen = (von: string, bis: string) =>
  Math.round((utc(bis) - utc(von)) / 86_400_000);

/** Tageswerte eines Imports. Bei einem Export mit «Vergleichen» liegen die
 *  Vorperioden-Werte tagesweise versetzt in derselben Zeile — sie werden auf
 *  ihr eigenes Datum (Vergleichsbeginn + Abstand) gelegt. */
export function tagesWerte(
  imp: Pick<KiImport, "tabellen" | "startDate" | "compareStart">,
): KiTag[] {
  const tage = (imp.tabellen.date || []).filter((z) => ISO.test(z.key));
  const out = new Map<string, number>();
  for (const z of tage) out.set(z.key, z.imp);
  if (imp.startDate && imp.compareStart && ISO.test(imp.startDate) && ISO.test(imp.compareStart)) {
    const off = tageZwischen(imp.startDate, imp.compareStart);
    for (const z of tage)
      if (z.impPrev !== null) {
        const d = plusTage(z.key, off);
        if (!out.has(d)) out.set(d, z.impPrev);
      }
  }
  return [...out.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([datum, imp]) => ({ datum, imp }));
}

/** Tagesreihe für einen Zeitraum, optional mit Vergleich (tagesweise nach
 *  Abstand zum jeweiligen Beginn). Fehlende Tage = 0. */
export function reiheFuer(
  tage: KiTag[],
  von: string,
  bis: string,
  vergleich?: { von: string; bis: string } | null,
): KiZeile[] {
  const m = new Map(tage.map((t) => [t.datum, t.imp]));
  const n = Math.max(0, tageZwischen(von, bis)) + 1;
  const nV = vergleich ? Math.max(0, tageZwischen(vergleich.von, vergleich.bis)) + 1 : 0;
  const out: KiZeile[] = [];
  for (let i = 0; i < n; i++) {
    const d = plusTage(von, i);
    out.push({
      key: d,
      imp: m.get(d) ?? 0,
      impPrev: vergleich ? (i < nV ? (m.get(plusTage(vergleich.von, i)) ?? 0) : 0) : null,
    });
  }
  return out;
}

export const summeTage = (tage: KiTag[], von: string, bis: string) =>
  tage.reduce((s, t) => (t.datum >= von && t.datum <= bis ? s + t.imp : s), 0);

/** Datei(en) aus dem Upload lesen: ZIP entpacken, CSV direkt. */
export async function leseUpload(
  dateien: Array<{ name: string; buf: ArrayBuffer }>,
): Promise<KiImport> {
  const alle: Array<{ name: string; text: string }> = [];
  for (const d of dateien) {
    const b = new Uint8Array(d.buf);
    if (b[0] === 0x50 && b[1] === 0x4b) alle.push(...(await entpackeZip(d.buf)));
    else alle.push({ name: d.name, text: new TextDecoder("utf-8").decode(b) });
  }
  return baueImport(alle);
}

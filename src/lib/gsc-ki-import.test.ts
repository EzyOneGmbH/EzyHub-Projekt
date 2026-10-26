import { describe, expect, it } from "vitest";
import {
  baueImport,
  entpackeZip,
  isoDatum,
  leseTabelle,
  leseUpload,
  parseCsv,
  tabellenArt,
  zahl,
} from "./gsc-ki-import";

// Minimaler ZIP-Bauer (stored + deflate) fuer echte Archive im Test.
async function zip(files: Array<{ name: string; text: string; deflate?: boolean }>) {
  const enc = new TextEncoder();
  const lokale: Uint8Array[] = [];
  const zentrale: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const roh = enc.encode(f.text);
    const daten = f.deflate
      ? new Uint8Array(
          await new Response(
            new Blob([roh]).stream().pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        )
      : roh;
    const name = enc.encode(f.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, f.deflate ? 8 : 0, true);
    lh.setUint32(18, daten.length, true);
    lh.setUint32(22, roh.length, true);
    lh.setUint16(26, name.length, true);
    const lokal = new Uint8Array([...new Uint8Array(lh.buffer), ...name, ...daten]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, f.deflate ? 8 : 0, true);
    ch.setUint32(20, daten.length, true);
    ch.setUint32(24, roh.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    zentrale.push(new Uint8Array([...new Uint8Array(ch.buffer), ...name]));
    lokale.push(lokal);
    off += lokal.length;
  }
  const cdLen = zentrale.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdLen, true);
  e.setUint32(16, off, true);
  const teile = [...lokale, ...zentrale, new Uint8Array(e.buffer)];
  const out = new Uint8Array(teile.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const t of teile) {
    out.set(t, p);
    p += t.length;
  }
  return out.buffer;
}

const SEITEN = `Top-Seiten,Letzte 2 Monate Impressionen,Vorheriger Zeitraum Impressionen
https://excent.ch/,"1,234",800
https://excent.ch/beratung/,56,70
https://excent.ch/kontakt/,3,0
`;
const LAENDER = `Land,Letzte 2 Monate Impressionen,Vorheriger Zeitraum Impressionen
Schweiz,1200,820
Deutschland,93,50
`;
const DIAGRAMM = `Datum,Letzte 2 Monate Impressionen,Vorheriger Zeitraum Impressionen
2026-08-26,700,400
2026-08-25,593,470
`;

describe("gsc-ki-import", () => {
  it("parseCsv: Quotes, Kommas im Feld, CRLF, Semikolon", () => {
    expect(parseCsv('a,b\r\n"x, y","1,234"\r\n')).toEqual([
      ["a", "b"],
      ["x, y", "1,234"],
    ]);
    expect(parseCsv("a;b\nc;d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("zahl / isoDatum / tabellenArt", () => {
    expect(zahl("1’234")).toBe(1234);
    expect(zahl("1,234")).toBe(1234);
    expect(zahl("abc")).toBeNull();
    expect(isoDatum("26.10.2026")).toBe("2026-10-26");
    expect(isoDatum("26. Okt. 2026")).toBe("2026-10-26");
    expect(isoDatum("Oct 26, 2026")).toBe("2026-10-26");
    expect(tabellenArt("Seiten.csv")).toBe("page");
    expect(tabellenArt("Länder.csv")).toBe("country");
    expect(tabellenArt("Geräte.csv")).toBe("device");
    expect(tabellenArt("Diagramm.csv")).toBe("date");
    expect(tabellenArt("Filter.csv")).toBe("filter");
    expect(tabellenArt("x.csv", ["Pages", "Impressions"])).toBe("page");
  });

  it("leseTabelle erkennt aktuelle und vorherige Impressionen", () => {
    expect(leseTabelle(parseCsv(SEITEN))).toEqual([
      { key: "https://excent.ch/", imp: 1234, impPrev: 800 },
      { key: "https://excent.ch/beratung/", imp: 56, impPrev: 70 },
      { key: "https://excent.ch/kontakt/", imp: 3, impPrev: 0 },
    ]);
    // ohne Vergleich: impPrev null
    expect(leseTabelle(parseCsv("Seiten,Impressionen\n/a,5\n"))).toEqual([
      { key: "/a", imp: 5, impPrev: null },
    ]);
  });

  it("baueImport: Zeitraum aus dem Diagramm, Totale aus Tagessumme, sortiert", () => {
    const imp = baueImport([
      { name: "Seiten.csv", text: SEITEN },
      { name: "Länder.csv", text: LAENDER },
      { name: "Diagramm.csv", text: DIAGRAMM },
      { name: "Filter.csv", text: "Filter,Wert\nSuchtyp,Generative KI\n" },
    ]);
    expect(imp.startDate).toBe("2026-08-25");
    expect(imp.endDate).toBe("2026-08-26");
    expect(imp.totalImp).toBe(1293);
    expect(imp.totalImpPrev).toBe(870);
    expect(imp.tabellen.date?.[0].key).toBe("2026-08-25");
    expect(imp.tabellen.page?.[0].key).toBe("https://excent.ch/");
    expect(imp.tabellen.country).toHaveLength(2);
  });

  it("entpackt ein echtes ZIP (stored + deflate) und liest es ein", async () => {
    const buf = await zip([
      { name: "Seiten.csv", text: "﻿" + SEITEN, deflate: true },
      { name: "Diagramm.csv", text: DIAGRAMM },
    ]);
    const files = await entpackeZip(buf);
    expect(files.map((f) => f.name)).toEqual(["Seiten.csv", "Diagramm.csv"]);
    expect(files[0].text.startsWith("Top-Seiten")).toBe(true);
    const imp = await leseUpload([{ name: "export.zip", buf }]);
    expect(imp.tabellen.page).toHaveLength(3);
    expect(imp.totalImp).toBe(1293);
  });
});

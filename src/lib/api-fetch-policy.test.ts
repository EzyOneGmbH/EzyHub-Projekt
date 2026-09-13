// Multi-Org-Vertrag (13.09.2026, statischer Test): Browser-Code darf eigene
// /api/*-Routen ausschliesslich ueber authedFetch (bzw. den darauf
// aufsetzenden ezyFetch) aufrufen — ein direktes fetch() wuerde die aktive
// Organisation (X-Ezy-Active-Org) verschweigen. Ergaenzt die ESLint-Regel
// (eslint.config.js, no-restricted-syntax) um Faelle mit variabler URL.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// Bewusste Ausnahmen (Pfade relativ zu src/, Vorwaerts-Slashes).
const ERLAUBT = new Set([
  "lib/authed-fetch.ts", // der Helfer selbst
  "routes/r.$token.tsx", // oeffentlicher, signierter Report-Link (kein Login)
  "routes/github-status.tsx", // Fremd-API (GitHub)
]);
const SERVER_RE = /^(routes\/api\/|lib\/mcp\/|server\/)|\.server\.ts$|\.test\.tsx?$/;

function alleDateien(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) alleDateien(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Alle bare `fetch(`-Aufrufe (kein authedFetch/ezyFetch) mit dem Beginn des 1. Arguments. */
function bareFetches(src: string): Array<{ zeile: number; arg: string }> {
  const out: Array<{ zeile: number; arg: string }> = [];
  const re = /(?<![\w.$])fetch\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const arg = src.slice(m.index + m[0].length, m.index + m[0].length + 80).replace(/\s+/g, " ");
    const zeile = src.slice(0, m.index).split("\n").length;
    out.push({ zeile, arg });
  }
  return out;
}

describe("Browser-Code ruft eigene /api-Routen nur ueber authedFetch auf", () => {
  const dateien = alleDateien(SRC)
    .map((p) => relative(SRC, p).replace(/\\/g, "/"))
    .filter((rel) => !SERVER_RE.test(rel) && !ERLAUBT.has(rel));

  it("kein direktes fetch() auf /api/... oder mit variabler URL (ausser externe https-Ziele)", () => {
    const verstoesse: string[] = [];
    for (const rel of dateien) {
      const src = readFileSync(join(SRC, rel), "utf8");
      for (const f of bareFetches(src)) {
        // Erlaubt: explizit externe Ziele (https://...) — z. B. Wikidata.
        if (/^[`'"]https?:\/\//.test(f.arg)) continue;
        verstoesse.push(`${rel}:${f.zeile} fetch(${f.arg.slice(0, 50)}…)`);
      }
    }
    expect(verstoesse).toEqual([]);
  });

  it("ezyFetch (zweiter Helfer) delegiert an authedFetch statt an fetch", () => {
    const src = readFileSync(join(SRC, "ezy/data/api.ts"), "utf8");
    expect(src).toMatch(/return authedFetch\(ezyApiUrl\(path\)/);
    expect(bareFetches(src)).toEqual([]);
  });

  it("die bekannten Admin-Aufrufstellen (ServicesPanel, Audit-Log, Readiness) nutzen authedFetch", () => {
    const pruefe = (rel: string, marker: RegExp) => {
      const src = readFileSync(join(SRC, rel), "utf8");
      const idx = src.search(marker);
      expect({ rel, gefunden: idx >= 0 }).toEqual({ rel, gefunden: true });
      // Der Aufruf unmittelbar vor dem Marker muss authedFetch sein.
      const davor = src.slice(Math.max(0, idx - 200), idx);
      expect({ rel, davor: /authedFetch\(\s*$/.test(davor) }).toEqual({ rel, davor: true });
    };
    pruefe("ezy/components/ServicesPanel.jsx", /`\/api\/admin\/client-readiness\?client=/);
    pruefe("ezy/AdminClients.jsx", /`\/api\/admin\/audit-log\?client=/);
    pruefe("ezy/AdminClients.jsx", /`\/api\/admin\/ga4-conversions\?client=/);
  });
});

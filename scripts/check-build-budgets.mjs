#!/usr/bin/env node
// CI-Budgets fuer den Build (13.09.2026, Volkan):
//  1) Client-Chunks: kein JS-Asset in .output/public/assets ueber CHUNK_MAX_KB
//     (Bundle-Split-Ziel seit 21.08.2026: < 500 KB je Chunk).
//  2) Build-Warnungen: nur die dokumentierten, bewusst tolerierten Warnungen
//     (vite.config.ts) sind erlaubt — jede neue Warnung bricht die CI.
//
//   npm run build 2>&1 | tee build.log
//   node scripts/check-build-budgets.mjs build.log
// Exit 1 bei Verstoss; Ausgabe listet Groessen und fremde Warnungen.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHUNK_MAX_KB = Number(process.env.CHUNK_MAX_KB || 500);
const ASSETS = join(process.cwd(), ".output", "public", "assets");
const logPfad = process.argv[2] || "";

// Tolerierte Warnungen (Begruendung in vite.config.ts / dependency-hygiene):
//  - nitro baut mit Rolldown-Optionen, Vite 7/Rollup kennt `platform` nicht
//  - nitro-Hinweis auf Vite ^8, informativ
//  - "use client"-Direktiven in @tanstack/react-router (Rollup ignoriert sie)
const ERLAUBT = [
  /Unknown input options: platform/,
  // CI (Linux) formatiert mit Backticks: «`vite` builder requires `^8`»
  /vite`? builder requires `?\^8/,
  /Module level directives cause errors when bundled, "use client"/,
];

let fehler = 0;

// 1) Chunk-Budget
if (!existsSync(ASSETS)) {
  console.error(`Assets-Ordner fehlt: ${ASSETS} — zuerst \`npm run build\``);
  process.exit(2);
}
const chunks = readdirSync(ASSETS)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ name: f, kb: Math.round(statSync(join(ASSETS, f)).size / 1024) }))
  .sort((a, b) => b.kb - a.kb);
console.log(`Client-Chunks (Budget ${CHUNK_MAX_KB} KB je Datei, ${chunks.length} Dateien):`);
for (const c of chunks.slice(0, 8)) {
  const ok = c.kb <= CHUNK_MAX_KB;
  if (!ok) fehler++;
  console.log(`  ${ok ? "OK    " : "ZU GROSS"} ${String(c.kb).padStart(5)} KB  ${c.name}`);
}
for (const c of chunks.slice(8))
  if (c.kb > CHUNK_MAX_KB) {
    fehler++;
    console.log(`  ZU GROSS ${String(c.kb).padStart(5)} KB  ${c.name}`);
  }

// 2) Warnungs-Budget
if (logPfad) {
  const log = readFileSync(logPfad, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const zeilen = log.split(/\r?\n/).filter((l) => /\bwarn(ing)?\b/i.test(l));
  const fremd = zeilen.filter((l) => !ERLAUBT.some((re) => re.test(l)));
  console.log(
    `\nBuild-Warnungen: ${zeilen.length} gesamt, ${zeilen.length - fremd.length} toleriert, ${fremd.length} neu`,
  );
  for (const l of fremd) {
    fehler++;
    console.log(`  NEU  ${l.trim().slice(0, 200)}`);
  }
} else {
  console.log("\n(kein Build-Log uebergeben — Warnungs-Budget uebersprungen)");
}

console.log(fehler ? `\n${fehler} Budget-Verstoss/-Verstoesse` : "\nBudgets eingehalten");
process.exit(fehler ? 1 : 0);

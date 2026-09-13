#!/usr/bin/env node
// Deployment-Smoke-Test (13.09.2026): prueft NACH einem Deploy den verwalteten
// Scheduler Ende-zu-Ende — pg_cron-Jobs, pg_net-Antworten, Vault-Secret,
// Worker-Heartbeat, Watchdog-Probe, Wiedervorlage-Sweep — ueber den echten
// Admin-Systemcheck (interner Pfad, ADMIN_AUTOMATION_SECRET) und den
// Heartbeat-Endpunkt. Exit-Code 1 bei jedem Befund, damit der Lauf in einer
// Deploy-Pipeline oder vom Cloud PC aus als Gate dienen kann.
//
//   node scripts/smoke-deploy.mjs                # Ziel https://ezyhub.ch
//   EZYHUB_BASE_URL=https://... node scripts/smoke-deploy.mjs
// Secret: ADMIN_AUTOMATION_SECRET aus der Umgebung, sonst ~/agent-service/.env.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = (process.env.EZYHUB_BASE_URL || "https://ezyhub.ch").replace(/\/+$/, "");
let secret = process.env.ADMIN_AUTOMATION_SECRET || "";
if (!secret) {
  try {
    const env = readFileSync(join(homedir(), "agent-service", ".env"), "utf8");
    secret = (env.match(/^ADMIN_AUTOMATION_SECRET=(.*)$/m)?.[1] || "").trim();
  } catch {
    /* kein Fallback */
  }
}
if (!secret) {
  console.error("ADMIN_AUTOMATION_SECRET fehlt (Umgebung oder ~/agent-service/.env)");
  process.exit(2);
}
const H = { Authorization: `Bearer ${secret}` };
const holen = async (pfad) => {
  const r = await fetch(`${base}${pfad}`, { headers: H, signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};

const zeilen = [];
let fehler = 0;
const melde = (name, ok, detail) => {
  zeilen.push([ok ? "OK " : "FEHLER", name, detail]);
  if (!ok) fehler++;
};

// 1) Systemcheck (nur Scheduler-Teil, interner Pfad)
const sc = await holen("/api/admin/system-check?scheduler=1");
if (sc.status !== 200 || !sc.j?.ok) {
  melde("Systemcheck erreichbar", false, `HTTP ${sc.status}: ${sc.j?.error || "keine Antwort"}`);
} else {
  for (const c of sc.j.scheduler.checks) melde(c.name, c.status === "ok", c.detail);
}

// 2) Heartbeat-Endpunkt (unabhaengiger zweiter Blick, gleiche Schwellen)
const orgMatch = JSON.stringify(sc.j?.scheduler?.roh?.heartbeat || {});
void orgMatch;
const hb = await holen("/api/agent/analyse?worker=1&org=00000000-0000-4000-8000-000000000000");
if (hb.status === 200 && hb.j?.ok)
  melde(
    "Heartbeat-Endpunkt",
    hb.j.zustand === "aktiv" && hb.j.scheduler === "pg_cron",
    `${hb.j.zustand} via ${hb.j.scheduler ?? "?"}, Alter ${Math.round((hb.j.alterMs ?? 0) / 1000)} s`,
  );
else melde("Heartbeat-Endpunkt", false, `HTTP ${hb.status}: ${hb.j?.error || "keine Antwort"}`);

// Ausgabe
const w = Math.max(...zeilen.map((z) => z[1].length));
console.log(`Deployment-Smoke ${base} — ${new Date().toISOString()}`);
for (const [st, name, detail] of zeilen)
  console.log(`${st.padEnd(6)} ${name.padEnd(w)}  ${detail}`);
console.log(fehler ? `\n${fehler} Befund(e)` : "\nalles ok");
process.exit(fehler ? 1 : 0);

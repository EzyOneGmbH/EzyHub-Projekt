#!/usr/bin/env node
// Claude-Code-Hook: meldet diese Session per Heartbeat an /api/claude-sessions,
// damit das iPhone-Widget (scripts/iphone-widget/claude-sessions-widget.js) den
// Verbindungsstatus anzeigen kann. Siehe docs/IPHONE-WIDGET.md.
//
// Wird von den Hooks in .claude/settings.json aufgerufen (SessionStart,
// UserPromptSubmit, Stop, SessionEnd). Der Hook darf eine Session niemals
// blockieren: ohne CLAUDE_SESSIONS_TOKEN oder bei jedem Fehler => exit 0, still.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename } from "node:path";

const token = process.env.CLAUDE_SESSIONS_TOKEN;
if (!token) process.exit(0);
const base = (process.env.EZYHUB_BASE_URL || "https://ezyhub.ch").replace(/\/+$/, "");

let hook = {};
try {
  hook = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // kein/kaputtes stdin-JSON — unten ggf. ueber Env weitermachen
}
const sessionId = hook.session_id || process.env.CLAUDE_SESSION_ID;
if (!sessionId) process.exit(0);

const cwd = hook.cwd || process.cwd();
let branch = "";
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  // kein Git-Repo — Label bleibt ohne Branch
}
const label = branch ? `${basename(cwd)} @ ${branch}` : basename(cwd);
const status = hook.hook_event_name === "SessionEnd" ? "ended" : "active";

try {
  await fetch(`${base}/api/claude-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: sessionId, label, source: "claude-code-remote", status }),
    signal: AbortSignal.timeout(5000),
  });
} catch {
  // Netzwerkfehler ignorieren — Heartbeat ist best effort
}
process.exit(0);

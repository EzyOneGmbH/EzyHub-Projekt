// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: robot;
//
// EZY ONE — "Remote Claude Chats" iPhone-Widget (Scriptable, https://scriptable.app)
// Zeigt an, welche Remote-Claude-Code-Sessions gerade verbunden sind.
// Datenquelle: GET https://ezyhub.ch/api/claude-sessions (Token-Auth).
// Setup: siehe docs/IPHONE-WIDGET.md in diesem Repo.

// ── Konfiguration ────────────────────────────────────────────────────────────
const BASE_URL = "https://ezyhub.ch";
// Token hier eintragen ODER als Widget-Parameter setzen (Widget lange druecken
// → "Widget bearbeiten" → Parameter). Der Parameter gewinnt.
const TOKEN = "HIER_CLAUDE_SESSIONS_TOKEN_EINTRAGEN";
const STALE_MINUTES = 10; // ab wann eine Session als "offline" gilt
// ─────────────────────────────────────────────────────────────────────────────

const token = (args.widgetParameter || "").trim() || TOKEN;

const COLOR_BG = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
const COLOR_TEXT = Color.dynamic(new Color("#111111"), new Color("#ffffff"));
const COLOR_MUTED = Color.dynamic(new Color("#6b7280"), new Color("#9ca3af"));
const COLOR_ON = new Color("#22c55e");
const COLOR_OFF = Color.dynamic(new Color("#d1d5db"), new Color("#4b5563"));

async function loadSessions() {
  const url = `${BASE_URL.replace(/\/+$/, "")}/api/claude-sessions?stale_minutes=${STALE_MINUTES}`;
  const req = new Request(url);
  req.headers = { Authorization: `Bearer ${token}` };
  req.timeoutInterval = 15;
  return await req.loadJSON();
}

function relativeTime(minutes) {
  if (minutes < 0) return "unbekannt";
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${Math.round(minutes)} Min`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.round(h / 24)} Tg`;
}

function addHeader(widget, connectedCount) {
  const header = widget.addStack();
  header.centerAlignContent();
  const title = header.addText("Claude Chats");
  title.font = Font.boldSystemFont(13);
  title.textColor = COLOR_TEXT;
  header.addSpacer();
  const badge = header.addText(`${connectedCount} online`);
  badge.font = Font.mediumSystemFont(11);
  badge.textColor = connectedCount > 0 ? COLOR_ON : COLOR_MUTED;
}

function addSessionRow(widget, session) {
  const row = widget.addStack();
  row.centerAlignContent();
  row.spacing = 6;

  const dot = row.addText("●");
  dot.font = Font.systemFont(10);
  dot.textColor = session.connected ? COLOR_ON : COLOR_OFF;

  const col = row.addStack();
  col.layoutVertically();
  const label = col.addText(session.label || session.session_id.slice(0, 12));
  label.font = Font.mediumSystemFont(12);
  label.textColor = session.connected ? COLOR_TEXT : COLOR_MUTED;
  label.lineLimit = 1;
  const sub = col.addText(
    session.connected ? "verbunden" : `offline · ${relativeTime(session.minutes_since_seen)}`,
  );
  sub.font = Font.systemFont(10);
  sub.textColor = COLOR_MUTED;
  sub.lineLimit = 1;
  row.addSpacer();
}

function buildWidget(data) {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  widget.setPadding(14, 14, 14, 14);

  const sessions = data.sessions || [];
  const connectedCount = data.connected_count || 0;
  addHeader(widget, connectedCount);
  widget.addSpacer(8);

  const maxRows =
    config.widgetFamily === "large" ? 8 : config.widgetFamily === "medium" ? 3 : 2;

  if (sessions.length === 0) {
    const empty = widget.addText("Keine Sessions in den letzten 7 Tagen");
    empty.font = Font.systemFont(11);
    empty.textColor = COLOR_MUTED;
  } else {
    for (const session of sessions.slice(0, maxRows)) {
      addSessionRow(widget, session);
      widget.addSpacer(6);
    }
    if (sessions.length > maxRows) {
      const more = widget.addText(`+${sessions.length - maxRows} weitere`);
      more.font = Font.systemFont(10);
      more.textColor = COLOR_MUTED;
    }
  }

  widget.addSpacer();
  const footer = widget.addText(
    `Stand ${new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`,
  );
  footer.font = Font.systemFont(9);
  footer.textColor = COLOR_MUTED;
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  return widget;
}

function buildErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  widget.setPadding(14, 14, 14, 14);
  const title = widget.addText("Claude Chats");
  title.font = Font.boldSystemFont(13);
  title.textColor = COLOR_TEXT;
  widget.addSpacer(6);
  const err = widget.addText(message);
  err.font = Font.systemFont(11);
  err.textColor = COLOR_MUTED;
  return widget;
}

let widget;
try {
  const data = await loadSessions();
  widget = buildWidget(data);
} catch (e) {
  widget = buildErrorWidget(`Fehler beim Laden: ${e}`);
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();

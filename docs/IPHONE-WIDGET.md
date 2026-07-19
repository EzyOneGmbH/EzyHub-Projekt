# iPhone-Widget: Remote Claude Chats

Zeigt auf dem iPhone-Homescreen, welche Remote-Claude-Code-Sessions (claude.ai/code)
gerade **verbunden** sind. Es gibt keine offizielle Anthropic-API, um Sessions
aufzulisten — deshalb melden sich die Sessions selbst per Heartbeat bei EzyHub:

```
Claude-Code-Session (Hook)  ──POST──▶  ezyhub.ch/api/claude-sessions  ──▶  Supabase (claude_sessions)
iPhone-Widget (Scriptable)  ──GET───▶  ezyhub.ch/api/claude-sessions
```

Eine Session gilt als **verbunden**, wenn ihr letzter Heartbeat jünger als
10 Minuten ist (anpassbar per `?stale_minutes=`). Heartbeats werden bei
Session-Start, jedem Prompt, jedem Antwort-Ende und Session-Ende gesendet.

## Einrichtung

### 1. Migration anwenden

`supabase/migrations/20260719120000_claude_sessions.sql` manuell auf der Prod-DB
ausführen (Lovable wendet Repo-Migrationen nicht automatisch an). Solange die
Migration fehlt, antwortet die Route mit `503` — die App ist nicht betroffen.

### 2. Token setzen

Einen zufälligen Token erzeugen (mindestens 16 Zeichen), z. B.:

```bash
openssl rand -hex 24
```

Dann **denselben** Wert an zwei Stellen als Env-Variable `CLAUDE_SESSIONS_TOKEN`
hinterlegen:

- **Lovable-Deployment-Env** (Server-Route prüft dagegen)
- **Claude-Code-Umgebung(en)** unter claude.ai/code → Environment-Settings
  (der Heartbeat-Hook liest ihn dort)

Ohne Token in der Claude-Umgebung bleibt der Hook einfach still — nichts bricht.
Optional: `EZYHUB_BASE_URL` in der Claude-Umgebung setzen, falls nicht
`https://ezyhub.ch` (Default).

### 3. Widget auf dem iPhone einrichten

1. [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) aus dem
   App Store installieren (gratis).
2. In Scriptable ein neues Skript anlegen und den Inhalt von
   `scripts/iphone-widget/claude-sessions-widget.js` hineinkopieren.
3. Den Token eintragen — entweder oben im Skript (`TOKEN = "..."`) **oder**
   später als Widget-Parameter (Widget lange drücken → „Widget bearbeiten" →
   Parameter). Der Parameter gewinnt.
4. Auf dem Homescreen ein Scriptable-Widget hinzufügen (klein, mittel oder
   groß), lange drücken → „Widget bearbeiten" → das Skript auswählen.

Das Widget aktualisiert sich automatisch (iOS entscheidet den Takt, Richtwert
ca. alle 5–15 Minuten) und zeigt pro Session: Name (`Repo @ Branch`), Status
(grüner Punkt = verbunden) und wann sie zuletzt gesehen wurde.

## Grenzen

- Es erscheinen nur Sessions aus Umgebungen, in denen der Heartbeat-Hook aktiv
  ist (dieses Repo bringt ihn über `.claude/settings.json` automatisch mit;
  für andere Repos den Hook-Block plus `scripts/claude-session-heartbeat.mjs`
  dorthin kopieren).
- „Verbunden" heißt: Heartbeat in den letzten 10 Minuten. Eine Session, die
  lange still arbeitet, ohne dass Hooks feuern, kann kurzzeitig als offline
  erscheinen.
- Sessions ohne Aktivität seit 7 Tagen werden ausgeblendet.

## API-Referenz

`GET /api/claude-sessions?stale_minutes=10` — Header `Authorization: Bearer <Token>`

```json
{
  "generated_at": "2026-07-19T12:00:00.000Z",
  "stale_minutes": 10,
  "connected_count": 1,
  "sessions": [
    {
      "session_id": "…",
      "label": "EzyHub-Projekt @ claude/feature-x",
      "source": "claude-code-remote",
      "status": "active",
      "started_at": "…",
      "last_seen_at": "…",
      "connected": true,
      "minutes_since_seen": 2
    }
  ]
}
```

`POST /api/claude-sessions` — gleicher Auth-Header, Body:
`{ "session_id": "…", "label": "…", "source": "…", "status": "active" | "ended" }`

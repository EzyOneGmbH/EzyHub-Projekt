# EZY ONE — Betriebs- & Onboarding-Handbuch

Stand: 2026-06-05. Dieses Dokument beschreibt, **was wo läuft**, **welche Keys nötig sind**,
**wie ein neuer Kunde angelegt wird** und **was im Störungsfall zu tun ist**.

> ⚠️ Keine Secret-Werte in diesem Dokument — nur Namen & Fundorte. Werte liegen in den
> jeweiligen Env-/Secret-Stores (Lovable-Deployment, `~/.canonry/config.yaml`,
> `~/agent-service/.env`).

---

## 1. Architektur — was läuft wo

```
Browser ─► ezyhub.ch (Lovable-Deployment, Cloudflare Worker / TanStack Start)
                │  Server-Routen unter /api/*
                ├─► Ahrefs / Perplexity / Google (GA4, GSC, PageSpeed)   [direkte APIs]
                ├─► https://agent.ezyhub.ch   ─► Agent-Service (Claude Agent SDK + Plugins)
                └─► https://canonry.ezyhub.ch ─► Canonry (AEO/GEO-Monitoring)

Cloud PC (Windows 365)  ── trägt die drei Backend-Teile:
  • Agent-Service   (Node, Port 8787)   ~/agent-service/server.mjs
  • Canonry         (Node, Port 4100)   global: @ainyc/canonry
  • cloudflared     (Windows-Dienst)    Named Tunnel "ezyone" → agent./canonry.ezyhub.ch
```

- **Frontend + /api-Routen:** Lovable-managed Deployment auf der Domain **ezyhub.ch**
  (`ezy-one-magic.lovable.app` leitet dorthin um). Deploy erfolgt über GitHub-Sync
  (Repo `EzyOneGmbH/ezy-one-tool-980a32b9`, Branch `main`) → Änderungen gehen erst nach
  einem **Redeploy** live (Sync-Lag möglich; am wechselnden JS-Bundle-Hash erkennbar).
- **Agent-Service:** führt echte Plugin-Skills (claude-seo / claude-blog / claude-obsidian)
  serverseitig aus. Async-Jobs (`POST /run-skill {async:true}` → `GET /jobs?id=`), damit
  lange Läufe das Worker-Timeout nicht treffen.
- **Canonry:** lokaler AEO-Server; liefert GEO-Daten (AI-Visibility je Provider).
- **cloudflared:** Named Tunnel als Windows-Autostart-Dienst → stabile HTTPS-Hostnames.

> **Cloud-PC-Hinweis:** Die drei Backend-Teile laufen auf dem Cloud PC. Sie sind nur
> erreichbar, solange der Cloud PC läuft und eingeloggt ist. (Bewusste Entscheidung —
> kein 24/7-Umzug.)

---

## 2. Secrets & Keys

### Lovable-Deployment (Environment Variables / Secrets, **ohne** `VITE_`-Präfix für Server-Routen)
| Name | Zweck |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Server-seitiger Supabase-Zugriff |
| `SUPABASE_SERVICE_ROLE_KEY` | Persistenz (audit_runs etc.) serverseitig |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-Build (Build-Zeit) — auch als `.env.production` im Repo (public anon key) |
| `AGENT_BASE_URL` = `https://agent.ezyhub.ch` | Agent-Service-Bridge |
| `AGENT_SHARED_SECRET` | Bearer-Auth App ↔ Agent-Service (muss = `~/agent-service/.env`) |
| `CANONRY_BASE_URL` = `https://canonry.ezyhub.ch` | Canonry-Anbindung |
| `CANONRY_API_KEY` | Canonry-Auth (muss = `~/.canonry/config.yaml apiKey`) |
| `AHREFS_API_KEY` | Ahrefs-Audits (`/api/ahrefs/overview`) |
| `PERPLEXITY_API_KEY` | GEO/AEO-Suche |
| `ANTHROPIC_API_KEY` | `/api/ai/generate` (direkter LLM-Call) |
| `GOOGLE_API_KEY` | PageSpeed Insights + CrUX (Core Web Vitals) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET` | Google-OAuth (GSC/GA4) |

### Agent-Service (`~/agent-service/.env`, gitignored)
`ANTHROPIC_API_KEY`, `AGENT_SHARED_SECRET`, `PORT=8787`, `AGENT_MODEL`, `AGENT_MAX_TURNS`
sowie MCP-Integrationen: `AHREFS_API_TOKEN`, `FIRECRAWL_API_KEY`, `GOOGLE_AI_API_KEY` (Gemini-Bild).

### Canonry (`~/.canonry/config.yaml`)
`apiKey`, LLM-Provider-Keys (claude/openai/gemini/perplexity), Google-OAuth, GA4-Service-Account.

### Google Cloud (für den `GOOGLE_API_KEY`)
APIs aktivieren: **PageSpeed Insights API**, **Chrome UX Report API** (+ für GSC/GA4 OAuth/Service-Account).
Key-Restriktion empfohlen: nur diese APIs erlauben.

---

## 3. Neuen Kunden anlegen (Onboarding)

1. **Neuer Kunde** → Name + Domain (Domain ist Basis für Ahrefs & Core Web Vitals).
   → Beim Anlegen werden automatisch alle Provider aktiviert (`client_integrations`,
   `enabled=true`): ahrefs, google, canonry, perplexity, anthropic.
2. Kunde öffnen → **Onboarding-Karte** (oben im Detail). Checkliste „x/4 eingerichtet":
   - **Canonry-Projekt**: Button **„Automatisch anlegen"** → legt das Projekt via API an
     (`/api/canonry/create-project`) und speichert den Slug. Idempotent.
   - **Google (GSC + GA4)**: Property eintragen → **„Verbinden"** (OAuth-Popup) → **Import**.
     Der Google-Account muss in der Search Console *und* im GA4-Property berechtigt sein.
   - **Core Web Vitals**: über die Kachel „Core Web Vitals" auslösen (nur `GOOGLE_API_KEY` nötig).
3. Dashboards (SEO / GEO / Conversion) füllen sich nach den jeweiligen Läufen.

> **Semrush:** aktuell nicht verfügbar (Account hat keine API-Units). Kein Setup pro Kunde nötig.

---

## 4. Dashboards & Datenquellen

Alle Daten liegen in Supabase `audit_runs` (pro `audit_type`) bzw. kommen live von Providern.

| Dashboard | Quelle (audit_type / live) |
|---|---|
| **SEO** | `ahrefs` (Traffic/Visibility/Authority/Keywords), `gsc_summary` (Klicks/Impressionen/CTR/Position + Top-Queries), `pagespeed` (LCP/INP/CLS/Score), Audit-Historie (Trend) |
| **GEO** | live aus Canonry (AI-Visibility je Provider, Health, Evidence) |
| **Conversion** | `ga4_summary` (Sessions/Users/New/Engaged/Pageviews/Bounce/Ø-Dauer/Conversions/Revenue + Tages-Trend) |

**Metriken abschalten:** Einstellungen → **Dashboard-Metriken** (pro Organisation, Default = alles an).
Speicherung in `organizations.dashboard_config` (JSONB). Nur Admins.

**Kosten/Budget:** Jeder Skill-Lauf speichert `costUsd`. Monatsbudget pro Org via
`organizations.monthly_ai_budget_usd` (Default 50 $); bei Überschreitung wird ein Lauf mit
`402` abgewiesen.

---

## 5. Betrieb auf dem Cloud PC

### Dienste / Autostart
- **cloudflared**: Windows-Dienst `Cloudflared` (Autostart). Config: `~/.cloudflared/config.yml`.
- **Canonry**: Autostart-Task `EzyOne-Canonry` (beim Login) → `start-canonry.cmd` (Port 4100).
- **Agent-Service**: Autostart-Task `EzyOne-AgentService` (beim Login) → `start-agent.cmd` (Port 8787).
- **Auto-Restart:** `start-agent.cmd` / `start-canonry.cmd` laufen als **Endlos-Schleife** —
  stürzt der Dienst ab, startet ihn das Skript nach 5 s automatisch neu (Log:
  `~/agent-service/agent-restart.log` bzw. `canonry-restart.log`).
- **Watchdog:** Task `EzyOne-Watchdog` (alle 5 min) → `watchdog.cmd` prüft die Health beider
  Dienste und stösst bei Ausfall den jeweiligen Autostart-Task neu an (fängt den Fall ab, dass
  die Schleife selbst stirbt, z. B. nach Sleep). Log: `~/agent-service/watchdog.log`.
  > Hinweis: `ONLOGON`-Tasks allein starten einen abgestürzten Dienst NICHT neu — dafür sorgen
  > erst Schleife + Watchdog.

### Status prüfen / neu starten (PowerShell / Terminal)
```
sc query Cloudflared                         # Tunnel-Dienst
Get-NetTCPConnection -LocalPort 4100,8787 -State Listen   # laufen Canonry/Agent?
schtasks /Run /TN "EzyOne-Canonry"           # Canonry manuell starten
schtasks /Run /TN "EzyOne-AgentService"      # Agent manuell starten
```
Health-Checks (sollten 200 liefern):
```
curl https://agent.ezyhub.ch/health
curl -H "Authorization: Bearer <CANONRY_API_KEY>" https://canonry.ezyhub.ch/api/v1/projects/<slug>
```

### „Maschine hat geschlafen" / alles down
1. Am Cloud PC einloggen (startet die Autostart-Tasks).
2. Falls Ports leer: die beiden `schtasks /Run`-Befehle oben ausführen.
3. `sc query Cloudflared` → läuft der Dienst? sonst `sc start Cloudflared`.
4. Health-Checks bestätigen.

---

## 6. Deployment & CI

- **Deploy:** Push auf `main` → Lovable synct vom Repo → **Redeploy auslösen**. Erfolg am
  geänderten JS-Bundle-Hash (`/assets/main-*.js`) erkennbar.
- **Migrationen:** `supabase/migrations/*.sql` werden beim Deploy angewandt. Additive
  Migrationen degradieren sauber, falls noch nicht angewandt (z. B. Budget = aus).
- **CI:** `.github/workflows/ci.yml` — `npm test` (Vitest) + `npm run build` als harte Gates,
  `typecheck`/`lint` beratend.
- **Routen-Schnelltest** (ohne Login): eine `/api/*`-Route ohne Auth aufrufen →
  `401/400` = deployt & konfiguriert · `503` = Key fehlt · `404` = nicht deployt.

---

## 7. Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| App zeigt „Backend-Konfiguration fehlt" | `VITE_SUPABASE_*` fehlten im Build → in Lovable setzen + neu **publishen** (Bundle-Hash muss sich ändern). Fallback in `client.ts`. |
| `/api/...` → `503` | Zugehöriger Key fehlt im Lovable-Deployment. |
| Skill/GEO-Tool schlägt fehl | Agent-Service oder Canonry down → Cloud PC + Autostart-Tasks prüfen (Abschnitt 5). |
| GEO „Project not found" | Canonry-Projekt nicht angelegt → Onboarding-Karte „Canonry automatisch anlegen". |
| Core Web Vitals leer | `GOOGLE_API_KEY` im Deployment fehlt **oder** PageSpeed Insights API in Google Cloud nicht aktiviert. |
| Langer Skill bricht ab | Async-Pattern greift; sehr lange Orchestratoren (`seo-audit`, `blog`) können dennoch lange dauern. |

---

## 8. Bekannte Grenzen

- **Verfügbarkeit:** an den Cloud PC gebunden (kein 24/7).
- **Semrush:** keine API-Units → nicht integriert.
- **Skill-Toggles:** gruppenweise (nicht pro Einzelmetrik).
- **client.ts** trägt einen public Supabase-Fallback; bei Lovable-Regenerierung ggf. neu setzen.

---

## 9. Referenz — wichtige Dateien/Routen

- `src/ezy/EzyOneApp.jsx` — Haupt-App (Dashboards, Tools, Onboarding-Karte, Settings)
- `src/ezy/data/runTool.ts` — Tool-/Skill-Ausführung (inkl. Async Start+Poll)
- `src/ezy/data/skillCatalog.ts` — Katalog aller Plugin-Skills (auto-generiert)
- `src/routes/api/agent.run.ts`, `agent.job.ts` — Agent-Bridge (async + Budget)
- `src/routes/api/canonry.create-project.ts` — Canonry-Auto-Anlage
- `src/routes/api/google.*.ts` — GA4 / GSC / PageSpeed / OAuth
- `docs/SECURITY-RLS-AUDIT.md` — Multi-Tenant-RLS-Audit
- `~/agent-service/server.mjs` — Agent-Service (Cloud PC)

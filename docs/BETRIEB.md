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
  (Repo `EzyOneGmbH/EzyHub-Projekt`, Branch `main`) → Änderungen gehen erst nach
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

| Name                                                                                | Zweck                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                                          | Server-seitiger Supabase-Zugriff                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`                                                         | Persistenz (audit_runs etc.) serverseitig                                         |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`                                | Browser-Build (Build-Zeit) — auch als `.env.production` im Repo (public anon key) |
| `AGENT_BASE_URL` = `https://agent.ezyhub.ch`                                        | Agent-Service-Bridge                                                              |
| `AGENT_SHARED_SECRET`                                                               | Bearer-Auth App ↔ Agent-Service (muss = `~/agent-service/.env`)                   |
| `CANONRY_BASE_URL` = `https://canonry.ezyhub.ch`                                    | Canonry-Anbindung                                                                 |
| `CANONRY_API_KEY`                                                                   | Canonry-Auth (muss = `~/.canonry/config.yaml apiKey`)                             |
| `AHREFS_API_KEY`                                                                    | Ahrefs-Audits (`/api/ahrefs/overview`)                                            |
| `PERPLEXITY_API_KEY`                                                                | GEO/AEO-Suche                                                                     |
| `ANTHROPIC_API_KEY`                                                                 | `/api/ai/generate` (direkter LLM-Call)                                            |
| `GOOGLE_API_KEY`                                                                    | PageSpeed Insights + CrUX (Core Web Vitals)                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET` | Google-OAuth (GSC/GA4)                                                            |

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
     Der Google-Account muss in der Search Console _und_ im GA4-Property berechtigt sein.
   - **Core Web Vitals**: über die Kachel „Core Web Vitals" auslösen (nur `GOOGLE_API_KEY` nötig).
3. Dashboards (SEO / GEO / Conversion) füllen sich nach den jeweiligen Läufen.

> **Semrush:** aktuell nicht verfügbar (Account hat keine API-Units). Kein Setup pro Kunde nötig.

---

## 4. Dashboards & Datenquellen

Alle Daten liegen in Supabase `audit_runs` (pro `audit_type`) bzw. kommen live von Providern.

| Dashboard      | Quelle (audit_type / live)                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEO**        | `ahrefs` (Traffic/Visibility/Authority/Keywords), `gsc_summary` (Klicks/Impressionen/CTR/Position + Top-Queries), `pagespeed` (LCP/INP/CLS/Score), Audit-Historie (Trend) |
| **GEO**        | live aus Canonry (AI-Visibility je Provider, Health, Evidence)                                                                                                            |
| **Conversion** | `ga4_summary` (Sessions/Users/New/Engaged/Pageviews/Bounce/Ø-Dauer/Conversions/Revenue + Tages-Trend)                                                                     |

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

### Analyse-/Admin-Worker (verwalteter Scheduler, seit 13.09.2026)

Der Worker (`POST /api/agent/analyse {action:"worker"}` → prospect_audits-Etappen,
admin_jobs-Datenläufe, Wiedervorlage-Sweep, Fehler-Monitor) läuft **nicht mehr über den
Cloud PC**, sondern über **pg_cron + pg_net in der Lovable-Supabase** — Always-on,
unabhängig vom Cloud PC:

| Cron-Job               | Takt                        | Zweck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ezy-analyse-worker`   | jede Minute                 | pg_net POST an `/api/agent/analyse` (Bearer aus Vault `admin_automation_secret`, Timeout 295 s). Die App serialisiert überlappende Ticks per Lease (`analyse_worker_heartbeat.lease_until`), jede Etappe/jeder Job ist per `locked_until` gelockt, Retry exponentiell (1/2/4 min, max 3) bzw. Cooldown (admin_jobs, max 2).                                                                                                                                                          |
| `ezy-analyse-watchdog` | alle 5 min                  | `public.analyse_worker_watchdog()`: fehlt der Heartbeat > 10 min → Meldung «Analyse-Worker ausgefallen» an alle owner/admin (Glocke, dedupliziert je Ausfall-Episode) + optional Webhook (Vault `worker_alarm_webhook_url`).                                                                                                                                                                                                                                                         |
| `ezy-chatgpt-ads-sync` | alle 12 h (00:15/12:15 UTC) | `POST /api/admin/chatgpt-ads` `{action:"sync-all", source:"pg_cron", maxAlterStunden:11}` (Bearer aus Vault `admin_automation_secret`): synchronisiert alle aktiven ChatGPT-Ads-Konten (Kampagnen, Gruppen, Anzeigen, Zielgruppen, Insights) auch ohne Nutzung des Ads-Managers; Konten, die die UI in den letzten 11 h selbst synchronisiert hat, werden übersprungen. Aus: `select cron.unschedule('ezy-chatgpt-ads-sync')`. Migration `20260921120000_chatgpt_ads_sync_cron.sql`. |

- **Wiederholte Job-Fehler** meldet der Tick selbst: ≥ 3 Fehler-Ticks in Folge oder ≥ 3
  endgültig fehlgeschlagene Jobs/Stunde → Meldung «wiederholte Job-Fehler» an alle Admins
  (ein Alarm je 6 h) + optional Webhook (`WORKER_ALARM_WEBHOOK_URL` in der Lovable-Env).
- **Wiedervorlagen** (`ai_opportunity_states.resurface_on`): alle 15 min serverseitig,
  Meldung an `assignee_user_id` bzw. die Org-Admins — kein Browserbesuch nötig.
- **Status:** `GET /api/agent/analyse?worker=1` bzw. Admin → Systemcheck (`zustand`,
  `scheduler` = pg_cron | windows-fallback, `fehlerTicksInFolge`). In Supabase:
  `select jobname, schedule, active from cron.job;` und
  `select status_code, error_msg, created from net._http_response order by id desc limit 10;`
- **Notfall-Fallback (nur wenn pg_cron/pg_net ausfällt):** Windows-Task
  `EzyOne-Analyse-Worker` ist registriert, aber **deaktiviert**:
  `Enable-ScheduledTask -TaskName EzyOne-Analyse-Worker` (danach wieder `Disable-…`).
  Skript: `scripts/analyse-worker.ps1` (Header = Runbook). Beide Wege dürfen parallel laufen.
- Migration/Setup: `supabase/migrations/20260913180000_managed_worker_scheduler.sql`
  (manuell via Lovable-SQL; Vault-Secrets werden separat gesetzt, nie im Repo).
- **Deployment-Smoke-Test:** `npm run smoke:deploy` (Cloud PC oder überall mit
  `ADMIN_AUTOMATION_SECRET`) prüft pg_cron-Jobs + letzte Läufe, pg_net-Antworten (401 =
  Vault-Secret weicht ab), Vault-Secret, Heartbeat (Quelle pg_cron), Watchdog-Probe und
  Wiedervorlage-Sweep; Exit 1 bei jedem Befund. Gleiche Checks mit konkreten Fehlertexten
  im Admin → Systemcheck («Verwalteter Scheduler», RPC `public.scheduler_status()`).
- **Ingest-Credentials** (Admin → Kunde → Ingest-Zugänge): Create/Rotate/Revoke laufen als
  transaktionale RPCs (`ingest_credential_create/rotate/revoke`, Migration
  `20260913210000`); eine Rotation legt das neue Token an **und** setzt das alte Ablaufdatum
  in einem Schritt; `use_count`/`last_used_at` zählt `ingest_credential_touch` bei jedem
  Ingest.

---

### Zeitraum-Vertrag (EzyRank, EzyPerformance, GSC, GA4, Google Ads — seit 13.09.2026)

- **Ein Zeitraum ist immer ein exakter, inklusiver Kalendertag-Bereich** `startDate..endDate`
  (YYYY-MM-DD). «Letzte N Tage» = genau N Tage: `startDate = endDate − (N−1)`. Zentrale
  Logik: `src/lib/date-range.ts` (`zeitraum`, `vorperiode`, `zeitraumAusParams`); alle
  Server-Routen und der Frontend-Zeitraumwähler nutzen sie — kein `today − N`
  (= N+1 Tage) und kein GA4-`NdaysAgo..today` (= N+1 Tage) mehr.
- **Alle APIs akzeptieren `startDate`/`endDate`** (POST-Body bzw. Query `start`/`end`) mit
  Vorrang vor `days`; ungültig/verdreht/Zukunft/zu lang → HTTP 400 statt Näherung. Jede
  Antwort trägt `range: { from, to }` (Ads zusätzlich `prevRange`).
- **GSC:** `days`-Modus endet bei heute−3 (Datenpuffer), exakte Ranges werden ohne Puffer
  abgefragt. Gesamttotale kommen aus einer eigenen **Aggregat-Abfrage ohne Dimension**
  (`metrics.quelle = "aggregate"`), Query-Zeilen separat und paginiert (`startRow`, bis
  50'000 in Datenläufen); `coverage { rowLimit, rows, truncated, pages, clicksAnteil }` sowie
  `ungelistetKlicks` kennzeichnen Zeilenlimit und Kürzung. Client: `src/server/gsc.server.ts`.
- **Rankings-Snapshots** (`audit_runs.rankings`, Push vom agent-service) bewahren
  `measurement { method crawl|gsc|hybrid, crawlLocation, country, language, device,
measuredAt }`; Deltas (`posPrev7/28`) nur innerhalb derselben Messmethode
  (`posPrev7Src`), sonst `null` — `improved7/declined7` werden daraus neu gezählt.
  Historische Zeiträume zeigen den Stand zum Zeitraum-Ende und kennzeichnen ihn als
  «Näherung», wenn der Lauf vor dem Zeitraum-Anfang liegt (`useEzyLatestRun(...).naeherung`).
- **Admin-Readiness:** «Google verbunden» gilt nur mit `oauth_connections.client_id ==
Kunde` (kein Org-weites Durchschlagen mehr).
- **Ranking-Snapshot-Ingest** (`POST /api/admin/rank-snapshot`) ist mandanteneindeutig:
  `clientId` + `organizationId` sind Pflicht (Slug nur Anzeige/Legacy; passt er nicht →
  400, mehrdeutig → 409). Auth entweder kundenspezifisches Credential (Zweck
  `rank_snapshot`, Admin → Kunde → Ingest-Zugänge) oder intern `ADMIN_AUTOMATION_SECRET`
  **plus** Header `X-Ezy-Organization` = organizationId (Org-Stempel des agent-service,
  `EZY_ORGANIZATION_ID`). Der agent-service stempelt `clientId/organizationId` stündlich
  (`rank-init`) in die Stores `~/agent-service/rank-tracking/<slug>.json`; ohne Stempel
  wird kein Snapshot gepusht (Log «Push uebersprungen»).

### API-Stand 09/2026 (Google) — seit 21.09.2026

**Google Ads API: v25** (Release 22.07.2026; v24 Sunset ca. Mai 2027, v25 ca. August 2027).
Die Basis-URL kommt an allen Stellen aus `src/server/google-ads-api.server.ts` (`adsApiBase()`).
Env-Override ohne Deployment: `GOOGLE_ADS_API_VERSION=v24` (Format `vNN`, sonst Default v25).
Die v25-Breaking-Changes (`CustomerLifecycleGoal`/`CampaignLifecycleGoal` entfernt, IncentiveService-Enums,
`search_brand` in Creator-Insights) betreffen keinen Code im Repo (Grep 21.09.2026 leer).

Neue, optionale Datenblöcke (fail-soft: Fehler landen in `extras.errors` bzw. `dataSourceErrors`,
nie im Snapshot-Fehler; Zeitraum immer `gaqlBetween`, inklusiv):

| Block                                    | Quelle (GAQL)                                                                                                                                                      | Wo                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Top-Produkte (Warenkorbdaten)            | `cart_data_sales_view`: `segments.product_item_id/product_title`, `metrics.orders/units_sold/revenue_micros/gross_profit_micros/all_revenue_micros`                | Ads-Snapshot `extras.cartProducts`                                                                                                     |
| Biddable vs. nur Reporting               | `conversion_action.include_in_conversions_metric` + `metrics.all_conversions(_value)`; «nur Reporting» = all − biddable (v25 kennt **kein** `non_biddable_*`-Feld) | Ads-Snapshot `extras.conversionSplit`                                                                                                  |
| PMax-Suchbegriffs-Insights               | `campaign_search_term_insight` (Kategorie, Klicks, Impressionen, Conversions je PMax-Kampagne, 30 Tage bis gestern)                                                | Autopilot-Summary `pmaxSearchThemes` + `pmaxSearchThemesHinweis` (nicht über Kampagnen aggregierbar)                                   |
| Brand Guidelines / NCA-Ziel (nur lesend) | `campaign.brand_guidelines_enabled` (nur PMax), `campaign_goal_config.goal_type`                                                                                   | Ads-Snapshot `extras.campaignFlags` + `campaigns[].brandGuidelinesEnabled/ncaGoalActive`; Autopilot `campaignDetail[]`/`campaignFlags` |

**GA4 Data API (v1beta):** jede `runReport`-Antwort läuft durch `src/server/ga4.server.ts`
(`ga4Coverage`/`ga4CoverageSammler`). Alle GA4-Routen und -Snapshots (`ga4_summary`, `ga4_traffic`,
`ga4_conversions`, `seo_history`, traffic-overview, llm-traffic, ga4-compare, admin/ga4-conversions)
tragen `coverage: { truncated, gruende[], sampling, dataLossFromOtherRow, currencyCode, timeZone }` —
`gruende` aus `responseMetaData.dataTruncationReasons` (neu 14.09.2026, z. B. `DATA_TRUNCATION_TYPE_DATE_RANGE`).
**GA4 Admin API:** `/api/google/ga4-properties` liefert je Property `canEdit` (`PropertySummary.can_edit`,
neu 18.06.2026; `null` = nicht geliefert) — sagt, ob Custom Dimensions/Key Events angelegt werden dürfen.

**Search Console:** URL-Inspection-Quota offiziell 2000/Tag und 600/Min je Property
(https://developers.google.com/webmaster-tools/limits). `content-sync` `inspectLimit`: Default 100, Max 500
(vorher 25/200); der Inspect-Job läuft sequenziell (~40/Min). `searchAnalytics/query` sendet weiterhin nur die
Allowlist-Felder (`GSC_REQUEST_FELDER`, Contract-Test in `gsc.server.test.ts`).

### API-Stand 09/2026 (Ahrefs/OpenAI/Supabase) — seit 21.09.2026

**Ahrefs API v3**

- Backlink-Overview (`/api/ahrefs/overview`, 12h-Populate `jobAhrefs`, Logik in
  `src/server/backlink-overview.server.ts`): Feld `is_spam` (Changelog 30.09.2026) wird auf
  `site-explorer/referring-domains` mitselektiert. Ergebnis trägt `spam` (`spamDomains`,
  `spamAnteil` an `live_refdomains`, `capped`) und `referring_domains` (Top-Liste nach DR, Spam
  per Where-Filter ausgeschlossen). Body-Parameter `ohneSpam` (Default `true`). Die Spam-Zählung
  liest nur `is_spam=true`-Zeilen (1 Unit/Zeile) — Deckel `AHREFS_SPAM_COUNT_LIMIT` (Default 1000),
  Listengrösse `AHREFS_TOP_REFDOMAINS_LIMIT` (Default 25). DataForSEO-Rückweg liefert `spam: null`.
- Brand Radar Citations (`brand-radar/citations-overview`, `citations-history`, POST/JSON,
  Marken-Filter = `brands`): in `jobBrandRadar` (`admin.aivis-sync.ts`) eingebunden, 12-h-Cache je
  Pfad+Body. `AIVIS_BR_PROMPTS=custom` (Default, **unit-frei**) oder `ahrefs` (kostet Units).
  Die br-Schicht läuft weiterhin über DFS/skipped; `AIVIS_AHREFS_BR=1` schaltet sie auf den
  Ahrefs Brand Radar (inkl. Citations) um — bewusst opt-in (Mess-Version bleibt).
- Kontingent: `GET /api/live/status` → `providers.ahrefs.details` (Units-Limit/-Verbrauch/
  Anteil/Reset-Datum, kostenloser Endpunkt); `GET /api/admin/client-metrics?…&units=1` →
  `ahrefsUnits`.
- Site Audit Page-Explorer: nicht eingebunden — EzyHub wertet keine Site-Audit-Daten aus
  (Site-Audit läuft im agent-service/MCP).

**OpenAI**

- ChatGPT Ads (`admin.chatgpt-ads.ts`): Self-Service seit 02.09.2026 in der Schweiz verfügbar —
  echtes Konto per `connect` mit API-Key; Mock nur noch Demo/E2E. Personalisierte Anzeigen
  (Custom Audiences) sind in EWR/CH nicht verfügbar → `command set_audiences` und
  `audience-create` liefern `warning`/`hinweis`. Plattform-Werte `web | ios_app | android_app`.
  `Idempotency-Key` bei allen Create-Aufrufen (Kampagne, Ad-Group, Ad, Bulk-Job, Audience, Pixel,
  Event-Setting, CAPI-Key); 429 → max. 3 Retries mit Backoff, `Retry-After` hat Vorrang.
- Sichtbarkeitsmessung (`admin.aivis-sync.ts`): ChatGPT-Prompts laufen komplett über
  `/v1/responses` (`askOpenAIResponses`, Text aus `output_text`), mit und ohne Web-Suche;
  `chat/completions` nur noch für Grok/DeepSeek. Modell `gpt-5.1` (`OPENAI_MODEL`); kein
  `gpt-5-2025-08-07`/`o3-*`/`gpt-4o` im Repo (Sunset 11.12.2026 betrifft uns nicht).

**Supabase**

- `@supabase/supabase-js` 2.116.0 (Node ≥ 22; kein OpenTelemetry-Import, keine `lock`-Option).
- API-Key-Umstellung: serverseitig `SUPABASE_SECRET_KEY` (`sb_secret_…`) mit Fallback
  `SUPABASE_SERVICE_ROLE_KEY`, zentral `supabaseSecretKey()` in
  `src/integrations/supabase/client.server.ts`; Browser `VITE_SUPABASE_PUBLISHABLE_KEY`
  (`sb_publishable_…`) mit Fallback `VITE_SUPABASE_ANON_KEY`. `GET /api/live/status` →
  `supabase_keys` zeigt, ob `sb_secret`/`legacy_service_role` bzw. `sb_publishable`/`legacy_anon`
  aktiv ist. Extension-Pinning: Migrationen setzen kein `version` (geprüft, nichts zu tun).

Neue Env-Variablen (Lovable): `SUPABASE_SECRET_KEY` (empfohlen), optional
`AHREFS_SPAM_COUNT_LIMIT`, `AHREFS_TOP_REFDOMAINS_LIMIT`, `AIVIS_BR_PROMPTS`, `AIVIS_AHREFS_BR`,
Browser-Build `VITE_SUPABASE_PUBLISHABLE_KEY` (neuer Key-Typ).

---

## 6. Deployment & CI

- **Deploy:** Push auf `main` → Lovable synct vom Repo → **Redeploy auslösen**. Erfolg am
  geänderten JS-Bundle-Hash (`/assets/main-*.js`) erkennbar.
- **Migrationen:** `supabase/migrations/*.sql` werden beim Deploy angewandt. Additive
  Migrationen degradieren sauber, falls noch nicht angewandt (z. B. Budget = aus).
- **CI:** `.github/workflows/ci.yml` — Job `qualitaet` (Pflichtcheck): `npm ci`, `npm ls`,
  `npm audit --omit=dev`, Tests (Vitest), TypeScript, Lint (`--max-warnings 0`), Build,
  **Build-Budgets** (`scripts/check-build-budgets.mjs`: kein Client-Chunk > 500 KB, keine
  neue Build-Warnung ausser den dort begründeten). Job `e2e`: Playwright-Ablauf
  `e2e/ezyai-ads.spec.ts` (ChatGPT-Ads: Mock-Konto, Kampagnenaktionen, Geo-Targeting,
  Zielgruppen, Conversion-Setup) gegen `vite dev` mit komplett gemocktem Netz — lokal
  `npm run test:e2e`.
- **Nach dem Deploy:** `npm run smoke:deploy` (Scheduler/Heartbeat/Watchdog/Sweep live).
- **Routen-Schnelltest** (ohne Login): eine `/api/*`-Route ohne Auth aufrufen →
  `401/400` = deployt & konfiguriert · `503` = Key fehlt · `404` = nicht deployt.

---

## 7. Troubleshooting

| Symptom                                 | Ursache / Fix                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| App zeigt „Backend-Konfiguration fehlt" | `VITE_SUPABASE_*` fehlten im Build → in Lovable setzen + neu **publishen** (Bundle-Hash muss sich ändern). Fallback in `client.ts`. |
| `/api/...` → `503`                      | Zugehöriger Key fehlt im Lovable-Deployment.                                                                                        |
| Skill/GEO-Tool schlägt fehl             | Agent-Service oder Canonry down → Cloud PC + Autostart-Tasks prüfen (Abschnitt 5).                                                  |
| GEO „Project not found"                 | Canonry-Projekt nicht angelegt → Onboarding-Karte „Canonry automatisch anlegen".                                                    |
| Core Web Vitals leer                    | `GOOGLE_API_KEY` im Deployment fehlt **oder** PageSpeed Insights API in Google Cloud nicht aktiviert.                               |
| Langer Skill bricht ab                  | Async-Pattern greift; sehr lange Orchestratoren (`seo-audit`, `blog`) können dennoch lange dauern.                                  |

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

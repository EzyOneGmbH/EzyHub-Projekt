# EzyRank → EzyHub Migration (Blueprint-Audit, Phase 0)

> Ziel: Das separate Kunden-Dashboard **EzyRank** wird in EzyHub nativ nachgebaut und
> danach abgelöst. EzyRank ist **nur Blueprint** für KPIs/Charts — sein Code wird
> **nicht** übernommen (anderer Stack: JS/ApexCharts/react-router/localStorage-JWT/single-tenant).
> Dieses Dokument ist das Ergebnis von Phase 0 (Audit, kein Feature-Code).

## Methodik
- EzyHub-Code gelesen: `EzyOneApp.jsx`, `GoogleClientPanel.jsx`, `useEzyLatestRun.ts`,
  `useEzyClients.ts`, `useEzyDashboardConfig.ts`, `useEzyDefaults.ts`, die API-Routen
  `google.ga4-summary.ts`, `google.gsc-import.ts`, `google.pagespeed.ts`, `ahrefs.overview.ts`,
  `integrations.server.ts`, `hooks/use-auth.tsx` und die `clients`/`audit_runs`-Migration.
- EzyRank read-only nach `/tmp` geklont, nur die `src/api/*Service.js` zur **KPI-/Endpoint-Verifizierung**
  gelesen — kein Code kopiert.

## Kern-Befund (widerlegt eine Annahme aus dem Auftrag)
Die Annahme „SEO-/GEO-Charts laufen auf Mock-Daten" trifft **nicht mehr** zu.
`SeoDashboard` und `GeoDashboard` rendern **bereits aus Live-Daten**:
- SEO: `useEzyLatestRun(clientId, "ahrefs" | "gsc_summary" | "pagespeed")` + `useEzyAuditHistory` (Trend).
- GEO: `useLiveIntegrations()` + `useCanonryOverview()` (Canonry-Bridge).

Die Mock-Konstanten **`seoRanking`, `trafficCountry`, `backlinksTrend`, `geoClicks`,
`geoVisitors`, `geoRanking`** (EzyOneApp.jsx:1119–1154) sowie das Demo-Array **`CLIENTS`**
(ab Z. 1166) sind **toter Code** — eine Volltext-Suche über `src/` findet **nur die
Definitionen, keine einzige Verwendung**. `Math.random()` kommt ausschliesslich in diesen
toten Konstanten vor. → Phase 1 ist daher primär **Dead-Code-Entfernung** + Ergänzung der
noch fehlenden EzyRank-Charts aus bereits vorhandenen Daten, nicht „Mock raus, Live rein".

## Vorhandene Datenquellen (verifiziert)
| Endpoint (EzyHub) | audit_type | Liefert konkret |
|---|---|---|
| `POST /api/ahrefs/overview` | `ahrefs` | `domain_rating`, `backlinks_stats`, **`refdomains_history` (weekly, 90 T)**, `metrics` (org_traffic, org_keywords) |
| `POST /api/google/gsc-import` | `gsc_summary` | `metrics{clicks,impressions,ctr,position}`, **`topQueries[]` (top 25, je mit position)** |
| `POST /api/google/ga4-summary` | `ga4_summary` | `metrics{sessions,totalUsers,newUsers,engagedSessions,screenPageViews,bounceRate,averageSessionDuration,conversions,totalRevenue}`, `series[] (daily)` |
| `POST /api/google/pagespeed` | `pagespeed` | `metrics{lcp,inp,cls,lcpLab,clsLab,performanceScore,strategy,url}` |
| Canonry Live-Bridge | (live) | GEO/AI-Visibility pro Provider, Citation-Evidence |

`useEzyLatestRun`-`kind`-Strings: **`ahrefs`**, **`gsc_summary`**, **`ga4_summary`**, **`pagespeed`**.
KPI-Extraktoren: `ahrefsKpisFromResult`, `gscKpisFromResult`, `ga4KpisFromResult`, `pagespeedKpisFromResult`.

`clients`-Spalten: `id, organization_id, name, domain, industry, language, country, notes,
gsc_property, ga4_property, canonry_project, metadata(jsonb), created_at`. **Keine** dedizierten
Ads-/Conversion-Detailspalten — Detaildaten gehören in `audit_runs.result`.

## Mapping: EzyRank-Card/Chart → EzyHub-Datenquelle → Status

### Dashboard (Übersicht)
| EzyRank-Element | EzyRank-Quelle | EzyHub-Quelle | Status |
|---|---|---|---|
| Card: Organic Traffic | semrush | `ahrefs`.metrics.org_traffic / `ga4_summary`.sessions | **vorhanden** |
| Card: AI Reference (Summe AI-Referral-Visitors) | GA4 `/users-from-ai` | — | **Datenlücke (a)** |
| Card: Lead Visits (Views /contact\|/kontakt) | GA4 pages | — (GA4 pagePath-Query fehlt) | **Datenlücke** |
| Card: Visibility Index | semrush | `ahrefs`.visibility (live_refdomains) | **vorhanden** (Mapping) |
| Chart: Traffic nach Land (Pie) | GA4 country | — (GA4 country-Dimension fehlt) | **Datenlücke (klein)** |
| Chart: AI Referenced Visitors | GA4 `/users-from-ai` | — | **Datenlücke (a)** |

> Hinweis: EzyHub hat aktuell keinen separaten „Übersicht"-Tab pro Kunde; `AgencyOverview`
> (showAll) ist agentur-weit. Entscheidung in Phase 1/2: Übersichts-Cards entweder in den
> bestehenden SEO-Tab integrieren oder neuen schlanken „Übersicht"-Tab ergänzen.

### SEO
| EzyRank-Element | EzyRank-Quelle | EzyHub-Quelle | Status |
|---|---|---|---|
| Card: Organic Traffic | semrush | `ahrefs`.metrics.org_traffic | **vorhanden** |
| Card: Visibility Index | semrush | `ahrefs`.visibility | **vorhanden** |
| Card: Switzerland Traffic | GA4 `/switzerland-and-users-share` | — (GA4 country-Dimension fehlt) | **Datenlücke (klein)** |
| Card: Authority Score | semrush | `ahrefs`.score (domain_rating) | **vorhanden** (Ahrefs-Mapping) |
| Card: Backlinks Total | semrush | `ahrefs`.backlinks_stats | **vorhanden** (UI fehlt) |
| Card: Organic Keywords | semrush | `ahrefs`.metrics.org_keywords | **vorhanden** |
| Chart: GSC Performance Trend (Area, daily) | GSC daily | `gsc_summary` (heute nur Totals+top25, keine daily series) | **UI fehlt / Datenlücke (daily)** |
| Chart: Ranking Distribution (Pie) | GSC ranking-distribution | `gsc_summary`.topQueries[].position → Buckets | **UI fehlt** (Daten teilw. vorhanden, nur top25) |
| Table: Top Keywords | semrush | `gsc_summary`.topQueries | **vorhanden** (bereits gerendert) |
| Table: Top Visited Pages | GA4 top-pages | — (GA4 pagePath-Query fehlt) | **Datenlücke** |
| Chart: New vs Lost Backlinks (weekly) | semrush backlinks/new-lost | `ahrefs`.refdomains_history (weekly) | **UI fehlt** (Daten vorhanden) |

### GEO
| EzyRank-Element | EzyRank-Quelle | EzyHub-Quelle | Status |
|---|---|---|---|
| Card: AI Overview Coverage Keywords | semrush ai-overview-coverage | Canonry coverage | **vorhanden** (Mapping) |
| Card: AI Reference Visitors | GA4 `/users-from-ai` | Canonry aiVisitors **oder** GA4 AI-Referral | **teilw.** (Canonry ja, GA4-Split = Lücke a) |
| Card: AI Citations | — | Canonry citations | **vorhanden** |
| Card: GEO Visibility Share % | GSC page-one-visibility-share | Canonry / GSC | **teilw.** (UI fehlt) |
| Chart: GEO Performance Trend (Area, daily) | GSC geo-performance-daily | Canonry providerSeries | **vorhanden** (Mapping) |
| Chart: AI Referenced Visitors | GA4 `/users-from-ai` | — | **Datenlücke (a)** |
| Chart: GEO Ranking Distribution (Pie) | GSC geo-position-distribution | `gsc_summary` positions | **UI fehlt** |

### Conversions
| EzyRank-Element | EzyRank-Quelle | EzyHub-Quelle | Status |
|---|---|---|---|
| Card: Phone Clicks | GA4 events | `clients.metadata`/manuell (heute Platzhalter) | **Datenlücke (b)** |
| Card: Mail Clicks | GA4 events | dito | **Datenlücke (b)** |
| Card: Maps Clicks | GA4 events | dito | **Datenlücke (b)** |
| Card: Contact Form Submit | GA4 events | dito | **Datenlücke (b)** |
| Card: Generated CHF | GA4 purchase | `ga4_summary`.totalRevenue (Summe, kein Detail) | **teilw.** |
| Chart: Traffic Distribution Google-vs-AI (Pie) | GA4 channel | — | **Datenlücke (a)** |
| Chart: Leads/Purchase Performance (Area, daily) | GA4 lead/purchase-conversions | — (nur Sessions-series vorhanden) | **Datenlücke (b)** |
| Table: alle Conversions | GA4 events | — | **Datenlücke (b)** |

### WebPerformance
| EzyRank-Element | EzyRank-Quelle | EzyHub-Quelle | Status |
|---|---|---|---|
| Desktop/Mobile-Toggle | PSI run-both | `pagespeed` (strategy mobile\|desktop) | **vorhanden** (Toggle-UI fehlt, läuft je 1 Strategy) |
| Cards: LCP, FCP, CLS, TBT, TTI | PSI lab | `pagespeed`.metrics (LCP/INP/CLS/Score) | **teilw.** (FCP/TBT/TTI fehlen im Extraktor) |
| Donuts: Performance, Accessibility, Best Practices, SEO | PSI categories | `pagespeed` (nur performance-Kategorie geholt) | **UI fehlt / Datenlücke (Kategorien)** |

## Bestätigung der drei vermuteten Lücken
- **(a) GA4 AI-Referral-Traffic + AI-vs-Google-Split — BESTÄTIGT.**
  EzyRank holt `/google-analytics/users-from-ai` (GA4-Query gefiltert auf Quellen wie
  `chatgpt.com`, `perplexity.ai`, `gemini`, `copilot`). EzyHubs `ga4-summary` fragt **keine**
  `sessionSource`/`sessionDefaultChannelGroup`-Dimension ab. → Neue API-Route/`audit_type` nötig.
- **(b) Conversion-Detail auf Event-Ebene + CHF — BESTÄTIGT.**
  EzyRank hat getrennte `/lead-conversions` und `/purchase-conversions` (GA4, event-/tageweise).
  EzyHubs `ga4-summary` liefert nur `conversions`-Total + `totalRevenue`. Kein Mail/Phone/Kontakt/Map-Split,
  keine Tagesreihe je Conversion-Typ. → Neue API-Route + UI nötig.
- **(c) Semrush-Metriken in EzyHub via Ahrefs — BESTÄTIGT, Empfehlung: bei Ahrefs bleiben.**
  EzyRank nutzt Semrush stark (top-keywords, ch-traffic-organic, backlinks/new-lost,
  ai-overview-coverage, geo-kpis). EzyHub hat **Ahrefs** bereits integriert + serverseitig verschlüsselt.
  Empfehlung: **kein Semrush einführen.** Mapping:
  - Authority Score ← Ahrefs `domain_rating`
  - Backlinks/New-vs-Lost ← Ahrefs `backlinks_stats` + `refdomains_history` (weekly)
  - Organic Keywords/Traffic ← Ahrefs `metrics`
  - Top Keywords / Ranking-Distribution ← **GSC** (`topQueries`, position) statt Semrush
  - Top Pages / Country / AI-Referral ← **GA4** (neue Dimensions-Queries)

## Empfohlener Plan (phasenweise, je STOPP danach)
**Phase 1 – Aufräumen + Charts aus vorhandenen Daten**
1. Tote Mock-Konstanten + `CLIENTS`-Demo + `genDays`/`DAYS` (falls dann ungenutzt) entfernen.
2. SEO: „Ranking Distribution" (Pie aus `gsc_summary.topQueries[].position`-Buckets),
   „New vs Lost Backlinks" (aus `ahrefs.refdomains_history` weekly), „Backlinks Total"-Card.
3. Alles recharts + oklch-Tokens, sauberer Empty-State wenn kein Run.

**Phase 2 – Echte Lücken (neue Server-Routen, multi-tenant/RLS)**
- (a) `POST /api/google/ga4-channels` → `audit_type: "ga4_channels"`: Sessions nach
  `sessionDefaultChannelGroup` + `sessionSource` (AI-Domains gebündelt) + Tagesreihe; UI-Cards/Pie/Area.
- (b) `POST /api/google/ga4-conversions` → `audit_type: "ga4_conversions"`: Event-Query
  (`eventName` in Mail/Phone/Kontakt/Map-Set + `purchase`/CHF), Tagesreihe je Typ; UI-Tabellen + Area.
- Ergänzend: Top-Pages (`pagePath`) + Country in `ga4-summary` oder separater Route.

**Phase 3 – Read-only Kundensicht (viewer)**
- `useAuth` liefert bereits `role`/`canRunAudits`/`hasRole`. RLS erlaubt `viewer` das **Lesen**
  von `audit_runs` (`audit_select = is_org_member`), nicht das Auslösen. Schlanker Report-Modus,
  der nur rendert (keine „Aktualisieren"-Buttons), wiederverwendet bestehende Dashboards.

## Guardrails (eingehalten)
Nie editiert: `src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,types}.ts`,
`routeTree.gen.ts`, `.env`. Charts nur **recharts**, UI **shadcn/ui**, Farben via **oklch**-Tokens.
Multi-tenant über `clientId`/`organization_id`, RLS-konform. Secrets serverseitig
(`createServerFn`/`src/routes/api`). Migrationen additiv + graceful.

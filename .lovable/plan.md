# Reparatur-Plan: Build, Datenmodell, EZY ONE Dashboard

Keine neuen Designspielereien. Fünf gezielte Reparaturen, danach Build + ZIP.

## 1. Production-Build reparieren

**Problem:** Komponenten importieren statisch aus `src/server/*.functions.ts` (z. B. `google-connect-panel.tsx` → `google.functions.ts`, `content.$id.tsx` → `perplexity.functions.ts`). Diese Dateien ziehen `client.server.ts` (Service-Role) und `google-tokens.server.ts` ein. TanStack Vite-Plugins sollten den Handler strippen, aber das Import-Protection-System bricht den Build, sobald eine `.server.*`-Datei transitiv vom Client erreicht wird.

**Fix:**

- Ein dünnes `createServerFn`-Wrapper-Modul je Feature einführen, das **nichts ausser `createServerFn` + Validator + Aufruf eines `.server.ts`-Helpers** enthält. Der Plugin-Transform ersetzt den Handler client-seitig durch einen RPC-Stub.
- In den `.functions.ts`-Dateien sicherstellen, dass `client.server`/`*-tokens.server`/`*-oauth.server` **ausschliesslich innerhalb von `.handler(...)`** referenziert werden — keine Top-Level-Re-Exports von Server-Helpern.
- `redactSecrets` aus `google-oauth.server.ts` herausziehen in `src/lib/redact.ts` (pure, isomorphic), damit `api/google.oauth.start.ts` und `google.functions.ts` es ohne Server-Bindings importieren können.
- Alle Komponenten-Imports `from "@/server/..."` prüfen: nur `.functions.ts` zulässig, niemals `.server.ts`.
- Danach: `bun run build` muss grün sein.

## 2. `public.clients` als kanonische Kundentabelle

**Aktuell:** Routen `/customers` und `/customers/$id` schreiben/lesen `customers` (legacy, global, ohne `organization_id`). `GoogleConnectPanel` und `AhrefsPanel` bekommen `customers.id`, schreiben aber gegen `clients.gsc_property` etc. → Datenchaos.

**Fix (Variante A: in-place migrieren, weniger Routen-Bruch):**

- `/customers` und `/customers/$id` auf `clients` umstellen:
  - SELECT/INSERT/UPDATE/DELETE gegen `public.clients`
  - INSERT setzt `organization_id` aus aktuellem Org-Membership des Users; `created_by = auth.uid()`
  - Felder: `name`, `domain` (statt `company`), `notes`, `industry`, `country`, `language`
  - Detail-Seite zeigt `gsc_property`, `ga4_property`, `domain` — Properties speichern direkt auf `clients`
- `GoogleConnectPanel`/`AhrefsPanel` bekommen `clients.id` (Spaltenname bleibt `clientId` in der API)
- Sidebar/Nav-Label bleibt „Kunden", Route bleibt `/customers` für Kontinuität.

## 3. Legacy-Tabellen ent-UI-fizieren und absichern

- UI-Routen entfernen: `tasks`, `tasks/$id`, `notes`-Aufrufe in `customer.$id`, `content` (oder hinter Org-Scope umbauen — siehe unten).
- Migration: alle `SELECT USING true`-Policies auf `customers`, `tasks`, `notes`, `content_items` ersetzen durch:
  - SELECT: `is_org_member(organization_id)` — dafür Spalte `organization_id` ergänzen + Backfill aus erstem Org des `created_by`
  - INSERT/UPDATE/DELETE: `is_org_admin(organization_id)` oder `created_by = auth.uid()`
- Falls Tabellen rein historisch sind: in `_legacy_*` umbenennen und RLS auf `false` setzen.

## 4. Canonry: URL-Normalisierung + Projekt-Slug pro Client

**Problem:** `CANONRY_BASE_URL` kann `https://api.canonry.ai` ODER `…/api/v1` enthalten; Code hängt naiv `/projects/<id>` an. Zusätzlich wird in `gscKeywordImport` aktuell die Supabase-UUID als Canonry-Projekt-Slug verwendet → 404.

**Fix:**

- Helper `src/server/canonry-url.server.ts`:
  - `resolveCanonryBase()` → trimmt trailing `/`, ergänzt `/api/v1` falls Pfad fehlt
  - `canonryUrl(path)` → korrektes Join
- Spalten-Erweiterung auf `clients`: `canonry_project text` (nullable), und/oder `client_integrations.config->>canonry_project` lesen mit Fallback.
- Migration: `ALTER TABLE clients ADD COLUMN canonry_project text;`
- UI in Client-Detail: Eingabefeld „Canonry Projekt-Slug" (Admin only), gespeichert auf `clients.canonry_project`.
- `/api/live/canonry/overview`-Aufrufer (GEO-Seite + neue Client-Detail-Sektion) übergeben `project = client.canonry_project`, **nicht** `client.id`.
- `gscKeywordImport`: liest `canonry_project` aus `clients`, postet damit an Canonry.

## 5. EZY ONE SEO/GEO Dashboard wiederherstellen

Neuer Dashboard-Aufbau für `/dashboard` und `/customers/$id`:

**`/dashboard` (Org-Übersicht):**

- Live-Status-Card (vorhandener `/api/live/status`)
- KPI-Grid: # Clients, # offene Audits, letzter Canonry-Health-Score (Aggregat)
- „Letzte Audit-Runs" Tabelle (aus `audit_runs`, sortiert by `created_at desc`, Status-Badges)

**`/customers/$id` (Client-Detail) — Tabs/Sektionen:**

1. Stammdaten (name, domain, industry, country, canonry_project, gsc_property, ga4_property)
2. **Ahrefs** (existierender `AhrefsPanel`, jetzt mit echter `clients.id`)
3. **Google Search Console** — Connect + Keyword-Import (existierender Panel)
4. **GA4 Summary** — Button + Anzeige (existiert bereits in Panel)
5. **Canonry / GEO Health** — Embed der `live/canonry/overview`-Sektionen für `client.canonry_project`
6. **Audit-Verlauf** — Liste `audit_runs WHERE client_id = $id ORDER BY created_at DESC`, mit Status, Typ, Dauer, Fehler

`/geo` bleibt als Power-User-View bestehen.

## 6. Verifikation & Lieferung

- `bun run build` — muss grün durchlaufen, Output protokollieren
- ZIP-Snapshot `ezy-one-lovable-current-snapshot-v2.zip` mit `src/`, `supabase/`, `package.json`, `bun.lockb`, `vite.config.ts`, `tsconfig.json`, `.lovable/plan.md`
- Kurzer Bericht: was geändert, welche Migrations liefen, Build-Ergebnis, Pfad zur ZIP

## Technische Details (Migrations-Übersicht)

```sql
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS canonry_project text;

-- Legacy lockdown (falls beibehalten)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS organization_id uuid;
-- Backfill aus app_users via created_by (1. Org)
DROP POLICY customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated
  USING (is_org_member(organization_id));
-- analog tasks, notes, content_items

-- oauth_connections + customer_defaults: RLS-Policies ergänzen
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_admin ON public.oauth_connections FOR ALL TO authenticated
  USING (is_org_admin(organization_id)) WITH CHECK (is_org_admin(organization_id));
-- (defaults analog)
```

## Out of scope

- Branding/Design-Refresh
- Neue Features ausserhalb der oben genannten Dashboard-Sektionen
- Refactor von `/tasks`, `/notes`, `/content` falls als Legacy entfernt

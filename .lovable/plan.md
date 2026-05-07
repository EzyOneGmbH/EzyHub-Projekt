## Ziel

Die sichtbare App entspricht ab v10 exakt der Referenz `src/review-app.jsx` aus dem hochgeladenen ZIP. Das v9 Backend (Supabase-Schema, RLS, Auth, `/api/*`-Routen, server-functions, Google/Ahrefs/Perplexity/Canonry-Integration) bleibt unverändert. localStorage wird durch Supabase-Adapter ersetzt.

## Vorgehen

### Schritt 1 – Referenz ins Projekt einziehen

- Kopiere `src/review-app.jsx` (422 Zeilen, monolithisch) und `src/main.jsx` aus dem ZIP nach `src/ezy/` im Lovable-Projekt.
- Datei wird zu `src/ezy/EzyOneApp.tsx` (Rename .jsx→.tsx, minimal-invasive Typing: `any` wo nötig, später schärfen). Inline-CSS-String wird via `<style>{CSS}</style>` injiziert wie in der Referenz.
- `recharts` und `lucide-react` sind bereits im Projekt; keine neuen Deps nötig.

### Schritt 2 – `/dashboard` rendert die EZY-App

- `src/routes/dashboard.tsx` wird zu reinem Wrapper:
  ```tsx
  export const Route = createFileRoute("/dashboard")({
    beforeLoad: requireAuth, // session gate
    component: () => <EzyOneApp />,
  });
  ```
- `app-shell.tsx` wird hier nicht mehr verwendet (die Referenz bringt eigene Sidebar/Header).
- `/customers`, `/geo`, `/settings`, `/content` werden zu Redirects auf `/dashboard?view=…` (die Referenz schaltet Tabs intern).
- `src/routes/index.tsx` bleibt Login-Gate / Marketing-Landing → leitet eingeloggt auf `/dashboard`.
- Login (`/login`, `/signup`) bleibt unverändert.

### Schritt 3 – Supabase-Adapter statt localStorage

Neue Hooks in `src/ezy/data/`:

| Hook | Ersetzt | Tabelle |
|---|---|---|
| `useEzyClients` | `CLIENT_STORAGE_KEY` | `clients` (mit `normalizeClientShape`-Mapping) |
| `useEzyProfile` | `PROFILE_STORAGE_KEY` | `profiles` + `useAuth` |
| `useEzyDefaults` | `DEFAULTS_STORAGE_KEY` | `customer_defaults` |
| `useEzyToolSettings` | Tool-Toggle State | `client_integrations` |
| `useEzyContent` | (in Referenz leer) | `content_items` |
| `useLiveIntegrations` | `/api/live/status` | sendet jetzt `Authorization: Bearer <token>` |
| `useCanonryOverview` | direkter Canonry-Call | `/api/live/canonry/overview?clientId=<id>` (kein `project`/`domain` aus Frontend) |

Das Mapping zur Referenz (`normalizeClientShape`) bleibt erhalten – Felder die in Supabase nicht existieren (`monthlyBudget`, `tags`, `targetLocations`, `contactEmail`, `contactPhone`, `score`, `keywords`, `traffic`, `aiVisitors`, `revenue`, `ga4MeasurementId`, `startDate`) werden:
  - Wenn fachlich sinnvoll → eine Migration ergänzt die Spalten (`ALTER TABLE clients ADD COLUMN …`).
  - Sonst clientseitig als optionale Felder mit Default 0/"" weitergeführt.

Geplante Migration: ergänze auf `clients` die fehlenden Spalten als `nullable`/`default`, ohne RLS zu berühren. Keine Datenmigration nötig (Defaults).

### Schritt 4 – Tool-Toggles enforcen

- `useEzyToolSettings` liest `client_integrations` für den ausgewählten Client.
- Quick Audit Drawer und ToolsPage rendern deaktivierte Tools entweder gar nicht oder als `disabled`-Card.
- Die API-Routen prüfen bereits server-seitig (`integrations.server.ts` aus früheren Iterationen) → unverändert.

### Schritt 5 – Auth überall mitsenden

- Globale Helper `apiFetch(path)` in `src/ezy/data/api.ts`: holt Supabase-Session, hängt `Authorization: Bearer …` an, ruft `/api/...`.
- Ersetzt den nackten `fetch(apiUrl(...))` der Referenz an allen Stellen.

### Schritt 6 – Aufräumen

- `src/components/app-shell.tsx`, `tasks.tsx`, `tasks.$id.tsx`, `assistant.tsx`, `admin.users.tsx` bleiben als Datei (für später), werden aus der Sidebar/Navigation entfernt; sind über Direkt-URL noch erreichbar.
- shadcn-Komponenten bleiben installiert (Login/Signup nutzen sie).

### Schritt 7 – QA

```
npm ci
npm run lint
npm run build
npm audit
```

Browser-Test: Login → `/dashboard` zeigt EZY ONE Sidebar + Header + SEO/GEO/Conversions Tabs + Quick Audit Drawer. Clients aus Supabase werden im Kunden-Dropdown gelistet. Anlage/Bearbeitung eines Clients persistiert in `clients`. GEO-Tab ruft `/api/live/canonry/overview?clientId=...` mit Bearer Token.

### Schritt 8 – Snapshot

Export `ezy-one-lovable-current-snapshot-v10.zip` (ohne `.git`, `.workspace`, `node_modules`, `dist`, `.output`, `.env`, `*.tsbuildinfo`).

## Was ich NICHT mache

- Kein optisches Redesign der Referenz; Farben/Spacing/Layout bleiben pixelgenau wie in `review-app.jsx`.
- Keine Änderung an Supabase-Schema außer additiven Spalten auf `clients` (siehe Schritt 3).
- Keine Änderung an RLS-Policies, `/api/*`-Routen oder Edge Functions.
- Keine Migration zur `app-shell`-basierten Sidebar.

## Risiken / Caveats

- Die Referenz ist eine monolithische 422-Zeilen-Datei mit minifiziertem Code in einer Zeile. Beim Port auf `.tsx` bleibt sie zunächst monolithisch (`any`-Typen erlaubt) – nachträgliche Modularisierung ist optional.
- Felder, die in der Referenz aus Mock-Daten kommen (Score/Keywords/Traffic/AI-Visitors/Revenue), bleiben zunächst Demo-Werte, bis echte Aggregation aus `audit_runs`/GSC/GA4/Ahrefs angeschlossen ist. Das entspricht dem Plan-Dokument („bleiben nur als Fallback").

Bitte freigeben, dann setze ich Schritt 1–8 in einem Rutsch um und liefere v10.

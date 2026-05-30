# ezy-one-tool

SEO & Content Automation Tool für EzyOne — gebaut mit Lovable.

## Stack

- **Framework:** TanStack Start v1 (React 19, Vite 7, SSR auf Cloudflare Workers)
- **Styling:** Tailwind CSS v4 (via `src/styles.css`), shadcn/ui, Radix UI
- **Backend:** Lovable Cloud (Supabase) — Auth, Postgres mit RLS, Storage
- **Server-Logik:** TanStack `createServerFn` (keine Supabase Edge Functions)
- **State/Data:** TanStack Query
- **Forms:** react-hook-form + Zod

## Projektstruktur

```
src/
├── routes/              # File-based Routing (TanStack Router)
│   ├── __root.tsx       # Root-Layout
│   ├── index.tsx        # Landing
│   ├── dashboard.tsx    # Haupt-Dashboard mit Audit-Ergebnissen
│   ├── customers.*      # Kunden-Verwaltung
│   ├── content.*        # Content-Erstellung
│   ├── tasks.*          # Tasks/Audits
│   ├── assistant.tsx    # AI Assistant
│   ├── geo.tsx          # GEO-Analyse
│   ├── health.tsx       # Health-Check
│   ├── settings.*       # Settings & API-Keys
│   ├── admin.users.tsx  # Admin
│   └── api/             # Server-Routes (Webhooks, Public APIs)
├── ezy/
│   ├── EzyOneApp.jsx        # Haupt-App-Logik
│   ├── GoogleClientPanel.jsx
│   └── data/                # Supabase-Hooks (TanStack Query)
│       ├── api.ts
│       ├── runTool.ts
│       ├── useEzyAuditHistory.ts
│       ├── useEzyClients.ts
│       ├── useEzyContent.ts
│       ├── useEzyDefaults.ts
│       ├── useEzyLatestRun.ts
│       ├── useEzyProfile.ts
│       └── useEzyToolSettings.ts
├── components/          # UI-Komponenten (shadcn/ui)
├── hooks/
├── integrations/supabase/  # AUTO-GENERIERT — nicht bearbeiten
├── lib/
├── server/              # Server-seitige Helfer
├── router.tsx
└── styles.css           # Tailwind v4 + Design-Tokens (oklch)

supabase/
├── config.toml
└── migrations/          # SQL-Migrationen
```

## Entwicklung

```bash
bun install
bun run dev       # Dev-Server
bun run build     # Produktions-Build
bun run lint
```

## Wichtige Konventionen

- **Nie editieren:** `src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,types}.ts`, `src/routeTree.gen.ts`, `.env`
- **Design-Tokens:** Farben nur via semantische Tokens aus `src/styles.css` (oklch). Keine `text-white`/`bg-black` direkt in Komponenten.
- **Server-Logik:** `createServerFn` aus `@tanstack/react-start`. Auth-geschützte Server-Funktionen via `requireSupabaseAuth`-Middleware.
- **Auth:** Supabase Auth (Email + Google OAuth). User-Rollen in separater `user_roles`-Tabelle, niemals im Profil.
- **RLS:** Alle public-Tabellen haben RLS-Policies + explizite `GRANT`-Statements.

## Datenfluss (Beispiel: Dashboard)

1. User logged in → Route `/dashboard` (geschützt)
2. `useEzyLatestRun` lädt letzten Audit-Run via Supabase Client (RLS-gefiltert)
3. Ergebnisse werden im Dashboard angezeigt
4. Neue Audits werden via `runTool.ts` getriggert

## Lovable

Dieses Projekt wird über [Lovable](https://lovable.dev) entwickelt. Bidirektionale GitHub-Sync ist aktiv — Commits hier landen automatisch in Lovable und umgekehrt.

Lovable Project: `3809d703-3b9d-49e8-a029-66c5c48795c6`

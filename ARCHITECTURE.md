# Architektur-Übersicht (für Code-Review)

Dokument für externe Code-Reviewer (z.B. Claude). Beschreibt Architektur, Konventionen und kritische Bereiche.

## Tech-Stack

| Layer | Technologie |
|-------|-------------|
| Frontend | React 19, TanStack Router (file-based), TanStack Query |
| Build | Vite 7, Bun |
| Runtime | Cloudflare Workers (SSR via TanStack Start) |
| Styling | Tailwind CSS v4, shadcn/ui, Radix UI, Design-Tokens (oklch) |
| Backend | Supabase (Lovable Cloud): Postgres, Auth, Storage, Realtime |
| Server-RPC | `createServerFn` (`@tanstack/react-start`) |
| Validation | Zod, react-hook-form |

## Auth-Flow

1. User registriert via `/signup` (Email + Passwort) oder Google OAuth
2. `src/integrations/supabase/client.ts` (Publishable Key) verwaltet Session in `localStorage`
3. `attachSupabaseAuth` (registriert in `src/start.ts` als `functionMiddleware`) hängt `Authorization: Bearer <token>` an jede `createServerFn`-Anfrage
4. Server-Funktionen mit `.middleware([requireSupabaseAuth])` erhalten authentifizierten `supabase`-Client + `userId` im Context
5. Geschützte Routen liegen unter `src/routes/_authenticated/` (falls vorhanden) bzw. nutzen Auth-Checks in der Komponente

## Datenmodell (Supabase)

Wichtige Tabellen (siehe `supabase/migrations/`):

- `profiles` — User-Profile (verlinkt mit `auth.users` via `id`)
- `user_roles` — Rollen (`admin`, `moderator`, `user`) in **separater** Tabelle, geprüft via Security-Definer-Funktion `has_role()`
- `clients` / `customers` — Kunden, RLS pro `user_id`
- `audit_runs` — Tool-Runs (gespeicherte Ergebnisse)
- `content` — Erstellte Inhalte
- `tasks` — Tasks/Audit-Jobs
- `tool_settings` / `defaults` — User-Settings

Jede public-Tabelle hat:
1. `CREATE TABLE`
2. `GRANT` für `authenticated` + `service_role`
3. `ENABLE ROW LEVEL SECURITY`
4. RLS-Policies (gescoped auf `auth.uid()`)

## Frontend-Datenzugriff

Standard-Pattern: TanStack Query Hooks unter `src/ezy/data/*`.

```ts
// Beispiel: useEzyLatestRun.ts
export function useEzyLatestRun() {
  return useQuery({
    queryKey: ['ezy', 'latest-run'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
```

RLS sorgt dafür, dass nur eigene Daten zurückkommen.

## Server-Funktionen

Liegen unter `src/lib/*.functions.ts` oder ähnlichen client-safe Pfaden (nicht unter `src/server/`, das ist import-protected).

```ts
export const myFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // ...
  });
```

## Routing

File-based. Wichtige Routen:

| Pfad | Datei | Zweck |
|------|-------|-------|
| `/` | `index.tsx` | Landing |
| `/login`, `/signup` | `login.tsx`, `signup.tsx` | Auth |
| `/dashboard` | `dashboard.tsx` | Übersicht Audit-Ergebnisse |
| `/customers`, `/customers/$id` | `customers.tsx`, `customers.$id.tsx` | Kunden |
| `/content`, `/content/$id` | `content.tsx`, `content.$id.tsx` | Content-Erstellung |
| `/tasks`, `/tasks/$id` | `tasks.tsx`, `tasks.$id.tsx` | Tasks |
| `/assistant` | `assistant.tsx` | AI-Chat |
| `/geo` | `geo.tsx` | GEO-Analyse |
| `/health` | `health.tsx` | Health-Check |
| `/settings`, `/settings/api` | `settings.tsx`, `settings.api.tsx` | Settings |
| `/admin/users` | `admin.users.tsx` | Admin |

`src/routeTree.gen.ts` wird **automatisch** vom TanStack Vite-Plugin generiert.

## Kritische Bereiche für den Review

1. **RLS-Policies** in `supabase/migrations/*.sql` — sind alle Tabellen abgesichert?
2. **Server-Funktionen** — Input-Validierung via Zod? `requireSupabaseAuth` wo nötig?
3. **Secrets-Handling** — `process.env.*` nur in `.handler()`, niemals im Modul-Scope. Keine Service-Role-Keys im Client.
4. **Auth-Checks** im Frontend — geschützte Routen redirecten zuverlässig?
5. **Design-Tokens** — keine Hard-coded Farben in Komponenten?
6. **Error-Handling** — `errorComponent` und `notFoundComponent` an Routes mit Loader?

## Nicht editieren (auto-generiert / Lovable-managed)

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `src/integrations/supabase/auth-attacher.ts`
- `src/integrations/supabase/types.ts`
- `src/routeTree.gen.ts`
- `.env`
- `supabase/config.toml` (Projekt-Settings)

## Lovable-Spezifika

- Backend = "Lovable Cloud" (Supabase unter der Haube)
- AI-Calls laufen über Lovable AI Gateway (kein eigener API-Key nötig für unterstützte Modelle wie `google/gemini-2.5-flash`, `openai/gpt-5` etc.)
- Deployment via Lovable Publish
- Bidirektionale GitHub-Sync aktiv

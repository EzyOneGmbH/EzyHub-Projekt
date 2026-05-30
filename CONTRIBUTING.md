# Contributing

## Setup

```bash
bun install
bun run dev
```

## Workflow

Dieses Projekt nutzt **bidirektionale Lovable ↔ GitHub-Sync**:

- Änderungen via Lovable-Chat → automatisch nach `main` gepusht
- Commits/PRs auf GitHub → automatisch in Lovable übernommen

## Code-Style

- TypeScript strict, ESLint, Prettier
- Tailwind v4 mit semantischen Design-Tokens aus `src/styles.css` (oklch)
- Keine Hard-coded Farben (`text-white`, `bg-black`) — nur Tokens
- shadcn/ui-Komponenten erweitern statt neu bauen

## Branches & PRs

- `main` ist die einzige aktive Branch (Lovable-Sync)
- Für größere Reviews: Feature-Branch lokal → PR gegen `main`
- Lovable übernimmt Merges nach `main` automatisch in die Preview-Umgebung

## Niemals editieren

Siehe `ARCHITECTURE.md` → "Nicht editieren".

## Migrationen

SQL-Migrationen liegen in `supabase/migrations/`. Neue Migrationen werden über Lovable (Cloud-Tooling) erstellt — nicht manuell hinzufügen.

## Tests

```bash
bunx vitest run
```

## Security-Checkliste vor PR

- [ ] Neue Tabellen haben RLS + GRANT-Statements
- [ ] Server-Funktionen validieren Input via Zod
- [ ] Keine Secrets/Service-Role-Keys im Client-Code
- [ ] Auth-Checks an geschützten Routen
- [ ] Keine PII in `/api/public/*`-Endpoints

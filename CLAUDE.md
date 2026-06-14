# EZY ONE — Project guide for Claude Code

Multi-tenant agency web app to manage clients with **SEO / GEO / Conversion** dashboards
and AI skills. Built with Lovable; the product owner communicates in **German** (user-facing
copy and UI labels are German — match that), but code and comments follow the surrounding style.

## Stack
- **Frontend + server routes:** TanStack Start (React) on **Cloudflare Workers**, bundled with **Vite**.
- **Backend:** **Supabase** (auth + Postgres). Multi-tenant via **RLS** (org-scoped: `clients`,
  `audit_runs`, `content_items`, `client_integrations`; helpers `is_org_member` / `is_org_admin` /
  `can_run_audits`). Per-org `organizations.dashboard_config` (metric toggles) and
  `monthly_ai_budget_usd` (cost cap).
- **Deploy:** Lovable-managed. Push to `main` → Lovable syncs → redeploy. Custom domain **ezyhub.ch**.
- **Migrations:** `supabase/migrations/*.sql`, applied on deploy. Keep migrations **additive** and
  degrade gracefully if not yet applied.

## Commands
```bash
npm install        # deps (runs automatically via .claude SessionStart hook)
npm run dev        # vite dev
npm run build      # vite build  (hard CI gate)
npm test           # vitest run  (hard CI gate)
npm run typecheck  # tsc --noEmit (advisory)
npm run lint       # eslint .     (advisory)
```
Before finishing a change, run `npm test` and `npm run build` — these are the CI gates
(`.github/workflows/ci.yml`).

## Where things live
- `src/ezy/` — the main app. `EzyOneApp.jsx` is a large monolith (dashboards: SEO / GEO /
  Conversion, tool tiles, client onboarding card, settings).
- `src/ezy/data/` — data hooks & helpers: `runTool.ts` (tool/skill execution + async start/poll),
  `skillCatalog.ts` (auto-generated plugin-skill catalog), `useEzyDashboardConfig.ts`,
  `useEzyLatestRun.ts` (KPI extractors).
- `src/routes/api/` — server routes: `agent.run.ts` / `agent.job.ts` (skill bridge, async + budget),
  `canonry.create-project.ts`, `google.*.ts` (GA4 / GSC / PageSpeed / OAuth), `ahrefs.*`,
  `perplexity.*`, `ai.generate.*`.
- `supabase/migrations/` — schema. `docs/BETRIEB.md` — ops handbook. `docs/SECURITY-RLS-AUDIT.md`.

## Data flow (dashboards)
All dashboards read from Supabase **`audit_runs`** (per `audit_type`) or live providers:
- **SEO:** `ahrefs`, `gsc_summary`, `pagespeed` (CWV) + audit-history trend.
- **GEO:** live from **Canonry** (AI-visibility per provider).
- **Conversion:** `ga4_summary` (sessions/users/conversions/revenue + daily series).

## IMPORTANT — external services NOT in this repo
The **agent-service** (Claude Agent SDK + plugin skills) and **Canonry** run on a separate
**Cloud PC**, reached over a Cloudflare tunnel at `https://agent.ezyhub.ch` and
`https://canonry.ezyhub.ch`. They are **not part of this repository** and are **not reachable
from a cloud sandbox**. Do not try to start or import them. The app only calls them via HTTP
(`AGENT_BASE_URL`, `CANONRY_BASE_URL`) with bearer/api-key auth set as deployment env vars.

## Conventions & guardrails
- Never commit secrets. `.env` is gitignored. `src/integrations/supabase/client.ts` carries a
  **public** Supabase URL + anon key fallback (browser-safe) — don't replace with private keys.
- Server routes return `401/400` without auth (deployed+configured), `503` if a key is missing.
- Keep changes minimal and match existing patterns; `EzyOneApp.jsx` is large — edit surgically.
- Secret/private values belong in the Lovable deployment env, not in code or this repo.

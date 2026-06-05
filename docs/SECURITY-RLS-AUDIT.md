# RLS / Multi-Tenant Security Audit

**Date:** 2026-06-05 · **Scope:** static review of `supabase/migrations/` (source of truth applied to the production Supabase project).

## Verdict: PASS for the multi-tenant core

The actively-used tables are correctly isolated per organization. No cross-tenant read/write leak found in active tables. Earlier permissive `USING (true)` policies were superseded by later migrations.

## Trust root (SECURITY DEFINER helpers)

All `STABLE SECURITY DEFINER` with `SET search_path = public` (prevents search_path hijacking):

- `is_org_member(_org)` → `EXISTS (SELECT 1 FROM app_users WHERE organization_id = _org AND user_id = auth.uid())`
- `org_role_of(_org)` → current user's role in that org
- `is_org_admin(_org)` → role IN (owner, admin)
- `can_run_audits(_org)` → role IN (owner, admin, member)  (viewer excluded)
- `has_role(uid, role)` → global role check

## Effective policies on active tables

| Table | SELECT | WRITE |
|---|---|---|
| `clients` | `is_org_member(organization_id)` | insert: `is_org_admin` + `created_by`; update/delete: org-admin |
| `client_integrations` | `is_org_member(organization_id)` | `is_org_admin` (ALL) |
| `audit_runs` | `is_org_member(organization_id)` | insert: `can_run_audits` + `triggered_by` |
| `content_items` | org via `clients.organization_id` + `is_org_member` | update/delete: `is_org_admin` |
| `profiles` | own row (`auth.uid() = id`) | own row |
| `user_roles` | own row or global admin | admin |

## Findings & recommendations

1. **MEDIUM — `profiles_select` is own-row only (`auth.uid() = id`).** This will break any UI that shows another user's name (e.g. "audit triggered by <teammate>", task assignee). For an agency tool, add an org-scoped read so members of the same org can see each other's profiles:
   ```sql
   CREATE POLICY profiles_select_org ON public.profiles FOR SELECT TO authenticated
   USING (id = auth.uid() OR EXISTS (
     SELECT 1 FROM public.app_users a1
     JOIN public.app_users a2 ON a1.organization_id = a2.organization_id
     WHERE a1.user_id = auth.uid() AND a2.user_id = profiles.id));
   ```
2. **LOW — Legacy single-tenant tables unused by the app** (`customers`, `tasks`, `notes`, `customer_defaults`, `customer_tool_settings`). Now `created_by`-scoped (no leak), but they add RLS surface and confusion. The app uses `clients`/`client_integrations`. Recommend dropping them once confirmed unused.
3. **VERIFY ON LIVE DB — static audit only.** This reviews migrations, not the running production DB (`glrgccmujzuwnhyvwxyi`, Lovable-managed, not reachable via the connected MCP which only exposes the inactive `EzyDevAI` project). Before onboarding external agencies, run Supabase's **Security Advisor** on the production project and confirm RLS is ENABLED on every `public` table (the advisor flags any table without RLS).
4. **GOOD — `audit_runs` insert requires `can_run_audits` + `triggered_by = auth.uid()`**, so viewers cannot trigger billable runs and users cannot forge another user's runs.

## Action items
- [ ] Add org-scoped `profiles` read policy (finding 1).
- [ ] Drop legacy tables after confirming no usage (finding 2).
- [ ] Run Security Advisor on the production project (finding 3).

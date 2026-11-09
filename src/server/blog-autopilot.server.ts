// Blog-Autopilot: Zugriffsprüfung für alle /api/blog/*-Routen (Phase 1, 09.11.2026).
//
// Zugang nur per Einladung: Wer hier durchkommt, ist Mitglied der Organisation
// des Kunden (Mitgliedschaft entsteht ausschliesslich über /api/admin/team
// invite) UND hat Zugriff auf genau diesen Kunden (Owner/Admin oder
// client_access-Zuweisung, identisch zu public.has_client_access) UND beim
// Kunden ist das Feature-Flag «blog_autopilot» (client_app_access, App seo)
// eingeschaltet. Kunden-Logins (viewer) sind ausdrücklich erlaubt — sie
// richten den Autopiloten im Onboarding selbst ein.
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const BLOG_FEATURE = "blog_autopilot";

/** Standard-Schreibregeln (Kap. 6A Schritt 5: «immer aktiv»). */
export const STANDARD_REGELN = [
  "Jede Zahl, Statistik, jeder Preis und jede rechtliche Aussage braucht eine Quelle mit URL.",
  "Keine Mitbewerber oder anderen Hilfswerke verlinken.",
  "Keine Vergleichslisten mit Mitbewerbern.",
];

export type BlogKontext = {
  userId: string;
  clientId: string;
  organizationId: string;
  role: string;
  domain: string;
};

/** Pure (vitest): Entscheidung aus den gelesenen Fakten. */
export function blogZugriffErlaubt(f: {
  role: string | null;
  zugewiesen: boolean;
  flag: boolean;
}): { ok: true } | { ok: false; status: 403; grund: string } {
  if (!f.role) return { ok: false, status: 403, grund: "Kein Zugang (nur per Einladung)" };
  const admin = f.role === "owner" || f.role === "admin";
  if (!admin && !f.zugewiesen)
    return { ok: false, status: 403, grund: "Kein Zugriff auf diesen Kunden" };
  if (!f.flag)
    return {
      ok: false,
      status: 403,
      grund: "Blog-Autopilot ist für diesen Kunden nicht freigeschaltet",
    };
  return { ok: true };
}

export async function requireBlogAccess(
  request: Request,
  clientId: string,
): Promise<BlogKontext | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const userId = data.user.id;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, organization_id, domain")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
  const orgId = String((client as any).organization_id);

  const [{ data: m }, { data: zuw }, { data: app }] = await Promise.all([
    supabaseAdmin
      .from("app_users")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabaseAdmin
      .from("client_access")
      .select("client_id")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("client_app_access")
      .select("features")
      .eq("client_id", clientId)
      .eq("app", "seo")
      .maybeSingle(),
  ]);
  const role = (m as any)?.role ? String((m as any).role) : null;
  const features: unknown[] = Array.isArray((app as any)?.features) ? (app as any).features : [];
  const e = blogZugriffErlaubt({ role, zugewiesen: !!zuw, flag: features.includes(BLOG_FEATURE) });
  if (!e.ok) return Response.json({ ok: false, error: e.grund }, { status: e.status });
  return {
    userId,
    clientId,
    organizationId: orgId,
    role: role!,
    domain: String((client as any).domain || ""),
  };
}

/** Projekt laden und Zugriff über dessen Kunden prüfen. */
export async function requireBlogProject(
  request: Request,
  projectId: string,
): Promise<{ ctx: BlogKontext; project: any } | Response> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    return Response.json({ ok: false, error: "Ungültige Projekt-ID" }, { status: 400 });
  const { data: project } = await (supabaseAdmin as any)
    .from("blog_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  // 404 erst NACH der Auth-Prüfung wäre ideal; ohne Projekt gibt es aber keinen
  // Kunden zum Prüfen. Gleiche Antwort für «gibt es nicht» und «fremd» (kein
  // Existenz-Orakel): beides 404.
  if (!project)
    return Response.json({ ok: false, error: "Projekt nicht gefunden" }, { status: 404 });
  const ctx = await requireBlogAccess(request, String(project.client_id));
  if (ctx instanceof Response) {
    if (ctx.status === 403)
      return Response.json({ ok: false, error: "Projekt nicht gefunden" }, { status: 404 });
    return ctx;
  }
  return { ctx, project };
}

export async function blogEvent(
  projectId: string,
  type: string,
  payload: Record<string, unknown> | null,
  actor: string | null,
  articleId: string | null = null,
): Promise<void> {
  await (supabaseAdmin as any)
    .from("blog_events")
    .insert({ project_id: projectId, type, payload, actor, article_id: articleId })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Domain normalisieren: ohne Protokoll, ohne www., ohne Pfad, klein. */
export function normalisiereDomain(raw: string): string {
  let d = String(raw || "")
    .trim()
    .toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0] || "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : "";
}

// ── Phase 2: Projekt laden und ändern ───────────────────────────────────────

export const WP_FELDER =
  "site_url, scopes, plugin_version, status, last_error_code, last_checked_at, updated_at";

/** Projekt um den WordPress-Status ergänzen. Felder explizit übernehmen:
 *  key_enc darf nie in einer Antwort landen. */
export async function mitWordpress(project: any) {
  const { data: wp } = await (supabaseAdmin as any)
    .from("wp_connections")
    .select(WP_FELDER)
    .eq("project_id", project.id)
    .maybeSingle();
  const wordpress = wp
    ? Object.fromEntries(WP_FELDER.split(", ").map((k) => [k, (wp as any)[k] ?? null]))
    : { status: "nicht_verbunden" };
  // letzter Analyse-Lauf (Wiedereinstieg im Onboarding)
  const { data: analysis } = await (supabaseAdmin as any)
    .from("blog_analysis_runs")
    .select("id, status, percent, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { ...project, wordpress, analysis: analysis ?? null };
}

export async function ladeBlogProjekt(clientId: string) {
  const { data: project } = await (supabaseAdmin as any)
    .from("blog_projects")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return project ? mitWordpress(project) : null;
}

/** Ezy-One-Rollen (nicht Kunden-Logins) dürfen Kontingent und Kostenlimits setzen. */
export function istAgentur(ctx: Pick<BlogKontext, "role">): boolean {
  return ctx.role !== "viewer";
}

const domainFeld = z
  .string()
  .max(253)
  .transform((d) => normalisiereDomain(d))
  .refine((d) => !!d, "Ungültige Domain");

/** Felder aus Onboarding-Schritten 3–5 und Einstellungen (Kap. 6A, 8). */
export const ProjektPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000),
    audiences: z.array(z.string().trim().min(1).max(300)).max(4),
    market: z.string().regex(/^[A-Z]{2}$/),
    language: z.enum(["de-CH", "de-DE", "fr-CH", "it-CH", "en"]),
    local_business: z.boolean(),
    tone: z.enum(["informativ", "gespraechig", "ueberzeugend"]),
    internal_links: z.number().int().min(0).max(5),
    cta_blocks: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(80),
          url: z
            .string()
            .url()
            .refine((u) => /^https:\/\//i.test(u), "Nur https-Links"),
          text: z.string().trim().max(300).default(""),
          position: z.enum(["end", "after_first_third"]).default("end"),
        }),
      )
      .max(3),
    excluded_domains: z.array(domainFeld).max(50),
    image_style: z.string().trim().max(40).nullable(),
    publish_mode: z.enum(["wp_draft", "hub_only"]),
    publish_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().trim().min(1).max(64),
    min_volume: z.number().int().min(0).max(100000),
    min_impressions: z.number().int().min(0).max(100000),
    onboarding_step: z.number().int().min(1).max(8),
    // nur Agentur
    articles_per_month: z.number().int().min(1).max(60).nullable(),
    ahrefs_units_limit: z.number().int().min(0).max(20000),
  })
  .partial()
  .strict();

export const NUR_AGENTUR: ReadonlyArray<string> = ["articles_per_month", "ahrefs_units_limit"];

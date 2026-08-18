import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Brand-Facts-Kuration (11.08.2026, Searchable "Brand Facts"-Parität):
// Das Faktenprofil (ai_visibility_brand_facts) ist die Abgleichsbasis des
// Brand-Judge (Faktentreue/Halluzinations-Erkennung) — bisher rein maschinell
// generiert (needs_review=true, keine Kunden-UI). Dieser Endpoint macht es
// kuratierbar: GET liest, POST speichert die geprüfte Fassung und setzt
// needs_review=false. Die Tabelle hat KEINE RLS-Policies (bewusst, 03.08.) —
// Zugriff läuft deshalb über diesen Endpoint: Session-JWT + RLS-Kundencheck
// (kann der User den Kunden sehen?), Schreiben via Service-Role.

async function requireUser(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

async function checkClient(
  auth: { userClient: any | null },
  clientId: string,
): Promise<Response | null> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId))
    return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
  const db = auth.userClient ?? (supabaseAdmin as any);
  const { data: client } = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
  return null;
}

export const Route = createFileRoute("/api/admin/brand-facts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const clientId = new URL(request.url).searchParams.get("client") || "";
        const bad = await checkClient(auth, clientId);
        if (bad) return bad;
        const { data } = await (supabaseAdmin as any)
          .from("ai_visibility_brand_facts")
          .select("facts, needs_review, updated_at")
          .eq("client_id", clientId)
          .maybeSingle();
        return Response.json(
          {
            ok: true,
            facts: data?.facts ?? null,
            needsReview: !!data?.needs_review,
            updatedAt: data?.updated_at ?? null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "JSON erwartet" }, { status: 400 });
        }
        const clientId = String(body?.client || "");
        const bad = await checkClient(auth, clientId);
        if (bad) return bad;
        const f = body?.facts || {};
        // Nur die bekannten Felder übernehmen, Längen hart begrenzen — das
        // Profil geht 1:1 in Judge-Prompts (Token-Budget + Injection-Hygiene).
        const facts = {
          angebot: String(f.angebot ?? "").slice(0, 500) || null,
          ort: String(f.ort ?? "").slice(0, 300) || null,
          kernfakten: (Array.isArray(f.kernfakten) ? f.kernfakten : [])
            .map((k: any) => String(k).trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 12),
        };
        if (!facts.angebot && !facts.kernfakten.length)
          return Response.json(
            { ok: false, error: "Profil darf nicht leer sein (angebot oder kernfakten)" },
            { status: 400 },
          );
        const { error } = await (supabaseAdmin as any).from("ai_visibility_brand_facts").upsert({
          client_id: clientId,
          facts,
          needs_review: false,
          updated_at: new Date().toISOString(),
        });
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, facts, needsReview: false });
      },
    },
  },
});

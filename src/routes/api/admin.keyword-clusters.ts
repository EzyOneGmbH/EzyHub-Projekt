import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { generateViaSubscription } from "@/server/claude-generate.server";
import { clusterEingabe, clusterKennzahlen, parseKiCluster } from "@/lib/keywordCluster";

// Keyword-Clustering nach Suchabsicht (15.10.2026, Volkan Punkt 9) — NUR Team.
// GET = letzter Lauf, POST = neu berechnen. Daten: letzter rankings-Lauf
// (keywords) + letzter gsc_queries-Lauf (topNonbrandQueries mit pageUrl).
// Die KI (Claude-Abo via agent-service) gruppiert nur; Kennzahlen,
// Kannibalisierung und Luecken rechnet lib/keywordCluster deterministisch.

const SYSTEM =
  "Du bist SEO-Stratege. Gruppiere Suchbegriffe in thematische Cluster nach Suchabsicht. " +
  "Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Erklaerung davor oder danach.";

async function letzterLauf(clientId: string, typ: string) {
  const { data } = await supabaseAdmin
    .from("audit_runs")
    .select("result, created_at")
    .eq("client_id", clientId)
    .eq("audit_type", typ)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { result: any; created_at: string } | null;
}

async function pruefen(request: Request, clientId: string) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
  );
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return { fehler: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const team = await requireTeamRole(request, "member");
  if (team instanceof Response) return { fehler: team };
  const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
  if (!sichtbar?.length)
    return { fehler: Response.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { fehler: Response.json({ ok: false, error: "Kunde nicht gefunden" }) };
  return { user, client };
}

export const Route = createFileRoute("/api/admin/keyword-clusters")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const clientId = new URL(request.url).searchParams.get("clientId") || "";
          if (!z.string().uuid().safeParse(clientId).success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, clientId);
          if ("fehler" in p) return p.fehler;
          const lauf = await letzterLauf(clientId, "keyword_clusters");
          return Response.json({
            ok: true,
            lauf: lauf ? { ...lauf.result, at: lauf.created_at } : null,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const clientId = String(body?.clientId || "");
          if (!z.string().uuid().safeParse(clientId).success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, clientId);
          if ("fehler" in p) return p.fehler;
          const [rank, gsc] = await Promise.all([
            letzterLauf(clientId, "rankings"),
            letzterLauf(clientId, "gsc_queries"),
          ]);
          const eingabe = clusterEingabe(
            rank?.result?.keywords,
            gsc?.result?.topNonbrandQueries,
            300,
          );
          if (eingabe.length < 10)
            return Response.json({ ok: false, error: "Zu wenig Keyword-Daten (mind. 10 nötig)." });
          const prompt =
            `Kunde: ${p.client.name}\n` +
            "Gruppiere die folgenden Suchbegriffe (eine Zeile je Begriff) in 8 bis 25 thematische Cluster. " +
            "Jeder Begriff gehoert in genau EIN Cluster; Begriffe ohne passendes Thema in ein Cluster «Sonstiges». " +
            "Pro Cluster: name (kurz, Deutsch), intent (genau einer von: informational, commercial, transactional, navigational, local), " +
            "keywords (exakt die Begriffe aus der Liste, kleingeschrieben), hinweis (1 Satz: welche Seite/Inhalt den Cluster bedienen sollte). " +
            'Format: [{"name":"…","intent":"…","keywords":["…"],"hinweis":"…"}]\n\nBegriffe:\n' +
            eingabe.map((e) => e.kw).join("\n");
          const gen = await generateViaSubscription({
            system: SYSTEM,
            prompt,
            clientId,
            clientName: p.client.name,
            label: "Keyword-Clustering",
            maxTurns: 3,
            timeoutMs: 240_000,
          });
          if (!gen?.text)
            return Response.json({
              ok: false,
              error: "KI nicht erreichbar — bitte später erneut versuchen.",
            });
          const ki = parseKiCluster(gen.text);
          if (!ki.length)
            return Response.json({
              ok: false,
              error: "KI-Antwort nicht lesbar — bitte erneut versuchen.",
            });
          const clusters = clusterKennzahlen(ki, eingabe);
          const zugeordnet = new Set(clusters.flatMap((c) => c.keywords));
          const result = {
            clusters,
            keywordsGesamt: eingabe.length,
            nichtZugeordnet: eingabe.filter((e) => !zugeordnet.has(e.kw)).map((e) => e.kw),
            datenstand: { rankings: rank?.created_at ?? null, gsc: gsc?.created_at ?? null },
          };
          const jetzt = new Date().toISOString();
          await supabaseAdmin.from("audit_runs").insert({
            client_id: clientId,
            organization_id: p.client.organization_id,
            triggered_by: p.user.id,
            audit_type: "keyword_clusters",
            status: "succeeded",
            input: { keywords: eingabe.length },
            result: result as never,
            started_at: jetzt,
            finished_at: jetzt,
          });
          return Response.json({ ok: true, lauf: { ...result, at: jetzt } });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});

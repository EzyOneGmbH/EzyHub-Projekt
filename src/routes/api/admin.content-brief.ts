import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { askUtility } from "./admin.aivis-sync";

// Content-Brief-Generator (13.08.2026, Volkan — "Content-Loop schliessen"):
// POST erzeugt aus einer KI-Chance (Zitat-Gap mit echten Fragen) einen
// redaktionsfertigen Content-Brief: Utility-LLM strukturiert Frage(n),
// Rival-Kontext und die echten Fanout-Folgefragen des letzten Messlaufs zu
// einer Gliederung. Ablage in content_briefs (Lesen/Status via RLS im Panel;
// INSERT bewusst nur hier über Service-Role — deshalb dieser Endpoint).

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

export const Route = createFileRoute("/api/admin/content-brief")({
  server: {
    handlers: {
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
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const db = auth.userClient ?? (supabaseAdmin as any);
        const { data: client } = await db
          .from("clients")
          .select("id, name, domain, organization_id, language")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const src = body?.source || {};
        const questions: string[] = (Array.isArray(src.questions) ? src.questions : [])
          .map((q: any) => String(q?.q ?? q).trim())
          .filter(Boolean)
          .slice(0, 8);
        const rival = String(src.rival || "").slice(0, 120);
        const thema = String(src.thema || questions[0] || "").slice(0, 200);
        if (!thema)
          return Response.json(
            { ok: false, error: "source.thema oder source.questions erforderlich" },
            { status: 400 },
          );

        // Echte Fanout-Folgefragen des letzten Messlaufs als Gliederungs-Input.
        const sbA = supabaseAdmin as any;
        const { data: rep } = await sbA
          .from("ai_visibility_reports")
          .select("parts")
          .eq("client_id", clientId)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const fanout: string[] = ((rep?.parts?.sa?.chatgptFanout as any[]) || [])
          .flatMap((f: any) => f?.queries || [])
          .map((q: any) => String(q))
          .slice(0, 15);

        const txt = await askUtility(
          `Erstelle einen kompakten CONTENT-BRIEF (Markdown, Deutsch) für die Website von "${client.name}" (${client.domain || "ohne Domain"}). ` +
            `Ziel: von KI-Systemen (ChatGPT, Google AI Overviews) als Quelle zitiert werden.\n` +
            `Thema/Anlass: ${thema}\n` +
            (rival
              ? `Kontext: Der Konkurrent "${rival}" wird bei diesen echten Nutzerfragen zitiert, ${client.name} nicht:\n${questions.map((q) => `- ${q}`).join("\n")}\n`
              : "") +
            (fanout.length
              ? `Echte KI-Folgefragen aus Messläufen (als Gliederungs-Kandidaten):\n${fanout.map((q) => `- ${q}`).join("\n")}\n`
              : "") +
            `Struktur: # Arbeitstitel · ## Ziel & Zielfrage(n) · ## Gliederung (H2/H3 mit den konkreten Fragen als Zwischentitel) · ## Kernaussagen & Fakten, die belegt werden müssen · ## Zitierfähigkeit (FAQ-Block, Listen, Definitionen, Schema-Hinweis) · ## Interne Verlinkung. ` +
            `Konkret und umsetzbar, max. ~450 Wörter. NUR der Markdown-Brief, kein Vorspann.`,
          1800,
        ).catch(() => null);
        if (!txt || String(txt).trim().length < 100)
          return Response.json(
            { ok: false, error: "Brief-Generierung fehlgeschlagen (Utility-LLM)" },
            { status: 502 },
          );

        const briefMd = String(txt).trim().slice(0, 20000);
        const title = (briefMd.match(/^#\s*(.+)$/m)?.[1] || thema).slice(0, 200);
        const { data: ins, error } = await sbA
          .from("content_briefs")
          .insert({
            organization_id: client.organization_id,
            client_id: clientId,
            title,
            brief_md: briefMd,
            source: { rival: rival || null, thema, questions, fanoutCount: fanout.length },
          })
          .select("id")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: ins.id, title, brief: briefMd });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { isProviderEnabled } from "@/server/integrations.server";

const Body = z.object({
  query: z.string().min(1).max(2000),
  model: z.enum(["sonar", "sonar-pro", "sonar-reasoning"]).default("sonar"),
  clientId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/perplexity/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.PERPLEXITY_API_KEY;
        if (!apiKey) return Response.json({ error: "PERPLEXITY_API_KEY not configured" }, { status: 503 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) return Response.json({ error: "Server not configured" }, { status: 503 });

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let body: unknown = {};
        try { body = await request.json(); } catch { /* empty */ }
        const parsed = Body.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

        if (parsed.data.clientId && !(await isProviderEnabled(parsed.data.clientId, "perplexity"))) {
          return Response.json({ error: "Perplexity für diesen Kunden deaktiviert." }, { status: 403 });
        }

        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: parsed.data.model,
            messages: [
              { role: "system", content: "Sei präzise und gib Quellen an." },
              { role: "user", content: parsed.data.query },
            ],
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return Response.json({ error: `Perplexity ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
        }
        const json = await res.json();
        return Response.json({
          content: json.choices?.[0]?.message?.content ?? "",
          citations: json.citations ?? [],
        });
      },
    },
  },
});

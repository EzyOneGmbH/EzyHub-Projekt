import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeCanonryBase } from "@/lib/canonry-url";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// Automated onboarding step: create (or ensure) the Canonry project for a client
// and store its slug on the client row. Idempotent (PUT create-or-update).

const Body = z.object({ clientId: z.string().uuid() });

function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s = input instanceof Error ? input.message : String(input);
  for (const v of secrets) if (v && v.length >= 4) s = s.split(v).join("***");
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***");
  return s.slice(0, 400);
}

export const Route = createFileRoute("/api/canonry/create-project")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const baseUrl = process.env.CANONRY_BASE_URL;
        const apiKey = process.env.CANONRY_API_KEY;
        const secrets = [baseUrl, apiKey];
        if (!baseUrl || !apiKey)
          return Response.json({ ok: false, error: "Canonry not configured" }, { status: 503 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey)
          return Response.json({ error: "Server not configured" }, { status: 503 });

        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "clientId required" }, { status: 400 });

        const { data: client } = await userClient
          .from("clients")
          .select("id, name, domain, organization_id, country, language, canonry_project")
          .eq("id", parsed.data.clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json({ ok: false, error: "Keine Berechtigung." }, { status: 403 });
        if (!(await isProviderEnabled(client.id, "canonry")))
          return Response.json(
            { ok: false, error: "Canonry für diesen Kunden deaktiviert." },
            { status: 403 },
          );

        const slug = client.canonry_project || slugify(client.domain || client.name);
        if (!slug)
          return Response.json(
            { ok: false, error: "Keine Domain/Name für Slug." },
            { status: 400 },
          );

        const base = normalizeCanonryBase(baseUrl);
        const body = {
          displayName: client.name || slug,
          canonicalDomain: (client.domain || `${slug}.example`).replace(/^https?:\/\//, ""),
          country: (client.country || "CH").toUpperCase().slice(0, 2),
          language: client.language || "de",
        };

        let status = 0;
        let errText = "";
        try {
          const res = await fetch(`${base}/projects/${encodeURIComponent(slug)}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
          });
          status = res.status;
          if (!res.ok)
            errText = redact(
              `Canonry HTTP ${res.status}: ${await res.text().catch(() => "")}`,
              secrets,
            );
        } catch (e) {
          errText = redact(e, secrets);
        }

        // 201 created, 200 updated, 204 no-content all count as success.
        if (![200, 201, 204].includes(status)) {
          return Response.json(
            { ok: false, error: errText || "Canonry-Projekt konnte nicht angelegt werden" },
            { status: 502 },
          );
        }

        // Persist the slug on the client.
        await supabaseAdmin.from("clients").update({ canonry_project: slug }).eq("id", client.id);

        return Response.json({ ok: true, slug, created: status === 201 });
      },
    },
  },
});

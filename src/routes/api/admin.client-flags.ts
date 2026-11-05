import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Client-Flags (04.08.2026): der agent-service meldet hier abgeleitete
// Zustaende, die nur ER kennt, EzyHub aber braucht.
//
// Erster Anwendungsfall: seo_autonom — hat dieser Kunde einen SEO-Agenten,
// der auf autonom geschaltet ist (autonomie.autoFreigabeKlassen nicht leer)?
// Der Sitemap-Job in /api/admin/content-sync reicht nur bei diesen Kunden
// selbstaendig Sitemaps ein; alle anderen werden nur beobachtet.
//
// Warum ueberhaupt ein Sync: die Agenten-Definitionen liegen als Dateien im
// agent-service auf dem Cloud-PC — EzyHub (Lovable-gehostet) kann sie nicht
// lesen. Der Wert wird deshalb bei jedem Lauf frisch gemeldet und ist damit
// selbstheilend: wird ein Agent auf beobachtend zurueckgestellt, faellt auch
// das Flag zurueck, ohne dass jemand daran denken muss.
//
// Secret-gated, schreibt AUSSCHLIESSLICH clients.metadata.seo_autonom bzw.
// ezyai_ads_in_organic (Feld key) —
// keine anderen Felder, kein Delete.

const Body = z.object({
  // { "<clientId>": true|false, ... }
  flags: z.record(z.string().uuid(), z.boolean()),
  // 05.11.2026: zweiter erlaubter Schluessel — EzyAI zaehlt ChatGPT Ads in Organic mit.
  key: z.enum(["seo_autonom", "ezyai_ads_in_organic"]).default("seo_autonom"),
});

export const Route = createFileRoute("/api/admin/client-flags")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

        const entries = Object.entries(parsed.data.flags);
        const key = parsed.data.key;
        if (!entries.length) return Response.json({ ok: true, updated: 0, changed: [] });

        // Bestand lesen, damit metadata NICHT ueberschrieben, sondern
        // zusammengefuehrt wird (dort stehen auch andere Schluessel).
        const ids = entries.map(([id]) => id);
        const { data: rows, error: readErr } = await supabaseAdmin
          .from("clients")
          .select("id, name, metadata")
          .in("id", ids);
        if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });

        const changed: Array<{ client: string; von: boolean; auf: boolean }> = [];
        let updated = 0;
        for (const [id, wert] of entries) {
          const row = (rows ?? []).find((r: any) => r.id === id);
          if (!row) continue; // unbekannte Kunden-ID still ignorieren
          const meta = (row.metadata as any) ?? {};
          const vorher = meta[key] === true;
          if (vorher === wert) continue; // nichts zu tun -> kein Schreibvorgang
          const { error } = await supabaseAdmin
            .from("clients")
            .update({ metadata: { ...meta, [key]: wert } } as never)
            .eq("id", id);
          if (error) continue;
          updated++;
          changed.push({ client: (row as any).name, von: vorher, auf: wert });
        }
        return Response.json({ ok: true, geprueft: entries.length, updated, changed });
      },
    },
  },
});

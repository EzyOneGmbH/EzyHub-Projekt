import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret, decryptSecret, brauchtUmschluesselung } from "@/server/secretbox.server";

// Security-Hardening 18.08.2026: einmalige/idempotente Migration der
// WordPress Application Passwords (oauth_connections, provider=wordpress)
// von Klartext auf enc:v<N> — und bei Key-Rotation von alter auf neue
// Schluessel-Version. Server-zu-Server (ADMIN_AUTOMATION_SECRET), die
// Antwort enthaelt AUSSCHLIESSLICH Zaehler — niemals Secrets.
export const Route = createFileRoute("/api/admin/secure-migrate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const sb = supabaseAdmin as any;
        const { data: rows, error } = await sb
          .from("oauth_connections")
          .select("id, access_token")
          .eq("provider", "wordpress");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let migriert = 0, bereitsAktuell = 0, fehler = 0;
        for (const r of rows ?? []) {
          const stored = String(r.access_token ?? "");
          if (!stored) { bereitsAktuell++; continue; }
          if (!brauchtUmschluesselung(stored)) { bereitsAktuell++; continue; }
          try {
            const plain = decryptSecret(stored); // Klartext geht unveraendert durch
            const { error: upErr } = await sb
              .from("oauth_connections")
              .update({ access_token: encryptSecret(plain), updated_at: new Date().toISOString() })
              .eq("id", r.id);
            if (upErr) throw new Error(upErr.message);
            migriert++;
          } catch {
            fehler++; // bewusst ohne Details — keine Secret-Spuren in Logs/Antworten
          }
        }
        return Response.json({ ok: true, migriert, bereitsAktuell, fehler, gesamt: (rows ?? []).length });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { originVon, sendeNeuenLink, zuletztGesendet } from "@/server/neuer-link.server";

// Neuen Einladungs-/Passwort-Link anfordern (04.11.2026, Volkan: «Link
// abgelaufen»). Supabase-Links gelten max. 24 h und werden teils vom
// Mail-Scanner (Outlook Safe Links) vorab verbraucht. Auf /set-password kann
// der Nutzer deshalb selbst einen frischen Link anfordern.
//
// Öffentlich (ohne Login). Schutz:
//  - nur Konten, die schon existieren UND Mitglied einer Organisation sind
//  - höchstens ein Link pro Adresse alle 2 Minuten
//  - Antwort immer gleich (verrät nicht, ob es die Adresse gibt)
//
// Noch nie bestätigt -> Einladung erneut senden; sonst -> Passwort-Link.

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const SPERRE_MS = 2 * 60 * 1000;

async function findeNutzer(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const u = users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) return u;
    if (users.length < 1000) return null;
  }
  return null;
}

export const Route = createFileRoute("/api/auth/neuer-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const antwort = Response.json({ ok: true });
        let email: string;
        try {
          email = Body.parse(await request.json()).email;
        } catch {
          return Response.json(
            { error: "Bitte eine gültige E-Mail-Adresse angeben." },
            { status: 400 },
          );
        }
        try {
          const u = await findeNutzer(email);
          if (!u) return antwort;

          const { count } = await supabaseAdmin
            .from("app_users")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id);
          if (!count) return antwort;

          if (Date.now() - zuletztGesendet(u) < SPERRE_MS) return antwort;
          const r = await sendeNeuenLink(u, originVon(request));
          if (r.error) console.error("[neuer-link]", r.error);
        } catch (e) {
          console.error("[neuer-link]", e instanceof Error ? e.message : e);
        }
        return antwort;
      },
    },
  },
});

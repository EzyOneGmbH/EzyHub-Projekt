import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isOrgAdmin, orgRoleOf } from "@/server/integrations.server";

// Team-/Mitarbeiter-Verwaltung (RBAC, 2026-07-15). Nur owner/admin dürfen die
// Aktionen ausführen; Mitarbeiter werden hier angelegt (KEIN Self-Signup) und
// pro Kunde freigeschaltet. Service-Role für Auth-Admin + app_users/client_access.
//
// Aktionen (POST { action, ... }):
//  - list                          -> Nutzer der Org + ihre Kunden-Zuweisungen
//  - invite {email, role}          -> Mitarbeiter per E-Mail einladen (Passwort setzen)
//  - setRole {userId, role}        -> Rolle ändern (nicht den eigenen Owner degradieren)
//  - assign {userId, clientIds[]}  -> Kunden-Zuweisung setzen (ersetzt bestehende)
//  - remove {userId}               -> aus der Org entfernen (+ Zuweisungen)

const Body = z.object({
  action: z.enum(["list", "invite", "setRole", "assign", "remove"]),
  email: z.string().email().optional(),
  role: z.enum(["admin", "member", "viewer"]).optional(),
  userId: z.string().uuid().optional(),
  clientIds: z.array(z.string().uuid()).optional(),
});

export const Route = createFileRoute("/api/admin/team")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        // Org des Aufrufers + Admin-Gate.
        const { data: me } = await supabaseAdmin
          .from("app_users")
          .select("organization_id, role")
          .eq("user_id", user.id)
          .maybeSingle();
        const orgId = (me as any)?.organization_id as string | undefined;
        if (!orgId || !(await isOrgAdmin(user.id, orgId)))
          return Response.json({ error: "Keine Berechtigung (nur SuperAdmin/Admin)." }, { status: 403 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const d = parsed.data;

        // ── list ──────────────────────────────────────────────────────────────
        if (d.action === "list") {
          const { data: members } = await supabaseAdmin
            .from("app_users")
            .select("user_id, role")
            .eq("organization_id", orgId);
          const { data: access } = await supabaseAdmin
            .from("client_access")
            .select("user_id, client_id")
            .eq("organization_id", orgId);
          // E-Mails via Auth-Admin (batch).
          const emails: Record<string, string> = {};
          for (const m of members || []) {
            try {
              const { data: au } = await supabaseAdmin.auth.admin.getUserById((m as any).user_id);
              if (au?.user?.email) emails[(m as any).user_id] = au.user.email;
            } catch {
              /* ignore */
            }
          }
          const byUser: Record<string, string[]> = {};
          for (const a of access || []) {
            (byUser[(a as any).user_id] ||= []).push((a as any).client_id);
          }
          const users = (members || []).map((m: any) => ({
            userId: m.user_id,
            role: m.role,
            email: emails[m.user_id] || null,
            self: m.user_id === user.id,
            clientIds: byUser[m.user_id] || [],
          }));
          return Response.json({ ok: true, users });
        }

        // ── invite ────────────────────────────────────────────────────────────
        if (d.action === "invite") {
          if (!d.email) return Response.json({ error: "email erforderlich" }, { status: 400 });
          const role = d.role || "member";
          // Nur owner darf admin einladen; admin kann member/viewer.
          const myRole = await orgRoleOf(user.id, orgId);
          if (role === "admin" && myRole !== "owner")
            return Response.json({ error: "Nur der SuperAdmin darf Admins anlegen." }, { status: 403 });
          const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(d.email);
          let newUserId = inv?.user?.id;
          if (invErr || !newUserId) {
            // Nutzer existiert evtl. schon -> per E-Mail auflösen.
            const { data: list } = await supabaseAdmin.auth.admin.listUsers();
            const found = (list?.users || []).find(
              (u) => (u.email || "").toLowerCase() === d.email!.toLowerCase(),
            );
            if (!found)
              return Response.json({ error: invErr?.message || "Einladung fehlgeschlagen" }, { status: 500 });
            newUserId = found.id;
          }
          // Vorhandene Org-Mitgliedschaft? -> Rolle aktualisieren, sonst anlegen
          // (kein onConflict-Rätselraten: user_id kann theoretisch mehrere Orgs haben).
          const { data: existing } = await supabaseAdmin
            .from("app_users")
            .select("id")
            .eq("user_id", newUserId)
            .eq("organization_id", orgId)
            .maybeSingle();
          const upErr = existing?.id
            ? (await supabaseAdmin.from("app_users").update({ role }).eq("id", existing.id)).error
            : (await supabaseAdmin.from("app_users").insert({ user_id: newUserId, organization_id: orgId, role })).error;
          if (upErr) return Response.json({ error: upErr.message }, { status: 500 });
          return Response.json({ ok: true, userId: newUserId, role, invited: !invErr });
        }

        // ── setRole ───────────────────────────────────────────────────────────
        if (d.action === "setRole") {
          if (!d.userId || !d.role) return Response.json({ error: "userId + role erforderlich" }, { status: 400 });
          if (d.userId === user.id)
            return Response.json({ error: "Die eigene Rolle kann hier nicht geändert werden." }, { status: 400 });
          const myRole = await orgRoleOf(user.id, orgId);
          const targetRole = await orgRoleOf(d.userId, orgId);
          if ((d.role === "admin" || targetRole === "owner" || targetRole === "admin") && myRole !== "owner")
            return Response.json({ error: "Nur der SuperAdmin darf Admin-Rollen verwalten." }, { status: 403 });
          const { error } = await supabaseAdmin
            .from("app_users")
            .update({ role: d.role })
            .eq("user_id", d.userId)
            .eq("organization_id", orgId);
          if (error) return Response.json({ error: error.message }, { status: 500 });
          return Response.json({ ok: true });
        }

        // ── assign (Kunden-Zuweisung setzen) ────────────────────────────────────
        if (d.action === "assign") {
          if (!d.userId) return Response.json({ error: "userId erforderlich" }, { status: 400 });
          const clientIds = [...new Set(d.clientIds || [])];
          // Nur Kunden DIESER Org zulassen.
          const { data: valid } = await supabaseAdmin
            .from("clients")
            .select("id")
            .eq("organization_id", orgId)
            .in("id", clientIds.length ? clientIds : ["00000000-0000-0000-0000-000000000000"]);
          const validIds = new Set((valid || []).map((c: any) => c.id));
          await supabaseAdmin.from("client_access").delete().eq("user_id", d.userId).eq("organization_id", orgId);
          const rows = [...validIds].map((cid) => ({
            organization_id: orgId,
            client_id: cid,
            user_id: d.userId!,
            created_by: user.id,
          }));
          if (rows.length) {
            const { error } = await supabaseAdmin.from("client_access").insert(rows);
            if (error) return Response.json({ error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, assigned: rows.length });
        }

        // ── remove ──────────────────────────────────────────────────────────────
        if (d.action === "remove") {
          if (!d.userId) return Response.json({ error: "userId erforderlich" }, { status: 400 });
          if (d.userId === user.id)
            return Response.json({ error: "Der eigene Zugang kann nicht entfernt werden." }, { status: 400 });
          const targetRole = await orgRoleOf(d.userId, orgId);
          const myRole = await orgRoleOf(user.id, orgId);
          if ((targetRole === "owner" || targetRole === "admin") && myRole !== "owner")
            return Response.json({ error: "Nur der SuperAdmin darf Admins entfernen." }, { status: 403 });
          if (targetRole === "owner")
            return Response.json({ error: "Der SuperAdmin (owner) kann nicht entfernt werden." }, { status: 400 });
          await supabaseAdmin.from("client_access").delete().eq("user_id", d.userId).eq("organization_id", orgId);
          await supabaseAdmin.from("app_users").delete().eq("user_id", d.userId).eq("organization_id", orgId);
          return Response.json({ ok: true });
        }

        return Response.json({ error: "unbekannte Aktion" }, { status: 400 });
      },
    },
  },
});

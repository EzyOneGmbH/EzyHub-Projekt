import { createFileRoute } from "@tanstack/react-router";
import { requireTeamRole } from "@/server/team-guard.server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { orgRoleOf } from "@/server/integrations.server";
import { linkStatus, originVon, sendeNeuenLink, zuletztGesendet } from "@/server/neuer-link.server";

// Team-/Mitarbeiter-Verwaltung (RBAC, 2026-07-15). Nur owner/admin dürfen die
// Aktionen ausführen; Mitarbeiter werden hier angelegt (KEIN Self-Signup) und
// pro Kunde freigeschaltet. Service-Role für Auth-Admin + app_users/client_access.
//
// Aktionen (POST { action, ... }):
//  - list                          -> Nutzer der Org + ihre Kunden-Zuweisungen
//  - invite {email, role, clientIds?} -> per E-Mail einladen (Passwort setzen);
//    clientIds weist direkt Kunden zu — Portal-Logins (role viewer) werden so
//    in EINEM Schritt an ihren Kunden gebunden (Admin-Umbau 06.08.)
//  - setRole {userId, role}        -> Rolle ändern (nicht den eigenen Owner degradieren)
//  - assign {userId, clientIds[]}  -> Kunden-Zuweisung setzen (ersetzt bestehende)
//  - remove {userId}               -> aus der Org entfernen (+ Zuweisungen)
//  - resend {userId}               -> Link erneut senden (04.11.2026): noch nicht
//    bestaetigt -> Einladung erneut, sonst Passwort-Link

const Body = z.object({
  action: z.enum(["list", "invite", "setRole", "assign", "remove", "setAnsicht", "resend"]),
  email: z.string().email().optional(),
  role: z.enum(["admin", "member", "viewer"]).optional(),
  userId: z.string().uuid().optional(),
  clientIds: z.array(z.string().uuid()).optional(),
  nachricht: z.string().max(500).optional(),
  // Ansichts-Beschränkung (15.10.2026): "conversion_log" = Login sieht nur
  // /conversion-log (login_ansicht). null bei setAnsicht = Beschränkung aufheben.
  ansicht: z.enum(["conversion_log"]).nullable().optional(),
  // Blog-Autopilot (09.11.2026): Einladung schaltet das Feature-Flag
  // «blog_autopilot» für die zugewiesenen Kunden ein und führt die Person nach
  // dem Passwort-Setzen in die Einrichtung (user_metadata.onboarding).
  blogAutopilot: z.boolean().optional(),
});

export const Route = createFileRoute("/api/admin/team")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Mehrfach-Organisationen (13.09.2026): Organisation + Admin-Rolle EXAKT
        // aus der aktiven Mitgliedschaft (X-Ezy-Active-Org, validiert) — das
        // fruehere maybeSingle() ohne organization_id war bei mehreren Orgs
        // mehrdeutig (null -> 403 fuer legitime Admins).
        const team = await requireTeamRole(request, "admin");
        if (team instanceof Response) return team;
        const user = { id: team.userId };
        const orgId = team.organizationId;

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json(
            { error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
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
          const status: Record<string, { status: string; linkGesendet: string | null }> = {};
          for (const m of members || []) {
            try {
              const { data: au } = await supabaseAdmin.auth.admin.getUserById((m as any).user_id);
              if (au?.user?.email) emails[(m as any).user_id] = au.user.email;
              if (au?.user) {
                const t = zuletztGesendet(au.user);
                status[(m as any).user_id] = {
                  status: linkStatus(au.user),
                  linkGesendet: t ? new Date(t).toISOString() : null,
                };
              }
            } catch {
              /* ignore */
            }
          }
          // Ansichts-Beschränkungen (tolerant, falls die Tabelle noch fehlt).
          const ansichtVon: Record<string, string> = {};
          try {
            const { data: an } = await (supabaseAdmin as any)
              .from("login_ansicht")
              .select("user_id, ansicht")
              .eq("organization_id", orgId);
            for (const a of an || []) ansichtVon[a.user_id] = a.ansicht;
          } catch {
            /* Tabelle fehlt → keine Beschränkungen */
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
            ansicht: ansichtVon[m.user_id] || null,
            // "eingeladen" (Link nie benutzt) | "bestaetigt" (nie eingeloggt) | "aktiv"
            status: status[m.user_id]?.status || null,
            linkGesendet: status[m.user_id]?.linkGesendet || null,
          }));
          return Response.json({ ok: true, users });
        }

        // ── resend ────────────────────────────────────────────────────────────
        if (d.action === "resend") {
          if (!d.userId) return Response.json({ error: "userId erforderlich" }, { status: 400 });
          const zielRolle = await orgRoleOf(d.userId, orgId);
          if (!zielRolle) return Response.json({ error: "Kein Mitglied" }, { status: 404 });
          if (zielRolle === "owner")
            return Response.json({ error: "Nicht für den SuperAdmin" }, { status: 400 });
          const { data: au, error: auErr } = await supabaseAdmin.auth.admin.getUserById(d.userId);
          if (auErr || !au?.user)
            return Response.json({ error: "Konto nicht gefunden" }, { status: 404 });
          const r = await sendeNeuenLink(au.user, originVon(request));
          if (r.error) {
            const zuSchnell = /rate|seconds|security purposes/i.test(r.error);
            return Response.json(
              {
                error: zuSchnell
                  ? "Gerade eben wurde schon ein Link verschickt. Bitte eine Minute warten."
                  : `Link konnte nicht gesendet werden: ${r.error}`,
              },
              { status: zuSchnell ? 429 : 500 },
            );
          }
          return Response.json({ ok: true, art: r.art, email: au.user.email });
        }

        // ── invite ────────────────────────────────────────────────────────────
        if (d.action === "invite") {
          if (!d.email) return Response.json({ error: "email erforderlich" }, { status: 400 });
          const role = d.role || "member";
          // Nur owner darf admin einladen; admin kann member/viewer.
          const myRole = await orgRoleOf(user.id, orgId);
          if (role === "admin" && myRole !== "owner")
            return Response.json(
              { error: "Nur der SuperAdmin darf Admins anlegen." },
              { status: 403 },
            );
          const origin = (() => {
            try {
              return new URL(request.url).origin;
            } catch {
              return process.env.PUBLIC_SITE_URL || "";
            }
          })();
          // Doppelte Einladungen verhindern (21.08.): ist die E-Mail bereits
          // Mitglied DIESER Organisation, gibt es einen verstaendlichen 409 —
          // frueher wurde die Rolle still ueberschrieben (Downgrade-Risiko).
          {
            const { data: list0 } = await supabaseAdmin.auth.admin.listUsers();
            const vorhanden = (list0?.users || []).find(
              (u2) => (u2.email || "").toLowerCase() === d.email!.toLowerCase(),
            );
            if (vorhanden) {
              const { data: mitglied } = await supabaseAdmin
                .from("app_users")
                .select("role")
                .eq("user_id", vorhanden.id)
                .eq("organization_id", orgId)
                .maybeSingle();
              if (mitglied)
                return Response.json(
                  {
                    error: `${d.email} ist bereits Mitglied (Rolle ${(mitglied as any).role}). Rolle oder Kundenzuweisung unter Team bzw. App-Zugriff ändern — keine zweite Einladung nötig.`,
                  },
                  { status: 409 },
                );
            }
          }
          const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            d.email,
            {
              redirectTo: origin ? `${origin}/set-password` : undefined,
              // Optionale persoenliche Nachricht — landet als Invite-Metadata
              // (im Mail-Template als {{ .Data.nachricht }} verwendbar).
              ...(d.nachricht || d.blogAutopilot
                ? {
                    data: {
                      ...(d.nachricht ? { nachricht: d.nachricht } : {}),
                      ...(d.blogAutopilot ? { onboarding: "blog_autopilot" } : {}),
                    },
                  }
                : {}),
            },
          );
          let newUserId = inv?.user?.id;
          if (invErr || !newUserId) {
            // Nutzer existiert evtl. schon -> per E-Mail auflösen.
            const { data: list } = await supabaseAdmin.auth.admin.listUsers();
            const found = (list?.users || []).find(
              (u) => (u.email || "").toLowerCase() === d.email!.toLowerCase(),
            );
            if (!found)
              return Response.json(
                { error: invErr?.message || "Einladung fehlgeschlagen" },
                { status: 500 },
              );
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
            : (
                await supabaseAdmin
                  .from("app_users")
                  .insert({ user_id: newUserId, organization_id: orgId, role })
              ).error;
          if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

          // Ein Signup-Trigger legt fuer neue Auth-User automatisch eine EIGENE
          // (leere) Organisation an und macht sie zum owner -> die App wuerde
          // dann diese leere Org waehlen und der Mitarbeiter saehe nichts.
          // Aufraeumen: fremde Mitgliedschaften des neuen Nutzers entfernen, wenn
          // deren Org keine Kunden hat (= die persoenliche Auto-Org).
          try {
            const { data: others } = await supabaseAdmin
              .from("app_users")
              .select("organization_id")
              .eq("user_id", newUserId)
              .neq("organization_id", orgId);
            for (const o of others || []) {
              const oid = (o as any).organization_id as string;
              const { count } = await supabaseAdmin
                .from("clients")
                .select("id", { count: "exact", head: true })
                .eq("organization_id", oid);
              if (!count) {
                await supabaseAdmin
                  .from("app_users")
                  .delete()
                  .eq("user_id", newUserId)
                  .eq("organization_id", oid);
                // Org nur loeschen, wenn danach keine Mitglieder mehr uebrig sind.
                const { count: remaining } = await supabaseAdmin
                  .from("app_users")
                  .select("id", { count: "exact", head: true })
                  .eq("organization_id", oid);
                if (!remaining) await supabaseAdmin.from("organizations").delete().eq("id", oid);
              }
            }
          } catch {
            /* Aufraeumen best-effort; die Mitgliedschaft in orgId steht bereits */
          }
          // Direkt-Zuweisung von Kunden (Portal-Flow): nur Kunden dieser Org.
          if (d.clientIds?.length) {
            const { data: valid } = await supabaseAdmin
              .from("clients")
              .select("id")
              .eq("organization_id", orgId)
              .in("id", d.clientIds);
            const rows = (valid || []).map((c: any) => ({
              organization_id: orgId,
              client_id: c.id,
              user_id: newUserId!,
              created_by: user.id,
            }));
            if (rows.length)
              await supabaseAdmin
                .from("client_access")
                .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: true });
          }
          let warnung: string | null = null;
          // Blog-Autopilot freischalten (Feature-Flag pro Kunde, App seo). Die
          // App-Freischaltung selbst (enabled) bleibt unverändert.
          if (d.blogAutopilot) {
            if (!d.clientIds?.length)
              warnung = "Blog-Autopilot braucht einen Kunden – nicht freigeschaltet";
            else {
              const { data: valid } = await supabaseAdmin
                .from("clients")
                .select("id")
                .eq("organization_id", orgId)
                .in("id", d.clientIds);
              for (const c of valid || []) {
                const { data: row } = await (supabaseAdmin as any)
                  .from("client_app_access")
                  .select("id, features")
                  .eq("client_id", (c as any).id)
                  .eq("app", "seo")
                  .maybeSingle();
                const features: string[] = Array.isArray(row?.features) ? row.features : [];
                if (features.includes("blog_autopilot")) continue;
                const { error: faErr } = row?.id
                  ? await (supabaseAdmin as any)
                      .from("client_app_access")
                      .update({ features: [...features, "blog_autopilot"] })
                      .eq("id", row.id)
                  : await (supabaseAdmin as any).from("client_app_access").insert({
                      organization_id: orgId,
                      client_id: (c as any).id,
                      app: "seo",
                      // keine Zeile = SEO aktiv (Legacy-Default) → so lassen;
                      // ein reines Zusatz-Flag schränkt die übrigen Funktionen nicht ein
                      enabled: true,
                      features: ["blog_autopilot"],
                    });
                if (faErr) warnung = "Blog-Autopilot konnte nicht freigeschaltet werden";
              }
            }
          }
          // Ansichts-Beschränkung nur für Kunden-Logins (viewer).
          if (role === "viewer" && d.ansicht) {
            const { error: anErr } = await (supabaseAdmin as any).from("login_ansicht").upsert(
              {
                user_id: newUserId,
                organization_id: orgId,
                ansicht: d.ansicht,
                created_by: user.id,
              },
              { onConflict: "user_id,organization_id" },
            );
            if (anErr) warnung = "Beschränkung konnte nicht gespeichert werden (Migration fehlt?)";
          }
          return Response.json({
            ok: true,
            userId: newUserId,
            role,
            invited: !invErr,
            warnung,
            blogAutopilot: !!d.blogAutopilot && !warnung,
          });
        }

        // ── setAnsicht ────────────────────────────────────────────────────────
        if (d.action === "setAnsicht") {
          if (!d.userId) return Response.json({ error: "userId erforderlich" }, { status: 400 });
          const { data: mitglied } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", d.userId)
            .eq("organization_id", orgId)
            .maybeSingle();
          if (!mitglied) return Response.json({ error: "Kein Mitglied" }, { status: 404 });
          if ((mitglied as any).role !== "viewer")
            return Response.json(
              { error: "Nur Kunden-Logins können beschränkt werden" },
              { status: 400 },
            );
          const tab = (supabaseAdmin as any).from("login_ansicht");
          const { error } = d.ansicht
            ? await tab.upsert(
                {
                  user_id: d.userId,
                  organization_id: orgId,
                  ansicht: d.ansicht,
                  created_by: user.id,
                },
                { onConflict: "user_id,organization_id" },
              )
            : await tab.delete().eq("user_id", d.userId).eq("organization_id", orgId);
          if (error) return Response.json({ error: error.message }, { status: 500 });
          return Response.json({ ok: true, ansicht: d.ansicht ?? null });
        }

        // ── setRole ───────────────────────────────────────────────────────────
        if (d.action === "setRole") {
          if (!d.userId || !d.role)
            return Response.json({ error: "userId + role erforderlich" }, { status: 400 });
          if (d.userId === user.id)
            return Response.json(
              { error: "Die eigene Rolle kann hier nicht geändert werden." },
              { status: 400 },
            );
          const myRole = await orgRoleOf(user.id, orgId);
          const targetRole = await orgRoleOf(d.userId, orgId);
          if (
            (d.role === "admin" || targetRole === "owner" || targetRole === "admin") &&
            myRole !== "owner"
          )
            return Response.json(
              { error: "Nur der SuperAdmin darf Admin-Rollen verwalten." },
              { status: 403 },
            );
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
          await supabaseAdmin
            .from("client_access")
            .delete()
            .eq("user_id", d.userId)
            .eq("organization_id", orgId);
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
            return Response.json(
              { error: "Der eigene Zugang kann nicht entfernt werden." },
              { status: 400 },
            );
          const targetRole = await orgRoleOf(d.userId, orgId);
          const myRole = await orgRoleOf(user.id, orgId);
          if ((targetRole === "owner" || targetRole === "admin") && myRole !== "owner")
            return Response.json(
              { error: "Nur der SuperAdmin darf Admins entfernen." },
              { status: 403 },
            );
          if (targetRole === "owner")
            return Response.json(
              { error: "Der SuperAdmin (owner) kann nicht entfernt werden." },
              { status: 400 },
            );
          await supabaseAdmin
            .from("client_access")
            .delete()
            .eq("user_id", d.userId)
            .eq("organization_id", orgId);
          await supabaseAdmin
            .from("app_users")
            .delete()
            .eq("user_id", d.userId)
            .eq("organization_id", orgId);
          return Response.json({ ok: true });
        }

        return Response.json({ error: "unbekannte Aktion" }, { status: 400 });
      },
    },
  },
});

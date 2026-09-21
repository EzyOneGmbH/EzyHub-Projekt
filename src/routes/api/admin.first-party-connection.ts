import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import {
  firstPartyProvider,
  ladeServiceAccountKey,
  redaktiereAuth,
  type AuthArt,
} from "@/server/google-auth-provider.server";
import { GA4_ADMIN_API } from "@/server/ga4.server";
import { backfillStarten, laufTaeglich } from "@/server/first-party-sync.server";

// First-Party-KPIs, Phase 1 (22.09.2026, Volkan): Admin-Maske «Verbindung
// testen» + Kunden-Flag. Nur Owner/Admin der aktiven Organisation
// (requireTeamRole "admin"), Kunde muss zur Organisation gehoeren.
//
//  status → Service-Account-E-Mail (zum Eintragen in GSC/GA4), Flag, Properties
//  test   → liest GSC sites.get und GA4 properties.get mit dem gewuenschten
//           Auth-Weg (service_account | oauth | automatisch); nur Lesezugriffe.
//  flag   → schreibt clients.metadata.first_party_kpi (Merge, kein Overwrite) —
//           Default AUS: nur so laesst sich der Test auf einen Kunden begrenzen.
// Phase 2b (Datenlauf):
//  status → zusaetzlich sync: first_party_sync_status[] des Kunden
//  backfill-start → setzt backfill_ziel (16 Monate GSC / 14 GA4), der
//           15-min-Cron laedt die Monatsbloecke rueckwaerts
//  sync-jetzt → Tagesfenster fuer DIESEN Kunden sofort (Budget 60 s, fail-soft)
// Keine Secrets in Antworten: Fehlertexte laufen durch redaktiereAuth().

const Body = z.object({
  clientId: z.string().uuid(),
  action: z.enum(["status", "test", "flag", "backfill-start", "sync-jetzt"]),
  auth: z.enum(["service_account", "oauth"]).optional(),
  enabled: z.boolean().optional(),
  quelle: z.enum(["gsc", "ga4"]).optional(),
});

/** Sync-Zustand je Quelle (nur lesend; nie Tokens). */
async function ladeSync(sb: any, clientId: string) {
  const { data } = await sb
    .from("first_party_sync_status")
    .select(
      "quelle, auth_art, zustand, letzter_erfolg_at, letzter_fehler, letzter_lauf_at, backfill_bis, backfill_ziel, zeilen_gesamt, updated_at",
    )
    .eq("client_id", clientId);
  return Array.isArray(data) ? data : [];
}

export const FLAG_FELD = "first_party_kpi";

type Probe = {
  ok: boolean;
  auth: AuthArt | null;
  detail: string | null;
  fehler: string | null;
  /** GSC: Berechtigungsstufe; GA4: Property-Anzeigename */
  wert: string | null;
};

async function probeGsc(token: string, siteUrl: string): Promise<Omit<Probe, "auth">> {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    const fehler =
      r.status === 403 || r.status === 404
        ? "Keine Berechtigung auf der GSC-Property — Konto als Nutzer eintragen (Search Console → Einstellungen → Nutzer und Berechtigungen)."
        : `GSC sites.get HTTP ${r.status}`;
    return { ok: false, detail: text.slice(0, 200), fehler, wert: null };
  }
  const j = JSON.parse(text || "{}") as { permissionLevel?: string; siteUrl?: string };
  return { ok: true, detail: j.siteUrl ?? siteUrl, fehler: null, wert: j.permissionLevel ?? null };
}

async function probeGa4(token: string, propertyId: string): Promise<Omit<Probe, "auth">> {
  const id = String(propertyId).replace(/^properties\//, "");
  const r = await fetch(`${GA4_ADMIN_API}/properties/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    const fehler =
      r.status === 403 || r.status === 404
        ? "Keine Berechtigung auf der GA4-Property — Konto als Betrachter eintragen (GA4 → Verwaltung → Property-Zugriffsverwaltung)."
        : `GA4 properties.get HTTP ${r.status}`;
    return { ok: false, detail: text.slice(0, 200), fehler, wert: null };
  }
  const j = JSON.parse(text || "{}") as { displayName?: string; timeZone?: string };
  return { ok: true, detail: j.timeZone ?? null, fehler: null, wert: j.displayName ?? null };
}

export const Route = createFileRoute("/api/admin/first-party-connection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { clientId, action } = parsed.data;

        const sb = supabaseAdmin as any;
        const { data: client } = await sb
          .from("clients")
          .select("id, name, organization_id, gsc_property, ga4_property, metadata")
          .eq("id", clientId)
          .eq("organization_id", t.organizationId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const key = ladeServiceAccountKeySicher();
        const saStatus = {
          konfiguriert: !!key.key,
          email: key.key?.client_email ?? null,
          fehler: key.fehler,
        };
        const flag = (client.metadata as any)?.[FLAG_FELD] === true;

        if (action === "status") {
          return Response.json({
            ok: true,
            client: { id: client.id, name: client.name },
            serviceAccount: saStatus,
            flag,
            gscProperty: client.gsc_property ?? null,
            ga4Property: client.ga4_property ?? null,
            sync: await ladeSync(sb, client.id),
          });
        }

        if (action === "backfill-start") {
          try {
            const ziele = await backfillStarten(sb, client.id, parsed.data.quelle);
            return Response.json({ ok: true, ziele, sync: await ladeSync(sb, client.id) });
          } catch (e: any) {
            return Response.json(
              { ok: false, error: redaktiereAuth(String(e?.message || e), key.key) },
              { status: 500 },
            );
          }
        }

        if (action === "sync-jetzt") {
          if (!flag)
            return Response.json(
              { ok: false, error: "Kunde ist nicht fuer First-Party-KPIs freigeschaltet" },
              { status: 409 },
            );
          try {
            const r = await laufTaeglich({ sb, nurClientId: client.id, budgetMs: 60_000 });
            return Response.json({
              ok: true,
              ergebnisse: r.ergebnisse,
              sync: await ladeSync(sb, client.id),
            });
          } catch (e: any) {
            return Response.json(
              { ok: false, error: redaktiereAuth(String(e?.message || e), key.key) },
              { status: 500 },
            );
          }
        }

        if (action === "flag") {
          const enabled = parsed.data.enabled === true;
          const meta = (client.metadata as any) ?? {};
          if ((meta[FLAG_FELD] === true) !== enabled) {
            const { error } = await sb
              .from("clients")
              .update({ metadata: { ...meta, [FLAG_FELD]: enabled } })
              .eq("id", client.id);
            if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, flag: enabled });
        }

        // test — Auth-Weg waehlen (automatisch = SA, wenn konfiguriert, sonst OAuth)
        const provider = firstPartyProvider(parsed.data.auth);
        let token: { accessToken: string; art: AuthArt; email: string | null } | null = null;
        let authFehler: string | null = null;
        try {
          token = await provider.accessToken(client.id);
        } catch (e: any) {
          authFehler = redaktiereAuth(String(e?.message || e), key.key);
        }
        const leer = (fehler: string): Probe => ({
          ok: false,
          auth: provider.art,
          detail: null,
          fehler,
          wert: null,
        });
        const gsc: Probe = !client.gsc_property
          ? leer("Keine GSC-Property hinterlegt")
          : !token
            ? leer(authFehler || "Kein Token")
            : { auth: token.art, ...(await probeGsc(token.accessToken, client.gsc_property)) };
        const ga4: Probe = !client.ga4_property
          ? leer("Keine GA4-Property hinterlegt")
          : !token
            ? leer(authFehler || "Kein Token")
            : { auth: token.art, ...(await probeGa4(token.accessToken, client.ga4_property)) };
        for (const p of [gsc, ga4]) {
          if (p.detail) p.detail = redaktiereAuth(p.detail, key.key);
          if (p.fehler) p.fehler = redaktiereAuth(p.fehler, key.key);
        }
        return Response.json({
          ok: true,
          auth: provider.art,
          email: token?.email ?? null,
          serviceAccount: saStatus,
          flag,
          gsc,
          ga4,
        });
      },
    },
  },
});

function ladeServiceAccountKeySicher(): {
  key: ReturnType<typeof ladeServiceAccountKey>;
  fehler: string | null;
} {
  try {
    return { key: ladeServiceAccountKey(), fehler: null };
  } catch (e: any) {
    return { key: null, fehler: String(e?.message || e) };
  }
}

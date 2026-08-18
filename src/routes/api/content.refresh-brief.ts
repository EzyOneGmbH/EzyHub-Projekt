import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";
import { generateViaSubscription } from "@/server/claude-generate.server";
import { recordApiCost } from "@/server/api-cost.server";

// Artikel-spezifische Refresh-Empfehlung fuer das Playbook-Pop-up im Blog-Register.
// Das generische Playbook sagt WIE man vorgeht — diese Route sagt WAS konkret an
// DIESEM Artikel zu tun ist: sie laedt die Bewertung aus content_decision, holt den
// Live-Artikel (Title/Meta/H2-H3/Wortzahl) von der Kundenseite und laesst Claude
// daraus einen umsetzbaren Massnahmenplan schreiben (inkl. Formulierungsvorschlaege).
// Auth wie /api/ai/generate: User-JWT + Client-Zugriff (RLS) + Anthropic-Gate.
// content_decision ist fuer authenticated revoked -> Lesen hier via service_role,
// NACHDEM der Client-Zugriff ueber den User-Client verifiziert wurde.

const Body = z.object({
  clientId: z.string().uuid(),
  contentItemId: z.string().uuid(),
});

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/sk-ant-[A-Za-z0-9\-_]+/g, "***REDACTED***");
  return s.slice(0, 500);
}

// Was die jeweilige Empfehlung bedeutet + worauf sich der Plan konzentrieren soll.
const REC_FOCUS: Record<string, string> = {
  ctr_fix:
    "Das Snippet verliert den Klick, nicht der Inhalt. Liefere 3 konkrete neue Title-Varianten (<=60 Zeichen, Keyword vorn, klarer Klick-Grund) und 2 Meta-Description-Varianten (150-160 Zeichen) fuer GENAU diesen Artikel. KEIN Volltext-Refresh empfehlen.",
  push_expand:
    "Position 11-20 (Striking Distance). Benenne die konkreten fehlenden Subtopics/Fragen als vorgeschlagene neue H2-Ueberschriften (mit 1 Satz, was darunter stehen soll), 3-5 FAQ-Fragen im Answer-first-Format und 2-3 interne Link-Quellen-Ideen (Seitentypen, die auf den Artikel verlinken sollten).",
  refresh_decay:
    "Der Artikel faellt gegen seinen eigenen Peak. Benenne konkret, WAS zu aktualisieren ist: veraltete Jahres-/Zahlenangaben, fehlende neue Aspekte des Themas, Freshness-Signale. Weise zuerst auf den Saisonalitaets-Check hin (Vorjahresmonat in GSC vergleichen), bevor refresht wird.",
  consolidate:
    "Kannibalisierung: mehrere Artikel desselben Kunden ranken auf dem Keyword. Beschreibe, welche einzigartigen Inhalte dieses Artikels in den staerkeren Artikel zu mergen waeren und was beim 301-Redirect zu beachten ist (Redirect nur nach Freigabe).",
  tech_fix:
    "Kein Text-Problem: pruefe Indexierung/interne Verlinkung. Liste die konkreten Pruefschritte (GSC-URL-Pruefung, interne Links, Sitemap) — KEINE Textaenderungen vorschlagen.",
  ceiling_new_kw:
    "Rankt bereits top, Keyword-Volumen ist zu klein. Schlage 3-5 angrenzende, groessere Ziel-Keywords/Themen vor, die zum Artikelthema passen, und ob Erweiterung oder neuer Artikel sinnvoller ist. KEINEN Refresh dieses Artikels empfehlen.",
  low_visibility:
    "Der Artikel ist alt genug und die Messung vollstaendig, aber Google spielt ihn kaum aus (<100 Impressionen/28T). Beurteile zuerst Saisonalitaet (Thema vs. Jahreszeit!) — dann: passt das Ziel-Keyword (Nachfrage? Intent?), welche konkreten internen Link-Quellen fehlen, und wie waeren Title/H1 auf ein nachgefragtes Keyword zu schaerfen? Konkrete Keyword-Alternativen mit Begruendung nennen.",
};

// Live-Snapshot des Artikels: Title-Tag, Meta-Description, H2/H3, grobe Wortzahl.
async function fetchPageSnapshot(url: string) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "EzyHubContentBot/1.0 (+https://ezyone.ch)" },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 400_000);
    const pick = (re: RegExp) => (html.match(re)?.[1] || "").replace(/\s+/g, " ").trim();
    const strip = (s: string) =>
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const heads: string[] = [];
    for (const m of html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const t = strip(m[2]);
      if (t) heads.push(`H${m[1]}: ${t}`);
      if (heads.length >= 25) break;
    }
    const bodyText = strip(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
    );
    return {
      titleTag: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
      metaDescription:
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
        pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      modified: pick(
        /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']*)["']/i,
      ),
      headings: heads,
      wordCount: bodyText ? bodyText.split(" ").length : 0,
      excerpt: bodyText.slice(0, 1500),
    };
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 120) };
  }
}

export const Route = createFileRoute("/api/content/refresh-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        const secrets = [apiKey];
        if (!apiKey)
          return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey)
          return Response.json({ error: "Server not configured" }, { status: 503 });

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let raw: unknown = {};
        try {
          raw = await request.json();
        } catch {
          /* empty */
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success)
          return Response.json(
            { error: "Invalid input", issues: parsed.error.issues },
            { status: 400 },
          );
        const d = parsed.data;

        // Zugriff ueber den USER-Client pruefen (RLS) — erst danach service_role lesen.
        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, organization_id, name, domain")
          .eq("id", d.clientId)
          .maybeSingle();
        if (clientErr || !client)
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json(
            { error: "Keine Berechtigung (viewer/read-only)." },
            { status: 403 },
          );
        if (!(await isProviderEnabled(client.id, "anthropic")))
          return Response.json(
            { error: "Claude/Anthropic für diesen Kunden deaktiviert." },
            { status: 403 },
          );

        const { data: row } = await supabaseAdmin
          .from("content_decision")
          .select("*")
          .eq("id", d.contentItemId)
          .eq("client_id", d.clientId)
          .maybeSingle();
        if (!row) return Response.json({ error: "Artikel nicht gefunden" }, { status: 404 });

        const focus =
          REC_FOCUS[String(row.recommendation)] ||
          "Beurteile anhand der Daten, ob und welche Massnahme sinnvoll ist.";

        // Letzte 12 Wochenpunkte der Zeitreihe fuer den Verlauf im Prompt.
        const { data: series } = await supabaseAdmin
          .from("content_metrics")
          .select("captured_on, clicks, impressions, position")
          .eq("content_item_id", d.contentItemId)
          .order("captured_on", { ascending: false })
          .limit(84);
        const weekly = (series || []).filter((_, i) => i % 7 === 0).reverse();

        const snap = row.url ? await fetchPageSnapshot(row.url) : { error: "keine URL" };

        const system =
          "Du bist Senior-SEO-Editor einer Schweizer Agentur. Du bekommst die Bewertungsdaten und den Live-Zustand EINES Blog-Artikels und schreibst einen konkreten, sofort umsetzbaren Massnahmenplan fuer GENAU diesen Artikel — keine Allgemeinplaetze. " +
          "Antworte auf Deutsch (schweizerische Rechtschreibung, ss statt ß) in Markdown mit GENAU diesen Abschnitten: " +
          "## Diagnose (2-3 Saetze, mit den konkreten Zahlen), " +
          "## Massnahmen (nummerierte Checkliste; jede Massnahme konkret am Artikel, mit Formulierungs-/Strukturvorschlaegen wo passend), " +
          "## Nicht tun (1-3 Punkte), " +
          "## Erfolgskontrolle (woran man in 4 Wochen misst, ob es gewirkt hat). Keine Vorrede.";

        const userPrompt = `ARTIKEL
Titel (CMS): ${row.title}
URL: ${row.url || "—"}
Kunde: ${client.name} (${client.domain || "—"})
Haupt-Keyword (GSC-Top-Query): ${row.primary_keyword || "unbekannt"}
Publiziert vor: ${row.age_days ?? "?"} Tagen · Letzter Refresh: ${row.last_refresh_at || "nie"}
Sprache: ${row.language || "de"}

BEWERTUNG (Regel-Engine, 28-Tage-Fenster)
Empfehlung: ${row.recommendation} · Trend: ${row.trend} · Reifegrad: ${row.gate}
Klicks 28T: ${row.clicks_28 ?? 0} (eigener Peak: ${row.peak_clicks_28 ?? 0})
Impressionen 28T: ${row.impr_28 ?? 0} · Durchschnittsposition: ${row.position_28 ?? "—"} (Bestwert: ${row.peak_position ?? "—"})

VERLAUF (woechentliche Stichpunkte, aelteste zuerst)
${weekly.map((p) => `${p.captured_on}: ${p.clicks} Klicks, ${p.impressions} Impr., Pos ${p.position ?? "—"}`).join("\n") || "keine Zeitreihe"}

LIVE-ZUSTAND DER SEITE
${
  "error" in snap && snap.error
    ? `Seite nicht abrufbar (${snap.error}) — Plan ohne Live-Snapshot erstellen und das erwaehnen.`
    : `Title-Tag: ${(snap as any).titleTag || "—"} (${((snap as any).titleTag || "").length} Zeichen)
Meta-Description: ${(snap as any).metaDescription || "FEHLT"} (${((snap as any).metaDescription || "").length} Zeichen)
Zuletzt geaendert (article:modified_time): ${(snap as any).modified || "—"}
Wortzahl (grob): ${(snap as any).wordCount || "?"}
Ueberschriften:
${((snap as any).headings || []).join("\n") || "—"}
Textauszug: ${(snap as any).excerpt || "—"}`
}

FOKUS DEINES PLANS
${focus}`;

        let text = "";
        // 1) Bevorzugt über den agent-service (Claude-Subscription) — verbraucht
        //    KEIN API-Guthaben. Nicht erreichbar/leer -> Direktweg unten.
        const viaSub = await generateViaSubscription({
          system,
          prompt: userPrompt,
          model: ANTHROPIC_MODEL,
          clientId: client.id,
          clientName: client.name,
          label: "Refresh-Brief",
        });
        if (viaSub?.text) text = viaSub.text.trim();

        if (!text) {
          // 2) Fallback: Direktaufruf über das API-Guthaben — der Verbrauch wird
          //    jetzt in api_cost_daily geloggt (war vorher unsichtbar).
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: ANTHROPIC_MODEL,
                max_tokens: 2500,
                system,
                messages: [{ role: "user", content: userPrompt }],
              }),
            });
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              return Response.json(
                { ok: false, error: redact(`Anthropic HTTP ${res.status}: ${t}`, secrets) },
                { status: 502 },
              );
            }
            const json = (await res.json()) as {
              content?: Array<{ type: string; text?: string }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            text = (json.content ?? [])
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n")
              .trim();
            const u = json.usage || {};
            await recordApiCost({
              provider: "Claude",
              tokensIn: Number(u.input_tokens || 0),
              tokensOut: Number(u.output_tokens || 0),
            });
          } catch (e) {
            return Response.json({ ok: false, error: redact(e, secrets) }, { status: 500 });
          }
        }

        await supabaseAdmin.from("audit_runs").insert({
          client_id: client.id,
          organization_id: client.organization_id,
          triggered_by: user.id,
          audit_type: "content_refresh_brief",
          status: text ? "succeeded" : "failed",
          input: {
            contentItemId: d.contentItemId,
            recommendation: row.recommendation,
            url: row.url,
          },
          result: { content: text } as never,
          error: text ? null : "Leere Antwort von Claude",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });

        return Response.json(
          { ok: true, recommendation: row.recommendation, content: text },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

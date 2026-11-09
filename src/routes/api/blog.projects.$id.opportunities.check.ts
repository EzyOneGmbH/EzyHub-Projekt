import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";
import {
  abgedecktVon,
  ahrefsAbruf,
  normKw,
  pruefeSuchintention,
  UNITS_PRO_ZEILE,
  type Kandidat,
} from "@/server/blog-audit.server";

// POST /api/blog/projects/:id/opportunities/check {keyword} (Schritt 7
// «+ Eigenes Thema prüfen lassen»): Einzelprüfung über Ahrefs (Volumen,
// Schwierigkeit, Hauptthema), Abgleich mit publizierten Artikeln und
// Suchintention. Landet als Chance im letzten abgeschlossenen Audit.

const Body = z.object({ keyword: z.string().trim().min(2).max(120) });

export const Route = createFileRoute("/api/blog/projects/$id/opportunities/check")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Bitte ein Thema eingeben" }, { status: 400 });
        const sb = supabaseAdmin as any;
        const { data: audit } = await sb
          .from("keyword_audits")
          .select("id, state")
          .eq("project_id", project.id)
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!audit)
          return Response.json(
            { ok: false, error: "Zuerst muss der KI-Audit fertig sein" },
            { status: 409 },
          );
        const { data: schon } = await sb
          .from("keyword_opportunities")
          .select("id, keyword")
          .eq("audit_id", audit.id);
        if ((schon ?? []).some((o: any) => normKw(o.keyword) === normKw(parsed.data.keyword)))
          return Response.json(
            { ok: false, error: "Dieses Thema ist schon in der Liste" },
            { status: 409 },
          );

        let m: any = {};
        try {
          const a = await ahrefsAbruf(
            "keywords-explorer/overview",
            {
              select: "keyword,volume,difficulty,parent_topic",
              country: String(project.market || "CH").toLowerCase(),
              keywords: parsed.data.keyword,
            },
            UNITS_PRO_ZEILE,
          );
          m = a.rows[0] ?? {};
        } catch {
          /* ohne Ahrefs-Daten weiter prüfen */
        }
        const gsc = (audit.state?.gsc ?? []).find(
          (q: any) => normKw(q.query) === normKw(parsed.data.keyword),
        );
        const url = abgedecktVon(parsed.data.keyword, audit.state?.artikel ?? [], gsc?.page);
        const k: Kandidat = {
          keyword: parsed.data.keyword,
          category: url ? "abgedeckt" : "neu",
          volume: m.volume ?? null,
          difficulty: m.difficulty ?? null,
          avg_position: gsc?.position ?? null,
          position_delta: null,
          impressions: gsc?.impressions ?? null,
          parent_topic: m.parent_topic ?? null,
          covered_by_url: url,
          cluster: null,
          reason: url
            ? "Eigenes Thema: ein publizierter Artikel deckt es schon ab – besser auffrischen."
            : `Eigenes Thema${m.volume != null ? `: ${m.volume} Suchen pro Monat` : ""}.`,
        };
        try {
          const i = (
            await pruefeSuchintention(
              project,
              [k],
              (audit.state?.clusters ?? []).map((c: any) => c.name),
            )
          ).get(normKw(k.keyword));
          if (i?.cluster) k.cluster = i.cluster;
          if (i && !i.passt) {
            k.category = "aussortiert";
            k.reason = `Suchintention passt nicht: ${i.grund || "anderes Thema"}.`;
          }
        } catch {
          /* Suchintention nicht geprüft */
        }
        const { data: opp } = await sb
          .from("keyword_opportunities")
          .insert({
            audit_id: audit.id,
            project_id: project.id,
            keyword: k.keyword,
            category: k.category,
            volume: k.volume,
            difficulty: k.difficulty,
            avg_position: k.avg_position,
            impressions: k.impressions,
            parent_topic: k.parent_topic,
            covered_by_url: k.covered_by_url,
            cluster: k.cluster,
            reason: k.reason,
            decision: "offen",
          })
          .select(
            "id, keyword, category, volume, difficulty, avg_position, position_delta, impressions, parent_topic, covered_by_url, cluster, reason, decision",
          )
          .single();
        await blogEvent(
          project.id,
          "opportunity.checked",
          { keyword: k.keyword, category: k.category },
          ctx.userId,
        );
        return Response.json({ ok: true, opportunity: opp });
      },
    },
  },
});

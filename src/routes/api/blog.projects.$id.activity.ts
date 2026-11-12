import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";
import { fuerKundeSichtbar } from "@/server/blog-artikel.server";

// GET /api/blog/projects/:id/activity (Blog-Dashboard «Letzte Aktivität»):
// die jüngsten Ereignisse des Projekts. Kunden sehen nur kundentaugliche
// Ereignisse, nie Rohdaten oder Fehlertexte, und Artikel-Ereignisse nur für
// Artikel, die für sie sichtbar sind.

const KUNDE = [
  "article.queued",
  "article.draft_ready",
  "article.reviewed",
  "article.approved",
  "article.published",
  "article.wp_synced",
  "audit.done",
  "onboarding.completed",
  "onboarding.topics_approved",
  "wp.connected",
];
const NUR_AGENTUR = [
  "article.factcheck_open",
  "article.failed",
  "article.edited",
  "audit.failed",
  "wp.test_failed",
  "project.updated",
  "rule.created",
  "rule.enabled",
  "rule.disabled",
  "competitors.updated",
  "opportunity.decision",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export const Route = createFileRoute("/api/blog/projects/$id/activity")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const sb = supabaseAdmin as any;
        const agentur = istAgentur(r.ctx);
        const { data: roh } = await sb
          .from("blog_events")
          .select("id, type, payload, article_id, created_at")
          .eq("project_id", r.project.id)
          .in("type", agentur ? [...KUNDE, ...NUR_AGENTUR] : KUNDE)
          .order("created_at", { ascending: false })
          .limit(120);
        const events: any[] = roh ?? [];

        // Die Pipeline legt die Artikel-ID im Payload ab, die Hub-Aktionen in der Spalte.
        const artikelId = (e: any) => uuid(e.article_id) ?? uuid(e.payload?.article_id);
        const themaId = (e: any) => uuid(e.payload?.topic_id);
        const artikelIds = [...new Set(events.map(artikelId).filter(Boolean))] as string[];
        const themenIds = [...new Set(events.map(themaId).filter(Boolean))] as string[];
        const FELDER = "id, topic_id, title, focus_keyword, status, review:job->review";
        const [nachId, nachThema, themen] = await Promise.all([
          artikelIds.length
            ? sb
                .from("blog_articles")
                .select(FELDER)
                .eq("project_id", r.project.id)
                .in("id", artikelIds)
            : { data: [] },
          themenIds.length
            ? sb
                .from("blog_articles")
                .select(FELDER)
                .eq("project_id", r.project.id)
                .in("topic_id", themenIds)
            : { data: [] },
          themenIds.length
            ? sb
                .from("blog_topics")
                .select("id, keyword")
                .eq("project_id", r.project.id)
                .in("id", themenIds)
            : { data: [] },
        ]);
        const artikel = new Map<string, any>();
        const artikelZuThema = new Map<string, any>();
        for (const a of [...(nachId.data ?? []), ...(nachThema.data ?? [])]) {
          artikel.set(a.id, a);
          if (a.topic_id) artikelZuThema.set(a.topic_id, a);
        }
        const thema = new Map<string, any>((themen.data ?? []).map((t: any) => [t.id, t]));

        const liste = [];
        for (const e of events) {
          const tid = themaId(e);
          const a = artikel.get(artikelId(e) ?? "") ?? (tid ? artikelZuThema.get(tid) : null);
          const sichtbar =
            !!a && (agentur || fuerKundeSichtbar({ status: a.status, job: { review: a.review } }));
          const istArtikel = e.type.startsWith("article.");
          // Geplante Themen sieht der Kunde auch im Kalender; alles Weitere erst nach der Prüfung.
          if (!agentur && istArtikel && e.type !== "article.queued" && !sichtbar) continue;
          const p = e.payload ?? {};
          const info: Record<string, unknown> = {};
          if (typeof p.anzahl === "number") info.anzahl = p.anzahl;
          if (agentur) {
            if (typeof p.stage === "string") info.stage = p.stage;
            if (typeof p.weg === "string") info.weg = p.weg;
            if (Array.isArray(p.felder)) info.felder = p.felder.slice(0, 12).map(String);
          }
          liste.push({
            id: e.id,
            type: e.type,
            at: e.created_at,
            article_id: sichtbar ? a.id : null,
            titel:
              (sichtbar || e.type === "article.queued"
                ? a?.title || a?.focus_keyword || (tid ? thema.get(tid)?.keyword : null)
                : null) ?? null,
            info,
          });
          if (liste.length >= 60) break;
        }
        return Response.json({ ok: true, events: liste, agentur });
      },
    },
  },
});

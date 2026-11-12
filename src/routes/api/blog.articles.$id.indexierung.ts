import { createFileRoute } from "@tanstack/react-router";
import { IndexierungBody, indexierung, ladeArtikelRahmen } from "@/server/blog-artikel.server";

// POST /api/blog/articles/:id/indexierung (nur Ezy One, Artikel muss live sein)
//   {action: "melden"}: Live-URL erneut melden. IndexNow über das Plugin
//     (Bing, Yandex, Seznam, Naver), Sitemap in der Search Console (Google).
//   {action: "pruefen"}: bei Google nachsehen, ob die URL im Index ist.

export const Route = createFileRoute("/api/blog/articles/$id/indexierung")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const parsed = IndexierungBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const out = await indexierung(r, parsed.data.action);
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});

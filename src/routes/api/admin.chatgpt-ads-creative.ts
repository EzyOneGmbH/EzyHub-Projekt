import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/server/secretbox.server";

// Anzeigen-Vorschau (Volkan 25.09.2026: «Kampagnen-Bilder werden nicht
// korrekt an unseren Hub übermittelt» + «Anzeige-Vorschau als Pop-up»).
//
// Befund: Die Advertiser-API liefert je Anzeige nur ein opakes
// creative.file_id — ohne Download-Endpunkt. Das Bild gibt es nur in der
// offiziellen Vorschau: POST /ads/{id}/preview liefert ein <iframe> auf
// ads.openai.com/previews/<id>?token=… . Diese Seite steht hinter einer
// Cloudflare-Browserpruefung — serverseitig nicht abrufbar (und wird bewusst
// nicht umgangen); im Browser des Nutzers laedt sie normal. Darum liefert
// diese Route die iframe-Adresse, die der Hub einbettet (Thumbnail + Pop-up).
//
// GET ?client=<uuid>&ad=<openai_ad_id>[&fresh=1] → { ok, src, width, height, cached }
// Cache: chatgpt_ads_ads.preview_src/preview_at, 6 Stunden.
// Auth: eingeloggter User (Kundensicht via RLS) ODER Bearer ADMIN_AUTOMATION_SECRET.

const ADS_API = "https://api.ads.openai.com/v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// iframe-src aus dem Vorschau-HTML; nur Adressen auf ads.openai.com zulassen.
export function vorschauSrc(html: string): string | null {
  const m = html.match(/<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  const src = decodeEntities(m[1].trim());
  try {
    const u = new URL(src);
    return u.protocol === "https:" && /(^|\.)openai\.com$/i.test(u.hostname) ? src : null;
  } catch {
    return null;
  }
}

const dim = (html: string, attr: string, fallback: number) =>
  Number(html.match(new RegExp(`\\s${attr}\\s*=\\s*["']?(\\d+)`, "i"))?.[1] ?? fallback) ||
  fallback;

export const Route = createFileRoute("/api/admin/chatgpt-ads-creative")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acc0 = await requireAccess(request);
        if (acc0 instanceof Response) return acc0;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        const adId = u.searchParams.get("ad") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId) || !/^[A-Za-z0-9_-]{3,120}$/.test(adId))
          return Response.json({ ok: false, error: "client/ad ungültig" }, { status: 400 });
        const sb = supabaseAdmin as any;
        // Sichtbarkeit des Kunden: RLS des Users.
        const { data: client } = await (acc0.userClient ?? sb)
          .from("clients")
          .select("id")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const { data: accs } = await sb
          .from("chatgpt_ads_accounts")
          .select("id, openai_ad_account_id, api_key_enc, is_mock")
          .eq("client_id", clientId);
        let acc: any = null;
        let ad: any = null;
        for (const a of accs || []) {
          const { data } = await sb
            .from("chatgpt_ads_ads")
            .select("id, openai_ad_id, preview_src, preview_at")
            .eq("account_id", a.id)
            .eq("openai_ad_id", adId)
            .maybeSingle();
          if (data) {
            acc = a;
            ad = data;
            break;
          }
        }
        if (!acc || !ad)
          return Response.json({ ok: false, error: "Anzeige unbekannt" }, { status: 404 });
        if (acc.is_mock)
          return Response.json({ ok: false, error: "Demo-Konto ohne Vorschau" }, { status: 404 });

        const frisch =
          !u.searchParams.get("fresh") &&
          ad.preview_src &&
          ad.preview_at &&
          Date.now() - new Date(ad.preview_at).getTime() < CACHE_MS;
        if (frisch)
          return Response.json(
            { ok: true, src: ad.preview_src, width: 390, height: 220, cached: true },
            { headers: { "Cache-Control": "private, max-age=600" } },
          );

        let key: string;
        try {
          key = decryptSecret(acc.api_key_enc);
        } catch {
          return Response.json({ ok: false, error: "Key nicht lesbar" }, { status: 500 });
        }
        const r = await fetch(`${ADS_API}/ads/${encodeURIComponent(adId)}/preview`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "OpenAI-Ad-Account": acc.openai_ad_account_id,
          },
          body: "{}",
          signal: AbortSignal.timeout(30_000),
        });
        const j: any = await r.json().catch(() => null);
        const html = String(j?.data?.[0]?.body ?? "");
        const src = html ? vorschauSrc(html) : null;
        if (!r.ok || !src)
          return Response.json(
            {
              ok: false,
              error: `Vorschau HTTP ${r.status}: ${JSON.stringify(j)?.slice(0, 200)}`,
            },
            { status: 502 },
          );
        await sb
          .from("chatgpt_ads_ads")
          .update({ preview_src: src, preview_at: new Date().toISOString() })
          .eq("id", ad.id);
        return Response.json(
          {
            ok: true,
            src,
            width: dim(html, "width", 390),
            height: dim(html, "height", 220),
            cached: false,
          },
          { headers: { "Cache-Control": "private, max-age=600" } },
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/server/secretbox.server";

// Anzeigen-Bild + Vorschau (Volkan 25.09.2026: «Kampagnen-Bilder werden nicht
// korrekt an unseren Hub übermittelt» + «Anzeige-Vorschau als Pop-up»).
//
// Die Advertiser-API liefert je Anzeige nur ein opakes creative.file_id —
// es gibt keinen Download-Endpunkt. Das echte Bild steckt in der offiziellen
// Vorschau (POST /ads/{id}/preview → HTML). Diese Route holt die Vorschau,
// zieht das Bild heraus und liefert es aus (24 h Cache).
//
// GET ?client=<uuid>&ad=<openai_ad_id>                → Bild-Bytes
// GET ?client=<uuid>&ad=<openai_ad_id>&format=html    → { ok, html }
// GET … &debug=1                                      → { ok, html(gekürzt), gefunden }
// Auth: eingeloggter User (Kundensicht via RLS) ODER Bearer ADMIN_AUTOMATION_SECRET.

const ADS_API = "https://api.ads.openai.com/v1";

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  // <img src> kann keinen Authorization-Header setzen -> Token auch als ?t=
  const tok =
    auth ||
    (new URL(request.url).searchParams.get("t")
      ? `Bearer ${new URL(request.url).searchParams.get("t")}`
      : "");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: tok } } });
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

// Erstes plausibles Bild aus dem Vorschau-HTML: <img src>, srcset oder CSS url().
export function bildAusVorschau(html: string): string | null {
  const kandidaten: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi))
    kandidaten.push(m[1]);
  for (const m of html.matchAll(/\ssrcset\s*=\s*["']([^"'\s,]+)/gi)) kandidaten.push(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) kandidaten.push(m[1]);
  const gut = kandidaten
    .map((k) => decodeEntities(k.trim()))
    .filter((k) => /^(https?:|data:image\/)/i.test(k))
    // Favicons/Logos/Tracking-Pixel meiden: groesste Chance hat das erste Nicht-Icon
    .filter((k) => !/favicon|\.ico(\?|$)|logo|pixel|1x1/i.test(k));
  return gut[0] ?? null;
}

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
            .select("openai_ad_id, raw")
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
          return Response.json({ ok: false, error: "Demo-Konto ohne Bild" }, { status: 404 });

        let key: string;
        try {
          key = decryptSecret(acc.api_key_enc);
        } catch (e: any) {
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
        if (!r.ok || !html)
          return Response.json(
            { ok: false, error: `Vorschau HTTP ${r.status}: ${JSON.stringify(j)?.slice(0, 200)}` },
            { status: 502 },
          );
        const bild = bildAusVorschau(html);
        if (u.searchParams.get("debug"))
          return Response.json({
            ok: true,
            gefunden: bild?.slice(0, 200) ?? null,
            html: html.slice(0, 4000),
          });
        if (u.searchParams.get("format") === "html")
          return Response.json(
            { ok: true, html },
            { headers: { "Cache-Control": "private, max-age=600" } },
          );

        if (!bild)
          return Response.json({ ok: false, error: "Kein Bild in der Vorschau" }, { status: 404 });
        const cache = { "Cache-Control": "private, max-age=86400" };
        if (bild.startsWith("data:")) {
          const m = bild.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
          if (!m)
            return Response.json({ ok: false, error: "Bildformat unbekannt" }, { status: 415 });
          const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          return new Response(bin, { headers: { "Content-Type": m[1], ...cache } });
        }
        const img = await fetch(bild, { signal: AbortSignal.timeout(30_000) });
        if (!img.ok)
          return Response.json({ ok: false, error: `Bild HTTP ${img.status}` }, { status: 502 });
        return new Response(img.body, {
          headers: { "Content-Type": img.headers.get("content-type") || "image/jpeg", ...cache },
        });
      },
    },
  },
});

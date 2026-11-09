// Blog-Autopilot Onboarding Schritt 6: Search Console und GA4 über die
// bestehende Google-Verbindung des Kunden. Das Google-Konto ist oft das der
// Agentur und sieht Properties ALLER Kunden — darum zeigen wir nur Kandidaten,
// die zur Domain des Projekts passen, und übernehmen nur Werte aus genau
// dieser Kandidatenliste. Eine bereits gesetzte Zuordnung (clients.gsc_property
// / ga4_property, von anderen EzyHub-Modulen genutzt) ändert nur Ezy One.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { GA4_ADMIN_API, parseAccountSummaries } from "@/server/ga4.server";
import { normalisiereDomain } from "@/server/blog-autopilot.server";

/** Host einer GSC-Property oder URL, normalisiert («sc-domain:x.ch» → x.ch). */
export function hostVon(property: string): string {
  const p = String(property || "").trim();
  if (/^sc-domain:/i.test(p)) return normalisiereDomain(p.replace(/^sc-domain:/i, ""));
  return normalisiereDomain(p);
}

/** Passt eine Property/URL zur Projekt-Domain (gleiche Domain oder Subdomain davon)? */
export function passtZuDomain(property: string, domain: string): boolean {
  const h = hostVon(property);
  const d = normalisiereDomain(domain);
  return !!h && !!d && (h === d || h.endsWith(`.${d}`));
}

/** GSC-Kandidaten: nur passende; Domain-Property zuerst, dann https. */
export function gscKandidaten(sites: Array<{ url: string; permission?: string }>, domain: string) {
  return sites
    .filter((s) => passtZuDomain(s.url, domain) && s.permission !== "siteUnverifiedUser")
    .map((s) => s.url)
    .sort((a, b) => {
      const rang = (u: string) =>
        u.startsWith("sc-domain:") ? 0 : u.startsWith("https://") ? 1 : 2;
      return rang(a) - rang(b) || a.localeCompare(b);
    });
}

type Stream = { id: string; name: string; url: string | null; measurementId: string | null };

async function streamsVon(token: string, propertyId: string): Promise<Stream[]> {
  const r = await fetch(
    `${GA4_ADMIN_API}/properties/${encodeURIComponent(propertyId)}/dataStreams?pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) return [];
  const j: any = await r.json().catch(() => ({}));
  return (j.dataStreams || [])
    .filter((d: any) => d.type === "WEB_DATA_STREAM")
    .map((d: any) => ({
      id:
        String(d.name || "")
          .split("/")
          .pop() || "",
      name: String(d.displayName || d.name || ""),
      url: d.webStreamData?.defaultUri ?? null,
      measurementId: d.webStreamData?.measurementId ?? null,
    }));
}

export type GoogleStand = {
  verbunden: boolean;
  fehler: string | null;
  gsc: { property: string | null; fest: boolean; kandidaten: string[] };
  ga4: {
    property: string | null;
    fest: boolean;
    stream: string | null;
    kandidaten: Array<{ id: string; name: string; streams: Stream[] }>;
  };
};

export async function googleStand(project: any): Promise<GoogleStand> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, gsc_property, ga4_property")
    .eq("id", project.client_id)
    .maybeSingle();
  const gscProp = ((client as any)?.gsc_property as string) || null;
  const ga4Prop = ((client as any)?.ga4_property as string) || null;
  const stand: GoogleStand = {
    verbunden: false,
    fehler: null,
    gsc: { property: gscProp, fest: !!gscProp, kandidaten: [] },
    ga4: {
      property: ga4Prop,
      fest: !!ga4Prop,
      stream: project.ga4_stream_id ?? null,
      kandidaten: [],
    },
  };
  let token: string;
  try {
    token = (await getGoogleAccessToken(project.client_id)).accessToken;
    stand.verbunden = true;
  } catch {
    return stand;
  }
  try {
    if (!gscProp) {
      const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
      });
      const j: any = r.ok ? await r.json().catch(() => ({})) : {};
      stand.gsc.kandidaten = gscKandidaten(
        (j.siteEntry ?? []).map((s: any) => ({ url: s.siteUrl, permission: s.permissionLevel })),
        project.domain,
      );
    }
    if (ga4Prop) {
      stand.ga4.kandidaten = [{ id: ga4Prop, name: "", streams: await streamsVon(token, ga4Prop) }];
    } else {
      const r = await fetch(`${GA4_ADMIN_API}/accountSummaries?pageSize=200`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
      });
      const props = r.ok ? parseAccountSummaries(await r.json()) : [];
      const mitStreams = await Promise.all(
        props.slice(0, 40).map(async (p) => ({
          id: p.id,
          name: p.displayName,
          streams: await streamsVon(token, p.id),
        })),
      );
      // nur Properties mit einem Web-Stream auf der Projekt-Domain
      stand.ga4.kandidaten = mitStreams
        .map((p) => ({
          ...p,
          streams: p.streams.filter((s) => s.url && passtZuDomain(s.url, project.domain)),
        }))
        .filter((p) => p.streams.length > 0);
    }
  } catch (e) {
    stand.fehler = String((e as Error)?.message || e).slice(0, 200);
  }
  return stand;
}

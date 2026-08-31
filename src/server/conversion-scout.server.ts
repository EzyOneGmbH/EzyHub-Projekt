// Conversion-Scout — Schicht 2: Discovery (Pilot FIH, 26.08.2026).
// Erkennt moegliche GA4-Conversions auf der Kundenseite (mailto/tel/Download
// sowie Cross-Domain-Checkout-Ziele wie RaiseNow/Stripe, wo der eigentliche
// Purchase auf einer FREMDEN Domain abgeschlossen wird) und schreibt sie als
// Kandidaten in conversion_candidates (status 'pending').
// Deployt NICHTS automatisch — Freigabe passiert manuell im Conversions-Tab.
//
// NUR ORGANIC: die spaeter freigegebenen Key Events dienen der organischen
// Messung; es gibt bewusst KEINE Google-Ads-Anbindung (kein Ads-Import).
//
// Kernanforderung (Volkan): jede Mailadresse/Telefonnummer ist ein EIGENER
// Kandidat — keine Zusammenfassung zu einem generischen "Mail-Klick".
//
// Crawl-Strategie: statischer Fetch + HTML-Parse (Kundenseiten sind
// WP/Elementor, server-gerendert — kein Playwright noetig). Requests werden
// entzerrt (Hoster-Lehre FIH: zu schnelle Abrufe → IP-Sperre).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SB = supabaseAdmin as any;

const UA = "EzyOneBot/1.0 (+https://ezyone.ch; conversion-scout)";
const MAX_PAGES = 40;
const MAX_DEPTH = 2;
const DELAY_MS = 400; // Requests entzerren — Hoster-IP-Sperre vermeiden
const PAGE_TIMEOUT_MS = 12_000;

const DOWNLOAD_RE = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?[^"']*)?$/i;

// Cross-Domain-Ziele: externe Hosts, auf denen typischerweise ein Kauf/eine
// Spende/Buchung ABGESCHLOSSEN wird (der eigentliche "Purchase"). Wird gegen
// host+pathname geprueft. Bewusst eng auf echte Zahlungs-/Spenden-/Checkout-/
// Buchungs-Anbieter + explizite Checkout-/Buchungs-Pfade begrenzt (Social/
// Behoerden/Partner-Links sollen NICHT als Kandidat auftauchen).
// Enthaelt Zahlungs-Gateways (CH: payrexx/datatrans/saferpay/wallee/twint),
// Spenden-Plattformen und Hotel-Buchungsmaschinen (mews, reguest, seekda,
// ibelsa, cultuzz, straiv, dirs21, simplebooking, siteminder u. a.) — Ava =
// Hotel Ava bucht ueber Mews (app.mews.com). Gilt global fuer alle Kunden.
const CHECKOUT_RE =
  /(raisenow|payrexx|datatrans|saferpay|wallee|twint|stripe|paypal|gocardless|mollie|sumup|betterplace|donorbox|eventbrite|ticketino|weeztix|billetweb|petitionslist|mews|secure-hotel-booking|reguest|re-guest|seekda|ibelsa|cultuzz|hotelnetsolutions|straiv|dirs21|simplebooking|siteminder|thebookingbutton|availpro|bookassist|apaleo|hqrevenue|\/donate|\/spende|\/spenden|\/pay(ment)?\b|\/kasse|\/checkout|\/warenkorb|\/give\b|\/buchen|\/buchung|\/reservier|\/reservation|\/booking|\/book\b)/i;

// CTA-Erkennung (Volkan 31.08. — «alle CTAs zeigen, wir entscheiden selber»):
// ein Link zaehlt als CTA, wenn sein LINKTEXT ein Aktionswort enthaelt ODER
// das Element eine Button-Klasse traegt (Elementor & Co.). Interne CTAs werden
// Kandidaten vom Typ 'cta' (Messung: page_view der Zielseite, KEIN GTM);
// externe CTAs zaehlen als 'crossdomain' (Outbound-Klick) — zusaetzlich zur
// engen CHECKOUT_RE-Anbieterliste. Social-Follows bleiben bewusst draussen.
const CTA_LABEL_RE =
  /(buch(en|ung)|reservier|anfrage(n)?|anfragen|offert|kontakt|termin|anmeld|registrier|mitglied|spende(n)?|kaufen|bestell|abonnier|newsletter|beitreten|teilnehmen|bewerben|book(ing)?|reserve|request|quote|contact|appointment|register|sign\s?up|join|donate|buy|order|subscribe|apply|get\s?started|jetzt\s(buchen|anfragen|spenden|kaufen|bestellen|anmelden|starten))/i;
const BUTTON_CLASS_RE = /class\s*=\s*["'][^"']*(elementor-button|btn|button|cta)[^"']*["']/i;
// «Weiter lesen»-Buttons sind Artikel-Navigation, kein CTA (FIH-Befund 31.08.:
// 13 von 21 Kandidaten waren Blog-Read-More-Links mit Button-Klasse).
const READMORE_RE =
  /^(weiter ?lesen|mehr ?lesen|mehr erfahren|read more|continue reading|zum artikel|mehr (zum|über|ueber) .*)$/i;
const SOCIAL_RE =
  /(facebook|instagram|linkedin|youtube|tiktok|pinterest|twitter|x\.com|telegram|whatsapp|snapchat|threads\.net|maps\.app|goo\.gl|google\.(com|ch)\/maps)/i;
// CDN-/Asset-Hosts (Bilder etc.) sind nie ein CTA-Ziel.
const ASSET_HOST_RE = /(exactdn\.com|cloudfront\.net|cdn\.|gstatic|googleapis)/i;
// Interne Seiten, die nie eine Conversion sind.
const CTA_PATH_EXCLUDE_RE = /^\/$|impressum|datenschutz|agb|privacy|cookie/i;

export type CandidateFound = {
  candidate_type: "mailto" | "tel" | "download" | "crossdomain" | "cta";
  raw_value: string;
  label: string | null;
  source_url: string;
};

/** Host gehoert NICHT zur Domain-Familie des Kunden (apex/www/Subdomains)?
 *  Cross-Domain ist nur ueber verschiedene registrierbare Domains relevant —
 *  same-domain-Subdomains misst GA4 ohnehin als eine Site. */
function isExternalHost(host: string, siteHost: string): boolean {
  const bare = siteHost.replace(/^www\./, "");
  return host !== siteHost && host !== bare && host !== "www." + bare && !host.endsWith("." + bare);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** mailto ohne Query-String (subject/body erzeugen sonst Schein-Duplikate). */
export function normalizeMailto(href: string): string | null {
  const m = /^mailto:([^?]+)/i.exec(href.trim());
  if (!m) return null;
  const addr = decodeURIComponent(m[1]).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

/** tel auf +/Ziffern reduziert — Formatierungsvarianten deduplizieren. */
export function normalizeTel(href: string): string | null {
  const m = /^tel:(.+)$/i.exec(href.trim());
  if (!m) return null;
  const num = decodeURIComponent(m[1]).replace(/[^\d+]/g, "");
  return num.replace(/\D/g, "").length >= 7 ? num : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Alle Kandidaten + interne Links einer HTML-Seite extrahieren. */
export function extractFromHtml(
  html: string,
  pageUrl: string,
  siteHost: string,
): { candidates: CandidateFound[]; internalLinks: string[] } {
  const candidates: CandidateFound[] = [];
  const internalLinks: string[] = [];
  const seenLink = new Set<string>();

  const anchorRe = /<a\b[^>]*?href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const href = m[2].trim();
    const label = stripTags(m[3]) || null;
    // CTA = Aktionswort im Linktext ODER Button-Klasse am Anker-Tag selbst;
    // «Weiter lesen»-Labels sind ausgenommen (Artikel-Navigation).
    const anchorTag = m[0].slice(0, m[0].indexOf(">") + 1);
    const isCta =
      !(label != null && READMORE_RE.test(label)) &&
      ((label != null && CTA_LABEL_RE.test(label)) || BUTTON_CLASS_RE.test(anchorTag));
    if (/^mailto:/i.test(href)) {
      const v = normalizeMailto(href);
      if (v)
        candidates.push({ candidate_type: "mailto", raw_value: v, label, source_url: pageUrl });
      continue;
    }
    if (/^tel:/i.test(href)) {
      const v = normalizeTel(href);
      if (v) candidates.push({ candidate_type: "tel", raw_value: v, label, source_url: pageUrl });
      continue;
    }
    // Absolute URL bilden; kaputte hrefs still ueberspringen.
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (abs.host === siteHost && DOWNLOAD_RE.test(abs.pathname)) {
      candidates.push({
        candidate_type: "download",
        raw_value: abs.origin + abs.pathname,
        label,
        source_url: pageUrl,
      });
      continue;
    }
    // Externer Checkout-/Zahlungs-/Spenden-Host ODER externer CTA-Link →
    // Cross-Domain-Kandidat. raw_value = Host, damit spaeter GA4 `link_domain`
    // exakt matcht. Ein Kandidat je Host (Dedup in runConversionScan).
    // Social-Follows und Asset-CDNs sind keine Conversion-Ziele.
    if (isExternalHost(abs.host, siteHost)) {
      const target = abs.host + abs.pathname;
      if (
        !SOCIAL_RE.test(target) &&
        !ASSET_HOST_RE.test(abs.host) &&
        (CHECKOUT_RE.test(target) || isCta)
      ) {
        candidates.push({
          candidate_type: "crossdomain",
          raw_value: abs.host,
          label: label || abs.origin + abs.pathname,
          source_url: pageUrl,
        });
      }
      continue; // externe Hosts werden nicht weitergecrawlt
    }
    // Interner CTA (Button/Aktions-Link) → Kandidat 'cta': gemessen wird bei
    // Freigabe der Seitenaufruf der ZIELSEITE (page_view + page_location) —
    // funktioniert ohne GTM. Startseite/Rechtsseiten sind ausgenommen.
    if (abs.host === siteHost && isCta && !CTA_PATH_EXCLUDE_RE.test(abs.pathname)) {
      candidates.push({
        candidate_type: "cta",
        raw_value: abs.origin + abs.pathname,
        label,
        source_url: pageUrl,
      });
      // KEIN continue: das Ziel bleibt zugleich interner Crawl-Link.
    }
    if (abs.host === siteHost) {
      // Query/Fragment weg — WP-Seiten sind pfad-adressiert; verhindert
      // dass ?replytocom=…-Varianten das Seitenbudget auffressen.
      const clean = abs.origin + abs.pathname;
      if (!DOWNLOAD_RE.test(abs.pathname) && !seenLink.has(clean)) {
        seenLink.add(clean);
        internalLinks.push(clean);
      }
    }
  }
  return { candidates, internalLinks };
}

async function fetchPage(url: string): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    const html = await r.text();
    return { finalUrl: r.url || url, html: html.slice(0, 2_000_000) };
  } catch {
    return null;
  }
}

/** 5.2 Redirect Resolver: finale Ziel-URL der hinterlegten Domain ermitteln.
 *  GA4/GTM-Zuordnung bleibt IMMER am Kunden-Datensatz, nie an der Domain. */
export async function resolveTarget(domain: string): Promise<string> {
  const start = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  const page = await fetchPage(start);
  if (!page) throw new Error(`Startseite nicht erreichbar: ${start}`);
  return page.finalUrl;
}

export async function runConversionScan(client: {
  id: string;
  organization_id: string;
  domain: string;
}): Promise<{
  runId: string;
  targetUrl: string;
  pagesCrawled: number;
  found: number;
  newCandidates: number;
}> {
  const { data: run, error: runErr } = await SB.from("conversion_scan_runs")
    .insert({ organization_id: client.organization_id, client_id: client.id })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);

  try {
    const targetUrl = await resolveTarget(client.domain);
    const siteHost = new URL(targetUrl).host;

    // BFS-Crawl: Startseite + interne Links bis Tiefe 2, gedeckeltes Budget.
    const queue: Array<{ url: string; depth: number }> = [{ url: targetUrl, depth: 0 }];
    const visited = new Set<string>();
    const foundByKey = new Map<string, CandidateFound>();
    let pagesCrawled = 0;

    while (queue.length && pagesCrawled < MAX_PAGES) {
      const { url, depth } = queue.shift()!;
      const key = url.replace(/\/$/, "");
      if (visited.has(key)) continue;
      visited.add(key);
      const page = await fetchPage(url);
      if (!page) continue;
      pagesCrawled++;
      const { candidates, internalLinks } = extractFromHtml(page.html, page.finalUrl, siteHost);
      for (const c of candidates) {
        const k = `${c.candidate_type}|${c.raw_value}`;
        if (!foundByKey.has(k)) foundByKey.set(k, c);
      }
      if (depth < MAX_DEPTH)
        for (const l of internalLinks) {
          if (!visited.has(l.replace(/\/$/, ""))) queue.push({ url: l, depth: depth + 1 });
        }
      await sleep(DELAY_MS);
    }

    // Upsert: neue Kandidaten als 'pending', bekannte nur last_seen_at
    // auffrischen — Status/Wert/GA4-Felder bleiben unangetastet.
    let newCount = 0;
    for (const c of foundByKey.values()) {
      const { data: existing } = await SB.from("conversion_candidates")
        .select("id")
        .eq("client_id", client.id)
        .eq("candidate_type", c.candidate_type)
        .eq("raw_value", c.raw_value)
        .maybeSingle();
      if (existing) {
        await SB.from("conversion_candidates")
          .update({ last_seen_at: new Date().toISOString(), source_url: c.source_url })
          .eq("id", existing.id);
      } else {
        const { error } = await SB.from("conversion_candidates").insert({
          organization_id: client.organization_id,
          client_id: client.id,
          candidate_type: c.candidate_type,
          raw_value: c.raw_value,
          label: c.label,
          source_url: c.source_url,
        });
        if (!error) newCount++;
      }
    }

    await SB.from("conversion_scan_runs")
      .update({
        finished_at: new Date().toISOString(),
        resolved_target_url: targetUrl,
        pages_crawled: pagesCrawled,
        status: "success",
        new_candidates_count: newCount,
        seen_candidates_count: foundByKey.size,
      })
      .eq("id", run.id);

    return {
      runId: run.id,
      targetUrl,
      pagesCrawled,
      found: foundByKey.size,
      newCandidates: newCount,
    };
  } catch (e) {
    await SB.from("conversion_scan_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: String((e as Error)?.message || e).slice(0, 300),
      })
      .eq("id", run.id);
    throw e;
  }
}

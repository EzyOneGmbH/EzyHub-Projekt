// Diagnose für Content-Massnahme «not_indexed» (01.11.2026): statt einer
// Content-Empfehlung prüft die Route, WARUM ein Artikel nicht im Google-Index ist.
// Checks: HTTP-Status, noindex (Meta + X-Robots-Tag), Canonical, robots.txt,
// Sitemap, Sitemap in GSC eingereicht, GSC-URL-Prüfung, interne Links von
// indexierten Seiten. Nur lesend (Live-Seite, robots.txt, Sitemaps, GSC, DataForSEO).
import { googleToken } from "./seo-report-quellen.server";
import { GSC_API } from "./gsc.server";
import { dfsMarkdown, dfsSeitenInfo, type Kunde } from "./content-actions.server";

export type DiagnoseCheck = { check: string; ok: boolean; detail: string };

const BOT_UA = "EzyHubContentBot/1.0 (+https://ezyone.ch)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_TEXT = 3_000_000; // Obergrenze pro Abruf (Worker-Speicher/CPU)

export const normUrl = (u: string) =>
  u
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/^https:\/\/www\./i, "https://")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

type Abruf = {
  status: number;
  location: string;
  xRobots: string;
  text: string;
  gesperrt: boolean; // 403/429/Netzfehler: Website sperrt unseren Server
};

/** Direkter Abruf ohne Weiterleitung zu folgen; bei 403/429 zweiter Versuch mit Browser-UA. */
async function abruf(url: string, timeoutMs = 12_000): Promise<Abruf> {
  const laden = (ua: string) =>
    fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": ua, "Accept-Language": "de-CH,de;q=0.9" },
    });
  try {
    let r = await laden(BOT_UA);
    if (r.status === 403 || r.status === 429) r = await laden(BROWSER_UA);
    const gesperrt = r.status === 403 || r.status === 429;
    const text = gesperrt ? "" : (await r.text().catch(() => "")).slice(0, MAX_TEXT);
    return {
      status: r.status,
      location: r.headers.get("location") || "",
      xRobots: r.headers.get("x-robots-tag") || "",
      text,
      gesperrt,
    };
  } catch {
    return { status: 0, location: "", xRobots: "", text: "", gesperrt: true };
  }
}

// ── robots.txt ──────────────────────────────────────────────────────────────

/** Regeln für Googlebot (Fallback *) → ist der Pfad erlaubt? Längste Regel gewinnt, Allow bei Gleichstand. */
export function robotsErlaubt(robots: string, pfad: string): { erlaubt: boolean; regel: string } {
  const gruppen: Array<{ agents: string[]; regeln: Array<{ allow: boolean; muster: string }> }> =
    [];
  let akt: (typeof gruppen)[number] | null = null;
  let zuletztAgent = false;
  for (const roh of robots.split(/\r?\n/)) {
    const zeile = roh.replace(/#.*$/, "").trim();
    const m = zeile.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const feld = m[1].toLowerCase();
    const wert = m[2].trim();
    if (feld === "user-agent") {
      if (!akt || !zuletztAgent) {
        akt = { agents: [], regeln: [] };
        gruppen.push(akt);
      }
      akt.agents.push(wert.toLowerCase());
      zuletztAgent = true;
    } else if ((feld === "allow" || feld === "disallow") && akt) {
      zuletztAgent = false;
      if (wert) akt.regeln.push({ allow: feld === "allow", muster: wert });
    } else zuletztAgent = false;
  }
  const gruppe =
    gruppen.find((g) => g.agents.some((a) => a === "googlebot")) ??
    gruppen.find((g) => g.agents.includes("*"));
  if (!gruppe) return { erlaubt: true, regel: "" };
  let best: { allow: boolean; muster: string } | null = null;
  for (const r of gruppe.regeln) {
    const re = new RegExp("^" + r.muster.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    if (!re.test(pfad)) continue;
    if (
      !best ||
      r.muster.length > best.muster.length ||
      (r.muster.length === best.muster.length && r.allow)
    )
      best = r;
  }
  return best
    ? { erlaubt: best.allow, regel: `${best.allow ? "Allow" : "Disallow"}: ${best.muster}` }
    : { erlaubt: true, regel: "" };
}

// ── Sitemaps ────────────────────────────────────────────────────────────────

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );

/** Sucht die URL in Sitemaps (Index → bis 12 Unter-Sitemaps, Beitrags-Sitemaps zuerst). */
async function inSitemap(
  kandidaten: string[],
  ziel: string,
): Promise<{ gefunden: string | null; geprueft: number; abrufbar: boolean }> {
  const z = normUrl(ziel);
  const besucht = new Set<string>();
  let geprueft = 0;
  let abrufbar = false;
  const warteschlange = [...kandidaten];
  while (warteschlange.length && geprueft < 14) {
    const sm = warteschlange.shift()!;
    if (besucht.has(sm)) continue;
    besucht.add(sm);
    const r = await abruf(sm, 10_000);
    if (r.status >= 300 && r.status < 400 && r.location) {
      warteschlange.unshift(new URL(r.location, sm).toString());
      continue;
    }
    if (r.status !== 200 || !r.text) continue;
    abrufbar = true;
    geprueft++;
    const liste = locs(r.text);
    if (/<sitemapindex/i.test(r.text)) {
      // Beitrags-Sitemaps zuerst (WordPress/Yoast/Rank Math: post-sitemap.xml)
      const kinder = liste.sort(
        (a, b) =>
          Number(/post|blog|news|artikel/i.test(b)) - Number(/post|blog|news|artikel/i.test(a)),
      );
      warteschlange.unshift(...kinder.slice(0, 12));
      continue;
    }
    if (liste.some((u) => normUrl(u) === z)) return { gefunden: sm, geprueft, abrufbar };
  }
  return { gefunden: null, geprueft, abrufbar };
}

// ── GSC ─────────────────────────────────────────────────────────────────────

async function gscInspektion(token: string, site: string, url: string) {
  try {
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: "de-CH" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` } as const;
    const j: any = await r.json();
    return { res: (j?.inspectionResult?.indexStatusResult ?? {}) as Record<string, any> } as const;
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 80) } as const;
  }
}

async function gscSitemaps(token: string, site: string) {
  try {
    const r = await fetch(`${GSC_API}/${encodeURIComponent(site)}/sitemaps`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` } as const;
    const j: any = await r.json();
    return {
      liste: ((j?.sitemap ?? []) as any[]).map((s) => ({
        path: String(s.path ?? ""),
        lastSubmitted: String(s.lastSubmitted ?? "").slice(0, 10),
        isPending: !!s.isPending,
        errors: Number(s.errors) || 0,
      })),
    } as const;
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 80) } as const;
  }
}

// ── Interne Links ───────────────────────────────────────────────────────────

/** Verlinkt der Seiteninhalt (HTML oder Markdown) auf die Ziel-URL? */
export function verlinkt(inhalt: string, ziel: string, basis: string): boolean {
  const z = normUrl(ziel);
  for (const m of inhalt.matchAll(/(?:href\s*=\s*["']|\]\()([^"'()\s>]+)/gi)) {
    try {
      if (normUrl(new URL(m[1].replace(/&amp;/g, "&"), basis).toString()) === z) return true;
    } catch {
      /* ungültige URL */
    }
  }
  return false;
}

const seitenTitel = (inhalt: string) =>
  (inhalt.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || inhalt.match(/^#\s+(.+)$/m)?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

export type LinkQuelle = {
  url: string;
  title: string;
  clicks: number;
  verlinkt: boolean | null; // null = nicht abrufbar
};

async function pruefeLinkQuellen(
  seiten: Array<{ url: string; clicks: number }>,
  ziel: string,
): Promise<LinkQuelle[]> {
  return Promise.all(
    seiten.map(async (p) => {
      const r = await abruf(p.url, 10_000);
      let inhalt = r.status === 200 ? r.text : "";
      if (!inhalt && r.gesperrt) inhalt = (await dfsMarkdown(p.url, 25_000)) ?? "";
      return {
        url: p.url,
        clicks: p.clicks,
        title: inhalt ? seitenTitel(inhalt) : "",
        verlinkt: inhalt ? verlinkt(inhalt, ziel, p.url) : null,
      };
    }),
  );
}

// ── Diagnose ────────────────────────────────────────────────────────────────

const datum = (iso: string) => (iso ? iso.slice(0, 10) : "");

export async function diagnoseNichtIndexiert(a: {
  kunde: Kunde;
  url: string;
  starkeSeiten: Array<{ url: string; clicks: number }>;
}): Promise<{
  checks: DiagnoseCheck[];
  linkQuellen: LinkQuelle[];
  articleFetched: boolean;
  artikelTitel: string;
  hinweise: string[];
}> {
  const { kunde, url } = a;
  const hinweise: string[] = [];
  const origin = new URL(url).origin;
  const pfad = new URL(url).pathname + new URL(url).search;
  const site = kunde.gsc_property || "";
  const token = site ? await googleToken(kunde.id).catch(() => null) : null;
  if (!site) hinweise.push("keine GSC-Property");
  else if (!token) hinweise.push("Google nicht verbunden");

  const [seite, robots, insp, sms, linkQuellen] = await Promise.all([
    abruf(url, 15_000),
    abruf(`${origin}/robots.txt`, 10_000),
    token
      ? gscInspektion(token, site, url)
      : Promise.resolve({ error: "kein GSC-Zugang" } as const),
    token ? gscSitemaps(token, site) : Promise.resolve({ error: "kein GSC-Zugang" } as const),
    pruefeLinkQuellen(a.starkeSeiten.slice(0, 15), url),
  ]);
  const gsc = "res" in insp ? insp.res : null;
  if ("error" in insp) hinweise.push(`GSC-URL-Prüfung: ${insp.error}`);

  // Bei Sperre: Seitendaten über DataForSEO
  const dfs = seite.gesperrt ? await dfsSeitenInfo(url, 30_000) : null;
  if (seite.gesperrt)
    hinweise.push(
      dfs
        ? "Website sperrt unseren Server — Seitendaten über DataForSEO"
        : "Website sperrt unseren Server, DataForSEO ebenfalls ohne Ergebnis",
    );
  const articleFetched = seite.status === 200 || (!!dfs && dfs.status === 200);
  const checks: DiagnoseCheck[] = [];

  // 1) HTTP-Status
  const status = seite.gesperrt ? (dfs?.status ?? 0) : seite.status;
  const via = seite.gesperrt ? " (abgerufen über DataForSEO; unser Server wird gesperrt)" : "";
  checks.push({
    check: "HTTP-Status",
    ok: status === 200,
    detail:
      status === 0
        ? "Seite nicht abrufbar"
        : status >= 300 && status < 400
          ? `${status} — Weiterleitung auf ${seite.location || "?"}: die Ziel-URL ist die zu indexierende Seite`
          : `${status}${via}`,
  });

  // 2) noindex (Meta + X-Robots-Tag), ergänzt um GSC indexingState
  const metaRobots = [...seite.text.matchAll(/<meta[^>]+name=["'](?:robots|googlebot)["'][^>]*>/gi)]
    .map((m) => m[0].match(/content=["']([^"']*)["']/i)?.[1] ?? "")
    .join(", ");
  const metaNoindex = /noindex|none/i.test(metaRobots) || !!dfs?.noindex;
  const headerNoindex = /noindex|none/i.test(seite.xRobots);
  const gscIdx = String(gsc?.indexingState ?? "");
  const gscNoindex = /BLOCKED_BY_META_TAG|BLOCKED_BY_HTTP_HEADER/.test(gscIdx);
  checks.push({
    check: "noindex",
    ok: !metaNoindex && !headerNoindex && !gscNoindex,
    detail: [
      seite.gesperrt
        ? `Meta robots laut DataForSEO: ${dfs ? (dfs.noindex ? "noindex" : "kein noindex") : "unbekannt"}; X-Robots-Tag nicht prüfbar`
        : `Meta robots: ${metaRobots || "keins"}; X-Robots-Tag: ${seite.xRobots || "keins"}`,
      gscIdx ? `GSC: ${gscIdx}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  });

  // 3) Canonical (Seite + Google)
  const canonSeite = seite.gesperrt
    ? (dfs?.canonical ?? "")
    : (seite.text
        .match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]
        .match(/href=["']([^"']+)["']/i)?.[1] ?? "");
  const gCanon = String(gsc?.googleCanonical ?? "");
  const uCanon = String(gsc?.userCanonical ?? "");
  const canonFremd = !!canonSeite && normUrl(canonSeite) !== normUrl(url);
  const googleAnders = !!gCanon && normUrl(gCanon) !== normUrl(url);
  checks.push({
    check: "Canonical",
    ok: !canonFremd && !googleAnders,
    detail: [
      canonSeite
        ? canonFremd
          ? `zeigt auf eine andere URL: ${canonSeite}`
          : "selbstreferenzierend"
        : "kein Canonical gesetzt",
      gCanon ? `Google-Canonical: ${googleAnders ? gCanon : "gleich"}` : "",
      uCanon && normUrl(uCanon) !== normUrl(canonSeite || url)
        ? `GSC-User-Canonical: ${uCanon}`
        : "",
    ]
      .filter(Boolean)
      .join(" · "),
  });

  // 4) robots.txt
  const gscRobots = String(gsc?.robotsTxtState ?? "");
  let robotsOk = true;
  let robotsDetail = "";
  if (robots.status === 200 && robots.text) {
    const r = robotsErlaubt(robots.text, pfad);
    robotsOk = r.erlaubt;
    robotsDetail = r.erlaubt ? "Googlebot darf die URL crawlen" : `gesperrt durch «${r.regel}»`;
  } else if (robots.status === 404) robotsDetail = "keine robots.txt (alles erlaubt)";
  else
    robotsDetail = `robots.txt nicht abrufbar (${robots.gesperrt ? "Server gesperrt" : `HTTP ${robots.status}`})`;
  if (gscRobots) {
    if (gscRobots === "DISALLOWED") robotsOk = false;
    robotsDetail += ` · GSC: ${gscRobots}`;
  }
  checks.push({ check: "robots.txt", ok: robotsOk, detail: robotsDetail });

  // 5) In Sitemap enthalten
  const smRobots = [...(robots.text || "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
  const smListe = "liste" in sms && sms.liste ? sms.liste : null;
  const smGsc = smListe ? smListe.map((s) => s.path) : [];
  const kandidaten = [
    ...new Set([...smRobots, ...smGsc, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`]),
  ];
  const sm = await inSitemap(kandidaten, url);
  const gscSm: string[] = Array.isArray(gsc?.sitemap) ? gsc.sitemap.map(String) : [];
  checks.push({
    check: "In Sitemap enthalten",
    ok: !!sm.gefunden || gscSm.length > 0,
    detail: sm.gefunden
      ? `ja, in ${sm.gefunden}`
      : gscSm.length
        ? `laut GSC in ${gscSm.join(", ")}`
        : sm.abrufbar
          ? `nicht gefunden (${sm.geprueft} Sitemap(s) geprüft)`
          : "Sitemaps nicht abrufbar und GSC kennt keine Sitemap mit dieser URL",
  });

  // 6) Sitemap in GSC eingereicht
  checks.push(
    smListe
      ? {
          check: "Sitemap in GSC eingereicht",
          ok: smListe.length > 0,
          detail: smListe.length
            ? smListe
                .slice(0, 4)
                .map(
                  (s) =>
                    `${s.path} (eingereicht ${s.lastSubmitted || "?"}${s.errors ? `, ${s.errors} Fehler` : ""}${s.isPending ? ", ausstehend" : ""})`,
                )
                .join("; ")
            : "keine Sitemap eingereicht",
        }
      : { check: "Sitemap in GSC eingereicht", ok: false, detail: `nicht prüfbar (${sms.error})` },
  );

  // 7) GSC-URL-Prüfung
  checks.push(
    gsc
      ? {
          check: "GSC-URL-Prüfung",
          ok: gsc.verdict === "PASS",
          detail: [
            `coverageState: ${gsc.coverageState ?? "—"}`,
            `lastCrawlTime: ${datum(String(gsc.lastCrawlTime ?? "")) || "nie gecrawlt"}`,
            gsc.pageFetchState && gsc.pageFetchState !== "SUCCESSFUL"
              ? `Abruf: ${gsc.pageFetchState}`
              : "",
            gsc.crawledAs ? `gecrawlt als ${gsc.crawledAs}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          check: "GSC-URL-Prüfung",
          ok: false,
          detail: `nicht prüfbar (${"error" in insp ? insp.error : "?"})`,
        },
  );

  // 8) Interne Links von indexierten Seiten (Seiten mit GSC-Klicks = indexiert)
  const geprueft = linkQuellen.filter((l) => l.verlinkt !== null);
  const mitLink = geprueft.filter((l) => l.verlinkt);
  const referring: string[] = Array.isArray(gsc?.referringUrls)
    ? gsc.referringUrls.map(String)
    : [];
  const beispiele = [...new Set([...mitLink.map((l) => l.url), ...referring])].slice(0, 5);
  checks.push({
    check: "Interne Links von indexierten Seiten",
    ok: mitLink.length > 0 || referring.length > 0,
    detail:
      `${mitLink.length} von ${geprueft.length} geprüften stärksten Seiten (GSC-Klicks) verlinken den Artikel` +
      (referring.length ? `; Google kennt ${referring.length} verweisende URL(s)` : "") +
      (beispiele.length ? `. Beispiele: ${beispiele.join(", ")}` : "") +
      (geprueft.length < linkQuellen.length
        ? ` (${linkQuellen.length - geprueft.length} Seite(n) nicht abrufbar)`
        : ""),
  });

  const artikelTitel = (seite.text && seitenTitel(seite.text)) || dfs?.h1?.[0] || dfs?.title || "";
  return { checks, linkQuellen, articleFetched, artikelTitel, hinweise };
}

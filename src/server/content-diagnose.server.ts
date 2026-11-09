// Diagnose für Content-Massnahme «not_indexed» (01.11.2026): statt einer
// Content-Empfehlung prüft die Route, WARUM ein Artikel nicht im Google-Index ist.
// Checks: HTTP-Status, noindex (Meta + X-Robots-Tag), Canonical, robots.txt,
// Sitemap, Sitemap in GSC eingereicht, GSC-URL-Prüfung, interne Links von
// indexierten Seiten. Nur lesend (Live-Seite, robots.txt, Sitemaps, GSC, DataForSEO).
//
// 09.11.2026: Die Abrufe (Seite, robots.txt, Sitemaps, bis 15 interne Seiten)
// laufen über den agent-service (Cloud-PC) — im Worker führten sie zu Fehler 1102,
// und manche Hoster sperren Rechenzentrums-IPs. Nur ohne agent-service ruft der
// Worker selbst ab. Nicht prüfbare Punkte melden ok: null statt true.
import { googleToken } from "./seo-report-quellen.server";
import { GSC_API } from "./gsc.server";
import {
  addDfsKosten,
  dfsMarkdown,
  dfsSeitenInfo,
  textBegrenzt,
  type Kunde,
} from "./content-actions.server";
import { contentProbe, type ProbeDiagnose, type ProbeSeite } from "./content-probe.server";

/** ok: true = in Ordnung, false = Problem gefunden, null = nicht prüfbar */
export type DiagnoseCheck = { check: string; ok: boolean | null; detail: string };

const BOT_UA = "EzyHubContentBot/1.0 (+https://ezyone.ch)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_TEXT = 1_500_000; // Obergrenze pro Abruf (Worker-Speicher/CPU)

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
    const text = gesperrt ? "" : await textBegrenzt(r, MAX_TEXT);
    if (gesperrt) r.body?.cancel().catch(() => {});
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

type Inspektion = { res: Record<string, any> } | { error: string };
type InspektionsVersuch = { res: Record<string, any> } | { error: string; wiederholbar: boolean };

async function gscInspektionEinmal(
  token: string,
  site: string,
  url: string,
  timeoutMs: number,
): Promise<InspektionsVersuch> {
  try {
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: "de-CH" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok)
      return { error: `HTTP ${r.status}`, wiederholbar: r.status === 429 || r.status >= 500 };
    const j: any = await r.json();
    return { res: (j?.inspectionResult?.indexStatusResult ?? {}) as Record<string, any> };
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 80), wiederholbar: true };
  }
}

/** URL-Prüfung: 40 s Timeout, bei Timeout/429/5xx einmal wiederholen (09.11.2026). */
export async function gscInspektion(
  token: string,
  site: string,
  url: string,
  opts: { timeoutMs?: number; pauseMs?: number } = {},
  einmal: typeof gscInspektionEinmal = gscInspektionEinmal,
): Promise<Inspektion> {
  const t = opts.timeoutMs ?? 40_000;
  const erst = await einmal(token, site, url, t);
  if ("res" in erst) return erst;
  if (!erst.wiederholbar) return { error: erst.error };
  await new Promise((ok) => setTimeout(ok, opts.pauseMs ?? 2_000));
  const zweit = await einmal(token, site, url, t);
  return "res" in zweit ? zweit : { error: `${zweit.error} (2 Versuche)` };
}

export type SitemapsGsc =
  | {
      liste: Array<{ path: string; lastSubmitted: string; isPending: boolean; errors: number }>;
    }
  | { error: string };

async function gscSitemaps(token: string, site: string): Promise<SitemapsGsc> {
  try {
    const r = await fetch(`${GSC_API}/${encodeURIComponent(site)}/sitemaps`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j: any = await r.json();
    return {
      liste: ((j?.sitemap ?? []) as any[]).map((s) => ({
        path: String(s.path ?? ""),
        lastSubmitted: String(s.lastSubmitted ?? "").slice(0, 10),
        isPending: !!s.isPending,
        errors: Number(s.errors) || 0,
      })),
    };
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 80) };
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

// ── Rohdaten im Worker (nur ohne agent-service) ─────────────────────────────

async function rohImWorker(
  url: string,
  sitemapKandidaten: string[],
  linkSeiten: Array<{ url: string; clicks: number }>,
): Promise<ProbeDiagnose> {
  const origin = new URL(url).origin;
  const [seite, robots, links] = await Promise.all([
    abruf(url, 15_000),
    abruf(`${origin}/robots.txt`, 10_000),
    pruefeLinkQuellen(linkSeiten, url),
  ]);
  let s: ProbeSeite;
  if (!seite.gesperrt) {
    const ok200 = seite.status === 200;
    s = {
      quelle: "direkt",
      status: seite.status,
      location: seite.location,
      xRobots: seite.xRobots,
      xRobotsGeprueft: true,
      metaRobots: ok200
        ? [...seite.text.matchAll(/<meta[^>]+name=["'](?:robots|googlebot)["'][^>]*>/gi)]
            .map((m) => m[0].match(/content=["']([^"']*)["']/i)?.[1] ?? "")
            .join(", ")
        : null,
      noindex: null,
      canonical: ok200
        ? (seite.text
            .match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]
            .match(/href=["']([^"']+)["']/i)?.[1] ?? "")
        : null,
      title: seite.text ? seitenTitel(seite.text) : "",
    };
  } else {
    const dfs = await dfsSeitenInfo(url, 30_000);
    s = dfs
      ? {
          quelle: "dataforseo",
          status: dfs.status,
          location: "",
          xRobots: "",
          xRobotsGeprueft: false,
          metaRobots: null,
          noindex: dfs.noindex,
          canonical: dfs.canonical,
          title: dfs.h1?.[0] || dfs.title || "",
        }
      : {
          quelle: null,
          status: 0,
          location: "",
          xRobots: "",
          xRobotsGeprueft: false,
          metaRobots: null,
          noindex: null,
          canonical: null,
          title: "",
        };
  }
  const robotsText = robots.status === 200 ? robots.text : "";
  const smRobots = [...robotsText.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
  const kandidaten = [
    ...new Set([
      ...smRobots,
      ...sitemapKandidaten,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap.xml`,
    ]),
  ];
  return {
    seite: s,
    robots: { status: robots.status, gesperrt: robots.gesperrt, text: robotsText },
    sitemap: await inSitemap(kandidaten, url),
    links: links.map((l) => ({
      url: l.url,
      title: l.title,
      verlinkt: l.verlinkt,
      quelle: l.verlinkt === null ? null : "direkt",
    })),
  };
}

// ── Checks (rein, testbar) ──────────────────────────────────────────────────

const datum = (iso: string) => (iso ? iso.slice(0, 10) : "");

export function baueChecks(a: {
  url: string;
  roh: ProbeDiagnose;
  gsc: Record<string, any> | null;
  gscFehler: string | null;
  sitemapsGsc: SitemapsGsc;
  linkQuellen: LinkQuelle[];
}): DiagnoseCheck[] {
  const { url, roh, gsc } = a;
  const seite = roh.seite;
  const pfad = new URL(url).pathname + new URL(url).search;
  const checks: DiagnoseCheck[] = [];
  const viaDfs = seite.quelle === "dataforseo";

  // 1) HTTP-Status
  const status = seite.status;
  checks.push({
    check: "HTTP-Status",
    ok: status === 0 ? null : status === 200,
    detail:
      status === 0
        ? "nicht prüfbar: Seite weder direkt noch über DataForSEO abrufbar"
        : status >= 300 && status < 400
          ? `${status} — Weiterleitung auf ${seite.location || "?"}: die Ziel-URL ist die zu indexierende Seite`
          : `${status}${viaDfs ? " (abgerufen über DataForSEO; die Website sperrt unsere Abrufe)" : ""}`,
  });

  // 2) noindex (Meta + X-Robots-Tag), ergänzt um GSC indexingState
  const metaBekannt = seite.metaRobots !== null || seite.noindex !== null;
  const metaNoindex = /noindex|none/i.test(seite.metaRobots ?? "") || seite.noindex === true;
  const headerNoindex = seite.xRobotsGeprueft && /noindex|none/i.test(seite.xRobots);
  const gscIdx = String(gsc?.indexingState ?? "");
  const gscNoindex = /BLOCKED_BY_META_TAG|BLOCKED_BY_HTTP_HEADER/.test(gscIdx);
  const gscErlaubt = gscIdx === "INDEXING_ALLOWED";
  const metaText =
    seite.metaRobots !== null
      ? `Meta robots: ${seite.metaRobots || "keins"}`
      : seite.noindex !== null
        ? `Meta robots laut DataForSEO: ${seite.noindex ? "noindex" : "kein noindex"}`
        : "Meta robots nicht prüfbar";
  checks.push({
    check: "noindex",
    ok:
      metaNoindex || headerNoindex || gscNoindex
        ? false
        : gscErlaubt || (metaBekannt && seite.xRobotsGeprueft)
          ? true
          : null,
    detail: [
      metaText,
      seite.xRobotsGeprueft
        ? `X-Robots-Tag: ${seite.xRobots || "keins"}`
        : "X-Robots-Tag nicht prüfbar",
      gscIdx ? `GSC: ${gscIdx}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  });

  // 3) Canonical (Seite + Google)
  const canonSeite = seite.canonical; // null = nicht ermittelbar
  const gCanon = String(gsc?.googleCanonical ?? "");
  const uCanon = String(gsc?.userCanonical ?? "");
  const canonFremd = !!canonSeite && normUrl(canonSeite) !== normUrl(url);
  const googleAnders = !!gCanon && normUrl(gCanon) !== normUrl(url);
  checks.push({
    check: "Canonical",
    ok: canonFremd || googleAnders ? false : canonSeite === null && !gCanon ? null : true,
    detail: [
      canonSeite === null
        ? "Canonical der Seite nicht ermittelbar"
        : canonSeite
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
  let robotsOk: boolean | null;
  let robotsDetail: string;
  if (roh.robots.status === 200 && roh.robots.text) {
    const r = robotsErlaubt(roh.robots.text, pfad);
    robotsOk = r.erlaubt;
    robotsDetail = r.erlaubt ? "Googlebot darf die URL crawlen" : `gesperrt durch «${r.regel}»`;
  } else if (roh.robots.status === 404) {
    robotsOk = true;
    robotsDetail = "keine robots.txt (alles erlaubt)";
  } else {
    robotsOk = null;
    robotsDetail = `robots.txt nicht abrufbar (${roh.robots.gesperrt ? "Abruf gesperrt" : `HTTP ${roh.robots.status}`})`;
  }
  if (gscRobots) {
    if (gscRobots === "DISALLOWED") robotsOk = false;
    else if (robotsOk === null && gscRobots === "ALLOWED") robotsOk = true;
    robotsDetail += ` · GSC: ${gscRobots}`;
  }
  checks.push({ check: "robots.txt", ok: robotsOk, detail: robotsDetail });

  // 5) In Sitemap enthalten
  const sm = roh.sitemap;
  const gscSm: string[] = Array.isArray(gsc?.sitemap) ? gsc.sitemap.map(String) : [];
  checks.push({
    check: "In Sitemap enthalten",
    ok: sm.gefunden || gscSm.length ? true : sm.abrufbar ? false : null,
    detail: sm.gefunden
      ? `ja, in ${sm.gefunden}`
      : gscSm.length
        ? `laut GSC in ${gscSm.join(", ")}`
        : sm.abrufbar
          ? `nicht gefunden (${sm.geprueft} Sitemap(s) geprüft)`
          : "nicht prüfbar: Sitemaps nicht abrufbar und GSC kennt keine Sitemap mit dieser URL",
  });

  // 6) Sitemap in GSC eingereicht
  const sms = a.sitemapsGsc;
  checks.push(
    "liste" in sms
      ? {
          check: "Sitemap in GSC eingereicht",
          ok: sms.liste.length > 0,
          detail: sms.liste.length
            ? sms.liste
                .slice(0, 4)
                .map(
                  (s) =>
                    `${s.path} (eingereicht ${s.lastSubmitted || "?"}${s.errors ? `, ${s.errors} Fehler` : ""}${s.isPending ? ", ausstehend" : ""})`,
                )
                .join("; ")
            : "keine Sitemap eingereicht",
        }
      : { check: "Sitemap in GSC eingereicht", ok: null, detail: `nicht prüfbar (${sms.error})` },
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
          ok: null,
          detail: `nicht prüfbar (${a.gscFehler || "?"})`,
        },
  );

  // 8) Interne Links von indexierten Seiten (Seiten mit GSC-Klicks = indexiert)
  const linkQuellen = a.linkQuellen;
  const geprueft = linkQuellen.filter((l) => l.verlinkt !== null);
  const mitLink = geprueft.filter((l) => l.verlinkt);
  const referring: string[] = Array.isArray(gsc?.referringUrls)
    ? gsc.referringUrls.map(String)
    : [];
  const beispiele = [...new Set([...mitLink.map((l) => l.url), ...referring])].slice(0, 5);
  checks.push({
    check: "Interne Links von indexierten Seiten",
    ok: mitLink.length > 0 || referring.length > 0 ? true : geprueft.length ? false : null,
    detail:
      (geprueft.length || !linkQuellen.length
        ? `${mitLink.length} von ${geprueft.length} geprüften stärksten Seiten (GSC-Klicks) verlinken den Artikel`
        : `nicht prüfbar: keine der ${linkQuellen.length} stärksten Seiten abrufbar`) +
      (referring.length ? `; Google kennt ${referring.length} verweisende URL(s)` : "") +
      (beispiele.length ? `. Beispiele: ${beispiele.join(", ")}` : "") +
      (geprueft.length && geprueft.length < linkQuellen.length
        ? ` (${linkQuellen.length - geprueft.length} Seite(n) nicht abrufbar)`
        : ""),
  });
  return checks;
}

// ── Diagnose ────────────────────────────────────────────────────────────────

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
  const site = kunde.gsc_property || "";
  const token = site ? await googleToken(kunde.id).catch(() => null) : null;
  if (!site) hinweise.push("keine GSC-Property");
  else if (!token) hinweise.push("Google nicht verbunden");
  const linkSeiten = a.starkeSeiten.slice(0, 15);

  const inspP: Promise<Inspektion> = token
    ? gscInspektion(token, site, url)
    : Promise.resolve({ error: "kein GSC-Zugang" });
  const smsP: Promise<SitemapsGsc> = token
    ? gscSitemaps(token, site)
    : Promise.resolve({ error: "kein GSC-Zugang" });
  // Abrufe über den agent-service, sobald die GSC-Sitemaps bekannt sind
  const rohP = smsP.then(async (sms) => {
    const kandidaten = "liste" in sms ? sms.liste.map((s) => s.path).filter(Boolean) : [];
    const p = await contentProbe(
      {
        diagnose: {
          url,
          linkSources: linkSeiten.map((l) => l.url),
          sitemapCandidates: kandidaten,
        },
      },
      90_000,
    );
    if (p?.diagnose) {
      addDfsKosten(p.cost_dfs);
      return p.diagnose;
    }
    hinweise.push("agent-service nicht erreichbar — Abrufe im Worker");
    return rohImWorker(url, kandidaten, linkSeiten);
  });
  const [insp, sms, roh] = await Promise.all([inspP, smsP, rohP]);
  const gsc = "res" in insp ? insp.res : null;
  const gscFehler = "error" in insp ? insp.error : null;
  if (gscFehler) hinweise.push(`GSC-URL-Prüfung: ${gscFehler}`);
  if (roh.seite.quelle === "dataforseo")
    hinweise.push("Website sperrt unsere Abrufe — Seitendaten über DataForSEO");
  else if (roh.seite.quelle === null)
    hinweise.push("Seite weder direkt noch über DataForSEO abrufbar");

  const klicks = new Map(linkSeiten.map((l) => [l.url, l.clicks]));
  const linkQuellen: LinkQuelle[] = roh.links.map((l) => ({
    url: l.url,
    title: l.title,
    clicks: klicks.get(l.url) ?? 0,
    verlinkt: l.verlinkt,
  }));
  const checks = baueChecks({ url, roh, gsc, gscFehler, sitemapsGsc: sms, linkQuellen });
  return {
    checks,
    linkQuellen,
    articleFetched: roh.seite.status === 200,
    artikelTitel: roh.seite.title,
    hinweise,
  };
}

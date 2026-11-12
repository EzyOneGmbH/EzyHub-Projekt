// Blog-Autopilot Phase 3, Etappe 2: Artikel prüfen (Kap. 6.5, 8, 9).
// Bearbeiten, «Änderungen an WordPress senden», WordPress-Status abgleichen,
// Prüfung durch Ezy One und Freigabe. Statuswechsel passieren nur hier und in
// der Pipeline (Kap. 10), nie im Browser.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  blogEvent,
  istAgentur,
  requireBlogProject,
  type BlogKontext,
} from "@/server/blog-autopilot.server";
import {
  bereinigeHtml,
  bereinigeLinks,
  ctaAktuell,
  loeseClaims,
  schweiz,
  sendeAnWordpress,
  woerter,
  wpVerbindung,
  zaehleCta,
} from "@/server/blog-pipeline.server";
import { ezrRequest } from "@/server/ezyrank-wp.server";

const SB = supabaseAdmin as any;

export type Antwort = { status: number; body: Record<string, unknown> };
const fehler = (status: number, error: string): Antwort => ({
  status,
  body: { ok: false, error },
});
const ok = (body: Record<string, unknown>): Antwort => ({
  status: 200,
  body: { ok: true, ...body },
});

export type Rahmen = { article: any; project: any; ctx: BlogKontext };

/** Artikel samt Projekt und Zugriff laden. «Gibt es nicht» und «fremd» sind beide 404. */
export async function ladeArtikelRahmen(request: Request, id: string): Promise<Rahmen | Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
  const nichtDa = () =>
    Response.json({ ok: false, error: "Artikel nicht gefunden" }, { status: 404 });
  const { data: article } = await SB.from("blog_articles").select("*").eq("id", id).maybeSingle();
  if (!article) return nichtDa();
  const r = await requireBlogProject(request, String(article.project_id));
  if (r instanceof Response) return r.status === 401 ? r : nichtDa();
  return { article, project: r.project, ctx: r.ctx };
}

/** Kunden sehen einen Artikel erst, wenn Ezy One ihn geprüft hat. */
export function fuerKundeSichtbar(article: any): boolean {
  return !!article?.job?.review || ["kunde_freigegeben", "live"].includes(article?.status);
}

/** Im Hub bearbeitet, aber noch nicht nach WordPress gesendet. */
export function ungesendet(article: any, project: any): boolean {
  if (nurHub(article, project) || !article?.wp_post_id) return false;
  const bearbeitet = article.job?.bearbeitet?.at;
  const gesendet = article.job?.wordpress?.at;
  return !!bearbeitet && (!gesendet || String(bearbeitet) > String(gesendet));
}

export const modusVon = (article: any): string => article?.job?.modus ?? "neu";

/** Artikel bleibt im Hub: Vorschlag für eine Seite oder Projekt ohne WordPress-Entwurf. */
export const nurHub = (article: any, project: any): boolean =>
  modusVon(article) === "vorschlag" || project?.publish_mode === "hub_only";

// ── Text aus dem Editor säubern ─────────────────────────────────────────────

// Gleiche Auswahl wie der Filter im WordPress-Plugin, dazu die Claim-Markierung.
const TAGS: Record<string, string[]> = {
  h2: ["id", "class"],
  h3: ["id", "class"],
  h4: ["id", "class"],
  p: ["class"],
  ul: [],
  ol: [],
  li: [],
  a: ["href", "rel", "target", "title"],
  strong: [],
  b: [],
  em: [],
  i: [],
  br: [],
  hr: [],
  blockquote: [],
  figure: [],
  figcaption: [],
  img: ["src", "alt", "width", "height"],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  details: [],
  summary: [],
  span: ["data-claim"],
};
const OHNE_ENDE = new Set(["br", "hr", "img"]);
// Jede spitze Klammer, die kein neu gebautes erlaubtes Tag öffnet, wird Text.
const REST_KLAMMER = new RegExp(`<(?!\\/?(?:${Object.keys(TAGS).join("|")})(?:\\s[^<>]*)?>)`, "gi");

function attributWert(name: string, wert: string): string | null {
  const w = wert.trim();
  const url = w.replace(/</g, "%3C").replace(/>/g, "%3E");
  if (name === "href") return /^(https?:\/\/|mailto:|tel:|#)/i.test(url) ? url : null;
  if (name === "src") return /^https:\/\//i.test(url) ? url : null;
  if (name === "class" || name === "id") return /^[\w -]{1,80}$/.test(w) ? w : null;
  if (name === "data-claim" || name === "width" || name === "height")
    return /^\d{1,5}$/.test(w) ? w : null;
  if (name === "colspan" || name === "rowspan") return /^\d{1,2}$/.test(w) ? w : null;
  if (name === "target") return w === "_blank" ? w : null;
  if (name === "rel") return /^[a-z ]{1,60}$/i.test(w) ? w : null;
  return w.replace(/[<>]/g, "");
}

/** Ein Tag aus den erlaubten Attributen neu bauen; unbekannte Tags fallen weg. */
function baueTag(_g: string, zu: string, n: string, a: string): string {
  const name = n.toLowerCase();
  const erlaubt = TAGS[name];
  if (!erlaubt) return "";
  if (zu) return OHNE_ENDE.has(name) ? "" : `</${name}>`;
  const attrs: string[] = [];
  for (const m of String(a).matchAll(/([\w-]+)="([^"]*)"/g)) {
    const k = m[1].toLowerCase();
    if (!erlaubt.includes(k) || attrs.some((x) => x.startsWith(`${k}=`))) continue;
    const w = attributWert(k, m[2]);
    if (w !== null) attrs.push(`${k}="${w}"`);
  }
  return `<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
}

/** span bleibt nur als Claim-Markierung; andere span (samt ihrem Ende) fallen weg. */
function nurClaimSpans(html: string): string {
  const offen: boolean[] = [];
  return html.replace(/<span( data-claim="\d+")?>|<\/span>/g, (g, claim?: string) => {
    if (g !== "</span>") {
      offen.push(!!claim);
      return claim ? g : "";
    }
    return offen.pop() ? g : "";
  });
}

/**
 * HTML aus dem Editor auf erlaubte Tags und Attribute beschränken. Jedes Tag
 * wird aus den erlaubten Attributen neu gebaut: Inline-Handler, style und
 * unbekannte Attribute fallen damit weg, unbekannte Tags ebenso (Text bleibt).
 */
export function saeubereEditorHtml(html: string): string {
  const roh = ctaAktuell(bereinigeHtml(String(html || "")))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/<(\/?)div\b[^>]*>/gi, "<$1p>");
  // Bis nichts mehr ändert: ein entferntes Tag kann aus seinen Nachbarn ein
  // neues bilden («<<x>img onerror=…>»), das der nächste Durchgang neu baut.
  let out = roh;
  let stabil = false;
  for (let i = 0; i < 6 && !stabil; i++) {
    const vorher = out;
    out = out.replace(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g, baueTag);
    stabil = out === vorher;
  }
  if (!stabil) out = out.replace(/</g, "&lt;");
  let sauber = nurClaimSpans(out.replace(REST_KLAMMER, "&lt;"));
  // Aus <div><p>…</p></div> wird sonst ein Absatz im Absatz.
  for (let i = 0, vorher = ""; i < 5 && vorher !== sauber; i++) {
    vorher = sauber;
    sauber = sauber.replace(/<p>\s*(?=<p[\s>])/g, "").replace(/<\/p>\s*<\/p>/g, "</p>");
  }
  return sauber
    .replace(/<p>\s*(<br>\s*)*<\/p>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── Ansicht ─────────────────────────────────────────────────────────────────

/** Artikel für den Browser: ohne Job-Zwischenstand (Brief, Recherche, Rohentwurf). */
export function artikelSicht(a: any, project: any) {
  const { job, locked_until: _lock, ...rest } = a;
  return {
    ...rest,
    content_html: ctaAktuell(rest.content_html || ""),
    modus: job?.modus ?? "neu",
    nur_hub: nurHub(a, project),
    ungesendet: ungesendet(a, project),
    original_url: job?.brief?.original_url ?? null,
    pruefung: job?.pruefung ?? null,
    review: job?.review ?? null,
    bearbeitet: job?.bearbeitet ?? null,
    freigabe: job?.freigabe ?? null,
    wordpress: job?.wordpress ?? null,
    quellen: (job?.recherche?.quellen ?? []).map((q: any) => ({ url: q.url, titel: q.titel })),
  };
}

/** Darf «Freigeben» den Beitrag in WordPress live schalten? Nur neue Artikel
 *  mit Entwurf und Scope «publish»: eine Überarbeitung liegt als eigener Entwurf
 *  neben dem Original und würde als Doppel erscheinen. */
export function kannVeroeffentlichen(article: any, project: any, scopes: string[]): boolean {
  return (
    modusVon(article) === "neu" &&
    !nurHub(article, project) &&
    !!article.wp_post_id &&
    scopes.includes("publish")
  );
}

// ── Bearbeiten ──────────────────────────────────────────────────────────────

export const ArtikelPatch = z
  .object({
    title: z.string().trim().min(3).max(200),
    seo_title: z.string().trim().max(200),
    meta_description: z.string().trim().max(400),
    excerpt: z.string().trim().max(1000),
    content_html: z.string().min(1).max(300_000),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Keine Änderung");

export async function bearbeiteArtikel(
  r: Rahmen,
  eingabe: z.infer<typeof ArtikelPatch>,
): Promise<Antwort> {
  const { article, project, ctx } = r;
  if (!istAgentur(ctx)) return fehler(403, "Nur für Ezy One");
  if (!["faktencheck", "entwurf_wp"].includes(article.status))
    return fehler(
      409,
      article.status === "kunde_freigegeben" || article.status === "live"
        ? "Nach der Freigabe lässt sich der Artikel hier nicht mehr ändern"
        : "Der Artikel ist noch nicht fertig geschrieben",
    );
  const sprache = project.language || "de-CH";
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "seo_title", "meta_description", "excerpt"] as const)
    if (eingabe[k] !== undefined && schweiz(eingabe[k]!, sprache) !== (article[k] ?? ""))
      patch[k] = schweiz(eingabe[k]!, sprache);

  let job = article.job ?? {};
  let neuerText: string | null = null;
  if (eingabe.content_html !== undefined) {
    // Solange Behauptungen offen sind, hängt der Text an den Markierungen.
    if (article.status === "faktencheck")
      return fehler(409, "Den Text bitte erst nach dem Faktencheck bearbeiten");
    const html = bereinigeLinks(schweiz(saeubereEditorHtml(eingabe.content_html), sprache), {
      eigen: project.domain,
      gesperrt: job?.brief?.gesperrt ?? [],
      erreichbar: () => true,
    }).html;
    if (woerter(loeseClaims(html)) < 30) return fehler(400, "Der Text ist zu kurz");
    if (html !== article.content_html) {
      neuerText = html;
      patch.content_html = html;
      patch.word_count = woerter(loeseClaims(html));
      job = { ...job, pruefung: { ...job.pruefung, cta: zaehleCta(html) } };
    }
  }
  const felder = Object.keys(patch).filter((k) => k !== "word_count");
  if (!felder.length) return ok({ geaendert: [] });

  const jetzt = new Date().toISOString();
  job = { ...job, bearbeitet: { at: jetzt, by: ctx.userId } };
  let version = Number(article.version) || 1;
  if (neuerText !== null) {
    const { data: letzte } = await SB.from("article_versions")
      .select("version")
      .eq("article_id", article.id)
      .order("version", { ascending: false })
      .limit(1);
    version = Math.max(version, Number(letzte?.[0]?.version) || 0) + 1;
    const { error } = await SB.from("article_versions").insert({
      article_id: article.id,
      project_id: article.project_id,
      client_id: article.client_id,
      version,
      content_html: loeseClaims(neuerText),
      reason: "manuell",
      created_by: ctx.userId,
    });
    if (error) return fehler(500, "Speichern fehlgeschlagen");
    patch.version = version;
  }
  const { error } = await SB.from("blog_articles")
    .update({ ...patch, job, updated_at: jetzt })
    .eq("id", article.id);
  if (error) return fehler(500, "Speichern fehlgeschlagen");
  await blogEvent(article.project_id, "article.edited", { felder }, ctx.userId, article.id);
  return ok({ geaendert: felder, version });
}

// ── WordPress ───────────────────────────────────────────────────────────────

const WP_LIVE = ["publish", "future", "private"];

async function wpStand(conn: { siteUrl: string; key: string }, postId: number) {
  const r = await ezrRequest<any>(conn, "GET", `/posts/${postId}`);
  if (r.ok)
    return {
      gefunden: true as const,
      status: String(r.data?.status || ""),
      permalink: (r.data?.permalink as string) ?? null,
      edit_url: (r.data?.edit_url as string) ?? null,
      modified: (r.data?.modified as string) ?? null,
    };
  // ezrRequest ordnet jedes 404 dem fehlenden Plugin zu; hier heisst es: Beitrag weg.
  if (r.status === 404) return { gefunden: false as const };
  return { fehler: `WordPress: ${r.code} – ${r.message}` };
}

/** Status des Entwurfs in WordPress holen; ein veröffentlichter neuer Artikel wird «live». */
export async function pruefeWpStatus(r: Rahmen): Promise<Antwort> {
  const { article, project, ctx } = r;
  if (!article.wp_post_id) return fehler(409, "Zu diesem Artikel gibt es keinen WordPress-Entwurf");
  const wp = await wpVerbindung(project.id);
  if (!wp) return fehler(409, "WordPress ist nicht verbunden");
  const stand = await wpStand(wp.conn, Number(article.wp_post_id));
  if ("fehler" in stand) return fehler(502, stand.fehler!);
  const jetzt = new Date().toISOString();
  if (!stand.gefunden) {
    await SB.from("blog_articles")
      .update({
        job: {
          ...article.job,
          wordpress: { ...article.job?.wordpress, status: "fehlt", geprueft_at: jetzt },
        },
      })
      .eq("id", article.id);
    return ok({
      wp: null,
      status: article.status,
      hinweis: "Der Beitrag wurde in WordPress nicht gefunden (gelöscht oder verschoben).",
    });
  }
  const patch: Record<string, unknown> = {
    job: {
      ...article.job,
      wordpress: { ...article.job?.wordpress, status: stand.status, geprueft_at: jetzt },
    },
  };
  if (stand.permalink) patch.wp_permalink = stand.permalink;
  if (stand.edit_url) patch.wp_edit_url = stand.edit_url;
  let status = article.status as string;
  const wirdLive =
    stand.status === "publish" &&
    modusVon(article) === "neu" &&
    ["entwurf_wp", "kunde_freigegeben"].includes(status);
  if (wirdLive) {
    status = "live";
    patch.status = "live";
    patch.published_at = stand.modified || jetzt;
    patch.updated_at = jetzt;
  }
  await SB.from("blog_articles").update(patch).eq("id", article.id);
  if (wirdLive)
    await blogEvent(
      article.project_id,
      "article.published",
      { wp_post_id: article.wp_post_id, weg: "wordpress" },
      ctx.userId,
      article.id,
    );
  return ok({
    wp: {
      status: stand.status,
      permalink: stand.permalink,
      edit_url: stand.edit_url,
      modified: stand.modified,
    },
    status,
    ...(WP_LIVE.includes(stand.status) && modusVon(article) === "refresh"
      ? {
          hinweis:
            "Die Überarbeitung ist in WordPress als eigener Beitrag veröffentlicht. Vorgesehen ist, den Inhalt in den bestehenden Beitrag zu übernehmen: sonst steht der Artikel doppelt online.",
        }
      : {}),
  });
}

/** «Änderungen an WordPress senden»: gleicher Entwurf (external_id), Kommentare und Pings bleiben zu. */
export async function sendeAenderungen(r: Rahmen): Promise<Antwort> {
  const { article, project, ctx } = r;
  if (!istAgentur(ctx)) return fehler(403, "Nur für Ezy One");
  if (nurHub(article, project))
    return fehler(409, "Dieser Artikel bleibt im Hub, es gibt keinen WordPress-Entwurf");
  if (article.status === "faktencheck") return fehler(409, "Zuerst den Faktencheck abschliessen");
  if (article.status !== "entwurf_wp")
    return fehler(
      409,
      article.status === "kunde_freigegeben" || article.status === "live"
        ? "Nach der Freigabe werden Änderungen direkt in WordPress gemacht"
        : "Der Artikel ist noch nicht fertig geschrieben",
    );
  const wp = await wpVerbindung(project.id);
  if (!wp) return fehler(409, "WordPress ist nicht verbunden");
  let wpStatus = "draft";
  if (article.wp_post_id) {
    // Das Plugin überschreibt beim Upsert auch veröffentlichte Beiträge: vorher prüfen.
    const stand = await wpStand(wp.conn, Number(article.wp_post_id));
    if ("fehler" in stand) return fehler(502, stand.fehler!);
    if (stand.gefunden && WP_LIVE.includes(stand.status))
      return fehler(
        409,
        "Der Beitrag ist in WordPress bereits veröffentlicht. Änderungen bitte direkt in WordPress machen.",
      );
    // Ein bestehender Entwurf behält seinen Status (z. B. «pending»).
    if (stand.gefunden && stand.status) wpStatus = stand.status;
  }
  let out: Awaited<ReturnType<typeof sendeAnWordpress>>;
  try {
    out = await sendeAnWordpress(article, project);
  } catch (e) {
    return fehler(502, e instanceof Error ? e.message : "WordPress nicht erreichbar");
  }
  const jetzt = new Date().toISOString();
  await SB.from("blog_articles")
    .update({
      wp_post_id: out.wp_post_id ?? article.wp_post_id,
      wp_edit_url: out.wp_edit_url ?? article.wp_edit_url,
      wp_permalink: out.wp_permalink ?? article.wp_permalink,
      job: {
        ...article.job,
        wordpress: { bild_gesendet: out.bild_gesendet, at: jetzt, status: wpStatus },
      },
      updated_at: jetzt,
    })
    .eq("id", article.id);
  await blogEvent(
    article.project_id,
    "article.wp_synced",
    { wp_post_id: out.wp_post_id ?? article.wp_post_id, version: article.version ?? 1 },
    ctx.userId,
    article.id,
  );
  return ok({
    wp_post_id: out.wp_post_id ?? article.wp_post_id,
    wp_edit_url: out.wp_edit_url ?? article.wp_edit_url,
    gesendet_at: jetzt,
  });
}

// ── Prüfung und Freigabe ────────────────────────────────────────────────────

export const FreigabeBody = z
  .object({ action: z.enum(["review", "review_zurueck", "approve", "erledigt"]) })
  .strict();

function freigabeHinweis(article: any, project: any): string {
  const modus = modusVon(article);
  if (modus === "vorschlag")
    return "Vorschlag freigegeben. Ezy One setzt die Änderungen auf der Seite um.";
  if (modus === "refresh")
    return project.publish_mode === "hub_only" || !article.wp_post_id
      ? "Freigegeben. Der überarbeitete Text wird von Hand in den bestehenden Beitrag übernommen."
      : "Freigegeben. Die Überarbeitung liegt als Entwurf in WordPress: Inhalt in den bestehenden Beitrag übernehmen.";
  if (nurHub(article, project) || !article.wp_post_id)
    return "Freigegeben. Der Artikel liegt im Hub und wird von Hand in WordPress übernommen.";
  return "Freigegeben. Bitte in WordPress veröffentlichen.";
}

/**
 * Reihenfolge (Entscheid Ezy One): zuerst prüft Ezy One («review»), dann gibt
 * der Kunde frei («approve»). Ezy One darf auch im Namen des Kunden freigeben.
 */
export async function freigabe(
  r: Rahmen,
  action: z.infer<typeof FreigabeBody>["action"],
): Promise<Antwort> {
  const { article, project, ctx } = r;
  const agentur = istAgentur(ctx);
  const jetzt = new Date().toISOString();
  const job = article.job ?? {};
  const speichere = (patch: Record<string, unknown>) =>
    SB.from("blog_articles")
      .update({ ...patch, updated_at: jetzt })
      .eq("id", article.id);

  if (action === "review" || action === "review_zurueck") {
    if (!agentur) return fehler(403, "Nur für Ezy One");
    if (article.status !== "entwurf_wp")
      return fehler(409, "Geprüft werden kann nur ein fertiger Entwurf");
    // Sonst sähe der Kunde im Hub einen anderen Text als in WordPress.
    if (action === "review" && ungesendet(article, project))
      return fehler(409, "Zuerst die Änderungen an WordPress senden");
    const review = action === "review" ? { at: jetzt, by: ctx.userId } : null;
    await speichere({ job: { ...job, review } });
    await blogEvent(
      article.project_id,
      action === "review" ? "article.reviewed" : "article.review_withdrawn",
      null,
      ctx.userId,
      article.id,
    );
    return ok({ status: article.status, review });
  }

  if (action === "erledigt") {
    if (!agentur) return fehler(403, "Nur für Ezy One");
    if (article.status !== "kunde_freigegeben")
      return fehler(409, "Erst nach der Freigabe möglich");
    await speichere({ status: "live", published_at: jetzt });
    await blogEvent(
      article.project_id,
      "article.published",
      { wp_post_id: article.wp_post_id ?? null, weg: "manuell" },
      ctx.userId,
      article.id,
    );
    return ok({ status: "live" });
  }

  // approve
  if (article.status !== "entwurf_wp")
    return fehler(
      409,
      article.status === "faktencheck"
        ? "Zuerst den Faktencheck abschliessen"
        : "Der Artikel ist bereits freigegeben oder noch nicht fertig",
    );
  if (!agentur && !job.review) return fehler(403, "Ezy One prüft den Artikel noch");
  if (ungesendet(article, project))
    return fehler(
      409,
      agentur
        ? "Zuerst die Änderungen an WordPress senden"
        : "Ezy One überträgt noch Änderungen nach WordPress. Bitte später nochmals versuchen.",
    );
  const freigabeInfo = { at: jetzt, by: ctx.userId, rolle: agentur ? "agentur" : "kunde" };
  const wp =
    article.wp_post_id && !nurHub(article, project) ? await wpVerbindung(project.id) : null;
  let hinweis = freigabeHinweis(article, project);

  if (wp && kannVeroeffentlichen(article, project, wp.scopes)) {
    const pub = await ezrRequest<any>(wp.conn, "POST", `/posts/${article.wp_post_id}/publish`, {});
    if (pub.ok) {
      await speichere({
        status: "live",
        published_at: jetzt,
        wp_permalink: pub.data?.permalink ?? article.wp_permalink,
        job: {
          ...job,
          freigabe: freigabeInfo,
          wordpress: {
            ...job.wordpress,
            status: String(pub.data?.status || "publish"),
            geprueft_at: jetzt,
          },
        },
      });
      await blogEvent(
        article.project_id,
        "article.approved",
        { rolle: freigabeInfo.rolle },
        ctx.userId,
        article.id,
      );
      await blogEvent(
        article.project_id,
        "article.published",
        { wp_post_id: article.wp_post_id, weg: "freigabe" },
        ctx.userId,
        article.id,
      );
      return ok({
        status: "live",
        permalink: pub.data?.permalink ?? article.wp_permalink ?? null,
        hinweis: "Freigegeben und in WordPress veröffentlicht.",
      });
    }
    hinweis = `Freigegeben. Das Veröffentlichen in WordPress hat nicht geklappt (${pub.message}): bitte dort veröffentlichen.`;
  }

  await speichere({ status: "kunde_freigegeben", job: { ...job, freigabe: freigabeInfo } });
  await blogEvent(
    article.project_id,
    "article.approved",
    { rolle: freigabeInfo.rolle },
    ctx.userId,
    article.id,
  );
  return ok({ status: "kunde_freigegeben", hinweis });
}

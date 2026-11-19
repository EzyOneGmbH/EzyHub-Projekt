// Blog-Autopilot: Artikel exportieren (PDF über den Druckdialog, Word, WordPress-
// Importdatei). Reine Funktionen ohne DOM: Sie erwarten bereits gesäubertes HTML
// (siehe sicheresHtml in BlogArtikel.tsx) und bauen daraus die Dateien.

export type ExportArtikel = {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  focus_keyword?: string | null;
  tags?: string[] | null;
  /** Bereits gesäubertes HTML des Artikels. */
  html: string;
  bild?: { url: string; alt?: string | null } | null;
};

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Markierungen des Faktenchecks gehören nicht in den Export. */
export const ohneMarken = (html: string): string =>
  String(html || "").replace(/<\/?span\b[^>]*>/gi, "");

const cdata = (s: unknown): string =>
  `<![CDATA[${String(s ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export function exportSlug(a: Pick<ExportArtikel, "slug" | "title">): string {
  const roh = (a.slug || a.title || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return roh || "artikel";
}

const DRUCK_STIL = `
@page{margin:22mm 20mm}
body{font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.55;color:#1a1a1a;margin:0}
h1{font-family:Arial,Helvetica,sans-serif;font-size:22pt;line-height:1.2;margin:0 0 10pt}
h2{font-family:Arial,Helvetica,sans-serif;font-size:15pt;line-height:1.25;margin:20pt 0 6pt;page-break-after:avoid}
h3{font-family:Arial,Helvetica,sans-serif;font-size:12.5pt;margin:14pt 0 4pt;page-break-after:avoid}
h4{font-family:Arial,Helvetica,sans-serif;font-size:11.5pt;margin:12pt 0 4pt;page-break-after:avoid}
p{margin:0 0 9pt}
ul,ol{margin:0 0 9pt;padding-left:18pt}
li{margin:0 0 3pt}
a{color:#1a1a1a;text-decoration:underline}
blockquote{margin:0 0 9pt;padding-left:10pt;border-left:2pt solid #bbb;color:#444}
img{max-width:100%;height:auto}
figure{margin:0 0 9pt}
figcaption{font-size:9pt;color:#555}
table{border-collapse:collapse;margin:0 0 9pt;font-size:10pt;width:100%}
th,td{border:1px solid #999;padding:4pt 6pt;text-align:left;vertical-align:top}
tr,img,blockquote{page-break-inside:avoid}
summary{font-weight:bold}
.lead{font-size:12.5pt;color:#444;margin:0 0 14pt}
table.breit{font-family:Arial,Helvetica,sans-serif;font-size:8pt;line-height:1.3}
table.breit th,table.breit td{padding:3pt 4pt}
`;

/** Tabellen ab 6 Spalten bekommen im Druck eine kleinere Schrift, sonst werden
 *  die Zellen auf A4 hoch so schmal, dass der Text in jeder Zelle umbricht. */
export function markiereBreiteTabellen(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/gi, (ganz, innen: string) => {
    const zeile = /<tr[\s>][\s\S]*?<\/tr>/i.exec(innen)?.[0] ?? "";
    const spalten = (zeile.match(/<t[hd][\s>]/gi) ?? []).length;
    return spalten >= 6 ? `<table class="breit">${innen}</table>` : ganz;
  });
}

/** Vollständiges HTML-Dokument: Grundlage für den PDF-Druck und die Word-Datei. */
export function alsDokument(a: ExportArtikel, fuerWord = false): string {
  const bild =
    a.bild && /^https:\/\//i.test(a.bild.url)
      ? `<p><img src="${esc(a.bild.url)}" alt="${esc(a.bild.alt)}"></p>`
      : "";
  const kopf = fuerWord
    ? `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="de">`
    : `<!doctype html><html lang="de">`;
  const wordXml = fuerWord
    ? `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`
    : "";
  // Im geöffneten <details> steht der ganze Text: Word und der Druck kennen kein Aufklappen.
  const text = markiereBreiteTabellen(ohneMarken(a.html)).replace(/<details>/gi, "<details open>");
  return (
    `${kopf}<head><meta charset="utf-8"><title>${esc(a.title)}</title>${wordXml}` +
    `<style>${DRUCK_STIL}</style></head><body>` +
    `<h1>${esc(a.title)}</h1>` +
    (a.excerpt ? `<p class="lead">${esc(a.excerpt)}</p>` : "") +
    bild +
    text +
    `</body></html>`
  );
}

/** WordPress-Importdatei (WXR 1.2) für Werkzeuge → Daten importieren → WordPress.
 *  Der Beitrag kommt als Entwurf an, Kommentare und Pings sind geschlossen. */
export function alsWxr(a: ExportArtikel): string {
  const meta: [string, string | null | undefined][] = [
    ["_yoast_wpseo_title", a.seo_title],
    ["_yoast_wpseo_metadesc", a.meta_description],
    ["_yoast_wpseo_focuskw", a.focus_keyword],
    ["rank_math_title", a.seo_title],
    ["rank_math_description", a.meta_description],
    ["rank_math_focus_keyword", a.focus_keyword],
  ];
  const metaXml = meta
    .filter(([, wert]) => !!wert)
    .map(
      ([key, wert]) =>
        `<wp:postmeta><wp:meta_key>${cdata(key)}</wp:meta_key><wp:meta_value>${cdata(wert)}</wp:meta_value></wp:postmeta>`,
    )
    .join("\n      ");
  const tags = (a.tags ?? [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map(
      (t) =>
        `<category domain="post_tag" nicename="${esc(exportSlug({ title: t }))}">${cdata(t)}</category>`,
    )
    .join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>${esc(a.title)}</title>
    <language>de</language>
    <wp:wxr_version>1.2</wp:wxr_version>
    <item>
      <title>${cdata(a.title)}</title>
      <content:encoded>${cdata(ohneMarken(a.html))}</content:encoded>
      <excerpt:encoded>${cdata(a.excerpt)}</excerpt:encoded>
      <wp:post_name>${cdata(exportSlug(a))}</wp:post_name>
      <wp:status>${cdata("draft")}</wp:status>
      <wp:post_type>${cdata("post")}</wp:post_type>
      <wp:comment_status>${cdata("closed")}</wp:comment_status>
      <wp:ping_status>${cdata("closed")}</wp:ping_status>
      <wp:post_parent>0</wp:post_parent>
      <wp:menu_order>0</wp:menu_order>
      <wp:is_sticky>0</wp:is_sticky>
      ${tags}
      ${metaXml}
    </item>
  </channel>
</rss>
`;
}

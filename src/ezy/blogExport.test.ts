import { describe, expect, it } from "vitest";
import { alsDokument, alsWxr, exportSlug, ohneMarken } from "@/ezy/blogExport";

const artikel = {
  title: 'Seminarhotel & Tagung: "Worauf" es ankommt',
  slug: null,
  excerpt: "Kurz <erklärt>",
  seo_title: "Seminarhotel Zug",
  meta_description: "Alles zur Tagung.",
  focus_keyword: "seminarhotel zug",
  tags: ["Tagung", " "],
  html: '<h2 id="a">Räume</h2><p>Text <span data-claim="3">mit Marke</span> ]]> Ende</p><details><summary>Frage</summary><p>Antwort</p></details>',
};

describe("blogExport", () => {
  it("entfernt Faktencheck-Marken, behält den Text", () => {
    expect(ohneMarken(artikel.html)).toContain("Text mit Marke ]]> Ende");
    expect(ohneMarken(artikel.html)).not.toContain("span");
  });

  it("bildet einen Dateinamen aus Slug oder Titel", () => {
    expect(exportSlug(artikel)).toBe("seminarhotel-tagung-worauf-es-ankommt");
    expect(exportSlug({ slug: "mein-slug", title: "x" })).toBe("mein-slug");
    expect(exportSlug({ title: "Über Größe" })).toBe("ueber-groesse");
    expect(exportSlug({ title: "???" })).toBe("artikel");
  });

  it("baut ein Dokument mit maskiertem Titel und offenen Details", () => {
    const d = alsDokument(artikel);
    expect(d.startsWith("<!doctype html>")).toBe(true);
    expect(d).toContain("<h1>Seminarhotel &amp; Tagung: &quot;Worauf&quot; es ankommt</h1>");
    expect(d).toContain('<p class="lead">Kurz &lt;erklärt&gt;</p>');
    expect(d).toContain("<details open>");
    expect(d).not.toContain("data-claim");
    expect(alsDokument(artikel, true)).toContain("urn:schemas-microsoft-com:office:word");
  });

  it("nimmt nur https-Bilder ins Dokument", () => {
    expect(alsDokument({ ...artikel, bild: { url: "https://x.ch/a.jpg", alt: "A" } })).toContain(
      '<img src="https://x.ch/a.jpg" alt="A">',
    );
    expect(alsDokument({ ...artikel, bild: { url: "http://x.ch/a.jpg" } })).not.toContain("<img");
  });

  it("baut eine WXR-Datei als Entwurf mit geschlossenen Kommentaren und Pings", () => {
    const x = alsWxr(artikel);
    expect(x).toContain("<wp:wxr_version>1.2</wp:wxr_version>");
    expect(x).toContain("<wp:status><![CDATA[draft]]></wp:status>");
    expect(x).toContain("<wp:comment_status><![CDATA[closed]]></wp:comment_status>");
    expect(x).toContain("<wp:ping_status><![CDATA[closed]]></wp:ping_status>");
    expect(x).toContain("<wp:post_name><![CDATA[seminarhotel-tagung-worauf-es-ankommt]]>");
    expect(x).toContain("<wp:meta_key><![CDATA[_yoast_wpseo_metadesc]]></wp:meta_key>");
    expect(x).toContain("<wp:meta_key><![CDATA[rank_math_focus_keyword]]></wp:meta_key>");
    expect(x).toContain(
      '<category domain="post_tag" nicename="tagung"><![CDATA[Tagung]]></category>',
    );
    expect(x.match(/domain="post_tag"/g)?.length).toBe(1);
    // «]]>» im Text darf den CDATA-Block nicht beenden.
    expect(x).toContain("]]]]><![CDATA[> Ende");
    expect(x).not.toContain("data-claim");
  });

  it("lässt leere SEO-Felder weg", () => {
    const x = alsWxr({ title: "Nur Titel", html: "<p>a</p>" });
    expect(x).not.toContain("wp:postmeta");
  });
});

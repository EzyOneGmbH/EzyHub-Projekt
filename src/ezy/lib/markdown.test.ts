// XSS- und Verhaltens-Tests für den Markdown-Konverter (2026-08-18).
import { describe, expect, it } from "vitest";
import { escapeHtml, markdownToHtml, sanitizeHref } from "./markdown";

describe("escapeHtml", () => {
  it("escaped alle HTML-Sonderzeichen", () => {
    expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;",
    );
  });
});

describe("sanitizeHref (erlaubnisbasiert)", () => {
  it("erlaubt http(s), mailto und relative Pfade", () => {
    expect(sanitizeHref("https://ezyone.ch/x")).toBe("https://ezyone.ch/x");
    expect(sanitizeHref("http://ezyone.ch")).toBe("http://ezyone.ch");
    expect(sanitizeHref("mailto:info@ezyone.ch")).toBe("mailto:info@ezyone.ch");
    expect(sanitizeHref("/intern/seite")).toBe("/intern/seite");
  });
  it("neutralisiert javascript:, data: und alles Unbekannte zu #", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBe("#");
    expect(sanitizeHref("  JAVASCRIPT:alert(1)")).toBe("#");
    expect(sanitizeHref("data:text/html;base64,PHNjcmlwdD4=")).toBe("#");
    expect(sanitizeHref("vbscript:msgbox")).toBe("#");
    expect(sanitizeHref("")).toBe("#");
  });
});

describe("markdownToHtml (XSS)", () => {
  it("escaped eingebettetes HTML statt es auszuführen", () => {
    const html = markdownToHtml(`Hallo <img src=x onerror=alert(1)> Welt`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("escaped Script-Tags in Überschriften und Listen", () => {
    const html = markdownToHtml(`# <script>x</script>\n- <b>fett</b>`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<h1>&lt;script&gt;x&lt;/script&gt;</h1>");
  });
  it("sanitized javascript:-Links zu #", () => {
    const html = markdownToHtml(`[klick](javascript:alert(1))`);
    expect(html).toContain('<a href="#">klick</a>');
    expect(html).not.toContain("javascript:");
  });
  it("behält erlaubte Links und escaped den Linktext", () => {
    const html = markdownToHtml(`[<i>label</i>](https://ezyone.ch)`);
    expect(html).toContain('<a href="https://ezyone.ch">&lt;i&gt;label&lt;/i&gt;</a>');
  });
  it("verhindert Attribut-Ausbruch über Anführungszeichen im Linkziel", () => {
    const html = markdownToHtml(`[x](https://a.ch/" onmouseover="alert(1))`);
    // Anführungszeichen sind escaped, bevor der Link-Regex läuft — kein Ausbruch möglich.
    expect(html).not.toContain('" onmouseover="');
  });
});

describe("markdownToHtml (Struktur)", () => {
  it("rendert Überschriften, Listen, Bold/Code", () => {
    const html = markdownToHtml(`## Titel\n- eins\n- **zwei**\n1. drei\n\nAbsatz \`code\``);
    expect(html).toContain("<h2>Titel</h2>");
    expect(html).toContain("<ul>\n<li>eins</li>\n<li><strong>zwei</strong></li>\n</ul>");
    expect(html).toContain("<ol>\n<li>drei</li>\n</ol>");
    expect(html).toContain("<p>Absatz <code>code</code></p>");
  });
  it("liefert leeren String für leere Eingabe", () => {
    expect(markdownToHtml("")).toBe("");
  });
});

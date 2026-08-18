// Markdown-Helfer (EzyRank-Architektur 2026-08-18): aus EzyOneApp.jsx extrahiert,
// damit Escaping/Sanitizing testbar sind (XSS-Testfälle in markdown.test.ts).
// Verhalten UNVERAENDERT gegenüber dem Monolith-Stand — nur verschoben.

/** HTML-Escaping für Attribut- und Textkontext. */
export function escapeHtml(s = ""): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Erlaubnisbasiert: nur http(s), mailto und relative Pfade — alles andere wird "#". */
export function sanitizeHref(href = ""): string {
  const v = href.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(v) ? v : "#";
}

/**
 * Minimaler block-level Markdown→HTML-Konverter (WordPress-Publish + In-App-
 * Rendering via MdView/.ezy-md). Escaped ZUERST das komplette HTML, wandelt
 * danach nur bekannte Markdown-Muster zurück; Link-Hrefs laufen durch sanitizeHref.
 */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      // Quote-Escaping im Href (Fix 2026-08-18): esc() escaped keine
      // Anführungszeichen — ein `"` in einem ERLAUBTEN https-Link könnte sonst
      // aus dem href-Attribut ausbrechen (onmouseover=...). Nur `"` escapen,
      // damit &-haltige URLs nicht doppelt escaped werden (& ist schon &amp;).
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label, href) => `<a href="${sanitizeHref(href).replace(/"/g, "&quot;")}">${label}</a>`,
      );
  const lines = String(md || "").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^### (.+)/.test(line)) {
      closeList();
      out.push(`<h3>${inline(line.replace(/^### /, ""))}</h3>`);
    } else if (/^## (.+)/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.replace(/^## /, ""))}</h2>`);
    } else if (/^# (.+)/.test(line)) {
      closeList();
      out.push(`<h1>${inline(line.replace(/^# /, ""))}</h1>`);
    } else if (/^- (.+)/.test(line)) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(line.replace(/^- /, ""))}</li>`);
    } else if (/^\d+\. (.+)/.test(line)) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(line.replace(/^\d+\. /, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

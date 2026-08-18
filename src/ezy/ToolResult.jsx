// ToolResult (EzyRank-Architektur 2026-08-18): lesbare Darstellung eines
// Tool-Ergebnisses. Nutzt die zentrale Normalisierung (data/toolResult.ts) —
// bevorzugt Markdown-Inhalt, zeigt Rohdaten NUR unter "Technische Details",
// schneidet NIE ab. HTML wird escaped, Links laufen durch sanitizeHref
// (beides in lib/markdown.ts, XSS-getestet). Eigene Datei statt Monolith:
// kleiner Diff, wiederverwendbar, keine Konflikte mit parallelen Sessions.
import { useMemo } from "react";
import { markdownToHtml } from "@/ezy/lib/markdown";
import { normalizeToolResult } from "@/ezy/data/toolResult";

// Ezy One CD (Light Studio) — Teilmenge der EzyOneApp-Palette, Werte identisch.
const C = {
  card: "#ffffff",
  border: "#eae4ee",
  text: "#161217",
  textMuted: "#6d6473",
  red: "#dc2626",
};

/** Formatiertes Markdown — Styles kommen aus der globalen .ezy-md-Klasse. */
export function MdView({ md }) {
  const html = useMemo(() => markdownToHtml(md), [md]);
  return <div className="ezy-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Ergebnis-Ansicht eines Tool-Laufs.
 * result: { ok, liveConnected, message, data, error } (ToolRunResult).
 * Liefert ausserdem die Normalisierung an den Aufrufer weiter (children-frei).
 */
export default function ToolResultView({ result }) {
  const norm = useMemo(
    () =>
      result?.ok
        ? normalizeToolResult(result.data)
        : { text: null, raw: result?.data, hasStructured: false },
    [result],
  );
  return (
    <div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          maxHeight: "48vh",
          overflow: "auto",
        }}
      >
        {result?.liveConnected ? (
          result.ok ? (
            norm.text ? (
              <MdView md={norm.text} />
            ) : norm.hasStructured ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>
                Strukturiertes Ergebnis ohne Fliesstext — Details unten unter «Technische Details».
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.text, whiteSpace: "pre-wrap" }}>
                {String(result.message || "OK")}
              </div>
            )
          ) : (
            <div style={{ fontSize: 13, color: C.red, whiteSpace: "pre-wrap" }}>
              {result.error || result.message || "Fehler"}
            </div>
          )
        ) : (
          <div style={{ fontSize: 13, color: C.text }}>
            Dieses Tool ist noch nicht an eine Live-API angebunden. Es wurde kein Lauf gespeichert.
          </div>
        )}
      </div>
      {result?.ok && norm.hasStructured && (
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{ cursor: "pointer", fontSize: 12, color: C.textMuted, userSelect: "none" }}
          >
            Technische Details (Rohdaten)
          </summary>
          <pre
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: 12,
              marginTop: 8,
              fontSize: 11.5,
              color: C.textMuted,
              maxHeight: 260,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
            }}
          >
            {JSON.stringify(norm.raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

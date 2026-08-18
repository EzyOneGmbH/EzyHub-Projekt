// ToolActions (EzyRank-Architektur 2026-08-18): Aktionszeile unter einem
// Tool-Ergebnis — Kopieren, Markdown-Download, Als Entwurf speichern,
// Weiterbearbeiten (öffnet den gespeicherten Entwurf im Content-Editor) und
// Übergabe an den WordPress-Publish-Flow. Kopieren/Download sind hier
// gekapselt; Persistenz-/Navigations-Callbacks kommen vom Aufrufer.
import { Copy, Download, FileText, Globe, PenTool } from "lucide-react";

const C = {
  card: "#ffffff",
  border: "#eae4ee",
  text: "#161217",
  accent: "#77008C",
};

function ActionBtn({ icon: Icon, onClick, disabled, children, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 8,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        background: primary ? "linear-gradient(135deg,#71008B,#B9009C)" : C.card,
        color: primary ? "#fff" : C.text,
        border: primary ? "none" : `1px solid ${C.border}`,
      }}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function download(content, type, filename) {
  const b = new Blob([content], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 0);
}

/**
 * props:
 *  text: lesbarer Markdown-Inhalt (null → nur Kopieren/Download der Rohdaten)
 *  raw: Originalpayload (Fallback für Kopieren/Download)
 *  filename: Dateiname für den Markdown-Download
 *  notify(msg, type): Toast des Aufrufers
 *  onSaveDraft(): speichert als Content-Entwurf — Button erscheint nur, wenn gesetzt
 *  draftState: { saved: boolean, saving: boolean }
 *  onOpenEditor(): Weiterbearbeiten — erscheint erst NACH dem Speichern
 *  onWordPress(): öffnet den Publish-Flow — erscheint nur, wenn gesetzt
 *  onClose(): schliesst den Dialog
 */
export default function ToolActions({
  text,
  raw,
  filename = "ergebnis.md",
  notify,
  onSaveDraft,
  draftState = { saved: false, saving: false },
  onOpenEditor,
  onWordPress,
  onClose,
}) {
  const payload = text || (raw != null ? JSON.stringify(raw, null, 2) : "");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      notify?.("Ergebnis kopiert", "success");
    } catch {
      notify?.("Kopieren fehlgeschlagen", "error");
    }
  };
  const downloadMd = () => {
    const body = text || `\`\`\`json\n${payload}\n\`\`\`\n`;
    download(body, "text/markdown", filename);
    notify?.("Markdown heruntergeladen", "success");
  };
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
      {payload && (
        <ActionBtn icon={Copy} onClick={copy}>
          Kopieren
        </ActionBtn>
      )}
      <ActionBtn icon={Download} onClick={downloadMd}>
        Markdown herunterladen
      </ActionBtn>
      {text && onSaveDraft && !draftState.saved && (
        <ActionBtn icon={FileText} onClick={onSaveDraft} disabled={draftState.saving}>
          {draftState.saving ? "Speichere…" : "Als Entwurf speichern"}
        </ActionBtn>
      )}
      {draftState.saved && onOpenEditor && (
        <ActionBtn icon={PenTool} onClick={onOpenEditor} primary>
          Im Editor weiterbearbeiten
        </ActionBtn>
      )}
      {text && onWordPress && (
        <ActionBtn icon={Globe} onClick={onWordPress}>
          An WordPress übergeben
        </ActionBtn>
      )}
      {onClose && <ActionBtn onClick={onClose} primary={!draftState.saved}>Schliessen</ActionBtn>}
    </div>
  );
}

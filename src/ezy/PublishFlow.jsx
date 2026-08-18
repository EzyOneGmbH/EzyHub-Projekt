// PublishFlow (EzyRank-Architektur 2026-08-18): WordPress-Publish-Dialog,
// aus EzyOneApp.jsx extrahiert und ausgebaut. Durchgehender Ablauf:
// Tool-Ergebnis → Content-Entwurf → Editor → WordPress-VORSCHAU → Veröffentlichen.
// Schutz: Standard bleibt "Entwurf"; "Sofort veröffentlichen" verlangt einen
// expliziten Bestätigungshaken. Fehler werden verständlich übersetzt.
// Kein useToast-Import aus dem Monolithen (zirkulär) — notify kommt als Prop.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Eye, Globe, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { markdownToHtml } from "@/ezy/lib/markdown";

const C = {
  card: "#ffffff",
  surface: "#faf8fb",
  border: "#eae4ee",
  text: "#161217",
  textMuted: "#6d6473",
  textDim: "#a49dab",
  accent: "#77008C",
  accentLight: "#9b4dab",
  green: "#0f9d6c",
  orange: "#d97706",
};

// Verstaendliche Fehlertexte statt roher HTTP-/API-Meldungen.
export function friendlyWpError(msg) {
  const m = String(msg || "");
  if (
    /401|403|unauthorized|forbidden|incorrect_password|invalid_username|application password/i.test(
      m,
    )
  )
    return "WordPress hat die Zugangsdaten abgelehnt (401/403). Application Password im Kunden-Panel (WordPress) prüfen bzw. neu erstellen.";
  if (/404|rest_no_route|not found/i.test(m))
    return "WordPress-REST-API nicht erreichbar (404). Permalinks aktivieren bzw. prüfen, ob die REST-API blockiert ist.";
  if (/timeout|timed out|network|fetch failed|ENOTFOUND|ECONN/i.test(m))
    return "Die WordPress-Website war nicht erreichbar (Netzwerk/Timeout). Später erneut versuchen.";
  return m || "Veröffentlichen fehlgeschlagen";
}

const WP_STATUS_LABEL = {
  draft: "Als Entwurf angelegt",
  publish: "Veröffentlicht",
  pending: "Zur Prüfung eingereicht",
  private: "Privat veröffentlicht",
};

/**
 * props: clientId, defaultTitle, markdown, onClose, notify(msg, type),
 * zIndex (120 im Editor, 300 über dem ToolRunner-Modal).
 */
export default function WordPressPublishModal({
  clientId,
  defaultTitle,
  markdown,
  onClose,
  notify,
  zIndex = 120,
}) {
  const [status, setStatus] = useState("loading"); // loading | none | ready
  const [siteUrl, setSiteUrl] = useState("");
  const [title, setTitle] = useState(defaultTitle || "");
  const [type, setType] = useState("posts");
  const [wpStatus, setWpStatus] = useState("draft"); // Standard bleibt Entwurf
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  // Publish-Schutz (2026-08-18): sofortiges Veröffentlichen nur mit Haken.
  const [confirmPublish, setConfirmPublish] = useState(false);
  const previewHtml = useMemo(() => markdownToHtml(markdown || ""), [markdown]);

  useEffect(() => {
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/wordpress/connection?clientId=${encodeURIComponent(clientId)}`,
          {
            headers: { Authorization: `Bearer ${session?.access_token || ""}` },
          },
        );
        const j = await r.json().catch(() => ({}));
        if (j.connected) {
          setSiteUrl(j.siteUrl || "");
          setStatus("ready");
        } else setStatus("none");
      } catch {
        setStatus("none");
      }
    })();
  }, [clientId]);

  const needsConfirm = wpStatus === "publish" && !confirmPublish;

  const publish = async () => {
    if (!title.trim()) {
      notify?.("Titel erforderlich", "error");
      return;
    }
    if (needsConfirm) return; // Button ist disabled — doppelte Sicherung
    setBusy(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/wordpress/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          type,
          title: title.trim(),
          content: markdownToHtml(markdown),
          status: wpStatus,
          seoTitle: seoTitle.trim() || undefined,
          seoDescription: seoDescription.trim() || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setResult(j);
        notify?.(WP_STATUS_LABEL[wpStatus] || "Gesendet", "success");
        if (j.seoPluginMissing)
          notify?.("Kein SEO-Plugin (Yoast/RankMath) erkannt — SEO-Felder übersprungen", "info");
      } else {
        setError(friendlyWpError(j.error || `HTTP ${r.status}`));
      }
    } catch (e) {
      setError(friendlyWpError(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: C.surface,
          borderRadius: 16,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,.5)",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Globe size={18} color={C.accent} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>
              An WordPress veröffentlichen
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
          >
            <X size={20} color={C.textMuted} />
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {status === "loading" && (
            <div style={{ fontSize: 13, color: C.textDim }}>Prüfe Verbindung…</div>
          )}

          {status === "none" && (
            <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              Für diesen Kunden ist noch keine WordPress-Seite verbunden.
              <div style={{ marginTop: 8, color: C.textDim, fontSize: 12 }}>
                Verbinde sie zuerst im <strong>Kunden-Detail → Onboarding / Verbindungen</strong>.
              </div>
            </div>
          )}

          {status === "ready" && !result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  color: C.textDim,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Ziel: <span style={{ color: C.text }}>{siteUrl}</span>
                </span>
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "none",
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "3px 10px",
                    cursor: "pointer",
                    color: C.accent,
                    fontSize: 11.5,
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                >
                  <Eye size={12} /> {showPreview ? "Vorschau schliessen" : "Vorschau"}
                </button>
              </div>
              {showPreview && (
                <div
                  className="ezy-md"
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 14,
                    maxHeight: 260,
                    overflow: "auto",
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
              <div>
                <label style={labelStyle}>Titel</label>
                <input
                  style={inputStyle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Typ</label>
                  <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="posts">Beitrag</option>
                    <option value="pages">Seite</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Veröffentlichung</label>
                  <select
                    style={inputStyle}
                    value={wpStatus}
                    onChange={(e) => {
                      setWpStatus(e.target.value);
                      setConfirmPublish(false);
                    }}
                  >
                    <option value="draft">Entwurf (empfohlen)</option>
                    <option value="publish">Sofort veröffentlichen</option>
                    <option value="pending">Zur Prüfung</option>
                    <option value="private">Privat</option>
                  </select>
                </div>
              </div>
              {wpStatus === "publish" && (
                <label
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    fontSize: 12.5,
                    color: C.text,
                    background: `${C.orange}14`,
                    border: `1px solid ${C.orange}55`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmPublish}
                    onChange={(e) => setConfirmPublish(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <AlertTriangle
                      size={13}
                      style={{ verticalAlign: "-2px", marginRight: 4 }}
                      color={C.orange}
                    />
                    Der Beitrag geht damit <strong>sofort öffentlich live</strong> auf{" "}
                    {siteUrl || "der Website"}. Ich bin sicher.
                  </span>
                </label>
              )}
              <div>
                <label style={labelStyle}>SEO-Titel (optional)</label>
                <input
                  style={inputStyle}
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="Yoast / RankMath Titel"
                />
              </div>
              <div>
                <label style={labelStyle}>SEO-Beschreibung (optional)</label>
                <textarea
                  style={{ ...inputStyle, resize: "vertical" }}
                  rows={2}
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  placeholder="Meta-Description"
                />
              </div>
              {error && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: "#dc2626",
                    background: "#dc262614",
                    border: "1px solid #dc262655",
                    borderRadius: 10,
                    padding: "10px 12px",
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}

          {result && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              <div
                style={{
                  color: C.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <CheckCircle size={20} /> {WP_STATUS_LABEL[wpStatus] || "Erfolgreich gesendet"}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>Ziel: {siteUrl}</div>
              {result.post?.link && (
                <a
                  href={result.post.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: C.accentLight, fontSize: 13 }}
                >
                  In WordPress ansehen ↗
                </a>
              )}
              {result.seoApplied && (
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  SEO-Felder gesetzt ({result.seoApplied})
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            alignItems: "center",
          }}
        >
          {result ? (
            <button
              onClick={onClose}
              style={{
                background: "linear-gradient(135deg,#71008B,#B9009C)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Schliessen
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                style={{
                  background: C.card,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Abbrechen
              </button>
              {status === "ready" && (
                <button
                  onClick={publish}
                  disabled={busy || !title.trim() || needsConfirm}
                  title={
                    needsConfirm
                      ? "Bestätige zuerst den Haken für sofortiges Veröffentlichen"
                      : undefined
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "linear-gradient(135deg,#71008B,#B9009C)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: busy || !title.trim() || needsConfirm ? "default" : "pointer",
                    opacity: busy || !title.trim() || needsConfirm ? 0.5 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  <Globe size={14} />
                  {busy ? "Sende…" : wpStatus === "publish" ? "Jetzt veröffentlichen" : "Senden"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

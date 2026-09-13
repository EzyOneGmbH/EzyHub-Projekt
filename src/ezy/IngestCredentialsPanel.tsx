import { authedFetch } from "@/lib/authed-fetch";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Verwaltung kundenspezifischer Ingest-Tokens (Security-Runde 3, 13.09.2026).
// Wird im ChatGPT-Ads-Setup (purpose openai_ads) und in der KI-Crawler-Karte
// (purpose ai_crawler) eingebaut. Der Klartext-Token erscheint GENAU EINMAL
// nach dem Erzeugen/Rotieren — er wird nirgends im Browser gespeichert und
// ist fuer Server-zu-Server-Aufrufe (CRM, WordPress) gedacht, nie fuer
// Browser-Code.

type Purpose = "openai_ads" | "ai_crawler";
type Cred = {
  id: string;
  purpose: Purpose;
  token_prefix: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  rotated_from: string | null;
  last_used_at: string | null;
  use_count: number;
};

const ENDPOINT: Record<Purpose, string> = {
  openai_ads: "/api/admin/openai-ads-ingest",
  ai_crawler: "/api/admin/ai-crawler-ingest",
};

function status(c: Cred): { label: string; farbe: string } {
  if (c.revoked_at) return { label: "widerrufen", farbe: "#dc2626" };
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now())
    return { label: "abgelaufen", farbe: "#d97706" };
  return { label: "aktiv", farbe: "#0f9d6c" };
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

export default function IngestCredentialsPanel({
  clientId,
  purpose,
  S,
  isOrgAdmin,
  titel,
  hinweis,
}: {
  clientId: string;
  purpose: Purpose;
  S: Record<string, string>;
  isOrgAdmin: boolean;
  titel?: string;
  hinweis?: string;
}) {
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [label, setLabel] = useState("");
  const [neuerToken, setNeuerToken] = useState<string | null>(null);
  const [bestaetigen, setBestaetigen] = useState<string | null>(null); // Widerruf 2-Schritt

  const api = useCallback(async (init?: RequestInit, query = "") => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await authedFetch(`/api/admin/ingest-credentials${query}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  }, []);

  const laden = useCallback(async () => {
    const j = await api(undefined, `?clientId=${clientId}&purpose=${purpose}`);
    setCreds(j?.ok ? j.credentials : []);
  }, [api, clientId, purpose]);

  useEffect(() => {
    void laden();
  }, [laden]);

  const aktion = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    const j = await api({ method: "POST", body: JSON.stringify({ clientId, ...body }) });
    setBusy(false);
    if (!j?.ok) {
      setMsg(j?.error || "Fehlgeschlagen");
      return;
    }
    if (j.token) setNeuerToken(j.token);
    setBestaetigen(null);
    setLabel("");
    void laden();
  };

  const kopieren = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setMsg("Token kopiert");
    } catch {
      setMsg("Kopieren nicht möglich — bitte manuell markieren");
    }
  };

  const mut = S.mut || "#6d6473";
  const line = S.line || "#eae4ee";
  const app = S.app || "#77008C";

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${line}`, paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{titel || "Ingest-Zugang (Server-Token)"}</div>
      <div style={{ fontSize: 11.5, color: mut, marginTop: 4, lineHeight: 1.5 }}>
        {hinweis ||
          `Kundenspezifischer Token für ${ENDPOINT[purpose]} — nur für Server-zu-Server-Aufrufe (CRM, WordPress), nie in Browser-Code einbauen. Der Token gilt ausschliesslich für diesen Kunden.`}
      </div>

      {neuerToken && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#fff7ed",
            border: "1px solid #fdba74",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, color: "#9a3412", marginBottom: 6 }}>
            Token jetzt sicher ablegen — er wird nie wieder angezeigt.
          </div>
          <code
            style={{
              display: "block",
              wordBreak: "break-all",
              fontSize: 11.5,
              background: "#fff",
              padding: "6px 8px",
              borderRadius: 6,
              border: `1px solid ${line}`,
            }}
          >
            {neuerToken}
          </code>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => kopieren(neuerToken)} style={btn(app)}>
              Kopieren
            </button>
            <button onClick={() => setNeuerToken(null)} style={btnSek(app)}>
              Ausblenden
            </button>
          </div>
        </div>
      )}

      {creds === null ? (
        <div style={{ fontSize: 12, color: mut, marginTop: 8 }}>Lade…</div>
      ) : creds.length === 0 ? (
        <div style={{ fontSize: 12, color: mut, marginTop: 8 }}>Noch kein Token erzeugt.</div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: mut, textAlign: "left" }}>
                {["Token", "Bezeichnung", "Status", "Gültig bis", "Zuletzt genutzt", ""].map(
                  (h) => (
                    <th key={h} style={{ padding: "4px 6px", fontWeight: 600 }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {creds.map((c) => {
                const st = status(c);
                const aktiv = st.label === "aktiv";
                return (
                  <tr key={c.id} style={{ borderTop: `1px solid ${line}` }}>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>
                      {c.token_prefix}…
                    </td>
                    <td style={{ padding: "5px 6px" }}>{c.label || "—"}</td>
                    <td style={{ padding: "5px 6px", color: st.farbe, fontWeight: 700 }}>
                      {st.label}
                    </td>
                    <td style={{ padding: "5px 6px" }}>{fmt(c.expires_at)}</td>
                    <td style={{ padding: "5px 6px" }}>{fmt(c.last_used_at)}</td>
                    <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>
                      {isOrgAdmin && aktiv && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => aktion({ action: "rotate", credentialId: c.id })}
                            style={btnSek(app)}
                            title="Neues Token erzeugen; das alte bleibt 7 Tage gültig"
                          >
                            Rotieren
                          </button>{" "}
                          {bestaetigen === c.id ? (
                            <button
                              disabled={busy}
                              onClick={() => aktion({ action: "revoke", credentialId: c.id })}
                              style={btn("#dc2626")}
                            >
                              Wirklich widerrufen
                            </button>
                          ) : (
                            <button
                              disabled={busy}
                              onClick={() => setBestaetigen(c.id)}
                              style={btnSek("#dc2626")}
                            >
                              Widerrufen
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isOrgAdmin && (
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Bezeichnung (z. B. HubSpot, WordPress)"
            maxLength={80}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: `1px solid ${line}`,
              fontSize: 12,
              fontFamily: "inherit",
              minWidth: 220,
            }}
          />
          <button
            disabled={busy}
            onClick={() => aktion({ action: "create", purpose, label: label || undefined })}
            style={btn(app)}
          >
            {busy ? "…" : "Neues Token erzeugen"}
          </button>
        </div>
      )}
      {msg && (
        <div
          style={{
            fontSize: 12,
            marginTop: 6,
            color: /kopiert/i.test(msg) ? "#0f9d6c" : "#dc2626",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

const btn = (farbe: string): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: "none",
  background: farbe,
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
});
const btnSek = (farbe: string): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${farbe}55`,
  background: "none",
  color: farbe,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
});

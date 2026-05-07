import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

async function authedFetch(url, init = {}) {
  const session = (await supabase.auth.getSession()).data.session;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers });
}

const isUuid = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/** Inline Google panel for the currently selected EZY ONE client. */
export default function GoogleClientPanel({ client, onLog }) {
  const clientId = client?.id || "";
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [gsc, setGsc] = useState(client?.gscSiteUrl || "");
  const [ga4, setGa4] = useState(client?.ga4PropertyId || "");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setGsc(client?.gscSiteUrl || "");
    setGa4(client?.ga4PropertyId || "");
  }, [client?.id, client?.gscSiteUrl, client?.ga4PropertyId]);

  const reload = useCallback(async () => {
    if (!isUuid(clientId)) return;
    try {
      const r = await authedFetch("/api/google/connection", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
      setStatus(await r.json());
    } catch (e) {
      setMsg(String(e?.message || e));
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!isUuid(clientId)) {
    return (
      <div style={{ fontSize: 12, color: "#94a3b8", padding: 12 }}>
        Wähle einen echten Kunden aus, um GSC / GA4 zu verbinden.
      </div>
    );
  }

  const saveProps = async () => {
    setBusy("save");
    setMsg("");
    try {
      const { error } = await supabase
        .from("clients")
        .update({ gsc_property: gsc || null, ga4_property: ga4 || null })
        .eq("id", clientId);
      if (error) throw error;
      setMsg("Properties gespeichert");
      onLog?.({ ok: true, kind: "save", text: "Properties gespeichert" });
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setMsg("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `/api/google/oauth/start?client_id=${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
      const popup = window.open(json.url, "google-oauth", "width=520,height=640");
      const t = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(t);
          await reload();
          setBusy(null);
        }
      }, 800);
    } catch (e) {
      setMsg(e?.message || String(e));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirm("Google-Verbindung wirklich entfernen?")) return;
    setBusy("disc");
    try {
      const r = await authedFetch("/api/google/connection", {
        method: "DELETE",
        body: JSON.stringify({ clientId }),
      });
      const json = await r.json().catch(() => ({}));
      if (!json.ok) throw new Error(json.error || "Fehler");
      await reload();
      setMsg("Getrennt");
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const importGsc = async () => {
    setBusy("import");
    setMsg("");
    try {
      const r = await authedFetch("/api/google/gsc-import", {
        method: "POST",
        body: JSON.stringify({ clientId, days: 28, rowLimit: 50 }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "Fehler");
      setMsg(`${json.imported} Keywords importiert`);
      onLog?.({ ok: true, kind: "import", text: `${json.imported} Keywords importiert` });
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const ga4Run = async () => {
    setBusy("ga4");
    setMsg("");
    try {
      const r = await authedFetch("/api/google/ga4-summary", {
        method: "POST",
        body: JSON.stringify({ clientId, days: 28 }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "Fehler");
      const m = json.metrics || {};
      setMsg(`Sessions ${m.sessions ?? "?"} · Users ${m.totalUsers ?? "?"}`);
      onLog?.({ ok: true, kind: "ga4", text: "GA4 Summary geladen" });
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "inherit",
  };
  const btn = (extra = {}) => ({
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    ...extra,
  });

  return (
    <div
      style={{
        background: "#0b1220",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
          Google für {client.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: status?.connected ? "#22c55e" : "#94a3b8",
            border: "1px solid #1e293b",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          {status?.connected ? `Verbunden${status.email ? ` · ${status.email}` : ""}` : "Nicht verbunden"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>GSC Property</div>
          <input
            value={gsc}
            onChange={(e) => setGsc(e.target.value)}
            placeholder="sc-domain:example.com"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>GA4 Property ID</div>
          <input
            value={ga4}
            onChange={(e) => setGa4(e.target.value)}
            placeholder="properties/123456789"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={saveProps} disabled={!!busy} style={btn()}>
          {busy === "save" ? "…" : "Properties speichern"}
        </button>
        {status?.connected ? (
          <>
            <button onClick={importGsc} disabled={!!busy} style={btn({ background: "#1d4ed8", borderColor: "#1d4ed8" })}>
              {busy === "import" ? "…" : "GSC importieren"}
            </button>
            <button onClick={ga4Run} disabled={!!busy} style={btn()}>
              {busy === "ga4" ? "…" : "GA4 Summary"}
            </button>
            <button onClick={disconnect} disabled={!!busy} style={btn({ marginLeft: "auto" })}>
              Trennen
            </button>
          </>
        ) : (
          <button onClick={connect} disabled={!!busy} style={btn({ background: "#1d4ed8", borderColor: "#1d4ed8" })}>
            {busy === "connect" ? "…" : "Google verbinden"}
          </button>
        )}
      </div>
      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#cbd5e1" }}>{msg}</div>
      )}
    </div>
  );
}

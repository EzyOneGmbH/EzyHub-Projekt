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

const ROLES_THAT_RUN_AUDITS = new Set(["owner", "admin", "member"]);

/** Inline Google panel for the currently selected EZY ONE client. */
export default function GoogleClientPanel({ client, onLog, onSaved }) {
  const clientId = client?.id || "";
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [gsc, setGsc] = useState(client?.gscSiteUrl || "");
  const [ga4, setGa4] = useState(client?.ga4PropertyId || "");
  const [gads, setGads] = useState(client?.googleAdsCustomer || "");
  const [msg, setMsg] = useState("");
  const [canRun, setCanRun] = useState(false);
  const [gscOpts, setGscOpts] = useState([]);
  const [ga4Opts, setGa4Opts] = useState([]);
  const [gadsOpts, setGadsOpts] = useState([]);

  useEffect(() => {
    setGsc(client?.gscSiteUrl || "");
    setGa4(client?.ga4PropertyId || "");
    setGads(client?.googleAdsCustomer || "");
  }, [client?.id, client?.gscSiteUrl, client?.ga4PropertyId, client?.googleAdsCustomer]);

  // Resolve current user's role for the client's organization → can run audits?
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!isUuid(clientId)) {
        if (!cancelled) setCanRun(false);
        return;
      }
      try {
        const { data: u, error: ue } = await supabase.auth.getUser();
        if (ue || !u?.user?.id) {
          if (!cancelled) setCanRun(false);
          return;
        }
        const { data: c } = await supabase
          .from("clients")
          .select("organization_id")
          .eq("id", clientId)
          .maybeSingle();
        if (!c?.organization_id) {
          if (!cancelled) setCanRun(false);
          return;
        }
        const { data: au } = await supabase
          .from("app_users")
          .select("role")
          .eq("organization_id", c.organization_id)
          .eq("user_id", u.user.id)
          .maybeSingle();
        if (!cancelled) setCanRun(ROLES_THAT_RUN_AUDITS.has(au?.role));
      } catch {
        if (!cancelled) setCanRun(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

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
      // Core props (GSC/GA4) — these columns always exist.
      const { error } = await supabase
        .from("clients")
        .update({ gsc_property: gsc || null, ga4_property: ga4 || null })
        .eq("id", clientId);
      if (error) throw error;

      // Google Ads customer — separate update so a not-yet-migrated column
      // (google_ads_customer) never blocks saving GSC/GA4.
      let adsNote = "";
      try {
        const gadsNorm = gads ? String(gads).replace(/\D/g, "") : null;
        const { error: adErr } = await supabase
          .from("clients")
          .update({ google_ads_customer: gadsNorm })
          .eq("id", clientId);
        if (adErr) adsNote = " (Google Ads ID konnte nicht gespeichert werden — Migration ausstehend)";
      } catch {
        adsNote = " (Google Ads ID konnte nicht gespeichert werden — Migration ausstehend)";
      }

      setMsg("Properties gespeichert" + adsNote);
      onLog?.({ ok: true, kind: "save", text: "Properties gespeichert" });
      onSaved?.();
    } catch (e) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  // One click: run every data job for this client so all dashboards fill.
  // Uses the app's authenticated, service-keyed routes — no external key needed.
  const runAll = async () => {
    if (!canRun) {
      setMsg("Keine Berechtigung für Audit-Läufe (viewer/read-only).");
      return;
    }
    setBusy("all");
    const jobs = [
      ["Ahrefs", "/api/ahrefs/overview", { clientId }],
      ["Core Web Vitals", "/api/google/pagespeed", { clientId }],
      ["GSC", "/api/google/gsc-import", { clientId, days: 28, rowLimit: 50 }],
      ["GA4", "/api/google/ga4-summary", { clientId, days: 28 }],
      ["GA4 Traffic", "/api/google/ga4-traffic", { clientId, days: 28 }],
      ["GA4 Conversions", "/api/google/ga4-conversions", { clientId, days: 28 }],
    ];
    const out = [];
    for (const [label, url, body] of jobs) {
      out.push(`⏳ ${label}…`);
      setMsg(out.join("\n"));
      try {
        const r = await authedFetch(url, { method: "POST", body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        const ok = j.ok === true || (r.ok && j.error == null);
        out[out.length - 1] = `${ok ? "✅" : "⚠️"} ${label}${j.error ? ": " + String(j.error).slice(0, 70) : ""}`;
      } catch (e) {
        out[out.length - 1] = `❌ ${label}: ${String(e?.message || e).slice(0, 70)}`;
      }
      setMsg(out.join("\n"));
    }
    onSaved?.();
    setBusy(null);
  };

  // Load the properties the connected account can access -> dropdowns.
  const loadAvailable = async () => {
    setBusy("load");
    setMsg("");
    try {
      const [gr, ar, adr] = await Promise.all([
        authedFetch("/api/google/gsc-sites", { method: "POST", body: JSON.stringify({ clientId }) }),
        authedFetch("/api/google/ga4-properties", { method: "POST", body: JSON.stringify({ clientId }) }),
        authedFetch("/api/google/ads-customers", { method: "POST", body: JSON.stringify({ clientId }) }),
      ]);
      const gj = await gr.json().catch(() => ({}));
      const aj = await ar.json().catch(() => ({}));
      const adJ = await adr.json().catch(() => ({}));
      const errs = [];
      if (gj.ok) setGscOpts(gj.sites || []);
      else errs.push(`GSC: ${gj.error || "Fehler"}`);
      if (aj.ok) setGa4Opts(aj.properties || []);
      else errs.push(`GA4: ${aj.error || "Fehler"}`);
      if (adJ.ok) setGadsOpts(adJ.customers || []);
      else errs.push(`Ads: ${adJ.error || "Fehler"}`);
      setMsg(
        errs.length
          ? errs.join(" · ")
          : `${(gj.sites || []).length} GSC · ${(aj.properties || []).length} GA4 · ${(adJ.customers || []).length} Ads geladen — bitte auswählen und speichern.`,
      );
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setMsg("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`/api/google/oauth/start?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
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
    if (!canRun) {
      setMsg("Keine Berechtigung für Audit-Läufe (viewer/read-only).");
      return;
    }
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
    if (!canRun) {
      setMsg("Keine Berechtigung für Audit-Läufe (viewer/read-only).");
      return;
    }
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
  const btn = (extra = {}, disabled = false) => ({
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
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
          {status?.connected
            ? `Verbunden${status.email ? ` · ${status.email}` : ""}`
            : "Nicht verbunden"}
        </span>
      </div>
      <div className="google-props-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>GSC Property</div>
          {gscOpts.length > 0 && (
            <select
              value={gscOpts.some((s) => s.url === gsc) ? gsc : ""}
              onChange={(e) => setGsc(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6 }}
            >
              <option value="">— aus {gscOpts.length} auswählen —</option>
              {gscOpts.map((s) => (
                <option key={s.url} value={s.url}>
                  {s.url}
                </option>
              ))}
            </select>
          )}
          <input
            value={gsc}
            onChange={(e) => setGsc(e.target.value)}
            placeholder="sc-domain:example.com"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>GA4 Property ID</div>
          {ga4Opts.length > 0 && (
            <select
              value={ga4Opts.some((p) => p.id === ga4) ? ga4 : ""}
              onChange={(e) => setGa4(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6 }}
            >
              <option value="">— aus {ga4Opts.length} auswählen —</option>
              {ga4Opts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.id}){p.account ? ` · ${p.account}` : ""}
                </option>
              ))}
            </select>
          )}
          <input
            value={ga4}
            onChange={(e) => setGa4(e.target.value)}
            placeholder="properties/123456789"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Google Ads Customer ID</div>
          {gadsOpts.length > 0 && (
            <select
              value={gadsOpts.some((a) => a.id === gads) ? gads : ""}
              onChange={(e) => setGads(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6 }}
            >
              <option value="">— aus {gadsOpts.length} auswählen —</option>
              {gadsOpts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          )}
          <input
            value={gads}
            onChange={(e) => setGads(e.target.value)}
            placeholder="123-456-7890"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={saveProps} disabled={!!busy} style={btn({}, !!busy)}>
          {busy === "save" ? "…" : "Properties speichern"}
        </button>
        {canRun && (
          <button
            onClick={runAll}
            disabled={!!busy}
            title="Ahrefs · Core Web Vitals · GSC · GA4 in einem Lauf"
            style={btn({ background: "#059669", borderColor: "#059669", fontWeight: 700 }, !!busy)}
          >
            {busy === "all" ? "läuft…" : "⟳ Alle Daten aktualisieren"}
          </button>
        )}
        {status?.connected ? (
          <>
            <button onClick={loadAvailable} disabled={!!busy} style={btn({}, !!busy)}>
              {busy === "load" ? "…" : "Verfügbare Properties laden"}
            </button>
            <button
              onClick={importGsc}
              disabled={!!busy || !canRun}
              title={canRun ? "" : "Keine Berechtigung (viewer)"}
              style={btn({ background: "#1d4ed8", borderColor: "#1d4ed8" }, !!busy || !canRun)}
            >
              {busy === "import" ? "…" : "GSC importieren"}
            </button>
            <button
              onClick={ga4Run}
              disabled={!!busy || !canRun}
              title={canRun ? "" : "Keine Berechtigung (viewer)"}
              style={btn({}, !!busy || !canRun)}
            >
              {busy === "ga4" ? "…" : "GA4 Summary"}
            </button>
            <button
              onClick={disconnect}
              disabled={!!busy}
              style={btn({ marginLeft: "auto" }, !!busy)}
            >
              Trennen
            </button>
          </>
        ) : (
          <button
            onClick={connect}
            disabled={!!busy}
            style={btn({ background: "#1d4ed8", borderColor: "#1d4ed8" }, !!busy)}
          >
            {busy === "connect" ? "…" : "Google verbinden"}
          </button>
        )}
      </div>
      {!canRun && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#f59e0b" }}>
          Read-only Rolle: GSC Import und GA4 Summary sind deaktiviert.
        </div>
      )}
      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>{msg}</div>
      )}
    </div>
  );
}

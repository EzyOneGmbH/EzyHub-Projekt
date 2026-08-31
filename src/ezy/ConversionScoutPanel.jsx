// Conversion-Scout — Freigabe-Panel im Conversions-Tab (Pilot FIH, 26.08.2026).
// Zeigt automatisch erkannte Conversion-Kandidaten (jede Mailadresse/Nummer/
// Datei EINZELN) und schaltet sie erst nach manueller Freigabe (inkl. Wert)
// als GA4 Key Event scharf. NUR ORGANIC: bewusst keine Google-Ads-Anbindung.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDown,
  Mail,
  Phone,
  RefreshCw,
  Radar,
} from "lucide-react";
import { Btn, Badge } from "./shared-ui";
import { C } from "./theme";
import { ezyFetch } from "@/ezy/data/api";

const TYPE_META = {
  mailto: { icon: Mail, label: "E-Mail-Klick" },
  tel: { icon: Phone, label: "Anruf-Klick" },
  download: { icon: FileDown, label: "Download" },
  crossdomain: { icon: ExternalLink, label: "Cross-Domain-Checkout" },
};

function fmtTs(ts) {
  try {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function ConversionScoutPanel({ selectedClient }) {
  const clientId = selectedClient?.id || null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [values, setValues] = useState({}); // id -> {value, currency}
  const [names, setNames] = useState({}); // id -> Wunschname (wird GA4-Eventname)
  const [showIgnored, setShowIgnored] = useState(false);
  const [groundwork, setGroundwork] = useState(null); // Cross-Domain: Schritte für echten Betrag

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const r = await ezyFetch(`/api/admin/conversion-candidates?client=${clientId}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [clientId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setValues({});
    setNames({});
    load();
  }, [load]);

  const candidates = useMemo(() => data?.candidates || [], [data?.candidates]);
  const pending = useMemo(() => candidates.filter((c) => c.status === "pending"), [candidates]);
  const approved = useMemo(() => candidates.filter((c) => c.status === "approved"), [candidates]);
  const ignored = useMemo(() => candidates.filter((c) => c.status === "ignored"), [candidates]);

  const act = async (id, action, extra = {}) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await ezyFetch("/api/admin/conversion-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientId, id, action, ...extra }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (Array.isArray(j.groundwork) && j.groundwork.length) setGroundwork(j.groundwork);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const scan = async () => {
    setScanBusy(true);
    setError(null);
    try {
      const r = await ezyFetch("/api/admin/conversion-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientId }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setScanBusy(false);
    }
  };

  if (!clientId) return null;
  const lastRun = data?.lastRun || null;

  const card = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
  };

  const renderCandidate = (c) => {
    const meta = TYPE_META[c.candidate_type] || { icon: Radar, label: c.candidate_type };
    const Icon = meta.icon;
    const v = values[c.id] || {
      value: c.conversion_value ?? "",
      currency: c.conversion_currency || "CHF",
    };
    // Wunschname: vorbefuellt mit dem gefundenen Linktext — wird bei Freigabe
    // zum GA4-Eventnamen (slugifiziert) und erscheint ueberall so.
    const nameVal = names[c.id] ?? (c.display_name || c.label || "");
    const busy = busyId === c.id;
    return (
      <div
        key={c.id}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.accent}`,
          borderRadius: 10,
        }}
      >
        <Icon size={16} color={C.accent} style={{ flexShrink: 0 }} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, wordBreak: "break-all" }}>
            {c.raw_value}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
            {meta.label}
            {c.label ? ` · «${c.label}»` : ""} · gefunden auf{" "}
            {String(c.source_url).replace(/^https?:\/\//, "")}
          </div>
          {c.candidate_type === "crossdomain" && (
            <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 3, fontStyle: "italic" }}>
              Misst den Klick zum Checkout (Kauf-/Spenden-Absicht). Der echte Betrag erscheint erst,
              wenn der Zielhost unser GA4 mitlädt (RaiseNow-Einstellung) + GTM-Linker gesetzt ist.
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="text"
            maxLength={60}
            placeholder="Name (z. B. Mitglied werden)"
            title="Anzeigename der Conversion — erscheint so in GA4 und im Conversions-Tab"
            value={nameVal}
            onChange={(e) => setNames((p) => ({ ...p, [c.id]: e.target.value }))}
            style={{
              width: 170,
              padding: "6px 8px",
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: C.card,
              color: C.text,
            }}
          />
          <input
            type="number"
            min={0}
            placeholder="Wert"
            value={v.value}
            onChange={(e) => setValues((p) => ({ ...p, [c.id]: { ...v, value: e.target.value } }))}
            style={{
              width: 84,
              padding: "6px 8px",
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: C.card,
              color: C.text,
            }}
          />
          <select
            value={v.currency}
            onChange={(e) =>
              setValues((p) => ({ ...p, [c.id]: { ...v, currency: e.target.value } }))
            }
            style={{
              padding: "6px 6px",
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: C.card,
              color: C.text,
            }}
          >
            {["CHF", "EUR", "USD"].map((cur) => (
              <option key={cur} value={cur}>
                {cur}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn
            size="sm"
            disabled={busy}
            onClick={() =>
              act(c.id, "approve", {
                value: v.value === "" ? undefined : Number(v.value),
                currency: v.currency,
                name: nameVal.trim() || undefined,
              })
            }
          >
            {busy ? "…" : "✓ Freigeben"}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => act(c.id, "ignore")}>
            Ignorieren
          </Btn>
        </div>
      </div>
    );
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Radar size={16} color={C.accent} />
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Conversion-Kandidaten</div>
        {pending.length > 0 && <Badge>{pending.length} offen</Badge>}
        <div style={{ flex: 1 }} />
        <Btn size="sm" variant="secondary" icon={RefreshCw} disabled={scanBusy} onClick={scan}>
          {scanBusy ? "Scan läuft…" : "Website scannen"}
        </Btn>
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 6 }}>
        Automatisch erkannte Kontakt-, Download- und Cross-Domain-Checkout-Ziele — jedes einzeln
        freigebbar. Erst nach Freigabe wird ein GA4 Key Event angelegt (nur organische Messung,
        keine Google-Ads-Anbindung).
        {lastRun && lastRun.finished_at && (
          <>
            {" "}
            Letzter Scan: {fmtTs(lastRun.finished_at)} ({lastRun.pages_crawled ?? 0} Seiten
            {lastRun.status === "error" ? " · Fehler" : ""}).
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            background: `${C.orange}18`,
            border: `1px solid ${C.orange}55`,
            borderRadius: 10,
            fontSize: 12.5,
            color: C.text,
          }}
        >
          {error}
        </div>
      )}

      {groundwork && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: `${C.accent}12`,
            border: `1px solid ${C.accent}44`,
            borderRadius: 10,
            fontSize: 12.5,
            color: C.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExternalLink size={14} color={C.accent} />
            <span style={{ fontWeight: 700 }}>
              Cross-Domain freigegeben — Klick-Absicht misst ab sofort.
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setGroundwork(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.textDim,
                fontSize: 12,
              }}
            >
              schliessen
            </button>
          </div>
          <div style={{ marginTop: 6, color: C.textDim }}>
            Für den <b>echten Betrag</b> (statt nur der Klick-Absicht) noch zwei einmalige Schritte:
          </div>
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {groundwork.map((s, i) => (
              <li key={i} style={{ marginTop: 3 }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {pending.map(renderCandidate)}
        </div>
      )}
      {data && pending.length === 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            padding: "10px 12px",
            background: `${C.green}12`,
            border: `1px solid ${C.green}44`,
            borderRadius: 10,
            fontSize: 12.5,
            color: C.text,
          }}
        >
          <CheckCircle2 size={15} color={C.green} />
          Keine offenen Kandidaten — «Website scannen» prüft die Seite erneut.
        </div>
      )}

      {approved.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 6 }}>
            Freigegeben ({approved.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {approved.map((c) => {
              const meta = TYPE_META[c.candidate_type] || { icon: Radar, label: c.candidate_type };
              const Icon = meta.icon;
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${C.green}`,
                    borderRadius: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <Icon size={15} color={C.green} />
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                      {c.display_name || c.raw_value}
                    </span>
                    <span style={{ fontSize: 11.5, color: C.textDim }}>
                      {" "}
                      {c.display_name ? `· ${c.raw_value} ` : ""}→ {c.ga4_destination_event}
                      {c.conversion_value
                        ? ` · ${c.conversion_value} ${c.conversion_currency || "CHF"}`
                        : ""}
                    </span>
                  </div>
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={busyId === c.id}
                    onClick={() => act(c.id, "revoke")}
                  >
                    {busyId === c.id ? "…" : "Entziehen"}
                  </Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ignored.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowIgnored((s) => !s)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 12,
              color: C.textDim,
            }}
          >
            {showIgnored ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Ignoriert ({ignored.length})
          </button>
          {showIgnored && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {ignored.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    fontSize: 12.5,
                    color: C.textDim,
                  }}
                >
                  <span style={{ flex: 1, wordBreak: "break-all" }}>{c.raw_value}</span>
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={busyId === c.id}
                    onClick={() => act(c.id, "reopen")}
                  >
                    Wieder prüfen
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

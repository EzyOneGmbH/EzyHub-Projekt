// EzyAI — Ads-Modus, Bereich «Kampagnen» (ChatGPT-Ads-Management, 31.08.2026).
// Verwaltet ChatGPT-Ads-Kampagnen über die OpenAI Advertiser API — gelesen
// wird IMMER aus Supabase (Sync-Layer via /api/admin/chatgpt-ads), nie direkt
// von OpenAI (Spec-Grundprinzip). Write-Aktionen (Pause/Aktivieren/Budget)
// laufen als Command mit Audit-Log und sofortigem Re-Sync.
// Bis zur CH-Freischaltung des Self-Serve Ads Managers: Demo-Konto via
// API-Key "mock" — komplette UI End-to-End testbar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  cacheGet,
  cachePut,
  RANGE_TTL_MS,
  isoDay,
  type ResolvedRange,
} from "@/ezy/data/rangeStore";

type Tokens = Record<string, string>;

// Das ezyai-Token-Set kennt weder `accent` noch `ink` (dort heissen sie
// `app` bzw. `txt`) — mit S["accent"]/S["ink"] direkt war der Verbinden-
// Button transparent mit weisser Schrift, also unsichtbar (Volkan 01.09.).
const accentOf = (S: Tokens) => S["accent"] || S.app || "#77008C";
const inkOf = (S: Tokens) => S["ink"] || S.txt || "#0D0D0D";

type GeoLocation = { id: string; name: string; type?: string; country_code?: string };
type Campaign = {
  openai_campaign_id: string;
  name: string;
  status: string;
  bidding_type: string | null;
  objective: string | null;
  budget_daily_micros: number | null;
  budget_lifetime_micros: number | null;
  synced_at: string | null;
  targeting_locations?: GeoLocation[] | null;
  // raw->targeting: custom_audiences.ids / excluded_custom_audiences.ids
  targeting?: {
    custom_audiences?: { ids?: string[] };
    excluded_custom_audiences?: { ids?: string[] };
  } | null;
};
type Audience = {
  openai_audience_id: string;
  name: string;
  description: string | null;
  status: string;
  identifier_type: string | null;
  matched_user_count_range: string | null;
  identifier_count: number | null;
  created_at: string;
  synced_at: string | null;
};
type InsightRow = {
  scope_openai_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number | null;
};
type CmdRow = {
  action: string;
  target_openai_id: string;
  status: string;
  error: string | null;
  created_at: string;
};
type Account = {
  id: string;
  openai_ad_account_id: string;
  name: string;
  currency_code: string;
  status: string;
  is_mock: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
};
type ApiData = {
  ok: boolean;
  error?: string;
  connected?: boolean;
  account?: Account;
  campaigns?: Campaign[];
  insights?: InsightRow[];
  commands?: CmdRow[];
  audiences?: Audience[];
};

const AUDIENCE_STATUS: Record<string, [string, string]> = {
  ready: ["bereit", "#0f9d6c"],
  processing: ["wird verarbeitet", "#d97706"],
  upload_pending: ["Upload läuft", "#d97706"],
  publishing: ["wird veröffentlicht", "#d97706"],
  too_small: ["zu klein", "#dc2626"],
  failed: ["fehlgeschlagen", "#dc2626"],
  archived: ["archiviert", "#8b8da3"],
};
const RANGE_LABEL: Record<string, string> = {
  under_25k: "< 25'000",
  "25k_100k": "25'000 – 100'000",
  "100k_500k": "100'000 – 500'000",
  "500k_1m": "500'000 – 1 Mio.",
  "1m_5m": "1 – 5 Mio.",
  "5m_plus": "> 5 Mio.",
  none: "keine Treffer",
};

// SHA-256 im Browser (Web Crypto) — Klartext-Adressen verlassen den Browser nie.
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// Normalisierung gem. OpenAI-Doku: E-Mail klein + ohne Whitespace; Telefon E.164.
const normEmail = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
const normPhone = (s: string) => {
  const d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0") && d.length >= 9) return `+41${d.slice(1)}`; // CH-Default
  return d ? `+${d}` : "";
};
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const microsToMoney = (m: number | null | undefined, cur: string) =>
  m == null
    ? "–"
    : `${cur} ${(m / 1_000_000).toLocaleString("de-CH", { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString("de-CH");
const fmtMoney = (n: number, cur: string) =>
  `${cur} ${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

async function apiPost(body: any): Promise<{ ok: boolean; error?: string }> {
  const session = (await supabase.auth.getSession()).data.session;
  const r = await fetch("/api/admin/chatgpt-ads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, error: j.error || (r.ok ? undefined : `HTTP ${r.status}`) };
}

export default function EzyAiCampaignsPanel({
  clientId,
  clientName,
  range,
  S,
  isOrgAdmin,
  section = "ads-kampagnen",
}: {
  clientId: string;
  clientName: string;
  range: ResolvedRange;
  S: Tokens;
  isOrgAdmin: boolean;
  // "ads-kampagnen" (Default) | "ads-zielgruppen" (Custom Audiences, 01.09.)
  section?: string;
}) {
  const [data, setData] = useState<ApiData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const startKey = isoDay(range.start);
  const endKey = isoDay(range.end);

  useEffect(() => {
    let alive = true;
    const cacheKey = `chatgpt-ads:${clientId}:${startKey}:${endKey}`;
    const cached = reloadKey === 0 ? cacheGet(cacheKey) : null;
    setData(cached ? (cached.data as ApiData) : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/admin/chatgpt-ads?client=${encodeURIComponent(clientId)}&start=${startKey}&end=${endKey}`,
          { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
        );
        const j = await r.json().catch(() => ({}));
        if (j.ok) cachePut(cacheKey, j);
        if (alive && (j.ok || !cached))
          setData(j.ok ? j : { ok: false, error: j.error || `HTTP ${r.status}` });
      } catch (e: any) {
        if (alive && !cached) setData({ ok: false, error: String(e?.message || e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, startKey, endKey, reloadKey]);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const card: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };

  if (data === null)
    return (
      <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
        Lade Kampagnen…
      </div>
    );
  if (!data.ok)
    return (
      <div style={{ ...card, maxWidth: 560, margin: "40px auto 0", textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Daten nicht ladbar</div>
        <div style={{ fontSize: 12.5, color: S.mut }}>{data.error}</div>
      </div>
    );
  if (!data.connected)
    return (
      <ConnectCard
        clientId={clientId}
        clientName={clientName}
        S={S}
        card={card}
        isOrgAdmin={isOrgAdmin}
        onConnected={refresh}
      />
    );

  return (
    <ManagerView
      clientId={clientId}
      data={data}
      S={S}
      card={card}
      isOrgAdmin={isOrgAdmin}
      onChanged={refresh}
      section={section}
    />
  );
}

/* ── Konto verbinden (Spec §6: Kunde erstellt Konto selbst, Ezy One = Admin) ── */
function ConnectCard({
  clientId,
  clientName,
  S,
  card,
  isOrgAdmin,
  onConnected,
}: {
  clientId: string;
  clientName: string;
  S: Tokens;
  card: React.CSSProperties;
  isOrgAdmin: boolean;
  onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState(false);
  const connect = async () => {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setMsg("");
    setMsgErr(false);
    const r = await apiPost({ action: "connect", clientId, apiKey: apiKey.trim() });
    setBusy(false);
    if (r.ok) {
      setMsg("Konto verbunden — erster Sync läuft.");
      onConnected();
    } else {
      setMsgErr(true);
      setMsg(r.error || "Verbinden fehlgeschlagen — Key prüfen.");
    }
  };
  return (
    <div style={{ ...card, maxWidth: 640, margin: "24px auto 0" }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
        ChatGPT-Ads-Konto verbinden
      </div>
      <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.6, marginBottom: 14 }}>
        Kampagnen von <b>{clientName}</b> direkt hier verwalten (Status, Budget, Performance).
        <br />
        1. Der Kunde erstellt sein Advertiser-Konto auf <b>ads.openai.com</b> und verifiziert es.
        <br />
        2. Ezy One wird im Konto als Admin (Team) hinzugefügt — Owner/Billing bleibt beim Kunden.
        <br />
        3. Im dortigen Settings-Tab einen API-Key ausstellen und hier einfügen (wird verschlüsselt
        gespeichert, nie angezeigt).
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#92400e",
          background: "rgba(217,119,6,.06)",
          border: "1px solid #d9770655",
          borderRadius: 10,
          padding: "8px 12px",
          marginBottom: 14,
        }}
      >
        Self-Serve für die Schweiz ist noch nicht freigeschaltet (erwartet Ende Q3 2026). Zum Testen
        der Oberfläche: <b>mock</b> als Key eingeben → Demo-Konto mit Beispieldaten.
      </div>
      {isOrgAdmin ? (
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="password"
            placeholder="API-Key aus ads.openai.com (oder: mock)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect();
            }}
            style={{
              flex: 1,
              border: `1px solid ${S.line}`,
              borderRadius: 10,
              padding: "9px 12px",
              fontSize: 13,
              background: S.bg,
              color: inkOf(S),
            }}
          />
          <button
            onClick={connect}
            disabled={busy || !apiKey.trim()}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "9px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              background: accentOf(S),
              color: "#fff",
              opacity: busy || !apiKey.trim() ? 0.6 : 1,
            }}
          >
            {busy ? "Verbinde…" : "Verbinden"}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: S.mut }}>
          Nur Team-Admins können ein Konto verbinden.
        </div>
      )}
      {msg && (
        <div
          style={{
            fontSize: 12.5,
            marginTop: 10,
            fontWeight: msgErr ? 700 : 400,
            color: msgErr ? "#b91c1c" : S.mut,
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

/* ── Manager: Konto-Karte + KPIs + Spend-Verlauf + Kampagnen-Tabelle ───────── */
function ManagerView({
  clientId,
  data,
  S,
  card,
  isOrgAdmin,
  onChanged,
  section,
}: {
  clientId: string;
  data: ApiData;
  S: Tokens;
  card: React.CSSProperties;
  isOrgAdmin: boolean;
  onChanged: () => void;
  section: string;
}) {
  const acc = data.account!;
  const cur = acc.currency_code || "USD";
  const campaigns = data.campaigns || [];
  const audiences = data.audiences || [];
  // Stabile Referenz fuer die useMemo-Abhaengigkeiten (eslint exhaustive-deps).
  const insights = useMemo(() => data.insights || [], [data.insights]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // Bulk-Auswahl (01.09.): Kampagnen-IDs; Bestätigung inline (zwei Klicks).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<"pause" | "activate" | null>(null);
  // Aufgeklappter Editor unter einer Kampagnen-Zeile (Targeting / Zielgruppen).
  const [editor, setEditor] = useState<{ id: string; kind: "targeting" | "audiences" } | null>(
    null,
  );

  const run = async (body: any, key: string) => {
    setBusy(key);
    setErr("");
    const r = await apiPost(body);
    setBusy("");
    if (!r.ok) setErr(r.error || "Fehler");
    onChanged();
    return r.ok;
  };
  const runBulk = async (cmd: "pause" | "activate") => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkConfirm(null);
    const ok = await run({ action: "bulk", clientId, cmd, targetIds: ids }, `bulk:${cmd}`);
    if (ok) setSelected(new Set());
  };
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected =
    campaigns.length > 0 && campaigns.every((c) => selected.has(c.openai_campaign_id));

  // Aggregation je Kampagne + Tages-Zeitreihe über alle Kampagnen.
  const perCampaign = useMemo(() => {
    const m: Record<string, { imp: number; clicks: number; spend: number; conv: number }> = {};
    for (const r of insights) {
      const a = (m[r.scope_openai_id] ??= { imp: 0, clicks: 0, spend: 0, conv: 0 });
      a.imp += Number(r.impressions || 0);
      a.clicks += Number(r.clicks || 0);
      a.spend += Number(r.spend || 0);
      a.conv += Number(r.conversions || 0);
    }
    return m;
  }, [insights]);
  const byDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of insights) m[r.date] = (m[r.date] || 0) + Number(r.spend || 0);
    return m;
  }, [insights]);
  const totals = useMemo(() => {
    let imp = 0,
      clicks = 0,
      spend = 0,
      conv = 0;
    for (const v of Object.values(perCampaign)) {
      imp += v.imp;
      clicks += v.clicks;
      spend += v.spend;
      conv += v.conv;
    }
    return { imp, clicks, spend, conv, ctr: imp ? (clicks / imp) * 100 : 0 };
  }, [perCampaign]);
  const dayKeys = Object.keys(byDay).sort();
  const maxDay = Math.max(0.01, ...dayKeys.map((k) => byDay[k]));

  // Zielgruppen-Bereich (eigener Nav-Punkt) teilt Konto-Karte + Fehlerbox.
  if (section === "ads-zielgruppen")
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {err && (
          <div
            style={{
              ...card,
              borderColor: "#dc262655",
              background: "rgba(220,38,38,.05)",
              color: "#b91c1c",
              fontSize: 12.5,
            }}
          >
            {err}
          </div>
        )}
        <AudiencesView
          clientId={clientId}
          audiences={audiences}
          campaigns={campaigns}
          isMock={!!acc.is_mock}
          S={S}
          card={card}
          canWrite={isOrgAdmin}
          busy={busy}
          run={run}
        />
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Konto-Karte */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {acc.name}{" "}
            {acc.is_mock && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "#92400e",
                  background: "rgba(217,119,6,.12)",
                  borderRadius: 999,
                  padding: "2px 8px",
                  marginLeft: 6,
                  verticalAlign: "middle",
                }}
              >
                DEMO
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>
            Konto {acc.openai_ad_account_id} · {cur} · letzter Sync {fmtTime(acc.last_synced_at)}
            {acc.last_sync_error && (
              <span style={{ color: "#dc2626" }}> · Sync-Fehler: {acc.last_sync_error}</span>
            )}
          </div>
        </div>
        {isOrgAdmin && (
          <button
            onClick={() => run({ action: "sync", clientId }, "sync")}
            disabled={busy === "sync"}
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              background: S.bg,
              color: inkOf(S),
            }}
          >
            {busy === "sync" ? "Synchronisiere…" : "Jetzt syncen"}
          </button>
        )}
      </div>

      {err && (
        <div
          style={{
            ...card,
            borderColor: "#dc262655",
            background: "rgba(220,38,38,.05)",
            color: "#b91c1c",
            fontSize: 12.5,
          }}
        >
          {err}
        </div>
      )}

      {/* KPI-Zeile (gewählter Zeitraum) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          gap: 12,
        }}
      >
        {(
          [
            ["Spend", fmtMoney(totals.spend, cur)],
            ["Impressionen", fmtNum(totals.imp)],
            ["Klicks", fmtNum(totals.clicks)],
            ["CTR", `${totals.ctr.toFixed(2)} %`],
            ["Conversions", fmtNum(totals.conv)],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} style={card}>
            <div style={{ fontSize: 11.5, color: S.mut, fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Spend-Verlauf */}
      {dayKeys.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Spend pro Tag</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
            {dayKeys.map((k) => (
              <div
                key={k}
                title={`${k}: ${fmtMoney(byDay[k], cur)}`}
                style={{
                  flex: 1,
                  minWidth: 3,
                  height: `${Math.max(4, (byDay[k] / maxDay) * 100)}%`,
                  background: accentOf(S),
                  opacity: 0.85,
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Kampagnen-Tabelle */}
      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>Kampagnen ({campaigns.length})</div>
          {/* Bulk-Leiste (Bulk API): erscheint, sobald etwas ausgewählt ist */}
          {isOrgAdmin && selected.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ color: S.mut }}>{selected.size} ausgewählt</span>
              {bulkConfirm ? (
                <>
                  <span style={{ fontWeight: 700, color: "#92400e" }}>
                    {selected.size} Kampagnen {bulkConfirm === "pause" ? "pausieren" : "aktivieren"}
                    ?
                  </span>
                  <button
                    onClick={() => runBulk(bulkConfirm)}
                    disabled={busy.startsWith("bulk:")}
                    style={{
                      border: "none",
                      borderRadius: 8,
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: bulkConfirm === "pause" ? "#d97706" : "#0f9d6c",
                      color: "#fff",
                    }}
                  >
                    {busy.startsWith("bulk:") ? "Läuft…" : "Ja, ausführen"}
                  </button>
                  <button
                    onClick={() => setBulkConfirm(null)}
                    style={{
                      border: `1px solid ${S.line}`,
                      borderRadius: 8,
                      padding: "5px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      background: "transparent",
                      color: S.mut,
                    }}
                  >
                    Abbrechen
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setBulkConfirm("pause")}
                    style={{
                      border: "1px solid #d9770655",
                      borderRadius: 8,
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: "rgba(217,119,6,.08)",
                      color: "#92400e",
                    }}
                  >
                    Pausieren
                  </button>
                  <button
                    onClick={() => setBulkConfirm("activate")}
                    style={{
                      border: "1px solid #0f9d6c55",
                      borderRadius: 8,
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: "rgba(15,157,108,.08)",
                      color: "#0f9d6c",
                    }}
                  >
                    Aktivieren
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: S.mut,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Auswahl aufheben
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {campaigns.length === 0 ? (
          <div style={{ fontSize: 12.5, color: S.mut, padding: 20, textAlign: "center" }}>
            Noch keine Kampagnen — im OpenAI Ads Manager anlegen, danach hier syncen.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: S.mut, textAlign: "left" }}>
                  {isOrgAdmin && (
                    <th style={{ padding: "6px 10px", borderBottom: `1px solid ${S.line}` }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() =>
                          setSelected(
                            allSelected
                              ? new Set()
                              : new Set(campaigns.map((c) => c.openai_campaign_id)),
                          )
                        }
                        title="Alle auswählen"
                      />
                    </th>
                  )}
                  {[
                    "Kampagne",
                    "Status",
                    "Gebot",
                    "Budget/Tag",
                    "Targeting",
                    "Zielgruppen",
                    "Spend",
                    "Klicks",
                    "CTR",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{ padding: "6px 10px", borderBottom: `1px solid ${S.line}` }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const open = editor?.id === c.openai_campaign_id ? editor.kind : null;
                  const onCmd = (cmd: string, extra?: any) =>
                    run(
                      {
                        action: "command",
                        clientId,
                        cmd,
                        targetType: "campaign",
                        targetId: c.openai_campaign_id,
                        ...extra,
                      },
                      `${cmd}:${c.openai_campaign_id}`,
                    );
                  return (
                    <CampaignRow
                      key={c.openai_campaign_id}
                      c={c}
                      agg={perCampaign[c.openai_campaign_id]}
                      cur={cur}
                      S={S}
                      canWrite={isOrgAdmin}
                      busy={busy}
                      onCmd={onCmd}
                      selected={selected.has(c.openai_campaign_id)}
                      onSelect={() => toggleSel(c.openai_campaign_id)}
                      openEditor={open}
                      onToggleEditor={(kind) =>
                        setEditor(open === kind ? null : { id: c.openai_campaign_id, kind })
                      }
                      audiences={audiences}
                      colSpan={isOrgAdmin ? 11 : 10}
                      onEditorSaved={() => setEditor(null)}
                      clientId={clientId}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Letzte Kommandos (Audit) */}
      {(data.commands || []).length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Letzte Änderungen</div>
          {(data.commands || []).slice(0, 8).map((cm, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                fontSize: 12,
                color: S.mut,
                padding: "4px 0",
                borderBottom: `1px solid ${S.line}22`,
              }}
            >
              <span style={{ minWidth: 92 }}>{fmtTime(cm.created_at)}</span>
              <span style={{ fontWeight: 700, color: inkOf(S) }}>{cm.action}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {cm.target_openai_id}
              </span>
              <span style={{ color: cm.status === "success" ? "#0f9d6c" : "#dc2626" }}>
                {cm.status === "success" ? "ok" : cm.error || cm.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignRow({
  c,
  agg,
  cur,
  S,
  canWrite,
  busy,
  onCmd,
  selected,
  onSelect,
  openEditor,
  onToggleEditor,
  audiences,
  colSpan,
  onEditorSaved,
  clientId,
}: {
  c: Campaign;
  agg?: { imp: number; clicks: number; spend: number; conv: number };
  cur: string;
  S: Tokens;
  canWrite: boolean;
  busy: string;
  onCmd: (cmd: string, extra?: any) => Promise<boolean>;
  selected: boolean;
  onSelect: () => void;
  openEditor: "targeting" | "audiences" | null;
  onToggleEditor: (kind: "targeting" | "audiences") => void;
  audiences: Audience[];
  colSpan: number;
  onEditorSaved: () => void;
  clientId: string;
}) {
  const [editBudget, setEditBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState(
    c.budget_daily_micros != null ? String(c.budget_daily_micros / 1_000_000) : "",
  );
  const aktiv = c.status === "active";
  const ctr = agg && agg.imp ? (agg.clicks / agg.imp) * 100 : 0;
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${S.line}22` };
  const toggling =
    busy === `pause:${c.openai_campaign_id}` || busy === `activate:${c.openai_campaign_id}`;
  const locs = c.targeting_locations || [];
  const incl = c.targeting?.custom_audiences?.ids || [];
  const excl = c.targeting?.excluded_custom_audiences?.ids || [];
  const clickable: React.CSSProperties = canWrite
    ? { cursor: "pointer", textDecoration: "underline dotted" }
    : {};
  const targetingLabel =
    locs.length === 0
      ? "weltweit"
      : locs.length <= 3
        ? locs
            .map((l) => (l.country_code && l.type === "country" ? l.country_code : l.name))
            .join(", ")
        : `${locs.length} Regionen`;
  const audienceLabel =
    incl.length + excl.length === 0
      ? "–"
      : [incl.length ? `${incl.length} ein` : "", excl.length ? `${excl.length} aus` : ""]
          .filter(Boolean)
          .join(" · ");
  return (
    <>
      <tr style={openEditor ? { background: "rgba(119,0,140,.03)" } : undefined}>
        {canWrite && (
          <td style={td}>
            <input type="checkbox" checked={selected} onChange={onSelect} />
          </td>
        )}
        <td style={{ ...td, fontWeight: 700, color: inkOf(S) }}>{c.name}</td>
        <td style={td}>
          {canWrite ? (
            <button
              onClick={() => onCmd(aktiv ? "pause" : "activate")}
              disabled={toggling}
              title={aktiv ? "Pausieren" : "Aktivieren"}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "3px 12px",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                background: aktiv ? "rgba(15,157,108,.12)" : "rgba(217,119,6,.12)",
                color: aktiv ? "#0f9d6c" : "#92400e",
                opacity: toggling ? 0.5 : 1,
              }}
            >
              {toggling ? "…" : aktiv ? "aktiv" : "pausiert"}
            </button>
          ) : (
            <span style={{ color: aktiv ? "#0f9d6c" : "#92400e", fontWeight: 700, fontSize: 11.5 }}>
              {aktiv ? "aktiv" : "pausiert"}
            </span>
          )}
        </td>
        <td style={{ ...td, color: S.mut }}>{c.bidding_type || "–"}</td>
        <td style={td}>
          {canWrite && editBudget ? (
            <span style={{ display: "inline-flex", gap: 6 }}>
              <input
                value={budgetVal}
                onChange={(e) => setBudgetVal(e.target.value)}
                style={{
                  width: 80,
                  border: `1px solid ${S.line}`,
                  borderRadius: 8,
                  padding: "3px 8px",
                  fontSize: 12,
                  background: S.bg,
                  color: inkOf(S),
                }}
              />
              <button
                onClick={() => {
                  const v = Math.round(Number(budgetVal.replace(",", ".")) * 1_000_000);
                  if (v > 0) onCmd("set_budget", { budgetDailyMicros: v });
                  setEditBudget(false);
                }}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: accentOf(S),
                  color: "#fff",
                }}
              >
                OK
              </button>
            </span>
          ) : (
            <span
              onClick={() => canWrite && setEditBudget(true)}
              title={canWrite ? "Klicken zum Ändern" : undefined}
              style={{
                cursor: canWrite ? "pointer" : "default",
                textDecoration: canWrite ? "underline dotted" : "none",
              }}
            >
              {microsToMoney(c.budget_daily_micros, cur)}
            </span>
          )}
        </td>
        <td
          style={{ ...td, ...clickable, color: locs.length ? inkOf(S) : S.mut }}
          onClick={() => canWrite && onToggleEditor("targeting")}
          title={
            locs.length
              ? locs.map((l) => l.name).join(", ")
              : canWrite
                ? "Klicken, um Länder/Regionen festzulegen"
                : undefined
          }
        >
          {targetingLabel}
        </td>
        <td
          style={{ ...td, ...clickable, color: incl.length + excl.length ? inkOf(S) : S.mut }}
          onClick={() => canWrite && onToggleEditor("audiences")}
          title={canWrite ? "Klicken, um Zielgruppen zuzuweisen" : undefined}
        >
          {audienceLabel}
        </td>
        <td style={td}>{agg ? fmtMoney(agg.spend, cur) : "–"}</td>
        <td style={td}>{agg ? fmtNum(agg.clicks) : "–"}</td>
        <td style={td}>{agg && agg.imp ? `${ctr.toFixed(2)} %` : "–"}</td>
        <td style={{ ...td, color: S.mut, fontSize: 11 }}>{fmtTime(c.synced_at)}</td>
      </tr>
      {openEditor && (
        <tr>
          <td
            colSpan={colSpan}
            style={{ padding: "4px 10px 14px", background: "rgba(119,0,140,.03)" }}
          >
            {openEditor === "targeting" ? (
              <TargetingEditor
                clientId={clientId}
                S={S}
                initial={locs}
                busy={busy === `set_targeting:${c.openai_campaign_id}`}
                onSave={async (locations) => {
                  if (await onCmd("set_targeting", { locations })) onEditorSaved();
                }}
                onCancel={() => onToggleEditor("targeting")}
              />
            ) : (
              <AudiencesEditor
                S={S}
                audiences={audiences}
                initialInclude={incl}
                initialExclude={excl}
                busy={busy === `set_audiences:${c.openai_campaign_id}`}
                onSave={async (includeIds, excludeIds) => {
                  if (await onCmd("set_audiences", { includeIds, excludeIds })) onEditorSaved();
                }}
                onCancel={() => onToggleEditor("audiences")}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Geo-Targeting-Editor: Suche via geo_lookup, Chips, Speichern ──────────── */
function TargetingEditor({
  clientId,
  S,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  clientId: string;
  S: Tokens;
  initial: GeoLocation[];
  busy: boolean;
  onSave: (locations: GeoLocation[]) => void;
  onCancel: () => void;
}) {
  const [locs, setLocs] = useState<GeoLocation[]>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [searching, setSearching] = useState(false);
  // Debounced Geo-Suche (geo_lookup/search, im Mock statische Liste).
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/admin/chatgpt-ads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ action: "geo-search", clientId, q: q.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (alive) {
        setResults(j.ok ? j.locations || [] : []);
        setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, clientId]);
  const add = (l: GeoLocation) => {
    if (!locs.some((x) => x.id === l.id)) setLocs([...locs, l]);
    setQ("");
    setResults([]);
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    border: primary ? "none" : `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    background: primary ? accentOf(S) : "transparent",
    color: primary ? "#fff" : S.mut,
  });
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: inkOf(S) }}>
        Geo-Targeting{" "}
        <span style={{ fontWeight: 400, color: S.mut }}>
          — leer = weltweit; Länder, Regionen/Kantone oder Metro-Gebiete (DMA)
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {locs.length === 0 && <span style={{ color: S.mut }}>Keine Einschränkung (weltweit)</span>}
        {locs.map((l) => (
          <span
            key={l.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${S.line}`,
              borderRadius: 999,
              padding: "3px 10px",
              background: S.panel,
              color: inkOf(S),
            }}
          >
            {l.name}
            {l.type && l.type !== "country" && (
              <span style={{ color: S.mut, fontSize: 10.5 }}>{l.type}</span>
            )}
            <button
              onClick={() => setLocs(locs.filter((x) => x.id !== l.id))}
              title="Entfernen"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: S.mut,
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative", maxWidth: 420, marginBottom: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Land, Kanton oder Region suchen … (z.B. Schweiz, Zürich)"
          style={{
            width: "100%",
            border: `1px solid ${S.line}`,
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 12.5,
            background: S.bg,
            color: inkOf(S),
            boxSizing: "border-box",
          }}
        />
        {(results.length > 0 || searching) && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              zIndex: 5,
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,.08)",
              marginTop: 4,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {searching && <div style={{ padding: "6px 10px", color: S.mut }}>Suche…</div>}
            {results.map((l) => (
              <div
                key={l.id}
                onClick={() => add(l)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  color: inkOf(S),
                }}
              >
                <span>{l.name}</span>
                <span style={{ color: S.mut, fontSize: 11 }}>
                  {[l.type, l.country_code].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSave(locs)} disabled={busy} style={btn(true)}>
          {busy ? "Speichere…" : "Targeting speichern"}
        </button>
        <button onClick={onCancel} style={btn(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/* ── Zielgruppen-Zuweisung je Kampagne (include / exclude) ─────────────────── */
function AudiencesEditor({
  S,
  audiences,
  initialInclude,
  initialExclude,
  busy,
  onSave,
  onCancel,
}: {
  S: Tokens;
  audiences: Audience[];
  initialInclude: string[];
  initialExclude: string[];
  busy: boolean;
  onSave: (includeIds: string[], excludeIds: string[]) => void;
  onCancel: () => void;
}) {
  const [incl, setIncl] = useState<Set<string>>(new Set(initialInclude));
  const [excl, setExcl] = useState<Set<string>>(new Set(initialExclude));
  const usable = audiences.filter((a) => a.status !== "archived");
  const toggle = (
    set: Set<string>,
    setter: (s: Set<string>) => void,
    other: Set<string>,
    otherSetter: (s: Set<string>) => void,
    id: string,
  ) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else {
      n.add(id);
      // Dieselbe Audience nie gleichzeitig ein- und ausschliessen (API-Regel).
      if (other.has(id)) {
        const o = new Set(other);
        o.delete(id);
        otherSetter(o);
      }
    }
    setter(n);
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    border: primary ? "none" : `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    background: primary ? accentOf(S) : "transparent",
    color: primary ? "#fff" : S.mut,
  });
  if (usable.length === 0)
    return (
      <div style={{ fontSize: 12.5, color: S.mut }}>
        Noch keine Zielgruppen vorhanden — im Bereich «Zielgruppen» eine Kundenliste hochladen.{" "}
        <button onClick={onCancel} style={btn(false)}>
          Schliessen
        </button>
      </div>
    );
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: inkOf(S) }}>
        Zielgruppen{" "}
        <span style={{ fontWeight: 400, color: S.mut }}>
          — Einschluss braucht ≥ 25'000 erreichbare Nutzer; Ausschluss (z.B. Bestandskunden) hat
          kein Minimum und Vorrang
        </span>
      </div>
      <table style={{ borderCollapse: "collapse", marginBottom: 10 }}>
        <thead>
          <tr style={{ color: S.mut, textAlign: "left", fontSize: 11.5 }}>
            <th style={{ padding: "4px 10px 4px 0" }}>Zielgruppe</th>
            <th style={{ padding: "4px 10px" }}>Grösse</th>
            <th style={{ padding: "4px 10px", textAlign: "center" }}>Einschliessen</th>
            <th style={{ padding: "4px 10px", textAlign: "center" }}>Ausschliessen</th>
          </tr>
        </thead>
        <tbody>
          {usable.map((a) => {
            const ready = a.status === "ready";
            return (
              <tr key={a.openai_audience_id} style={{ opacity: ready ? 1 : 0.6 }}>
                <td style={{ padding: "4px 10px 4px 0", color: inkOf(S), fontWeight: 600 }}>
                  {a.name}
                  {!ready && (
                    <span style={{ color: S.mut, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                      ({AUDIENCE_STATUS[a.status]?.[0] || a.status})
                    </span>
                  )}
                </td>
                <td style={{ padding: "4px 10px", color: S.mut }}>
                  {RANGE_LABEL[a.matched_user_count_range || ""] || "–"}
                </td>
                <td style={{ padding: "4px 10px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={incl.has(a.openai_audience_id)}
                    onChange={() => toggle(incl, setIncl, excl, setExcl, a.openai_audience_id)}
                  />
                </td>
                <td style={{ padding: "4px 10px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={excl.has(a.openai_audience_id)}
                    onChange={() => toggle(excl, setExcl, incl, setIncl, a.openai_audience_id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onSave(Array.from(incl), Array.from(excl))}
          disabled={busy}
          style={btn(true)}
        >
          {busy ? "Speichere…" : "Zuweisung speichern"}
        </button>
        <button onClick={onCancel} style={btn(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/* ── Bereich «Zielgruppen»: Kundenliste hochladen (gehasht) + Verwaltung ───── */
function AudiencesView({
  clientId,
  audiences,
  campaigns,
  isMock,
  S,
  card,
  canWrite,
  busy,
  run,
}: {
  clientId: string;
  audiences: Audience[];
  campaigns: Campaign[];
  isMock: boolean;
  S: Tokens;
  card: React.CSSProperties;
  canWrite: boolean;
  busy: string;
  run: (body: any, key: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [hashing, setHashing] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  // Eingabe (Textarea oder CSV) → normalisierte, gültige Identifikatoren.
  const parsed = useMemo(() => {
    const out = new Set<string>();
    let invalid = 0;
    for (const rawLine of text.split(/[\n,;]+/)) {
      const cell = rawLine.replace(/^"|"$/g, "").trim();
      if (!cell) continue;
      if (kind === "email") {
        const e = normEmail(cell);
        if (isEmail(e)) out.add(e);
        else if (!/^email/i.test(cell)) invalid++;
      } else {
        const p = normPhone(cell);
        if (/^\+\d{7,15}$/.test(p)) out.add(p);
        else if (!/^phone/i.test(cell)) invalid++;
      }
    }
    return { ids: Array.from(out), invalid };
  }, [text, kind]);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFileName(f.name);
    const t = await f.text();
    // CSV: erste Spalte, die wie eine Adresse/Nummer aussieht — Kopfzeile darf bleiben.
    setText(
      t
        .split(/\r?\n/)
        .map(
          (line) =>
            line
              .split(/[;,\t]/)
              .map((c) => c.trim())
              .find((c) => (kind === "email" ? c.includes("@") : /\d{6,}/.test(c))) || "",
        )
        .filter(Boolean)
        .join("\n"),
    );
  };

  const upload = async () => {
    if (name.trim().length < 3 || parsed.ids.length === 0) return;
    setHashing(true);
    setMsg("");
    const hashes = await Promise.all(parsed.ids.map((v) => sha256Hex(v)));
    setHashing(false);
    const ok = await run(
      {
        action: "audience-create",
        clientId,
        name: name.trim(),
        description: desc.trim(),
        identifierType: kind === "email" ? "email_sha256" : "phone_number_sha256",
        hashes,
      },
      "audience-create",
    );
    if (ok) {
      setMsg(
        `Zielgruppe «${name.trim()}» mit ${hashes.length} Identifikatoren hochgeladen — OpenAI gleicht jetzt ab.`,
      );
      setName("");
      setDesc("");
      setText("");
      setFileName("");
    }
  };

  // In wie vielen Kampagnen ist eine Audience ein-/ausgeschlossen?
  const usage = useMemo(() => {
    const m: Record<string, { incl: number; excl: number }> = {};
    for (const c of campaigns) {
      for (const id of c.targeting?.custom_audiences?.ids || [])
        (m[id] ??= { incl: 0, excl: 0 }).incl++;
      for (const id of c.targeting?.excluded_custom_audiences?.ids || [])
        (m[id] ??= { incl: 0, excl: 0 }).excl++;
    }
    return m;
  }, [campaigns]);

  const input: React.CSSProperties = {
    border: `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
    background: S.bg,
    color: inkOf(S),
    boxSizing: "border-box",
    width: "100%",
  };
  const busyCreate = busy === "audience-create" || hashing;
  const canUpload = canWrite && name.trim().length >= 3 && parsed.ids.length > 0 && !busyCreate;
  const active = audiences.filter((a) => a.status !== "archived");
  const archived = audiences.filter((a) => a.status === "archived");

  return (
    <>
      {canWrite && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Neue Zielgruppe</div>
          <div style={{ fontSize: 12, color: S.mut, lineHeight: 1.6, marginBottom: 12 }}>
            Kundenliste (E-Mail-Adressen oder Telefonnummern) hochladen — OpenAI gleicht sie mit
            ChatGPT-Nutzern ab. <b>Datenschutz:</b> Die Adressen werden hier im Browser
            SHA-256-gehasht; weder EzyHub noch OpenAI erhalten Klartext. Für <b>Einschluss</b>{" "}
            (Kampagne nur an diese Nutzer) braucht es ≥ 25'000 Treffer; für <b>Ausschluss</b> (z.B.
            Bestandskunden nicht bewerben) reicht jede Grösse.
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (z.B. Bestandskunden 2026)"
              style={input}
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Beschreibung (optional)"
              style={input}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              marginBottom: 8,
              fontSize: 12.5,
            }}
          >
            {(["email", "phone"] as const).map((k) => (
              <label
                key={k}
                style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
              >
                <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                {k === "email" ? "E-Mail-Adressen" : "Telefonnummern (E.164, CH-Default)"}
              </label>
            ))}
            <label
              style={{
                marginLeft: "auto",
                border: `1px solid ${S.line}`,
                borderRadius: 8,
                padding: "5px 12px",
                cursor: "pointer",
                color: inkOf(S),
                fontWeight: 600,
              }}
            >
              CSV wählen…
              <input
                type="file"
                accept=".csv,.txt"
                style={{ display: "none" }}
                onChange={(e) => onFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              kind === "email"
                ? "eine Adresse pro Zeile …\nmax.muster@example.ch\nanna@example.com"
                : "eine Nummer pro Zeile …\n+41 79 123 45 67\n079 987 65 43"
            }
            rows={6}
            style={{ ...input, fontFamily: "ui-monospace, monospace", resize: "vertical" }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 8,
              fontSize: 12,
              color: S.mut,
              flexWrap: "wrap",
            }}
          >
            <span>
              <b style={{ color: inkOf(S) }}>{parsed.ids.length.toLocaleString("de-CH")}</b> gültige
              {kind === "email" ? " Adressen" : " Nummern"}
              {parsed.invalid > 0 && ` · ${parsed.invalid} ungültig übersprungen`}
              {fileName && ` · Datei: ${fileName}`}
            </span>
            <button
              onClick={upload}
              disabled={!canUpload}
              style={{
                marginLeft: "auto",
                border: "none",
                borderRadius: 8,
                padding: "7px 16px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: canUpload ? "pointer" : "default",
                background: accentOf(S),
                color: "#fff",
                opacity: canUpload ? 1 : 0.5,
              }}
            >
              {hashing ? "Hashe…" : busy === "audience-create" ? "Lade hoch…" : "Gehasht hochladen"}
            </button>
          </div>
          {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: "#0f9d6c" }}>{msg}</div>}
        </div>
      )}

      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>Zielgruppen ({active.length})</div>
          {canWrite && !isMock && (
            <button
              onClick={() => run({ action: "audience-sync", clientId }, "audience-sync")}
              disabled={busy === "audience-sync"}
              style={{
                border: `1px solid ${S.line}`,
                borderRadius: 8,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: "transparent",
                color: inkOf(S),
              }}
            >
              {busy === "audience-sync" ? "Aktualisiere…" : "Status aktualisieren"}
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <div style={{ fontSize: 12.5, color: S.mut, padding: 16, textAlign: "center" }}>
            Noch keine Zielgruppen — oben eine Kundenliste hochladen.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: S.mut, textAlign: "left" }}>
                  {[
                    "Zielgruppe",
                    "Status",
                    "Erreichbare Nutzer",
                    "Typ",
                    "Hochgeladen",
                    "Kampagnen",
                    "Erstellt",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{ padding: "6px 10px", borderBottom: `1px solid ${S.line}` }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((a) => {
                  const [label, color] = AUDIENCE_STATUS[a.status] || [a.status, "#8b8da3"];
                  const u = usage[a.openai_audience_id];
                  const td: React.CSSProperties = {
                    padding: "8px 10px",
                    borderBottom: `1px solid ${S.line}22`,
                  };
                  return (
                    <tr key={a.openai_audience_id}>
                      <td style={{ ...td, fontWeight: 700, color: inkOf(S) }}>
                        {a.name}
                        {a.description && (
                          <div style={{ fontSize: 11, color: S.mut, fontWeight: 400 }}>
                            {a.description}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color,
                            border: `1px solid ${color}44`,
                            borderRadius: 99,
                            padding: "1px 8px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>
                      </td>
                      <td style={td}>{RANGE_LABEL[a.matched_user_count_range || ""] || "–"}</td>
                      <td style={{ ...td, color: S.mut }}>
                        {a.identifier_type?.startsWith("phone") ? "Telefon" : "E-Mail"}
                      </td>
                      <td style={td}>
                        {a.identifier_count != null ? fmtNum(a.identifier_count) : "–"}
                      </td>
                      <td style={{ ...td, color: S.mut }}>
                        {u
                          ? [u.incl ? `${u.incl} ein` : "", u.excl ? `${u.excl} aus` : ""]
                              .filter(Boolean)
                              .join(" · ")
                          : "–"}
                      </td>
                      <td style={{ ...td, color: S.mut, fontSize: 11 }}>{fmtTime(a.created_at)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {canWrite &&
                          (confirmArchive === a.openai_audience_id ? (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <span style={{ color: "#92400e", fontSize: 11.5 }}>Archivieren?</span>
                              <button
                                onClick={async () => {
                                  setConfirmArchive(null);
                                  await run(
                                    {
                                      action: "audience-archive",
                                      clientId,
                                      audienceId: a.openai_audience_id,
                                    },
                                    `archive:${a.openai_audience_id}`,
                                  );
                                }}
                                style={{
                                  border: "none",
                                  borderRadius: 8,
                                  padding: "3px 10px",
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  background: "#dc2626",
                                  color: "#fff",
                                }}
                              >
                                Ja
                              </button>
                              <button
                                onClick={() => setConfirmArchive(null)}
                                style={{
                                  border: `1px solid ${S.line}`,
                                  borderRadius: 8,
                                  padding: "3px 8px",
                                  fontSize: 11.5,
                                  cursor: "pointer",
                                  background: "transparent",
                                  color: S.mut,
                                }}
                              >
                                Nein
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmArchive(a.openai_audience_id)}
                              disabled={busy === `archive:${a.openai_audience_id}`}
                              title="Archivieren (wird aus allen Kampagnen entfernt)"
                              style={{
                                border: "none",
                                background: "transparent",
                                color: S.mut,
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              Archivieren
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {archived.length > 0 && (
          <div style={{ fontSize: 11.5, color: S.mut, marginTop: 10 }}>
            {archived.length} archiviert: {archived.map((a) => a.name).join(", ")}
          </div>
        )}
      </div>
    </>
  );
}

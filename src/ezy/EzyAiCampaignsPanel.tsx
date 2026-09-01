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

type Campaign = {
  openai_campaign_id: string;
  name: string;
  status: string;
  bidding_type: string | null;
  objective: string | null;
  budget_daily_micros: number | null;
  budget_lifetime_micros: number | null;
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
};

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
}: {
  clientId: string;
  clientName: string;
  range: ResolvedRange;
  S: Tokens;
  isOrgAdmin: boolean;
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
}: {
  clientId: string;
  data: ApiData;
  S: Tokens;
  card: React.CSSProperties;
  isOrgAdmin: boolean;
  onChanged: () => void;
}) {
  const acc = data.account!;
  const cur = acc.currency_code || "USD";
  const campaigns = data.campaigns || [];
  // Stabile Referenz fuer die useMemo-Abhaengigkeiten (eslint exhaustive-deps).
  const insights = useMemo(() => data.insights || [], [data.insights]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const run = async (body: any, key: string) => {
    setBusy(key);
    setErr("");
    const r = await apiPost(body);
    setBusy("");
    if (!r.ok) setErr(r.error || "Fehler");
    onChanged();
  };

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
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
          Kampagnen ({campaigns.length})
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
                  {["Kampagne", "Status", "Gebot", "Budget/Tag", "Spend", "Klicks", "CTR", ""].map(
                    (h) => (
                      <th
                        key={h}
                        style={{ padding: "6px 10px", borderBottom: `1px solid ${S.line}` }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <CampaignRow
                    key={c.openai_campaign_id}
                    c={c}
                    agg={perCampaign[c.openai_campaign_id]}
                    cur={cur}
                    S={S}
                    canWrite={isOrgAdmin}
                    busy={busy}
                    onCmd={(cmd, extra) =>
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
                      )
                    }
                  />
                ))}
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
}: {
  c: Campaign;
  agg?: { imp: number; clicks: number; spend: number; conv: number };
  cur: string;
  S: Tokens;
  canWrite: boolean;
  busy: string;
  onCmd: (cmd: string, extra?: any) => void;
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
  return (
    <tr>
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
      <td style={td}>{agg ? fmtMoney(agg.spend, cur) : "–"}</td>
      <td style={td}>{agg ? fmtNum(agg.clicks) : "–"}</td>
      <td style={td}>{agg && agg.imp ? `${ctr.toFixed(2)} %` : "–"}</td>
      <td style={{ ...td, color: S.mut, fontSize: 11 }}>{fmtTime(c.synced_at)}</td>
    </tr>
  );
}

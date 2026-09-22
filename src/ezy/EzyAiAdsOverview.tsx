// EzyAI — Ads-Modus, Dashboard «Leistungstrend» (15.09.2026): Nachbau der
// Übersicht des OpenAI Ads Managers — vier KPI-Kacheln (Ausgaben, Impressionen,
// Klicks, CPC) mit Δ zur Vorperiode, Segmentierung (Land/Gerät/Plattform),
// Kampagnen-Filter, Zeitraum 7T/14T/30T/Benutzerdefiniert und der überlagerte
// Linienchart (jede Reihe auf ihre eigene Skala normiert, wie im Ads Manager).
// Daten: gespeicherte Tages-Insights (/api/admin/chatgpt-ads GET) bzw. bei
// Segmentierung live via insights-breakdown (granularity daily).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";
import { isoDay, type ResolvedRange } from "@/ezy/data/rangeStore";

type Tokens = Record<string, string>;
type Row = {
  scope_openai_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number | null;
};
type Campaign = { openai_campaign_id: string; name: string; status: string };
type Segment = "none" | "country" | "device" | "platform";
type Period = "7" | "14" | "30" | "custom";
type Metric = "spend" | "impressions" | "clicks" | "cpc";

const METRICS: Array<{ key: Metric; label: string; color: string }> = [
  { key: "spend", label: "Ausgaben", color: "#e0609a" },
  { key: "impressions", label: "Impressionen", color: "#3b82f6" },
  { key: "clicks", label: "Klicks", color: "#f59e0b" },
  { key: "cpc", label: "CPC", color: "#16a34a" },
];
const SEG_COLORS = ["#77008C", "#3b82f6", "#f59e0b", "#16a34a", "#e0609a", "#0ea5e9", "#8b8da3"];

const fmtMoney = (n: number, cur: string) =>
  `${cur}${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("de-CH");
const dayLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}. ${["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."][d.getMonth()]}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const eachDay = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};

async function post(body: any) {
  const session = (await supabase.auth.getSession()).data.session;
  const r = await authedFetch("/api/admin/chatgpt-ads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ...j, ok: !!j.ok, error: j.error || (r.ok ? undefined : `HTTP ${r.status}`) };
}

export default function EzyAiAdsOverview({
  clientId,
  range,
  S,
  readOnly = false,
}: {
  clientId: string;
  range: ResolvedRange;
  S: Tokens;
  /** Kundenlogins (22.09.): keine Segmentierung — die laeuft ueber einen
   *  Admin-POST (insights-breakdown); alles andere ist reines Lesen. */
  readOnly?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("14");
  const [segment, setSegment] = useState<Segment>("none");
  const [campaignId, setCampaignId] = useState("");
  const [metric, setMetric] = useState<Metric>("impressions");
  const [data, setData] = useState<{
    connected: boolean;
    currency: string;
    campaigns: Campaign[];
    rows: Row[];
    error?: string;
  } | null>(null);
  const [segRows, setSegRows] = useState<Array<{
    date: string;
    label: string;
    impressions: number;
    clicks: number;
    spend: number;
  }> | null>(null);
  const [segErr, setSegErr] = useState("");

  // Zeitraum: 7/14/30 Tage bis heute; «Benutzerdefiniert» = globaler Filter.
  const today = new Date().toISOString().slice(0, 10);
  const end = period === "custom" ? isoDay(range.end) : today;
  const start = period === "custom" ? isoDay(range.start) : addDays(today, -(Number(period) - 1));
  const days = eachDay(start, end).length;
  const prevStart = addDays(start, -days);
  const prevEnd = addDays(start, -1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await authedFetch(
          `/api/admin/chatgpt-ads?client=${encodeURIComponent(clientId)}&start=${prevStart}&end=${end}`,
          { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
        );
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!j.ok)
          setData({ connected: false, currency: "CHF", campaigns: [], rows: [], error: j.error });
        else
          setData({
            connected: !!j.connected,
            currency: j.account?.currency_code || "CHF",
            campaigns: j.campaigns || [],
            rows: j.insights || [],
          });
      } catch (e: any) {
        if (alive)
          setData({
            connected: false,
            currency: "CHF",
            campaigns: [],
            rows: [],
            error: String(e?.message || e),
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, prevStart, end]);

  const loadSegment = useCallback(async () => {
    if (segment === "none") {
      setSegRows(null);
      return;
    }
    setSegErr("");
    const j = await post({
      action: "insights-breakdown",
      clientId,
      segment,
      campaignId: campaignId || undefined,
      start,
      end,
      granularity: "daily",
    });
    if (!j.ok) {
      setSegErr(j.error || "Fehler");
      setSegRows([]);
      return;
    }
    setSegRows(j.rows || []);
  }, [segment, clientId, campaignId, start, end]);
  useEffect(() => {
    loadSegment();
  }, [loadSegment]);

  const rows = useMemo(
    () => (data?.rows || []).filter((r) => !campaignId || r.scope_openai_id === campaignId),
    [data, campaignId],
  );
  const sum = (from: string, to: string) => {
    let spend = 0,
      imp = 0,
      clk = 0;
    for (const r of rows)
      if (r.date >= from && r.date <= to) {
        spend += Number(r.spend || 0);
        imp += Number(r.impressions || 0);
        clk += Number(r.clicks || 0);
      }
    return {
      spend,
      imp,
      clk,
      cpc: clk ? spend / clk : 0,
      any: rows.some((r) => r.date >= from && r.date <= to),
    };
  };
  const cur = sum(start, end);
  const prev = sum(prevStart, prevEnd);
  const delta = (a: number, b: number) => (prev.any && b > 0 ? ((a - b) / b) * 100 : null);

  // Tagesreihe (ohne Segmentierung): alle 4 Metriken, für den Chart auf 0–100 normiert.
  const series = useMemo(() => {
    const byDay: Record<string, { spend: number; impressions: number; clicks: number }> = {};
    for (const d of eachDay(start, end)) byDay[d] = { spend: 0, impressions: 0, clicks: 0 };
    for (const r of rows)
      if (byDay[r.date]) {
        byDay[r.date].spend += Number(r.spend || 0);
        byDay[r.date].impressions += Number(r.impressions || 0);
        byDay[r.date].clicks += Number(r.clicks || 0);
      }
    const pts = Object.entries(byDay).map(([date, v]) => ({
      date,
      spend: v.spend,
      impressions: v.impressions,
      clicks: v.clicks,
      cpc: v.clicks ? v.spend / v.clicks : 0,
    }));
    const max: Record<Metric, number> = { spend: 0, impressions: 0, clicks: 0, cpc: 0 };
    for (const p of pts) for (const m of METRICS) max[m.key] = Math.max(max[m.key], p[m.key]);
    return pts.map((p) => ({
      ...p,
      label: dayLabel(p.date),
      ...Object.fromEntries(
        METRICS.map((m) => [`n_${m.key}`, max[m.key] ? (p[m.key] / max[m.key]) * 100 : 0]),
      ),
    }));
  }, [rows, start, end]);

  // Segment-Reihen: eine Linie je Segmentwert für die gewählte Metrik.
  const segSeries = useMemo(() => {
    if (!segRows) return null;
    const labels = Array.from(new Set(segRows.map((r) => r.label)));
    const totals: Record<string, number> = {};
    for (const r of segRows) totals[r.label] = (totals[r.label] || 0) + r.impressions;
    labels.sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
    const top = labels.slice(0, 7);
    const byDay: Record<string, any> = {};
    for (const d of eachDay(start, end)) byDay[d] = { date: d, label: dayLabel(d) };
    for (const r of segRows) {
      if (!byDay[r.date] || !top.includes(r.label)) continue;
      const v =
        metric === "cpc"
          ? r.clicks
            ? r.spend / r.clicks
            : 0
          : metric === "spend"
            ? r.spend
            : metric === "clicks"
              ? r.clicks
              : r.impressions;
      byDay[r.date][r.label] = (byDay[r.date][r.label] || 0) + v;
    }
    return { labels: top, pts: Object.values(byDay) };
  }, [segRows, metric, start, end]);

  const card: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
  };
  const sel: React.CSSProperties = {
    border: `1px solid ${S.line}`,
    borderRadius: 999,
    padding: "7px 14px",
    fontSize: 12.5,
    background: S.bg,
    color: S.txt,
    fontFamily: "inherit",
  };
  const cf = data?.currency || "CHF";

  if (data === null)
    return (
      <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
        Lade Leistungstrend…
      </div>
    );
  if (!data.connected)
    return (
      <div style={{ ...card, padding: 18, fontSize: 12.5, color: S.mut, lineHeight: 1.6 }}>
        {data.error ||
          "Kein ChatGPT-Ads-Konto verbunden — unter «Kampagnen» den API-Key hinterlegen, danach erscheinen hier Ausgaben, Impressionen, Klicks und CPC wie im Ads Manager."}
      </div>
    );

  const metricLabel = METRICS.find((m) => m.key === metric)!.label;
  const fmtMetric = (m: Metric, v: number) =>
    m === "spend" || m === "cpc" ? fmtMoney(v, cf) : fmtNum(v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Kopfzeile: Titel + Filter (wie Ads Manager) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: S.txt, marginRight: "auto" }}>
          Leistungstrend
        </div>
        {!readOnly && (
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment)}
            style={sel}
          >
            <option value="none">Keine Segmentierung</option>
            <option value="country">Nach Land</option>
            <option value="device">Nach Gerät</option>
            <option value="platform">Nach Plattform</option>
          </select>
        )}
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={{ ...sel, maxWidth: 260 }}
        >
          <option value="">Alle Kampagnen</option>
          {data.campaigns.map((c) => (
            <option key={c.openai_campaign_id} value={c.openai_campaign_id}>
              {c.name}
            </option>
          ))}
        </select>
        <div
          style={{
            display: "inline-flex",
            background: S.bg,
            border: `1px solid ${S.line}`,
            borderRadius: 999,
            padding: 3,
          }}
        >
          {(
            [
              ["7", "7T"],
              ["14", "14T"],
              ["30", "30T"],
              ["custom", "Benutzerdefiniert"],
            ] as Array<[Period, string]>
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              title={k === "custom" ? "Zeitraum aus dem Filter oben" : undefined}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 12.5,
                fontWeight: period === k ? 700 : 500,
                cursor: "pointer",
                background: period === k ? S.panel : "transparent",
                color: period === k ? S.txt : S.mut,
                boxShadow: period === k ? "0 1px 3px rgba(0,0,0,.08)" : "none",
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        {/* KPI-Kacheln — Klick wählt die Metrik für den Segment-Chart */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderBottom: `1px solid ${S.line}`,
          }}
        >
          {METRICS.map((m, i) => {
            const val =
              m.key === "spend"
                ? cur.spend
                : m.key === "impressions"
                  ? cur.imp
                  : m.key === "clicks"
                    ? cur.clk
                    : cur.cpc;
            const pv =
              m.key === "spend"
                ? prev.spend
                : m.key === "impressions"
                  ? prev.imp
                  : m.key === "clicks"
                    ? prev.clk
                    : prev.cpc;
            const d = delta(val, pv);
            const active = segment !== "none" && metric === m.key;
            return (
              <div
                key={m.key}
                onClick={() => setMetric(m.key)}
                style={{
                  padding: "16px 22px",
                  borderLeft: i ? `1px solid ${S.line}` : "none",
                  cursor: segment !== "none" ? "pointer" : "default",
                  background: active ? `${m.color}0d` : "transparent",
                  borderTop: active ? `3px solid ${m.color}` : "3px solid transparent",
                }}
                title={segment !== "none" ? "Metrik für die Segment-Linien wählen" : undefined}
              >
                <div style={{ fontSize: 12.5, color: S.mut }}>{m.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 600,
                      color: S.txt,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-.01em",
                    }}
                  >
                    {fmtMetric(m.key, val)}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: d == null ? S.mut : d >= 0 ? "#16a34a" : "#dc2626",
                    }}
                    title={`vs. Vorperiode ${dayLabel(prevStart)} – ${dayLabel(prevEnd)}`}
                  >
                    {d == null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(0)} %`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart */}
        <div style={{ padding: "18px 12px 8px", height: 380 }}>
          {segment === "none" ? (
            series.every((p) => !p.impressions && !p.spend) ? (
              <div style={{ color: S.mut, fontSize: 12.5, padding: 40, textAlign: "center" }}>
                Keine Daten im Zeitraum {dayLabel(start)} – {dayLabel(end)}. Der Sync holt die
                letzten 31 Tage aus dem OpenAI-Konto.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={S.line} strokeDasharray="0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: S.mut }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: `1px solid ${S.line}`, fontSize: 12 }}
                    labelStyle={{ fontWeight: 700 }}
                    formatter={(v: any, name: any, item: any) => {
                      const m = METRICS.find((x) => `n_${x.key}` === item.dataKey);
                      if (!m) return [v, name];
                      return [fmtMetric(m.key, item.payload[m.key]), m.label];
                    }}
                  />
                  <Legend
                    iconType="plainline"
                    wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
                    formatter={(v: any) => METRICS.find((m) => `n_${m.key}` === v)?.label || v}
                  />
                  {METRICS.map((m) => (
                    <Line
                      key={m.key}
                      type="linear"
                      dataKey={`n_${m.key}`}
                      stroke={m.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )
          ) : segErr ? (
            <div style={{ color: "#b91c1c", fontSize: 12.5, padding: 40, textAlign: "center" }}>
              {segErr}
            </div>
          ) : !segSeries ? (
            <div style={{ color: S.mut, fontSize: 12.5, padding: 40, textAlign: "center" }}>
              Lade Segmentierung…
            </div>
          ) : segSeries.labels.length === 0 ? (
            <div style={{ color: S.mut, fontSize: 12.5, padding: 40, textAlign: "center" }}>
              Keine Segment-Daten im Zeitraum.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={segSeries.pts} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={S.line} strokeDasharray="0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: S.mut }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: S.mut }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v: any) =>
                    metric === "spend" || metric === "cpc"
                      ? Number(v).toFixed(metric === "cpc" ? 2 : 0)
                      : fmtNum(v)
                  }
                />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: `1px solid ${S.line}`, fontSize: 12 }}
                  labelStyle={{ fontWeight: 700 }}
                  formatter={(v: any, name: any) => [fmtMetric(metric, Number(v)), name]}
                />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                {segSeries.labels.map((l, i) => (
                  <Line
                    key={l}
                    type="linear"
                    dataKey={l}
                    name={l}
                    stroke={SEG_COLORS[i % SEG_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        {segment !== "none" && (
          <div style={{ padding: "0 22px 14px", fontSize: 11.5, color: S.mut }}>
            {metricLabel} je{" "}
            {segment === "country" ? "Land" : segment === "device" ? "Gerät" : "Plattform"} — Metrik
            über die Kacheln wechseln.
          </div>
        )}
      </div>
    </div>
  );
}

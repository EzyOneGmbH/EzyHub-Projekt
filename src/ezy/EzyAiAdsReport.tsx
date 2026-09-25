// Tab «Report» im Ads-Modus (Volkan 25.09.2026): GA4 (Quelle ChatGPT / CPC)
// und OpenAI Ads kombiniert — je Kampagne, aufklappbar nach Region, plus
// Regionen gesamt. Daten: /api/admin/chatgpt-ads-report.
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";
import { isoDay, useRangeData, type ResolvedRange } from "@/ezy/data/rangeStore";

type Tokens = Record<string, string>;
type AdsM = { impressions: number; clicks: number; spend: number; conversions: number | null };
type Ga4M = { sessions: number; users: number; conversions: number };
type Region = { country: string; ads: AdsM | null; ga4: Ga4M | null };
type Campaign = {
  key: string;
  name: string;
  status: string | null;
  ga4Campaign: string | null;
  ads: AdsM | null;
  ga4: Ga4M | null;
  regions: Region[];
};
type Report = {
  ok: true;
  account: { name: string | null; currency: string; isMock: boolean } | null;
  ga4: { connected: boolean; error?: string };
  adsCountryError?: string;
  totals: { ads: AdsM; ga4: Ga4M };
  campaigns: Campaign[];
  regions: Region[];
};

const nf = (n: number) => Math.round(n).toLocaleString("de-CH");
const pct = (a: number, b: number) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("de-CH", { maximumFractionDigits: 2 })} %` : "—";
const money = (v: number | null, cur: string, digits = 2) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `${v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${cur}`;
const cpc = (m: AdsM | null) => (m && m.clicks > 0 ? m.spend / m.clicks : null);
const cpm = (m: AdsM | null) => (m && m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null);

// Spalten: Ads-Metriken, dann GA4. Conv. in Regionen = GA4 (die Ads-API
// liefert Conversions nicht je Land).
const COLS = [
  "Impr.",
  "Klicks",
  "CTR",
  "Ø CPC",
  "Ø CPM",
  "Spend",
  "Conv. (Ads)",
  "Sessions (GA4)",
  "Nutzer (GA4)",
  "Conv. (GA4)",
];

function Cells({
  ads,
  ga4,
  cur,
  S,
}: {
  ads: AdsM | null;
  ga4: Ga4M | null;
  cur: string;
  S: Tokens;
}) {
  const td = (v: string, strong = false, ga = false) => (
    <td
      style={{
        padding: "8px 10px",
        textAlign: "right",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        color: v === "—" ? S.mut : S.txt,
        fontWeight: strong ? 600 : 400,
        background: ga ? "rgba(119,0,140,.035)" : undefined,
      }}
    >
      {v}
    </td>
  );
  return (
    <>
      {td(ads ? nf(ads.impressions) : "—")}
      {td(ads ? nf(ads.clicks) : "—", true)}
      {td(ads ? pct(ads.clicks, ads.impressions) : "—")}
      {td(money(cpc(ads), cur))}
      {td(money(cpm(ads), cur))}
      {td(ads ? money(ads.spend, cur) : "—", true)}
      {td(ads && ads.conversions != null ? nf(ads.conversions) : "—")}
      {td(ga4 ? nf(ga4.sessions) : "—", true, true)}
      {td(ga4 ? nf(ga4.users) : "—", false, true)}
      {td(ga4 ? nf(ga4.conversions) : "—", false, true)}
    </>
  );
}

export default function EzyAiAdsReport({
  clientId,
  range,
  S,
}: {
  clientId: string;
  range: ResolvedRange;
  S: Tokens;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const key = `ads-report:v1:${clientId}:${isoDay(range.start)}:${isoDay(range.end)}`;
  const rep = useRangeData<Report>(key, async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await authedFetch(
      `/api/admin/chatgpt-ads-report?client=${encodeURIComponent(clientId)}&start=${isoDay(range.start)}&end=${isoDay(range.end)}`,
      { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) {
      setErr(j?.error || `HTTP ${r.status}`);
      return null;
    }
    setErr(null);
    return j as Report;
  });
  const d = rep.data;
  const cur = d?.account?.currency || "CHF";
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const card: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 20,
  };
  const th: React.CSSProperties = {
    padding: "6px 10px",
    textAlign: "right",
    fontSize: 11,
    fontWeight: 600,
    color: S.mut,
    textTransform: "uppercase",
    letterSpacing: ".04em",
    whiteSpace: "nowrap",
  };
  const head = (first: string) => (
    <thead>
      <tr>
        <th style={{ ...th, textAlign: "left" }}>{first}</th>
        {COLS.map((c, i) => (
          <th key={c} style={{ ...th, background: i >= 7 ? "rgba(119,0,140,.035)" : undefined }}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (!d)
    return (
      <div style={{ ...card, color: err ? "#c0392b" : S.mut, fontSize: 13 }}>
        {err ? `Report konnte nicht geladen werden: ${err}` : "Report wird geladen…"}
      </div>
    );

  const t = d.totals;
  const kpis: Array<[string, string, string?]> = [
    ["Impressionen", nf(t.ads.impressions)],
    ["Klicks", nf(t.ads.clicks)],
    ["CTR", pct(t.ads.clicks, t.ads.impressions)],
    ["Ø CPC", money(cpc(t.ads), cur)],
    ["Ø CPM", money(cpm(t.ads), cur)],
    ["Spend", money(t.ads.spend, cur)],
    ["Conversions (Ads)", t.ads.conversions != null ? nf(t.ads.conversions) : "—"],
    ["Sessions (GA4)", nf(t.ga4.sessions), "ga4"],
    ["Conversions (GA4)", nf(t.ga4.conversions), "ga4"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: S.txt }}>Report</h2>
          <span style={{ fontSize: 12, color: S.mut }}>
            {range.label} · ChatGPT Ads + GA4 (Quelle ChatGPT / CPC)
            {d.account?.isMock ? " · Demo-Konto" : ""}
            {rep.loading ? " · aktualisiert…" : ""}
          </span>
        </div>
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 10,
          }}
        >
          {kpis.map(([l, v, ga]) => (
            <div
              key={l}
              style={{
                border: `1px solid ${S.line}`,
                borderRadius: 10,
                padding: "10px 12px",
                background: ga ? "rgba(119,0,140,.035)" : S.bg,
              }}
            >
              <div style={{ fontSize: 11, color: S.mut }}>{l}</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: S.txt,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        {(d.ga4.error || d.adsCountryError || !d.account) && (
          <div style={{ marginTop: 12, fontSize: 12, color: S.mut, lineHeight: 1.5 }}>
            {!d.account && <div>Kein ChatGPT-Ads-Konto verbunden — nur GA4-Daten.</div>}
            {d.ga4.error && <div>GA4: {d.ga4.error}</div>}
            {d.adsCountryError && (
              <div>Regionen aus ChatGPT Ads nicht verfügbar: {d.adsCountryError}</div>
            )}
          </div>
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: S.txt }}>
          Kampagnen
        </h3>
        <div style={{ fontSize: 12, color: S.mut, marginBottom: 10 }}>
          Zeile anklicken für die Regionen. Violett hinterlegt = GA4. Kampagnen werden über den
          UTM-Kampagnennamen verbunden.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
            {head("Kampagne")}
            <tbody>
              {d.campaigns.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: 16, color: S.mut, textAlign: "center" }}>
                    Keine Kampagnendaten im gewählten Zeitraum.
                  </td>
                </tr>
              )}
              {d.campaigns.map((c) => {
                const isOpen = open.has(c.key);
                return (
                  <Fragment key={c.key}>
                    <tr
                      onClick={() => c.regions.length && toggle(c.key)}
                      style={{
                        borderTop: `1px solid ${S.line}`,
                        cursor: c.regions.length ? "pointer" : "default",
                      }}
                    >
                      <td
                        style={{
                          padding: "8px 10px",
                          color: S.txt,
                          fontWeight: 600,
                          minWidth: 220,
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <ChevronRight
                            size={13}
                            style={{
                              color: S.mut,
                              opacity: c.regions.length ? 1 : 0,
                              transform: isOpen ? "rotate(90deg)" : "none",
                              transition: "transform .15s",
                            }}
                          />
                          {c.name}
                        </span>
                        <div
                          style={{ fontSize: 11, fontWeight: 400, color: S.mut, marginLeft: 19 }}
                        >
                          {!c.ads
                            ? "nur GA4"
                            : !c.ga4
                              ? "keine GA4-Sessions zugeordnet"
                              : `GA4: ${c.ga4Campaign}`}
                          {c.status ? ` · ${c.status}` : ""}
                        </div>
                      </td>
                      <Cells ads={c.ads} ga4={c.ga4} cur={cur} S={S} />
                    </tr>
                    {isOpen &&
                      c.regions.map((r) => (
                        <tr key={c.key + r.country} style={{ borderTop: `1px dashed ${S.line}` }}>
                          <td style={{ padding: "6px 10px 6px 34px", color: S.mut }}>
                            {r.country}
                          </td>
                          <Cells ads={r.ads} ga4={r.ga4} cur={cur} S={S} />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: S.txt }}>Regionen</h3>
        <div style={{ fontSize: 12, color: S.mut, marginBottom: 10 }}>
          Alle Kampagnen zusammen, je Land. Conversions je Land liefert nur GA4.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
            {head("Land")}
            <tbody>
              {d.regions.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: 16, color: S.mut, textAlign: "center" }}>
                    Keine Regionsdaten im gewählten Zeitraum.
                  </td>
                </tr>
              )}
              {d.regions.map((r) => (
                <tr key={r.country} style={{ borderTop: `1px solid ${S.line}` }}>
                  <td style={{ padding: "8px 10px", color: S.txt, fontWeight: 600 }}>
                    {r.country}
                  </td>
                  <Cells ads={r.ads} ga4={r.ga4} cur={cur} S={S} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

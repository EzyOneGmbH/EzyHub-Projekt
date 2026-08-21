// EzyPerformance / Google-Ads-Dashboard (aus EzyOneApp.jsx extrahiert,
// 21.08.2026 — reines Verschieben).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Btn } from "./shared-ui";
import { C } from "./theme";
import { CompareBanner, KpiCard, LiveEmptyState } from "./ui-kit";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import { googleAdsFromResult, useEzyLatestRun } from "@/ezy/data/useEzyLatestRun";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle, DollarSign, TrendingUp } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// ADS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
export function AdsDashboard({ selectedClient, dateRange }) {
  const { isOn } = useEzyDashboardConfig();
  const { run, loading, refresh } = useEzyLatestRun(selectedClient?.id, "google_ads");
  const ads = googleAdsFromResult(run?.result);
  const {
    totals,
    ctr,
    cpc,
    cpa,
    roas,
    series: rawSeries,
    campaigns,
    conversionActions,
    primary,
    prev,
  } = ads;
  const hasData = totals.cost + totals.clicks + totals.impressions + totals.conversions > 0;
  const days = dateRange?.days || 30;
  const series = useMemo(() => (rawSeries || []).slice(-days), [rawSeries, days]);

  // Formatting + delta helpers (Swiss CHF, tabular).
  const chf = (n, dec = 0) =>
    `CHF ${Number(n || 0).toLocaleString("de-CH", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  const numCH = (n) => Number(n || 0).toLocaleString("de-CH");
  const delta = (cur, prv) => {
    if (!prv || prv <= 0) return null;
    return Math.round(((cur - prv) / prv) * 1000) / 10; // one decimal, %
  };
  // Primary conversion = highest-value conversion action (e.g. bookings).
  const primaryName = primary?.name || "Conversions";
  const primaryCount = primary?.count ?? totals.conversions;
  const primaryValue = primary?.value ?? totals.conversionValue;
  const primaryDelta = delta(primaryCount, prev.primaryCount);
  const costPerPrimary = primaryCount > 0 ? totals.cost / primaryCount : 0;
  const primaryRate = totals.clicks > 0 ? (primaryCount / totals.clicks) * 100 : 0;
  const avgPrimaryValue = primaryCount > 0 ? primaryValue / primaryCount : 0;
  const maxCampRevenue = campaigns.reduce((m, c) => Math.max(m, c.conversionValue || 0), 0);
  const [showDiag, setShowDiag] = useState(true);

  // Small delta badge (▲/▼ with up=good unless inverted).
  const DeltaBadge = ({ value, invert = false, basis }) => {
    if (value == null)
      return basis ? <span style={{ fontSize: 11, color: C.textDim }}>{basis}</span> : null;
    const good = invert ? value < 0 : value > 0;
    const up = value > 0;
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: good ? C.green : C.red,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)} %
        {basis && <span style={{ color: C.textDim, fontWeight: 400 }}>{basis}</span>}
      </span>
    );
  };

  // Manual refresh via live route — uses selected date range + comparison period.
  const [pulling, setPulling] = useState(false);
  const lastDaysRef = useRef(days);
  const compareKey = dateRange?.compare
    ? `${dateRange.compareMode}:${new Date(dateRange.compare.start).toISOString().slice(0, 10)}`
    : "none";
  const lastCompareRef = useRef(compareKey);
  const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
  const pull = useCallback(
    async (forceDays, silent = false) => {
      const d = forceDays ?? days;
      if (!selectedClient?.id) return;
      if (!silent) setPulling(true);
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const body = { clientId: selectedClient.id, days: d };
        if (dateRange?.compare) {
          body.compareStart = isoDate(dateRange.compare.start);
          body.compareEnd = isoDate(dateRange.compare.end);
        }
        await fetch("/api/google/ads-data", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        await refresh();
      } catch {
        /* ignore */
      } finally {
        if (!silent) setPulling(false);
      }
    },
    [selectedClient?.id, days, refresh, dateRange?.compare],
  );

  // Auto-refresh when date range changes — silent background fetch, instant local filter via useMemo.
  useEffect(() => {
    if (hasData && days !== lastDaysRef.current) {
      lastDaysRef.current = days;
      // Only fetch if new range is larger than cached data (need more data from API).
      if (days > (rawSeries?.length || 0)) {
        pull(days, true);
      }
    }
  }, [days, hasData, rawSeries?.length, pull]);

  // Re-fetch when the comparison period changes so prev-totals reflect Vormonat/Vorjahr.
  useEffect(() => {
    if (hasData && compareKey !== lastCompareRef.current) {
      lastCompareRef.current = compareKey;
      pull(days, true);
    }
  }, [compareKey, hasData, days, pull]);

  if (loading) {
    return <div style={{ color: C.textMuted, padding: 20 }}>Lade Ads-Daten…</div>;
  }
  if (!hasData) {
    return (
      <LiveEmptyState
        title="Noch keine Ads-Daten"
        hint={
          selectedClient?.googleAdsCustomer
            ? "Google Ads Customer ID ist hinterlegt. Klicke 'Aktualisieren' um Daten zu laden."
            : "Bitte zuerst unter 'Google verbinden' eine Google Ads Customer ID hinterlegen."
        }
        action={
          selectedClient?.googleAdsCustomer && (
            <Btn onClick={pull} disabled={pulling}>
              {pulling ? "Lädt…" : "⟳ Aktualisieren"}
            </Btn>
          )
        }
      />
    );
  }

  const eyebrow = (n, label, accent) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: C.textMuted,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: accent ? C.orange : C.text,
          color: accent ? "#fff" : C.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0,
          flex: "none",
        }}
      >
        {n}
      </span>
      {label}
    </div>
  );
  const arrow = (
    <div
      className="ads-arrow"
      style={{ display: "flex", alignItems: "center", color: C.textDim, fontSize: 24 }}
    >
      →
    </div>
  );
  const convTotalCount = conversionActions.reduce((a, c) => a + c.count, 0) || totals.conversions;
  const convTotalValue =
    conversionActions.reduce((a, c) => a + c.value, 0) || totals.conversionValue;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CompareBanner dateRange={dateRange} />
      {/* ===== EBENE 1 — HERO ===== */}
      <div
        style={{
          background: `linear-gradient(135deg,${C.orange}1f,${C.card}), ${C.card}`,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "26px 30px 24px",
        }}
      >
        <div
          className="ads-hero-head"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {eyebrow("1", "Was hat Google Ads gebracht?", true)}
            <span
              style={{
                fontSize: 11,
                color: C.textDim,
                background: C.bg,
                padding: "4px 10px",
                borderRadius: 6,
                fontWeight: 500,
              }}
            >
              Letzte {days} Tage
            </span>
          </div>
          <Btn onClick={pull} disabled={pulling}>
            {pulling ? "Lädt…" : "⟳ Aktualisieren"}
          </Btn>
        </div>
        <div
          className="ads-flow"
          style={{
            display: "flex",
            alignItems: "stretch",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div className="ads-stat" style={{ flex: "1 1 200px", minWidth: 160 }}>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 6 }}>Werbebudget</div>
            <div
              className="ads-val"
              style={{
                fontSize: "clamp(28px,4.4vw,42px)",
                fontWeight: 800,
                color: C.text,
                lineHeight: 1,
              }}
            >
              {chf(totals.cost)}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 7 }}>
              eingesetzt für Anzeigen
            </div>
          </div>
          {arrow}
          <div
            className="ads-roas"
            style={{
              flex: "0 0 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 8px",
            }}
          >
            <div
              style={{
                fontSize: "clamp(32px,5vw,48px)",
                fontWeight: 800,
                color: C.orange,
                lineHeight: 1,
              }}
            >
              {roas.toFixed(2).replace(".", ",")}
              <span style={{ fontSize: ".55em" }}>×</span>
            </div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: C.textMuted,
                marginTop: 8,
              }}
            >
              ROAS
            </div>
          </div>
          {arrow}
          <div
            className="ads-stat ads-stat-right"
            style={{ flex: "1 1 200px", minWidth: 160, textAlign: "right" }}
          >
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 6 }}>
              Umsatz generiert
            </div>
            <div
              className="ads-val"
              style={{
                fontSize: "clamp(28px,4.4vw,42px)",
                fontWeight: 800,
                color: C.text,
                lineHeight: 1,
              }}
            >
              {chf(totals.conversionValue)}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 7 }}>
              aus {numCH(Math.round(totals.conversions))} Conversions
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: C.border, margin: "22px 0 16px" }} />
        {(() => {
          const cps = campaigns.filter((c) => c.cost > 0);
          const best = [...cps].sort((a, b) => b.roas - a.roas)[0];
          const under = cps
            .filter((c) => c.roas > 0 && c.roas < 1)
            .sort((a, b) => a.roas - b.roas)[0];
          return (
            <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: C.orange,
                  marginTop: 7,
                  flex: "none",
                }}
              />
              <p style={{ fontSize: 14, lineHeight: 1.55, color: C.textMuted, maxWidth: "80ch" }}>
                <strong style={{ color: C.text, fontWeight: 600 }}>
                  Jeder investierte Franken bringt CHF {roas.toFixed(2).replace(".", ",")} zurück.
                </strong>{" "}
                {best && best.roas > 0 && (
                  <>
                    {best.name} ist mit {best.roas.toFixed(1).replace(".", ",")}× der stärkste
                    Treiber.{" "}
                  </>
                )}
                {under && (
                  <>
                    Einzig {under.name} liegt mit {under.roas.toFixed(2).replace(".", ",")}× unter
                    der Gewinnschwelle und sollte überprüft werden.
                  </>
                )}
              </p>
            </div>
          );
        })()}
      </div>

      {/* ===== EBENE 2 — PRIMÄR-CONVERSION IM FOKUS ===== */}
      {isOn("ads.kpis") && (
        <div>
          {eyebrow("2", `${primaryName} im Fokus`, false)}
          <div
            className="dash-kpis"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}
          >
            <KpiCard
              icon={CheckCircle}
              label={`${primaryName} über Google Ads`}
              value={numCH(Math.round(primaryCount))}
              color={C.orange}
              change={primaryDelta != null ? Math.round(primaryDelta) : undefined}
            />
            <KpiCard
              icon={DollarSign}
              label={`Werbekosten je ${primaryName}`}
              value={costPerPrimary > 0 ? chf(costPerPrimary) : "—"}
              color={C.blue}
            />
            <KpiCard
              icon={Activity}
              label={`${primaryName}-Rate (von Klicks)`}
              value={primaryRate > 0 ? `${primaryRate.toFixed(2).replace(".", ",")} %` : "—"}
              color={C.green}
            />
            <KpiCard
              icon={TrendingUp}
              label={`Ø Wert pro ${primaryName}`}
              value={avgPrimaryValue > 0 ? chf(avgPrimaryValue) : "—"}
              color={C.pink}
            />
          </div>
        </div>
      )}

      {/* ===== EBENE 2 — DETAIL ROW ===== */}
      <div
        className="split-pane"
        style={{
          display: "grid",
          gridTemplateColumns: "0.85fr 1.15fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* Conversion breakdown */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Woher kommt der Wert?</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>
            Conversion-Typen getrennt
          </div>
          {conversionActions.length === 0 && (
            <div style={{ fontSize: 13, color: C.textDim, padding: "8px 0" }}>
              Keine Conversion-Typen verfügbar.
            </div>
          )}
          {conversionActions.slice(0, 6).map((a, i) => (
            <div
              key={a.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
              }}
            >
              <div
                style={{ fontSize: 14, fontWeight: 500, color: a.count > 0 ? C.text : C.textMuted }}
              >
                {a.name}
              </div>
              <div style={{ textAlign: "right" }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: a.count > 0 ? C.text : C.textMuted,
                  }}
                >
                  {numCH(Math.round(a.count))}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: C.textMuted }}>
                  {a.value > 0 ? chf(a.value) : "–"}
                </span>
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 13,
              marginTop: 6,
              borderTop: `2px solid ${C.text}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Gesamt</div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                {numCH(Math.round(convTotalCount))}
              </span>
              <span style={{ display: "block", fontSize: 11.5, color: C.textMuted }}>
                {chf(convTotalValue)}
              </span>
            </div>
          </div>
        </div>

        {/* Campaign bars by revenue */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
            Top-Kampagnen nach Umsatz
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
            Balken = generierter Umsatz · Chip = ROAS
          </div>
          {campaigns
            .filter((c) => c.conversionValue > 0)
            .slice(0, 8)
            .map((c, i) => {
              const pct =
                maxCampRevenue > 0 ? Math.max(3, (c.conversionValue / maxCampRevenue) * 100) : 0;
              const warn = c.roas > 0 && c.roas < 1;
              const chipBg = warn
                ? `${C.red}22`
                : c.roas >= 5
                  ? `${C.green}22`
                  : `rgba(93,85,99,.14)`;
              const chipCol = warn ? C.red : c.roas >= 5 ? C.green : C.textMuted;
              return (
                <div key={i} style={{ marginBottom: 13 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 5,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: C.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                        {chf(c.conversionValue)}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: 20,
                          background: chipBg,
                          color: chipCol,
                        }}
                      >
                        {c.roas.toFixed(1).replace(".", ",")}×
                      </span>
                    </span>
                  </div>
                  <div style={{ height: 8, background: C.bg, borderRadius: 6, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: warn ? C.red : C.orange,
                        borderRadius: 6,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          {campaigns.filter((c) => c.conversionValue > 0).length === 0 && (
            <div style={{ fontSize: 13, color: C.textDim }}>Keine Umsatzdaten je Kampagne.</div>
          )}
        </div>
      </div>

      {/* ===== EBENE 3 — TECHNISCHE DETAILS ===== */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ marginBottom: 0 }}>{eyebrow("3", "Technische Details", false)}</div>
          <button
            onClick={() => setShowDiag((v) => !v)}
            style={{
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              color: C.textMuted,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              padding: "7px 13px",
              cursor: "pointer",
            }}
          >
            {showDiag ? "Details ausblenden" : "Details einblenden"}
          </button>
        </div>
        {showDiag && (
          <div style={{ marginTop: 4 }}>
            <div
              className="dash-kpis"
              style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}
            >
              {[
                {
                  lbl: "Impressionen",
                  val: numCH(Math.round(totals.impressions)),
                  d: delta(totals.impressions, prev.impressions),
                  inv: false,
                },
                {
                  lbl: "Klicks",
                  val: numCH(Math.round(totals.clicks)),
                  d: delta(totals.clicks, prev.clicks),
                  inv: false,
                },
                {
                  lbl: "CTR",
                  val: `${ctr.toFixed(2).replace(".", ",")} %`,
                  d: delta(ctr, prev.ctr),
                  inv: false,
                },
                { lbl: "Ø CPC", val: chf(cpc, 2), d: delta(cpc, prev.cpc), inv: true },
              ].map((m) => (
                <div
                  key={m.lbl}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "14px 15px",
                  }}
                >
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 6 }}>{m.lbl}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: C.text }}>{m.val}</div>
                  <div style={{ marginTop: 5 }}>
                    <DeltaBadge value={m.d} invert={m.inv} />
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                fontSize: 12.5,
                color: C.textMuted,
                lineHeight: 1.55,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${C.orange}`,
                borderRadius: 8,
                padding: "13px 16px",
              }}
            >
              <strong style={{ color: C.text, fontWeight: 600 }}>
                Lesart für den Spezialisten:
              </strong>{" "}
              Vergleich gegen die unmittelbar vorangehende Periode gleicher Länge. ROAS und Umsatz
              basieren auf den in Google Ads getrackten Conversion-Werten. Vollständige Kampagnen-
              und Keyword-Tabellen folgen auf den Detailseiten.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

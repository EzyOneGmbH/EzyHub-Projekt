// ConvDashboard (QS-Runde 13.09.2026): aus RankDashboards.jsx (4.4k Zeilen)
// unveraendert herausgeloest — eigener Lazy-Chunk (EzyOneApp) und kleinere
// Datei. RankDashboards re-exportiert die Komponente fuer bestehende Importe.
import { CompareBanner, LiveEmptyState } from "./ui-kit";
import { compareName, seriesDelta, useGa4Compare } from "./ui-kit";
import { ezyFetch } from "@/ezy/data/api";
import { ga4ConversionsFromResult, ga4KpisFromResult } from "@/ezy/data/useEzyLatestRun";
import { useAuth } from "@/hooks/use-auth";
import { Clock, DollarSign, FileInput, FileText } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import ConversionScoutPanel from "@/ezy/ConversionScoutPanel";
import { isAiConvSource } from "@/ezy/data/aiSources";
import DataStatus from "@/ezy/DataStatus";
import { C } from "./theme";
import { KpiCard, liveDaysFor, useLiveGa4 } from "./ui-kit";
import { runStatusItem } from "@/ezy/DataStatus";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import { ga4TrafficFromResult, useEzyLatestRun } from "@/ezy/data/useEzyLatestRun";
import { Activity, Eye, Globe, Mail, MapPin, Phone, Search, Target, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function ConvDashboard({ selectedClient, dateRange, appScope = null }) {
  // KI-Separierung (Volkan 31.08.): KI-Referral-Conversions erscheinen in der
  // Detailliste NUR in EzyAI (appScope "geo") — EzyRank zeigt rein Organisch.
  const includeAiConv = appScope === "geo";
  // Kundenansicht (31.08., Volkan): der Conversion-Scout (Kandidaten prüfen,
  // Website scannen, GA4-Key-Events anlegen) ist Team-Werkzeug — Kunden-
  // Logins sehen ihn nicht.
  const { role: convRole } = useAuth();
  const istKundeConv = convRole === "viewer";
  const bis = dateRange?.end || null;
  const { run, refresh: refreshGa4 } = useEzyLatestRun(selectedClient?.id, "ga4_summary", bis);
  const { run: convRun, refresh: refreshConv } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_conversions",
    bis,
  );
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_traffic",
    bis,
  );
  const days = dateRange?.days || 30;
  // Datumsfilter-Fix (2026-08-10): Live-GA4 im gewählten Zeitraum (gecacht,
  // persist:false); der Agent-Snapshot bleibt Fallback (kein GA4 / Fehler /
  // Custom-Zeitraum in der Vergangenheit).
  const liveDays = liveDaysFor(dateRange);
  const { data: liveSum } = useLiveGa4(selectedClient?.id, "ga4-summary", liveDays);
  const { data: liveConvRes } = useLiveGa4(selectedClient?.id, "ga4-conversions", liveDays);
  const { data: liveTrafRes } = useLiveGa4(selectedClient?.id, "ga4-traffic", liveDays);
  const sumRes = liveSum || run?.result || null;
  const convRes = liveConvRes || convRun?.result || null;
  const trafRes = liveTrafRes || trafRun?.result || null;
  const ga4Raw = sumRes ? ga4KpisFromResult(sumRes) : null;
  const conv = convRes ? ga4ConversionsFromResult(convRes) : null;
  const traf = trafRes ? ga4TrafficFromResult(trafRes) : null;
  // Wunschnamen aus dem Conversion-Scout (31.08.): GA4-Eventname → vom
  // Menschen vergebener Anzeigename; ausgelöste Conversions erscheinen in
  // beiden Tabellen unter diesem Namen. Fehler bleiben still (Overlay leer).
  const [convNames, setConvNames] = useState({});
  useEffect(() => {
    let alive = true;
    setConvNames({});
    if (!selectedClient?.id) return undefined;
    (async () => {
      try {
        const r = await ezyFetch(`/api/admin/conversion-candidates?client=${selectedClient.id}`);
        const j = await r.json();
        if (!alive || !j.ok) return;
        const map = {};
        for (const cand of j.candidates || [])
          if (cand.ga4_destination_event && cand.display_name)
            map[cand.ga4_destination_event] = cand.display_name;
        setConvNames(map);
      } catch {
        /* Overlay ist optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedClient?.id]);
  // Filter-Tabs der Conversion-Liste (User-Wunsch 2026-07-19): Purchase =
  // Kauf-/Checkout-Events, Lead-Anfragen = alles Übrige (Formulare, Lead-,
  // Telefon-/Mail-/Maps-Events). Klassifiziert am rohen GA4-eventName.
  const [convFilter, setConvFilter] = useState("alle");
  const isPurchaseEvent = (r) =>
    /purchase|checkout|transaction|kauf|buchung|booking/i.test(
      String(r?.eventName || r?.description || ""),
    );
  // Detailliste (Volkan 31.08., KI-Separierung gleichentags): EzyRank zeigt
  // NUR «Organic Search»; in EzyAI (appScope "geo") kommen zusätzlich
  // KI-Referrals dazu (ChatGPT/Perplexity/… — gleiche Quellen-Erkennung wie
  // die EzyAI-Attribution). Bezahlte KI-Klicks (ChatGPT Ads → Paid-Kanal)
  // bleiben überall draussen. Alte Snapshots ohne channel-Feld bleiben
  // sichtbar (Fallback-Toleranz, ohne Direct/KI je nach App). Die
  // Event-Übersichtstabelle (convEventsFiltered) bleibt bewusst ungefiltert.
  const convRowsOrganic = useMemo(
    () =>
      (conv?.rows || []).filter((r) => {
        if (r.channel == null) {
          // Fallback (alte Snapshots ohne channel-Feld): Direktzugriffe immer
          // raus; KI-Quellen nur in EzyAI zeigen.
          if (/^\(?direct\)?$/i.test(String(r.source || "").trim())) return false;
          return includeAiConv || !isAiConvSource(r.source);
        }
        const ch = String(r.channel);
        if (/^organic search$/i.test(ch)) return true;
        return (
          includeAiConv && isAiConvSource(r.source) && !/^paid|display|cross-network/i.test(ch)
        );
      }),
    [conv?.rows, includeAiConv],
  );
  const convRowsFiltered = useMemo(() => {
    if (convFilter === "purchase") return convRowsOrganic.filter(isPurchaseEvent);
    if (convFilter === "lead") return convRowsOrganic.filter((r) => !isPurchaseEvent(r));
    return convRowsOrganic;
  }, [convRowsOrganic, convFilter]);
  const convEventsFiltered = useMemo(() => {
    const evs = conv?.events || [];
    if (convFilter === "purchase") return evs.filter(isPurchaseEvent);
    if (convFilter === "lead") return evs.filter((e) => !isPurchaseEvent(e));
    return evs;
  }, [conv?.events, convFilter]);
  const ga4 = ga4Raw;
  useEffect(() => {
    const interval = setInterval(
      () => {
        refreshGa4();
        refreshConv();
        refreshTraf();
      },
      12 * 60 * 60 * 1000,
    ); // 12 Stunden
    return () => clearInterval(interval);
  }, [refreshGa4, refreshConv, refreshTraf]);
  // Prefer live GA4 event-level breakdown; fall back to client placeholders.
  const revenue = Number(conv?.revenue || selectedClient?.revenue || 0);
  const phoneCalls = Number(conv?.breakdown.phone || selectedClient?.phoneCalls || 0);
  const mailClicks = Number(conv?.breakdown.mail || selectedClient?.mailClicks || 0);
  const mapsClicks = Number(conv?.breakdown.maps || selectedClient?.mapsClicks || 0);
  const formSubmits = Number(conv?.breakdown.contact || selectedClient?.formSubmits || 0);
  const convSeries = useMemo(() => (conv?.series || []).slice(-days), [conv?.series, days]);
  const googleVsAi = traf?.googleVsAi || null;
  // Dashboard-Ausbau 2026-07-11: B3 Kanal-Split (neues channels-Feld) + B5b Umsatz-Modus.
  // Datumsfilter-Regression (10.-11.08.): die Live-Antwort verdrängte den
  // Agent-Snapshot, hatte aber KEIN channels-Feld -> Kanäle-Widget verschwand.
  // Live-Route liefert channels jetzt mit; zusätzlich Snapshot-Fallback, damit
  // das Widget nie wieder an einer lückenhaften Live-Antwort hängt.
  const channels =
    Array.isArray(convRes?.channels) && convRes.channels.length
      ? convRes.channels
      : Array.isArray(convRun?.result?.channels) && convRun.result.channels.length
        ? convRun.result.channels
        : Array.isArray(trafRes?.channels) && trafRes.channels.some((ch) => ch.conversions != null)
          ? trafRes.channels
          : null;
  const channelTotalSessions = channels ? channels.reduce((a, ch) => a + (ch.sessions || 0), 0) : 0;
  const organicChannel = channels
    ? channels.find((ch) => /^organic search$/i.test(ch.channel))
    : null;
  const organicShare =
    channels && channelTotalSessions > 0 && organicChannel
      ? Math.round((organicChannel.sessions / channelTotalSessions) * 100)
      : null;
  const clicksMode = selectedClient?.revenueMode === "clicks"; // B5b: nur Anzeige-Steuerung
  const sessions = Number(ga4?.sessions || 0);
  const totalUsers = Number(ga4?.totalUsers || 0);
  const engagedSessions = Number(ga4?.engagedSessions || 0);
  const screenPageViews = Number(ga4?.screenPageViews || 0);
  const newUsers = Number(ga4?.newUsers || 0);
  const bounceRate = Number(ga4?.bounceRate || 0);
  const avgSession = Number(ga4?.averageSessionDuration || 0);
  const ga4Conversions = Number(ga4?.conversions || 0);
  const ga4Revenue = Number(ga4?.totalRevenue || 0);
  // Serien-Fallback (11.08.): liefert die Live-Antwort keine Tagesreihe,
  // greift der Agent-Snapshot — sonst verschwindet der Traffic-Verlauf.
  const ga4SeriesRaw = useMemo(
    () => (ga4?.series?.length ? ga4.series : run?.result?.series || []),
    [ga4?.series, run?.result?.series],
  );
  const ga4Series = useMemo(() => ga4SeriesRaw.slice(-days), [ga4SeriesRaw, days]);
  // Live GA4 comparison (real YoY/MoM) — falls back to series-based deltas if unavailable.
  const { data: cmpData, deltas: liveDeltas } = useGa4Compare(selectedClient?.id, dateRange);
  const pick = (live, fallback) => (live !== undefined ? live : fallback);
  const dRevenue = pick(
    liveDeltas.totalRevenue,
    useMemo(() => seriesDelta(conv?.series, "revenue", dateRange), [conv?.series, dateRange]),
  );
  const dConv = pick(
    liveDeltas.conversions,
    useMemo(() => seriesDelta(conv?.series, "conversions", dateRange), [conv?.series, dateRange]),
  );
  const dSessions = pick(
    liveDeltas.sessions,
    useMemo(() => seriesDelta(ga4SeriesRaw, "sessions", dateRange), [ga4SeriesRaw, dateRange]),
  );
  const dUsers = pick(
    liveDeltas.totalUsers,
    useMemo(() => seriesDelta(ga4SeriesRaw, "totalUsers", dateRange), [ga4SeriesRaw, dateRange]),
  );
  const dPageViews = pick(
    liveDeltas.screenPageViews,
    useMemo(() => seriesDelta(ga4SeriesRaw, "pageViews", dateRange), [ga4SeriesRaw, dateRange]),
  );
  // Comparison absolute values (from live GA4) + friendly period label.
  const cmpName = compareName(dateRange?.compareMode);
  // null-Totals (Endpoint-Teilfehler) nie als "vorher: 0" anzeigen.
  const cmp = (k) => {
    const v = cmpData?.compare?.[k];
    return v == null ? undefined : Number(v);
  };
  const { isOn } = useEzyDashboardConfig();
  const hasAnyKpi =
    revenue +
      phoneCalls +
      mailClicks +
      mapsClicks +
      formSubmits +
      sessions +
      totalUsers +
      engagedSessions +
      screenPageViews >
    0;
  // Datenstatus (EzyRank-Ausbau 2026-08-18): GA4 ist die einzige Quelle dieses
  // Tabs — Live-Abfrage bevorzugt, sonst Agent-Snapshot; ohne beides ehrlich
  // "nicht verbunden" mit konkretem nächstem Schritt.
  const convConnected = Boolean(liveSum || liveConvRes || liveTrafRes || run || convRun || trafRun);
  // Kundenansicht (31.08.): die GA4-Status-Leiste (inkl. «Daten neu laden»)
  // ist Team-Werkzeug — Kunden sehen direkt die Conversion-Inhalte.
  const convStatus = istKundeConv ? null : (
    <DataStatus
      items={[
        liveSum || liveConvRes || liveTrafRes
          ? {
              source: "GA4 (Google Analytics)",
              state: "live",
              detail: "Live-Abfrage im gewählten Zeitraum",
            }
          : convConnected
            ? runStatusItem("GA4 (Google Analytics)", convRun || run || trafRun, {
                staleDays: 3,
                detail: "Agent-Snapshot",
              })
            : { source: "GA4 (Google Analytics)", state: "disconnected" },
      ]}
      action={{
        label: "Daten neu laden",
        kind: "reload",
        title:
          "Liest nur den gespeicherten Datenbankstand neu — GA4 misst der naechtliche Sammel-Lauf bzw. die Live-Abfrage",
        onClick: () => {
          refreshGa4(true);
          refreshConv(true);
          refreshTraf(true);
        },
      }}
      hint={
        !convConnected
          ? "Google verbinden: Admin → Kunden → Onboarding → Google (GA4-Property hinterlegen)"
          : undefined
      }
    />
  );
  if (!hasAnyKpi) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {convStatus}
        <LiveEmptyState
          title="Noch keine Conversion-Daten"
          hint={
            convConnected
              ? "GA4 ist verbunden, liefert im gewählten Zeitraum aber noch keine Conversion-Events. Prüfe die Events in GA4 oder wähle einen längeren Zeitraum."
              : "Nächster Schritt: Google für diesen Kunden verbinden (Admin → Kunden → Onboarding → Google) und die GA4-Property hinterlegen — danach erscheinen hier echte Werte."
          }
        />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {convStatus}
      <CompareBanner dateRange={dateRange} />
      {/* Conversion-Scout (Pilot 26.08.2026): erkannte Kandidaten einzeln
          freigeben — erst dann entsteht ein GA4 Key Event (nur Organic).
          Nur intern (31.08.). */}
      {istKundeConv ? null : <ConversionScoutPanel selectedClient={selectedClient} />}
      {isOn("conv.custom") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 14,
          }}
        >
          <KpiCard
            icon={Phone}
            label="Phone Clicks"
            value={phoneCalls > 0 ? phoneCalls : "—"}
            color={C.accent}
          />
          <KpiCard
            icon={Mail}
            label="Mail Clicks"
            value={mailClicks > 0 ? mailClicks : "—"}
            color={C.blue}
          />
          <KpiCard
            icon={MapPin}
            label="Maps Clicks"
            value={mapsClicks > 0 ? mapsClicks : "—"}
            color={C.green}
          />
          <KpiCard
            icon={FileInput}
            label="Contact Form Submit"
            value={formSubmits > 0 ? formSubmits : "—"}
            color={C.orange}
          />
          {!clicksMode && (
            <KpiCard
              icon={DollarSign}
              label="Generated"
              value={revenue > 0 ? `${Math.round(revenue).toLocaleString("de-CH")} CHF` : "—"}
              change={dRevenue}
              compareValue={
                cmp("totalRevenue") !== undefined
                  ? `${Math.round(cmp("totalRevenue")).toLocaleString("de-CH")} CHF`
                  : undefined
              }
              compareLabel={cmpName}
              color={C.pink}
            />
          )}
          {clicksMode && (
            <KpiCard
              icon={Target}
              label="Conversions (Buchungsklicks)"
              value={
                conv && conv.purchases + phoneCalls + mailClicks + mapsClicks + formSubmits > 0
                  ? conv.purchases + phoneCalls + mailClicks + mapsClicks + formSubmits
                  : "—"
              }
              change={dConv}
              color={C.pink}
            />
          )}
        </div>
      )}
      {/* B3: Kanal-Split (GA4 sessionDefaultChannelGroup) — nur wenn channels vorhanden */}
      {channels && channels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {organicShare != null && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
                maxWidth: 320,
              }}
            >
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>
                davon organisch
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.green }}>{organicShare}%</div>
              <div style={{ fontSize: 11, color: C.textDim }}>
                {organicChannel.sessions.toLocaleString("de-CH")} von{" "}
                {channelTotalSessions.toLocaleString("de-CH")} Sessions
              </div>
            </div>
          )}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
              Kanaele
            </div>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table
                style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Kanal</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Sessions</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Conversions</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>
                      {clicksMode ? "Buchungsklicks (Wert)" : "Umsatz"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch, i) => {
                    const isOrganic = /^organic search$/i.test(ch.channel);
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td
                          style={{
                            padding: "6px 8px",
                            color: C.text,
                            fontWeight: isOrganic ? 700 : 400,
                          }}
                        >
                          {isOrganic && (
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                background: C.green,
                                marginRight: 6,
                              }}
                            />
                          )}
                          {ch.channel}
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            textAlign: "right",
                            fontWeight: isOrganic ? 700 : 400,
                          }}
                        >
                          {(ch.sessions ?? 0).toLocaleString("de-CH")}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          {ch.conversions != null
                            ? Math.round(ch.conversions).toLocaleString("de-CH")
                            : "—"}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          {ch.revenue != null && !clicksMode
                            ? `${Math.round(ch.revenue).toLocaleString("de-CH")} CHF`
                            : ch.revenue != null
                              ? Math.round(ch.revenue).toLocaleString("de-CH")
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {isOn("conv.ga4") &&
        (sessions > 0 || totalUsers > 0 || engagedSessions > 0 || screenPageViews > 0) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              icon={Globe}
              label="GA4 Sessions"
              value={sessions > 0 ? sessions : "—"}
              change={dSessions}
              compareValue={cmp("sessions")}
              compareLabel={cmpName}
              color={C.blue}
            />
            <KpiCard
              icon={Eye}
              label="GA4 Total Users"
              value={totalUsers > 0 ? totalUsers : "—"}
              change={dUsers}
              compareValue={cmp("totalUsers")}
              compareLabel={cmpName}
              color={C.accent}
            />
            <KpiCard
              icon={Activity}
              label="Engaged Sessions"
              value={engagedSessions > 0 ? engagedSessions : "—"}
              color={C.green}
            />
            <KpiCard
              icon={FileText}
              label="Page Views"
              value={screenPageViews > 0 ? screenPageViews : "—"}
              change={dPageViews}
              compareValue={cmp("screenPageViews")}
              compareLabel={cmpName}
              color={C.orange}
            />
            <KpiCard
              icon={Users}
              label="New Users"
              value={newUsers > 0 ? newUsers : "—"}
              color={C.cyan}
            />
            <KpiCard
              icon={Target}
              label="Conversions"
              value={ga4Conversions > 0 ? ga4Conversions : "—"}
              change={dConv}
              compareValue={cmp("conversions")}
              compareLabel={cmpName}
              color={C.pink}
            />
            {!clicksMode && (
              <KpiCard
                icon={DollarSign}
                label="GA4 Revenue"
                value={
                  ga4Revenue > 0 ? `CHF ${Math.round(ga4Revenue).toLocaleString("de-CH")}` : "—"
                }
                color={C.green}
              />
            )}
            {clicksMode && (
              <KpiCard
                icon={DollarSign}
                label="Buchungsklicks (Wert)"
                value={ga4Revenue > 0 ? Math.round(ga4Revenue).toLocaleString("de-CH") : "—"}
                color={C.green}
              />
            )}
            <KpiCard
              icon={Activity}
              label="Bounce Rate"
              value={bounceRate > 0 ? `${(bounceRate * 100).toFixed(1)}%` : "—"}
              color={C.orange}
            />
            <KpiCard
              icon={Clock}
              label="Ø Session"
              value={avgSession > 0 ? `${Math.round(avgSession)}s` : "—"}
              color={C.blue}
            />
          </div>
        )}
      {isOn("conv.revenue") && revenue > 0 && !clicksMode && (
        <div
          style={{
            background: `linear-gradient(135deg,${C.accent}22,${C.green}15), ${C.card}`,
            border: `1px solid ${C.accent}40`,
            borderRadius: 14,
            padding: "24px 28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Total Revenue</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.text }}>
              CHF {revenue.toLocaleString("de-CH")}
            </div>
          </div>
        </div>
      )}
      {isOn("conv.trend") && ga4Series.length >= 2 ? (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
            Traffic-Verlauf ({dateRange?.label || "30 Tage"})
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={ga4Series}>
              <defs>
                <linearGradient id="ga4-sessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.accent} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="date"
                stroke={C.textDim}
                fontSize={11}
                tickFormatter={(d) =>
                  typeof d === "string" && d.length === 8 ? `${d.slice(6, 8)}.${d.slice(4, 6)}.` : d
                }
              />
              <YAxis stroke={C.textDim} fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.textMuted,
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="sessions"
                name="Sessions"
                stroke={C.accent}
                fill="url(#ga4-sessions)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="totalUsers"
                name="Users"
                stroke={C.blue}
                fillOpacity={0}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <LiveEmptyState
          title="Conversion-Charts folgen mit GA4-Live-Daten"
          hint="Sobald GA4 Sessions, Events und Revenue liefert, erscheinen hier Trend-Charts und Conversion-Tabellen."
        />
      )}
      {((googleVsAi && googleVsAi.total > 0) || convSeries.length >= 2) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: 14,
          }}
        >
          {googleVsAi && googleVsAi.total > 0 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
                Traffic-Verteilung Google vs. AI
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Google", value: googleVsAi.google },
                      { name: "AI", value: googleVsAi.ai },
                      { name: "Andere", value: googleVsAi.other },
                    ].filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {[C.blue, C.green, C.textDim].map((col, i) => (
                      <Cell key={i} fill={col} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      color: C.textMuted,
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {convSeries.length >= 2 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
                Leads & Umsatz ({dateRange?.label || "30 Tage"})
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={convSeries}>
                  <defs>
                    <linearGradient id="conv-leads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.pink} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.pink} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis
                    dataKey="date"
                    stroke={C.textDim}
                    fontSize={11}
                    tickFormatter={(d) =>
                      typeof d === "string" && d.length === 8
                        ? `${d.slice(6, 8)}.${d.slice(4, 6)}.`
                        : d
                    }
                  />
                  <YAxis stroke={C.textDim} fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      color: C.textMuted,
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="conversions"
                    name="Conversions"
                    stroke={C.pink}
                    fill="url(#conv-leads)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
      {conv && (conv.rows.length > 0 || conv.events.length > 0) && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
              {conv.rows.length > 0
                ? includeAiConv
                  ? "Organische & KI-Conversions"
                  : "Organische Conversions"
                : "Alle Conversions"}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(() => {
                // Detailansicht zaehlt die organische Basis, damit Chips und
                // sichtbare Zeilen zusammenpassen; Event-Uebersicht bleibt voll.
                const base = conv.rows.length > 0 ? convRowsOrganic : conv.events;
                const sum = (arr) => arr.reduce((a, x) => a + (Number(x.count) || 0), 0);
                const purch = base.filter(isPurchaseEvent);
                const leads = base.filter((x) => !isPurchaseEvent(x));
                return [
                  ["alle", "Alle", sum(base)],
                  ["purchase", "Purchase", sum(purch)],
                  ["lead", "Lead-Anfragen", sum(leads)],
                ].map(([key, label, n]) => (
                  <button
                    key={key}
                    onClick={() => setConvFilter(key)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "4px 12px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: `1px solid ${convFilter === key ? C.accent : C.border}`,
                      background: convFilter === key ? `${C.accent}22` : "transparent",
                      color: convFilter === key ? C.accent : C.textMuted,
                    }}
                  >
                    {label} ({n.toLocaleString("de-CH")})
                  </button>
                ));
              })()}
            </div>
          </div>
          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              maxHeight: 460,
              overflowY: "auto",
            }}
          >
            {conv.rows.length > 0 ? (
              <table
                style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Titel</th>
                    <th style={{ padding: "6px 8px" }}>Datum</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Wert</th>
                    <th style={{ padding: "6px 8px" }}>Land</th>
                    <th style={{ padding: "6px 8px" }}>Quelle</th>
                    <th style={{ padding: "6px 8px" }}>Gerät</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {convRowsFiltered.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "12px 8px", color: C.textDim }}>
                        Keine {convFilter === "purchase" ? "Purchase-Conversions" : "Lead-Anfragen"}{" "}
                        aus {includeAiConv ? "organischer oder KI-Quelle" : "organischer Quelle"} im
                        Zeitraum.
                      </td>
                    </tr>
                  )}
                  {convRowsFiltered.slice(0, 60).map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.text, fontWeight: 600 }}>
                        {convNames[r.eventName] || r.description}
                      </td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>
                        {typeof r.date === "string" && r.date.length === 8
                          ? `${r.date.slice(6, 8)}.${r.date.slice(4, 6)}.${r.date.slice(0, 4)}`
                          : r.date}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {r.value > 0 ? `${Math.round(r.value).toLocaleString("de-CH")} CHF` : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>{r.country || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>{r.source || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>{r.device || "—"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {Number(r.count).toLocaleString("de-CH")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table
                style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Event</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {convEventsFiltered.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ padding: "12px 8px", color: C.textDim }}>
                        Keine {convFilter === "purchase" ? "Purchase-Conversions" : "Lead-Anfragen"}{" "}
                        im Zeitraum.
                      </td>
                    </tr>
                  )}
                  {convEventsFiltered.slice(0, 15).map((e, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.text }}>
                        {convNames[e.eventName] || e.eventName}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {e.count.toLocaleString("de-CH")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {/* B5c: Mess-Hygiene-Fussnote (immer sichtbar) */}
      <div style={{ fontSize: 11, color: C.textDim }}>
        Gemessene Werte — je nach Cookie-Einwilligung untererfasst.
      </div>
    </div>
  );
}

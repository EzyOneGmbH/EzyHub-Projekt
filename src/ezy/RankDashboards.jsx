// EzyRank-Dashboards (aus EzyOneApp.jsx extrahiert, 21.08.2026 — reines
// Verschieben): Agentur-Uebersicht, SEO/GEO/Conversions/Overview-Dashboards,
// KI-Sichtbarkeit (Makro) und Onboarding-Scan-Panel.
import { Btn } from "./shared-ui";
import {
  CTooltip,
  ChartCard,
  CompareBanner,
  DTable,
  LiveEmptyState,
  SectionErrorBoundary,
  Skeleton,
} from "./ui-kit";
import { Fragment } from "react";
import {
  AI_COLORS,
  buildCanonryLiveModel,
  canonryProviderLabel,
  compareName,
  seriesDelta,
  useCanonryOverview,
  useGa4Compare,
  useLiveIntegrations,
} from "./ui-kit";
import { ezyFetch } from "@/ezy/data/api";
import {
  aiVisibilityKpisFromResult,
  aiVisibilityProvidersFromResult,
  aiVisibilityScoreFromResult,
  aiVisibilitySeriesFromResult,
  aiVisibilitySourcesFromResult,
  aiVisibilityTopicsFromResult,
  ga4ConversionsFromResult,
  ga4KpisFromResult,
  useEzyHealthComponents,
} from "@/ezy/data/useEzyLatestRun";
import { useAuth } from "@/hooks/use-auth";
import { Bot, Clock, DollarSign, FileInput, FileText, RefreshCw, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import ConversionScoutPanel from "@/ezy/ConversionScoutPanel";
import { isAiConvSource } from "@/ezy/data/aiSources";
import DataStatus from "@/ezy/DataStatus";
import { Badge } from "./shared-ui";
import { C } from "./theme";
import { KpiCard, SectionPlaceholder, SeoPager, liveDaysFor, useLiveGa4 } from "./ui-kit";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import { runStatusItem } from "@/ezy/DataStatus";
import { useEzyAuditHistory } from "@/ezy/data/useEzyAuditHistory";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import {
  ahrefsKpisFromResult,
  ahrefsRefdomainsSeriesFromResult,
  ga4TrafficFromResult,
  gscKpisFromResult,
  gscRankingDistributionFromResult,
  pagespeedKpisFromResult,
  useEzyLatestRun,
} from "@/ezy/data/useEzyLatestRun";
import { useMeasurement } from "@/ezy/data/useMeasurement";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  Award,
  Eye,
  Globe,
  LayoutGrid,
  Link2,
  Mail,
  MapPin,
  Phone,
  Search,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARDS (preserved)
// ═══════════════════════════════════════════════════════════════════════════
export function AgencyOverview({ clients, onSelect, appScope = null }) {
  // Kachel-Kennzahlen (Volkan 10.08.): Top-3/Top-10 aus dem letzten
  // rankings-Lauf (result.aggregate); organischer Traffic seit 13.08. aus dem
  // letzten ga4_traffic-Snapshot (Kanal "Organic Search", echte Besuche),
  // DFS-ETV (ahrefs-Lauf) nur noch als Fallback ohne GA4. Batch: EINE Query
  // je Typ mit JSON-Teilpfad-Select statt 14 Einzel-Fetches mit vollen Payloads.
  // EzyPerformance (Volkan 10.08.): im Ads-Scope stattdessen Werbebudget /
  // ROAS / Umsatz aus dem letzten google_ads-Snapshot — gleiches Batch-Muster.
  const isAds = appScope === "ads";
  const [stats, setStats] = useState({});
  useEffect(() => {
    let alive = true;
    const ids = clients.map((c) => c.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return;
    (async () => {
      try {
        if (isAds) {
          const { data } = await supabase
            .from("audit_runs")
            .select("client_id, created_at, t:result->totals, roas:result->roas")
            .in("client_id", ids)
            .eq("audit_type", "google_ads")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(200);
          if (!alive) return;
          const next = {};
          for (const row of data || []) {
            if (next[row.client_id]) continue; // erste Zeile = neuester Snapshot
            const t = row.t || {};
            next[row.client_id] = {
              budget: Number(t.cost ?? 0) || 0,
              revenue: Number(t.conversionValue ?? 0) || 0,
              roas: Number(row.roas ?? 0) || 0,
              date: String(row.created_at || "").slice(0, 10),
            };
          }
          setStats(next);
          return;
        }
        const [rankRes, ga4Res, seoRes] = await Promise.all([
          supabase
            .from("audit_runs")
            .select("client_id, created_at, agg:result->aggregate")
            .in("client_id", ids)
            .eq("audit_type", "rankings")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(200),
          // Echter organischer Traffic (2026-08-13, User-Wunsch): GA4-Kanal
          // "Organic Search" aus dem letzten ga4_traffic-Snapshot — wie die
          // "Organic Traffic"-Kachel im SEO-Tab. DFS-ETV nur noch Fallback.
          supabase
            .from("audit_runs")
            .select("client_id, created_at, ch:result->channels")
            .in("client_id", ids)
            .eq("audit_type", "ga4_traffic")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(200),
          supabase
            .from("audit_runs")
            .select("client_id, created_at, m:result->metrics")
            .in("client_id", ids)
            .eq("audit_type", "ahrefs")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        if (!alive) return;
        const next = {};
        for (const row of rankRes.data || []) {
          if (next[row.client_id]?.top3 != null) continue; // erste Zeile = neuester Lauf
          const a = row.agg || {};
          next[row.client_id] = {
            ...next[row.client_id],
            top3: Number(a.top3 ?? 0) || 0,
            top10: Number(a.top10 ?? 0) || 0,
            // Datum-Chip wie in der EzyAI-Übersicht: letzter Messlauf.
            date: String(row.created_at || "").slice(0, 10),
          };
        }
        // GA4 zuerst (echte organische Besuche); DFS-ETV nur wo kein GA4 liegt.
        for (const row of ga4Res.data || []) {
          if (next[row.client_id]?.traffic != null) continue; // neuester Snapshot gewinnt
          const organic = (Array.isArray(row.ch) ? row.ch : []).find((c) =>
            /^organic search$/i.test(String(c?.channel || "")),
          )?.sessions;
          if (!(Number(organic) > 0)) continue;
          next[row.client_id] = {
            ...next[row.client_id],
            traffic: Number(organic),
            date: next[row.client_id]?.date || String(row.created_at || "").slice(0, 10),
          };
        }
        for (const row of seoRes.data || []) {
          if (next[row.client_id]?.traffic != null) continue;
          const m = row.m?.metrics ?? row.m ?? {}; // Ahrefs nested / DataForSEO flach
          next[row.client_id] = {
            ...next[row.client_id],
            traffic:
              Number(m.org_traffic ?? 0) || Math.round(Number(m.organic_traffic_etv ?? 0)) || 0,
            date: next[row.client_id]?.date || String(row.created_at || "").slice(0, 10),
          };
        }
        setStats(next);
      } catch {
        /* Kacheln zeigen dann — */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clients, isAds]);
  // Kacheln alphabetisch — Kundenreihenfolge ist überall gleich (Volkan 13.08.).
  const tiles = [...clients].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "de-CH", { sensitivity: "base" }),
  );
  // Kachel-Metriken je Scope; Werte vorformatiert (CHF im Label, damit die
  // 3er-Spalte nicht umbricht).
  const numCH = (n) => Math.round(Number(n || 0)).toLocaleString("de-CH");
  const tileMetrics = (st) =>
    isAds
      ? [
          { label: "Werbebudget (CHF)", value: st ? numCH(st.budget) : null },
          {
            label: "ROAS",
            value: st
              ? `${Number(st.roas || 0)
                  .toFixed(2)
                  .replace(".", ",")}×`
              : null,
          },
          { label: "Umsatz (CHF)", value: st ? numCH(st.revenue) : null },
        ]
      : [
          { label: "Top 3", value: st?.top3 != null ? st.top3.toLocaleString("de-CH") : null },
          { label: "Top 10", value: st?.top10 != null ? st.top10.toLocaleString("de-CH") : null },
          {
            label: "Org. Traffic",
            value: st?.traffic != null ? st.traffic.toLocaleString("de-CH") : null,
          },
        ];
  return (
    <>
      {/* Kunden-Kacheln (Volkan 10.08.): bei "Alle Kunden" werden alle
          berechtigten Kunden als anklickbare Kacheln gezeigt — ein Klick öffnet
          das Dashboard des jeweiligen Kunden. Die frühere KPI-Karten-Reihe
          (Aktive Kunden / Ø Score / AI Visitors / Revenue) ist entfernt. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "4px 2px 12px",
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: C.text }}>Kunden</h2>
        <span style={{ fontSize: 12, color: C.textMuted }}>{clients.length} berechtigt</span>
      </div>
      <div
        className="agency-client-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {tiles.map((c) => {
          const st = stats[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect?.(c.id)}
              style={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "border-color .15s, box-shadow .15s, transform .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.accent;
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,.08)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "none";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {/* Favicon der Kundendomain, Fallback auf Initialen (Volkan 13.08.). */}
                <ClientAvatar
                  name={c.name}
                  domain={c.domain}
                  size={38}
                  radius={10}
                  bg={C.accentDim}
                  fg={C.accentLight}
                  fontSize={13}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: C.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.name || "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: C.textMuted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.domain || "keine Domain"}
                  </div>
                </div>
                {/* Datum-Chip wie in der EzyAI-Übersicht (10.08.): letzter Messlauf. */}
                {st?.date && (
                  <span
                    title={`Letzter Messlauf: ${st.date}`}
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      color: C.textMuted,
                      border: `1px solid ${C.border}`,
                      borderRadius: 999,
                      padding: "3px 8px",
                    }}
                  >
                    {st.date.slice(8, 10)}.{st.date.slice(5, 7)}.
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {tileMetrics(st).map((m) => (
                  <div key={m.label}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: C.text,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {m.value ?? "—"}
                    </div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function OnboardingPanel({ selectedClient }) {
  const { run, refresh } = useEzyLatestRun(selectedClient?.id, "onboarding_scan");
  const res = run?.result;
  const [selKw, setSelKw] = useState(null);
  const [selOrg, setSelOrg] = useState({});
  const [selLoc, setSelLoc] = useState({});
  const [ctype, setCtype] = useState("");
  const [brandStr, setBrandStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  // exhaustive-deps-Fix (21.08.): Vorauswahl exakt EINMAL je Lauf-ID setzen —
  // ein Objekt-Refresh derselben ID ueberschreibt die Nutzer-Auswahl nicht.
  const initRef = useRef(null);
  useEffect(() => {
    if (!res || initRef.current === run?.id) return;
    initRef.current = run?.id;
    const money = new Set(
      (res.suggestions?.moneyKeywordCandidates || []).map((s) => String(s).toLowerCase()),
    );
    const ranked = res.topRanked || [];
    const top3 = [...ranked]
      .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))
      .slice(0, 3)
      .map((k) => k.kw.toLowerCase());
    const pre = {};
    ranked.forEach((k) => {
      if (money.has(k.kw.toLowerCase()) || top3.includes(k.kw.toLowerCase())) pre[k.kw] = true;
    });
    setSelKw(pre);
    setCtype(res.suggestions?.clientType || "generic");
    setBrandStr((res.suggestions?.brandTerms || []).join(", "));
  }, [res, run?.id]);
  if (!res || selKw === null) return null;
  const counts = res.counts || {};
  const changes = res.changes;
  const kwList = res.topRanked || [];
  const orgList = res.topOrganicCompetitors || [];
  const locList = res.topLocalCompetitors || [];
  const moneySet = new Set(
    (res.suggestions?.moneyKeywordCandidates || []).map((s) => String(s).toLowerCase()),
  );
  const Counter = ({ label, n }) => (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{n ?? 0}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
  async function apply() {
    setBusy(true);
    setDone("");
    try {
      const brand_terms = brandStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const keywords = kwList.filter((k) => selKw[k.kw]).map((k) => k.kw);
      const { error: cErr } = await supabase
        .from("clients")
        .update({ brand_terms, client_type: ctype })
        .eq("id", selectedClient.id);
      if (cErr) throw cErr;
      // Ausgewaehlte Keywords zur Uebernahme markieren; der agent-service wendet
      // sie beim naechsten Onboarding-Tick auf die BESTEHENDE keyword-setup-Route
      // an (Browser erreicht den localhost-Dienst nicht direkt).
      const applied = {
        keywords,
        brand_terms,
        client_type: ctype,
        at: new Date().toISOString(),
        processed: false,
      };
      await supabase
        .from("audit_runs")
        .update({ result: { ...res, applied } })
        .eq("id", run.id);
      setDone(
        `Uebernommen am ${new Date().toLocaleDateString("de-CH")} — ${keywords.length} Keywords zur Aufnahme markiert, Kundentyp/Brand-Terms gesetzt.`,
      );
      await refresh();
    } catch (e) {
      setDone("Fehler: " + String(e?.message || e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }
  const alreadyApplied = res.applied?.at;
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Onboarding-Vorschlag</div>
      <div
        style={{
          fontSize: 12,
          color: C.orange,
          background: C.orangeDim,
          border: `1px solid ${C.orange}44`,
          borderRadius: 8,
          padding: "8px 12px",
        }}
      >
        Vorschlag aus automatischem Scan — nichts ist aktiv, bis du uebernimmst.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 10,
        }}
      >
        <Counter label="Ranked Keywords" n={counts.ranked} />
        <Counter label="Keyword-Ideen" n={counts.ideas} />
        <Counter label="Organische Wettbewerber" n={counts.organicCompetitors} />
        <Counter label="Lokale Wettbewerber" n={counts.localCompetitors} />
      </div>
      {changes &&
      (changes.newRankedMoneyKw?.length ||
        changes.lostRankings?.length ||
        changes.newOrganicCompetitors?.length) ? (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: C.textMuted,
          }}
        >
          <b style={{ color: C.text }}>Seit letztem Scan:</b>{" "}
          {changes.newRankedMoneyKw?.length || 0} neu rankende Money-KW ·{" "}
          {changes.lostRankings?.length || 0} verlorene Rankings ·{" "}
          {changes.newOrganicCompetitors?.length || 0} neue Wettbewerber.{" "}
          <span style={{ color: C.textDim }}>Details in der Wunsch-Queue.</span>
        </div>
      ) : null}
      {/* Keyword-Universum */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
          Keyword-Universum
        </div>
        <div
          style={{
            maxHeight: 260,
            overflowY: "auto",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
          }}
        >
          {kwList.map((k, i) => (
            <label
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr auto auto auto",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderTop: i ? `1px solid ${C.border}` : "none",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={!!selKw[k.kw]}
                onChange={() => setSelKw((s) => ({ ...s, [k.kw]: !s[k.kw] }))}
              />
              <span style={{ color: C.text }}>
                {moneySet.has(k.kw.toLowerCase()) ? <Badge color={C.green}>Money</Badge> : null}{" "}
                {k.kw}
              </span>
              <span title="Position ist eine Labs-Schaetzung, keine Live-Messung">
                <Badge color={C.blue}>Labs-Schaetzung</Badge>
              </span>
              <span style={{ color: C.textMuted }}>Pos {k.position ?? "—"}</span>
              <span style={{ color: C.textDim }}>
                {k.searchVolume ?? "—"} · {k.intent || "—"}
              </span>
            </label>
          ))}
        </div>
      </div>
      {/* Organische Wettbewerber */}
      {orgList.length ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            Organische Wettbewerber
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8 }}>
            {orgList.map((o, i) => (
              <label
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr auto auto",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderTop: i ? `1px solid ${C.border}` : "none",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selOrg[o.domain]}
                  onChange={() => setSelOrg((s) => ({ ...s, [o.domain]: !s[o.domain] }))}
                />
                <span style={{ color: C.text }}>{o.domain}</span>
                <span style={{ color: C.textDim }}>{o.commonKeywords ?? "—"} KW</span>
                <span style={{ color: C.textDim }}>Ø {o.avgPosition ?? "—"}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {/* Lokale Wettbewerber */}
      {locList.length ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            Lokale Wettbewerber
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8 }}>
            {locList.map((l, i) => (
              <label
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr auto auto auto",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderTop: i ? `1px solid ${C.border}` : "none",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selLoc[l.cid || l.title]}
                  onChange={() =>
                    setSelLoc((s) => ({ ...s, [l.cid || l.title]: !s[l.cid || l.title] }))
                  }
                />
                <span style={{ color: C.text }}>{l.title}</span>
                <span style={{ color: C.textDim }}>★ {l.rating ?? "—"}</span>
                <span style={{ color: C.textDim }}>{l.votesCount ?? 0} Bew.</span>
                <span style={{ color: C.textDim }}>{l.city || "—"}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {/* Kundentyp + Brand-Terms + Uebernehmen */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div
            style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}
            title={res.suggestions?.clientTypeReason || ""}
          >
            Kundentyp ⓘ
          </div>
          <select
            value={ctype}
            onChange={(e) => setCtype(e.target.value)}
            style={{
              background: C.card,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            {CLIENT_TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
            Brand-Terms (Komma-getrennt)
          </div>
          <input
            value={brandStr}
            onChange={(e) => setBrandStr(e.target.value)}
            style={{
              width: "100%",
              background: C.card,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
            }}
          />
        </div>
        <button
          onClick={apply}
          disabled={busy}
          style={{
            background: `linear-gradient(135deg,#71008B,#B9009C)`,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Uebernehme…" : "Ausgewaehlte uebernehmen"}
        </button>
      </div>
      {done ? (
        <div style={{ fontSize: 12, color: done.startsWith("Fehler") ? C.red : C.green }}>
          {done}
        </div>
      ) : null}
      {alreadyApplied && !done ? (
        <div style={{ fontSize: 11, color: C.textDim }}>
          Zuletzt uebernommen am {new Date(alreadyApplied).toLocaleDateString("de-CH")}.
        </div>
      ) : null}
    </div>
  );
}

// Modul 1 (M1.5): Onboarding-Review. Nur bei vorhandener onboarding_scan-Zeile.
// Vorschlag aus automatischem Scan — nichts ist aktiv, bis der Mensch uebernimmt.
export const CLIENT_TYPES = [
  { v: "generic", l: "Allgemein" },
  { v: "hotel", l: "Hotel" },
  { v: "gastro", l: "Gastro" },
  { v: "local_service", l: "Lokaler Dienstleister" },
  { v: "ngo", l: "NPO / NGO" },
  { v: "ecommerce", l: "E-Commerce" },
];

// Stabiler Body-Builder fuer die CWV-Messung (Mobile wie der Sammel-Lauf).
export const PSI_MOBILE_BODY = () => ({ strategy: "mobile" });

export function SeoDashboard({ selectedClient, dateRange }) {
  // Kundenansicht (31.08., Volkan): Kunden-Logins sehen die technische
  // «Datenquellen der Widgets»-Tabelle nicht (interne Kanal-Information).
  const { role } = useAuth();
  const istKunde = role === "viewer";
  // Zeitraum-Anbindung (22.08.): Snapshots zum ENDE des gewählten Zeitraums
  // aus den gespeicherten Messläufen — Presets (Ende = heute) unverändert.
  const bis = dateRange?.end || null;
  const { run, refresh: refreshAhrefs } = useEzyLatestRun(selectedClient?.id, "ahrefs", bis);
  const live = run ? ahrefsKpisFromResult(run.result) : null;
  const { runs, refresh: refreshHistory } = useEzyAuditHistory(selectedClient?.id);
  const startDate = useMemo(
    () => dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    [dateRange?.start],
  );
  const trend = useMemo(
    () =>
      (runs || [])
        .filter((r) => {
          if (r.audit_type !== "ahrefs" || r.status !== "succeeded") return false;
          const d = new Date(r.started_at || r.created_at);
          return d >= startDate && (!bis || d <= new Date(bis).setHours(23, 59, 59, 999));
        })
        .map((r) => {
          const k = ahrefsKpisFromResult(r.result);
          const d = new Date(r.started_at || r.created_at);
          return {
            date: `${d.getDate()}.${d.getMonth() + 1}.`,
            Traffic: k.traffic,
            Visibility: k.visibility,
            Keywords: k.keywords,
          };
        })
        .reverse(),
    [runs, startDate, bis],
  );
  const { run: gscRun, refresh: refreshGsc } = useEzyLatestRun(
    selectedClient?.id,
    "gsc_summary",
    bis,
  );
  // Datumsfilter (2026-08-11): GSC-KPIs live im gewählten Zeitraum (Nur-Lese-
  // Abfrage, gecacht); Agent-Snapshot bleibt Fallback.
  const { data: liveGsc } = useLiveGa4(selectedClient?.id, "gsc-import", liveDaysFor(dateRange));
  const gscRes = liveGsc || gscRun?.result || null;
  const gsc = gscRes ? gscKpisFromResult(gscRes) : null;
  // Dashboard-Ausbau 2026-07-11: B1 Rankings (agent-service Rank-Store) + B2 GSC-Split.
  const { run: rankRun, refresh: refreshRank } = useEzyLatestRun(
    selectedClient?.id,
    "rankings",
    bis,
  );
  const rank = rankRun?.result || null;
  // Fenster-Delta (22.08., Volkan): Stand zu Zeitraum-BEGINN als Vergleich —
  // nur wenn ein früherer, ANDERER Lauf existiert (sonst kein Delta).
  // Vergleichsmodus (22.08., Volkan): aktiver Vergleich → "vorher" = Stand zum
  // Ende des VERGLEICHS-Zeitraums (Vorperiode/Vorjahr); sonst Zeitraum-Anfang.
  const cmpAktiv = !!dateRange?.compare;
  const von = cmpAktiv ? dateRange.compare.end : dateRange?.start || null;
  const { run: rankVonRun } = useEzyLatestRun(selectedClient?.id, "rankings", von);
  const { run: ahrefsVonRun } = useEzyLatestRun(selectedClient?.id, "ahrefs", von);
  const { run: trafVonRun } = useEzyLatestRun(selectedClient?.id, "ga4_traffic", von);
  const rankVon = rankVonRun && rankRun && rankVonRun.id !== rankRun.id ? rankVonRun.result : null;
  const ahrefsVon =
    ahrefsVonRun && run && ahrefsVonRun.id !== run.id
      ? ahrefsKpisFromResult(ahrefsVonRun.result)
      : null;
  const fensterPct = (jetzt, vorher) =>
    Number(vorher) > 0 && Number.isFinite(Number(jetzt))
      ? Math.round(((Number(jetzt) - Number(vorher)) / Number(vorher)) * 100)
      : undefined;
  const FENSTER_LABEL = cmpAktiv
    ? compareName(dateRange.compareMode) || "Vergleich"
    : "zu Zeitraum-Beginn";
  // Organic-Traffic-Vergleich (22.08., Volkan): GA4-Quelle → organische
  // Sessions des Vergleichszeitraums (Live-Endpoint); DFS-Quelle → gespeicherter
  // Ahrefs-Stand. GSC-Klicks haben keine Vergleichsquelle → keine Zeile.
  const { data: seoCmpData } = useGa4Compare(selectedClient?.id, dateRange);
  const { run: gscQRun } = useEzyLatestRun(selectedClient?.id, "gsc_queries", bis);
  const gscQ = gscQRun?.result || null;
  // Sichtbarkeits-Historie aus ECHTEN Daten (2026-08-13, User-Wunsch): monatliche
  // GA4-organisch-Besuche + GSC-Klicks/Query-Anzahl (audit_type seo_history,
  // populate-Job, Monats-Guard). Ersetzt die DFS-Labs-Modellkurve. Chart
  // beginnt beim ERSTEN Messpunkt (keine leere Null-Vorlaufzeit).
  const { run: seoHistRun } = useEzyLatestRun(selectedClient?.id, "seo_history");
  const seoHist = seoHistRun?.result || null;
  const seoHistSeries = useMemo(() => {
    const rows = Array.isArray(seoHist?.months) ? seoHist.months : [];
    const mapped = rows.map((m) => ({
      month: m.month,
      "Besuche (GA4)": m.ga4Organic ?? null,
      Keywords: m.gscQueries ?? null,
    }));
    const first = mapped.findIndex((m) => (m["Besuche (GA4)"] || 0) > 0 || (m.Keywords || 0) > 0);
    return first >= 0 ? mapped.slice(first) : [];
  }, [seoHist]);
  const seoHistHasGa4 = useMemo(
    () => seoHistSeries.some((m) => (m["Besuche (GA4)"] || 0) > 0),
    [seoHistSeries],
  );
  const { run: psiRun, refresh: refreshPsi } = useEzyLatestRun(
    selectedClient?.id,
    "pagespeed",
    bis,
  );
  const psi = psiRun ? pagespeedKpisFromResult(psiRun.result) : null;
  // Echte externe Messlaeufe (2026-08-18): bestehende Server-Routen, Status
  // running/success/error, Doppelstart-Guard modulweit in useMeasurement.
  const psiMeas = useMeasurement(
    selectedClient?.id,
    "pagespeed",
    "/api/google/pagespeed",
    PSI_MOBILE_BODY,
  );
  const ahrefsMeas = useMeasurement(selectedClient?.id, "ahrefs", "/api/ahrefs/overview");
  const cwvOrigin = psiRun?.result?.metrics?.dataOrigin || null; // B5a
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_traffic",
    bis,
  );
  // Datumsfilter-Fix (2026-08-10): Live-Traffic im gewählten Zeitraum (gecacht),
  // Snapshot-Fallback wie gehabt.
  const { data: liveTrafRes } = useLiveGa4(
    selectedClient?.id,
    "ga4-traffic",
    liveDaysFor(dateRange),
  );
  const traf = liveTrafRes
    ? ga4TrafficFromResult(liveTrafRes)
    : trafRun
      ? ga4TrafficFromResult(trafRun.result)
      : null;
  useEffect(() => {
    const interval = setInterval(
      () => {
        refreshAhrefs();
        refreshHistory();
        refreshGsc();
        refreshPsi();
        refreshTraf();
      },
      12 * 60 * 60 * 1000,
    ); // 12 Stunden
    return () => clearInterval(interval);
  }, [refreshAhrefs, refreshHistory, refreshGsc, refreshPsi, refreshTraf]);
  const { isOn } = useEzyDashboardConfig();
  const traffic = Number(live?.traffic ?? selectedClient?.traffic ?? 0);
  const keywords = Number(live?.keywords ?? selectedClient?.keywords ?? 0);
  const score = Number(live?.score ?? selectedClient?.score ?? 0);
  const visibility = Number(live?.visibility ?? selectedClient?.visibility ?? 0);
  const backlinks = Number(live?.backlinks ?? 0);
  const refdomainsSeries = run ? ahrefsRefdomainsSeriesFromResult(run.result) : [];
  const rankingDist = gscRes ? gscRankingDistributionFromResult(gscRes) : [];
  const RANK_COLORS = [C.accent, C.blue, C.green, C.orange, C.textDim];
  const topPages = traf?.topPages || [];
  // Switzerland Traffic NUR organisch (User-Wunsch 2026-08-13): bevorzugt die
  // organische Länder-Aufteilung (countriesOrganic); Fallback alle Kanäle,
  // solange ein alter Snapshot das neue Feld noch nicht hat (Label zeigt es).
  const chOrganicSessions = (traf?.countriesOrganic || []).find((c) =>
    /switzerland|schweiz|^ch$/i.test(c.country),
  )?.sessions;
  const chAllSessions = (traf?.countries || []).find((c) =>
    /switzerland|schweiz|^ch$/i.test(c.country),
  )?.sessions;
  const chSessions = chOrganicSessions ?? chAllSessions;
  const chSessionsOrganic = chOrganicSessions != null;
  const trafVonResult =
    trafVonRun && trafRun && trafVonRun.id !== trafRun.id ? trafVonRun.result : null;
  const chVonWert = (() => {
    // Organik-Karte: GA4-Live-Vergleich zuerst (Snapshots führen
    // countriesOrganic erst seit 13.08. — ältere Fenster wären sonst leer).
    if (chSessionsOrganic && cmpAktiv && Number(seoCmpData?.compare?.chOrganicSessions) > 0)
      return Math.round(Number(seoCmpData.compare.chOrganicSessions));
    if (!trafVonResult) return null;
    const liste = chSessionsOrganic ? trafVonResult.countriesOrganic : trafVonResult.countries;
    const v = (liste || []).find((c) => /switzerland|schweiz|^ch$/i.test(c.country))?.sessions;
    return Number(v) > 0 ? Math.round(Number(v)) : null;
  })();
  // "Organic Traffic" aus ECHTEN Daten (User-Wunsch 2026-08-13): GA4-Kanal
  // "Organic Search" im gewählten Zeitraum (wie Switzerland Traffic); Fallback
  // GSC-Klicks. Die DFS-ETV-Schätzung (live.traffic) nur noch als letzte
  // Reserve, wenn weder GA4 noch GSC verbunden sind.
  const organicSessions = (traf?.channels || []).find((c) =>
    /^organic search$/i.test(String(c.channel || "")),
  )?.sessions;
  const organicTraffic =
    organicSessions != null && organicSessions > 0
      ? organicSessions
      : gsc?.clicks > 0
        ? gsc.clicks
        : traffic > 0
          ? traffic
          : null;
  const organicTrafficSource =
    organicSessions != null && organicSessions > 0
      ? "GA4"
      : gsc?.clicks > 0
        ? "GSC-Klicks"
        : traffic > 0
          ? "DFS-Schätzung"
          : null;
  // GA4-Quelle: Live-Vergleich (exakter Zeitraum) zuerst; faellt er aus,
  // greift der gespeicherte ga4_traffic-Snapshot zum Vergleichszeitpunkt.
  const trafVonOrganic = trafVonResult
    ? (trafVonResult.channels || []).find((c) => /^organic search$/i.test(String(c.channel || "")))
        ?.sessions
    : null;
  const trafficCmpWert =
    organicTrafficSource === "GA4"
      ? cmpAktiv && Number(seoCmpData?.compare?.organicSessions) > 0
        ? Math.round(Number(seoCmpData.compare.organicSessions))
        : Number(trafVonOrganic) > 0
          ? Math.round(Number(trafVonOrganic))
          : null
      : organicTrafficSource === "DFS-Schätzung" && ahrefsVon?.traffic > 0
        ? Math.round(ahrefsVon.traffic)
        : null;
  const hasGsc = isOn("seo.gsc") && Boolean(gsc && (gsc.clicks > 0 || gsc.impressions > 0));
  const hasCwv =
    isOn("seo.cwv") &&
    Boolean(psi && (psi.lcp != null || psi.cls != null || psi.performanceScore != null));
  // Einheitliches Layout: auch ohne jegliche Daten rendert der Tab dieselben
  // Sektionen (als Platzhalter mit nächstem Schritt) statt eines Leerzustands.
  // 10er-Pagination der GSC-Suchbegriff-Tabellen (User-Wunsch 2026-07-19).
  const [gscQPage, setGscQPage] = useState(0);
  const [gscFbPage, setGscFbPage] = useState(0);
  const [rankPage, setRankPage] = useState(0);
  // Sortierung der Rankings-Tabelle (User-Wunsch 2026-07-19): Spaltenklick wechselt.
  // [0]=Spalte, [1]=asc (true) oder desc (false). Default: Position asc.
  const [rankSort, setRankSort] = useState(["pos", true]);
  const toggleRankSort = (col) => {
    setRankSort(([c, asc]) => (c === col ? [col, !asc] : [col, true]));
    setRankPage(0);
  };
  // KPI-Kachel-Filter (User-Wunsch 2026-08-13): Klick auf "Verbessert"/
  // "Verschlechtert" filtert die Rankings-Tabelle auf genau diese Keywords
  // (7-Tage-Delta, wie die Aggregat-Zahl). Nochmal klicken = Filter weg.
  const [rankFilter, setRankFilter] = useState(null); // null | "improved" | "declined"
  const toggleRankFilter = (f) => {
    setRankFilter((cur) => (cur === f ? null : f));
    setRankPage(0);
  };
  // Gesamter Keyword-Bestand (2026-08-12): getrackte KW (DataForSEO, präzise
  // Position + Verlauf + Volumen) UNION komplette GSC-Non-Brand-Queries
  // (GSC-Ø-Position + Klicks + Impressions). Dedup nach normalisiertem Keyword —
  // ein getracktes KW gewinnt gegen dieselbe GSC-Query. _src markiert die Quelle.
  const normKw = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const rankRows = useMemo(() => {
    const gq = gscQ && Array.isArray(gscQ.topNonbrandQueries) ? gscQ.topNonbrandQueries : [];
    // GSC-Lookup fuer getrackte Keywords (2026-08-13): Klicks/Impressionen auch
    // fuer Tracking-Zeilen befuellen. Non-Brand aus gsc_queries, Brand-Terms
    // als Fallback aus gsc_summary.topQueries (enthaelt Brand).
    const gscMap = new Map();
    for (const q of gq) gscMap.set(normKw(q.query), q);
    for (const q of gscRes?.topQueries || []) {
      const n = normKw(q.query);
      if (!gscMap.has(n)) gscMap.set(n, q);
    }
    const tracked = (rank?.keywords || []).map((k) => {
      const g = gscMap.get(normKw(k.kw));
      return { ...k, clicks: g?.clicks ?? null, impressions: g?.impressions ?? null, _src: "dfs" };
    });
    const seen = new Set(tracked.map((k) => normKw(k.kw)));
    const gscOnly = [];
    for (const q of gq) {
      const n = normKw(q.query);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      // DFS-Anreicherung (2026-08-13): Labs-Position/-URL + Suchvolumen kommen
      // woechentlich aus jobGscQueries; GSC-Ø-Position bleibt der Fallback.
      gscOnly.push({
        kw: q.query,
        pos: q.dfsPos != null ? q.dfsPos : q.position != null ? q.position : null,
        _posSrc: q.dfsPos != null ? "dfs" : "gsc",
        posPrev7: null,
        posPrev28: null,
        url: q.dfsUrl || null,
        volume: q.volume ?? null,
        clicks: q.clicks ?? null,
        impressions: q.impressions ?? null,
        _src: "gsc",
      });
    }
    let rows = [...tracked, ...gscOnly];
    // Kachel-Filter: nur Keywords mit echtem 7-Tage-Delta (getrackte; GSC-only
    // hat kein posPrev7 und faellt bei aktivem Filter bewusst raus).
    if (rankFilter === "improved")
      rows = rows.filter((k) => k.pos != null && k.posPrev7 != null && k.pos < k.posPrev7);
    else if (rankFilter === "declined")
      rows = rows.filter((k) => k.pos != null && k.posPrev7 != null && k.pos > k.posPrev7);
    if (!rows.length) return [];
    const [col, asc] = rankSort;
    const dir = asc ? 1 : -1;
    const delta7 = (k) => (k.posPrev7 != null && k.pos != null ? k.posPrev7 - k.pos : null);
    const delta28 = (k) => (k.posPrev28 != null && k.pos != null ? k.posPrev28 - k.pos : null);
    rows.sort((a, b) => {
      let av, bv;
      if (col === "kw") {
        av = String(a.kw || "").toLowerCase();
        bv = String(b.kw || "").toLowerCase();
        return dir * av.localeCompare(bv);
      }
      if (col === "pos") {
        av = a.pos ?? 999;
        bv = b.pos ?? 999;
      } else if (col === "d7") {
        av = delta7(a) ?? -999;
        bv = delta7(b) ?? -999;
      } else if (col === "d28") {
        av = delta28(a) ?? -999;
        bv = delta28(b) ?? -999;
      } else if (col === "clk") {
        av = a.clicks ?? -1;
        bv = b.clicks ?? -1;
      } else if (col === "imp") {
        av = a.impressions ?? -1;
        bv = b.impressions ?? -1;
      } else if (col === "vol") {
        av = a.volume ?? -1;
        bv = b.volume ?? -1;
      } else if (col === "posi") {
        av = a.posIntl ?? 999;
        bv = b.posIntl ?? 999;
      } else if (col === "voli") {
        av = a.volumeIntl ?? -1;
        bv = b.volumeIntl ?? -1;
      } else {
        av = 0;
        bv = 0;
      }
      return dir * (av - bv);
    });
    return rows;
  }, [rank, gscQ, gscRes, rankSort, rankFilter]);
  // Zähler für die Kopfzeile (getrackt vs. aus GSC gemergt).
  const rankCounts = useMemo(() => {
    let dfs = 0,
      gsc = 0;
    for (const r of rankRows) r._src === "gsc" ? (gsc += 1) : (dfs += 1);
    return { dfs, gsc, total: rankRows.length };
  }, [rankRows]);
  // INT-Zweitmessung (06.08.): Spalten nur zeigen, wenn der Kunde sie hat
  // (Store intl:true → Snapshot enthält posIntl/volumeIntl).
  const hasIntl = useMemo(
    () => (rank?.keywords || []).some((k) => "posIntl" in k || "volumeIntl" in k),
    [rank],
  );
  // Sortierung der GSC-Suchbegriff-Tabellen (User-Wunsch 2026-07-20): wie Rankings.
  // Erstklick: Query/Pos. aufsteigend, Metriken (Klicks/Impr./CTR) absteigend.
  const [gscQSort, setGscQSort] = useState(["clicks", false]);
  const toggleGscQSort = (col) => {
    setGscQSort(([c, asc]) => (c === col ? [col, !asc] : [col, col === "query" || col === "pos"]));
    setGscQPage(0);
  };
  const [gscFbSort, setGscFbSort] = useState(["clicks", false]);
  const toggleGscFbSort = (col) => {
    setGscFbSort(([c, asc]) => (c === col ? [col, !asc] : [col, col === "query" || col === "pos"]));
    setGscFbPage(0);
  };
  const sortQueries = (rows, [col, asc]) => {
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (col === "query") {
        return (
          dir *
          String(a.query || "")
            .toLowerCase()
            .localeCompare(String(b.query || "").toLowerCase())
        );
      }
      if (col === "pos") return dir * ((a.position ?? 999) - (b.position ?? 999));
      return dir * ((a[col] ?? -1) - (b[col] ?? -1));
    });
  };
  const gscQRows = useMemo(
    () =>
      gscQ && Array.isArray(gscQ.topNonbrandQueries)
        ? sortQueries(gscQ.topNonbrandQueries, gscQSort)
        : [],
    [gscQ, gscQSort],
  );
  const gscFbRows = useMemo(
    () => (gsc && Array.isArray(gsc.topQueries) ? sortQueries(gsc.topQueries, gscFbSort) : []),
    [gsc, gscFbSort],
  );
  const fmtDelta = (cur, prev) => {
    if (cur == null || prev == null) return null;
    return prev - cur; // Position kleiner = besser -> positives Delta = Verbesserung
  };
  const DeltaCell = ({ cur, prev }) => {
    const d = fmtDelta(cur, prev);
    if (d == null) return <span style={{ color: C.textDim }}>—</span>;
    if (d === 0) return <span style={{ color: C.textDim }}>±0</span>;
    const up = d > 0;
    return (
      <span style={{ color: up ? C.green : C.orange, fontWeight: 600 }}>
        {up ? "▲" : "▼"} {Math.abs(d)}
      </span>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <OnboardingPanel selectedClient={selectedClient} />
      <CompareBanner dateRange={dateRange} />
      {/* Datenstatus je Quelle (EzyRank-Ausbau 2026-08-18): echte Zeitstempel aus
          audit_runs bzw. Live-Abfragen — niemals erfundene Werte. Aktionen klar
          getrennt: "Daten neu laden" = nur Datenbankstand, "Neue Messung
          starten" = echte externe Laeufe (PageSpeed + DataForSEO-Backlinks). */}
      <DataStatus
        items={[
          runStatusItem("Rankings (DataForSEO)", rankRun, { staleDays: 3 }),
          liveGsc
            ? { source: "Suchbegriffe (GSC)", state: "live", detail: "Live-Abfrage" }
            : runStatusItem("Suchbegriffe (GSC)", gscRun, { staleDays: 3 }),
          {
            ...runStatusItem("Backlinks (DataForSEO)", run, { staleDays: 9 }),
            state:
              ahrefsMeas.state.status === "running"
                ? "running"
                : ahrefsMeas.state.status === "error"
                  ? "error"
                  : undefined,
            error: ahrefsMeas.state.status === "error" ? ahrefsMeas.state.error : null,
          },
          {
            ...runStatusItem("Core Web Vitals (PageSpeed)", psiRun, { staleDays: 9 }),
            state:
              psiMeas.state.status === "running"
                ? "running"
                : psiMeas.state.status === "error"
                  ? "error"
                  : undefined,
            error: psiMeas.state.status === "error" ? psiMeas.state.error : null,
          },
          liveTrafRes
            ? { source: "Besucher (GA4)", state: "live", detail: "Live-Abfrage" }
            : runStatusItem("Besucher (GA4)", trafRun, { staleDays: 3 }),
        ]}
        actions={[
          {
            label: "Daten neu laden",
            kind: "reload",
            title: "Liest nur den gespeicherten Datenbankstand neu — startet KEINE Messung",
            onClick: () => {
              refreshRank(true);
              refreshGsc(true);
              refreshAhrefs(true);
              refreshPsi(true);
              refreshTraf(true);
              void refreshHistory();
            },
          },
          {
            label: "Neue Messung starten",
            kind: "measure",
            title:
              "Startet echte externe Laeufe: PageSpeed (CWV) + DataForSEO-Backlink-Overview. Rankings/GSC/GA4 misst der naechtliche Sammel-Lauf.",
            busy: psiMeas.state.status === "running" || ahrefsMeas.state.status === "running",
            onClick: async () => {
              // Doppelstart-Guard sitzt in useMeasurement (modulweit).
              const [psiOk, ahOk] = await Promise.all([psiMeas.start(), ahrefsMeas.start()]);
              if (psiOk) refreshPsi(true);
              if (ahOk) refreshAhrefs(true);
            },
          },
        ]}
        hint={
          !liveGsc && !gscRun && !liveTrafRes && !trafRun
            ? "Google (GSC/GA4) verbinden: Admin → Kunden → Onboarding → Google"
            : undefined
        }
      />
      {rank || rankRows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rank && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                gap: 14,
              }}
            >
              <KpiCard
                icon={Award}
                label="In Top 3"
                value={rank.aggregate?.top3 ?? "—"}
                color={C.green}
                change={
                  rank.aggregate?.top3 != null
                    ? fensterPct(rank.aggregate.top3, rankVon?.aggregate?.top3)
                    : undefined
                }
                compareValue={rankVon?.aggregate?.top3 ?? undefined}
                compareLabel={FENSTER_LABEL}
              />
              <KpiCard
                icon={Target}
                label="In Top 10"
                value={rank.aggregate?.top10 ?? "—"}
                color={C.accent}
                change={
                  rank.aggregate?.top10 != null
                    ? fensterPct(rank.aggregate.top10, rankVon?.aggregate?.top10)
                    : undefined
                }
                compareValue={rankVon?.aggregate?.top10 ?? undefined}
                compareLabel={FENSTER_LABEL}
              />
              {/* Klickbare Filter-Kacheln (2026-08-13): filtern die Rankings-
                Tabelle auf verbesserte/verschlechterte Keywords (Toggle). */}
              <div
                onClick={() => toggleRankFilter("improved")}
                title="Klick: nur verbesserte Keywords in der Tabelle zeigen"
                style={{
                  cursor: "pointer",
                  borderRadius: 14,
                  outline: rankFilter === "improved" ? `2px solid ${C.green}` : "none",
                }}
              >
                <KpiCard
                  icon={TrendingUp}
                  label="Verbessert (7 Tage)"
                  value={rank.aggregate?.improved7 ?? "—"}
                  color={C.green}
                />
              </div>
              <div
                onClick={() => toggleRankFilter("declined")}
                title="Klick: nur verschlechterte Keywords in der Tabelle zeigen"
                style={{
                  cursor: "pointer",
                  borderRadius: 14,
                  outline: rankFilter === "declined" ? `2px solid ${C.orange}` : "none",
                }}
              >
                <KpiCard
                  icon={Activity}
                  label="Verschlechtert (7 Tage)"
                  value={rank.aggregate?.declined7 ?? "—"}
                  color={C.orange}
                />
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
              {/* Kundenansicht (31.08.): Quellen-Split + INT-Erklaerung sind
                  interne Angaben — Kunden sehen nur Anzahl + Stand. */}
              Rankings ({rankCounts.total} Keywords
              {!istKunde && rankCounts.gsc > 0
                ? ` · ${rankCounts.dfs} getrackt + ${rankCounts.gsc} aus GSC`
                : ""}
              {" · Stand "}
              {rank?.date || gscQ?.range?.to || "—"})
              {rankFilter && (
                <span
                  onClick={() => toggleRankFilter(rankFilter)}
                  title="Filter entfernen"
                  style={{
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: (rankFilter === "improved" ? C.green : C.orange) + "22",
                    color: rankFilter === "improved" ? C.green : C.orange,
                  }}
                >
                  {rankFilter === "improved" ? "nur Verbesserte (7T)" : "nur Verschlechterte (7T)"}{" "}
                  ✕
                </span>
              )}
              {hasIntl && !istKunde ? " · INT = google.com (USA/en, wöchentliche Messung)" : ""}
            </div>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table
                style={{ width: "100%", minWidth: 780, borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    {[
                      ["kw", "Keyword", "left"],
                      ["pos", "Position", "right"],
                      // INT-Spalten (google.com USA/en, wöchentliche Messung)
                      ...(hasIntl ? [["posi", "Pos. INT", "right"]] : []),
                      ["d7", "Δ 7T", "right"],
                      ["d28", "Δ 28T", "right"],
                      ["clk", "Klicks", "right"],
                      ["imp", "Impr.", "right"],
                      [null, "URL", "left"],
                      ["vol", "Volumen", "right"],
                      ...(hasIntl ? [["voli", "Vol. INT", "right"]] : []),
                      // Quelle (Tracking/GSC) ist interne Information (31.08.).
                      ...(istKunde ? [] : [[null, "Quelle", "right"]]),
                    ].map(([col, label, align]) => (
                      <th
                        key={label}
                        onClick={col ? () => toggleRankSort(col) : undefined}
                        title={col ? "Klicken zum Sortieren" : undefined}
                        style={{
                          padding: "6px 8px",
                          textAlign: align,
                          cursor: col ? "pointer" : "default",
                          userSelect: "none",
                          whiteSpace: "nowrap",
                          color: rankSort[0] === col ? C.accent : undefined,
                        }}
                      >
                        {label}
                        {rankSort[0] === col ? (rankSort[1] ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rankRows
                    .slice(
                      Math.min(rankPage, Math.ceil(rankRows.length / 10) - 1) * 10,
                      Math.min(rankPage, Math.ceil(rankRows.length / 10) - 1) * 10 + 10,
                    )
                    .map((k, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 8px", color: C.text }}>{k.kw}</td>
                        <td
                          style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}
                          title={
                            k._src === "gsc"
                              ? k._posSrc === "dfs"
                                ? "Labs-Position (DataForSEO, google.ch — wöchentlich)"
                                : "GSC-Ø-Position (Durchschnitt über den Zeitraum)"
                              : undefined
                          }
                        >
                          {k.pos != null ? k.pos : "> 100"}
                        </td>
                        {hasIntl && (
                          <td
                            style={{ padding: "6px 8px", textAlign: "right" }}
                            title={k.urlIntl || undefined}
                          >
                            {k.posIntl != null ? k.posIntl : "—"}
                          </td>
                        )}
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <DeltaCell cur={k.pos} prev={k.posPrev7} />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <DeltaCell cur={k.pos} prev={k.posPrev28} />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: C.textMuted }}>
                          {k.clicks != null ? k.clicks.toLocaleString("de-CH") : "—"}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: C.textMuted }}>
                          {k.impressions != null ? k.impressions.toLocaleString("de-CH") : "—"}
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            color: C.textMuted,
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {k.url || "—"}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          {k.volume != null ? k.volume.toLocaleString("de-CH") : "—"}
                        </td>
                        {hasIntl && (
                          <td
                            style={{ padding: "6px 8px", textAlign: "right", color: C.textMuted }}
                          >
                            {k.volumeIntl != null ? k.volumeIntl.toLocaleString("de-CH") : "—"}
                          </td>
                        )}
                        {istKunde ? null : (
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 7px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 600,
                                color: k._src === "gsc" ? C.blue : C.accent,
                                background: k._src === "gsc" ? `${C.blue}1a` : `${C.accent}1a`,
                              }}
                              title={
                                k._src === "gsc"
                                  ? "Aus Google Search Console (nicht getrackt)"
                                  : "Aktives Rank-Tracking (DataForSEO)"
                              }
                            >
                              {k._src === "gsc" ? "GSC" : "Tracking"}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <SeoPager
              page={rankPage}
              setPage={setRankPage}
              total={rankRows.length}
              unit="Keywords"
            />
          </div>
        </div>
      ) : (
        <SectionPlaceholder
          title="Rankings (Keyword-Tracking)"
          hint="Für diesen Kunden ist noch kein Rank-Tracking eingerichtet — Keyword-Set im Rank-Tracking hinterlegen, dann erscheinen hier Top-3/Top-10, Veränderungen und die Rankings-Tabelle."
        />
      )}
      {seoHistSeries.length >= 2 && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.textMuted }}>
            Sichtbarkeit (organisch)
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>
            {seoHistHasGa4
              ? "GA4 (organische Besuche) + Google Search Console (Keywords)"
              : "Google Search Console (Keywords)"}
            {" · monatlich · nur volle Monate"}
            {(() => {
              const last = seoHistSeries[seoHistSeries.length - 1];
              const v = seoHistHasGa4 ? last?.["Besuche (GA4)"] : null;
              return v != null
                ? ` · zuletzt ${Math.round(v).toLocaleString("de-CH")} organische Besuche/Mon.`
                : "";
            })()}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={seoHistSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" stroke={C.textDim} fontSize={11} />
              <YAxis yAxisId="left" stroke={C.textDim} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke={C.textDim} fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.textMuted,
                }}
              />
              <Legend />
              {seoHistHasGa4 && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="Besuche (GA4)"
                  stroke={C.accent}
                  strokeWidth={2}
                  dot={false}
                />
              )}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Keywords"
                stroke={C.blue}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {isOn("seo.ahrefs") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 14,
          }}
        >
          <KpiCard
            icon={Globe}
            label={
              organicTrafficSource ? `Organic Traffic (${organicTrafficSource})` : "Organic Traffic"
            }
            value={
              organicTraffic != null ? Math.round(organicTraffic).toLocaleString("de-CH") : "—"
            }
            color={C.accent}
            change={
              organicTraffic != null && trafficCmpWert != null
                ? fensterPct(organicTraffic, trafficCmpWert)
                : undefined
            }
            compareValue={trafficCmpWert != null ? trafficCmpWert : undefined}
            compareLabel={FENSTER_LABEL}
          />
          <KpiCard
            icon={Eye}
            label="Visibility Index"
            value={visibility > 0 ? visibility : "—"}
            color={C.blue}
            change={visibility > 0 ? fensterPct(visibility, ahrefsVon?.visibility) : undefined}
            compareValue={ahrefsVon?.visibility > 0 ? ahrefsVon.visibility : undefined}
            compareLabel={FENSTER_LABEL}
          />
          <KpiCard
            icon={Award}
            label="Authority Score"
            value={score > 0 ? score : "—"}
            color={C.green}
            change={score > 0 ? fensterPct(score, ahrefsVon?.score) : undefined}
            compareValue={ahrefsVon?.score > 0 ? ahrefsVon.score : undefined}
            compareLabel={FENSTER_LABEL}
          />
          <KpiCard
            icon={Target}
            label="Organic Keywords"
            value={keywords > 0 ? keywords : "—"}
            color={C.orange}
            change={keywords > 0 ? fensterPct(keywords, ahrefsVon?.keywords) : undefined}
            compareValue={ahrefsVon?.keywords > 0 ? ahrefsVon.keywords : undefined}
            compareLabel={FENSTER_LABEL}
          />
          <KpiCard
            icon={Link2}
            label="Backlinks Total"
            value={backlinks > 0 ? backlinks.toLocaleString("de-CH") : "—"}
            color={C.cyan}
            change={backlinks > 0 ? fensterPct(backlinks, ahrefsVon?.backlinks) : undefined}
            compareValue={
              ahrefsVon?.backlinks > 0 ? ahrefsVon.backlinks.toLocaleString("de-CH") : undefined
            }
            compareLabel={FENSTER_LABEL}
          />
          {chSessions != null && chSessions > 0 && (
            <KpiCard
              icon={MapPin}
              label={
                chSessionsOrganic
                  ? "Switzerland Traffic (organisch)"
                  : "Switzerland Traffic (alle Kanäle)"
              }
              value={chSessions.toLocaleString("de-CH")}
              color={C.pink}
              change={chVonWert != null ? fensterPct(chSessions, chVonWert) : undefined}
              compareValue={chVonWert != null ? chVonWert.toLocaleString("de-CH") : undefined}
              compareLabel={FENSTER_LABEL}
            />
          )}
        </div>
      )}
      {isOn("seo.gsc") && gscQ && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* B2a: Brand vs. Non-Brand (28 Tage, GSC-Puffer heute-3) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
              gap: 14,
            }}
          >
            {[
              ["Brand", gscQ.brand, C.blue],
              ["Non-Brand", gscQ.nonbrand, C.accent],
            ].map(([label, seg, color]) => (
              <div
                key={label}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                  {label} · {gscQ.range?.from} – {gscQ.range?.to}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>
                  {(seg?.clicks ?? 0).toLocaleString("de-CH")} Klicks
                </div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {(seg?.impressions ?? 0).toLocaleString("de-CH")} Impressionen ·{" "}
                  {(seg?.queries ?? 0).toLocaleString("de-CH")} Suchanfragen
                </div>
              </div>
            ))}
          </div>
          {/* B2b: Positions-Buckets Non-Brand */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
              gap: 14,
            }}
          >
            {[
              ["Top 3", gscQ.buckets_nonbrand?.top3, C.green],
              ["Top 10", gscQ.buckets_nonbrand?.top10, C.accent],
              ["11–20", gscQ.buckets_nonbrand?.pos11to20, C.orange],
              ["21+", gscQ.buckets_nonbrand?.pos21plus, C.textDim],
            ].map(([label, b, color]) => (
              <div
                key={label}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 14,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{b?.queries ?? 0}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {label} · {(b?.clicks ?? 0).toLocaleString("de-CH")} Klicks
                </div>
              </div>
            ))}
          </div>
          {/* B2c: Top-Non-Brand-Queries + Ø-Position als Sekundaer-Metrik */}
          {Array.isArray(gscQ.topNonbrandQueries) && gscQ.topNonbrandQueries.length > 0 && (
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
                  alignItems: "baseline",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
                  Top Non-Brand-Suchanfragen
                </div>
                {gsc && gsc.position > 0 && (
                  <div
                    style={{ fontSize: 11, color: C.textDim, cursor: "help" }}
                    title="Vorsicht: sinkt oft, wenn neue Keywords erstmals ranken."
                  >
                    Ø Position {gsc.position.toFixed(1)} ⓘ
                  </div>
                )}
              </div>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table
                  style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13 }}
                >
                  <thead>
                    <tr style={{ color: C.textDim, textAlign: "left" }}>
                      {[
                        ["query", "Query", "left"],
                        ["clicks", "Klicks", "right"],
                        ["impressions", "Impr.", "right"],
                        ["pos", "Pos.", "right"],
                      ].map(([col, label, align]) => (
                        <th
                          key={label}
                          onClick={() => toggleGscQSort(col)}
                          title="Klicken zum Sortieren"
                          style={{
                            padding: "6px 8px",
                            textAlign: align,
                            cursor: "pointer",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                            color: gscQSort[0] === col ? C.accent : undefined,
                          }}
                        >
                          {label}
                          {gscQSort[0] === col ? (gscQSort[1] ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gscQRows
                      .slice(
                        Math.min(gscQPage, Math.ceil(gscQRows.length / 10) - 1) * 10,
                        Math.min(gscQPage, Math.ceil(gscQRows.length / 10) - 1) * 10 + 10,
                      )
                      .map((q, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px", color: C.text }}>{q.query}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{q.clicks}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            {q.impressions}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            {Number(q.position).toFixed(1)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <SeoPager
                page={gscQPage}
                setPage={setGscQPage}
                total={gscQ.topNonbrandQueries.length}
                unit="Suchanfragen"
              />
            </div>
          )}
        </div>
      )}
      {hasGsc && !gscQ && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              icon={Activity}
              label="GSC Klicks"
              value={gsc.clicks > 0 ? gsc.clicks : "—"}
              color={C.accent}
            />
            <KpiCard
              icon={Eye}
              label="GSC Impressionen"
              value={gsc.impressions > 0 ? gsc.impressions : "—"}
              color={C.blue}
            />
            <KpiCard
              icon={TrendingUp}
              label="GSC CTR"
              value={gsc.ctr > 0 ? `${(gsc.ctr * 100).toFixed(1)}%` : "—"}
              color={C.green}
            />
            <KpiCard
              icon={Target}
              label="Ø Position"
              value={gsc.position > 0 ? gsc.position.toFixed(1) : "—"}
              color={C.orange}
            />
          </div>
          {gsc.topQueries.length > 0 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
                Top-Suchbegriffe (Search Console)
              </div>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table
                  style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13 }}
                >
                  <thead>
                    <tr style={{ color: C.textDim, textAlign: "left" }}>
                      {[
                        ["query", "Query", "left"],
                        ["clicks", "Klicks", "right"],
                        ["impressions", "Impr.", "right"],
                        ["ctr", "CTR", "right"],
                        ["pos", "Pos.", "right"],
                      ].map(([col, label, align]) => (
                        <th
                          key={label}
                          onClick={() => toggleGscFbSort(col)}
                          title="Klicken zum Sortieren"
                          style={{
                            padding: "6px 8px",
                            textAlign: align,
                            cursor: "pointer",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                            color: gscFbSort[0] === col ? C.accent : undefined,
                          }}
                        >
                          {label}
                          {gscFbSort[0] === col ? (gscFbSort[1] ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gscFbRows
                      .slice(
                        Math.min(gscFbPage, Math.ceil(gscFbRows.length / 10) - 1) * 10,
                        Math.min(gscFbPage, Math.ceil(gscFbRows.length / 10) - 1) * 10 + 10,
                      )
                      .map((q, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px", color: C.text }}>{q.query}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{q.clicks}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            {q.impressions}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            {(q.ctr * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>
                            {q.position?.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <SeoPager
                page={gscFbPage}
                setPage={setGscFbPage}
                total={gsc.topQueries.length}
                unit="Suchbegriffe"
              />
            </div>
          )}
        </>
      )}
      {isOn("seo.gsc") && !gscQ && !hasGsc && (
        <SectionPlaceholder
          title="Search Console (Klicks, Impressionen, Suchanfragen)"
          hint="Noch keine GSC-Daten — Google im Kunden-Panel verbinden, GSC-Property eintragen und einen Import/Sammel-Lauf starten."
        />
      )}
      {isOn("seo.cwv") && !hasCwv && (
        <SectionPlaceholder
          title="Core Web Vitals (LCP, INP, CLS, Performance)"
          hint="Noch keine PageSpeed-Daten — Sammel-Lauf im Google-Panel starten; bei Seiten mit wenig Traffic können CrUX-Felddaten fehlen (dann Labordaten)."
        />
      )}
      {hasCwv && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cwvOrigin && (
            <div>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: cwvOrigin === "lab" ? `${C.orange}22` : `${C.green}22`,
                  color: cwvOrigin === "lab" ? C.orange : C.green,
                  cursor: cwvOrigin === "lab" ? "help" : "default",
                }}
                title={
                  cwvOrigin === "lab"
                    ? "Labordaten schwanken zwischen Laeufen — Trends mit Vorsicht lesen."
                    : undefined
                }
              >
                {cwvOrigin === "field"
                  ? "Felddaten (CrUX)"
                  : cwvOrigin === "field-origin"
                    ? "Felddaten (Origin)"
                    : "Labordaten (Lighthouse)"}
                {cwvOrigin === "lab" ? " ⓘ" : ""}
              </span>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              icon={Activity}
              label="LCP"
              value={psi.lcp != null ? `${(psi.lcp / 1000).toFixed(2)}s` : "—"}
              color={psi.lcp != null && psi.lcp <= 2500 ? C.green : C.orange}
            />
            <KpiCard
              icon={Zap}
              label="INP"
              value={psi.inp != null ? `${Math.round(psi.inp)}ms` : "—"}
              color={psi.inp != null && psi.inp <= 200 ? C.green : C.orange}
            />
            <KpiCard
              icon={LayoutGrid}
              label="CLS"
              value={psi.cls != null ? psi.cls.toFixed(2) : "—"}
              color={psi.cls != null && psi.cls <= 0.1 ? C.green : C.orange}
            />
            <KpiCard
              icon={Award}
              label="Performance"
              value={psi.performanceScore != null ? `${psi.performanceScore}/100` : "—"}
              color={C.accent}
            />
          </div>
        </div>
      )}
      {(isOn("seo.gsc") || isOn("seo.ahrefs")) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: 14,
          }}
        >
          {isOn("seo.gsc") && rankingDist.length === 0 && (
            <SectionPlaceholder
              title="Ranking-Verteilung"
              hint="Erscheint, sobald der GSC-Import Positionsdaten liefert (Google verbinden + Property eintragen)."
            />
          )}
          {isOn("seo.ahrefs") && refdomainsSeries.length < 2 && (
            <SectionPlaceholder
              title="Verweisende Domains"
              hint="Braucht mindestens 2 DataForSEO-Datenpunkte — füllt sich automatisch mit den nächsten Läufen."
            />
          )}
          {isOn("seo.gsc") && rankingDist.length > 0 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.textMuted }}>
                Ranking-Verteilung
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>
                Positionen der importierten GSC Top-Keywords
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={rankingDist}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {rankingDist.map((entry, i) => (
                      <Cell key={entry.name} fill={RANK_COLORS[i % RANK_COLORS.length]} />
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
          {isOn("seo.ahrefs") && refdomainsSeries.length >= 2 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.textMuted }}>
                Verweisende Domains
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>
                DataForSEO (Backlinks-Historie, letzte 90 Tage)
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={refdomainsSeries}>
                  <defs>
                    <linearGradient id="seo-refdomains" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.cyan} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis
                    dataKey="date"
                    stroke={C.textDim}
                    fontSize={11}
                    tickFormatter={(d) =>
                      typeof d === "string" && d.length >= 10 ? d.slice(5) : d
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
                  <Area
                    type="monotone"
                    dataKey="refdomains"
                    name="Verweisende Domains"
                    stroke={C.cyan}
                    fill="url(#seo-refdomains)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
      {topPages.length === 0 && (
        <SectionPlaceholder
          title="Meistbesuchte Seiten (GA4)"
          hint="Noch keine GA4-Traffic-Daten — Google verbinden, GA4-Property eintragen und einen Sammel-Lauf starten."
        />
      )}
      {topPages.length > 0 && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
            Meistbesuchte Seiten (GA4)
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ color: C.textDim, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Seite</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Aufrufe</th>
                </tr>
              </thead>
              <tbody>
                {topPages.slice(0, 15).map((p, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td
                      style={{
                        padding: "6px 8px",
                        color: C.text,
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.path}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {p.views.toLocaleString("de-CH")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {isOn("seo.trend") && trend.length >= 2 ? (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
            Entwicklung ({dateRange?.label || "30 Tage"} • {trend.length} Datenpunkte)
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.textDim} fontSize={11} />
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
              <Line
                type="monotone"
                dataKey="Traffic"
                stroke={C.accent}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Visibility"
                stroke={C.blue}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Keywords"
                stroke={C.orange}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : isOn("seo.trend") && !istKunde ? (
        // Interner Platzhalter (31.08.: in der Kundenansicht ausgeblendet —
        // der Hinweis auf Daten-Läufe/Quellen ist Team-Information).
        <SectionPlaceholder
          title="Entwicklung (Traffic · Visibility · Keywords)"
          hint="Braucht mindestens 2 Daten-Läufe (DataForSEO) im gewählten Zeitraum — Datumsfilter weiter fassen oder auf die nächsten automatischen Läufe warten."
        />
      ) : null}
      {/* Datenquellen-Übersicht (User-Wunsch 2026-07-17): welches Widget bezieht
          seine Daten aus welchem Kanal — inkl. Stand des letzten Abrufs je
          Quelle. Nur intern — Kunden-Logins sehen die Tabelle nicht (31.08.). */}
      {istKunde ? null : (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.textMuted }}>
            Datenquellen der Widgets
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>
            Welcher Block bezieht seine Daten aus welchem Kanal · „Letzter Abruf" = Stand des
            jüngsten Daten-Laufs für diesen Kunden.
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ color: C.textDim, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Widget</th>
                  <th style={{ padding: "6px 8px" }}>Kanal / Quelle</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Letzter Abruf</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Rankings (Top 3 · Top 10 · Tabelle)", "DataForSEO Rank-Tracking", rankRun],
                  [
                    "Organic Traffic",
                    "GA4 (Organic Search) · Fallback GSC-Klicks",
                    trafRun || gscRun,
                  ],
                  [
                    "SEO-KPIs (Visibility, Authority, Keywords, Backlinks)",
                    "DataForSEO (Backlinks & Labs)",
                    run,
                  ],
                  ["Switzerland Traffic", "GA4 (Organic Search, nur CH)", trafRun],
                  [
                    "Brand/Non-Brand-Split · Positions-Buckets · Top-Suchanfragen",
                    "Google Search Console",
                    gscQRun || gscRun,
                  ],
                  ["Ranking-Verteilung", "Google Search Console", gscRun],
                  [
                    "Core Web Vitals (LCP, INP, CLS, Performance)",
                    "Google PageSpeed (CrUX/Lighthouse)",
                    psiRun,
                  ],
                  ["Verweisende Domains", "DataForSEO (Backlinks-Historie)", run],
                  ["Meistbesuchte Seiten", "Google Analytics 4", trafRun],
                  ["Entwicklung (Trend)", "DataForSEO (Verlauf der Audit-Läufe)", run],
                ].map(([widget, source, r]) => (
                  <tr key={widget} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", color: C.text }}>{widget}</td>
                    <td style={{ padding: "6px 8px", color: C.textMuted }}>{source}</td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        color: r ? C.textMuted : C.orange,
                      }}
                    >
                      {r
                        ? new Date(r.started_at || r.created_at).toLocaleDateString("de-CH", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "keine Daten"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function GeoDashboard({ selectedClient, dateRange }) {
  const providerKeys = ["ChatGPT", "Perplexity", "Gemini", "Claude"];
  const { isOn } = useEzyDashboardConfig();
  const live = useLiveIntegrations();
  const overview = useCanonryOverview(selectedClient);
  const liveCanonry = live.data?.canonry;
  const liveRefresh = live.refresh;
  const overviewRefresh = overview.refresh;
  useEffect(() => {
    const interval = setInterval(
      () => {
        liveRefresh?.();
        overviewRefresh?.();
      },
      12 * 60 * 60 * 1000,
    ); // 12 Stunden
    return () => clearInterval(interval);
  }, [liveRefresh, overviewRefresh]);
  const verifiedProviders = Object.entries(live.data?.providers || {})
    .filter(([, v]) => v?.verified)
    .map(([k]) => canonryProviderLabel(k));
  // The /api/live/status canonry probe returns { configured, ok } (not
  // reachable/authenticated) — using the real `ok` field. And a successful
  // project overview IS the definitive proof that Canonry is reachable +
  // authenticated + the project exists, so GEO renders whenever it returns one.
  const canonryServiceReady = Boolean(liveCanonry?.configured && liveCanonry?.ok);
  const projectLiveReady = Boolean(overview.data?.project);
  const canonry = useMemo(
    () => (projectLiveReady ? buildCanonryLiveModel(selectedClient, overview.data) : null),
    [selectedClient, overview.data, projectLiveReady],
  );
  const missingBits = [...(liveCanonry?.missing || [])];
  if (liveCanonry?.configured && !liveCanonry?.ok && !projectLiveReady)
    missingBits.push("Canonry Service");
  if (canonryServiceReady && !projectLiveReady) missingBits.push("Projekt-Overview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {live.loading && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: "16px 18px",
          }}
        >
          <Skeleton w="42%" h={14} />
          <div style={{ marginTop: 10 }}>
            <Skeleton w="92%" h={12} />
          </div>
        </div>
      )}
      {!live.loading && live.error && (
        <div
          style={{
            background: C.redDim,
            border: `1px solid ${C.red}35`,
            borderRadius: 14,
            padding: "14px 16px",
            fontSize: 13,
            color: C.text,
          }}
        >
          Live-Status konnte nicht geladen werden:{" "}
          <span style={{ color: C.textMuted }}>{live.error}</span>
        </div>
      )}
      {overview.error && canonryServiceReady && (
        <div
          style={{
            background: C.orangeDim,
            border: `1px solid ${C.orange}35`,
            borderRadius: 14,
            padding: "12px 16px",
            fontSize: 13,
            color: C.text,
          }}
        >
          Projektbezogene Canonry-Daten konnten nicht geladen werden:{" "}
          <span style={{ color: C.textMuted }}>{overview.error}</span>
        </div>
      )}
      {!projectLiveReady && !live.loading && (
        <div
          style={{
            background: C.card,
            border: `1px dashed ${C.border}`,
            borderRadius: 14,
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            Noch keine Canonry Live-Daten
          </div>
          <div
            style={{
              fontSize: 12,
              color: C.textMuted,
              maxWidth: 520,
              margin: "0 auto 14px",
              lineHeight: 1.6,
            }}
          >
            Sobald die Canonry Live-Bridge erreichbar ist, ein Projekt für diesen Kunden hinterlegt
            ist und ein Sweep gelaufen ist, erscheinen hier KPIs, Citation-Trends und Evidence
            direkt aus Canonry.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {missingBits.length ? (
              missingBits.map((bit) => (
                <Badge key={bit} color={C.orange}>
                  {bit}
                </Badge>
              ))
            ) : (
              <Badge color={C.orange}>Canonry Check offen</Badge>
            )}
          </div>
        </div>
      )}
      {projectLiveReady && canonry && (
        <SectionErrorBoundary label="GEO-Dashboard">
          <>
            <div
              style={{
                background: `linear-gradient(135deg,${C.greenDim},${C.blueDim}), ${C.card}`,
                border: `1px solid ${C.green}35`,
                borderRadius: 16,
                padding: "20px 22px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                gap: 18,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.green,
                    textTransform: "uppercase",
                    letterSpacing: ".6px",
                    marginBottom: 6,
                  }}
                >
                  Canonry live verbunden
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>
                  {canonry.project}
                </div>
                <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
                  AEO-Monitoring läuft über die Canonry Live-Bridge.
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  justifyContent: "center",
                }}
              >
                <div style={{ fontSize: 13, color: C.text }}>
                  <span style={{ color: C.textMuted }}>Letzter Sweep:</span>{" "}
                  {canonry.latestRun.time} • {canonry.latestRun.duration}
                </div>
                <div style={{ fontSize: 13, color: C.text }}>
                  <span style={{ color: C.textMuted }}>Schedule:</span> {canonry.schedule}
                </div>
                {liveCanonry?.detail && (
                  <div style={{ fontSize: 13, color: C.text }}>
                    <span style={{ color: C.textMuted }}>Service:</span> {liveCanonry.detail}
                  </div>
                )}
                {verifiedProviders.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {verifiedProviders.map((p) => (
                      <Badge key={p} color={C.green}>
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {canonry.insights?.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: ".5px",
                    }}
                  >
                    Operator Insights
                  </div>
                  {canonry.insights.map((insight) => (
                    <div
                      key={insight}
                      style={{
                        fontSize: 13,
                        color: C.text,
                        lineHeight: 1.5,
                        background: "rgba(10,11,15,.24)",
                        border: `1px solid ${C.hairline}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                      }}
                    >
                      {insight}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isOn("geo.kpis") && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                  gap: 14,
                }}
              >
                <KpiCard
                  icon={Sparkles}
                  label="AI Coverage"
                  value={canonry.coverage}
                  suffix="%"
                  change={canonry.coverageDelta}
                  color={C.accent}
                />
                <KpiCard
                  icon={Bot}
                  label="AI Referral Visits"
                  value={canonry.aiVisitors}
                  change={canonry.aiVisitorsDelta}
                  color={C.green}
                />
                <KpiCard
                  icon={FileText}
                  label="Citation Evidence"
                  value={canonry.citations}
                  change={canonry.citationsDelta}
                  color={C.blue}
                />
                <KpiCard
                  icon={Activity}
                  label="Health Snapshot"
                  value={canonry.healthScore}
                  suffix="/100"
                  change={canonry.healthDelta}
                  color={C.orange}
                />
              </div>
            )}
            {isOn("geo.trend") && canonry.providerSeries?.length > 0 && (
              <ChartCard title="Citation Trend by Provider" action="Live">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={canonry.providerSeries}>
                    <defs>
                      {providerKeys.map((k) => (
                        <linearGradient key={k} id={`canonry-${k}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={AI_COLORS[k]} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={AI_COLORS[k]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: C.textDim, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: C.textDim, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<CTooltip />} />
                    {providerKeys.map((k) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={AI_COLORS[k]}
                        fill={`url(#canonry-${k})`}
                        strokeWidth={2}
                        name={k}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {isOn("geo.evidence") && canonry.evidence?.length > 0 && (
              <ChartCard title="Latest Evidence" minH={220}>
                <DTable
                  columns={[
                    {
                      label: "Query",
                      key: "query",
                      render: (r) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.query}</div>
                          <div style={{ fontSize: 11, color: C.textMuted }}>{r.landingPage}</div>
                        </div>
                      ),
                    },
                    { label: "Provider", key: "provider", align: "right" },
                    {
                      label: "State",
                      key: "status",
                      align: "right",
                      render: (r) => (
                        <span
                          style={{
                            color:
                              r.status === "Watch"
                                ? C.orange
                                : r.status === "Mentioned"
                                  ? C.blue
                                  : C.green,
                            fontWeight: 600,
                          }}
                        >
                          {r.status}
                        </span>
                      ),
                    },
                  ]}
                  data={canonry.evidence}
                />
              </ChartCard>
            )}
          </>
        </SectionErrorBoundary>
      )}
    </div>
  );
}

export function ConvDashboard({ selectedClient, dateRange }) {
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
  // Detailliste NUR ORGANISCH + KI (Volkan 31.08., Erweiterung gleichentags):
  // Einzel-Conversions zeigen den Kanal «Organic Search» sowie KI-Referrals
  // (ChatGPT/Perplexity/… — gleiche Quellen-Erkennung wie die EzyAI-
  // Attribution). Bezahlte KI-Klicks (ChatGPT Ads → Paid-Kanal) bleiben
  // bewusst draussen. Alte Snapshots ohne channel-Feld bleiben sichtbar
  // (Fallback-Toleranz — die Live-Abfrage liefert den Kanal mit). Die
  // Event-Übersichtstabelle (convEventsFiltered) bleibt bewusst ungefiltert.
  const convRowsOrganic = useMemo(
    () =>
      (conv?.rows || []).filter((r) => {
        if (r.channel == null) return true;
        const ch = String(r.channel);
        if (/^organic search$/i.test(ch)) return true;
        return isAiConvSource(r.source) && !/^paid|display|cross-network/i.test(ch);
      }),
    [conv?.rows],
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
              {conv.rows.length > 0 ? "Organische & KI-Conversions" : "Alle Conversions"}
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
                        aus organischer oder KI-Quelle im Zeitraum.
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

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW DASHBOARD (EzyRank "Dashboard" blueprint)
// ═══════════════════════════════════════════════════════════════════════════
export function OverviewDashboard({ selectedClient, dateRange }) {
  const bis = dateRange?.end || null;
  const { run: ahrefsRun, refresh: refreshAhrefs } = useEzyLatestRun(
    selectedClient?.id,
    "ahrefs",
    bis,
  );
  const { run: ga4Run, refresh: refreshGa4 } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_summary",
    bis,
  );
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_traffic",
    bis,
  );
  const { run: convRun, refresh: refreshConv } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_conversions",
    bis,
  );
  useEffect(() => {
    const interval = setInterval(
      () => {
        refreshAhrefs();
        refreshGa4();
        refreshTraf();
        refreshConv();
      },
      12 * 60 * 60 * 1000,
    ); // 12 Stunden
    return () => clearInterval(interval);
  }, [refreshAhrefs, refreshGa4, refreshTraf, refreshConv]);
  const ahrefs = ahrefsRun ? ahrefsKpisFromResult(ahrefsRun.result) : null;
  const ga4 = ga4Run ? ga4KpisFromResult(ga4Run.result) : null;
  const traf = trafRun ? ga4TrafficFromResult(trafRun.result) : null;
  const conv = convRun ? ga4ConversionsFromResult(convRun.result) : null;

  const days = dateRange?.days || 30;
  const organicTraffic = Number(ahrefs?.traffic || ga4?.sessions || 0);
  const aiReference = Number(traf?.aiReferral.sessions || 0);
  const leadVisits = conv
    ? conv.breakdown.phone + conv.breakdown.mail + conv.breakdown.maps + conv.breakdown.contact
    : 0;
  const visibility = Number(ahrefs?.visibility || 0);
  const countries = traf?.countries || [];
  const aiSeriesRaw = useMemo(() => traf?.aiSeries || [], [traf?.aiSeries]);
  const aiSeries = useMemo(() => aiSeriesRaw.slice(-days), [aiSeriesRaw, days]);
  const aiBySource = traf?.aiReferral.bySource || [];
  const COUNTRY_COLORS = [C.accent, C.blue, C.green, C.orange, C.cyan, C.pink, C.textDim];
  // Live GA4 comparison (real YoY/MoM) — falls back to series-based deltas.
  const { data: ovCmpData, deltas: ovLiveDeltas } = useGa4Compare(selectedClient?.id, dateRange);
  const ga4SeriesForDelta = useMemo(
    () => (ga4Run ? ga4KpisFromResult(ga4Run.result)?.series || [] : []),
    [ga4Run],
  );
  const sOrganic = useMemo(
    () => seriesDelta(ga4SeriesForDelta, "sessions", dateRange),
    [ga4SeriesForDelta, dateRange],
  );
  const dOrganic = ovLiveDeltas.sessions !== undefined ? ovLiveDeltas.sessions : sOrganic;
  const dAiRef = useMemo(
    () => seriesDelta(aiSeriesRaw, "aiSessions", dateRange),
    [aiSeriesRaw, dateRange],
  );
  const ovCmpName = compareName(dateRange?.compareMode);
  const ovOrganicCmp =
    ovCmpData?.compare?.sessions == null ? undefined : Number(ovCmpData.compare.sessions);

  // Dashboard-Ausbau 2026-07-11 (B4): Health-Komponenten + Frische aus populate_meta.
  const { health, populateMeta } = useEzyHealthComponents(selectedClient?.id);
  const metaAgeH = populateMeta?.created_at
    ? (Date.now() - new Date(populateMeta.created_at).getTime()) / 3600_000
    : null;
  const SOURCE_LABELS = {
    ahrefs: "Backlinks (DFS)",
    gsc: "GSC",
    gsc_queries: "GSC-Queries",
    crux: "CWV",
    ga4: "GA4",
    ga4_traffic: "GA4-Traffic",
    ga4_conversions: "GA4-Conv.",
    canonry: "Canonry",
  };
  const fmtTs = (ts) => {
    try {
      const d = new Date(ts);
      return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  };
  const hasAny = organicTraffic + aiReference + leadVisits + visibility > 0 || countries.length > 0;
  if (!hasAny) {
    return (
      <LiveEmptyState
        title="Noch keine Übersichts-Daten"
        hint="Starte den Sammel-Lauf im Google-Panel (Backlinks · GSC · GA4 · GA4 Traffic · GA4 Conversions), damit hier Traffic, AI-Referenzen und Lead-Visits erscheinen."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CompareBanner dateRange={dateRange} />
      {/* B4d: Datenstand-Banner wenn letzter Sammel-Lauf aelter als 26h */}
      {metaAgeH != null && metaAgeH > 26 && (
        <div
          style={{
            background: `${C.orange}18`,
            border: `1px solid ${C.orange}55`,
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: C.orange,
            fontWeight: 600,
          }}
        >
          Datenstand aelter als ein Tag — Sammel-Job pruefen.
        </div>
      )}
      {/* B4a/b: Health-Score + Komponenten-Chips + deltaDriver */}
      {health && (health.score != null || health.components.length > 0) && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            {health.score != null && (
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: health.score >= 70 ? C.green : C.orange,
                }}
              >
                {health.score}/100
              </div>
            )}
            <div style={{ fontSize: 12, color: C.textMuted }}>Health-Score (Agent-QS)</div>
            {health.deltaDriver && (
              <div style={{ fontSize: 12, color: C.textDim }}>{health.deltaDriver}</div>
            )}
          </div>
          {health.components.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {health.components.map((k) => (
                <span
                  key={k.key}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: `${C.accent}18`,
                    color: C.text,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  {k.label}{" "}
                  {k.value != null
                    ? `${Math.round(k.value).toLocaleString("de-CH")}${k.suffix}`
                    : "—"}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {/* B4c: Frische-Zeile aus populate_meta */}
      {populateMeta?.sources && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(populateMeta.sources)
            .filter(([k]) => SOURCE_LABELS[k])
            .map(([k, s]) => {
              const fail = s?.status === "fail";
              const skipped = s?.status === "skipped";
              return (
                <span
                  key={k}
                  title={fail && s?.error ? s.error : undefined}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: fail ? `${C.orange}22` : `${C.surface}`,
                    color: fail ? C.orange : skipped ? C.textDim : C.textMuted,
                    border: `1px solid ${fail ? C.orange : C.border}`,
                  }}
                >
                  {SOURCE_LABELS[k]} ·{" "}
                  {fail ? "Fehler" : skipped ? "uebersprungen" : `Stand ${fmtTs(s?.ts)}`}
                </span>
              );
            })}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 14,
        }}
      >
        <KpiCard
          icon={Globe}
          label="Organic Traffic"
          value={organicTraffic > 0 ? organicTraffic.toLocaleString("de-CH") : "—"}
          change={dOrganic}
          compareValue={ovOrganicCmp}
          compareLabel={ovCmpName}
          color={C.accent}
        />
        <KpiCard
          icon={Bot}
          label="AI Reference"
          value={aiReference > 0 ? aiReference.toLocaleString("de-CH") : "—"}
          change={dAiRef}
          color={C.green}
        />
        <KpiCard
          icon={Target}
          label="Lead Visits"
          value={leadVisits > 0 ? leadVisits.toLocaleString("de-CH") : "—"}
          color={C.pink}
        />
        <KpiCard
          icon={Eye}
          label="Visibility Index"
          value={visibility > 0 ? visibility.toLocaleString("de-CH") : "—"}
          color={C.blue}
        />
      </div>
      {(countries.length > 0 || aiSeries.length >= 2 || aiBySource.length > 0) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: 14,
          }}
        >
          {countries.length > 0 && (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
                Traffic nach Land
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={countries
                      .slice(0, 7)
                      .map((c) => ({ name: c.country, value: c.sessions }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {countries.slice(0, 7).map((c, i) => (
                      <Cell key={c.country} fill={COUNTRY_COLORS[i % COUNTRY_COLORS.length]} />
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
          {aiSeries.length >= 2 ? (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
                AI Referenced Visitors ({dateRange?.label || "30 Tage"})
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={aiSeries}>
                  <defs>
                    <linearGradient id="ov-ai" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
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
                  <Area
                    type="monotone"
                    dataKey="aiSessions"
                    name="AI Sessions"
                    stroke={C.green}
                    fill="url(#ov-ai)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            aiBySource.length > 0 && (
              <div
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}
                >
                  AI-Referenzen nach Quelle
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: 280,
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr style={{ color: C.textDim, textAlign: "left" }}>
                        <th style={{ padding: "6px 8px" }}>Quelle</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiBySource.slice(0, 10).map((s, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px", color: C.text }}>{s.source}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.sessions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function AiCitationsPanel({ selectedClient }) {
  const { run } = useEzyLatestRun(selectedClient?.id, "ai_citations");
  const [open, setOpen] = useState({});
  const [corpusFilter, setCorpusFilter] = useState("alle");
  const r = run?.result;
  if (!r || !Array.isArray(r.queries) || !r.queries.length) return null;
  // Dual-Korpus (2026-07-16): alte Zeilen ohne corpusId = ch-de (Datenbefund:
  // der alte Lauf sendete bereits google/Switzerland/de = CH-Korpus).
  const allRows = r.queries.map((q) => ({ ...q, corpusId: q.corpusId || "ch-de" }));
  const corpusIds = [...new Set(allRows.map((q) => q.corpusId))];
  const rows =
    corpusFilter === "alle" ? allRows : allRows.filter((q) => q.corpusId === corpusFilter);
  const agg = r.aggregate || {};
  const delta = agg.citedDelta7;
  const deltaUp = typeof delta === "string" && delta.startsWith("+") && delta !== "+0";
  const deltaDown = typeof delta === "string" && delta.startsWith("-");
  const pct = (v) => (v == null ? "—" : (Math.round(v * 1000) / 10).toFixed(1) + " %");
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>AI-Zitationen</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            In {agg.queriesCited ?? 0} von {agg.queriesTracked ?? r.queries.length} KI-Abfragen
            zitiert
            {delta ? (
              <span
                style={{
                  marginLeft: 8,
                  color: deltaUp ? C.green : deltaDown ? C.red : C.textMuted,
                  fontWeight: 600,
                }}
              >
                {deltaUp ? "▲" : deltaDown ? "▼" : "→"} {delta} ggü. Vorwoche
              </span>
            ) : null}
          </div>
        </div>
        <span
          title="Kleine KMU sind anfangs oft nicht oder niedrig zitiert. Der Wert liegt im Trend ueber Zeit, waehrend GEO-Massnahmen greifen."
          style={{ fontSize: 11, color: C.textDim, cursor: "help" }}
        >
          KI-Sicht (Stadt-/Kategorie-Ebene) ⓘ
        </span>
      </div>
      {r.note ? (
        <div style={{ fontSize: 11, color: C.textDim, fontStyle: "italic" }}>{r.note}</div>
      ) : null}
      {corpusIds.length > 1 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["alle", ...corpusIds].map((cid) => (
            <button
              key={cid}
              onClick={() => setCorpusFilter(cid)}
              style={{
                background: corpusFilter === cid ? C.accentDim : "transparent",
                color: corpusFilter === cid ? C.accentLight : C.textMuted,
                border: `1px solid ${corpusFilter === cid ? C.accent : C.border}`,
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {cid === "alle" ? "Alle Korpora" : CORPUS_LABELS[cid] || cid}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.textMuted, textAlign: "left" }}>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Abfrage</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Korpus</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Zitiert</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Rang</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Anteil</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q, i) => {
              const notCitedPrimary = q.isPrimary && !q.clientCited && !q.noData;
              const isOpen = open[i];
              return (
                <Fragment key={i}>
                  <tr
                    style={{
                      borderTop: `1px solid ${C.border}`,
                      background: notCitedPrimary ? C.redDim : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px" }}>
                      {q.isPrimary ? <Badge color={C.accent}>Primaer</Badge> : null}{" "}
                      <span style={{ color: C.text }}>{q.query}</span>
                      {q.noData ? (
                        <span style={{ color: C.textDim, marginLeft: 6 }}>(keine KI-Daten)</span>
                      ) : null}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span
                        title={CORPUS_LABELS[q.corpusId] || q.corpusId}
                        style={{ fontSize: 11, color: C.textMuted }}
                      >
                        {q.corpusId === "int-en"
                          ? "International"
                          : q.corpusId.startsWith("ch-")
                            ? "Heimmarkt " + q.corpusId.slice(3).toUpperCase()
                            : q.corpusId}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <Badge color={q.clientCited ? C.green : C.red}>
                        {q.clientCited ? "Ja" : "Nein"}
                      </Badge>
                    </td>
                    <td style={{ padding: "8px", color: C.text }}>{q.clientRank ?? "—"}</td>
                    <td style={{ padding: "8px", color: C.text }}>{pct(q.clientShare)}</td>
                    <td style={{ padding: "8px" }}>
                      {(q.topCitedDomains || []).length ? (
                        <button
                          onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: C.accentLight,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {isOpen ? "Quellen ▲" : "Quellen ▼"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen && (q.topCitedDomains || []).length ? (
                    <tr style={{ background: C.surface }}>
                      <td colSpan={6} style={{ padding: "8px 12px" }}>
                        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
                          Top-zitierte Quellen (Wettbewerb um KI-Zitationen):
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {q.topCitedDomains.map((d, k) => (
                            <span
                              key={k}
                              style={{
                                fontSize: 11,
                                color: C.text,
                                background: C.card,
                                border: `1px solid ${C.border}`,
                                borderRadius: 6,
                                padding: "3px 8px",
                              }}
                            >
                              {d.domain} <span style={{ color: C.textDim }}>{d.mentions}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI VISIBILITY DASHBOARD (KI-Sichtbarkeit, Canonry-backed)
// ═══════════════════════════════════════════════════════════════════════════
export const AIVIS_WINDOWS = [
  { id: "7d", label: "7T", days: 7 },
  { id: "30d", label: "30T", days: 30 },
  { id: "90d", label: "90T", days: 90 },
  { id: "all", label: "Alle", days: null },
];

// Modul 2 (M2.5): Sub-Bereich "AI-Zitationen" im KI-Tab. Nur bei vorhandener
// ai_citations-Zeile. Additiv — bestehender KI-Tab-Inhalt bleibt unveraendert.
export const CORPUS_LABELS = {
  "ch-de": "Heimmarkt (Google AI, CH/de)",
  "ch-fr": "Heimmarkt (Google AI, CH/fr)",
  "ch-it": "Heimmarkt (Google AI, CH/it)",
  "int-en": "International (ChatGPT, US/en)",
};

export function AiVisibilityDashboard({ selectedClient }) {
  const { canRunAudits } = useAuth();
  const { run, refresh } = useEzyLatestRun(selectedClient?.id, "canonry_ai_visibility");
  const result = run?.result || null;
  const [range, setRange] = useState("90d");
  const [tab, setTab] = useState("topics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refreshLive = useCallback(async () => {
    if (!selectedClient?.id) return;
    setBusy(true);
    setErr("");
    try {
      const qs = new URLSearchParams({ clientId: selectedClient.id });
      const res = await ezyFetch(`/api/live/canonry/ai-visibility?${qs.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Canonry nicht verfügbar");
      await refresh();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [selectedClient?.id, refresh]);

  const { score, label } = result
    ? aiVisibilityScoreFromResult(result)
    : { score: 0, label: "Low" };
  const kpis = result
    ? aiVisibilityKpisFromResult(result)
    : { mentions: 0, citations: 0, referencedPages: 0, mentionsDelta: null, citationsDelta: null };
  const seriesAll = useMemo(() => (result ? aiVisibilitySeriesFromResult(result) : []), [result]);
  const providers = result ? aiVisibilityProvidersFromResult(result) : [];
  const sources = result ? aiVisibilitySourcesFromResult(result) : [];
  const topics = result ? aiVisibilityTopicsFromResult(result) : [];

  const win = AIVIS_WINDOWS.find((w) => w.id === range) || AIVIS_WINDOWS[2];
  const series = useMemo(() => {
    if (!win.days) return seriesAll;
    const cutoff = Date.now() - win.days * 24 * 60 * 60 * 1000;
    return seriesAll.filter((b) => {
      const t = new Date(b.date).getTime();
      return Number.isNaN(t) ? true : t >= cutoff;
    });
  }, [seriesAll, win.days]);

  const scoreColor = label === "High" ? C.green : label === "Medium" ? C.orange : C.red;
  const scoreLabelDe = label === "High" ? "Hoch" : label === "Medium" ? "Mittel" : "Niedrig";
  const providerMax = Math.max(1, ...providers.map((p) => p.cited));

  const RefreshBtn = canRunAudits ? (
    <Btn icon={RefreshCw} onClick={refreshLive} disabled={busy}>
      {busy ? "lädt…" : "Aktualisieren"}
    </Btn>
  ) : null;

  if (!result) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>{RefreshBtn}</div>
        {err && (
          <div
            style={{
              background: C.redDim,
              border: `1px solid ${C.red}35`,
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13,
              color: C.text,
            }}
          >
            {err}
          </div>
        )}
        <LiveEmptyState
          title="Noch keine KI-Sichtbarkeitsdaten"
          hint="Sobald ein Canonry-Sweep gelaufen ist, erscheinen hier Visibility-Score, Mentions/Citations, LLM-Verteilung und zitierte Quellen. Mit Aktualisieren einen Live-Abruf starten."
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: C.textMuted }}>
          {run?.created_at ? `Stand: ${new Date(run.created_at).toLocaleString("de-CH")}` : ""}
        </div>
        {RefreshBtn}
      </div>
      {err && (
        <div
          style={{
            background: C.redDim,
            border: `1px solid ${C.red}35`,
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            color: C.text,
          }}
        >
          {err}
        </div>
      )}
      {/* Score gauge + headline KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 14,
        }}
      >
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
            position: "relative",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.textMuted }}>
            Visibility Score
          </div>
          <div style={{ position: "relative", height: 150 }}>
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie
                  data={[{ value: score }, { value: 100 - score }]}
                  dataKey="value"
                  startAngle={180}
                  endAngle={0}
                  cx="50%"
                  cy="92%"
                  innerRadius={68}
                  outerRadius={96}
                  stroke="none"
                  isAnimationActive={false}
                >
                  <Cell fill={scoreColor} />
                  <Cell fill={C.border} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingBottom: 6,
              }}
            >
              <div style={{ fontSize: 38, fontWeight: 800, color: C.text, lineHeight: 1 }}>
                {score}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{scoreLabelDe}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.textDim, textAlign: "center", marginTop: 4 }}>
            aus Canonry Citation-Rate
          </div>
        </div>
        <KpiCard
          icon={Bot}
          label="Mentions"
          value={kpis.mentions > 0 ? kpis.mentions.toLocaleString("de-CH") : "—"}
          change={kpis.mentionsDelta}
          color={C.accent}
        />
        <KpiCard
          icon={FileText}
          label="Citations"
          value={kpis.citations > 0 ? kpis.citations.toLocaleString("de-CH") : "—"}
          change={kpis.citationsDelta}
          color={C.green}
        />
        <KpiCard
          icon={Link2}
          label="Referenced Pages"
          value={kpis.referencedPages > 0 ? kpis.referencedPages.toLocaleString("de-CH") : "—"}
          color={C.blue}
        />
      </div>
      {/* Time-series with range switcher */}
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
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
            Mentions & Citations im Zeitverlauf
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {AIVIS_WINDOWS.map((w) => (
              <button
                key={w.id}
                onClick={() => setRange(w.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `1px solid ${range === w.id ? C.accent : C.border}`,
                  background: range === w.id ? C.accentDim : "transparent",
                  color: range === w.id ? C.accentLight : C.textMuted,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        {series.length >= 2 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="aivis-cit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="date"
                stroke={C.textDim}
                fontSize={11}
                tickFormatter={(d) => (typeof d === "string" && d.length >= 10 ? d.slice(5) : d)}
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
                dataKey="cited"
                name="Citations"
                stroke={C.green}
                fill="url(#aivis-cit)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="mentioned"
                name="Mentions"
                stroke={C.accent}
                fillOpacity={0}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ fontSize: 12, color: C.textDim, padding: "24px 0", textAlign: "center" }}>
            Noch zu wenig Datenpunkte für diesen Zeitraum.
          </div>
        )}
      </div>
      {/* LLM distribution + Mentions by country */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: C.textMuted }}>
            Verteilung nach LLM
          </div>
          {providers.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {providers.map((p) => {
                const lbl = canonryProviderLabel(p.provider);
                const col = AI_COLORS[lbl] || C.textDim;
                return (
                  <div key={p.provider}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ color: C.text, fontWeight: 600 }}>{lbl}</span>
                      <span style={{ color: C.textMuted }}>
                        {(p.rate * 100).toFixed(1)}% · {p.cited}/{p.total}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: C.border,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${(p.cited / providerMax) * 100}%`,
                          height: "100%",
                          background: col,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textDim, padding: "16px 0" }}>
              Keine Provider-Daten im letzten Sweep.
            </div>
          )}
        </div>
        {/* Mentions by country — not natively provided by Canonry yet */}
        <div
          style={{
            background: C.card,
            border: `1px dashed ${C.border}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
              Mentions nach Land
            </span>
            <Badge color={C.orange}>coming soon</Badge>
          </div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
            Canonry liefert aktuell keine länderspezifische Aufschlüsselung. Sobald Queries pro
            Markt getaggt sind, wird dieser Tile aus marktspezifischen Query-Sets befüllt — bis
            dahin keine geschätzten Werte.
          </div>
        </div>
      </div>
      {/* Topics & Sources tabs */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[
            { id: "topics", label: "Top Queries" },
            { id: "sources", label: "Zitierte Quellen" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: `1px solid ${tab === t.id ? C.accent : C.border}`,
                background: tab === t.id ? C.accentDim : "transparent",
                color: tab === t.id ? C.accentLight : C.textMuted,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "topics" ? (
          topics.length > 0 ? (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table
                style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Query</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Cited</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Mentioned</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>SOV</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.slice(0, 20).map((q, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.text }}>{q.query}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {q.cited}/{q.providers}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{q.mentioned}</td>
                      <td
                        style={{
                          padding: "6px 8px",
                          textAlign: "right",
                          color: q.sov >= 50 ? C.green : C.textMuted,
                        }}
                      >
                        {q.sov.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
                SOV = zitierende Provider / konfigurierte Provider je Query.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textDim, padding: "16px 0" }}>
              Keine Query-Daten.
            </div>
          )
        ) : sources.length > 0 ? (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ color: C.textDim, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Domain</th>
                  <th style={{ padding: "6px 8px" }}>Typ</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Anteil</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Citations</th>
                </tr>
              </thead>
              <tbody>
                {sources.slice(0, 20).map((s, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", color: C.text }}>{s.domain}</td>
                    <td style={{ padding: "6px 8px", color: C.textMuted }}>
                      {s.label || s.surfaceClass || "—"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {s.percentage.toFixed(1)}%
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.textDim, padding: "16px 0" }}>
            Keine zitierten Quellen im letzten Sweep.
          </div>
        )}
      </div>
    </div>
  );
}

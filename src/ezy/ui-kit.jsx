// Gemeinsames UI-/Daten-Toolkit (aus EzyOneApp.jsx extrahiert, 21.08.2026 —
// reines Verschieben): Form-/Chart-Primitives, Datums-/Vergleichs-Helfer,
// GA4-Live-Hooks und die Canonry-Aufbereitung.
import { useRangeData } from "@/ezy/data/rangeStore";
import { supabase } from "@/integrations/supabase/client";
import { Component, useMemo, useRef } from "react";
import { useState, useEffect, useCallback } from "react";
import { C } from "./theme";
import { ezyFetch } from "@/ezy/data/api";
import { DEFAULT_ON_SERVICES } from "@/lib/services";

export const AI_COLORS = {
  ChatGPT: "#10b981",
  Perplexity: "#3b82f6",
  Gemini: "#f59e0b",
  Claude: "#ec4899",
  Copilot: "#06b6d4",
  Grok: "#ec4899",
};

export function downloadFile(content, type, filename) {
  const b = new Blob([content], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 0);
}

// escapeHtml/sanitizeHref: seit 2026-08-18 aus @/ezy/lib/markdown importiert.
export function ga4PropertyText(client) {
  return client?.ga4PropertyId || "Noch nicht hinterlegt";
}

export function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function useLiveIntegrations() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const refresh = useCallback(async () => {
    try {
      const res = await ezyFetch("/api/live/status");
      const payload = await res.json().catch(() => ({ error: "Ungültige Live-Antwort" }));
      if (!res.ok) throw new Error(payload.error || "Live-Status nicht verfügbar");
      setState({ loading: false, data: payload, error: "" });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error.message || "Live-Status nicht verfügbar",
      });
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await ezyFetch("/api/live/status", { signal: ctrl.signal });
        const payload = await res.json().catch(() => ({ error: "Ungültige Live-Antwort" }));
        if (!res.ok) throw new Error(payload.error || "Live-Status nicht verfügbar");
        if (!cancelled) setState({ loading: false, data: payload, error: "" });
      } catch (error) {
        if (cancelled || error.name === "AbortError") return;
        setState({
          loading: false,
          data: null,
          error: error.message || "Live-Status nicht verfügbar",
        });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);
  return { ...state, refresh };
}

export const CLIENT_STORAGE_KEY = "ezy-one.clients.v1";

export const PROFILE_STORAGE_KEY = "ezy-one.profile.v1";

export const DEFAULTS_STORAGE_KEY = "ezy-one.customer-defaults.v1";

export const DEFAULT_PROFILE = {
  name: "Daniel Agrici",
  email: "daniel@ezy.ch",
  role: "Agency Admin",
  language: "Deutsch",
};

export const DEFAULT_CUSTOMER_DEFAULTS = {
  language: "Deutsch",
  tone: "Professionell",
  reportTemplate: "Standard",
  // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
  visibleTabs: ["seo", "aivis", "conversions", "ads", "runs"],
};

export function readStoredJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function persistJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function defaultsFromStored(value) {
  return {
    language: String(value?.language || DEFAULT_CUSTOMER_DEFAULTS.language),
    tone: String(value?.tone || DEFAULT_CUSTOMER_DEFAULTS.tone),
    reportTemplate: String(value?.reportTemplate || DEFAULT_CUSTOMER_DEFAULTS.reportTemplate),
    visibleTabs: Array.isArray(value?.visibleTabs)
      ? value.visibleTabs
      : DEFAULT_CUSTOMER_DEFAULTS.visibleTabs,
  };
}

export function useMediaQuery(query) {
  const [getMatch, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const update = () => setMatch(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return getMatch;
}

export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function slugifyProjectName(value = "") {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function initialsFromName(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0]?.[0] || "E")
    .concat(parts[1]?.[0] || "")
    .toUpperCase()
    .slice(0, 2);
}

export function normalizeClientShape(client, fallback = {}) {
  const domain = String(client?.domain ?? fallback.domain ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
  return {
    ...fallback,
    ...client,
    id: String(client?.id ?? fallback.id ?? `c${Date.now()}`),
    name: String(client?.name ?? fallback.name ?? "").trim(),
    domain,
    status: client?.status === "paused" ? "paused" : "active",
    industry: String(client?.industry ?? fallback.industry ?? "").trim(),
    contactEmail: String(client?.contactEmail ?? fallback.contactEmail ?? "").trim(),
    contactPhone: String(client?.contactPhone ?? fallback.contactPhone ?? "").trim(),
    monthlyBudget: Number(client?.monthlyBudget ?? fallback.monthlyBudget ?? 0) || 0,
    tags: Array.isArray(client?.tags)
      ? client.tags.filter(Boolean)
      : Array.isArray(fallback.tags)
        ? fallback.tags.filter(Boolean)
        : [],
    targetLocations: Array.isArray(client?.targetLocations)
      ? client.targetLocations.filter(Boolean)
      : Array.isArray(fallback.targetLocations)
        ? fallback.targetLocations.filter(Boolean)
        : [],
    notes: String(client?.notes ?? fallback.notes ?? ""),
    defaults: defaultsFromStored(
      client?.defaults ?? fallback.defaults ?? DEFAULT_CUSTOMER_DEFAULTS,
    ),
    score: Number(client?.score ?? fallback.score ?? 0) || 0,
    keywords: Number(client?.keywords ?? fallback.keywords ?? 0) || 0,
    traffic: Number(client?.traffic ?? fallback.traffic ?? 0) || 0,
    aiVisitors: Number(client?.aiVisitors ?? fallback.aiVisitors ?? 0) || 0,
    revenue: Number(client?.revenue ?? fallback.revenue ?? 0) || 0,
    gscSiteUrl: String(
      client?.gscSiteUrl ??
        fallback.gscSiteUrl ??
        (domain ? `sc-domain:${domain.replace(/^www\./i, "")}` : ""),
    ).trim(),
    ga4PropertyId: String(client?.ga4PropertyId ?? fallback.ga4PropertyId ?? "").trim(),
    ga4MeasurementId: String(client?.ga4MeasurementId ?? fallback.ga4MeasurementId ?? "").trim(),
    canonryProject: String(
      client?.canonryProject ?? fallback.canonryProject ?? slugifyProjectName(domain),
    ).trim(),
    startDate: String(
      client?.startDate ?? fallback.startDate ?? new Date().toISOString().slice(0, 10),
    ).trim(),
    brandTerms: Array.isArray(client?.brandTerms) ? client.brandTerms : [],
    revenueMode: client?.revenueMode === "clicks" ? "clicks" : "revenue",
  };
}

export function clientFormFromClient(client) {
  return {
    name: client?.name || "",
    domain: client?.domain || "",
    industry: client?.industry || "",
    status: client?.status || "active",
    contactEmail: client?.contactEmail || "",
    contactPhone: client?.contactPhone || "",
    monthlyBudget: String(client?.monthlyBudget ?? 0),
    tags: (client?.tags || []).join(", "),
    targetLocations: (client?.targetLocations || []).join(", "),
    notes: client?.notes || "",
    gscSiteUrl: client?.gscSiteUrl || "",
    ga4PropertyId: client?.ga4PropertyId || "",
    ga4MeasurementId: client?.ga4MeasurementId || "",
    canonryProject: client?.canonryProject || "",
    // Dashboard-Ausbau 2026-07-11 (B5d): Brand-Terms (Tag-Input) + Umsatz-Modus.
    brandTerms: (client?.brandTerms || []).join(", "),
    revenueMode: client?.revenueMode === "clicks" ? "clicks" : "revenue",
    // Beim Anlegen vorausgewaehlte Dienste (Set von Service-Keys).
    services: new Set(DEFAULT_ON_SERVICES),
  };
}

export function profileFromStored(value) {
  return {
    name: String(value?.name || DEFAULT_PROFILE.name),
    email: String(value?.email || DEFAULT_PROFILE.email),
    role: String(value?.role || DEFAULT_PROFILE.role),
    language: String(value?.language || DEFAULT_PROFILE.language),
  };
}

export const CANONRY_PROVIDER_LABELS = {
  openai: "ChatGPT",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

export function canonryProviderLabel(name = "") {
  const key = String(name || "").toLowerCase();
  return CANONRY_PROVIDER_LABELS[key] || String(name || "").replace(/^./, (c) => c.toUpperCase());
}

export function formatCanonryStamp(value, options = { dateStyle: "short", timeStyle: "short" }) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("de-CH", options);
}

export function formatCanonryDay(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

export function formatCanonryDuration(startedAt, finishedAt) {
  if (!startedAt) return "—";
  if (!finishedAt) return "läuft";
  const start = new Date(startedAt),
    end = new Date(finishedAt);
  const ms = end - start;
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
}

export function parseCanonryErrorMap(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { run: String(raw) };
  }
}

export function useCanonryOverview(selectedClient) {
  const clientId = selectedClient?.id || "";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);
  const [state, setState] = useState({ loading: isUuid, data: null, error: "" });
  const refresh = useCallback(async () => {
    if (!isUuid) return;
    try {
      const qs = new URLSearchParams({ clientId });
      const res = await ezyFetch(`/api/live/canonry/overview?${qs.toString()}`);
      const payload = await res.json().catch(() => ({ error: "Ungültige Canonry-Antwort" }));
      if (!res.ok) throw new Error(payload.error || "Canonry-Overview nicht verfügbar");
      setState({ loading: false, data: payload, error: "" });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error.message || "Canonry-Overview nicht verfügbar",
      });
    }
  }, [clientId, isUuid]);
  useEffect(() => {
    if (!isUuid) {
      setState({ loading: false, data: null, error: "" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setState((p) => ({ ...p, loading: true, error: "" }));
    (async () => {
      try {
        const qs = new URLSearchParams({ clientId });
        const res = await ezyFetch(`/api/live/canonry/overview?${qs.toString()}`, {
          signal: ctrl.signal,
        });
        const payload = await res.json().catch(() => ({ error: "Ungültige Canonry-Antwort" }));
        if (!res.ok) throw new Error(payload.error || "Canonry-Overview nicht verfügbar");
        if (!cancelled) setState({ loading: false, data: payload, error: "" });
      } catch (error) {
        if (cancelled || error.name === "AbortError") return;
        setState({
          loading: false,
          data: null,
          error: error.message || "Canonry-Overview nicht verfügbar",
        });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [clientId, isUuid]);
  return { ...state, refresh };
}

export function buildCanonryProviderSeries(timeline, fallbackSeries) {
  const grouped = new Map();
  for (const item of Array.isArray(timeline) ? timeline : []) {
    for (const [provider, runs] of Object.entries(item?.providerRuns || {})) {
      for (const run of Array.isArray(runs) ? runs : []) {
        const key = String(run?.createdAt || "").slice(0, 10);
        if (!key) continue;
        const label = canonryProviderLabel(provider);
        const row = grouped.get(key) || {
          date: formatCanonryDay(run.createdAt),
          ChatGPT: 0,
          Perplexity: 0,
          Gemini: 0,
          Claude: 0,
        };
        if (run?.citationState === "cited") row[label] = (row[label] || 0) + 1;
        grouped.set(key, row);
      }
    }
  }
  const series = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
  return series.length ? series : fallbackSeries;
}

export function buildCanonryHealthDistribution(timeline, latestRunId) {
  let stable = 0,
    watchlist = 0,
    regression = 0;
  for (const item of Array.isArray(timeline) ? timeline : []) {
    const run = Array.isArray(item?.runs)
      ? latestRunId
        ? item.runs.find((r) => r.runId === latestRunId)
        : item.runs[item.runs.length - 1]
      : null;
    if (!run) continue;
    if (run.citationState === "cited") stable += 1;
    else if (
      run.answerMentioned ||
      run.visibilityState === "visible" ||
      run.visibilityState === "indirect"
    )
      watchlist += 1;
    else regression += 1;
  }
  return [
    { name: "Stable", value: stable, color: C.green },
    { name: "Watchlist", value: watchlist, color: C.orange },
    { name: "Regression", value: regression, color: C.red },
  ];
}

export function buildCanonryEvidenceRows(timeline, latestRunId, domain) {
  const rows = [];
  for (const item of Array.isArray(timeline) ? timeline : []) {
    for (const [provider, runs] of Object.entries(item?.providerRuns || {})) {
      const run = Array.isArray(runs)
        ? latestRunId
          ? runs.find((entry) => entry.runId === latestRunId)
          : runs[runs.length - 1]
        : null;
      if (!run) continue;
      const status =
        run.citationState === "cited"
          ? "Cited"
          : run.answerMentioned || run.visibilityState === "visible"
            ? "Mentioned"
            : "Watch";
      rows.push({
        query: item.query ?? item.keyword ?? "",
        provider: canonryProviderLabel(provider),
        status,
        landingPage: domain ? `https://${domain}` : "—",
        note:
          status === "Cited"
            ? "Aktuelle Citation im letzten Sweep erkannt."
            : status === "Mentioned"
              ? "Die Marke ist sichtbar, aber die Citation ist noch nicht stabil."
              : "Für diese Query fehlt im aktuellen Sweep noch eine belastbare Citation.",
        sort: status === "Cited" ? 0 : status === "Mentioned" ? 1 : 2,
        createdAt: run.createdAt || "",
      });
    }
  }
  return rows
    .sort(
      (a, b) =>
        a.sort - b.sort ||
        String(b.createdAt).localeCompare(String(a.createdAt)) ||
        String(a.query || "").localeCompare(String(b.query || "")),
    )
    .slice(0, 6);
}

export function buildCanonryProviderBreakdown(healthLatest) {
  return Object.entries(healthLatest?.providerBreakdown || {})
    .map(([provider, entry]) => ({
      platform: canonryProviderLabel(provider),
      citations: Number(entry?.cited || 0),
      share: `${(Number(entry?.citedRate || 0) * 100).toFixed(1)}%`,
      trend: `${Number(entry?.cited || 0)}/${Number(entry?.total || 0)}`,
      status:
        Number(entry?.citedRate || 0) === 0
          ? "watch"
          : Number(entry?.citedRate || 0) >= 0.25
            ? "stable"
            : "gained",
      color: AI_COLORS[canonryProviderLabel(provider)] || C.textDim,
    }))
    .sort((a, b) => b.citations - a.citations || a.platform.localeCompare(b.platform));
}

export function buildCanonryLiveModel(selectedClient, payload) {
  // API returns top-level { project, timeline, health, runs, keywords, insights, schedule, errors }
  const data = payload || {};
  const project = data.project;
  if (!project) return null;
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const healthLatest = data.health && typeof data.health === "object" ? data.health : null;
  const runsRaw = data.runs;
  const latestRun =
    (runsRaw && typeof runsRaw === "object" && (runsRaw.run || runsRaw.latest || runsRaw)) || null;
  const trackedKeywords = Array.isArray(data.keywords) ? data.keywords.length : 0;
  const latestRunId = latestRun?.id || healthLatest?.runId || "";
  const healthDistribution = buildCanonryHealthDistribution(timeline, latestRunId);
  const stableKeywords = healthDistribution.find((entry) => entry.name === "Stable")?.value || 0;
  const watchlistKeywords =
    healthDistribution.find((entry) => entry.name === "Watchlist")?.value || 0;
  const coverage = healthLatest
    ? Number((Number(healthLatest.overallCitedRate || 0) * 100).toFixed(1))
    : 0;
  const providerBreakdown = buildCanonryProviderBreakdown(healthLatest);
  const evidence = buildCanonryEvidenceRows(timeline, latestRunId, selectedClient?.domain);
  const providerErrors = Object.keys(parseCanonryErrorMap(latestRun?.error))
    .filter((key) => key !== "run")
    .map(canonryProviderLabel);
  const summary = [
    latestRun?.status === "partial"
      ? "Sweep teilweise abgeschlossen"
      : latestRun?.status === "completed"
        ? "Sweep abgeschlossen"
        : latestRun?.status === "running"
          ? "Sweep läuft"
          : latestRun?.status
            ? "Live-Status geladen"
            : "Noch kein Run",
    healthLatest?.citedPairs != null && healthLatest?.totalPairs != null
      ? `${healthLatest.citedPairs}/${healthLatest.totalPairs} cited pairs`
      : null,
    providerErrors.length ? `Limits bei ${providerErrors.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const liveInsights =
    Array.isArray(data.insights) && data.insights.length
      ? data.insights
          .slice(0, 3)
          .map((item) =>
            item?.recommendation?.reason
              ? `${item.title} — ${item.recommendation.reason}`
              : item?.title,
          )
          .filter(Boolean)
      : [];
  const healthScore = trackedKeywords
    ? Math.round(((stableKeywords + watchlistKeywords * 0.5) / trackedKeywords) * 100)
    : 0;
  const providerSeries = buildCanonryProviderSeries(timeline, []);
  return {
    project: project.name || selectedClient?.name || "—",
    schedule: data.schedule?.cron || data.schedule?.expression || "—",
    coverage,
    coverageDelta: 0,
    citations: Number(healthLatest?.citedPairs ?? 0),
    citationsDelta: 0,
    visibility: coverage,
    visibilityDelta: 0,
    aiVisitors: 0,
    aiVisitorsDelta: 0,
    healthScore,
    healthDelta: 0,
    keywords: trackedKeywords,
    latestRun: {
      status: latestRun?.status || "unknown",
      time:
        latestRun?.finishedAt || latestRun?.startedAt
          ? formatCanonryStamp(latestRun?.finishedAt || latestRun?.startedAt)
          : "—",
      duration:
        latestRun?.startedAt && latestRun?.finishedAt
          ? formatCanonryDuration(latestRun.startedAt, latestRun.finishedAt)
          : "—",
      summary: summary || "Noch kein Run",
    },
    providerSeries,
    providerBreakdown,
    healthDistribution,
    evidence,
    insights: (liveInsights.length
      ? liveInsights
      : [
          providerErrors.length ? `Provider-Limits erkannt: ${providerErrors.join(", ")}` : null,
        ].filter(Boolean)
    ).slice(0, 3),
  };
}

// Local error boundary so a render glitch in one dashboard section shows an
// inline message instead of crashing the whole app.
class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Section render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.red}55`,
            borderRadius: 12,
            padding: 16,
            fontSize: 12,
            color: C.textMuted,
          }}
        >
          <div style={{ color: C.red, fontWeight: 700, marginBottom: 6 }}>
            {this.props.label || "Anzeige"} konnte nicht gerendert werden
          </div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
export const CANONRY_SERVICE = {
  status: "healthy",
  version: "0.12.3",
  projects: 6,
  providers: ["Gemini", "OpenAI", "Claude", "Perplexity"],
  openApi: "/api/v1/openapi.json",
  lastSync: "vor 6 Min",
  agent: "Aero",
};

// ═══════════════════════════════════════════════════════════════════════════
// UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════
export function Modal({ open, onClose, title, children, width = 540 }) {
  if (!open) return null;
  const modalWidth = typeof width === "number" ? `${width}px` : width;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,.6)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          width: `min(calc(100vw - 32px), ${modalWidth})`,
          maxHeight: "88vh",
          overflow: "auto",
          animation: "fadeScale .2s ease",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.textMuted,
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

export function Inp({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  textarea,
  required,
  options,
}) {
  const sh = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    background: C.card,
    border: `1px solid ${C.border}`,
    color: C.text,
    fontSize: 13,
    outline: "none",
    transition: "border-color .2s",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: 12,
            color: C.textMuted,
            marginBottom: 5,
            fontWeight: 500,
          }}
        >
          {label}
          {required && <span style={{ color: C.red, marginLeft: 2 }}>*</span>}
        </label>
      )}
      {options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...sh, appearance: "auto" }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : textarea ? (
        <textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...sh, resize: "vertical" }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={sh}
        />
      )}
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div
      className="tabbar"
      style={{
        display: "flex",
        background: C.card,
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        padding: 3,
        width: "fit-content",
        maxWidth: "100%",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: active === t.id ? 600 : 400,
            background: active === t.id ? C.accent : "transparent",
            color: active === t.id ? "#fff" : C.textMuted,
            transition: "all .15s",
            fontFamily: "inherit",
          }}
        >
          {t.icon && <t.icon size={14} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ w = "100%", h = 16 }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        background: `linear-gradient(90deg,${C.card} 0%,${C.cardHover} 50%,${C.card} 100%)`,
        backgroundSize: "400px 100%",
        animation: "shimmer 1.5s ease infinite",
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DATE RANGE PICKER
// ═══════════════════════════════════════════════════════════════════════════
export const DRP = [
  { id: "7d", label: "7 Tage", d: 7 },
  { id: "14d", label: "14 Tage", d: 14 },
  { id: "30d", label: "30 Tage", d: 30 },
  { id: "90d", label: "90 Tage", d: 90 },
];

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function CalendarMonth({ year, month, rangeStart, rangeEnd, onSelect, hoverDate, onHover }) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const weeks = [];
  let week = Array(startWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  const isInRange = (day) => {
    if (!day || !rangeStart) return false;
    const date = new Date(year, month, day);
    const end = rangeEnd || hoverDate;
    if (!end) return false;
    const s = rangeStart < end ? rangeStart : end;
    const e = rangeStart < end ? end : rangeStart;
    return date >= s && date <= e;
  };
  const isStart = (day) =>
    day && rangeStart && new Date(year, month, day).toDateString() === rangeStart.toDateString();
  const isEnd = (day) =>
    day && rangeEnd && new Date(year, month, day).toDateString() === rangeEnd.toDateString();
  const today = new Date();
  const isToday = (day) =>
    day && year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
  return (
    <div style={{ width: 220 }}>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}
      >
        {WEEKDAYS.map((wd) => (
          <div key={wd} style={{ textAlign: "center", fontSize: 10, color: C.textDim, padding: 4 }}>
            {wd}
          </div>
        ))}
      </div>
      {weeks.map((w, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {w.map((day, di) => {
            const inRange = isInRange(day);
            const start = isStart(day);
            const end = isEnd(day);
            const td = isToday(day);
            return (
              <button
                key={di}
                disabled={!day}
                onClick={() => day && onSelect(new Date(year, month, day))}
                onMouseEnter={() => day && onHover(new Date(year, month, day))}
                style={{
                  width: 28,
                  height: 28,
                  border: "none",
                  borderRadius: start || end ? 6 : inRange ? 0 : 6,
                  background: start || end ? C.accent : inRange ? `${C.accent}30` : "transparent",
                  color: start || end ? "#fff" : day ? (td ? C.accent : C.text) : "transparent",
                  fontSize: 11,
                  fontWeight: start || end || td ? 600 : 400,
                  cursor: day ? "pointer" : "default",
                  fontFamily: "inherit",
                  opacity: day ? 1 : 0,
                }}
              >
                {day || ""}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(value?.preset || "30d");
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [hoverDate, setHoverDate] = useState(null);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const handleDateSelect = (date) => {
    if (!rangeStart || rangeEnd) {
      setRangeStart(date);
      setRangeEnd(null);
    } else {
      const start = date < rangeStart ? date : rangeStart;
      const end = date < rangeStart ? rangeStart : date;
      setRangeStart(start);
      setRangeEnd(end);
    }
  };
  const applyRange = () => {
    if (!rangeStart || !rangeEnd) return;
    const days = Math.max(1, Math.ceil((rangeEnd - rangeStart) / (24 * 60 * 60 * 1000)) + 1);
    const fmt = (d) => d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
    onChange({
      label: `${fmt(rangeStart)} – ${fmt(rangeEnd)}`,
      days,
      start: rangeStart,
      end: rangeEnd,
      preset: "custom",
    });
    setA("custom");
    setShowCalendar(false);
    setOpen(false);
  };
  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else setViewMonth(viewMonth + 1);
  };
  const displayLabel = value?.label || "30 Tage";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "6px 12px",
          cursor: "pointer",
          color: C.textMuted,
          fontSize: 12,
          fontFamily: "inherit",
        }}
      >
        <Calendar size={13} />
        {displayLabel}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 6,
            minWidth: showCalendar ? 260 : 200,
            zIndex: 60,
            boxShadow: "0 8px 32px rgba(0,0,0,.4)",
          }}
        >
          {!showCalendar ? (
            <>
              {DRP.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setA(p.id);
                    const now = new Date();
                    const start = new Date(now.getTime() - p.d * 24 * 60 * 60 * 1000);
                    onChange({ label: p.label, days: p.d, start, end: now, preset: p.id });
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                    fontFamily: "inherit",
                    background: a === p.id ? C.accentDim : "transparent",
                    color: a === p.id ? C.accentLight : C.text,
                    fontWeight: a === p.id ? 600 : 400,
                  }}
                >
                  {p.label}
                </button>
              ))}
              <div style={{ height: 1, background: C.border, margin: "6px 0" }} />
              <button
                onClick={() => {
                  setShowCalendar(true);
                  setRangeStart(null);
                  setRangeEnd(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                  fontFamily: "inherit",
                  background: a === "custom" ? C.accentDim : "transparent",
                  color: a === "custom" ? C.accentLight : C.text,
                  fontWeight: a === "custom" ? 600 : 400,
                }}
              >
                <Calendar size={12} />
                Eigener Zeitraum
              </button>
            </>
          ) : (
            <div style={{ padding: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <button
                  onClick={prevMonth}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: C.textMuted,
                    padding: 4,
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {MONTHS[viewMonth]} {viewYear}
                </span>
                <button
                  onClick={nextMonth}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: C.textMuted,
                    padding: 4,
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <CalendarMonth
                year={viewYear}
                month={viewMonth}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                hoverDate={hoverDate}
                onSelect={handleDateSelect}
                onHover={setHoverDate}
              />
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {rangeStart
                    ? rangeStart.toLocaleDateString("de-CH", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })
                    : "Start"}
                  {" – "}
                  {rangeEnd
                    ? rangeEnd.toLocaleDateString("de-CH", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })
                    : "Ende"}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setShowCalendar(false)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: "transparent",
                      color: C.textMuted,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Zurück
                  </button>
                  <button
                    onClick={applyRange}
                    disabled={!rangeStart || !rangeEnd}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: rangeStart && rangeEnd ? C.accent : C.border,
                      color: rangeStart && rangeEnd ? "#fff" : C.textMuted,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: rangeStart && rangeEnd ? "pointer" : "not-allowed",
                      fontFamily: "inherit",
                    }}
                  >
                    Anwenden
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Comparison period options for the date range.
export const COMPARE_OPTIONS = [
  { id: "none", label: "Kein Vergleich" },
  { id: "prevPeriod", label: "Vorherige Periode" },
  { id: "prevMonth", label: "Vormonat (gleicher Zeitraum)" },
  { id: "prevYear", label: "Vorjahr (gleicher Zeitraum)" },
];

// Compute the comparison start/end dates for a given range + mode.
export function computeCompareRange(range, mode) {
  if (!range || mode === "none") return null;
  const start = new Date(range.start);
  const end = new Date(range.end);
  const days = range.days || Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
  let cStart, cEnd;
  if (mode === "prevPeriod") {
    // The contiguous period immediately before the current one.
    cEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    cStart = new Date(cEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  } else if (mode === "prevMonth") {
    cStart = new Date(start);
    cStart.setMonth(cStart.getMonth() - 1);
    cEnd = new Date(end);
    cEnd.setMonth(cEnd.getMonth() - 1);
  } else if (mode === "prevYear") {
    cStart = new Date(start);
    cStart.setFullYear(cStart.getFullYear() - 1);
    cEnd = new Date(end);
    cEnd.setFullYear(cEnd.getFullYear() - 1);
  } else {
    return null;
  }
  const fmt = (d) => d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
  return { start: cStart, end: cEnd, days, label: `${fmt(cStart)} – ${fmt(cEnd)}` };
}

// Parse a series date string ("YYYYMMDD", "YYYY-MM-DD" or ISO) into a Date.
export function parseSeriesDate(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{8}$/.test(str)) {
    return new Date(Number(str.slice(0, 4)), Number(str.slice(4, 6)) - 1, Number(str.slice(6, 8)));
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// Sum a metric across the series rows whose date falls within [start, end].
export function sumSeriesInRange(series, key, start, end) {
  if (!Array.isArray(series) || !start || !end) return 0;
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  let sum = 0;
  for (const row of series) {
    const d = parseSeriesDate(row.date);
    if (d && d >= s && d <= e) sum += Number(row[key] || 0);
  }
  return sum;
}

// Percentage delta current vs previous, rounded to one decimal. null if no basis.
export function pctDelta(cur, prev) {
  if (prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Friendly short label for a comparison mode (shown on KPI cards).
export function compareName(mode) {
  if (mode === "prevPeriod") return "Vorperiode";
  if (mode === "prevMonth") return "Vormonat";
  if (mode === "prevYear") return "Vorjahr";
  return null;
}

// Banner shown at the top of a dashboard when a comparison period is active,
// making it explicit which two windows are being compared.
export function CompareBanner({ dateRange }) {
  if (!dateRange?.compare) return null;
  const name = compareName(dateRange.compareMode) || "Vergleich";
  const fmt = (d) =>
    new Date(d).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        background: C.accentDim,
        border: `1px solid ${C.accent}55`,
        borderRadius: 12,
        padding: "12px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: C.accentLight,
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        <GitBranch size={15} />
        Vergleich aktiv: {name}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12.5,
          color: C.textMuted,
        }}
      >
        <span style={{ color: C.text, fontWeight: 600 }}>
          {fmt(dateRange.start)} – {fmt(dateRange.end)}
        </span>
        <span style={{ color: C.textDim }}>vs.</span>
        <span style={{ fontWeight: 600 }}>
          {fmt(dateRange.compare.start)} – {fmt(dateRange.compare.end)}
        </span>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 11.5,
          color: C.textDim,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ArrowUpRight size={13} color={C.green} /> Anstieg
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ArrowDownRight size={13} color={C.red} /> Rückgang
        </span>
      </div>
    </div>
  );
}

// Compute a KPI's comparison delta from a series: returns rounded % or undefined.
export function seriesDelta(series, key, range) {
  if (!range?.compare) return undefined;
  const cur = sumSeriesInRange(series, key, range.start, range.end);
  const prev = sumSeriesInRange(series, key, range.compare.start, range.compare.end);
  const d = pctDelta(cur, prev);
  return d == null ? undefined : d;
}

// Live GA4 comparison hook — fetches real current vs compare totals from GA4 for
// the selected date range + comparison period. Returns { data, deltas }.
// Live-GA4 im gewählten Zeitraum (Datumsfilter-Fix 2026-08-10): holt
// summary/conversions/traffic mit persist:false (kein audit_runs-Insert) und
// cached per (Endpoint, Kunde, Tage) — SWR über rangeStore, Filterwechsel sind
// nach dem ersten Laden instant. days=null deaktiviert (z. B. Custom-Zeitraum
// in der Vergangenheit → Snapshot-Fallback bleibt maßgeblich).
export function useLiveGa4(clientId, endpoint, days) {
  const d = days ? Math.min(90, Math.max(1, Math.round(days))) : null;
  return useRangeData(clientId && d ? `ga4:${endpoint}:${clientId}:${d}` : null, async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch(`/api/google/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientId, days: d, persist: false }),
    });
    const j = await r.json().catch(() => null);
    return j?.ok ? j : null;
  });
}

// Live-Zeitraum nur, wenn das Fenster "bis heute" reicht — ein Custom-Zeitraum,
// der in der Vergangenheit endet, lässt sich über die days-APIs nicht abbilden.
export const liveDaysFor = (dateRange) => {
  if (!dateRange?.days) return 30;
  const end = dateRange.end ? new Date(dateRange.end).getTime() : Date.now();
  return Date.now() - end < 54e6 /* ~15h Toleranz */ ? dateRange.days : null;
};

export function useGa4Compare(clientId, dateRange) {
  const [data, setData] = useState(null);
  const compareKey = dateRange?.compare
    ? `${dateRange.compareMode}:${new Date(dateRange.start).toISOString().slice(0, 10)}:${new Date(dateRange.compare.start).toISOString().slice(0, 10)}`
    : null;
  useEffect(() => {
    let cancelled = false;
    if (!clientId || !dateRange?.compare) {
      setData(null);
      return;
    }
    const iso = (d) => new Date(d).toISOString().slice(0, 10);
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch("/api/google/ga4-compare", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientId,
            start: iso(dateRange.start),
            end: iso(dateRange.end),
            compareStart: iso(dateRange.compare.start),
            compareEnd: iso(dateRange.compare.end),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!cancelled && j.ok) setData({ current: j.current, compare: j.compare });
        else if (!cancelled) setData(null);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, compareKey]);
  const deltas = useMemo(() => {
    if (!data?.current || !data?.compare) return {};
    const d = (k) =>
      pctDelta(Number(data.current[k] || 0), Number(data.compare[k] || 0)) ?? undefined;
    return {
      sessions: d("sessions"),
      totalUsers: d("totalUsers"),
      screenPageViews: d("screenPageViews"),
      conversions: d("conversions"),
      totalRevenue: d("totalRevenue"),
    };
  }, [data]);
  return { data, deltas };
}

// Comparison-period selector shown next to the DateRangePicker.
export function ComparePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = value || "none";
  const current = COMPARE_OPTIONS.find((o) => o.id === active) || COMPARE_OPTIONS[0];
  const isOn = active !== "none";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        title="Mit vorherigem Zeitraum vergleichen"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: isOn ? C.accentDim : C.card,
          border: `1px solid ${isOn ? C.accent : C.border}`,
          borderRadius: 8,
          padding: "6px 12px",
          cursor: "pointer",
          color: isOn ? C.accentLight : C.textMuted,
          fontSize: 12,
          fontWeight: isOn ? 600 : 400,
          fontFamily: "inherit",
        }}
      >
        <GitBranch size={13} />
        {isOn ? current.label.split(" ")[0] : "Vergleich"}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 6,
            minWidth: 220,
            zIndex: 60,
            boxShadow: "0 8px 32px rgba(0,0,0,.4)",
          }}
        >
          {COMPARE_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                textAlign: "left",
                fontFamily: "inherit",
                background: active === o.id ? C.accentDim : "transparent",
                color: active === o.id ? C.accentLight : C.text,
                fontWeight: active === o.id ? 600 : 400,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED CHART COMPONENTS (preserved)
// ═══════════════════════════════════════════════════════════════════════════
export function KpiCard({
  icon: I,
  label,
  value,
  change,
  prefix = "",
  suffix = "",
  color = C.accent,
  compareValue,
  compareLabel,
}) {
  const u = change > 0,
    n = change === 0;
  const hasCompare = change !== undefined;
  const fmtV = (v) =>
    typeof v === "number" ? `${prefix}${v.toLocaleString("de-CH")}${suffix}` : v;
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${hasCompare ? (n ? C.border : u ? C.green : C.red) + "66" : C.border}`,
        borderRadius: 14,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color .2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.borderHover)}
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = hasCompare
          ? (n ? C.border : u ? C.green : C.red) + "66"
          : C.border)
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: `${color}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <I size={18} color={color} />
        </div>
        {change !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: 13,
              fontWeight: 700,
              color: n ? C.textMuted : u ? C.green : C.red,
              background: n ? C.border + "44" : u ? C.greenDim : C.redDim,
              padding: "4px 9px",
              borderRadius: 6,
            }}
          >
            {n ? (
              <Minus size={13} />
            ) : u ? (
              <ArrowUpRight size={13} />
            ) : (
              <ArrowDownRight size={13} />
            )}
            {change > 0 ? "+" : ""}
            {change}%
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-.5px" }}>
          {prefix}
          {typeof value === "number" ? value.toLocaleString("de-CH") : value}
          {suffix}
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{label}</div>
        {/* Comparison line: shows the previous value + period so the delta is traceable. */}
        {compareValue !== undefined && compareValue !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${C.border}`,
              fontSize: 11.5,
              color: C.textDim,
            }}
          >
            <span style={{ color: C.textMuted }}>vorher:</span>
            <span style={{ color: C.textMuted, fontWeight: 600 }}>{fmtV(compareValue)}</span>
            {compareLabel && <span style={{ color: C.textDim }}>· {compareLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChartCard({ title, children, action, minH = 280 }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        minHeight: minH,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</span>
        {action && (
          <span style={{ fontSize: 11, color: C.textMuted, cursor: "pointer" }}>{action}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function CTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#1a1b28",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12,
      }}
    >
      <div style={{ color: C.textMuted, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", gap: 8, marginBottom: 2 }}>
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value?.toLocaleString("de-CH")}</span>
        </div>
      ))}
    </div>
  );
}

export function PBadge({ pos, prev }) {
  const d = prev - pos;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          background: pos <= 3 ? C.accentDim : pos <= 10 ? C.blueDim : C.orangeDim,
          color: pos <= 3 ? C.accentLight : pos <= 10 ? C.blue : C.orange,
          padding: "2px 10px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {pos}
      </span>
      {d !== 0 && (
        <span
          style={{
            color: d > 0 ? C.green : C.red,
            fontSize: 11,
            display: "flex",
            alignItems: "center",
          }}
        >
          {d > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(d)}
        </span>
      )}
    </div>
  );
}

export function DTable({ columns, data }) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table
        style={{
          width: "100%",
          minWidth: columns.length >= 4 ? 560 : undefined,
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: c.align || "left",
                  padding: "10px 12px",
                  color: C.textMuted,
                  fontWeight: 500,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: ".5px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, ri) => (
            <tr
              key={ri}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {columns.map((c, ci) => (
                <td
                  key={ci}
                  style={{ padding: "11px 12px", color: C.text, textAlign: c.align || "left" }}
                >
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LiveEmptyState({ title, hint }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>
        {title || "Noch keine Live-Daten"}
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, maxWidth: 480, margin: "0 auto" }}>
        {hint ||
          "Verbinde GSC/GA4 in den Einstellungen oder starte einen Audit-Lauf, um echte Werte zu sehen."}
      </div>
    </div>
  );
}

// Einheitliches SEO-Layout über alle Kunden (User-Wunsch 2026-07-17):
// Sektionen verschwinden nicht mehr bei fehlenden Daten, sondern zeigen einen
// Platzhalter mit dem konkreten nächsten Schritt — so sieht das Dashboard bei
// jedem Kunden gleich aus und Lücken sind sofort als Handlungsbedarf erkennbar.
// 10er-Seitenwechsler wie bei den Prompts im KI-Tab (User-Wunsch 2026-07-19),
// hier mit den Inline-Styles des SEO-Dashboards.
export function seoPageNums(cur, pages) {
  const set = new Set([0, pages - 1, cur - 1, cur, cur + 1]);
  const nums = [...set].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}

export function SeoPager({ page, setPage, total, pageSize = 10, unit = "Einträge" }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages - 1);
  if (pages <= 1) return null;
  const btn = (active) => ({
    height: 26,
    minWidth: 26,
    padding: "0 6px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? `${C.accent}22` : "transparent",
    color: active ? C.accent : C.textMuted,
  });
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 10,
      }}
    >
      <span style={{ fontSize: 11, color: C.textDim }}>
        {cur * pageSize + 1}–{Math.min(total, (cur + 1) * pageSize)} von {total} {unit}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={() => setPage(Math.max(0, cur - 1))}
          disabled={cur === 0}
          aria-label="Vorherige Seite"
          style={{ ...btn(false), opacity: cur === 0 ? 0.35 : 1 }}
        >
          ‹
        </button>
        {seoPageNums(cur, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} style={{ fontSize: 12, color: C.textDim, padding: "0 2px" }}>
              …
            </span>
          ) : (
            <button key={p} onClick={() => setPage(p)} style={btn(p === cur)}>
              {p + 1}
            </button>
          ),
        )}
        <button
          onClick={() => setPage(Math.min(pages - 1, cur + 1))}
          disabled={cur >= pages - 1}
          aria-label="Nächste Seite"
          style={{ ...btn(false), opacity: cur >= pages - 1 ? 0.35 : 1 }}
        >
          ›
        </button>
      </div>
    </div>
  );
}

export function SectionPlaceholder({ title, hint }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        padding: 16,
        opacity: 0.85,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: C.textDim }}>{hint}</div>
    </div>
  );
}

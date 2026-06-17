import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useRef,
  useMemo,
  Component,
} from "react";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import {
  Search,
  Bell,
  ChevronDown,
  ChevronLeft,
  TrendingUp,
  Globe,
  Eye,
  FileText,
  Bot,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  FileInput,
  DollarSign,
  BarChart3,
  Activity,
  Zap,
  Users,
  Settings,
  LogOut,
  ChevronRight,
  Calendar,
  Download,
  RefreshCw,
  Play,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Layers,
  Target,
  Award,
  Plus,
  Check,
  X,
  Clock,
  AlertCircle,
  CheckCircle,
  Copy,
  Save,
  PenTool,
  LayoutGrid,
  List,
  Key,
  Palette,
  Database,
  HelpCircle,
  Terminal,
  Code,
  Bookmark,
  Link2,
  ExternalLink,
  Hash,
  Bold,
  Italic,
  Heading2,
  Heading3,
  Command,
  Info,
  ToggleLeft,
  ToggleRight,
  GitBranch,
  Type,
  Megaphone,
} from "lucide-react";
import { ezyFetch } from "@/ezy/data/api";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyDefaults } from "@/ezy/data/useEzyDefaults";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import { useEzyContent } from "@/ezy/data/useEzyContent";
import { useEzyToolSettings, toolProvider } from "@/ezy/data/useEzyToolSettings";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import { executeTool as runToolLive } from "@/ezy/data/runTool";
import { useEzyAuditHistory } from "@/ezy/data/useEzyAuditHistory";
import {
  useEzyLatestRun,
  ahrefsKpisFromResult,
  ga4KpisFromResult,
  gscKpisFromResult,
  pagespeedKpisFromResult,
} from "@/ezy/data/useEzyLatestRun";
import GoogleClientPanel from "@/ezy/GoogleClientPanel.jsx";
import { supabase } from "@/integrations/supabase/client";
import { SKILL_CATALOG } from "@/ezy/data/skillCatalog";
const toolHasLiveProvider = (id) => toolProvider(id) !== null;

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0a0b0f",
  surface: "#12131a",
  card: "#181923",
  cardHover: "#1e1f2e",
  border: "#252636",
  borderHover: "#35364a",
  text: "#e2e4f0",
  textMuted: "#8b8da3",
  textDim: "#5c5e72",
  accent: "#6c5ce7",
  accentLight: "#a78bfa",
  accentDim: "rgba(108,92,231,0.15)",
  green: "#10b981",
  greenDim: "rgba(16,185,129,0.12)",
  red: "#ef4444",
  redDim: "rgba(239,68,68,0.12)",
  blue: "#3b82f6",
  blueDim: "rgba(59,130,246,0.12)",
  orange: "#f59e0b",
  orangeDim: "rgba(245,158,11,0.12)",
  cyan: "#06b6d4",
  cyanDim: "rgba(6,182,212,0.12)",
  pink: "#ec4899",
  pinkDim: "rgba(236,72,153,0.12)",
};
const AI_COLORS = {
  ChatGPT: "#10b981",
  Perplexity: "#3b82f6",
  Gemini: "#f59e0b",
  Claude: "#ec4899",
  Copilot: "#06b6d4",
  Grok: "#ec4899",
};
const CSS = `html,body,#root{min-height:100%;margin:0;overflow-x:hidden}*{box-sizing:border-box}@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes slideUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeScale{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}::selection{background:rgba(108,92,231,.3);color:#e2e4f0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}@media(max-width:760px){.app-sidebar{display:none!important}.app-main{margin-left:0!important;min-width:0!important;width:100%!important}.app-header{align-items:flex-start!important;gap:10px!important}.header-left,.header-actions{width:100%;flex-wrap:wrap}.app-content{padding:16px 12px!important}.settings-shell{flex-direction:column!important;gap:16px!important}.settings-nav{width:100%!important;display:flex!important;overflow-x:auto;padding-bottom:4px}.settings-nav button{width:auto!important;white-space:nowrap;flex-shrink:0}.settings-panel{max-width:none!important}.client-toolbar{flex-direction:column!important;align-items:stretch!important}.client-toolbar>div{width:100%!important}.client-grid{grid-template-columns:minmax(0,1fr)!important}.ezy-form-grid{grid-template-columns:1fr!important}.kpi-grid{grid-template-columns:1fr!important}.kpi-grid>div{grid-column:auto!important}.client-drawer,.quick-audit-panel{width:100vw!important;max-width:100vw!important}.quick-audit-panel{padding:18px 14px!important}.cmd-palette{width:min(calc(100vw - 24px),520px)!important}.mobile-wrap{flex-wrap:wrap!important}.dash-kpis{grid-template-columns:1fr 1fr!important}.split-pane{grid-template-columns:1fr!important}}`;
function downloadFile(content, type, filename) {
  const b = new Blob([content], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 0);
}
function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function sanitizeHref(href = "") {
  const v = href.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(v) ? v : "#";
}
function ga4PropertyText(client) {
  return client?.ga4PropertyId || "Noch nicht hinterlegt";
}
const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
function useLiveIntegrations() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const refresh = useCallback(async () => {
    try {
      const res = await ezyFetch("/api/live/status");
      const payload = await res.json().catch(() => ({ error: "Ungültige Live-Antwort" }));
      if (!res.ok) throw new Error(payload.error || "Live-Status nicht verfügbar");
      setState({ loading: false, data: payload, error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error.message || "Live-Status nicht verfügbar" });
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
const CLIENT_STORAGE_KEY = "ezy-one.clients.v1";
const PROFILE_STORAGE_KEY = "ezy-one.profile.v1";
const DEFAULTS_STORAGE_KEY = "ezy-one.customer-defaults.v1";
const DEFAULT_PROFILE = {
  name: "Daniel Agrici",
  email: "daniel@ezy.ch",
  role: "Agency Admin",
  language: "Deutsch",
};
const DEFAULT_CUSTOMER_DEFAULTS = {
  language: "Deutsch",
  tone: "Professionell",
  reportTemplate: "Standard",
  visibleTabs: ["seo", "geo", "conversions", "ads"],
};
function readStoredJson(key, fallback) {
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
function persistJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function defaultsFromStored(value) {
  return {
    language: String(value?.language || DEFAULT_CUSTOMER_DEFAULTS.language),
    tone: String(value?.tone || DEFAULT_CUSTOMER_DEFAULTS.tone),
    reportTemplate: String(value?.reportTemplate || DEFAULT_CUSTOMER_DEFAULTS.reportTemplate),
    visibleTabs: Array.isArray(value?.visibleTabs) ? value.visibleTabs : DEFAULT_CUSTOMER_DEFAULTS.visibleTabs,
  };
}
function useMediaQuery(query) {
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
function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
function slugifyProjectName(value = "") {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
function initialsFromName(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0]?.[0] || "E")
    .concat(parts[1]?.[0] || "")
    .toUpperCase()
    .slice(0, 2);
}
function normalizeClientShape(client, fallback = {}) {
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
  };
}
function clientFormFromClient(client) {
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
  };
}
function profileFromStored(value) {
  return {
    name: String(value?.name || DEFAULT_PROFILE.name),
    email: String(value?.email || DEFAULT_PROFILE.email),
    role: String(value?.role || DEFAULT_PROFILE.role),
    language: String(value?.language || DEFAULT_PROFILE.language),
  };
}
const CANONRY_PROVIDER_LABELS = {
  openai: "ChatGPT",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};
function canonryProviderLabel(name = "") {
  const key = String(name || "").toLowerCase();
  return CANONRY_PROVIDER_LABELS[key] || String(name || "").replace(/^./, (c) => c.toUpperCase());
}
function formatCanonryStamp(value, options = { dateStyle: "short", timeStyle: "short" }) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("de-CH", options);
}
function formatCanonryDay(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}
function formatCanonryDuration(startedAt, finishedAt) {
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
function parseCanonryErrorMap(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { run: String(raw) };
  }
}
function useCanonryOverview(selectedClient) {
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
      setState({ loading: false, data: null, error: error.message || "Canonry-Overview nicht verfügbar" });
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
function buildCanonryProviderSeries(timeline, fallbackSeries) {
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
function buildCanonryHealthDistribution(timeline, latestRunId) {
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
function buildCanonryEvidenceRows(timeline, latestRunId, domain) {
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
function buildCanonryProviderBreakdown(healthLatest) {
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
function buildCanonryLiveModel(selectedClient, payload) {
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
// TOAST
// ═══════════════════════════════════════════════════════════════════════════
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);
function ToastProvider({ children }) {
  const [ts, setTs] = useState([]);
  const add = useCallback((msg, type = "info") => {
    const id = Date.now();
    setTs((p) => [...p, { id, msg, type }]);
    setTimeout(() => setTs((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  const ic = { success: CheckCircle, error: AlertCircle, info: HelpCircle };
  const co = { success: C.green, error: C.red, info: C.blue };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {ts.map((t) => {
          const I = ic[t.type] || ic.info;
          return (
            <div
              key={t.id}
              style={{
                background: C.card,
                border: `1px solid ${co[t.type]}40`,
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,.5)",
                animation: "slideUp .25s ease",
                minWidth: 280,
              }}
            >
              <I size={16} color={co[t.type]} />
              <span style={{ fontSize: 13, color: C.text }}>{t.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════
function Modal({ open, onClose, title, children, width = 540 }) {
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
function Btn({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  onClick,
  disabled,
  style: sx,
}) {
  const base = {
    border: "none",
    cursor: disabled ? "default" : "pointer",
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 600,
    transition: "all .15s",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
  };
  const sz = {
    sm: { padding: "5px 10px", fontSize: 11 },
    md: { padding: "7px 14px", fontSize: 12 },
    lg: { padding: "10px 20px", fontSize: 13 },
  };
  const va = {
    primary: { background: `linear-gradient(135deg,${C.accent},${C.blue})`, color: "#fff" },
    secondary: { background: C.card, color: C.text, border: `1px solid ${C.border}` },
    ghost: { background: "transparent", color: C.textMuted },
    danger: { background: C.redDim, color: C.red },
    success: { background: C.greenDim, color: C.green },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...sz[size], ...va[variant], ...sx }}
    >
      {Icon && <Icon size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
}
function Badge({ children, color = C.accent }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 6,
        background: `${color}18`,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
function Inp({ label, value, onChange, placeholder, type = "text", textarea, required, options }) {
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
function TabBar({ tabs, active, onChange }) {
  return (
    <div
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
function Skeleton({ w = "100%", h = 16 }) {
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
const DRP = [
  { id: "7d", label: "7 Tage", d: 7 },
  { id: "14d", label: "14 Tage", d: 14 },
  { id: "30d", label: "30 Tage", d: 30 },
  { id: "90d", label: "90 Tage", d: 90 },
];
function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("30d");
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
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
        {value.label || "30 Tage"}
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
            minWidth: 160,
            zIndex: 60,
            boxShadow: "0 8px 32px rgba(0,0,0,.4)",
          }}
        >
          {DRP.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setA(p.id);
                const now = new Date();
                const start = new Date(now.getTime() - p.d * 24 * 60 * 60 * 1000);
                onChange({ label: p.label, days: p.d, start, end: now });
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
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DEMO DATA
// ═══════════════════════════════════════════════════════════════════════════
function genDays(n = 30) {
  const d = [];
  const t = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(t);
    x.setDate(x.getDate() - i);
    d.push(x.toISOString().slice(5, 10));
  }
  return d;
}
const DAYS = genDays(30);
const seoRanking = [
  { name: "Top 3", value: 42, color: C.accent },
  { name: "4–10", value: 114, color: C.blue },
  { name: "11–20", value: 133, color: C.green },
  { name: "21–50", value: 223, color: C.orange },
  { name: "51–100", value: 335, color: C.textDim },
];
const trafficCountry = [
  { name: "CH", value: 28400, color: C.accent },
  { name: "DE", value: 12300, color: C.blue },
  { name: "AT", value: 4200, color: C.green },
  { name: "US", value: 2100, color: C.orange },
  { name: "Other", value: 1520, color: C.textDim },
];
const backlinksTrend = DAYS.map((d) => ({
  date: d,
  new: 3 + Math.round(Math.random() * 8),
  lost: 1 + Math.round(Math.random() * 3),
}));
const geoClicks = DAYS.map((d, i) => ({
  date: d,
  clicks: 100 + Math.round(i * 5 + Math.sin(i / 2) * 30 + Math.random() * 25),
}));
const geoVisitors = DAYS.map((d, i) => ({
  date: d,
  ChatGPT: 45 + Math.round(i * 1.8 + Math.random() * 15),
  Perplexity: 30 + Math.round(i * 1.2 + Math.random() * 12),
  Gemini: 15 + Math.round(i * 0.6 + Math.random() * 8),
  Copilot: 8 + Math.round(i * 0.3 + Math.random() * 5),
  Grok: 4 + Math.round(i * 0.2 + Math.random() * 3),
}));
const geoRanking = [
  { name: "Top 3", value: 12, color: C.accent },
  { name: "4–5", value: 16, color: C.blue },
  { name: "6–10", value: 17, color: C.green },
];
const CANONRY_SERVICE = {
  status: "healthy",
  version: "0.12.3",
  projects: 6,
  providers: ["Gemini", "OpenAI", "Claude", "Perplexity"],
  openApi: "/api/v1/openapi.json",
  lastSync: "vor 6 Min",
  agent: "Aero",
};
// CANONRY_CLIENTS demo data removed in v19 — Canonry now lives only via /api/live/canonry/overview.

const CLIENTS = [
  {
    id: "c1",
    name: "Dental-Praxis Zürich",
    domain: "dental-zuerich.ch",
    industry: "Gesundheit",
    status: "active",
    contactEmail: "praxis@dental-zuerich.ch",
    contactPhone: "+41 44 555 12 34",
    monthlyBudget: 2800,
    tags: ["Local SEO", "GEO"],
    targetLocations: ["Zürich"],
    notes: "Google Maps Optimierung, Bewertungen.",
    score: 82,
    keywords: 890,
    traffic: 12800,
    aiVisitors: 680,
    revenue: 18400,
    gscSiteUrl: "sc-domain:dental-zuerich.ch",
    ga4PropertyId: "485920311",
    canonryProject: "dental-zuerich-ch",
  },
  {
    id: "c2",
    name: "SchuhParadies AG",
    domain: "schuhparadies.ch",
    industry: "E-Commerce",
    status: "active",
    contactEmail: "marketing@schuhparadies.ch",
    contactPhone: "+41 44 123 45 67",
    monthlyBudget: 5200,
    tags: ["SEO", "GEO", "Content"],
    targetLocations: ["Schweiz", "DACH"],
    notes: "Fokus auf Produktseiten und Blog-Content.",
    score: 78,
    keywords: 3847,
    traffic: 48520,
    aiVisitors: 1820,
    revenue: 47625,
    gscSiteUrl: "sc-domain:schuhparadies.ch",
    ga4PropertyId: "486102744",
    canonryProject: "schuhparadies-ch",
  },
  {
    id: "c3",
    name: "Hotel & Spa Arbon",
    domain: "hotel-arbon.ch",
    industry: "Tourismus",
    status: "active",
    contactEmail: "info@hotel-arbon.ch",
    contactPhone: "+41 71 440 22 33",
    monthlyBudget: 3500,
    tags: ["Local SEO", "Content"],
    targetLocations: ["Arbon", "Bodensee"],
    notes: "Saisonales Geschäft, Spa-Packages bewerben.",
    score: 65,
    keywords: 2140,
    traffic: 31200,
    aiVisitors: 1240,
    revenue: 32100,
    gscSiteUrl: "sc-domain:hotel-arbon.ch",
    ga4PropertyId: "486104118",
    canonryProject: "hotel-arbon-ch",
  },
  {
    id: "c4",
    name: "CodeLab Basel",
    domain: "codelab-basel.ch",
    industry: "IT / SaaS",
    status: "active",
    contactEmail: "hello@codelab-basel.ch",
    contactPhone: "+41 61 888 99 00",
    monthlyBudget: 6200,
    tags: ["SEO", "GEO", "Technical"],
    targetLocations: ["Basel", "DACH"],
    notes: "B2B SaaS, internationale Expansion.",
    score: 71,
    keywords: 1560,
    traffic: 19400,
    aiVisitors: 340,
    revenue: 22800,
    gscSiteUrl: "sc-domain:codelab-basel.ch",
    ga4PropertyId: "486105029",
    canonryProject: "codelab-basel-ch",
  },
  {
    id: "c5",
    name: "Beauté Studio Winterthur",
    domain: "beaute-winterthur.ch",
    industry: "Kosmetik",
    status: "paused",
    contactEmail: "kontakt@beaute-winterthur.ch",
    contactPhone: "+41 52 333 44 55",
    monthlyBudget: 1200,
    tags: ["Local SEO"],
    targetLocations: ["Winterthur"],
    notes: "Kleine lokale Kosmetikpraxis.",
    score: 54,
    keywords: 420,
    traffic: 5600,
    aiVisitors: 200,
    revenue: 6800,
    gscSiteUrl: "sc-domain:beaute-winterthur.ch",
    ga4PropertyId: "486106443",
    canonryProject: "beaute-winterthur-ch",
  },
  {
    id: "c6",
    name: "Sicovend AG",
    domain: "sicovend.com",
    industry: "B2B / Commerce",
    status: "active",
    contactEmail: "Noch nicht hinterlegt",
    contactPhone: "Noch nicht hinterlegt",
    monthlyBudget: 2500,
    tags: ["SEO", "GEO"],
    targetLocations: ["Schweiz"],
    notes:
      "GSC verbunden, 10 Canonry-Keywords importiert und erster Visibility Sweep durchgeführt.",
    score: 20,
    keywords: 10,
    traffic: 0,
    aiVisitors: 0,
    revenue: 0,
    gscSiteUrl: "sc-domain:sicovend.com",
    ga4PropertyId: "510924150",
    ga4MeasurementId: "G-1DEJWRQDB0",
    canonryProject: "sicovend-com",
  },
];

const CONTENT_ITEMS = [
  {
    id: "ct1",
    title: "SEO Guide 2026 — Die komplette Anleitung",
    clientId: "c2",
    type: "blog",
    status: "published",
    content:
      "# SEO Guide 2026\n\nDieser Leitfaden deckt alle wichtigen Aspekte der Suchmaschinenoptimierung ab.\n\n## On-Page SEO\n\nTitle Tags, Meta Descriptions und Heading-Struktur sind entscheidend.\n\n## Technical SEO\n\nCore Web Vitals, Mobile-First Indexierung und Crawlability.\n\n## GEO / AEO\n\nOptimierung für AI-generierte Suchergebnisse.\n\n## Fazit\n\nSEO bleibt 2026 ein zentraler Kanal für organisches Wachstum.",
    keywords: ["seo guide 2026", "seo anleitung"],
    wordCount: 3200,
    toolId: "generate-blog",
    createdAt: "2026-04-15",
    updatedAt: "2026-04-15",
  },
  {
    id: "ct2",
    title: "Local SEO Audit — Dental-Praxis Zürich",
    clientId: "c1",
    type: "audit",
    status: "published",
    content:
      "# Local SEO Audit\n\n**Domain:** dental-zuerich.ch\n**Score:** 82/100\n\n## Ergebnisse\n\n- Google Business Profil: ✅ Optimiert\n- NAP Konsistenz: ⚠️ 2 Abweichungen\n- Bewertungen: ✅ 47 Reviews (4.8★)\n- Local Keywords: ✅ Top 5 für 'zahnarzt zürich'",
    keywords: ["zahnarzt zürich", "dental zürich"],
    wordCount: 1200,
    toolId: "full-seo-audit",
    createdAt: "2026-04-12",
    updatedAt: "2026-04-14",
  },
  {
    id: "ct3",
    title: "GEO Analyse — Hotel Arbon",
    clientId: "c3",
    type: "audit",
    status: "draft",
    content:
      "# GEO Analyse\n\n**Domain:** hotel-arbon.ch\n\n## AI Overview Coverage\n\nAktuell erscheint die Website in 18% der relevanten AI Overviews.\n\n## Empfehlungen\n\n1. FAQ-Sektion für häufige Fragen\n2. Schema Markup erweitern\n3. Entity-Coverage verbessern",
    keywords: ["hotel bodensee", "spa arbon"],
    wordCount: 1800,
    toolId: "geo-aeo-audit",
    createdAt: "2026-04-18",
    updatedAt: "2026-04-18",
  },
  {
    id: "ct4",
    title: "E-Commerce SEO Produktseiten optimieren",
    clientId: "c2",
    type: "blog",
    status: "draft",
    content:
      "# Produktseiten für SEO optimieren\n\nProduktseiten sind das Herzstück jedes Online-Shops.\n\n## Titel & Meta\n\nJede Produktseite braucht einen einzigartigen Title Tag.\n\n## Strukturierte Daten\n\nProduct Schema mit Preis, Bewertungen und Verfügbarkeit.",
    keywords: ["ecommerce seo", "produktseiten"],
    wordCount: 2600,
    toolId: "generate-blog",
    createdAt: "2026-04-10",
    updatedAt: "2026-04-16",
  },
  {
    id: "ct5",
    title: "Technical Audit — CodeLab Basel",
    clientId: "c4",
    type: "audit",
    status: "published",
    content:
      "# Technical Audit Report\n\n**Score:** 71/100\n\n## Core Web Vitals\n- LCP: 2.8s ⚠️\n- INP: 180ms ✅\n- CLS: 0.08 ✅\n\n## Crawlability\n- Robots.txt: ✅\n- Sitemap: ⚠️ Fehlende Seiten",
    keywords: ["technical seo"],
    wordCount: 950,
    toolId: "technical-audit",
    createdAt: "2026-04-08",
    updatedAt: "2026-04-08",
  },
  {
    id: "ct6",
    title: "Obsidian Note — SEO Strategie Q2",
    clientId: "c2",
    type: "note",
    status: "published",
    content:
      "---\ntags: [seo, strategie, q2-2026]\n---\n\n# SEO Strategie Q2 2026\n\n## Ziele\n- Organic Traffic +20%\n- 5 neue Pillar Pages\n- AI Visibility auf 30%\n\n## Massnahmen\n- Content Cluster aufbauen\n- Schema Markup erweitern\n- [[GEO Optimierung]] starten",
    keywords: ["strategie"],
    wordCount: 400,
    toolId: "obsidian-note",
    createdAt: "2026-04-01",
    updatedAt: "2026-04-19",
  },
];
// RUN_HISTORY removed in v14 — live data now comes from useEzyAuditHistory.

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════
const CURATED_TOOLS = [
  {
    id: "open-seo-audit",
    label: "Open SEO Audit",
    description: "Vollständiger SEO Audit via open-seo",
    longDescription:
      "Umfassender Open-Source SEO Audit mit On-Page, Technical, Backlinks, Keywords, Schema und Speed Analyse.",
    icon: Layers,
    category: "audit",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.accent,
    inputs: [
      {
        id: "url",
        label: "Website URL",
        type: "url",
        required: true,
        placeholder: "https://example.ch",
      },
      {
        id: "depth",
        label: "Crawl-Tiefe",
        type: "select",
        required: false,
        options: ["Schnell (10 Seiten)", "Standard (50 Seiten)", "Tief (200 Seiten)"],
      },
    ],
    estimatedTime: "3-8 min",
    subSkills: ["seo-audit", "seo-page", "seo-technical", "seo-backlinks", "seo-schema"],
    enabled: true,
  },
  {
    id: "full-seo-audit",
    label: "Full SEO Audit",
    description: "seo-audit · bis zu 15 Subagenten",
    longDescription:
      "Der umfassendste SEO Audit über seo-audit, das an bis zu 15 Spezialisten-Skills (8 immer + 7 bedingt) delegiert. Deckt alle Bereiche von Keyword-Research bis GEO/AEO ab.",
    icon: Layers,
    category: "audit",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.accent,
    inputs: [
      { id: "url", label: "Website URL", type: "url", required: true },
      {
        id: "focus",
        label: "Fokus-Keywords",
        type: "textarea",
        required: false,
        placeholder: "Ein Keyword pro Zeile",
      },
    ],
    estimatedTime: "5-15 min",
    subSkills: [
      "seo-audit",
      "seo-cluster",
      "seo-page",
      "seo-technical",
      "seo-backlinks",
      "seo-local",
      "seo-schema",
      "seo-content",
      "seo-competitor-pages",
      "seo-geo",
    ],
    enabled: true,
  },
  {
    id: "geo-aeo-audit",
    label: "GEO / AEO Audit",
    description: "AI Overview & Answer Engine Optimization",
    longDescription:
      "Analyse der Sichtbarkeit in AI-generierten Suchergebnissen inkl. AI Overview Coverage, Entity-Abdeckung und Citation-Analyse.",
    icon: Sparkles,
    category: "geo",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.green,
    inputs: [
      { id: "url", label: "Website URL", type: "url", required: true },
      {
        id: "queries",
        label: "Target Queries",
        type: "textarea",
        required: true,
        placeholder: "Eine Query pro Zeile",
      },
    ],
    estimatedTime: "3-7 min",
    subSkills: ["seo-geo", "seo-schema", "seo-content"],
    enabled: true,
  },
  {
    id: "technical-audit",
    label: "Technical Audit",
    description: "Core Web Vitals, Crawl, Indexierung",
    longDescription:
      "Technischer SEO Audit: Core Web Vitals (LCP, INP, CLS), Crawlability, Mobile-First, HTTPS und Structured Data.",
    icon: Activity,
    category: "technical",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.blue,
    inputs: [
      { id: "url", label: "Website URL", type: "url", required: true },
      {
        id: "focus",
        label: "Fokus",
        type: "select",
        required: false,
        options: ["Alles", "Core Web Vitals", "Crawlability", "Mobile", "Security"],
      },
    ],
    estimatedTime: "2-5 min",
    subSkills: ["seo-technical", "seo-schema"],
    enabled: true,
  },
  {
    id: "on-page-audit",
    label: "On-Page Analyse",
    description: "Einzelne URL tiefgehend analysieren",
    longDescription:
      "Detaillierte Einzelseiten-Analyse: Title & Meta, Content-Qualität, Headings, interne Links, Bilder, Keyword-Dichte.",
    icon: FileText,
    category: "audit",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.orange,
    inputs: [
      { id: "url", label: "Seiten-URL", type: "url", required: true },
      {
        id: "keyword",
        label: "Haupt-Keyword",
        type: "text",
        required: true,
        placeholder: "z.B. seo agentur zürich",
      },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["seo-page", "seo-content", "seo-images"],
    enabled: true,
  },
  {
    id: "generate-blog",
    label: "Blog Post generieren",
    description: "SEO & GEO optimierter Content",
    longDescription:
      "Erstellt vollständig SEO- und GEO-optimierte Blog-Beiträge mit Keyword-Integration, FAQ, Schema und internen Links.",
    icon: PenTool,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.cyan,
    inputs: [
      {
        id: "topic",
        label: "Thema / Keyword",
        type: "text",
        required: true,
        placeholder: "z.B. lokale SEO Tipps 2026",
      },
      {
        id: "tone",
        label: "Tonalität",
        type: "select",
        required: true,
        options: ["Professionell", "Informativ", "Conversational", "Experten-Blog"],
      },
      {
        id: "length",
        label: "Länge",
        type: "select",
        required: false,
        options: [
          "Kurz (600 Wörter)",
          "Standard (1200 Wörter)",
          "Lang (2500 Wörter)",
          "Pillar (5000 Wörter)",
        ],
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
    ],
    estimatedTime: "2-4 min",
    subSkills: ["blog-write", "blog-schema", "blog-geo", "blog-seo-check"],
    enabled: true,
  },
  {
    id: "obsidian-note",
    label: "Obsidian Note erstellen",
    description: "Audit-Ergebnisse als Obsidian Note",
    longDescription:
      "Konvertiert Inhalte in formatierte Obsidian Notes mit Markdown, Frontmatter, Wikilinks und Tags.",
    icon: Bookmark,
    category: "obsidian",
    repo: "claude-obsidian",
    repoUrl: "https://github.com/AgriciDaniel/claude-obsidian",
    color: C.pink,
    inputs: [
      { id: "title", label: "Notiz-Titel", type: "text", required: true },
      { id: "content", label: "Inhalt", type: "textarea", required: true },
      { id: "tags", label: "Tags", type: "text", required: false, placeholder: "seo, audit" },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["save", "obsidian-markdown"],
    enabled: true,
  },
  {
    id: "canonry",
    label: "Canonry Live Overview",
    description: "AI Citations, Runs, Health & Evidence (read-only)",
    longDescription:
      "Liest den aktuellen Canonry Project-Overview (Runs, Timeline, Health, Keywords, Insights) read-only aus. Startet keinen neuen Sweep — dafür ist die Canonry-Sweep-API erforderlich.",
    icon: Bot,
    category: "geo",
    repo: "canonry",
    repoUrl: "https://github.com/AINYC/canonry",
    color: C.green,
    inputs: [{ id: "domain", label: "Projekt-Domain", type: "url", required: false }],
    estimatedTime: "< 1 min",
    subSkills: ["project-overview", "timeline", "health-snapshot", "insights"],
    enabled: true,
  },
  {
    id: "content-brief",
    label: "Content-Brief",
    description: "SEO-Brief vor dem Schreiben",
    longDescription:
      "Suchintention, primäres + sekundäre Keywords, H2/H3-Gliederung, Entities, interne Links, FAQ und Meta-Vorschläge.",
    icon: FileText,
    category: "content",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.cyan,
    inputs: [
      { id: "topic", label: "Thema / Keyword", type: "text", required: true },
      { id: "audience", label: "Zielgruppe", type: "text", required: false },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["seo-content-brief", "seo-cluster"],
    enabled: true,
  },
  {
    id: "blog-outline",
    label: "Artikel-Outline",
    description: "H2/H3-Struktur mit Stichpunkten",
    longDescription:
      "Detaillierte Gliederung inkl. H1-Vorschlag, Stichpunkten pro Abschnitt und FAQ-Sektion.",
    icon: Layers,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.blue,
    inputs: [
      { id: "topic", label: "Thema", type: "text", required: true },
      {
        id: "keywords",
        label: "Keywords",
        type: "textarea",
        required: false,
        placeholder: "Ein Keyword pro Zeile",
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["blog-outline"],
    enabled: true,
  },
  {
    id: "meta-tags",
    label: "Meta-Tags generieren",
    description: "Title + Description Varianten",
    longDescription:
      "3 Varianten SEO-Title (≤60 Zeichen) und Meta-Description (≤155 Zeichen) plus Open-Graph, mit Zeichenzahl.",
    icon: Sparkles,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.orange,
    inputs: [
      { id: "topic", label: "Thema / Seite", type: "text", required: true },
      { id: "keyword", label: "Haupt-Keyword", type: "text", required: false },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["blog-seo-check"],
    enabled: true,
  },
  {
    id: "schema-markup",
    label: "Schema-Markup",
    description: "Schema.org JSON-LD",
    longDescription:
      "Generiert valides JSON-LD (Article, LocalBusiness, FAQPage, Product, BreadcrumbList).",
    icon: Bot,
    category: "content",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.green,
    inputs: [
      {
        id: "schemaType",
        label: "Schema-Typ",
        type: "select",
        required: true,
        options: ["Article", "LocalBusiness", "FAQPage", "Product", "BreadcrumbList"],
      },
      { id: "content", label: "Angaben / Inhalt", type: "textarea", required: true },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["seo-schema"],
    enabled: true,
  },
  {
    id: "blog-rewrite",
    label: "Blog optimieren",
    description: "Bestehenden Beitrag für Google + AI aufwerten",
    longDescription:
      "Überarbeitet einen bestehenden Blog-Beitrag für Google-Rankings (E-E-A-T) und AI-Citations (GEO/AEO): Answer-First-Struktur, FAQ, Schema, Freshness, interne Links.",
    icon: RefreshCw,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.cyan,
    inputs: [
      { id: "content", label: "Bestehender Inhalt", type: "textarea", required: true, placeholder: "Artikeltext hier einfügen" },
      { id: "keyword", label: "Haupt-Keyword", type: "text", required: false },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "2-5 min",
    subSkills: ["blog-rewrite", "blog-geo", "blog-schema"],
    enabled: true,
  },
  {
    id: "blog-strategy",
    label: "Blog-Strategie",
    description: "Content-Pillars & Themen-Architektur",
    longDescription:
      "Entwickelt eine Blog-Strategie: Topic-Cluster (Hub-and-Spoke), Zielgruppen-Mapping, Wettbewerbsanalyse, AI-Citation-Surfaces und Content-Differenzierung.",
    icon: Target,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.accent,
    inputs: [
      { id: "topic", label: "Thema / Nische", type: "text", required: true, placeholder: "z.B. lokale SEO für KMU" },
      { id: "audience", label: "Zielgruppe", type: "text", required: false },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["blog-strategy", "blog-cluster"],
    enabled: true,
  },
  {
    id: "blog-repurpose",
    label: "Content Repurposing",
    description: "Beitrag → Social, Newsletter, Thread",
    longDescription:
      "Verwandelt einen Blog-Beitrag in plattformgerechte Formate: LinkedIn-Post, X/Twitter-Thread, Newsletter-Auszug, YouTube-Skript, Reddit-Post.",
    icon: Sparkles,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.pink,
    inputs: [
      { id: "content", label: "Beitrag / Inhalt", type: "textarea", required: true, placeholder: "Artikeltext hier einfügen" },
      { id: "platforms", label: "Plattformen", type: "text", required: false, placeholder: "z.B. LinkedIn, X, Newsletter" },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["blog-repurpose"],
    enabled: true,
  },
  {
    id: "competitor-page",
    label: "Vergleichsseite",
    description: "X-vs-Y- und Alternativen-Seite",
    longDescription:
      "Generiert eine SEO-optimierte Vergleichs- oder Alternativen-Seite (X vs Y, Feature-Matrix, Schema) mit Conversion-Fokus.",
    icon: Layers,
    category: "content",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.blue,
    inputs: [
      { id: "own", label: "Eigenes Produkt / Marke", type: "text", required: true },
      { id: "competitor", label: "Wettbewerber", type: "text", required: true },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["seo-competitor-pages", "seo-schema"],
    enabled: true,
  },
  {
    id: "editorial-calendar",
    label: "Redaktionsplan",
    description: "Editorial Calendar mit Clustern",
    longDescription:
      "Erstellt einen Redaktionsplan: Topic-Cluster, Publishing-Schedule, Content-Mix, saisonale Chancen und Freshness-Updates.",
    icon: Calendar,
    category: "content",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.orange,
    inputs: [
      { id: "topic", label: "Thema / Domain", type: "text", required: true },
      { id: "period", label: "Zeitraum", type: "select", required: false, options: ["1 Monat", "1 Quartal"] },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["blog-calendar"],
    enabled: true,
  },
  {
    id: "geo-content-check",
    label: "AI-Citation-Check",
    description: "Content für ChatGPT/Perplexity prüfen",
    longDescription:
      "Bewertet einen Beitrag auf AI-Citation-Readiness (ChatGPT, Perplexity, Google AI Overviews): Passage-Citability, Q&A-Formatierung, Entity-Klarheit, Citation-Capsules.",
    icon: Bot,
    category: "geo",
    repo: "claude-blog",
    repoUrl: "https://github.com/AgriciDaniel/claude-blog",
    color: C.green,
    inputs: [
      { id: "content", label: "Beitrag / Inhalt", type: "textarea", required: true, placeholder: "Artikeltext hier einfügen" },
      { id: "language", label: "Sprache", type: "select", required: true, options: ["Deutsch", "Englisch", "Französisch"] },
    ],
    estimatedTime: "1-3 min",
    subSkills: ["blog-geo"],
    enabled: true,
  },
  {
    id: "cwv-audit",
    label: "Core Web Vitals",
    description: "LCP, INP, CLS via PageSpeed",
    longDescription:
      "Misst Core Web Vitals (LCP, INP, CLS) + Performance-Score via Google PageSpeed Insights (CrUX-Felddaten + Lighthouse-Lab).",
    icon: Activity,
    category: "technical",
    repo: "claude-seo",
    repoUrl: "https://github.com/AgriciDaniel/claude-seo",
    color: C.blue,
    inputs: [
      { id: "strategy", label: "Gerät", type: "select", required: false, options: ["Mobile", "Desktop"] },
    ],
    estimatedTime: "< 1 min",
    subSkills: ["seo-technical"],
    enabled: true,
  },
];

// Generic, data-driven tiles for every installed plugin skill (auto-generated catalog).
// Each runs through the same /api/agent/run bridge with a single free-text input.
const SKILL_CAT_META = {
  "skills-seo": { icon: Layers, color: C.accent },
  "skills-blog": { icon: PenTool, color: C.cyan },
  "skills-ads": { icon: Megaphone, color: C.orange },
  "skills-obsidian": { icon: Bookmark, color: C.pink },
};
const CATALOG_TOOLS = SKILL_CATALOG.map((s) => {
  const meta = SKILL_CAT_META[s.category] || { icon: Zap, color: C.accent };
  return {
    id: s.id,
    label: s.label,
    description: s.description,
    longDescription: s.note ? `${s.description}\n\nHinweis: ${s.note}.` : s.description,
    icon: meta.icon,
    category: s.category,
    repo: s.plugin,
    repoUrl: `https://github.com/AgriciDaniel/${s.plugin}`,
    color: meta.color,
    inputs: [
      {
        id: "prompt",
        label: "Eingabe (URL, Thema oder Inhalt)",
        type: "textarea",
        required: true,
        placeholder: "Beschreibe die Aufgabe, füge eine URL oder Inhalt ein …",
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: false,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
    ],
    estimatedTime: s.note && s.note.includes("langer Lauf") ? "3-10 min" : "1-4 min",
    subSkills: [s.skill],
    enabled: true,
  };
});
const ALL_TOOLS = CURATED_TOOLS.concat(CATALOG_TOOLS);
const TOOL_CATS = [
  { id: "all", label: "Alle", icon: LayoutGrid },
  { id: "audit", label: "Audit", icon: Layers },
  { id: "geo", label: "GEO", icon: Sparkles },
  { id: "content", label: "Content", icon: PenTool },
  { id: "technical", label: "Technical", icon: Activity },
  { id: "obsidian", label: "Obsidian", icon: Bookmark },
  { id: "skills-seo", label: "SEO-Skills", icon: Layers },
  { id: "skills-blog", label: "Blog-Skills", icon: PenTool },
  { id: "skills-ads", label: "Ads-Skills", icon: Megaphone },
  { id: "skills-obsidian", label: "Obsidian-Skills", icon: Bookmark },
];

// ═══════════════════════════════════════════════════════════════════════════
// SHARED CHART COMPONENTS (preserved)
// ═══════════════════════════════════════════════════════════════════════════
function KpiCard({ icon: I, label, value, change, prefix = "", suffix = "", color = C.accent }) {
  const u = change > 0,
    n = change === 0;
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color .2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.borderHover)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
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
              fontSize: 12,
              fontWeight: 600,
              color: n ? C.textMuted : u ? C.green : C.red,
              background: n ? "transparent" : u ? C.greenDim : C.redDim,
              padding: "3px 8px",
              borderRadius: 6,
            }}
          >
            {n ? (
              <Minus size={12} />
            ) : u ? (
              <ArrowUpRight size={12} />
            ) : (
              <ArrowDownRight size={12} />
            )}
            {Math.abs(change)}%
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
      </div>
    </div>
  );
}
function ChartCard({ title, children, action, minH = 280 }) {
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
function CTooltip({ active, payload, label }) {
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
function PBadge({ pos, prev }) {
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
function DTable({ columns, data }) {
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

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARDS (preserved)
// ═══════════════════════════════════════════════════════════════════════════
function AgencyOverview({ clients }) {
  const ac = clients.filter((c) => c.status === "active").length;
  const as = clients.length
    ? Math.round(clients.reduce((s, c) => s + c.score, 0) / clients.length)
    : 0;
  return (
    <div
      className="dash-kpis"
      style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}
    >
      <KpiCard icon={Users} label="Aktive Kunden" value={ac} color={C.accent} />
      <KpiCard icon={Eye} label="Ø Score" value={as} suffix="/100" color={C.blue} />
      <KpiCard
        icon={Bot}
        label="AI Visitors"
        value={clients.reduce((s, c) => s + c.aiVisitors, 0)}
        change={18}
        color={C.green}
      />
      <KpiCard
        icon={DollarSign}
        label="Revenue"
        value={`CHF ${(clients.reduce((s, c) => s + c.revenue, 0) / 1000).toFixed(0)}k`}
        change={14}
        color={C.orange}
      />
    </div>
  );
}
function LiveEmptyState({ title, hint }) {
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
function SeoDashboard({ selectedClient, dateRange }) {
  const { run, refresh: refreshAhrefs } = useEzyLatestRun(selectedClient?.id, "ahrefs");
  const live = run ? ahrefsKpisFromResult(run.result) : null;
  const { runs, refresh: refreshHistory } = useEzyAuditHistory(selectedClient?.id);
  const startDate = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const trend = (runs || [])
    .filter((r) => {
      if (r.audit_type !== "ahrefs" || r.status !== "succeeded") return false;
      const d = new Date(r.started_at || r.created_at);
      return d >= startDate;
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
    .reverse();
  const { run: gscRun, refresh: refreshGsc } = useEzyLatestRun(selectedClient?.id, "gsc_summary");
  const gsc = gscRun ? gscKpisFromResult(gscRun.result) : null;
  const { run: psiRun, refresh: refreshPsi } = useEzyLatestRun(selectedClient?.id, "pagespeed");
  const psi = psiRun ? pagespeedKpisFromResult(psiRun.result) : null;
  useEffect(() => {
    const interval = setInterval(() => {
      refreshAhrefs();
      refreshHistory();
      refreshGsc();
      refreshPsi();
    }, 12 * 60 * 60 * 1000); // 12 Stunden
    return () => clearInterval(interval);
  }, [refreshAhrefs, refreshHistory, refreshGsc, refreshPsi]);
  const { isOn } = useEzyDashboardConfig();
  const traffic = Number(live?.traffic ?? selectedClient?.traffic ?? 0);
  const keywords = Number(live?.keywords ?? selectedClient?.keywords ?? 0);
  const score = Number(live?.score ?? selectedClient?.score ?? 0);
  const visibility = Number(live?.visibility ?? selectedClient?.visibility ?? 0);
  const hasGsc =
    isOn("seo.gsc") && Boolean(gsc && (gsc.clicks > 0 || gsc.impressions > 0));
  const hasCwv =
    isOn("seo.cwv") &&
    Boolean(psi && (psi.lcp != null || psi.cls != null || psi.performanceScore != null));
  const hasAnyKpi = traffic + keywords + score + visibility > 0 || hasGsc || hasCwv;
  if (!hasAnyKpi) {
    return (
      <LiveEmptyState
        title="Noch keine SEO-Daten"
        hint="Verbinde GSC/Ahrefs oder starte einen Audit-Lauf, um Traffic, Visibility, Authority und Keywords live zu sehen."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
          label="Organic Traffic"
          value={traffic > 0 ? traffic : "—"}
          color={C.accent}
        />
        <KpiCard
          icon={Eye}
          label="Visibility Index"
          value={visibility > 0 ? visibility : "—"}
          color={C.blue}
        />
        <KpiCard
          icon={Award}
          label="Authority Score"
          value={score > 0 ? score : "—"}
          color={C.green}
        />
        <KpiCard
          icon={Target}
          label="Organic Keywords"
          value={keywords > 0 ? keywords : "—"}
          color={C.orange}
        />
      </div>
      )}
      {hasGsc && (
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
                <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: C.textDim, textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Query</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Klicks</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Impr.</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>CTR</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gsc.topQueries.slice(0, 15).map((q, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 8px", color: C.text }}>{q.query}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{q.clicks}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{q.impressions}</td>
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
            </div>
          )}
        </>
      )}
      {hasCwv && (
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
              <Line type="monotone" dataKey="Traffic" stroke={C.accent} strokeWidth={2} dot={false} />
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
      ) : (
        <LiveEmptyState
          title="Charts & Tabellen folgen mit Live-Provider-Daten"
          hint="Sobald GSC-Import und Ahrefs-Audit-Läufe Zeitreihen, Top-Keywords und Top-Pages liefern, erscheinen hier die Detail-Charts."
        />
      )}
    </div>
  );
}
function GeoDashboard({ selectedClient, dateRange }) {
  const providerKeys = ["ChatGPT", "Perplexity", "Gemini", "Claude"];
  const { isOn } = useEzyDashboardConfig();
  const live = useLiveIntegrations();
  const overview = useCanonryOverview(selectedClient);
  const liveCanonry = live.data?.canonry;
  useEffect(() => {
    const interval = setInterval(() => {
      live.refresh?.();
      overview.refresh?.();
    }, 12 * 60 * 60 * 1000); // 12 Stunden
    return () => clearInterval(interval);
  }, [live.refresh, overview.refresh]);
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
              background: `linear-gradient(135deg,${C.greenDim},${C.blueDim})`,
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
                <span style={{ color: C.textMuted }}>Letzter Sweep:</span> {canonry.latestRun.time}{" "}
                • {canonry.latestRun.duration}
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
                      border: `1px solid ${C.border}55`,
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
function ConvDashboard({ selectedClient, dateRange }) {
  const { run, refresh: refreshGa4 } = useEzyLatestRun(selectedClient?.id, "ga4_summary");
  const ga4Raw = run ? ga4KpisFromResult(run.result) : null;
  const days = dateRange?.days || 30;
  const ga4 = ga4Raw;
  useEffect(() => {
    const interval = setInterval(() => refreshGa4(), 12 * 60 * 60 * 1000); // 12 Stunden
    return () => clearInterval(interval);
  }, [refreshGa4]);
  const revenue = Number(selectedClient?.revenue || 0);
  const phoneCalls = Number(selectedClient?.phoneCalls || 0);
  const mailClicks = Number(selectedClient?.mailClicks || 0);
  const mapsClicks = Number(selectedClient?.mapsClicks || 0);
  const formSubmits = Number(selectedClient?.formSubmits || 0);
  const sessions = Number(ga4?.sessions || 0);
  const totalUsers = Number(ga4?.totalUsers || 0);
  const engagedSessions = Number(ga4?.engagedSessions || 0);
  const screenPageViews = Number(ga4?.screenPageViews || 0);
  const newUsers = Number(ga4?.newUsers || 0);
  const bounceRate = Number(ga4?.bounceRate || 0);
  const avgSession = Number(ga4?.averageSessionDuration || 0);
  const ga4Conversions = Number(ga4?.conversions || 0);
  const ga4Revenue = Number(ga4?.totalRevenue || 0);
  const ga4SeriesRaw = ga4?.series || [];
  const ga4Series = ga4SeriesRaw.slice(-days);
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
  if (!hasAnyKpi) {
    return (
      <LiveEmptyState
        title="Noch keine Conversion-Daten"
        hint="Sobald GA4 Conversion-Events liefert oder Audit-Läufe Revenue-Daten enthalten, erscheinen hier echte Werte."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
          label="Phone Calls"
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
          label="Form Submits"
          value={formSubmits > 0 ? formSubmits : "—"}
          color={C.orange}
        />
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
            color={C.blue}
          />
          <KpiCard
            icon={Eye}
            label="GA4 Total Users"
            value={totalUsers > 0 ? totalUsers : "—"}
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
            color={C.pink}
          />
          <KpiCard
            icon={DollarSign}
            label="GA4 Revenue"
            value={ga4Revenue > 0 ? `CHF ${Math.round(ga4Revenue).toLocaleString("de-CH")}` : "—"}
            color={C.green}
          />
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
      {isOn("conv.revenue") && revenue > 0 && (
        <div
          style={{
            background: `linear-gradient(135deg,${C.accent}22,${C.green}15)`,
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function AdsDashboard({ selectedClient, dateRange }) {
  const { isOn } = useEzyDashboardConfig();
  const adSpend = Number(selectedClient?.adSpend || 0);
  const adClicks = Number(selectedClient?.adClicks || 0);
  const adImpressions = Number(selectedClient?.adImpressions || 0);
  const adConversions = Number(selectedClient?.adConversions || 0);
  const adCpc = adClicks > 0 ? adSpend / adClicks : 0;
  const adCtr = adImpressions > 0 ? (adClicks / adImpressions) * 100 : 0;
  const adRoas = adSpend > 0 ? (Number(selectedClient?.adRevenue || 0) / adSpend) : 0;
  const adCpa = adConversions > 0 ? adSpend / adConversions : 0;
  const hasAnyKpi = adSpend + adClicks + adImpressions + adConversions > 0;
  if (!hasAnyKpi) {
    return (
      <LiveEmptyState
        title="Noch keine Ads-Daten"
        hint="Sobald Google Ads, Meta Ads oder andere Plattformen verbunden sind, erscheinen hier echte Werte. Nutze die Ads-Skills um Kampagnen zu analysieren."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {isOn("ads.spend") && (
        <div
          style={{
            background: `linear-gradient(135deg,${C.orange}22,${C.accent}15)`,
            border: `1px solid ${C.orange}40`,
            borderRadius: 14,
            padding: "24px 28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Total Ad Spend</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.text }}>
              CHF {adSpend.toLocaleString("de-CH")}
            </div>
          </div>
          {adRoas > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>ROAS</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: adRoas >= 3 ? C.green : adRoas >= 1 ? C.orange : C.red }}>
                {adRoas.toFixed(2)}x
              </div>
            </div>
          )}
        </div>
      )}
      {isOn("ads.kpis") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 14,
          }}
        >
          <KpiCard
            icon={Eye}
            label="Impressions"
            value={adImpressions > 0 ? adImpressions.toLocaleString("de-CH") : "—"}
            color={C.blue}
          />
          <KpiCard
            icon={Target}
            label="Clicks"
            value={adClicks > 0 ? adClicks.toLocaleString("de-CH") : "—"}
            color={C.accent}
          />
          <KpiCard
            icon={Activity}
            label="CTR"
            value={adCtr > 0 ? `${adCtr.toFixed(2)}%` : "—"}
            color={C.green}
          />
          <KpiCard
            icon={DollarSign}
            label="CPC"
            value={adCpc > 0 ? `CHF ${adCpc.toFixed(2)}` : "—"}
            color={C.orange}
          />
          <KpiCard
            icon={CheckCircle}
            label="Conversions"
            value={adConversions > 0 ? adConversions.toLocaleString("de-CH") : "—"}
            color={C.pink}
          />
          <KpiCard
            icon={TrendingUp}
            label="CPA"
            value={adCpa > 0 ? `CHF ${adCpa.toFixed(2)}` : "—"}
            color={C.cyan}
          />
        </div>
      )}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: C.text }}>
          Ads-Skills verfügbar
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
          Nutze die Ads-Skills im Agents-Bereich für tiefgehende Analysen:
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["ads-audit", "ads-google", "ads-meta", "ads-linkedin", "ads-budget", "ads-creative"].map((skill) => (
            <span
              key={skill}
              style={{
                background: `${C.orange}15`,
                border: `1px solid ${C.orange}30`,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                color: C.text,
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RUNNER
// ═══════════════════════════════════════════════════════════════════════════
function ToolRunner({ tool, onClose, client, onComplete }) {
  const toast = useToast();
  const clientDomain = client?.domain || "";
  const [form, setForm] = useState(() => {
    const f = {};
    tool.inputs.forEach((i) => {
      f[i.id] =
        i.type === "url"
          ? clientDomain
            ? `https://${clientDomain}`
            : ""
          : i.id === "language"
            ? "Deutsch"
            : "";
    });
    return f;
  });
  const [phase, setPhase] = useState("form");
  const [result, setResult] = useState(null); // {ok, liveConnected, message, data, error}
  const closedRef = useRef(false);
  useEffect(
    () => () => {
      closedRef.current = true;
    },
    [],
  );
  const handleClose = () => {
    closedRef.current = true;
    onClose?.();
  };
  const run = async () => {
    const m = tool.inputs.filter((i) => i.required && !form[i.id]);
    if (m.length) {
      toast(`"${m[0].label}" ausfüllen`, "error");
      return;
    }
    setPhase("running");
    try {
      const r = await runToolLive(tool.id, client || { id: "", domain: clientDomain }, form);
      if (closedRef.current) return;
      setResult(r);
      setPhase("done");
      if (r.liveConnected && r.ok) {
        toast(`${tool.label} — Live-Lauf abgeschlossen`, "success");
        onComplete?.({ toolId: tool.id, ok: true });
      } else if (!r.liveConnected) {
        toast(`${tool.label}: ${r.message}`, "info");
      } else {
        toast(`${tool.label} fehlgeschlagen: ${r.error || r.message}`, "error");
      }
    } catch (e) {
      if (closedRef.current) return;
      setResult({
        ok: false,
        liveConnected: true,
        message: e?.message || "Fehler",
        error: e?.message,
      });
      setPhase("done");
      toast(`Fehler: ${e?.message || e}`, "error");
    }
  };
  const exportMd = () => {
    const md = `# ${tool.label} Report\n\nDomain: ${form.url || form.domain || clientDomain || "—"}\nDatum: ${new Date().toLocaleDateString("de-CH")}\nStatus: ${result?.liveConnected ? (result.ok ? "Live-Lauf erfolgreich" : "Live-Lauf fehlgeschlagen") : "Noch nicht live verbunden"}\n\n## Antwort\n\n\`\`\`json\n${JSON.stringify(result?.data ?? { message: result?.message }, null, 2)}\n\`\`\`\n`;
    downloadFile(md, "text/markdown", `${tool.id}-report.md`);
    toast("Report exportiert", "success");
  };
  const Icon = tool.icon;
  const liveBadgeColor = !result
    ? C.textDim
    : result.liveConnected
      ? result.ok
        ? C.green
        : C.red
      : C.orange;
  const liveBadgeLabel = !result
    ? ""
    : result.liveConnected
      ? result.ok
        ? "Live ✓"
        : "Live-Fehler"
      : "Noch nicht live verbunden";
  return (
    <Modal open={true} onClose={handleClose} title={tool.label} width={560}>
      {phase === "form" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              marginBottom: 20,
              padding: 14,
              background: C.card,
              borderRadius: 12,
              border: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${tool.color}18`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon size={20} color={tool.color} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                {tool.longDescription}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Badge color={C.textDim}>{tool.repo}</Badge>
                <Badge color={C.textDim}>
                  <Clock size={9} style={{ marginRight: 3 }} />
                  {tool.estimatedTime}
                </Badge>
                {!toolHasLiveProvider(tool.id) && (
                  <Badge color={C.orange}>Noch nicht live verbunden</Badge>
                )}
              </div>
            </div>
          </div>
          {tool.inputs.map((inp) => (
            <Inp
              key={inp.id}
              label={inp.label}
              value={form[inp.id] || ""}
              onChange={(v) => setForm((p) => ({ ...p, [inp.id]: v }))}
              placeholder={inp.placeholder}
              type={inp.type === "url" ? "url" : "text"}
              textarea={inp.type === "textarea"}
              required={inp.required}
              options={inp.options}
            />
          ))}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={handleClose}>
              Abbrechen
            </Btn>
            <Btn icon={Play} onClick={run}>
              Ausführen
            </Btn>
          </div>
        </div>
      )}
      {phase === "running" && (
        <div style={{ textAlign: "center", padding: "30px 10px" }}>
          <RefreshCw
            size={32}
            color={tool.color}
            style={{ animation: "spin 1s linear infinite", marginBottom: 12 }}
          />
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Live-Lauf läuft …</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
            API-Call wird ausgeführt
          </div>
        </div>
      )}
      {phase === "done" && (
        <div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <Badge color={liveBadgeColor}>{liveBadgeLabel}</Badge>
          </div>
          <div
            style={{
              background: C.card,
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {result?.liveConnected
              ? result.ok
                ? typeof result.data === "object"
                  ? JSON.stringify(result.data, null, 2).slice(0, 2000)
                  : String(result.message || "OK")
                : result.error || result.message || "Fehler"
              : "Dieses Tool ist noch nicht an eine Live-API angebunden. Es wurde kein Lauf gespeichert."}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn variant="secondary" icon={Download} onClick={exportMd}>
              Report exportieren
            </Btn>
            <Btn onClick={handleClose}>Schliessen</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TOOLS
// ═══════════════════════════════════════════════════════════════════════════
function ToolsPage({ selectedClient, tools }) {
  const [cat, setCat] = useState("all");
  const [runner, setRunner] = useState(null);
  const {
    runs,
    loading: histLoading,
    refresh: refreshHistory,
  } = useEzyAuditHistory(selectedClient?.id, 25);
  const visibleTools = useMemo(
    () =>
      (cat === "all" ? tools : tools.filter((t) => t.category === cat)).filter((t) => t.enabled),
    [cat, tools],
  );
  const onComplete = () => {
    void refreshHistory();
  };
  // Map provider/audit_type → tool label fallback.
  const auditTypeToToolId = {
    ahrefs: "full-seo-audit",
    geo: "geo-aeo-audit",
    geo_overview: "canonry",
    seo: "open-seo-audit",
  };
  const history = useMemo(
    () =>
      runs.map((r) => {
        const created = r.finished_at || r.started_at || r.created_at;
        const d = new Date(created);
        const inputToolId =
          (r.input && r.input.toolId) || auditTypeToToolId[r.audit_type] || r.audit_type;
        return {
          id: r.id,
          toolId: inputToolId,
          client: selectedClient?.name || "—",
          url: selectedClient?.domain || "—",
          status:
            r.status === "succeeded" ? "completed" : r.status === "failed" ? "failed" : "running",
          score: null,
          time: d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
          dur:
            r.started_at && r.finished_at
              ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))}s`
              : "—",
          date: d.toISOString().slice(0, 10),
          error: r.error,
        };
      }),
    [runs, selectedClient],
  );
  const stIc = { completed: CheckCircle, failed: AlertCircle, running: Clock };
  const stCo = { completed: C.green, failed: C.red, running: C.orange };
  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 170, flexShrink: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: C.textDim,
            textTransform: "uppercase",
            letterSpacing: ".5px",
            marginBottom: 10,
            padding: "0 14px",
          }}
        >
          Kategorien
        </div>
        {TOOL_CATS.map((tc) => {
          const I = tc.icon;
          const a = cat === tc.id;
          const n =
            tc.id === "all"
              ? tools.filter((t) => t.enabled).length
              : tools.filter((t) => t.category === tc.id && t.enabled).length;
          return (
            <button
              key={tc.id}
              onClick={() => setCat(tc.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: a ? C.accentDim : "transparent",
                color: a ? C.accentLight : C.textMuted,
                fontSize: 13,
                fontWeight: a ? 600 : 400,
                marginBottom: 2,
                fontFamily: "inherit",
              }}
            >
              <I size={16} />
              <span style={{ flex: 1, textAlign: "left" }}>{tc.label}</span>
              <span style={{ fontSize: 11, color: C.textDim }}>{n}</span>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Tools</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {visibleTools.length} Tools • {selectedClient.name}
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))",
            gap: 14,
            marginBottom: 28,
          }}
        >
          {visibleTools.map((tool) => {
            const I = tool.icon;
            return (
              <div
                key={tool.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 20,
                  transition: "border-color .2s",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = tool.color)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                onClick={() => setRunner(tool)}
              >
                <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: `${tool.color}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <I size={20} color={tool.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 2 }}>
                      {tool.label}
                    </div>
                    <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>
                      {tool.description}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                  {tool.subSkills.slice(0, 4).map((s) => (
                    <Badge key={s} color={tool.color}>
                      {s}
                    </Badge>
                  ))}
                  {tool.subSkills.length > 4 && (
                    <Badge color={C.textDim}>+{tool.subSkills.length - 4}</Badge>
                  )}
                </div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <Badge color={C.textDim}>
                      <Clock size={9} style={{ marginRight: 3 }} />
                      {tool.estimatedTime}
                    </Badge>
                    <a
                      href={tool.repoUrl}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11,
                        color: C.textDim,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        textDecoration: "none",
                      }}
                    >
                      <ExternalLink size={10} />
                      {tool.repo}
                    </a>
                  </div>
                  <Btn
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRunner(tool);
                    }}
                  >
                    Starten
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
        {/* Run History */}
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px" }}>
          Verlauf <Badge color={C.textDim}>{history.length}</Badge>
        </h2>
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {history.length === 0 && (
            <div style={{ padding: "20px", fontSize: 13, color: C.textMuted, textAlign: "center" }}>
              {histLoading ? "Lade Live-Verlauf …" : "Noch keine Live-Läufe für diesen Kunden."}
            </div>
          )}
          {history.map((h, i) => {
            const SI = stIc[h.status] || Clock;
            return (
              <div
                key={h.id}
                style={{
                  padding: "12px 20px",
                  borderBottom: i < history.length - 1 ? `1px solid ${C.border}` : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <SI size={15} color={stCo[h.status] || C.textMuted} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {tools.find((t) => t.id === h.toolId)?.label || h.toolId}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {h.client} • {h.url} • {h.date} {h.time} • {h.dur}
                  </div>
                  {h.error && (
                    <div style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{h.error}</div>
                  )}
                </div>
                {h.score != null && (
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: h.score >= 80 ? C.green : h.score >= 60 ? C.orange : C.red,
                    }}
                  >
                    {h.score}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {runner && (
        <ToolRunner
          tool={runner}
          onClose={() => setRunner(null)}
          client={selectedClient}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: CONTENT (with Editor split-view)
// ═══════════════════════════════════════════════════════════════════════════
// Content Editor (split-view)
function ContentEditor({ item, stCo, stLb, onBack, onSave }) {
  const toast = useToast();
  const [md, setMd] = useState(item.content);
  const renderMd = (s) =>
    escapeHtml(s)
      .replace(
        /^### (.+)$/gm,
        '<h3 style="color:' + C.text + ';font-size:15px;margin:16px 0 8px">$1</h3>',
      )
      .replace(
        /^## (.+)$/gm,
        '<h2 style="color:' + C.text + ';font-size:17px;margin:20px 0 8px">$1</h2>',
      )
      .replace(
        /^# (.+)$/gm,
        '<h1 style="color:' + C.text + ';font-size:20px;margin:24px 0 10px">$1</h1>',
      )
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + C.text + '">$1</strong>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(
        /`(.+?)`/g,
        '<code style="background:' +
          C.card +
          ";border:1px solid " +
          C.border +
          ";border-radius:5px;padding:1px 6px;color:" +
          C.accentLight +
          '">$1</code>',
      )
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, label, href) =>
          `<a href="${sanitizeHref(href)}" target="_blank" rel="noopener noreferrer" style="color:${C.accentLight};text-decoration:underline">${label}</a>`,
      )
      .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
      .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">$&</div>')
      .replace(
        /\[\[(.+?)\]\]/g,
        '<span style="color:' + C.accent + ';text-decoration:underline">$1</span>',
      )
      .replace(/✅/g, '<span style="color:' + C.green + '">✅</span>')
      .replace(/⚠️/g, '<span style="color:' + C.orange + '">⚠️</span>')
      .replace(/\n/g, "<br/>");
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 140px)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: C.textMuted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            <ChevronLeft size={14} />
            Zurück
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{item.title}</span>
          <Badge color={stCo[item.status]}>{stLb[item.status]}</Badge>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            variant="secondary"
            size="sm"
            icon={Copy}
            onClick={() => {
              navigator.clipboard?.writeText(md);
              toast("Kopiert", "success");
            }}
          >
            Copy
          </Btn>
          <Btn
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={() => downloadFile(md, "text/markdown", `${item.title}.md`)}
          >
            Download
          </Btn>
          <Btn size="sm" icon={Save} onClick={() => onSave(item.id, md)}>
            Speichern
          </Btn>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "6px 8px",
          background: C.card,
          borderRadius: "10px 10px 0 0",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
        }}
      >
        {[
          [Bold, "**text**"],
          [Italic, "*text*"],
          [Heading2, "\n## "],
          [Heading3, "\n### "],
          [Link2, "[text](url)"],
          [Code, "`code`"],
        ].map(([Ic, txt], i) => (
          <button
            key={i}
            onClick={() => setMd((p) => p + txt)}
            style={{
              background: "none",
              border: "none",
              padding: 6,
              borderRadius: 6,
              cursor: "pointer",
              color: C.textMuted,
              display: "flex",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <Ic size={14} />
          </button>
        ))}
      </div>
      <div
        className="split-pane"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          flex: 1,
          border: `1px solid ${C.border}`,
          borderRadius: "0 0 10px 10px",
          overflow: "hidden",
        }}
      >
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          style={{
            background: C.bg,
            color: C.text,
            border: "none",
            borderRight: `1px solid ${C.border}`,
            padding: 16,
            fontSize: 13,
            fontFamily: "'JetBrains Mono',monospace",
            lineHeight: 1.7,
            resize: "none",
            outline: "none",
          }}
        />
        <div
          style={{
            background: C.surface,
            padding: 16,
            fontSize: 13,
            lineHeight: 1.7,
            color: C.textMuted,
            overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: renderMd(md) }}
        />
      </div>
    </div>
  );
}
function ContentPage({ clients, items, onSaveContent }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const typeIc = { blog: PenTool, audit: Layers, note: Bookmark, report: FileText };
  const typeCo = { blog: C.cyan, audit: C.accent, note: C.pink, report: C.blue };
  const stCo = { draft: C.textMuted, published: C.green, archived: C.textDim };
  const stLb = { draft: "Entwurf", published: "Publiziert", archived: "Archiviert" };
  const filtered = items.filter(
    (it) =>
      (filter === "all" || it.type === filter) &&
      it.title.toLowerCase().includes(search.toLowerCase()),
  );
  const saveContent = async (id, content) => {
    try {
      await onSaveContent(id, content);
      toast("Inhalt gespeichert", "success");
    } catch (e) {
      toast(e?.message || "Speichern fehlgeschlagen", "error");
    }
  };

  if (editing) {
    const it = items.find((i) => i.id === editing);
    if (!it) return null;
    return (
      <ContentEditor
        item={it}
        stCo={stCo}
        stLb={stLb}
        onBack={() => setEditing(null)}
        onSave={(id, md) => {
          saveContent(id, md);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Content</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {items.length} Inhalte
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ position: "relative", width: 280 }}>
          <Search
            size={15}
            color={C.textDim}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen..."
            style={{
              width: "100%",
              padding: "9px 12px 9px 36px",
              borderRadius: 10,
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
        <TabBar
          tabs={[
            { id: "all", label: "Alle" },
            { id: "blog", label: "Blog" },
            { id: "audit", label: "Audit" },
            { id: "note", label: "Notes" },
          ]}
          active={filter}
          onChange={setFilter}
        />
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <FileText size={32} color={C.textDim} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Noch kein Content</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              Starte ein Tool, um Content zu generieren.
            </div>
          </div>
        ) : (
          filtered.map((it, i) => {
            const TI = typeIc[it.type] || FileText;
            const cl = clients.find((c) => c.id === it.clientId);
            return (
              <div
                key={it.id}
                onClick={() => setEditing(it.id)}
                style={{
                  padding: "14px 20px",
                  borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `${typeCo[it.type]}18`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <TI size={16} color={typeCo[it.type]} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{it.title}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {cl?.name || "—"} • {it.wordCount} Wörter • {it.updatedAt}
                  </div>
                </div>
                <Badge color={typeCo[it.type]}>{it.type}</Badge>
                <Badge color={stCo[it.status]}>{stLb[it.status]}</Badge>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: CLIENTS
// ═══════════════════════════════════════════════════════════════════════════
function OnboardingCard({ client, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(client?.id || ""),
  );
  const steps = [
    { ok: !!client?.domain, label: "Domain hinterlegt", hint: "Basis für Ahrefs & Core Web Vitals" },
    {
      ok: !!client?.canonryProject,
      label: "Canonry-Projekt (GEO)",
      hint: "AI-Sichtbarkeit ChatGPT/Perplexity/…",
      action: "canonry",
    },
    {
      ok: !!client?.gscSiteUrl,
      label: "Search Console verbunden",
      hint: "Klicks, Impressionen, Position",
    },
    { ok: !!client?.ga4PropertyId, label: "GA4 verbunden", hint: "Sessions, Conversions, Revenue" },
  ];
  const done = steps.filter((s) => s.ok).length;
  const createCanonry = async () => {
    if (!isUuid) return toast("Kunde noch nicht gespeichert", "error");
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch("/api/canonry/create-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clientId: client.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        toast(`Canonry-Projekt „${j.slug}" ${j.created ? "angelegt" : "aktualisiert"}`, "success");
        onUpdated?.();
      } else toast(j.error || "Canonry-Anlage fehlgeschlagen", "error");
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${done === steps.length ? C.green + "55" : C.border}`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 16,
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
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Onboarding / Verbindungen</div>
        <div style={{ fontSize: 12, color: done === steps.length ? C.green : C.textMuted }}>
          {done}/{steps.length} eingerichtet
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: s.ok ? C.green : C.textDim, flexShrink: 0 }}>
                {s.ok ? <Check size={16} /> : <Clock size={16} />}
              </span>
              <div>
                <div style={{ fontSize: 13, color: C.text }}>{s.label}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{s.hint}</div>
              </div>
            </div>
            {s.action === "canonry" && !s.ok && (
              <button
                onClick={createCanonry}
                disabled={busy}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: C.accent,
                  color: "#fff",
                  cursor: busy ? "default" : "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {busy ? "…" : "Automatisch anlegen"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
          Google: Search Console &amp; GA4 verbinden
        </div>
        <GoogleClientPanel client={client} onSaved={onUpdated} />
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginTop: 10 }}>
        Semrush ist aktuell nicht verfügbar (API-Units fehlen).
      </div>
    </div>
  );
}

function ClientsPage({
  clients,
  selectedClientId,
  onSelectClient,
  onUpsertClient,
  onDeleteClient,
  onReload,
  customerDefaults = DEFAULT_CUSTOMER_DEFAULTS,
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [sf, setSf] = useState("all");
  const [detailId, setDetailId] = useState(null);
  const [dt, setDt] = useState("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [draft, setDraft] = useState(clientFormFromClient());
  const detail = clients.find((c) => c.id === detailId) || null;
  const effectiveDefaults = defaultsFromStored(customerDefaults);
  useEffect(() => {
    if (detailId && !clients.some((c) => c.id === detailId)) setDetailId(null);
  }, [clients, detailId]);
  const fl = clients.filter(
    (c) =>
      (sf === "all" || c.status === sf) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) || c.domain.includes(search)),
  );
  const openCreate = () => {
    setEditorMode("create");
    setDraft(clientFormFromClient());
    setEditorOpen(true);
  };
  const openEdit = (client) => {
    setEditorMode("edit");
    setDraft(clientFormFromClient(client));
    setEditorOpen(true);
  };
  const saveClient = () => {
    if (!draft.name.trim() || !draft.domain.trim()) {
      toast("Name und Domain sind erforderlich", "error");
      return;
    }
    const existing = editorMode === "edit" && detail ? detail : null;
    const next = normalizeClientShape({
      ...existing,
      defaults: existing?.defaults || effectiveDefaults,
      name: draft.name,
      domain: draft.domain,
      industry: draft.industry,
      status: draft.status,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      monthlyBudget: Number(draft.monthlyBudget || 0),
      tags: splitCsv(draft.tags),
      targetLocations: splitCsv(draft.targetLocations),
      notes: draft.notes,
      gscSiteUrl: draft.gscSiteUrl,
      ga4PropertyId: draft.ga4PropertyId,
      ga4MeasurementId: draft.ga4MeasurementId,
      canonryProject: draft.canonryProject || slugifyProjectName(draft.domain),
    });
    onUpsertClient(next);
    onSelectClient?.(next);
    setDetailId(next.id);
    setDt("overview");
    setEditorOpen(false);
    toast(editorMode === "create" ? "Kunde erstellt" : "Kunde gespeichert", "success");
  };
  const removeClient = () => {
    if (!detail) return;
    if (clients.length <= 1) {
      toast("Mindestens ein Kunde muss bestehen bleiben", "error");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Kunde "${detail.name}" wirklich löschen?`)
    )
      return;
    onDeleteClient(detail.id);
    setDetailId(null);
    toast("Kunde entfernt", "success");
  };
  const detailDefaults = defaultsFromStored(detail?.defaults ?? effectiveDefaults);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Clients</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {clients.length} Kunden
          </p>
        </div>
        <Btn icon={Plus} onClick={openCreate}>
          Neuer Kunde
        </Btn>
      </div>
      <div className="client-toolbar" style={{ display: "flex", gap: 12 }}>
        <div style={{ position: "relative", width: 280 }}>
          <Search
            size={15}
            color={C.textDim}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen..."
            style={{
              width: "100%",
              padding: "9px 12px 9px 36px",
              borderRadius: 10,
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
        <TabBar
          tabs={[
            { id: "all", label: "Alle" },
            { id: "active", label: "Aktiv" },
            { id: "paused", label: "Pausiert" },
          ]}
          active={sf}
          onChange={setSf}
        />
      </div>
      <div
        className="client-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        {fl.map((c) => (
          <div
            key={c.id}
            onClick={() => {
              setDetailId(c.id);
              setDt("overview");
            }}
            style={{
              background: C.card,
              border: `1px solid ${c.id === selectedClientId ? C.accent : C.border}`,
              borderRadius: 14,
              padding: "20px 22px",
              cursor: "pointer",
              transition: "border-color .2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.borderHover)}
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = c.id === selectedClientId ? C.accent : C.border)
            }
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    background: C.accentDim,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 800,
                    color: C.accentLight,
                  }}
                >
                  {initialsFromName(c.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{c.domain}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {c.id === selectedClientId && <Badge color={C.accent}>Aktiv</Badge>}
                <Badge color={c.status === "active" ? C.green : C.textMuted}>
                  {c.status === "active" ? "Aktiv" : "Pausiert"}
                </Badge>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
              <Badge color={C.textDim}>{c.industry || "—"}</Badge>
              {c.tags.map((t) => (
                <Badge key={t} color={C.blue}>
                  {t}
                </Badge>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                [c.score, c.score >= 70 ? C.green : C.orange, "Score"],
                [c.keywords.toLocaleString("de-CH"), C.text, "Keywords"],
                [`CHF ${(c.monthlyBudget / 1000).toFixed(1)}k`, C.text, "Budget"],
              ].map(([v, co, l], i) => (
                <div
                  key={i}
                  style={{
                    background: C.surface,
                    borderRadius: 8,
                    padding: "8px 10px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 700, color: co }}>{v}</div>
                  <div style={{ fontSize: 9, color: C.textMuted }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {detail && (
        <div
          className="client-drawer"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(480px,100vw)",
            background: C.surface,
            borderLeft: `1px solid ${C.border}`,
            zIndex: 100,
            overflowY: "auto",
            animation: "slideIn .2s ease",
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
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: C.accentDim,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 800,
                  color: C.accentLight,
                }}
              >
                {initialsFromName(detail.name)}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: C.text }}>{detail.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{detail.domain}</div>
              </div>
            </div>
            <button
              onClick={() => setDetailId(null)}
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
          <div
            style={{
              padding: "14px 22px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <TabBar
              tabs={[
                { id: "overview", label: "Übersicht" },
                { id: "kpis", label: "KPIs" },
                { id: "notes", label: "Notizen" },
              ]}
              active={dt}
              onChange={setDt}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => onSelectClient?.(detail)}>
                Als aktiven Kunden wählen
              </Btn>
              <Btn variant="secondary" size="sm" icon={PenTool} onClick={() => openEdit(detail)}>
                Bearbeiten
              </Btn>
              <Btn variant="danger" size="sm" icon={X} onClick={removeClient}>
                Löschen
              </Btn>
            </div>
          </div>
          <div style={{ padding: "18px 22px" }}>
            <OnboardingCard client={detail} onUpdated={onReload} />
            {dt === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Branche", detail.industry || "—"],
                  ["Status", detail.status],
                  ["E-Mail", detail.contactEmail || "—"],
                  ["Telefon", detail.contactPhone || "—"],
                  ["Budget", `CHF ${detail.monthlyBudget.toLocaleString("de-CH")}/Mt`],
                  ["Standorte", detail.targetLocations?.join(", ") || "—"],
                  ["Report-Sprache", detailDefaults.language],
                  ["Tonalität", detailDefaults.tone],
                  ["Report-Template", detailDefaults.reportTemplate],
                  ["GSC Property", detail.gscSiteUrl || "—"],
                  ["GA4 Property", ga4PropertyText(detail)],
                  detail.ga4MeasurementId ? ["GA4 Measurement ID", detail.ga4MeasurementId] : null,
                  ["Canonry Projekt", detail.canonryProject || "—"],
                  ["Start", detail.startDate || "—"],
                ]
                  .filter(Boolean)
                  .map(([l, v]) => (
                    <div
                      key={l}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 0",
                        borderBottom: `1px solid ${C.border}08`,
                      }}
                    >
                      <span style={{ fontSize: 12, color: C.textMuted }}>{l}</span>
                      <span
                        style={{
                          fontSize: 13,
                          color: C.text,
                          fontWeight: 500,
                          textAlign: "right",
                          wordBreak: "break-word",
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Tags</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {detail.tags.length ? (
                      detail.tags.map((t) => (
                        <Badge key={t} color={C.blue}>
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <Badge color={C.textDim}>Keine Tags</Badge>
                    )}
                  </div>
                </div>
              </div>
            )}
            {dt === "kpis" &&
              (() => {
                const hasData =
                  (detail.score || 0) +
                    (detail.keywords || 0) +
                    (detail.traffic || 0) +
                    (detail.aiVisitors || 0) +
                    (detail.revenue || 0) >
                  0;
                if (!hasData) {
                  return (
                    <div
                      style={{
                        background: C.card,
                        borderRadius: 10,
                        padding: 20,
                        textAlign: "center",
                        fontSize: 13,
                        color: C.textMuted,
                      }}
                    >
                      Noch keine Live-Daten — verbinde GSC/GA4 oder starte einen Audit-Lauf.
                    </div>
                  );
                }
                return (
                  <div
                    className="kpi-grid"
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
                  >
                    {[
                      [detail.score, detail.score >= 70 ? C.green : C.orange, "SEO Score"],
                      [detail.keywords.toLocaleString("de-CH"), C.text, "Keywords"],
                      [detail.traffic.toLocaleString("de-CH"), C.accent, "Traffic"],
                      [detail.aiVisitors.toLocaleString("de-CH"), C.green, "AI Visitors"],
                    ].map(([v, co, l], i) => (
                      <div
                        key={i}
                        style={{
                          background: C.card,
                          borderRadius: 10,
                          padding: 14,
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 24, fontWeight: 800, color: co }}>{v}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>{l}</div>
                      </div>
                    ))}
                    <div
                      style={{
                        background: C.card,
                        borderRadius: 10,
                        padding: 14,
                        textAlign: "center",
                        gridColumn: "1/3",
                      }}
                    >
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>
                        CHF {detail.revenue.toLocaleString("de-CH")}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>Revenue (30d)</div>
                    </div>
                  </div>
                );
              })()}
            {dt === "notes" && (
              <div
                style={{
                  background: C.card,
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 13,
                  color: C.text,
                  lineHeight: 1.6,
                }}
              >
                {detail.notes || "Noch keine Notizen hinterlegt."}
              </div>
            )}
          </div>
        </div>
      )}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editorMode === "create" ? "Neuen Kunden anlegen" : "Kunden bearbeiten"}
        width={620}
      >
        <div
          className="ezy-form-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <Inp
            label="Name"
            value={draft.name}
            onChange={(v) => setDraft((p) => ({ ...p, name: v }))}
            required
          />
          <Inp
            label="Domain"
            value={draft.domain}
            onChange={(v) => setDraft((p) => ({ ...p, domain: v }))}
            placeholder="example.com"
            required
          />
          <Inp
            label="Branche"
            value={draft.industry}
            onChange={(v) => setDraft((p) => ({ ...p, industry: v }))}
          />
          <Inp
            label="Status"
            value={draft.status}
            onChange={(v) => setDraft((p) => ({ ...p, status: v }))}
            options={["active", "paused"]}
          />
          <Inp
            label="E-Mail"
            value={draft.contactEmail}
            onChange={(v) => setDraft((p) => ({ ...p, contactEmail: v }))}
          />
          <Inp
            label="Telefon"
            value={draft.contactPhone}
            onChange={(v) => setDraft((p) => ({ ...p, contactPhone: v }))}
          />
          <Inp
            label="Monatsbudget (CHF)"
            value={draft.monthlyBudget}
            onChange={(v) => setDraft((p) => ({ ...p, monthlyBudget: v }))}
            type="number"
          />
          <Inp
            label="Canonry Projekt"
            value={draft.canonryProject}
            onChange={(v) => setDraft((p) => ({ ...p, canonryProject: v }))}
            placeholder="wird aus Domain abgeleitet"
          />
          <Inp
            label="Tags"
            value={draft.tags}
            onChange={(v) => setDraft((p) => ({ ...p, tags: v }))}
            placeholder="SEO, GEO, Content"
          />
          <Inp
            label="Standorte"
            value={draft.targetLocations}
            onChange={(v) => setDraft((p) => ({ ...p, targetLocations: v }))}
            placeholder="Schweiz, Zürich"
          />
          <Inp
            label="GSC Property"
            value={draft.gscSiteUrl}
            onChange={(v) => setDraft((p) => ({ ...p, gscSiteUrl: v }))}
            placeholder="sc-domain:example.com"
          />
          <Inp
            label="GA4 Property ID"
            value={draft.ga4PropertyId}
            onChange={(v) => setDraft((p) => ({ ...p, ga4PropertyId: v }))}
          />
        </div>
        <Inp
          label="GA4 Measurement ID"
          value={draft.ga4MeasurementId}
          onChange={(v) => setDraft((p) => ({ ...p, ga4MeasurementId: v }))}
        />
        <Inp
          label="Notizen"
          value={draft.notes}
          onChange={(v) => setDraft((p) => ({ ...p, notes: v }))}
          textarea
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
          <Btn variant="secondary" onClick={() => setEditorOpen(false)}>
            Abbrechen
          </Btn>
          <Btn icon={Save} onClick={saveClient}>
            {editorMode === "create" ? "Kunden anlegen" : "Änderungen speichern"}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS (5 tabs)
// ═══════════════════════════════════════════════════════════════════════════
function SettingsPage({
  tools,
  onToggleTool,
  selectedClient,
  profile,
  onSaveProfile,
  customerDefaults,
  onSaveDefaults,
  onClientUpdated,
}) {
  const toast = useToast();
  const [sec, setSec] = useState("profil");
  const [profileDraft, setProfileDraft] = useState(profile);
  const [defaultsDraft, setDefaultsDraft] = useState(defaultsFromStored(customerDefaults));
  const live = useLiveIntegrations();
  const dash = useEzyDashboardConfig();
  useEffect(() => setProfileDraft(profile), [profile]);
  useEffect(() => setDefaultsDraft(defaultsFromStored(customerDefaults)), [customerDefaults]);
  const sects = [
    ["profil", "Profil", Users],
    ["defaults", "Kunden-Einstellungen", Settings],
    ["api", "API-Schlüssel", Key],
    ["skills", "Skills / Tools", Zap],
    ["dashboard", "Dashboard-Metriken", BarChart3],
    ["about", "Über EZY ONE", Info],
  ];
  const providerRows = [
    ["Gemini", live.data?.providers?.gemini, C.green, Bot],
    ["OpenAI", live.data?.providers?.openai, C.blue, Bot],
    ["Anthropic", live.data?.providers?.anthropic, C.pink, Bot],
    ["Perplexity", live.data?.providers?.perplexity, C.orange, Sparkles],
    ["Ahrefs", live.data?.providers?.ahrefs, C.green, Link2],
    ["Moz", null, C.textMuted, Database],
  ];
  const googleRows = [
    ["Google Search Console", live.data?.google?.searchConsole, Globe],
    ["Google Analytics 4", live.data?.google?.analytics, BarChart3],
  ];
  return (
    <div className="settings-shell" style={{ display: "flex", gap: 24 }}>
      <div className="settings-nav" style={{ width: 200, flexShrink: 0 }}>
        {sects.map(([id, l, I]) => (
          <button
            key={id}
            onClick={() => setSec(id)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: sec === id ? C.accentDim : "transparent",
              color: sec === id ? C.accentLight : C.textMuted,
              fontSize: 13,
              fontWeight: sec === id ? 600 : 400,
              marginBottom: 2,
              fontFamily: "inherit",
            }}
          >
            <I size={16} />
            {l}
          </button>
        ))}
      </div>
      <div className="settings-panel" style={{ flex: 1, maxWidth: 640 }}>
        {sec === "profil" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Profil</h2>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: C.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  {initialsFromName(profileDraft.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>
                    {profileDraft.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{profileDraft.role}</div>
                </div>
              </div>
              <Inp
                label="Name"
                value={profileDraft.name}
                onChange={(v) => setProfileDraft((p) => ({ ...p, name: v }))}
              />
              <Inp
                label="E-Mail"
                value={profileDraft.email}
                onChange={(v) => setProfileDraft((p) => ({ ...p, email: v }))}
              />
              <Inp
                label="Rolle"
                value={profileDraft.role}
                onChange={(v) => setProfileDraft((p) => ({ ...p, role: v }))}
              />
              <Inp
                label="Sprache"
                value={profileDraft.language}
                onChange={(v) => setProfileDraft((p) => ({ ...p, language: v }))}
                options={["Deutsch", "Englisch"]}
              />
              <Btn
                icon={Save}
                onClick={() => {
                  onSaveProfile(profileDraft);
                  toast("Profil gespeichert", "success");
                }}
              >
                Speichern
              </Btn>
            </div>
          </div>
        )}

        {sec === "defaults" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>
              Einstellungen{selectedClient?.name ? ` — ${selectedClient.name}` : ""}
            </h2>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
              Diese Einstellungen gelten nur für diesen Kunden. Wechsle den Kunden, um dessen Einstellungen zu bearbeiten.
            </div>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <Inp
                label="Standard-Sprache"
                value={defaultsDraft.language}
                onChange={(v) => setDefaultsDraft((p) => ({ ...p, language: v }))}
                options={["Deutsch", "Englisch", "Französisch"]}
              />
              <Inp
                label="Standard-Tonalität"
                value={defaultsDraft.tone}
                onChange={(v) => setDefaultsDraft((p) => ({ ...p, tone: v }))}
                options={["Professionell", "Informativ", "Conversational"]}
              />
              <Inp
                label="Report-Template"
                value={defaultsDraft.reportTemplate}
                onChange={(v) => setDefaultsDraft((p) => ({ ...p, reportTemplate: v }))}
                options={["Standard", "Detailliert", "Executive Summary"]}
              />
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Sichtbare Dashboard-Tabs</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {[
                    { id: "seo", label: "SEO", icon: Globe },
                    { id: "geo", label: "GEO", icon: Sparkles },
                    { id: "conversions", label: "Conversions", icon: DollarSign },
                    { id: "ads", label: "Ads", icon: Megaphone },
                  ].map((t) => {
                    const on = (defaultsDraft.visibleTabs || ["seo", "geo", "conversions", "ads"]).includes(t.id);
                    return (
                      <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const cur = defaultsDraft.visibleTabs || ["seo", "geo", "conversions", "ads"];
                            const next = on ? cur.filter((x) => x !== t.id) : [...cur, t.id];
                            setDefaultsDraft((p) => ({ ...p, visibleTabs: next.length > 0 ? next : [t.id] }));
                          }}
                          style={{ accentColor: C.accent }}
                        />
                        <t.icon size={14} style={{ color: C.textMuted }} />
                        <span style={{ fontSize: 13, color: C.text }}>{t.label}</span>
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  Nur ausgewählte Tabs werden im Dashboard angezeigt.
                </div>
              </div>
              <Btn
                icon={Save}
                style={{ marginTop: 16 }}
                onClick={() => {
                  onSaveDefaults(defaultsDraft);
                  toast("Einstellungen für " + (selectedClient?.name || "Kunde") + " gespeichert", "success");
                }}
              >
                Speichern
              </Btn>
            </div>
          </div>
        )}

        {sec === "api" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>API-Schlüssel</h2>
            <div
              style={{
                background: C.blueDim,
                border: `1px solid ${C.blue}30`,
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 16,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Info size={16} color={C.blue} />
              <span style={{ fontSize: 12, color: C.text }}>
                Secrets liegen jetzt serverseitig in einer lokalen Env-Datei. Nichts davon wird ins
                Frontend-Bundle geschrieben.
              </span>
            </div>
            {live.loading && (
              <div
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 18,
                  marginBottom: 14,
                }}
              >
                <Skeleton w="38%" h={14} />
                <div style={{ marginTop: 12 }}>
                  <Skeleton w="100%" h={12} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Skeleton w="86%" h={12} />
                </div>
              </div>
            )}
            {!live.loading && live.error && (
              <div
                style={{
                  background: C.redDim,
                  border: `1px solid ${C.red}35`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginBottom: 14,
                  fontSize: 13,
                  color: C.text,
                }}
              >
                Live-Prüfung fehlgeschlagen:{" "}
                <span style={{ color: C.textMuted }}>{live.error}</span>
              </div>
            )}
            {!live.loading && !live.error && (
              <>
                <div
                  style={{
                    background: `linear-gradient(135deg,${live.data?.canonry?.configured && live.data?.canonry?.reachable && live.data?.canonry?.authenticated ? C.greenDim : C.orangeDim},${C.blueDim})`,
                    border: `1px solid ${live.data?.canonry?.configured && live.data?.canonry?.reachable && live.data?.canonry?.authenticated ? C.green : C.orange}35`,
                    borderRadius: 12,
                    padding: "16px 18px",
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                      Canonry Service
                    </div>
                    <Badge
                      color={
                        live.data?.canonry?.configured &&
                        live.data?.canonry?.reachable &&
                        live.data?.canonry?.authenticated
                          ? C.green
                          : C.orange
                      }
                    >
                      {live.data?.canonry?.configured &&
                      live.data?.canonry?.reachable &&
                      live.data?.canonry?.authenticated
                        ? "Live"
                        : "Fehlt noch"}
                    </Badge>
                  </div>
                  <div
                    style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, marginBottom: 10 }}
                  >
                    {live.data?.canonry?.detail || "Canonry-Status unbekannt"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(live.data?.canonry?.missing || []).length
                      ? live.data.canonry.missing.map((bit) => (
                          <Badge key={bit} color={C.orange}>
                            {bit}
                          </Badge>
                        ))
                      : CANONRY_SERVICE.providers.map((p) => (
                          <Badge key={p} color={C.green}>
                            {p}
                          </Badge>
                        ))}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    OpenAPI: {CANONRY_SERVICE.openApi} • letzter Check:{" "}
                    {live.data?.checkedAt
                      ? new Date(live.data.checkedAt).toLocaleString("de-CH")
                      : "—"}
                  </div>
                </div>
                {providerRows.map(([n, status, co, I]) => (
                  <div
                    key={n}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "14px 20px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: `${co}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <I size={18} color={co} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{n}</div>
                      <div style={{ fontSize: 12, color: C.textMuted }}>
                        {status?.detail || "Nicht konfiguriert"}
                      </div>
                      {status?.error && (
                        <div style={{ fontSize: 11, color: C.orange, marginTop: 4 }}>
                          {status.error}
                        </div>
                      )}
                    </div>
                    <Badge
                      color={
                        status?.verified ? C.green : status?.configured ? C.orange : C.textMuted
                      }
                    >
                      {status?.verified
                        ? "Verifiziert"
                        : status?.configured
                          ? "Konfiguriert"
                          : "Inaktiv"}
                    </Badge>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 18,
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Google Integrationen
                </div>
                {googleRows.map(([n, status, I]) => (
                  <div
                    key={n}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "14px 20px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: `${C.blue}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <I size={18} color={C.blue} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{n}</div>
                      <div style={{ fontSize: 12, color: C.textMuted }}>
                        {status?.detail || "Noch nicht geprüft"}
                      </div>
                      {status?.missing?.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {status.missing.map((bit) => (
                            <Badge
                              key={`${n}-${bit}`}
                              color={status.apiKeyOnly ? C.orange : C.textDim}
                            >
                              {bit}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Badge
                      color={
                        status?.configured ? C.green : status?.apiKeyOnly ? C.orange : C.textMuted
                      }
                    >
                      {status?.configured
                        ? "OAuth bereit"
                        : status?.apiKeyOnly
                          ? "API-Key only"
                          : "Fehlt"}
                    </Badge>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 18,
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Aktiver Kunde
                </div>
                <div
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "14px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                    {selectedClient.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>GSC Property</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {selectedClient.gscSiteUrl}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>GA4 Property</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {ga4PropertyText(selectedClient)}
                    </span>
                  </div>
                  {selectedClient.ga4MeasurementId && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: C.textMuted }}>GA4 Measurement ID</span>
                      <span style={{ color: C.text, fontWeight: 500 }}>
                        {selectedClient.ga4MeasurementId}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>Canonry Projekt</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {selectedClient.canonryProject}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>
                  Google verbinden &amp; Verbindungen verwalten: im{" "}
                  <strong style={{ color: C.textMuted }}>Kunden-Detail → Onboarding-Karte</strong>.
                </div>
              </>
            )}
          </div>
        )}

        {sec === "skills" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Skills / Tools</h2>
            <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px" }}>
              Tools ein-/ausschalten
            </p>
            {tools.map((t) => (
              <div
                key={t.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.label}</span>
                <button
                  onClick={() => onToggleTool(t.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: t.enabled ? C.green : C.textDim,
                  }}
                >
                  {t.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                </button>
              </div>
            ))}
          </div>
        )}

        {sec === "dashboard" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Dashboard-Metriken</h2>
            <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px" }}>
              Lege fest, welche Kennzahlen in den Dashboards erscheinen. Standard: alles an —
              schalte einfach ab, was du nicht brauchst. Gilt für die ganze Organisation (nur Admins).
            </p>
            {[
              [
                "SEO",
                [
                  ["seo.ahrefs", "Ahrefs-KPIs (Traffic, Visibility, Authority, Keywords)"],
                  ["seo.gsc", "Search Console (Klicks, Impressionen, CTR, Position, Top-Queries)"],
                  ["seo.cwv", "Core Web Vitals (LCP, INP, CLS, Performance)"],
                  ["seo.trend", "SEO-Trend-Chart"],
                ],
              ],
              [
                "Conversion",
                [
                  ["conv.custom", "Conversion-Aktionen (Calls, Mail, Maps, Forms)"],
                  ["conv.ga4", "GA4-KPIs (Sessions, Users, Conversions, Revenue, …)"],
                  ["conv.revenue", "Revenue-Banner"],
                  ["conv.trend", "GA4-Traffic-Trend"],
                ],
              ],
              [
                "GEO",
                [
                  ["geo.kpis", "AI-KPIs (Coverage, Referrals, Citations, Health)"],
                  ["geo.trend", "Citation-Trend je Provider"],
                  ["geo.evidence", "Latest Evidence"],
                ],
              ],
            ].map(([group, items]) => (
              <div key={group} style={{ marginBottom: 18 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.textDim,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {group}
                </div>
                {items.map(([key, label]) => {
                  const on = dash.isOn(key);
                  return (
                    <button
                      key={key}
                      onClick={() => dash.setKey(key, !on)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        background: C.card,
                        color: C.text,
                        cursor: "pointer",
                        marginBottom: 6,
                        fontFamily: "inherit",
                        fontSize: 13,
                      }}
                    >
                      <span>{label}</span>
                      <span style={{ color: on ? C.green : C.textDim, flexShrink: 0 }}>
                        {on ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {sec === "about" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Über EZY ONE</h2>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                EZY ONE Platform
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
                Version 3.0 • Build 2026-04-20
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.textMuted,
                  marginBottom: 8,
                  textTransform: "uppercase",
                }}
              >
                GitHub Repositories
              </div>
              {[
                ["claude-seo", "https://github.com/AgriciDaniel/claude-seo"],
                ["claude-blog", "https://github.com/AgriciDaniel/claude-blog"],
                ["claude-obsidian", "https://github.com/AgriciDaniel/claude-obsidian"],
                ["open-seo", "https://github.com/every-app/open-seo"],
                ["canonry", "https://github.com/AINYC/canonry"],
              ].map(([n, u]) => (
                <a
                  key={n}
                  href={u}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 0",
                    color: C.accent,
                    fontSize: 13,
                    textDecoration: "none",
                    borderBottom: `1px solid ${C.border}08`,
                  }}
                >
                  <GitBranch size={14} />
                  {n}
                  <ExternalLink size={11} style={{ marginLeft: "auto", color: C.textDim }} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE (Cmd+K)
// ═══════════════════════════════════════════════════════════════════════════
function CmdPalette({ open, onClose, onNavigate, onSelectClient, tools, clients }) {
  const [q, setQ] = useState("");
  const ref = useRef();
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 100);
    setQ("");
  }, [open]);
  if (!open) return null;
  const allItems = [
    ...NAV.map((n) => ({ type: "nav", label: n.label, icon: n.icon, id: n.id })),
    ...clients.map((c) => ({
      type: "client",
      label: c.name,
      sub: c.domain,
      icon: Globe,
      id: c.id,
    })),
    ...tools
      .filter((t) => t.enabled)
      .map((t) => ({ type: "tool", label: t.label, sub: t.description, icon: t.icon, id: t.id })),
  ];
  const filtered = q
    ? allItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q.toLowerCase()) ||
          (i.sub || "").toLowerCase().includes(q.toLowerCase()),
      )
    : allItems;
  const select = (item) => {
    if (item.type === "nav") onNavigate(item.id);
    else if (item.type === "client") {
      const c = clients.find((x) => x.id === item.id);
      if (c) onSelectClient(c);
    } else if (item.type === "tool") onNavigate("tools");
    onClose();
  };
  const typeLb = { nav: "Navigation", client: "Kunde", tool: "Tool" };
  const typeCo = { nav: C.accent, client: C.blue, tool: C.green };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 120,
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
        className="cmd-palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          width: 520,
          maxHeight: 440,
          overflow: "hidden",
          animation: "fadeScale .15s ease",
          boxShadow: "0 20px 60px rgba(0,0,0,.5)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Search size={18} color={C.textMuted} />
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Suche Kunden, Tools, Navigation..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              color: C.text,
              fontSize: 15,
              outline: "none",
              fontFamily: "inherit",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <Badge color={C.textDim}>ESC</Badge>
        </div>
        <div style={{ maxHeight: 340, overflowY: "auto", padding: 6 }}>
          {filtered.slice(0, 12).map((item, i) => {
            const I = item.icon;
            return (
              <button
                key={`${item.type}-${item.id}-${i}`}
                onClick={() => select(item)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  color: C.text,
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background .1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <I size={16} color={typeCo[item.type]} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: 11, color: C.textMuted }}>{item.sub}</div>}
                </div>
                <Badge color={typeCo[item.type]}>{typeLb[item.type]}</Badge>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
              Keine Ergebnisse
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════
async function exportCSV(toast, client) {
  if (!client?.id) {
    toast("Kein Kunde ausgewählt", "error");
    return;
  }
  try {
    const { data, error } = await supabase
      .from("audit_runs")
      .select("audit_type, status, started_at, finished_at, result")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    if (!data || data.length === 0) {
      toast("Keine Live-Daten zum Exportieren", "info");
      return;
    }
    const escape = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ["Audit Type", "Status", "Started", "Finished", "Result Summary"],
      ...data.map((r) => [
        r.audit_type,
        r.status,
        r.started_at || "",
        r.finished_at || "",
        r.result ? JSON.stringify(r.result).slice(0, 500) : "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const safeName = (client.domain || client.name || "client").replace(/[^a-z0-9.-]+/gi, "-");
    downloadFile(csv, "text/csv", `ezy-one-${safeName}-audit-runs.csv`);
    toast("CSV exportiert", "success");
  } catch (e) {
    toast(`Export fehlgeschlagen: ${e?.message || e}`, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
const AGENT_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8 (stärkstes)" },
  { id: "claude-fable-5", label: "Fable 5 (neuestes)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (schnell)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (günstig)" },
];
const JSON_HEAD = { "Content-Type": "application/json" };

const SKILL_CATEGORIES = [
  { id: "skills-seo", label: "SEO", color: C.blue },
  { id: "skills-blog", label: "Blog", color: C.green },
  { id: "skills-ads", label: "Ads", color: C.orange },
  { id: "skills-obsidian", label: "Obsidian", color: C.accent },
];

function SkillPicker({ selected, onChange }) {
  const [expanded, setExpanded] = useState(null);
  const toggle = (skill) => {
    if (selected.includes(skill)) onChange(selected.filter((s) => s !== skill));
    else onChange([...selected, skill]);
  };
  const selectAll = (cat) => {
    const catSkills = SKILL_CATALOG.filter((s) => s.category === cat).map((s) => s.skill);
    const allSelected = catSkills.every((sk) => selected.includes(sk));
    if (allSelected) onChange(selected.filter((s) => !catSkills.includes(s)));
    else onChange([...new Set([...selected, ...catSkills])]);
  };
  const checkStyle = (on) => ({
    width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? C.accent : C.border}`,
    background: on ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0, cursor: "pointer",
  });
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {selected.map((s) => (
            <span key={s} onClick={() => toggle(s)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 7px", fontSize: 11, color: C.text, cursor: "pointer" }}>
              {s} ×
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {SKILL_CATEGORIES.map((cat) => {
          const skills = SKILL_CATALOG.filter((s) => s.category === cat.id);
          const selectedCount = skills.filter((s) => selected.includes(s.skill)).length;
          const isOpen = expanded === cat.id;
          return (
            <div key={cat.id} style={{ border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div onClick={() => setExpanded(isOpen ? null : cat.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", background: isOpen ? `${cat.color}11` : "transparent", borderRadius: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>{cat.label}</span>
                {selectedCount > 0 && <span style={{ fontSize: 10, color: cat.color }}>{selectedCount}/{skills.length}</span>}
                <span style={{ fontSize: 10, color: C.textMuted }}>{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && (
                <div style={{ padding: "6px 10px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div onClick={() => selectAll(cat.id)} style={{ fontSize: 10, color: C.accent, cursor: "pointer", marginBottom: 4 }}>
                    {skills.every((s) => selected.includes(s.skill)) ? "Alle abwählen" : "Alle auswählen"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 4 }}>
                    {skills.map((s) => {
                      const on = selected.includes(s.skill);
                      return (
                        <div key={s.id} onClick={() => toggle(s.skill)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 5, cursor: "pointer", background: on ? `${C.accent}11` : "transparent" }} title={s.description}>
                          <span style={checkStyle(on)}>{on ? "✓" : ""}</span>
                          <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.skill}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentsPage({ selectedClient }) {
  const clientId = selectedClient?.id || "global";
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [runInputs, setRunInputs] = useState({});
  const [runResult, setRunResult] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [agentSessions, setAgentSessions] = useState({});
  const [selectedSessions, setSelectedSessions] = useState({});
  const [showMemory, setShowMemory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ezyFetch(`/api/agent/agents?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAgents(j.agents || []);
    } catch (e) {
      setMsg(String(e?.message || e));
    }
    setLoading(false);
  }, [clientId]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadMemory = async (agentId) => {
    try {
      const r = await ezyFetch(`/api/agent/memory?agentId=${encodeURIComponent(agentId)}`);
      const j = await r.json();
      setAgentSessions((p) => ({ ...p, [agentId]: j.sessions || [] }));
    } catch {}
  };
  const deleteSession = async (agentId, sessionId) => {
    try {
      await ezyFetch(`/api/agent/memory?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      await loadMemory(agentId);
      if (selectedSessions[agentId] === sessionId) setSelectedSessions((p) => ({ ...p, [agentId]: null }));
    } catch {}
  };

  const save = async () => {
    if (!editing?.name?.trim()) {
      setMsg("Name erforderlich");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        ...editing,
        clientId,
        skills: Array.isArray(editing.skills) ? editing.skills : [],
      };
      const r = await ezyFetch(`/api/agent/agents?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: JSON_HEAD,
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Fehler beim Speichern");
      setEditing(null);
      await load();
      setMsg("Agent gespeichert");
    } catch (e) {
      setMsg(String(e?.message || e));
    }
    setBusy(false);
  };

  const del = async (id) => {
    if (!window.confirm("Agent wirklich löschen?")) return;
    try {
      await ezyFetch(`/api/agent/agents?clientId=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg(String(e?.message || e));
    }
  };

  const run = async (agent, forceNew = false) => {
    setRunningId(agent.id);
    setRunResult(null);
    setMsg("");
    const resumeSessionId = forceNew ? undefined : selectedSessions[agent.id];
    try {
      const r = await ezyFetch("/api/agent/run-agent", {
        method: "POST",
        headers: JSON_HEAD,
        body: JSON.stringify({ id: agent.id, clientId, input: runInputs[agent.id] || "", resumeSessionId }),
      });
      const j = await r.json();
      if (!j.jobId) throw new Error(j.error || "Start fehlgeschlagen");
      for (let i = 0; i < 180; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const pr = await ezyFetch(`/api/agent/run-agent?jobId=${encodeURIComponent(j.jobId)}`);
        const pj = await pr.json();
        if (pj.status === "done") {
          setRunResult({ id: agent.id, ok: true, text: pj.result, cost: pj.costUsd, sessionId: pj.sessionId });
          if (pj.sessionId) setSelectedSessions((p) => ({ ...p, [agent.id]: pj.sessionId }));
          loadMemory(agent.id);
          break;
        }
        if (pj.status === "error") {
          setRunResult({ id: agent.id, ok: false, text: pj.error || "Fehler" });
          break;
        }
      }
    } catch (e) {
      setRunResult({ id: agent.id, ok: false, text: String(e?.message || e) });
    }
    setRunningId(null);
  };

  const inputStyle = {
    width: "100%",
    padding: "9px 11px",
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  };
  const lbl = { fontSize: 11, color: C.textMuted, marginBottom: 4 };
  const btn = (bg) => ({
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${bg || C.border}`,
    background: bg || C.surface,
    color: bg ? "#fff" : C.text,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="mobile-wrap" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>
            Agents{selectedClient?.name ? ` — ${selectedClient.name}` : ""}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            KI-Assistenten für diesen Kunden. Wechsle den Kunden, um dessen Agents zu sehen.
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing({ name: "", description: "", instructions: "", model: "claude-opus-4-8", skills: [] })} style={btn(C.accent)}>
            + Neuer Agent
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, color: C.textMuted }}>{msg}</div>}

      {editing && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ezy-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={lbl}>Name</div>
              <input style={inputStyle} value={editing.name} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} placeholder="z. B. SEO-Audit-Bot" />
            </div>
            <div>
              <div style={lbl}>Modell</div>
              <select style={inputStyle} value={editing.model} onChange={(e) => setEditing((p) => ({ ...p, model: e.target.value }))}>
                {AGENT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div style={lbl}>Beschreibung (optional)</div>
            <input style={inputStyle} value={editing.description} onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} placeholder="Wofür ist dieser Agent?" />
          </div>
          <div>
            <div style={lbl}>Instruktionen (System-Prompt)</div>
            <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6, resize: "vertical" }} value={editing.instructions} onChange={(e) => setEditing((p) => ({ ...p, instructions: e.target.value }))} placeholder="Du bist ein SEO-Experte für Schweizer KMU. Antworte strukturiert, auf Deutsch ..." />
          </div>
          <div>
            <div style={lbl}>Skills (optional)</div>
            <SkillPicker selected={editing.skills || []} onChange={(skills) => setEditing((p) => ({ ...p, skills }))} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Leer = freier Assistent. Skills geben dem Agent spezialisierte Fähigkeiten.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={btn(C.accent)}>
              {busy ? "…" : "Speichern"}
            </button>
            <button onClick={() => setEditing(null)} disabled={busy} style={btn()}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {!editing &&
        (loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Lädt…</div>
        ) : agents.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13, padding: 24, textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 12 }}>
            Noch keine Agents. Erstelle deinen ersten mit „+ Neuer Agent".
          </div>
        ) : (
          <div className="client-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
            {agents.map((a) => (
              <div key={a.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{a.name}</div>
                    {a.description && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{a.description}</div>}
                  </div>
                  <Badge color={C.blue}>{(AGENT_MODELS.find((m) => m.id === a.model)?.label || a.model || "").split(" ")[0]}</Badge>
                </div>
                {a.skills?.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {a.skills.map((s) => (
                      <Badge key={s} color={C.textDim}>
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
                <textarea style={{ ...inputStyle, minHeight: 54, resize: "vertical" }} placeholder="Anfrage / Aufgabe an den Agenten…" value={runInputs[a.id] || ""} onChange={(e) => setRunInputs((p) => ({ ...p, [a.id]: e.target.value }))} />
                {selectedSessions[a.id] && (
                  <div style={{ fontSize: 11, color: C.green, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                    Session aktiv — fortsetzen
                    <button onClick={() => setSelectedSessions((p) => ({ ...p, [a.id]: null }))} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 11, padding: 0 }}>(neue starten)</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => run(a)} disabled={runningId === a.id} style={btn(C.green)}>
                    {runningId === a.id ? "läuft…" : selectedSessions[a.id] ? "▶ Fortsetzen" : "▶ Ausführen"}
                  </button>
                  <button onClick={() => { loadMemory(a.id); setShowMemory(showMemory === a.id ? null : a.id); }} style={btn()}>
                    {showMemory === a.id ? "Gedächtnis ▲" : "Gedächtnis ▼"}
                  </button>
                  <button onClick={() => setEditing({ ...a, skills: a.skills || [] })} style={btn()}>
                    Bearbeiten
                  </button>
                  <button onClick={() => del(a.id)} style={{ ...btn(), color: C.textMuted, marginLeft: "auto" }}>
                    Löschen
                  </button>
                </div>
                {showMemory === a.id && (
                  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: C.text }}>Sessions (Gedächtnis)</div>
                    {(agentSessions[a.id] || []).length === 0 ? (
                      <div style={{ color: C.textMuted }}>Noch keine Sessions gespeichert.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflow: "auto" }}>
                        {(agentSessions[a.id] || []).map((s) => (
                          <div key={s.sessionId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, background: selectedSessions[a.id] === s.sessionId ? `${C.accent}22` : C.surface, border: `1px solid ${selectedSessions[a.id] === s.sessionId ? C.accent : C.border}`, cursor: "pointer" }} onClick={() => setSelectedSessions((p) => ({ ...p, [a.id]: s.sessionId }))}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                              <div style={{ fontSize: 10, color: C.textMuted }}>{s.messageCount || 1} Nachr. · {new Date(s.lastMessageAt).toLocaleDateString("de-CH")}</div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); deleteSession(a.id, s.sessionId); }} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 14, padding: 2 }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { setSelectedSessions((p) => ({ ...p, [a.id]: null })); setShowMemory(null); }} style={{ ...btn(), marginTop: 8, fontSize: 11, padding: "5px 10px" }}>+ Neue Session starten</button>
                  </div>
                )}
                {runResult?.id === a.id && (
                  <div style={{ background: C.bg, border: `1px solid ${runResult.ok ? C.border : C.red}55`, borderRadius: 8, padding: 10, fontSize: 12, color: C.text, whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
                    {runResult.text}
                    {runResult.ok && runResult.cost != null && (
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>Kosten: ${Number(runResult.cost).toFixed(3)}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

const TABS = [
  { id: "seo", label: "SEO", icon: Globe },
  { id: "geo", label: "GEO", icon: Sparkles },
  { id: "conversions", label: "Conversions", icon: DollarSign },
  { id: "ads", label: "Ads", icon: Megaphone },
];
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "tools", label: "AI Tools", icon: Zap },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "content", label: "Content", icon: FileText },
  { id: "clients", label: "Clients", icon: Users },
  { id: "settings", label: "Einstellungen", icon: Settings },
];

function App() {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const ezy = useEzyClients();
  const clients = useMemo(() => ezy.clients.map((c) => normalizeClientShape(c)), [ezy.clients]);
  const [clientId, setClientId] = useState("");
  useEffect(() => {
    if (clients.length && !clients.some((c) => c.id === clientId)) setClientId(clients[0].id);
  }, [clients, clientId]);
  const emptyClient = useMemo(
    () =>
      normalizeClientShape({
        id: "",
        name: "Kein Kunde",
        domain: "",
        defaults: { language: "Deutsch", tone: "Professionell", reportTemplate: "Standard" },
      }),
    [],
  );
  const hasClients = clients.length > 0;
  const client = useMemo(
    () => clients.find((entry) => entry.id === clientId) || clients[0] || emptyClient,
    [clientId, clients, emptyClient],
  );
  const profileHook = useEzyProfile();
  const defaultsHook = useEzyDefaults(client?.id);
  const contentHook = useEzyContent();
  const [page, setPage] = useState("dashboard");
  const [tab, setTab] = useState("seo");
  const [cdd, setCdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    return { label: "30 Tage", days: 30, start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
  });
  const [showAll, setShowAll] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const toast = useToast();
  const sw = isMobile ? 0 : collapsed ? 68 : 240;
  const toolSettings = useEzyToolSettings(client?.id);
  const tools = useMemo(() => toolSettings.applyTo(ALL_TOOLS), [toolSettings]);
  const enabledTools = useMemo(() => tools.filter((t) => t.enabled), [tools]);
  const toggleTool = useCallback(
    (id) => {
      const cur = tools.find((t) => t.id === id);
      toolSettings.setEnabled(id, !(cur?.enabled !== false));
    },
    [tools, toolSettings],
  );
  const selectClient = useCallback((nextClient) => {
    if (nextClient?.id) setClientId(nextClient.id);
    setShowAll(false);
  }, []);
  const upsertClient = useCallback(
    async (nextClient) => {
      try {
        const seeded = nextClient.id
          ? nextClient
          : { ...nextClient, defaults: nextClient.defaults || defaultsHook.defaults };
        const saved = await ezy.upsert(seeded);
        setClientId(saved.id);
        setShowAll(false);
        toast?.("Kunde gespeichert", "success");
      } catch (e) {
        toast?.(e?.message || "Speichern fehlgeschlagen", "error");
      }
    },
    [ezy, toast, defaultsHook.defaults],
  );
  const deleteClient = useCallback(
    async (id) => {
      try {
        await ezy.remove(id);
        setShowAll(false);
        toast?.("Kunde gelöscht", "success");
      } catch (e) {
        toast?.(e?.message || "Löschen fehlgeschlagen", "error");
      }
    },
    [ezy, toast],
  );
  const profile = profileHook.profile.name
    ? profileHook.profile
    : {
        ...DEFAULT_PROFILE,
        ...profileHook.profile,
        name: profileHook.profile.name || DEFAULT_PROFILE.name,
      };
  const saveProfile = useCallback((next) => profileHook.save(next), [profileHook]);
  const customerDefaults = defaultsHook.defaults;
  const saveCustomerDefaults = useCallback((next) => defaultsHook.save(next), [defaultsHook]);
  const onSaveContent = useCallback((id, md) => contentHook.updateContent(id, md), [contentHook]);
  const visibleTabs = useMemo(
    () => TABS.filter((t) => (customerDefaults.visibleTabs || ["seo", "geo", "conversions"]).includes(t.id)),
    [customerDefaults.visibleTabs],
  );
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === tab)) {
      setTab(visibleTabs[0].id);
    }
  }, [visibleTabs, tab]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") {
        setShowTools(false);
        setCdd(false);
        setCmdOpen(false);
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  if (ezy.loading && !clients.length)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: C.bg,
          color: C.textMuted,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        Lädt EZY ONE…
      </div>
    );

  return (
    <div
      className="app-shell"
      style={{
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        background: C.bg,
        color: C.text,
        minHeight: "100vh",
        display: "flex",
        fontSize: 14,
        lineHeight: 1.5,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400&display=swap"
        rel="stylesheet"
      />
      <style>{CSS}</style>

      {/* Sidebar */}
      <aside
        className="app-sidebar"
        style={{
          width: sw,
          background: C.surface,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          transition: "width .2s",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            padding: collapsed ? "20px 12px" : "20px 20px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg,${C.accent},${C.blue})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 800,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            EO
          </div>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.3px" }}>EZY ONE</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>SEO & GEO Platform</div>
            </div>
          )}
        </div>
        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {NAV.map((n) => {
            const I = n.icon;
            const a = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  background: a ? C.accentDim : "transparent",
                  color: a ? C.accentLight : C.textMuted,
                  fontSize: 13,
                  fontWeight: a ? 600 : 400,
                  marginBottom: 2,
                  transition: "all .15s",
                  justifyContent: collapsed ? "center" : "flex-start",
                  fontFamily: "inherit",
                }}
              >
                <I size={18} />
                {!collapsed && n.label}
              </button>
            );
          })}
        </nav>
        {!collapsed && (
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
            <button
              onClick={() => setCmdOpen(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: C.card,
                border: `1px solid ${C.border}`,
                cursor: "pointer",
                color: C.textMuted,
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              <Search size={13} />
              Suche...
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: C.textDim,
                  background: C.bg,
                  padding: "1px 5px",
                  borderRadius: 4,
                }}
              >
                ⌘K
              </span>
            </button>
          </div>
        )}
        {!collapsed && (
          <div
            style={{
              padding: "12px 16px",
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: C.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {initialsFromName(profile.name)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{profile.name}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{profile.role}</div>
            </div>
            <LogOut
              size={14}
              color={C.textDim}
              style={{ cursor: "pointer" }}
              onClick={() => supabase.auth.signOut()}
            />
          </div>
        )}
      </aside>

      <main
        className="app-main"
        style={{ marginLeft: sw, flex: 1, transition: "margin-left .2s", minWidth: 0 }}
      >
        <header
          className="app-header"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            background: `${C.bg}ee`,
            backdropFilter: "blur(12px)",
            borderBottom: `1px solid ${C.border}`,
            padding: isMobile ? "10px 12px" : "12px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <div
            className="header-left"
            style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}
          >
            {isMobile && (
              <select
                aria-label="Navigation"
                value={page}
                onChange={(e) => setPage(e.target.value)}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  color: C.text,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  outline: "none",
                  maxWidth: "100%",
                }}
              >
                {NAV.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            )}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setCdd(!cdd)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "8px 14px",
                  cursor: "pointer",
                  color: C.text,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: C.accentDim,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: C.accentLight,
                  }}
                >
                  {showAll ? "✦" : initialsFromName(client.name)}
                </div>
                {showAll ? "Alle Kunden" : client.name}
                <ChevronDown size={14} color={C.textMuted} />
              </button>
              {cdd && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 4,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    minWidth: 240,
                    zIndex: 60,
                    boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                  }}
                >
                  <button
                    onClick={() => {
                      setShowAll(true);
                      setCdd(false);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      padding: "10px 14px",
                      border: "none",
                      cursor: "pointer",
                      background: showAll ? C.accentDim : "transparent",
                      color: C.text,
                      textAlign: "left",
                      borderRadius: 8,
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Alle Kunden</span>
                  </button>
                  {clients.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => {
                        setClientId(entry.id);
                        setShowAll(false);
                        setCdd(false);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        width: "100%",
                        padding: "10px 14px",
                        border: "none",
                        cursor: "pointer",
                        background:
                          !showAll && entry.id === client.id ? C.accentDim : "transparent",
                        color: C.text,
                        textAlign: "left",
                        borderRadius: 8,
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</span>
                      <span style={{ color: C.textMuted, fontSize: 11 }}>{entry.domain}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {page === "dashboard" && visibleTabs.length > 0 && <TabBar tabs={visibleTabs} active={tab} onChange={setTab} />}
            {page !== "dashboard" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: C.textMuted,
                }}
              >
                <span style={{ cursor: "pointer" }} onClick={() => setPage("dashboard")}>
                  Dashboard
                </span>
                <ChevronRight size={12} />
                <span style={{ color: C.text, fontWeight: 600 }}>
                  {NAV.find((n) => n.id === page)?.label}
                </span>
              </div>
            )}
          </div>
          <div
            className="header-actions"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: isMobile ? "flex-start" : "flex-end",
            }}
          >
            {page === "dashboard" && <DateRangePicker value={dateRange} onChange={setDateRange} />}
            {page === "dashboard" && (
              <Btn
                variant="secondary"
                size="md"
                icon={Download}
                onClick={() => exportCSV(toast, client)}
                disabled={!hasClients}
              >
                Export
              </Btn>
            )}
            <Btn icon={Zap} onClick={() => setShowTools(true)}>
              Audit
            </Btn>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: C.card,
                border: `1px solid ${C.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Bell size={15} color={C.textMuted} />
            </div>
          </div>
        </header>
        <div className="app-content" style={{ padding: isMobile ? "16px 12px" : "24px 28px" }}>
          {!hasClients && page !== "clients" && page !== "settings" && (
            <div
              style={{
                background: C.card,
                border: `1px dashed ${C.border}`,
                borderRadius: 14,
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                Noch kein Kunde angelegt
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: C.textMuted,
                  marginBottom: 16,
                  maxWidth: 480,
                  margin: "0 auto 16px",
                }}
              >
                Lege deinen ersten Kunden an, um Dashboards, Tools und Reports mit Live-Daten zu
                füllen.
              </div>
              <Btn icon={Plus} onClick={() => setPage("clients")}>
                Kunde anlegen
              </Btn>
            </div>
          )}
          {hasClients && page === "dashboard" && (
            <>
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                  {showAll
                    ? "Agentur-Übersicht"
                    : tab === "seo"
                      ? "SEO Dashboard"
                      : tab === "geo"
                        ? "GEO Dashboard"
                        : tab === "ads"
                          ? "Ads Dashboard"
                          : "Conversions"}
                </h1>
                <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
                  {showAll ? "Alle Kunden" : `${client.name} — ${client.domain}`}
                  {dateRange.label ? ` • ${dateRange.label}` : ""}
                </p>
              </div>
              {showAll && <AgencyOverview clients={clients} />}
              {!showAll && (
                <>
                  {tab === "seo" && <SeoDashboard selectedClient={client} dateRange={dateRange} />}
                  {tab === "geo" && <GeoDashboard selectedClient={client} dateRange={dateRange} />}
                  {tab === "conversions" && <ConvDashboard selectedClient={client} dateRange={dateRange} />}
                  {tab === "ads" && <AdsDashboard selectedClient={client} dateRange={dateRange} />}
                </>
              )}
            </>
          )}
          {hasClients && page === "tools" && <ToolsPage selectedClient={client} tools={tools} />}
          {hasClients && page === "content" && (
            <ContentPage
              clients={clients}
              items={contentHook.items}
              onSaveContent={onSaveContent}
            />
          )}
          {page === "clients" && (
            <ClientsPage
              clients={clients}
              selectedClientId={client.id}
              onSelectClient={selectClient}
              onUpsertClient={upsertClient}
              onDeleteClient={deleteClient}
              onReload={ezy.reload}
              customerDefaults={customerDefaults}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              tools={tools}
              onToggleTool={toggleTool}
              selectedClient={client}
              profile={profile}
              onSaveProfile={saveProfile}
              customerDefaults={customerDefaults}
              onSaveDefaults={saveCustomerDefaults}
              onClientUpdated={ezy.reload}
            />
          )}
          {page === "agents" && <AgentsPage selectedClient={client} />}
        </div>
      </main>

      {/* Quick Tools */}
      {showTools && (
        <div
          className="quick-audit-panel"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: isMobile ? "100vw" : 400,
            background: C.surface,
            borderLeft: `1px solid ${C.border}`,
            zIndex: 100,
            padding: isMobile ? 18 : 24,
            overflowY: "auto",
            animation: "slideIn .2s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Quick Audit</span>
            <button
              onClick={() => setShowTools(false)}
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
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
            {client.name} · {client.domain}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {enabledTools.slice(0, 6).map((t) => {
              const I = t.icon;
              return (
                <div
                  key={t.id}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    transition: "border-color .2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.color)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                  onClick={() => {
                    setShowTools(false);
                    setPage("tools");
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: `${t.color}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <I size={16} color={t.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{t.label}</div>
                    <div style={{ color: C.textMuted, fontSize: 11 }}>{t.description}</div>
                  </div>
                  <ChevronRight size={14} color={C.textDim} />
                </div>
              );
            })}
          </div>
          <Btn
            variant="secondary"
            style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
            onClick={() => {
              setShowTools(false);
              setPage("tools");
            }}
          >
            Alle {enabledTools.length} Tools
          </Btn>
        </div>
      )}

      {/* Command Palette */}
      <CmdPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(p) => {
          setPage(p);
          setCmdOpen(false);
        }}
        onSelectClient={(c) => {
          selectClient(c);
          setCmdOpen(false);
        }}
        tools={tools}
        clients={clients}
      />
    </div>
  );
}

const W = () => (
  <ToastProvider>
    <App />
  </ToastProvider>
);
export default W;

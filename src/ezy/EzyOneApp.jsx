import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useRef,
  useMemo,
  Component,
  Fragment,
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
  LayoutDashboard,
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
  ListChecks,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { ezyFetch } from "@/ezy/data/api";
import { useAuth } from "@/hooks/use-auth";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import {
  loadSharedRange,
  saveSharedRange,
  useRangeData,
  isReloadNavigation,
} from "@/ezy/data/rangeStore";
import { HexGlowLayer } from "@/ezy/HexGlow";
import { EzyOneMark } from "@/components/ezy-one-mark";
import { AppVersionBadge } from "@/ezy/AppVersionBadge";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import { useEzyDefaults } from "@/ezy/data/useEzyDefaults";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import { useEzyContent } from "@/ezy/data/useEzyContent";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { useEzyToolSettings, toolProvider } from "@/ezy/data/useEzyToolSettings";
import { ServicesPicker, ServicesPanel } from "@/ezy/components/ServicesPanel";
import { DEFAULT_ON_SERVICES } from "@/lib/services";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import {
  EZY_APPS,
  APP_START,
  APP_SCOPES,
  APP_FEATURES,
  TAB_APP_FEATURE,
  currentAppOf,
} from "@/ezy/data/appRegistry";
import {
  warneBeimAppAktivieren,
  warneBeimLocalGrid,
  STATUS_LABEL as READINESS_STATUS_LABEL,
  appLabel as readinessAppLabel,
} from "@/ezy/data/appRequirements";
// Local-Grid-Tab (2026-08-17): Maps-Heatmap (Geo-Grid) — eigene Datei, damit
// der Monolith klein bleibt (parallele Sessions!).
import LocalGridDashboard from "@/ezy/LocalGridDashboard";
import DataStatus, { runStatusItem } from "@/ezy/DataStatus";
// Architektur-Extraktion 2026-08-18: Markdown-Helfer leben jetzt testbar in
// lib/markdown.ts (XSS-Tests) — Verhalten unveraendert, nur verschoben.
import { escapeHtml, sanitizeHref, markdownToHtml } from "@/ezy/lib/markdown";
import { useMeasurement } from "@/ezy/data/useMeasurement";
import { normalizeToolResult } from "@/ezy/data/toolResult";
import ToolResultView from "@/ezy/ToolResult";
import ToolActions from "@/ezy/ToolActions";
// PublishFlow (2026-08-18): WP-Publish-Dialog mit Vorschau + Publish-Schutz,
// extrahiert aus dem Monolithen. notify = Toast des Aufrufers (kein Zirkular-Import).
import WordPressPublishModal from "@/ezy/PublishFlow";
import {
  useClientAppAccess,
  appEnabledFor,
  featureEnabledFor,
} from "@/ezy/data/useClientAppAccess";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { useEzyServiceMatrix } from "@/ezy/data/useEzyServiceMatrix";
import { executeTool as runToolLive } from "@/ezy/data/runTool";
import { useEzyAuditHistory } from "@/ezy/data/useEzyAuditHistory";
import { useEzyAgentRuns } from "@/ezy/data/useEzyAgentRuns";
import {
  useEzyLatestRun,
  ahrefsKpisFromResult,
  ahrefsRefdomainsSeriesFromResult,
  gscRankingDistributionFromResult,
  ga4KpisFromResult,
  ga4TrafficFromResult,
  ga4ConversionsFromResult,
  gscKpisFromResult,
  pagespeedKpisFromResult,
  aiVisibilityScoreFromResult,
  aiVisibilityKpisFromResult,
  aiVisibilitySeriesFromResult,
  aiVisibilityProvidersFromResult,
  aiVisibilitySourcesFromResult,
  aiVisibilityTopicsFromResult,
  googleAdsFromResult,
  aworkTasksFromResult,
  useEzyHealthComponents,
} from "@/ezy/data/useEzyLatestRun";
import GoogleClientPanel from "@/ezy/GoogleClientPanel.jsx";
import AIVisibilityReport, { AIVisibilitySkeleton } from "@/ezy/AIVisibilityDashboard.jsx";
import AdsAutopilotPanel from "@/ezy/AdsAutopilotPanel.jsx";
import { useEzyAIVisibility } from "@/ezy/data/useEzyAIVisibility";
import { supabase } from "@/integrations/supabase/client";
import { SKILL_CATALOG } from "@/ezy/data/skillCatalog";
const toolHasLiveProvider = (id) => toolProvider(id) !== null;

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
// Ezy One Corporate Design (2026-08-10, Brand Guideline 2025) — vorher "Light
// Studio à la Searchable" (warmes Creme + generisches Violett). Jetzt: Pale Gray
// #FCFCFC-Familie mit leichtem Purple-Bias, Smoky Black #0D0D0D als Tinte,
// Purple #77008C als EINZIGE Akzentfarbe, Violet-Red #B9009C für Hover/Gradient
// (CD-Gradient 135° #71008B→#B9009C). Semantikfarben (grün/rot/…) bleiben.

import { C } from "./theme";
import {
  ToastProvider,
  useToast,
  Btn,
  Badge,
  EzyPilotProvider,
  EzyPilotPopup,
  EzyPilotButton,
  EzyPilotPage,
  useEzyPilot,
} from "./shared-ui";
// Re-Export fuer bestehende Importeure (ezyai & Co. importieren inzwischen direkt).
export { ToastProvider, EzyPilotProvider, EzyPilotPopup, EzyPilotButton };
export { AiVisibilityTab } from "./AiVisibilityTab";
// CD-Pattern: durchgehendes Hexagon-Waben-Mesh als Seiten-Textur, sehr dezent
// (4% Purple). Nur auf Seiten-Containern einsetzen — nie auf Chips/Karten.
const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2377008C' fill-opacity='0.04' fill-rule='evenodd'/%3E%3C/svg%3E")`;
const AI_COLORS = {
  ChatGPT: "#10b981",
  Perplexity: "#3b82f6",
  Gemini: "#f59e0b",
  Claude: "#ec4899",
  Copilot: "#06b6d4",
  Grok: "#ec4899",
};
const CSS = `html,body,#root{min-height:100%;margin:0;overflow-x:hidden}*{box-sizing:border-box}@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes slideUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeScale{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}::selection{background:rgba(119,0,140,.18);color:#161217}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}@media(max-width:760px){.app-sidebar{display:none!important}.app-main{margin-left:0!important;min-width:0!important;width:100%!important}.app-header{align-items:flex-start!important;gap:10px!important}.header-left,.header-actions{width:100%;flex-wrap:wrap}.app-content{padding:16px 12px!important}.settings-shell{flex-direction:column!important;gap:16px!important}.settings-nav{width:100%!important;display:flex!important;overflow-x:auto;padding-bottom:4px}.settings-nav button{width:auto!important;white-space:nowrap;flex-shrink:0}.settings-panel{max-width:none!important}.client-toolbar{flex-direction:column!important;align-items:stretch!important}.client-toolbar>div{width:100%!important}.client-grid{grid-template-columns:minmax(0,1fr)!important}.ezy-form-grid{grid-template-columns:1fr!important}.kpi-grid{grid-template-columns:1fr!important}.kpi-grid>div{grid-column:auto!important}.client-drawer,.quick-audit-panel{width:100vw!important;max-width:100vw!important}.quick-audit-panel{padding:18px 14px!important}.cmd-palette{width:min(calc(100vw - 24px),520px)!important}.mobile-wrap{flex-wrap:wrap!important}.dash-kpis{grid-template-columns:1fr 1fr!important}.split-pane{grid-template-columns:1fr!important}.tabbar{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;max-width:100%}.tabbar::-webkit-scrollbar{display:none}.tabbar button{flex-shrink:0;white-space:nowrap}.tools-shell{flex-direction:column!important;gap:12px!important}.tools-cats{display:flex!important;flex-direction:row!important;width:100%!important;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-bottom:6px;scrollbar-width:none}.tools-cats::-webkit-scrollbar{display:none}.tools-cats>div:first-child{display:none}.tools-cats button{width:auto!important;flex-shrink:0;white-space:nowrap;margin-bottom:0!important}.google-props-grid{grid-template-columns:1fr!important}.ads-hero-head{flex-wrap:nowrap!important;align-items:flex-start!important}.ads-hero-head>button{flex:none!important}.ads-flow{display:grid!important;grid-template-columns:1fr 1fr!important;gap:14px 16px!important;align-items:start!important}.ads-arrow{display:none!important}.ads-roas{order:-1!important;grid-column:1/-1!important;flex-direction:row!important;align-items:baseline!important;justify-content:flex-start!important;gap:9px!important;padding:0!important}.ads-roas>div:last-child{margin-top:0!important}.ads-stat-right{text-align:left!important}.ads-flow .ads-val{font-size:24px!important}.app-content [style*="minmax(200px"],.app-content [style*="minmax(220px"],.app-content [style*="minmax(240px"]{grid-template-columns:1fr 1fr!important;gap:10px!important}.app-content [style*="minmax(320px"]{grid-template-columns:1fr!important}}@media(max-width:480px){.app-header{padding:8px 10px!important}.app-content{padding:12px 10px!important}.app-content [style*="minmax(200px"],.app-content [style*="minmax(220px"],.app-content [style*="minmax(240px"]{grid-template-columns:1fr!important}}
.ezy-md{font-size:13.5px;line-height:1.65;color:${C.text};overflow-wrap:break-word}.ezy-md h1{font-size:19px;margin:18px 0 8px;color:${C.text}}.ezy-md h2{font-size:16px;margin:16px 0 6px;color:${C.text}}.ezy-md h3{font-size:14px;margin:14px 0 4px;color:${C.text}}.ezy-md p{margin:7px 0}.ezy-md ul,.ezy-md ol{margin:7px 0;padding-left:22px}.ezy-md li{margin:3px 0}.ezy-md code{background:${C.bg};border:1px solid ${C.border};border-radius:4px;padding:1px 5px;font-size:12px}.ezy-md a{color:${C.accent}}.ezy-md h1:first-child,.ezy-md h2:first-child,.ezy-md h3:first-child{margin-top:0}`;
function downloadFile(content, type, filename) {
  const b = new Blob([content], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 0);
}
// escapeHtml/sanitizeHref: seit 2026-08-18 aus @/ezy/lib/markdown importiert.
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
  // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
  visibleTabs: ["seo", "aivis", "conversions", "ads", "runs"],
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
    visibleTabs: Array.isArray(value?.visibleTabs)
      ? value.visibleTabs
      : DEFAULT_CUSTOMER_DEFAULTS.visibleTabs,
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
    brandTerms: Array.isArray(client?.brandTerms) ? client.brandTerms : [],
    revenueMode: client?.revenueMode === "clicks" ? "clicks" : "revenue",
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
    // Dashboard-Ausbau 2026-07-11 (B5d): Brand-Terms (Tag-Input) + Umsatz-Modus.
    brandTerms: (client?.brandTerms || []).join(", "),
    revenueMode: client?.revenueMode === "clicks" ? "clicks" : "revenue",
    // Beim Anlegen vorausgewaehlte Dienste (Set von Service-Keys).
    services: new Set(DEFAULT_ON_SERVICES),
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
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = [
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

function CalendarMonth({ year, month, rangeStart, rangeEnd, onSelect, hoverDate, onHover }) {
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

function DateRangePicker({ value, onChange }) {
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
const COMPARE_OPTIONS = [
  { id: "none", label: "Kein Vergleich" },
  { id: "prevPeriod", label: "Vorherige Periode" },
  { id: "prevMonth", label: "Vormonat (gleicher Zeitraum)" },
  { id: "prevYear", label: "Vorjahr (gleicher Zeitraum)" },
];

// Compute the comparison start/end dates for a given range + mode.
function computeCompareRange(range, mode) {
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
function parseSeriesDate(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{8}$/.test(str)) {
    return new Date(Number(str.slice(0, 4)), Number(str.slice(4, 6)) - 1, Number(str.slice(6, 8)));
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// Sum a metric across the series rows whose date falls within [start, end].
function sumSeriesInRange(series, key, start, end) {
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
function pctDelta(cur, prev) {
  if (prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Friendly short label for a comparison mode (shown on KPI cards).
function compareName(mode) {
  if (mode === "prevPeriod") return "Vorperiode";
  if (mode === "prevMonth") return "Vormonat";
  if (mode === "prevYear") return "Vorjahr";
  return null;
}

// Banner shown at the top of a dashboard when a comparison period is active,
// making it explicit which two windows are being compared.
function CompareBanner({ dateRange }) {
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
function seriesDelta(series, key, range) {
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
function useLiveGa4(clientId, endpoint, days) {
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
const liveDaysFor = (dateRange) => {
  if (!dateRange?.days) return 30;
  const end = dateRange.end ? new Date(dateRange.end).getTime() : Date.now();
  return Date.now() - end < 54e6 /* ~15h Toleranz */ ? dateRange.days : null;
};

function useGa4Compare(clientId, dateRange) {
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
function ComparePicker({ value, onChange }) {
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
// SERVICE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const CANONRY_SERVICE = {
  status: "healthy",
  version: "0.12.3",
  projects: 6,
  providers: ["Gemini", "OpenAI", "Claude", "Perplexity"],
  openApi: "/api/v1/openapi.json",
  lastSync: "vor 6 Min",
  agent: "Aero",
};

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
      {
        id: "content",
        label: "Bestehender Inhalt",
        type: "textarea",
        required: true,
        placeholder: "Artikeltext hier einfügen",
      },
      { id: "keyword", label: "Haupt-Keyword", type: "text", required: false },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "topic",
        label: "Thema / Nische",
        type: "text",
        required: true,
        placeholder: "z.B. lokale SEO für KMU",
      },
      { id: "audience", label: "Zielgruppe", type: "text", required: false },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "content",
        label: "Beitrag / Inhalt",
        type: "textarea",
        required: true,
        placeholder: "Artikeltext hier einfügen",
      },
      {
        id: "platforms",
        label: "Plattformen",
        type: "text",
        required: false,
        placeholder: "z.B. LinkedIn, X, Newsletter",
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "period",
        label: "Zeitraum",
        type: "select",
        required: false,
        options: ["1 Monat", "1 Quartal"],
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "content",
        label: "Beitrag / Inhalt",
        type: "textarea",
        required: true,
        placeholder: "Artikeltext hier einfügen",
      },
      {
        id: "language",
        label: "Sprache",
        type: "select",
        required: true,
        options: ["Deutsch", "Englisch", "Französisch"],
      },
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
      {
        id: "strategy",
        label: "Gerät",
        type: "select",
        required: false,
        options: ["Mobile", "Desktop"],
      },
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

// EzyRank-Ausbau 2026-08-18: Tools nach BENUTZERZIEL gruppiert (statt nach
// Plugin-Kategorie) — normale Benutzer denken in "Was will ich erreichen?".
// Die Plugin-Kategorie bleibt als Badge auf jeder Kachel sichtbar (CATEGORY_BADGE),
// und alle Provider-/Skill-Gates (enabled je Kunde, toolProvider) bleiben unveraendert.
const TOOL_GOALS = [
  { id: "all", label: "Alle", icon: LayoutGrid },
  { id: "analyse", label: "Analysieren", icon: Search },
  { id: "optimize", label: "Optimieren", icon: Zap },
  { id: "create", label: "Content erstellen", icon: PenTool },
  { id: "publish", label: "Veröffentlichen", icon: Globe },
];
const TOOL_GOAL_BY_ID = {
  "open-seo-audit": "analyse",
  "full-seo-audit": "analyse",
  "geo-aeo-audit": "analyse",
  "technical-audit": "analyse",
  "on-page-audit": "analyse",
  "cwv-audit": "analyse",
  canonry: "analyse",
  "geo-content-check": "analyse",
  "blog-rewrite": "optimize",
  "meta-tags": "optimize",
  "schema-markup": "optimize",
  "generate-blog": "create",
  "blog-outline": "create",
  "content-brief": "create",
  "blog-strategy": "create",
  "blog-repurpose": "create",
  "competitor-page": "create",
  "editorial-calendar": "create",
  "obsidian-note": "create",
};
function toolGoalOf(tool) {
  if (TOOL_GOAL_BY_ID[tool.id]) return TOOL_GOAL_BY_ID[tool.id];
  const key = `${tool.id} ${tool.label}`.toLowerCase();
  if (/publish|wordpress/.test(key)) return "publish";
  if (
    /write|generate|outline|brief|calendar|repurpose|strategy|translat|multilingual|pages|sitemap|note/.test(
      key,
    )
  )
    return "create";
  if (/rewrite|refresh|optimi|meta|schema|update|fix/.test(key)) return "optimize";
  if (
    /audit|check|analy|research|monitor|cluster|rank|backlink|technical|competitor|serp|drift|visual|performance|local|maps|geo/.test(
      key,
    )
  )
    return "analyse";
  // Katalog-Fallback nach Skill-Kategorie: SEO-Skills sind ueberwiegend Analyse,
  // Blog-/Obsidian-Skills ueberwiegend Content-Erstellung.
  return tool.category === "skills-seo" ? "analyse" : "create";
}

// Clean parent-category label + color for a tool/skill category id — shown as a
// badge on each tile/skill so the Überkategorie (SEO/Blog/Ads/…) is obvious at a glance.
const CATEGORY_BADGE = {
  audit: { label: "SEO", color: C.blue },
  geo: { label: "GEO", color: C.accent },
  content: { label: "Content", color: C.green },
  technical: { label: "SEO", color: C.blue },
  obsidian: { label: "Obsidian", color: C.pink },
  "skills-seo": { label: "SEO", color: C.blue },
  "skills-blog": { label: "Blog", color: C.green },
  "skills-ads": { label: "Ads", color: C.orange },
  "skills-obsidian": { label: "Obsidian", color: C.pink },
};
function categoryBadge(category) {
  return CATEGORY_BADGE[category] || { label: String(category || "—"), color: C.textDim };
}
// Look up the parent category of a skill by its skill name (for the SkillPicker chips).
function skillCategoryBadge(skillName) {
  const entry = SKILL_CATALOG.find((s) => s.skill === skillName);
  return entry ? categoryBadge(entry.category) : { label: "", color: C.textDim };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED CHART COMPONENTS (preserved)
// ═══════════════════════════════════════════════════════════════════════════
function KpiCard({
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
function AgencyOverview({ clients, onSelect, appScope = null }) {
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
  }, [clients]);
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
// Modul 1 (M1.5): Onboarding-Review. Nur bei vorhandener onboarding_scan-Zeile.
// Vorschlag aus automatischem Scan — nichts ist aktiv, bis der Mensch uebernimmt.
const CLIENT_TYPES = [
  { v: "generic", l: "Allgemein" },
  { v: "hotel", l: "Hotel" },
  { v: "gastro", l: "Gastro" },
  { v: "local_service", l: "Lokaler Dienstleister" },
  { v: "ngo", l: "NPO / NGO" },
  { v: "ecommerce", l: "E-Commerce" },
];
function OnboardingPanel({ selectedClient }) {
  const { run, refresh } = useEzyLatestRun(selectedClient?.id, "onboarding_scan");
  const res = run?.result;
  const [selKw, setSelKw] = useState(null);
  const [selOrg, setSelOrg] = useState({});
  const [selLoc, setSelLoc] = useState({});
  const [ctype, setCtype] = useState("");
  const [brandStr, setBrandStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!res) return;
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
  }, [run?.id]);
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
// Einheitliches SEO-Layout über alle Kunden (User-Wunsch 2026-07-17):
// Sektionen verschwinden nicht mehr bei fehlenden Daten, sondern zeigen einen
// Platzhalter mit dem konkreten nächsten Schritt — so sieht das Dashboard bei
// jedem Kunden gleich aus und Lücken sind sofort als Handlungsbedarf erkennbar.
// 10er-Seitenwechsler wie bei den Prompts im KI-Tab (User-Wunsch 2026-07-19),
// hier mit den Inline-Styles des SEO-Dashboards.
function seoPageNums(cur, pages) {
  const set = new Set([0, pages - 1, cur - 1, cur, cur + 1]);
  const nums = [...set].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}
function SeoPager({ page, setPage, total, pageSize = 10, unit = "Einträge" }) {
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

function SectionPlaceholder({ title, hint }) {
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

// Stabiler Body-Builder fuer die CWV-Messung (Mobile wie der Sammel-Lauf).
const PSI_MOBILE_BODY = () => ({ strategy: "mobile" });
function SeoDashboard({ selectedClient, dateRange }) {
  const { run, refresh: refreshAhrefs } = useEzyLatestRun(selectedClient?.id, "ahrefs");
  const live = run ? ahrefsKpisFromResult(run.result) : null;
  const { runs, refresh: refreshHistory } = useEzyAuditHistory(selectedClient?.id);
  const startDate = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const trend = useMemo(
    () =>
      (runs || [])
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
        .reverse(),
    [runs, startDate],
  );
  const { run: gscRun, refresh: refreshGsc } = useEzyLatestRun(selectedClient?.id, "gsc_summary");
  // Datumsfilter (2026-08-11): GSC-KPIs live im gewählten Zeitraum (Nur-Lese-
  // Abfrage, gecacht); Agent-Snapshot bleibt Fallback.
  const { data: liveGsc } = useLiveGa4(selectedClient?.id, "gsc-import", liveDaysFor(dateRange));
  const gscRes = liveGsc || gscRun?.result || null;
  const gsc = gscRes ? gscKpisFromResult(gscRes) : null;
  // Dashboard-Ausbau 2026-07-11: B1 Rankings (agent-service Rank-Store) + B2 GSC-Split.
  const { run: rankRun, refresh: refreshRank } = useEzyLatestRun(selectedClient?.id, "rankings");
  const rank = rankRun?.result || null;
  const { run: gscQRun } = useEzyLatestRun(selectedClient?.id, "gsc_queries");
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
  const { run: psiRun, refresh: refreshPsi } = useEzyLatestRun(selectedClient?.id, "pagespeed");
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
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(selectedClient?.id, "ga4_traffic");
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
              />
              <KpiCard
                icon={Target}
                label="In Top 10"
                value={rank.aggregate?.top10 ?? "—"}
                color={C.accent}
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
              Rankings ({rankCounts.total} Keywords
              {rankCounts.gsc > 0
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
              {hasIntl ? " · INT = google.com (USA/en, wöchentliche Messung)" : ""}
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
                      [null, "Quelle", "right"],
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
          <KpiCard
            icon={Link2}
            label="Backlinks Total"
            value={backlinks > 0 ? backlinks.toLocaleString("de-CH") : "—"}
            color={C.cyan}
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
      ) : isOn("seo.trend") ? (
        <SectionPlaceholder
          title="Entwicklung (Traffic · Visibility · Keywords)"
          hint="Braucht mindestens 2 Daten-Läufe (DataForSEO) im gewählten Zeitraum — Datumsfilter weiter fassen oder auf die nächsten automatischen Läufe warten."
        />
      ) : null}
      {/* Datenquellen-Übersicht (User-Wunsch 2026-07-17): welches Widget bezieht
          seine Daten aus welchem Kanal — inkl. Stand des letzten Abrufs je Quelle. */}
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
          Welcher Block bezieht seine Daten aus welchem Kanal · „Letzter Abruf" = Stand des jüngsten
          Daten-Laufs für diesen Kunden.
        </div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}>
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
    const interval = setInterval(
      () => {
        live.refresh?.();
        overview.refresh?.();
      },
      12 * 60 * 60 * 1000,
    ); // 12 Stunden
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
  const { run: convRun, refresh: refreshConv } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_conversions",
  );
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(selectedClient?.id, "ga4_traffic");
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
  // Filter-Tabs der Conversion-Liste (User-Wunsch 2026-07-19): Purchase =
  // Kauf-/Checkout-Events, Lead-Anfragen = alles Übrige (Formulare, Lead-,
  // Telefon-/Mail-/Maps-Events). Klassifiziert am rohen GA4-eventName.
  const [convFilter, setConvFilter] = useState("alle");
  const isPurchaseEvent = (r) =>
    /purchase|checkout|transaction|kauf|buchung|booking/i.test(
      String(r?.eventName || r?.description || ""),
    );
  const convRowsFiltered = useMemo(() => {
    const rows = conv?.rows || [];
    if (convFilter === "purchase") return rows.filter(isPurchaseEvent);
    if (convFilter === "lead") return rows.filter((r) => !isPurchaseEvent(r));
    return rows;
  }, [conv?.rows, convFilter]);
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
  const ga4SeriesRaw = ga4?.series?.length ? ga4.series : run?.result?.series || [];
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
  const cmp = (k) => (cmpData?.compare ? Number(cmpData.compare[k] || 0) : undefined);
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
  const convStatus = (
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
              Alle Conversions
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(() => {
                const base = conv.rows.length > 0 ? conv.rows : conv.events;
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
                        im Zeitraum.
                      </td>
                    </tr>
                  )}
                  {convRowsFiltered.slice(0, 60).map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.text, fontWeight: 600 }}>
                        {r.description}
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
                      <td style={{ padding: "6px 8px", color: C.text }}>{e.eventName}</td>
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
function OverviewDashboard({ selectedClient, dateRange }) {
  const { run: ahrefsRun, refresh: refreshAhrefs } = useEzyLatestRun(selectedClient?.id, "ahrefs");
  const { run: ga4Run, refresh: refreshGa4 } = useEzyLatestRun(selectedClient?.id, "ga4_summary");
  const { run: trafRun, refresh: refreshTraf } = useEzyLatestRun(selectedClient?.id, "ga4_traffic");
  const { run: convRun, refresh: refreshConv } = useEzyLatestRun(
    selectedClient?.id,
    "ga4_conversions",
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
  const aiSeriesRaw = traf?.aiSeries || [];
  const aiSeries = useMemo(() => aiSeriesRaw.slice(-days), [aiSeriesRaw, days]);
  const aiBySource = traf?.aiReferral.bySource || [];
  const COUNTRY_COLORS = [C.accent, C.blue, C.green, C.orange, C.cyan, C.pink, C.textDim];
  // Live GA4 comparison (real YoY/MoM) — falls back to series-based deltas.
  const { data: ovCmpData, deltas: ovLiveDeltas } = useGa4Compare(selectedClient?.id, dateRange);
  const ga4SeriesForDelta = ga4Run ? ga4KpisFromResult(ga4Run.result)?.series || [] : [];
  const sOrganic = useMemo(
    () => seriesDelta(ga4SeriesForDelta, "sessions", dateRange),
    [ga4Run, dateRange],
  );
  const dOrganic = ovLiveDeltas.sessions !== undefined ? ovLiveDeltas.sessions : sOrganic;
  const dAiRef = useMemo(
    () => seriesDelta(aiSeriesRaw, "aiSessions", dateRange),
    [aiSeriesRaw, dateRange],
  );
  const ovCmpName = compareName(dateRange?.compareMode);
  const ovOrganicCmp = ovCmpData?.compare ? Number(ovCmpData.compare.sessions || 0) : undefined;

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

// ═══════════════════════════════════════════════════════════════════════════
// AI VISIBILITY DASHBOARD (KI-Sichtbarkeit, Canonry-backed)
// ═══════════════════════════════════════════════════════════════════════════
const AIVIS_WINDOWS = [
  { id: "7d", label: "7T", days: 7 },
  { id: "30d", label: "30T", days: 30 },
  { id: "90d", label: "90T", days: 90 },
  { id: "all", label: "Alle", days: null },
];
// KI-Sichtbarkeit: neues Report-Dashboard (ai_visibility_*-Tabellen), solange
// kein Report existiert Fallback auf die bestehende Canonry-Ansicht darunter.
// Phase 2 (31.07.): auch von der eigenständigen EzyAI-App (/ezyai) genutzt —
// Komponente umgezogen statt neu gebaut; hier bleibt nur noch der Export.

// Modul 2 (M2.5): Sub-Bereich "AI-Zitationen" im KI-Tab. Nur bei vorhandener
// ai_citations-Zeile. Additiv — bestehender KI-Tab-Inhalt bleibt unveraendert.
const CORPUS_LABELS = {
  "ch-de": "Heimmarkt (Google AI, CH/de)",
  "ch-fr": "Heimmarkt (Google AI, CH/fr)",
  "ch-it": "Heimmarkt (Google AI, CH/it)",
  "int-en": "International (ChatGPT, US/en)",
};
function AiCitationsPanel({ selectedClient }) {
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

function AiVisibilityDashboard({ selectedClient }) {
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
  const seriesAll = result ? aiVisibilitySeriesFromResult(result) : [];
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

// ═══════════════════════════════════════════════════════════════════════════
// ADS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function AdsDashboard({ selectedClient, dateRange }) {
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
                  : `${C.textMuted}22`;
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

// ═══════════════════════════════════════════════════════════════════════════
// AWORK LIST VIEW COMPONENT (like AWORK's native list layout)
// ═══════════════════════════════════════════════════════════════════════════
// AWORK color palette mapping
const AWORK_COLORS = {
  // Status type colors (fallbacks)
  done: "#22c55e",
  closed: "#22c55e",
  completed: "#22c55e",
  progress: "#3b82f6",
  inprogress: "#3b82f6",
  doing: "#3b82f6",
  todo: "#6b7280",
  open: "#6b7280",
  // Named colors from AWORK
  green: "#22c55e",
  blue: "#3b82f6",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
  pink: "#ec4899",
  cyan: "#06b6d4",
  gray: "#6b7280",
  grey: "#6b7280",
};

function AworkListView({
  tasks,
  allTasks,
  tasklists,
  statuses,
  hideDone,
  expandedLists,
  onToggleList,
  onOpenTask,
  onCreateInList,
  fmtDue,
  isDone,
}) {
  // Get status color from AWORK or fallback
  const getStatusColor = (task) => {
    // First try the task's own status color
    if (task.statusColor) {
      return task.statusColor.startsWith("#")
        ? task.statusColor
        : AWORK_COLORS[task.statusColor.toLowerCase()] || task.statusColor;
    }
    // Then try to find from statuses list
    const status = statuses.find((s) => s.id === task.statusId);
    if (status?.color) {
      return status.color.startsWith("#")
        ? status.color
        : AWORK_COLORS[status.color.toLowerCase()] || status.color;
    }
    // Fallback to type-based color
    const t = String(task.statusType || "").toLowerCase();
    return AWORK_COLORS[t] || "#6b7280";
  };

  // Group tasks by list — ALWAYS show all tasklists (even empty ones)
  const tasksByList = useMemo(() => {
    const groups = new Map();
    // First add all known tasklists (always show them)
    for (const list of tasklists) {
      groups.set(list.name, {
        id: list.id,
        name: list.name,
        tasks: [],
        order: list.order ?? 0,
        color: list.color,
      });
    }
    // Add tasks to their lists
    for (const t of tasks) {
      const listName = t.list || "Ohne Liste";
      if (!groups.has(listName)) {
        groups.set(listName, { id: listName, name: listName, tasks: [], order: 999, color: null });
      }
      groups.get(listName).tasks.push(t);
    }
    // Sort by order — show ALL lists including empty ones
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [tasks, tasklists]);

  // Calculate list stats
  const listStats = (listName) => {
    const listTasks = allTasks.filter((t) => (t.list || "Ohne Liste") === listName);
    const done = listTasks.filter((t) => isDone(t.statusType)).length;
    const totalTime = listTasks.reduce((sum, t) => sum + (t.trackedDuration || 0), 0);
    const plannedTime = listTasks.reduce((sum, t) => sum + (t.plannedDuration || 0), 0);
    return { total: listTasks.length, done, totalTime, plannedTime };
  };

  const fmtDuration = (seconds) => {
    if (!seconds || seconds <= 0) return "0h";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}:${String(m).padStart(2, "0")}h`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const fmtDays = (dueOn) => {
    if (!dueOn) return null;
    const d = new Date(dueOn);
    const now = new Date();
    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: `${Math.abs(diff)}d`, overdue: true };
    if (diff === 0) return { label: "Heute", overdue: false };
    return {
      label: d.toLocaleDateString("de-CH", { day: "2-digit", month: "short" }),
      overdue: false,
    };
  };

  if (tasksByList.length === 0) {
    return (
      <div style={{ fontSize: 13, color: C.textMuted, textAlign: "center", padding: "24px 0" }}>
        {hideDone && allTasks.length > 0
          ? "Alle Aufgaben erledigt — Toggle deaktivieren, um sie anzuzeigen."
          : "Keine Aufgaben."}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {tasksByList.map((group) => {
        const stats = listStats(group.name);
        const isExpanded = expandedLists.has(group.name) || expandedLists.size === 0;
        const allDone = stats.total > 0 && stats.done === stats.total;

        return (
          <div key={group.name} style={{ borderBottom: `1px solid ${C.border}` }}>
            {/* List Header */}
            <button
              onClick={() => onToggleList(group.name)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <ChevronDown
                size={16}
                color={C.textMuted}
                style={{
                  transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform .15s",
                }}
              />
              <span style={{ fontSize: 15, fontWeight: 600, color: C.text, flex: 1 }}>
                {group.name}
              </span>
              {/* Stats badges */}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: allDone ? C.green : C.textMuted,
                }}
              >
                <CheckCircle size={13} />
                {stats.done}/{stats.total}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: C.textMuted,
                }}
              >
                <Clock size={13} />
                {fmtDuration(stats.totalTime)}
              </span>
              {stats.plannedTime > 0 && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: C.textMuted,
                  }}
                >
                  <Target size={13} />
                  {fmtDuration(stats.plannedTime)}
                </span>
              )}
            </button>

            {/* Tasks in list */}
            {isExpanded && (
              <div style={{ paddingLeft: 28 }}>
                {/* New Task Input Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    color: C.textDim,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                  onClick={() => onCreateInList(group.id)}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: `2px dashed ${C.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Plus size={12} color={C.textDim} />
                  </div>
                  <span style={{ fontStyle: "italic" }}>Neue Aufgabe</span>
                </div>

                {/* Task Rows */}
                {group.tasks.map((t) => {
                  const due = fmtDays(t.dueOn);
                  const taskDone = isDone(t.statusType);
                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTask(t)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 16px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        transition: "background .1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Status Circle — uses AWORK colors */}
                      {(() => {
                        const sColor = getStatusColor(t);
                        const isProgress = ["progress", "inprogress", "doing"].includes(
                          String(t.statusType || "").toLowerCase(),
                        );
                        return (
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              border: `2px solid ${sColor}`,
                              background: taskDone ? sColor : "transparent",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {taskDone && <Check size={12} color="#fff" />}
                            {!taskDone && isProgress && <ArrowRight size={10} color={sColor} />}
                          </div>
                        );
                      })()}

                      {/* Task Name + Subtask indicator */}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: taskDone ? C.textMuted : C.text,
                            textDecoration: taskDone ? "line-through" : "none",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {t.name}
                        </span>
                        {t.hasSubtasks && (
                          <span
                            style={{
                              fontSize: 11,
                              color: C.textDim,
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              flexShrink: 0,
                            }}
                          >
                            <ChevronDown size={10} style={{ transform: "rotate(-90deg)" }} />
                            {t.subtasksDoneCount}/{t.subtasksCount}
                          </span>
                        )}
                      </div>

                      {/* Priority Flag */}
                      {t.isPrio && (
                        <span
                          style={{ color: C.red, fontSize: 14, flexShrink: 0 }}
                          title="Priorität"
                        >
                          🚩
                        </span>
                      )}

                      {/* Subtasks badge */}
                      {t.subtasksCount > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: C.textMuted,
                            flexShrink: 0,
                          }}
                        >
                          <Layers size={12} />
                          {t.subtasksDoneCount}/{t.subtasksCount}
                        </span>
                      )}

                      {/* Time tracked */}
                      {t.trackedDuration > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: C.textMuted,
                            flexShrink: 0,
                          }}
                        >
                          <Clock size={12} />
                          {fmtDuration(t.trackedDuration)}
                        </span>
                      )}

                      {/* Due Date */}
                      {due && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: due.overdue ? C.red : C.textMuted,
                            fontWeight: due.overdue ? 600 : 400,
                            flexShrink: 0,
                          }}
                        >
                          <Calendar size={12} />
                          {due.label}
                        </span>
                      )}

                      {/* Comments badge */}
                      {t.commentsCount > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: C.textMuted,
                            flexShrink: 0,
                          }}
                        >
                          <MessageSquare size={12} />
                          {t.commentsCount}
                        </span>
                      )}

                      {/* Assignees */}
                      {t.assignees?.length > 0 && (
                        <div style={{ display: "flex", flexShrink: 0 }}>
                          {t.assignees.slice(0, 2).map((a, i) => (
                            <span
                              key={a.id || i}
                              title={a.name}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: C.accentDim,
                                color: C.accentLight,
                                fontSize: 9,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginLeft: i === 0 ? 0 : -8,
                                border: `2px solid ${C.bg}`,
                              }}
                            >
                              {a.initials}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}

                {group.tasks.length === 0 && (
                  <div
                    style={{
                      padding: "12px 16px",
                      fontSize: 12,
                      color: C.textDim,
                      fontStyle: "italic",
                    }}
                  >
                    Keine Aufgaben in Liste.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TASKS (AWORK) DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function TasksDashboard({ selectedClient }) {
  const toast = useToast();
  const { run, loading, refresh } = useEzyLatestRun(selectedClient?.id, "awork_tasks");
  const { project, projects, statuses, tasklists, tasks, counts, note } = aworkTasksFromResult(
    run?.result,
  );
  const [pulling, setPulling] = useState(false);
  const [err, setErr] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [hideDone, setHideDone] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [aworkUsers, setAworkUsers] = useState([]);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [expandedLists, setExpandedLists] = useState(new Set());
  const [createInList, setCreateInList] = useState(null);

  const pull = async () => {
    if (!selectedClient?.id) return;
    setPulling(true);
    setErr("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/awork/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId: selectedClient.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) setErr(j.error || "Abruf fehlgeschlagen");
      await refresh();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setPulling(false);
    }
  };

  // Load AWORK users for assignee dropdown
  const loadUsers = useCallback(async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/awork/users", {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) setAworkUsers(j.users || []);
    } catch {}
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Load task details
  const loadTaskDetail = async (taskId) => {
    setTaskLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/awork/task?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) setTaskDetail(j);
      else toast(j.error || "Fehler beim Laden", "error");
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setTaskLoading(false);
    }
  };

  // Update task (status, assignees, etc.)
  const updateTask = async (taskId, updates) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/awork/task?taskId=${encodeURIComponent(taskId)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || "Update fehlgeschlagen");
      toast("Aktualisiert", "success");
      await loadTaskDetail(taskId);
      await pull(); // Refresh board
    } catch (e) {
      toast(String(e?.message || e), "error");
    }
  };

  // Add comment
  const addComment = async (taskId, message) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/awork/task?taskId=${encodeURIComponent(taskId)}&action=comment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || "Kommentar fehlgeschlagen");
      toast("Kommentar hinzugefügt", "success");
      await loadTaskDetail(taskId);
    } catch (e) {
      toast(String(e?.message || e), "error");
    }
  };

  // Toggle checklist item
  const toggleChecklist = async (taskId, itemId, isDone) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      await fetch(`/api/awork/task?taskId=${encodeURIComponent(taskId)}&action=checklist-toggle`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemId, isDone }),
      });
      await loadTaskDetail(taskId);
    } catch {}
  };

  // Create new task
  const createTask = async (data) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/awork/create-task", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || "Erstellen fehlgeschlagen");
      toast("Task erstellt", "success");
      setShowCreateTask(false);
      await pull();
    } catch (e) {
      toast(String(e?.message || e), "error");
    }
  };

  const openTask = (task) => {
    setSelectedTask(task);
    setTaskDetail(null);
    loadTaskDetail(task.id);
  };

  const closeTask = () => {
    setSelectedTask(null);
    setTaskDetail(null);
  };

  const doneTypes = new Set(["done", "closed", "completed"]);
  const isDone = (type) => doneTypes.has(String(type || "").toLowerCase());
  const statusColor = (type) => {
    const t = String(type || "").toLowerCase();
    if (["done", "closed", "completed"].includes(t)) return C.green;
    if (["progress", "inprogress", "doing"].includes(t)) return C.blue;
    return C.textMuted;
  };

  // Small pill toggle to hide finished tasks / completed projects.
  const HideDoneToggle = () => (
    <button
      onClick={() => setHideDone((v) => !v)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        background: hideDone ? C.accentDim : C.card,
        border: `1px solid ${hideDone ? C.accent : C.border}`,
        borderRadius: 8,
        padding: "7px 11px",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 600,
        color: hideDone ? C.accentLight : C.textMuted,
      }}
      title={hideDone ? "Erledigte einblenden" : "Erledigte ausblenden"}
    >
      {hideDone ? <Eye size={14} /> : <Eye size={14} style={{ opacity: 0.5 }} />}
      Erledigte ausblenden
    </button>
  );
  const fmtDue = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const overdue = d < new Date();
    return { label: d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }), overdue };
  };

  if (loading) return <div style={{ color: C.textMuted, padding: 20 }}>Lade Aufgaben…</div>;

  const hasData = !!project && tasks.length >= 0 && run;
  if (!hasData) {
    return (
      <LiveEmptyState
        title="Noch keine AWORK-Aufgaben"
        hint={
          'Aufgaben werden über den AWORK-Projektnamen dem Kunden zugeordnet. Klicke "Aktualisieren", um das passende Projekt zu laden.'
        }
        action={
          <Btn onClick={pull} disabled={pulling}>
            {pulling ? "Lädt…" : "⟳ Aktualisieren"}
          </Btn>
        }
      />
    );
  }

  // Multiple projects → show project picker first
  const hasMultipleProjects = projects.length > 1;
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : hasMultipleProjects
      ? null
      : projects[0] || null;

  // Filter tasks to selected project (by projectId, fallback to name) and drop finished tasks.
  const projectTasksAll = selectedProject
    ? tasks.filter((t) =>
        t.projectId
          ? String(t.projectId) === String(selectedProject.id)
          : t.project === selectedProject.name,
      )
    : tasks;
  // Filter tasklists to the selected project so empty lists from other projects don't appear.
  const projectTasklists = selectedProject
    ? tasklists.filter((l) =>
        l.projectId
          ? String(l.projectId) === String(selectedProject.id)
          : l.projectName === selectedProject.name,
      )
    : tasklists;
  const projectTasks = hideDone
    ? projectTasksAll.filter((t) => !isDone(t.statusType))
    : projectTasksAll;
  const projectDone = projectTasksAll.filter((t) => isDone(t.statusType)).length;
  // Hide done-type columns when erledigte ausgeblendet sind.
  const cols = (
    statuses.length > 0
      ? statuses
      : [
          ...new Map(
            projectTasks.map((t) => [
              t.statusName,
              { id: t.statusId, name: t.statusName, type: t.statusType },
            ]),
          ).values(),
        ]
  ).filter((c) => !hideDone || !isDone(c.type));
  const tasksByStatus = (name) => projectTasks.filter((t) => t.statusName === name);

  // Project card stats helper
  const projectStats = (projName) => {
    const pTasks = tasks.filter((t) => t.project === projName);
    const pDone = pTasks.filter((t) => isDone(t.statusType)).length;
    return {
      total: pTasks.length,
      done: pDone,
      allDone: pTasks.length > 0 && pDone === pTasks.length,
    };
  };

  // Show project overview if multiple projects and none selected
  if (hasMultipleProjects && !selectedProject) {
    const visibleProjects = hideDone
      ? projects.filter((p) => !projectStats(p.name).allDone)
      : projects;
    const hiddenCount = projects.length - visibleProjects.length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
              {project?.name || "Projekte"}
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
              {projects.length} Projekte · {counts.total} Aufgaben gesamt
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <HideDoneToggle />
            <Btn onClick={pull} disabled={pulling}>
              {pulling ? "Lädt…" : "⟳ Aktualisieren"}
            </Btn>
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}
        {note && (
          <div
            style={{
              fontSize: 13,
              color: C.textMuted,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            {note}
          </div>
        )}

        {/* Project cards grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {visibleProjects.map((proj) => {
            const stats = projectStats(proj.name);
            const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
            return (
              <button
                key={proj.id}
                onClick={() => setSelectedProjectId(proj.id)}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 18,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "border-color .15s, background .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = C.accent;
                  e.currentTarget.style.background = C.cardHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.background = C.card;
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: C.accentDim,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Layers size={18} color={C.accent} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>
                    {proj.name}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 12, color: C.textMuted }}>{stats.total} Aufgaben</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: pct === 100 ? C.green : C.textMuted,
                    }}
                  >
                    {pct}% erledigt
                  </span>
                </div>
                <div
                  style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: pct === 100 ? C.green : C.accent,
                      transition: "width .3s",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <div style={{ fontSize: 12, color: C.textDim }}>
            {hiddenCount} abgeschlossene{hiddenCount === 1 ? "s Projekt" : " Projekte"} ausgeblendet
          </div>
        )}
        {visibleProjects.length === 0 && (
          <div style={{ fontSize: 13, color: C.textMuted, textAlign: "center", padding: "24px 0" }}>
            Alle Projekte abgeschlossen — Toggle deaktivieren, um sie anzuzeigen.
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {hasMultipleProjects && (
            <button
              onClick={() => setSelectedProjectId(null)}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              title="Zurück zur Übersicht"
            >
              <ChevronLeft size={16} color={C.textMuted} />
            </button>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
              {selectedProject?.name || project?.name || "Kein Projekt zugeordnet"}
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
              {projectTasksAll.length} Aufgaben · {projectDone} erledigt
              {selectedProject ? " · AWORK" : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <HideDoneToggle />
          {selectedProject && (
            <Btn icon={Plus} onClick={() => setShowCreateTask(true)}>
              Neue Aufgabe
            </Btn>
          )}
          <Btn onClick={pull} disabled={pulling}>
            {pulling ? "Lädt…" : "⟳ Aktualisieren"}
          </Btn>
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}
      {note && !selectedProject && (
        <div
          style={{
            fontSize: 13,
            color: C.textMuted,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          {note}
        </div>
      )}

      {/* AWORK-Style List View */}
      <AworkListView
        tasks={projectTasks}
        allTasks={projectTasksAll}
        tasklists={projectTasklists}
        statuses={statuses}
        hideDone={hideDone}
        expandedLists={expandedLists}
        onToggleList={(listName) =>
          setExpandedLists((prev) => {
            const next = new Set(prev);
            if (next.has(listName)) next.delete(listName);
            else next.add(listName);
            return next;
          })
        }
        onOpenTask={openTask}
        onCreateInList={(listId) => {
          setCreateInList(listId);
          setShowCreateTask(true);
        }}
        fmtDue={fmtDue}
        isDone={isDone}
      />

      {/* Task Detail Modal */}
      {selectedTask && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => e.target === e.currentTarget && closeTask()}
        >
          <div
            style={{
              background: C.surface,
              borderRadius: 16,
              width: "100%",
              maxWidth: 640,
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,.5)",
            }}
          >
            {taskLoading && !taskDetail ? (
              <div style={{ padding: 40, textAlign: "center" }}>
                <Skeleton w="60%" h={20} />
                <div style={{ marginTop: 16 }}>
                  <Skeleton w="90%" h={14} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Skeleton w="75%" h={14} />
                </div>
              </div>
            ) : taskDetail?.task ? (
              <TaskDetailContent
                task={taskDetail.task}
                comments={taskDetail.comments || []}
                statuses={statuses}
                users={aworkUsers}
                onClose={closeTask}
                onUpdateStatus={(statusId) =>
                  updateTask(taskDetail.task.id, { taskStatusId: statusId })
                }
                onUpdateAssignees={(ids) => updateTask(taskDetail.task.id, { assigneeIds: ids })}
                onAddComment={(msg) => addComment(taskDetail.task.id, msg)}
                onToggleChecklist={(itemId, isDone) =>
                  toggleChecklist(taskDetail.task.id, itemId, isDone)
                }
              />
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: C.textMuted }}>
                Fehler beim Laden
                <div style={{ marginTop: 12 }}>
                  <Btn onClick={closeTask}>Schliessen</Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateTask && selectedProject && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateTask(false);
              setCreateInList(null);
            }
          }}
        >
          <CreateTaskModal
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            statuses={statuses}
            tasklists={projectTasklists}
            users={aworkUsers}
            defaultListId={createInList}
            onClose={() => {
              setShowCreateTask(false);
              setCreateInList(null);
            }}
            onCreate={createTask}
          />
        </div>
      )}
    </div>
  );
}

// Task Detail Content Component
function TaskDetailContent({
  task,
  comments,
  statuses,
  users,
  onClose,
  onUpdateStatus,
  onUpdateAssignees,
  onAddComment,
  onToggleChecklist,
}) {
  const [newComment, setNewComment] = useState("");
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const [mentions, setMentions] = useState([]); // [{name, userId}]
  const [mentionQuery, setMentionQuery] = useState(null); // null = closed, "" = just typed @
  const commentInputRef = useRef(null);

  // Detect @ to open the mention picker
  const onCommentChange = (e) => {
    const val = e.target.value;
    setNewComment(val);
    // Find an @ token at the caret that has no space after it yet
    const caret = e.target.selectionStart;
    const upToCaret = val.slice(0, caret);
    const match = upToCaret.match(/@([\wäöüÄÖÜß]*)$/);
    if (match) setMentionQuery(match[1]);
    else setMentionQuery(null);
  };

  const insertMention = (user) => {
    // Replace the trailing "@query" with "@Name " and remember the mention
    const caret = commentInputRef.current?.selectionStart ?? newComment.length;
    const upToCaret = newComment.slice(0, caret);
    const rest = newComment.slice(caret);
    const newUpTo = upToCaret.replace(/@([\wäöüÄÖÜß]*)$/, `@${user.name} `);
    setNewComment(newUpTo + rest);
    setMentions((prev) =>
      prev.some((m) => m.userId === user.id)
        ? prev
        : [...prev, { name: user.name, userId: user.id }],
    );
    setMentionQuery(null);
    setTimeout(() => commentInputRef.current?.focus(), 0);
  };

  const handleComment = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    // Convert "@Name" occurrences into AWORK mention tokens ~[userId:xxx]
    let message = newComment.trim();
    for (const m of mentions) {
      message = message.split(`@${m.name}`).join(`~[userId:${m.userId}]`);
    }
    await onAddComment(message);
    setNewComment("");
    setMentions([]);
    setMentionQuery(null);
    setSending(false);
  };

  const mentionMatches =
    mentionQuery !== null
      ? users.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

  const doneTypes = new Set(["done", "closed", "completed"]);
  const isDone = doneTypes.has(String(task.taskStatus?.type || "").toLowerCase());

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const userById = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  const stripHtml = (html) => {
    if (!html) return "";
    let text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    // Convert AWORK mention tokens ~[userId:xxx] back to @Name
    text = text.replace(
      /~\[userId:([0-9a-f-]+)\]/gi,
      (_, id) => `@${userById.get(id) || "Unbekannt"}`,
    );
    text = text.replace(/~\[(task|project|workspace)\]/gi, (_, t) => `@${t}`);
    return text.trim();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            {task.isPrio && <span style={{ color: C.orange, fontSize: 16 }}>★</span>}
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{task.name}</h2>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {task.project?.name || "—"} {task.list && `· ${task.list}`}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
        >
          <X size={20} color={C.textMuted} />
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Status & Assignees Row */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Status */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Status
            </div>
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: isDone ? `${C.green}20` : C.card,
                border: `1px solid ${isDone ? C.green : C.border}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: isDone ? C.green : C.text,
                fontFamily: "inherit",
              }}
            >
              {isDone ? <CheckCircle size={14} /> : <Clock size={14} />}
              {task.taskStatus?.name || "—"}
              <ChevronDown size={12} />
            </button>
            {showStatusDropdown && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 6,
                  minWidth: 180,
                  zIndex: 10,
                  boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                }}
              >
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onUpdateStatus(s.id);
                      setShowStatusDropdown(false);
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
                      background: s.id === task.taskStatusId ? C.accentDim : "transparent",
                      color: s.id === task.taskStatusId ? C.accentLight : C.text,
                      fontWeight: s.id === task.taskStatusId ? 600 : 400,
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assignees */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Zugewiesen
            </div>
            <button
              onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                color: C.text,
                fontFamily: "inherit",
              }}
            >
              <Users size={14} color={C.textMuted} />
              {task.assignees?.length > 0 ? (
                <span>{task.assignees.map((a) => a.name || a.initials).join(", ")}</span>
              ) : (
                <span style={{ color: C.textMuted }}>Niemand</span>
              )}
              <ChevronDown size={12} color={C.textMuted} />
            </button>
            {showAssigneeDropdown && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 6,
                  minWidth: 220,
                  maxHeight: 280,
                  overflowY: "auto",
                  zIndex: 10,
                  boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                }}
              >
                {users.map((u) => {
                  const assigned = task.assignees?.some((a) => a.id === u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        const newIds = assigned
                          ? task.assignees.filter((a) => a.id !== u.id).map((a) => a.id)
                          : [...(task.assignees || []).map((a) => a.id), u.id];
                        onUpdateAssignees(newIds);
                        setShowAssigneeDropdown(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        textAlign: "left",
                        fontFamily: "inherit",
                        background: assigned ? C.accentDim : "transparent",
                        color: assigned ? C.accentLight : C.text,
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: assigned ? C.accent : C.border,
                          color: assigned ? "#fff" : C.textMuted,
                          fontSize: 10,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {u.initials}
                      </span>
                      <span>{u.name}</span>
                      {assigned && <CheckCircle size={14} style={{ marginLeft: "auto" }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Due Date */}
          <div>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Fällig
            </div>
            <div
              style={{
                padding: "8px 12px",
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                fontSize: 13,
                color: task.dueOn && new Date(task.dueOn) < new Date() ? C.red : C.text,
              }}
            >
              {fmtDate(task.dueOn)}
            </div>
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Beschreibung
            </div>
            <div
              style={{
                padding: 16,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                fontSize: 13,
                color: C.text,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {stripHtml(task.description) || "—"}
            </div>
          </div>
        )}

        {/* Checklist */}
        {task.checklist?.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Checkliste ({task.checklist.filter((c) => c.isDone).length}/{task.checklist.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {task.checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onToggleChecklist(item.id, !item.isDone)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    fontFamily: "inherit",
                    color: item.isDone ? C.textMuted : C.text,
                    textDecoration: item.isDone ? "line-through" : "none",
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `2px solid ${item.isDone ? C.green : C.border}`,
                      background: item.isDone ? C.green : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {item.isDone && <Check size={12} color="#fff" />}
                  </div>
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {task.tags?.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: C.textDim,
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              Tags
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {task.tags.map((tag) => (
                <span
                  key={tag.id}
                  style={{
                    padding: "4px 10px",
                    background: tag.color ? `${tag.color}30` : C.accentDim,
                    color: tag.color || C.accent,
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: C.textDim,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: ".5px",
            }}
          >
            Kommentare ({comments.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            {comments.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textDim, padding: "12px 0" }}>
                Noch keine Kommentare
              </div>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 14,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: C.accentDim,
                        color: C.accentLight,
                        fontSize: 10,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {c.createdBy?.initials || "?"}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      {c.createdBy?.name || "Unbekannt"}
                    </span>
                    <span style={{ fontSize: 11, color: C.textDim, marginLeft: "auto" }}>
                      {fmtDate(c.createdOn)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                    {stripHtml(c.message)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Comment */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                ref={commentInputRef}
                value={newComment}
                onChange={onCommentChange}
                placeholder="Kommentar… @ für Erwähnung"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) handleComment();
                  if (e.key === "Escape") setMentionQuery(null);
                }}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  color: C.text,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {/* Mention dropdown */}
              {mentionQuery !== null && mentionMatches.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    marginBottom: 4,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 6,
                    minWidth: 220,
                    maxHeight: 240,
                    overflowY: "auto",
                    zIndex: 20,
                    boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                  }}
                >
                  {mentionMatches.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => insertMention(u)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 13,
                        textAlign: "left",
                        fontFamily: "inherit",
                        background: "transparent",
                        color: C.text,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.accentDim)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: C.accentDim,
                          color: C.accentLight,
                          fontSize: 10,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {u.initials}
                      </span>
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Btn onClick={handleComment} disabled={!newComment.trim() || sending}>
              {sending ? "…" : "Senden"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable date picker field with calendar popup (single date)
function DatePickerField({ value, onChange, placeholder = "Datum wählen" }) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value) : null;
  const [viewMonth, setViewMonth] = useState(() =>
    parsed && !isNaN(parsed) ? parsed.getMonth() : new Date().getMonth(),
  );
  const [viewYear, setViewYear] = useState(() =>
    parsed && !isNaN(parsed) ? parsed.getFullYear() : new Date().getFullYear(),
  );
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = value ? new Date(value) : null;
  const toISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          background: C.card,
          color: value ? C.text : C.textMuted,
          fontSize: 13,
          fontFamily: "inherit",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <Calendar size={14} color={C.textMuted} />
        {value
          ? new Date(value).toLocaleDateString("de-CH", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })
          : placeholder}
        {value && (
          <X
            size={14}
            color={C.textMuted}
            style={{ marginLeft: "auto" }}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          />
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 12,
            zIndex: 200,
            boxShadow: "0 8px 32px rgba(0,0,0,.4)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <button
              type="button"
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
              type="button"
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
            rangeStart={selected}
            rangeEnd={selected}
            hoverDate={null}
            onSelect={(d) => {
              onChange(toISO(d));
              setOpen(false);
            }}
            onHover={() => {}}
          />
        </div>
      )}
    </div>
  );
}

// Create Task Modal Component
function CreateTaskModal({
  projectId,
  projectName,
  statuses,
  tasklists = [],
  users,
  defaultListId,
  onClose,
  onCreate,
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statusId, setStatusId] = useState(statuses[0]?.id || "");
  const [listId, setListId] = useState(defaultListId || "");
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [dueOn, setDueOn] = useState("");
  const [isPrio, setIsPrio] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreate({
      projectId,
      name: name.trim(),
      description: description.trim() || undefined,
      taskStatusId: statusId || undefined,
      taskStatusName: statuses.find((s) => s.id === statusId)?.name || undefined,
      listId: listId || undefined,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
      dueOn: dueOn || undefined,
      isPrio,
    });
    setCreating(false);
  };

  return (
    <div
      style={{
        background: C.surface,
        borderRadius: 16,
        width: "100%",
        maxWidth: 520,
        boxShadow: "0 20px 60px rgba(0,0,0,.5)",
      }}
    >
      <div
        style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Neue Aufgabe</h2>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{projectName}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
        >
          <X size={20} color={C.textMuted} />
        </button>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Name */}
        <div>
          <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>
            Titel *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aufgabe eingeben..."
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>
            Beschreibung
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional..."
            rows={3}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Status & List Row */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>
              Status
            </label>
            <select
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.card,
                color: C.text,
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
              }}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {tasklists.length > 0 && (
            <div style={{ flex: 1 }}>
              <label
                style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}
              >
                Liste
              </label>
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  color: C.text,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              >
                <option value="">Keine Liste</option>
                {tasklists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>
              Fällig am
            </label>
            <DatePickerField value={dueOn} onChange={setDueOn} placeholder="Kein Datum" />
          </div>
        </div>

        {/* Assignees */}
        <div>
          <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>
            Zuweisen an
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {users.slice(0, 10).map((u) => {
              const selected = assigneeIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() =>
                    setAssigneeIds(
                      selected ? assigneeIds.filter((id) => id !== u.id) : [...assigneeIds, u.id],
                    )
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${selected ? C.accent : C.border}`,
                    background: selected ? C.accentDim : "transparent",
                    cursor: "pointer",
                    fontSize: 12,
                    color: selected ? C.accentLight : C.text,
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: selected ? C.accent : C.border,
                      color: selected ? "#fff" : C.textMuted,
                      fontSize: 9,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {u.initials}
                  </span>
                  {u.name.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Priority */}
        <button
          onClick={() => setIsPrio(!isPrio)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${isPrio ? C.orange : C.border}`,
            background: isPrio ? `${C.orange}20` : "transparent",
            cursor: "pointer",
            fontSize: 13,
            color: isPrio ? C.orange : C.textMuted,
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 16 }}>★</span>
          Als Priorität markieren
        </button>
      </div>

      <div
        style={{
          padding: "16px 24px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <Btn variant="secondary" onClick={onClose}>
          Abbrechen
        </Btn>
        <Btn onClick={handleCreate} disabled={!name.trim() || creating}>
          {creating ? "Erstellen…" : "Aufgabe erstellen"}
        </Btn>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RUNNER
// ═══════════════════════════════════════════════════════════════════════════
// Ergebnis-Normalisierung + Darstellung leben seit 2026-08-18 zentral in
// data/toolResult.ts (normalizeToolResult) bzw. ToolResult.jsx / ToolActions.jsx.
function ToolRunner({ tool, onClose, client, onComplete, onSaveDraft, onOpenDraft }) {
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
  // Echter Jobstatus (2026-08-21): asynchrone Agent-Skill-Jobs melden ihren
  // Fortschritt (gestartet/laeuft seit X) — kein statischer Platzhaltertext.
  const [runStatus, setRunStatus] = useState("");
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
    setRunStatus("");
    try {
      const r = await runToolLive(
        tool.id,
        client || { id: "", domain: clientDomain },
        form,
        (m) => {
          if (!closedRef.current) setRunStatus(m);
        },
      );
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
  // EzyRank-Ausbau 2026-08-18: lesbares Ergebnis (Markdown) + Weiterverarbeitung.
  // Zentrale Normalisierung (content/markdown/text/output/result/data + Provider-Formen).
  const resultText = useMemo(
    () => (result?.ok ? normalizeToolResult(result.data).text : null),
    [result],
  );
  const [draftSavedId, setDraftSavedId] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showWp, setShowWp] = useState(false);
  const draftTitle =
    (form.topic || form.title || form.keyword || "").trim() ||
    `${tool.label} — ${client?.name || clientDomain || "Ergebnis"}`;
  const clientIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(client?.id || ""),
  );
  const saveDraft = async () => {
    if (!onSaveDraft || !clientIsUuid || !resultText) return;
    setSavingDraft(true);
    try {
      const type =
        tool.category === "obsidian" || tool.category === "skills-obsidian" ? "note" : "blog";
      const item = await onSaveDraft({
        clientId: client.id,
        title: draftTitle,
        content: resultText,
        type,
        status: "draft",
      });
      setDraftSavedId(item?.id || "ok");
      toast("Als Entwurf gespeichert — zu finden unter Content", "success");
    } catch (e) {
      toast(e?.message || "Speichern fehlgeschlagen", "error");
    } finally {
      setSavingDraft(false);
    }
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
    <>
      <Modal
        open={true}
        onClose={handleClose}
        title={tool.label}
        width={phase === "done" && resultText ? 760 : 560}
      >
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
              {runStatus || "API-Call wird ausgeführt"}
            </div>
          </div>
        )}
        {phase === "done" && (
          <div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <Badge color={liveBadgeColor}>{liveBadgeLabel}</Badge>
            </div>
            {/* Ergebnis + Aktionen (2026-08-18): zentrale Komponenten — Markdown
              bevorzugt, KEINE Kappung, Rohdaten nur in "Technische Details". */}
            <ToolResultView result={result} />
            <ToolActions
              text={resultText}
              raw={result?.data ?? { message: result?.message }}
              filename={`${tool.id}-report.md`}
              notify={toast}
              onSaveDraft={
                result?.ok && resultText && onSaveDraft && clientIsUuid ? saveDraft : undefined
              }
              draftState={{ saved: !!draftSavedId, saving: savingDraft }}
              onOpenEditor={
                draftSavedId && draftSavedId !== "ok" && onOpenDraft
                  ? () => {
                      onOpenDraft(draftSavedId);
                      handleClose();
                    }
                  : undefined
              }
              onWordPress={
                result?.ok && resultText && clientIsUuid ? () => setShowWp(true) : undefined
              }
              onClose={handleClose}
            />
          </div>
        )}
      </Modal>
      {/* Ausserhalb des Modals gerendert: position:fixed darf nicht von der
        fadeScale-Transform-Animation des Modals eingefangen werden. */}
      {showWp && (
        <WordPressPublishModal
          clientId={client.id}
          defaultTitle={draftTitle}
          markdown={resultText || ""}
          onClose={() => setShowWp(false)}
          notify={toast}
          zIndex={300}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TOOLS
// ═══════════════════════════════════════════════════════════════════════════
function ToolsPage({ selectedClient, tools, onSaveDraft, onOpenDraft }) {
  const [goal, setGoal] = useState("all");
  // Tools ohne Live-Anbindung (toolProvider null) sind standardmaessig
  // AUSGEBLENDET und nur ueber den Schalter sichtbar — dort klar markiert.
  const [showUnconnected, setShowUnconnected] = useState(false);
  const [runner, setRunner] = useState(null);
  const {
    runs,
    loading: histLoading,
    refresh: refreshHistory,
  } = useEzyAuditHistory(selectedClient?.id, 25);
  // Kunden-Gates unveraendert: t.enabled kommt aus useEzyToolSettings (client_integrations).
  const enabledTools = useMemo(() => tools.filter((t) => t.enabled), [tools]);
  const goalTools = useMemo(
    () => (goal === "all" ? enabledTools : enabledTools.filter((t) => toolGoalOf(t) === goal)),
    [goal, enabledTools],
  );
  const unconnectedCount = useMemo(
    () => goalTools.filter((t) => !toolHasLiveProvider(t.id)).length,
    [goalTools],
  );
  const visibleTools = useMemo(
    () => goalTools.filter((t) => showUnconnected || toolHasLiveProvider(t.id)),
    [goalTools, showUnconnected],
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
    <div className="tools-shell" style={{ display: "flex", gap: 24 }}>
      <div className="tools-cats" style={{ width: 170, flexShrink: 0 }}>
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
          Was willst du erreichen?
        </div>
        {TOOL_GOALS.map((tc) => {
          const I = tc.icon;
          const a = goal === tc.id;
          const n =
            tc.id === "all"
              ? enabledTools.length
              : enabledTools.filter((t) => toolGoalOf(t) === tc.id).length;
          return (
            <button
              key={tc.id}
              onClick={() => setGoal(tc.id)}
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
        <div
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Tools</h1>
            <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
              {visibleTools.length} Tools • {selectedClient.name}
            </p>
          </div>
          {unconnectedCount > 0 && (
            <label
              style={{
                fontSize: 12,
                color: C.textMuted,
                display: "flex",
                gap: 6,
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showUnconnected}
                onChange={(e) => setShowUnconnected(e.target.checked)}
              />
              Nicht verbundene anzeigen ({unconnectedCount})
            </label>
          )}
        </div>
        {goal === "publish" && (
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 18,
              marginBottom: 14,
              fontSize: 13,
              color: C.textMuted,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 700, color: C.text, marginBottom: 4 }}>
              So veröffentlichst du Inhalte
            </div>
            Tool-Ergebnisse kannst du direkt im Ergebnis-Fenster{" "}
            <strong style={{ color: C.text }}>als Entwurf speichern</strong> oder{" "}
            <strong style={{ color: C.text }}>an WordPress übergeben</strong> (sofern der Kunde
            verbunden ist). Gespeicherte Entwürfe findest du unter{" "}
            <strong style={{ color: C.text }}>Content</strong> — dort gibt es ebenfalls den Button
            «An WordPress veröffentlichen». WordPress verbindet man je Kunde unter Admin → Kunden →
            Onboarding.
          </div>
        )}
        {visibleTools.length === 0 && goal !== "publish" && (
          <div
            style={{
              background: C.card,
              border: `1px dashed ${C.border}`,
              borderRadius: 14,
              padding: "32px 20px",
              textAlign: "center",
              marginBottom: 14,
              fontSize: 13,
              color: C.textMuted,
            }}
          >
            Keine verbundenen Tools in dieser Gruppe.
            {unconnectedCount > 0
              ? " Aktiviere «Nicht verbundene anzeigen», um sie zu sehen — sie sind entsprechend markiert."
              : " Prüfe unter Einstellungen → Tools, ob Tools für diesen Kunden deaktiviert wurden."}
          </div>
        )}
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
                    <div style={{ marginBottom: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Badge color={categoryBadge(tool.category).color}>
                        {categoryBadge(tool.category).label}
                      </Badge>
                      {!toolHasLiveProvider(tool.id) && (
                        <Badge color={C.orange}>Nicht verbunden</Badge>
                      )}
                    </div>
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
          onSaveDraft={onSaveDraft}
          onOpenDraft={onOpenDraft}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: CONTENT (with Editor split-view)
// ═══════════════════════════════════════════════════════════════════════════
// Content Editor (split-view)
// markdownToHtml: seit 2026-08-18 aus @/ezy/lib/markdown importiert (testbar,
// inkl. Href-Quote-Escaping-Fix gegen Attribut-Ausbruch).

function ContentEditor({ item, stCo, stLb, onBack, onSave }) {
  const toast = useToast();
  const [md, setMd] = useState(item.content);
  const [showWpPublish, setShowWpPublish] = useState(false);
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
          {item.clientId && (
            <Btn variant="secondary" size="sm" icon={Globe} onClick={() => setShowWpPublish(true)}>
              WordPress
            </Btn>
          )}
          <Btn size="sm" icon={Save} onClick={() => onSave(item.id, md)}>
            Speichern
          </Btn>
        </div>
      </div>
      {showWpPublish && (
        <WordPressPublishModal
          clientId={item.clientId}
          defaultTitle={item.title}
          markdown={md}
          onClose={() => setShowWpPublish(false)}
          notify={toast}
        />
      )}
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
// Kunden-Reports: zeigt content_items vom Typ "report" des gewählten Kunden,
// für die Viewer-Rolle freigeschaltet. PDF via Print-to-PDF (sauberes Druck-Fenster).
// ── Content-Refresh-Radar ─────────────────────────────────────────────────
// Worklist aus der SQL-View content_decision via rpc('get_content_dashboard').
// Gate/Trend/Empfehlung werden in der DB berechnet (agentenunabhaengig); RLS via
// SECURITY-DEFINER-Gate. Detail-Chart = content_metrics-Zeitreihe (recharts).
const REC_META = {
  not_indexed: {
    t: "Nicht im Google-Index",
    c: C.red,
    a: "Auffindbarkeit herstellen – Content-Massnahmen wirken hier nicht",
  },
  refresh_decay: {
    t: "Decay – Refresh fällig",
    c: C.red,
    a: "Freshness-Update gegen aktuelle SERP",
  },
  tech_fix: {
    t: "Technik prüfen",
    c: C.blue,
    a: "An Tech/Agent (Index/interne Links) – nicht Content",
  },
  consolidate: { t: "Kannibalisierung – zusammenführen", c: C.pink, a: "Zwei Artikel mergen" },
  push_expand: {
    t: "Striking Distance – ausbauen",
    c: C.accent,
    a: "Content erweitern, E-E-A-T, Intent schärfen",
  },
  ctr_fix: {
    t: "Title/Meta optimieren",
    c: C.cyan,
    a: "Snippet überarbeiten (kein Volltext-Refresh)",
  },
  ceiling_new_kw: {
    t: "Keyword-Ceiling – neues Ziel",
    c: C.orange,
    a: "Nicht refreshen – neues KW/Strategie",
  },
  low_visibility: {
    t: "Kaum sichtbar",
    c: C.orange,
    a: "Sichtbarkeit aufbauen: Keyword-Fokus, Intent, interne Links",
  },
  stable_hold: { t: "Stabil", c: C.green, a: "Nichts tun" },
  monitor: { t: "Beobachten", c: C.textMuted, a: "Beobachten" },
  maturing_wait: { t: "Reift noch", c: C.textDim, a: "Warten (< 30 Tage)" },
  insufficient_data: {
    t: "Zu wenig Daten",
    c: C.textDim,
    a: "Beobachten, kein Urteil (Messfenster füllt sich noch)",
  },
  unpublished: { t: "Unpubliziert", c: C.textDim, a: "—" },
};
const ACTION_RECS = [
  "not_indexed",
  "tech_fix",
  "ctr_fix",
  "push_expand",
  "refresh_decay",
  "consolidate",
  "ceiling_new_kw",
  "low_visibility",
];
// Massnahmen-Playbook je Empfehlung (Kurzfassung von content-fix-playbook/fix-procedures.md)
// fuer das Mitarbeiter-Pop-up: Befund -> konkrete Schritte -> Exit-Kriterium.
const REC_PLAYBOOK = {
  not_indexed: {
    befund:
      'Google hat den Artikel nicht im Index — geprüft über die GSC-URL-Prüfung. Steht dort "URL is unknown to Google", hat Google die Seite noch nie gesehen: das ist ein Auffindbarkeits-Problem, kein Qualitätsproblem. Solange das so ist, bleibt JEDE Content-Massnahme wirkungslos.',
    schritte: [
      "Erreichbarkeit bestätigen: Seite liefert HTTP 200, kein noindex, Canonical zeigt auf sich selbst, robots.txt erlaubt den Zugriff.",
      "Sitemap prüfen: Ist der Artikel in der Sitemap UND ist die Sitemap in der Search Console eingereicht? (Ein Eintrag in der robots.txt allein reicht Google oft nicht.)",
      "Interne Verlinkung prüfen — der häufigste Grund: Verlinkt eine bereits indexierte Seite auf den Artikel? Eine Blog-Übersicht, die selbst nicht im Index ist, vererbt nichts. Links von starken, indexierten Seiten setzen.",
      'In der GSC "Indexierung beantragen" für die betroffenen URLs auslösen (manuell, wirkt pro URL).',
      "KEINEN Refresh und keine Title-Optimierung vornehmen — beides ändert am Indexstatus nichts.",
    ],
    exit: 'Artikel in der GSC-URL-Prüfung auf "URL ist auf Google"; Re-Check in 2–3 Wochen.',
  },
  ctr_fix: {
    befund:
      "Gute Position (Top 10), Impressionen vorhanden, aber kaum Klicks — das Problem sitzt im Snippet, nicht im Inhalt.",
    schritte: [
      "SERP für das Ziel-Keyword ansehen: welche Snippets gewinnen den Klick — und warum?",
      "Title neu schreiben: Ziel-Keyword vorn, konkreter Nutzen/Differenzierung, Zahl/Jahr wo sinnvoll, unter 60 Zeichen.",
      "Meta-Description: Suchintention beantworten + klarer Grund zu klicken, 150–160 Zeichen.",
      "KEIN Volltext-Refresh — der Inhalt rankt bereits.",
    ],
    exit: "Neuer Title/Meta nach QA live; Re-Test in 3–4 Wochen auf CTR terminieren.",
  },
  push_expand: {
    befund:
      "Position 11–20 — knapp vor Seite 1. Höchster Refresh-ROI: ein gezielter Schub bringt überproportional Traffic.",
    schritte: [
      "Top 5 der SERP analysieren: welche Subtopics/Fragen decken sie ab, die diesem Artikel fehlen?",
      "Lücken als Answer-first-Blöcke schließen: Frage als H2, Antwort im ersten Satz, 130–170 Wörter.",
      "E-E-A-T stärken: Autor/Quellen/Aktualität sichtbar machen; interne Links von starken Seiten auf diesen Artikel setzen.",
      "Intent schärfen: passt das Format zur Suchintention (Guide vs. Liste vs. Definition)?",
    ],
    exit: "Ausbau live, interne Links gesetzt; Re-Test in 4 Wochen auf Position terminieren.",
  },
  refresh_decay: {
    befund:
      "War gut, fällt jetzt (Decay ab Tag 90) — die SERP hat sich bewegt oder der Inhalt ist veraltet.",
    schritte: [
      "Zuerst Saisonalität prüfen: gleichen Kalendermonat im Vorjahr vergleichen (GSC). Entspricht der Rückgang dem Vorjahresmuster → KEIN Refresh, nur vermerken.",
      "Aktuelle SERP vs. Artikel: was ist bei den Gewinnern neu oder anders?",
      "Veraltetes aktualisieren (Zahlen, Jahr, Fakten), fehlende neue Aspekte ergänzen — Substanz statt Kosmetik.",
      "Modified-Datum sauber setzen; interne Links prüfen.",
    ],
    exit: "Update nach QA live, Refresh datiert; Re-Test in 4 Wochen terminieren.",
  },
  consolidate: {
    befund:
      "Mehrere publizierte Artikel ranken auf demselben Keyword und nehmen sich gegenseitig die Sichtbarkeit (Kannibalisierung).",
    schritte: [
      "Stärkeren Artikel bestimmen (Position, Backlinks, Traffic).",
      "Einzigartige Inhalte des schwächeren Artikels in den stärkeren mergen.",
      "Schwächeren per 301 auf den stärkeren umleiten — Redirect ist strukturell: erst Freigabe einholen, nie eigenmächtig.",
      "Interne Links auf die neue Ziel-URL umbiegen.",
    ],
    exit: "Merge + Redirect live; Re-Test in 4–6 Wochen terminieren.",
  },
  tech_fix: {
    befund:
      "Keine verwertbare Position trotz Sichtbarkeitsdaten — das Problem liegt in der Technik (Indexierung, interne Verlinkung, Crawlbarkeit), nicht im Text.",
    schritte: [
      "Indexierungsstatus prüfen (GSC URL-Prüfung: ist die Seite im Index?).",
      "Interne Verlinkung prüfen: erreichen starke Seiten diesen Artikel?",
      "An Technik/SEO übergeben — an diesem Artikel KEINE Text-Änderung vornehmen.",
    ],
    exit: "Übergabe/Ticket an Technik erstellt; Artikel bleibt unverändert.",
  },
  low_visibility: {
    befund:
      "Über 90 Tage publiziert und volle Messabdeckung, aber unter 100 Impressionen in 28 Tagen — Google zeigt den Artikel kaum. Meist kein Technik-, sondern ein Relevanz-Problem (Keyword ohne Nachfrage, Intent-Mismatch, fehlende interne Links).",
    schritte: [
      "Indexierung einmal bestätigen (GSC URL-Prüfung). Nicht indexiert → als Technik-Fall behandeln.",
      "Saisonalität prüfen: Winterthemen sind im Sommer natürlich unsichtbar — dann nur für die Saison terminieren, nichts ändern.",
      "Ziel-Keyword hinterfragen: hat es Suchvolumen, und deckt der Artikel die Suchintention (Format, Tiefe)? GSC-Top-Query mit dem gemeinten Thema vergleichen.",
      "Interne Links von starken Seiten (Startseite, Hub-Seiten) auf den Artikel setzen — unsichtbare Artikel sind oft Waisen.",
      "Title/H1 auf das Ziel-Keyword schärfen; ggf. auf ein nachgefragtes, angrenzendes Keyword erweitern.",
    ],
    exit: "Massnahmen live; Re-Check in 6–8 Wochen mit Ziel >100 Impressionen/28 Tage.",
  },
  ceiling_new_kw: {
    befund:
      "Rankt bereits top, aber das Keyword hat zu wenig Suchvolumen — ein Refresh bringt hier nichts mehr.",
    schritte: [
      "Keinen Refresh an diesem Artikel durchführen.",
      "Größeres, angrenzendes Ziel-Keyword identifizieren (Keyword-Recherche).",
      "Entscheiden: bestehenden Artikel auf das neue Keyword erweitern ODER zusätzlichen Artikel für die angrenzende Nachfrage planen.",
    ],
    exit: "Neues Keyword-Ziel an Strategie/Content-Planung übergeben.",
  },
};
const TREND_META = {
  steigend_stabil: { c: C.green, t: "steigend/stabil" },
  stabil: { c: C.orange, t: "stabil" },
  decay: { c: C.red, t: "Decay" },
  kein_traffic: { c: C.textDim, t: "kein Traffic" },
};

function RefreshDetailChart({ item }) {
  const [series, setSeries] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("content_metrics")
        .select("captured_on, clicks, position")
        .eq("content_item_id", item.id)
        .order("captured_on", { ascending: true });
      if (alive) setSeries(data || []);
    })();
    return () => {
      alive = false;
    };
  }, [item.id]);
  if (!series)
    return <div style={{ color: C.textMuted, fontSize: 12.5, padding: 16 }}>Zeitreihe lädt…</div>;
  if (!series.length)
    return (
      <div style={{ color: C.textMuted, fontSize: 12.5, padding: 16 }}>
        Noch keine Metriken erfasst — der tägliche Sync füllt die Daten.
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={series} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="captured_on" tick={{ fill: C.textDim, fontSize: 11 }} minTickGap={26} />
        <YAxis yAxisId="l" tick={{ fill: C.textDim, fontSize: 11 }} />
        <YAxis yAxisId="r" orientation="right" reversed tick={{ fill: C.textDim, fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12,
            color: C.text,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          yAxisId="l"
          type="monotone"
          dataKey="clicks"
          stroke={C.green}
          strokeWidth={2}
          dot={false}
          name="Klicks"
        />
        <Line
          yAxisId="r"
          type="monotone"
          dataKey="position"
          stroke={C.accent}
          strokeWidth={2}
          dot={false}
          name="Position (invers)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RefreshRadar({ selectedClient }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyAction, setOnlyAction] = useState(false);
  const [detail, setDetail] = useState(null);
  const [playbook, setPlaybook] = useState(null); // Zeile fuer Massnahmen-Pop-up
  // Artikel-spezifische KI-Empfehlung je content_item_id: {loading|text|error}.
  // Bleibt im State gecacht, damit erneutes Oeffnen nicht erneut generiert (Kosten).
  const [briefs, setBriefs] = useState({});
  const generateBrief = useCallback(
    async (row) => {
      setBriefs((p) => ({ ...p, [row.id]: { loading: true } }));
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch("/api/content/refresh-brief", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientId: selectedClient.id, contentItemId: row.id }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setBriefs((p) => ({ ...p, [row.id]: { text: j.content } }));
      } catch (e) {
        setBriefs((p) => ({ ...p, [row.id]: { error: e?.message || "Analyse fehlgeschlagen" } }));
      }
    },
    [selectedClient?.id],
  );
  // Google-Verbindungsstatus: erklaert "keine Metriken" ehrlich (Token fehlt/abgelaufen)
  // statt sie als "kein Traffic" aussehen zu lassen. null = unbekannt -> kein Banner.
  const [gConn, setGConn] = useState(null);
  useEffect(() => {
    let alive = true;
    setGConn(null);
    if (!selectedClient?.id) return undefined;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch("/api/google/connection", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientId: selectedClient.id }),
        });
        const j = await r.json().catch(() => null);
        if (alive && r.ok && j) setGConn(j);
      } catch {
        /* Status unbekannt -> kein Banner */
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedClient?.id]);
  const connHint = !selectedClient?.id
    ? null
    : gConn && !gConn.connected
      ? "Google ist für diesen Kunden nicht verbunden — GSC/GA4-Metriken können nicht erfasst werden. Verbinden unter Onboarding → Google."
      : gConn?.connected && !selectedClient?.gscSiteUrl
        ? "Keine GSC-Property hinterlegt — Ranking-Metriken (Klicks/Impressionen/Position) bleiben leer. Property im Kunden-Profil eintragen."
        : null;
  const reload = useCallback(async () => {
    if (!selectedClient?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_content_dashboard", {
      p_client_id: selectedClient.id,
    });
    setRows(error ? [] : data || []);
    setLoading(false);
  }, [selectedClient?.id]);
  useEffect(() => {
    reload();
  }, [reload]);
  const shown = useMemo(
    () => rows.filter((r) => !onlyAction || ACTION_RECS.includes(r.recommendation)),
    [rows, onlyAction],
  );

  if (!selectedClient?.id)
    return (
      <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>
        Wähle einen Kunden, um den Refresh-Radar zu sehen.
      </div>
    );

  // Datenstatus (EzyRank-Ausbau 2026-08-18): letzter Index-Check als ehrlicher
  // Sync-Zeitpunkt (täglicher Content-Sync schreibt ihn); Google-Verbindung separat.
  const lastSync = rows.reduce((acc, r) => {
    const t = r?.index_checked_at ? new Date(r.index_checked_at).getTime() : 0;
    return t > acc ? t : acc;
  }, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DataStatus
        items={[
          {
            source: "Blog-Artikel (Content-Sync)",
            lastAt: lastSync ? new Date(lastSync).toISOString() : null,
            staleDays: 3,
            state: rows.length && !lastSync ? "present" : undefined,
            detail: loading ? "lädt…" : `${rows.length} publizierte Artikel`,
          },
          gConn == null
            ? null
            : {
                source: "Google (GSC/GA4)",
                state: gConn.connected ? "connected" : "disconnected",
              },
        ].filter(Boolean)}
        action={{
          label: "Daten neu laden",
          kind: "reload",
          title:
            "Liest nur den gespeicherten Datenbankstand neu — den Content-Sync fährt der tägliche Lauf",
          onClick: () => void reload(),
        }}
        hint={
          gConn && !gConn.connected ? "Verbinden: Admin → Kunden → Onboarding → Google" : undefined
        }
      />
      {connHint ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            padding: "10px 14px",
            borderRadius: 10,
            background: C.orange + "1a",
            border: `1px solid ${C.orange}55`,
            fontSize: 12.5,
            color: C.text,
          }}
        >
          <AlertCircle size={16} color={C.orange} style={{ flexShrink: 0 }} />
          <span>{connHint}</span>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, color: C.textMuted }}>
          {loading ? "lädt…" : `${shown.length} von ${rows.length} publizierten Artikeln`}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label
            style={{
              fontSize: 12.5,
              color: C.textMuted,
              display: "flex",
              gap: 6,
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={onlyAction}
              onChange={(e) => setOnlyAction(e.target.checked)}
            />
            Nur handlungsbedürftig
          </label>
          <Btn
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={reload}
            title="Liest nur den gespeicherten Datenbankstand neu"
          >
            Daten neu laden
          </Btn>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>Lade Refresh-Daten…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <RefreshCw size={30} color={C.textDim} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Nichts zu tun</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              Keine handlungsbedürftigen Artikel — oder noch keine Metriken. Der tägliche Sync füllt
              die Daten.
            </div>
          </div>
        ) : (
          shown.map((r, i) => {
            const rec = REC_META[r.recommendation] || {
              t: r.recommendation,
              c: C.textMuted,
              a: "",
            };
            const tr = TREND_META[r.trend] || { c: C.textDim, t: r.trend || "—" };
            const open = detail === r.id;
            return (
              <div
                key={r.id}
                style={{ borderBottom: i < shown.length - 1 ? `1px solid ${C.border}` : "none" }}
              >
                <div
                  onClick={() => setDetail(open ? null : r.id)}
                  style={{
                    padding: "13px 18px",
                    display: "grid",
                    gridTemplateColumns: "1.6fr 1fr auto 14px 1.5fr auto",
                    gap: 12,
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: C.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.title}
                    </div>
                    {r.url ? (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: C.textDim,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.url}
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: C.textMuted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.primary_keyword || "—"}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.textDim,
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: "2px 7px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.gate}
                  </span>
                  <span
                    title={tr.t}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: tr.c,
                      display: "inline-block",
                    }}
                  />
                  <span
                    title={REC_PLAYBOOK[r.recommendation] ? "Klicken für Maßnahme" : undefined}
                    onClick={
                      REC_PLAYBOOK[r.recommendation]
                        ? (e) => {
                            e.stopPropagation();
                            setPlaybook(r);
                          }
                        : undefined
                    }
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: rec.c,
                      background: rec.c + "1f",
                      borderRadius: 7,
                      padding: "3px 9px",
                      whiteSpace: "nowrap",
                      justifySelf: "start",
                      cursor: REC_PLAYBOOK[r.recommendation] ? "pointer" : "default",
                      textDecoration: REC_PLAYBOOK[r.recommendation] ? "underline dotted" : "none",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {rec.t}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: C.textDim,
                      whiteSpace: "nowrap",
                      justifySelf: "end",
                    }}
                  >
                    {r.age_days != null ? `${r.age_days} T` : "—"}
                  </span>
                </div>
                {open ? (
                  <div
                    style={{
                      padding: "0 18px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 12.5, color: C.textMuted }}>
                        <b style={{ color: rec.c }}>{rec.t}</b>
                        {rec.a ? ` — ${rec.a}` : ""} · Klicks 28T:{" "}
                        <b style={{ color: C.text }}>{r.clicks_28 ?? 0}</b> (Peak{" "}
                        {r.peak_clicks_28 ?? 0}) · Ø-Pos: {r.position_28 ?? "—"} · Impr 28T:{" "}
                        {r.impr_28 ?? 0}
                        {r.measured_days_28 != null && r.measured_days_28 < 28
                          ? ` · erst ${r.measured_days_28} von 28 Messtagen`
                          : ""}
                        {r.language ? ` · ${String(r.language).toUpperCase()}` : ""}
                      </div>
                      {REC_PLAYBOOK[r.recommendation] ? (
                        <Btn variant="secondary" size="sm" onClick={() => setPlaybook(r)}>
                          Maßnahme anzeigen
                        </Btn>
                      ) : null}
                    </div>
                    <RefreshDetailChart item={r} />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {playbook
        ? (() => {
            const pb = REC_PLAYBOOK[playbook.recommendation];
            const rec = REC_META[playbook.recommendation] || {
              t: playbook.recommendation,
              c: C.textMuted,
            };
            if (!pb) return null;
            return (
              <Modal
                open
                onClose={() => setPlaybook(null)}
                title={`Maßnahme: ${rec.t}`}
                width={620}
              >
                <div
                  style={{
                    padding: "18px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                      {playbook.title}
                    </div>
                    {playbook.url ? (
                      <a
                        href={playbook.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: C.accent, wordBreak: "break-all" }}
                      >
                        {playbook.url}
                      </a>
                    ) : null}
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
                      Keyword: <b style={{ color: C.text }}>{playbook.primary_keyword || "—"}</b> ·
                      Klicks 28T: <b style={{ color: C.text }}>{playbook.clicks_28 ?? 0}</b> (Peak{" "}
                      {playbook.peak_clicks_28 ?? 0}) · Ø-Pos: {playbook.position_28 ?? "—"} · Impr
                      28T: {playbook.impr_28 ?? 0}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: rec.c + "14",
                      border: `1px solid ${rec.c}44`,
                      fontSize: 12.5,
                      color: C.text,
                      lineHeight: 1.55,
                    }}
                  >
                    <b style={{ color: rec.c }}>Befund:</b> {pb.befund}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: C.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      So gehst du vor
                    </div>
                    <ol
                      style={{
                        margin: 0,
                        paddingLeft: 20,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {pb.schritte.map((s, i) => (
                        <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: C.green + "14",
                      border: `1px solid ${C.green}44`,
                      fontSize: 12.5,
                      color: C.text,
                      lineHeight: 1.55,
                    }}
                  >
                    <b style={{ color: C.green }}>Fertig, wenn:</b> {pb.exit}
                  </div>
                  {(() => {
                    const brief = briefs[playbook.id];
                    return (
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: C.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Konkrete Empfehlung für diesen Artikel
                          </div>
                          {!brief?.text ? (
                            <Btn
                              variant="secondary"
                              size="sm"
                              icon={Sparkles}
                              disabled={!!brief?.loading}
                              onClick={() => generateBrief(playbook)}
                            >
                              {brief?.loading
                                ? "Analysiere…"
                                : brief?.error
                                  ? "Nochmal versuchen"
                                  : "Mit KI erstellen"}
                            </Btn>
                          ) : null}
                        </div>
                        {brief?.loading ? (
                          <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.55 }}>
                            Der Artikel wird live von der Kundenseite geladen und zusammen mit den
                            28-Tage-Zahlen analysiert — dauert ca. 20–30 Sekunden…
                          </div>
                        ) : brief?.error ? (
                          <div style={{ fontSize: 12.5, color: C.red, lineHeight: 1.55 }}>
                            {brief.error}
                          </div>
                        ) : brief?.text ? (
                          <div
                            style={{
                              fontSize: 13,
                              color: C.text,
                              lineHeight: 1.65,
                              maxHeight: 340,
                              overflowY: "auto",
                              padding: "4px 2px",
                            }}
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(brief.text) }}
                          />
                        ) : (
                          <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.55 }}>
                            Lädt den Live-Artikel (Title, Meta, Überschriften) und die GSC-Zahlen
                            und erstellt daraus einen Massnahmenplan mit konkreten
                            Formulierungsvorschlägen — z. B. neue Title-Varianten, fehlende
                            Themen-Abschnitte oder zu aktualisierende Inhalte.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </Modal>
            );
          })()
        : null}
    </div>
  );
}

function ReportsPage({ items, selectedClient }) {
  const reports = useMemo(
    () =>
      (items || [])
        .filter(
          (it) =>
            it.type === "report" && (!selectedClient?.id || it.clientId === selectedClient.id),
        )
        .sort((a, b) =>
          String(b.updatedAt || b.createdAt || "").localeCompare(
            String(a.updatedAt || a.createdAt || ""),
          ),
        ),
    [items, selectedClient],
  );
  const [sel, setSel] = useState(null);
  const current = reports.find((r) => r.id === sel) || reports[0] || null;

  const printReport = (rep) => {
    if (!rep) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const body = markdownToHtml(rep.content || "");
    const title = String(rep.title || "Report").replace(/</g, "&lt;");
    const meta = `${selectedClient?.name || ""} · ${rep.updatedAt || rep.createdAt || ""}`;
    w.document.write(
      `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>` +
        `<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:820px;margin:32px auto;padding:0 24px;color:#1a2233;line-height:1.6}` +
        `h1{font-size:22px;border-bottom:2px solid #e3e8f0;padding-bottom:8px}h2{font-size:17px;margin-top:22px}h3{font-size:14px}` +
        `table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d8dee9;padding:6px 10px;text-align:left;font-size:13px}` +
        `th{background:#f3f6fb}code{background:#f3f6fb;padding:1px 5px;border-radius:4px}.m{display:flex;justify-content:space-between;color:#6b7894;font-size:12px;margin-bottom:10px}` +
        `</style></head><body><div class="m"><span>${meta}</span><span>EzyOne</span></div><div>${body}</div>` +
        `<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    w.document.close();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reports</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {reports.length} Reports{selectedClient?.name ? ` · ${selectedClient.name}` : ""}
          </p>
        </div>
        {current && (
          <Btn icon={Download} onClick={() => printReport(current)}>
            PDF / Drucken
          </Btn>
        )}
      </div>
      {reports.length === 0 ? (
        <div
          style={{
            color: C.textMuted,
            fontSize: 13,
            padding: 28,
            textAlign: "center",
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
          }}
        >
          Noch keine Reports vorhanden. Der monatliche Report wird automatisch erstellt.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSel(r.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: current?.id === r.id ? C.card : "transparent",
                  border: `1px solid ${current?.id === r.id ? C.accent : C.border}`,
                  color: C.text,
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{r.updatedAt || r.createdAt}</div>
              </button>
            ))}
          </div>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 22,
              fontSize: 13,
              lineHeight: 1.7,
              color: C.text,
              overflowY: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(current?.content || "") }}
          />
        </div>
      )}
    </div>
  );
}
function ContentPage({
  clients,
  items,
  onSaveContent,
  selectedClient,
  openEditId,
  onOpenEditConsumed,
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  // Weiterbearbeiten-Flow (2026-08-18): von aussen angeforderter Entwurf wird
  // direkt im Editor geoeffnet (einmalig konsumiert).
  useEffect(() => {
    if (openEditId) {
      setEditing(openEditId);
      onOpenEditConsumed?.();
    }
  }, [openEditId, onOpenEditConsumed]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const typeIc = { blog: PenTool, audit: Layers, note: Bookmark, report: FileText, win: Award };
  const typeCo = { blog: C.cyan, audit: C.accent, note: C.pink, report: C.blue, win: C.green };
  const stCo = { draft: C.textMuted, published: C.green, archived: C.textDim };
  const stLb = { draft: "Entwurf", published: "Publiziert", archived: "Archiviert" };
  // Content pro Kunde trennen: nur Inhalte des aktuell gewählten Kunden zeigen.
  const clientItems = items.filter(
    (it) => !selectedClient?.id || it.clientId === selectedClient.id,
  );
  const filtered = clientItems.filter(
    (it) =>
      (filter === "all" ? it.type !== "report" : it.type === filter) &&
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
    if (!it)
      return (
        <div style={{ padding: 30, fontSize: 13, color: C.textMuted }}>
          Entwurf nicht gefunden (evtl. noch nicht geladen).{" "}
          <button
            onClick={() => setEditing(null)}
            style={{
              background: "none",
              border: "none",
              color: C.accent,
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
              textDecoration: "underline",
            }}
          >
            Zurück zur Liste
          </button>
        </div>
      );
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
            {clientItems.length} Inhalte{selectedClient?.name ? ` · ${selectedClient.name}` : ""}
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
            { id: "win", label: "Erfolge" },
            { id: "audit", label: "Audit" },
            { id: "note", label: "Notes" },
            { id: "report", label: "Berichte" },
          ]}
          active={filter}
          onChange={setFilter}
        />
      </div>
      {filter === "report" ? (
        <ReportsPage items={items} selectedClient={selectedClient} />
      ) : (
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
              <div style={{ fontSize: 13, color: C.textMuted, maxWidth: 440, margin: "0 auto" }}>
                Nächster Schritt: unter{" "}
                <strong style={{ color: C.text }}>AI-Tools → Content erstellen</strong> z. B. «Blog
                Post generieren» starten und das Ergebnis dort «Als Entwurf speichern» — es
                erscheint dann hier.
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
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: CLIENTS
// ═══════════════════════════════════════════════════════════════════════════
// Per-client WordPress connection panel: enter site URL + WP username +
// Application Password, verify against the WP REST API, then store. Shows status.
function WordPressClientPanel({ client }) {
  const toast = useToast();
  const [status, setStatus] = useState(null); // {connected, siteUrl, username}
  const [loading, setLoading] = useState(true);
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/wordpress/connection?clientId=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      setStatus(j.connected ? j : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [client?.id]);
  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) {
      toast("Bitte URL, Benutzername und Application-Password ausfüllen", "error");
      return;
    }
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/wordpress/connection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: client.id,
          siteUrl: siteUrl.trim(),
          username: username.trim(),
          appPassword: appPassword.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        toast(`WordPress verbunden${j.seoPlugin ? ` · SEO: ${j.seoPlugin}` : ""}`, "success");
        window.dispatchEvent(new CustomEvent(READINESS_EVENT));
        setAppPassword("");
        await load();
      } else {
        toast(j.error || "Verbindung fehlgeschlagen", "error");
      }
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("WordPress-Verbindung wirklich trennen?")) return;
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      await fetch("/api/wordpress/connection", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId: client.id }),
      });
      toast("WordPress getrennt", "success");
      window.dispatchEvent(new CustomEvent(READINESS_EVENT));
      setStatus(null);
      await load();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  if (loading) return <div style={{ fontSize: 12, color: C.textDim }}>Lädt…</div>;

  if (status?.connected) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: C.bg,
          border: `1px solid ${C.green}44`,
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ color: C.green, flexShrink: 0 }}>
            <Check size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: C.text,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {status.siteUrl}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>Benutzer: {status.username}</div>
          </div>
        </div>
        <button
          onClick={disconnect}
          disabled={busy}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          Trennen
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        style={inputStyle}
        placeholder="WordPress-URL (z.B. kunde.ch)"
        value={siteUrl}
        onChange={(e) => setSiteUrl(e.target.value)}
      />
      <input
        style={inputStyle}
        placeholder="WP-Benutzername"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="off"
      />
      <input
        style={inputStyle}
        type="password"
        placeholder="Application Password"
        value={appPassword}
        onChange={(e) => setAppPassword(e.target.value)}
        autoComplete="new-password"
      />
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <a
          href="https://wordpress.org/documentation/article/application-passwords/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: C.accentLight, textDecoration: "none" }}
        >
          Application Password erstellen ↗
        </a>
        <button
          onClick={connect}
          disabled={busy}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: C.accent,
            color: "#fff",
            cursor: busy ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          {busy ? "Verbinde…" : "Verbinden & testen"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
        In WordPress unter <strong>Benutzer → Profil → Application Passwords</strong> ein neues
        Passwort erstellen. Erfordert WordPress 5.6+ und HTTPS.
      </div>
    </div>
  );
}

function OnboardingCard({ client, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(client?.id || ""),
  );
  const steps = [
    {
      ok: !!client?.domain,
      label: "Domain hinterlegt",
      hint: "Basis für Backlinks & Core Web Vitals",
    },
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
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
          Onboarding / Verbindungen
        </div>
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
      <div
        id="anker-google-props"
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: `1px solid ${C.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
          Google: Search Console &amp; GA4 verbinden
        </div>
        <GoogleClientPanel client={client} onSaved={onUpdated} />
      </div>
      <div
        id="anker-wordpress"
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: `1px solid ${C.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
          WordPress verbinden (Content veröffentlichen, Beiträge lesen, SEO schreiben)
        </div>
        <WordPressClientPanel client={client} />
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginTop: 10 }}>
        Semrush ist aktuell nicht verfügbar (API-Units fehlen).
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding-Wizard (User-Wunsch 2026-07-14): Jeder NEUE Kunde wird in 3
// Schritten angelegt — 1) Kundendaten, 2) Dashboards + Dienste, 3) daraus
// abgeleitete Verbindungen (GSC, GA4, Ads, Canonry, WordPress). Der Kunde wird
// nach Schritt 2 erstellt (Dienste-Seed + Dashboard-Auswahl in defaults),
// Schritt 3 sammelt Properties und verlinkt ins Kunden-Panel fuer OAuth.
// ─────────────────────────────────────────────────────────────────────────────
const ONBOARD_TABS = [
  // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
  { id: "seo", label: "SEO", hint: "Rankings, GSC, CWV, Backlinks" },
  { id: "blog", label: "Blog", hint: "Blog-Artikel & Refresh-Radar" },
  { id: "localgrid", label: "Local Grid", hint: "Maps-Heatmap (nur mit Standort/GBP)" },
  { id: "aivis", label: "KI-Sichtbarkeit", hint: "AI-Citations (Canonry)" },
  { id: "conversions", label: "Conversions", hint: "GA4, Kanäle, Umsatz" },
  { id: "ads", label: "Google Ads", hint: "Kampagnen, Autopilot" },
  { id: "runs", label: "Agent-Läufe", hint: "Lauf-Nachweis" },
];

function onboardingConnections(tabsSet, servicesSet) {
  const why = (arr) => arr.filter(Boolean);
  const out = [];
  if (tabsSet.has("seo") || servicesSet.has("gsc"))
    out.push({
      key: "gsc",
      label: "Google Search Console",
      reason: why([
        tabsSet.has("seo") && "Dashboard SEO",
        servicesSet.has("gsc") && "Dienst Search Console",
      ]),
      action: "Oben „Mit Google verbinden“ klicken und die GSC-Property eintragen.",
      field: "gscSiteUrl",
      placeholder: "sc-domain:example.com",
    });
  if (tabsSet.has("conversions") || servicesSet.has("ga4"))
    out.push({
      key: "ga4",
      label: "Google Analytics 4",
      reason: why([
        tabsSet.has("conversions") && "Dashboard Conversions",
        servicesSet.has("ga4") && "Dienst GA4",
      ]),
      action: "Oben „Mit Google verbinden“ klicken und die GA4-Property-ID eintragen.",
      field: "ga4PropertyId",
      placeholder: "z. B. 123456789",
    });
  if (tabsSet.has("ads") || servicesSet.has("google-ads"))
    out.push({
      key: "google-ads",
      label: "Google Ads",
      reason: why([
        tabsSet.has("ads") && "Dashboard Google Ads",
        servicesSet.has("google-ads") && "Dienst Google Ads",
      ]),
      action:
        "Oben „Mit Google verbinden“ klicken; die Ads-Customer-ID hinterlegst du im Kunden-Panel.",
    });
  if (tabsSet.has("aivis") || servicesSet.has("canonry"))
    out.push({
      key: "canonry",
      label: "Canonry (GEO)",
      reason: why([
        tabsSet.has("aivis") && "Dashboard KI-Sichtbarkeit",
        servicesSet.has("canonry") && "Dienst Canonry",
      ]),
      action: "Wird beim Anlegen automatisch eingerichtet — keine Aktion nötig.",
      auto: true,
    });
  if (servicesSet.has("wordpress"))
    out.push({
      key: "wordpress",
      label: "WordPress",
      reason: ["Dienst WordPress"],
      action: "Site-URL + Application-Password im Kunden-Panel (WordPress) verbinden.",
    });
  if (servicesSet.has("gbp"))
    out.push({
      key: "gbp",
      label: "Google Business Profile",
      reason: ["Dienst GBP"],
      action: "Google-Konto mit Scope business.manage verbinden (Inhaberzugang nötig).",
    });
  if (servicesSet.has("bing"))
    out.push({
      key: "bing",
      label: "Bing Webmaster",
      reason: ["Dienst Bing"],
      action: "Site in Bing Webmaster Tools verifizieren (speist ChatGPT/Copilot).",
    });
  return out;
}

function OnboardingWizard({ open, onClose, effectiveDefaults, onCreate, onFinished, onOpenPanel }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(clientFormFromClient());
  const [tabsSel, setTabsSel] = useState(new Set(DEFAULT_CUSTOMER_DEFAULTS.visibleTabs));
  const [created, setCreated] = useState(null);
  // Google-OAuth direkt im Wizard (User-Wunsch 2026-07-15): sobald der Kunde
  // angelegt ist, kann die Google-Verbindung (GSC/GA4/Ads) hier gestartet
  // werden — gleicher Flow wie im Kunden-Panel (Popup + Status-Poll).
  const [gConn, setGConn] = useState(null); // null=unbekannt, {connected,email}
  const [gBusy, setGBusy] = useState(false);
  // Aus Google geladene Auswahllisten (User-Wunsch 2026-07-15): nach dem
  // Verbinden GSC-Properties + GA4-Properties abrufen, damit sie per Dropdown
  // ausgewaehlt statt manuell eingetippt werden. null=noch nicht geladen.
  const [gRes, setGRes] = useState({ gsc: null, ga4: null });
  const [gResBusy, setGResBusy] = useState(false);
  const [gResErr, setGResErr] = useState("");
  useEffect(() => {
    if (open) {
      setStep(1);
      setBusy(false);
      setDraft(clientFormFromClient());
      setTabsSel(new Set(DEFAULT_CUSTOMER_DEFAULTS.visibleTabs));
      setCreated(null);
      setGConn(null);
      setGBusy(false);
      setGRes({ gsc: null, ga4: null });
      setGResBusy(false);
      setGResErr("");
    }
  }, [open]);
  const loadGoogleConn = async (clientId) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/google/connection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j) setGConn(j);
    } catch {
      /* Status unbekannt */
    }
  };
  useEffect(() => {
    if (step === 3 && created?.id) loadGoogleConn(created.id);
  }, [step, created?.id]);
  const connectGoogle = async () => {
    if (!created?.id || gBusy) return;
    setGBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `/api/google/oauth/start?client_id=${encodeURIComponent(created.id)}`,
        {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
      const popup = window.open(json.url, "google-oauth", "width=520,height=640");
      const t = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(t);
          await loadGoogleConn(created.id);
          setGBusy(false);
        }
      }, 800);
    } catch (e) {
      toast(String(e?.message || e), "error");
      setGBusy(false);
    }
  };
  const set = (k) => (v) => setDraft((p) => ({ ...p, [k]: v }));
  const toggleTab = (id) =>
    setTabsSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) next.add(id); // mindestens ein Dashboard
      return next;
    });
  const connections = onboardingConnections(tabsSel, draft.services || new Set());

  // Laedt die verfuegbaren Google-Ressourcen (GSC-Sites, GA4-Properties) des
  // verbundenen Kontos, damit sie ausgewaehlt statt eingetippt werden koennen.
  const loadGoogleResources = async () => {
    if (!created?.id || gResBusy) return;
    setGResBusy(true);
    setGResErr("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers = {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
      };
      const body = JSON.stringify({ clientId: created.id });
      const needGsc = connections.some((c) => c.key === "gsc");
      const needGa4 = connections.some((c) => c.key === "ga4");
      const [gsc, ga4] = await Promise.all([
        needGsc
          ? fetch("/api/google/gsc-sites", { method: "POST", headers, body })
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        needGa4
          ? fetch("/api/google/ga4-properties", { method: "POST", headers, body })
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      setGRes({
        gsc: gsc?.ok ? gsc.sites || [] : needGsc ? [] : null,
        ga4: ga4?.ok ? ga4.properties || [] : needGa4 ? [] : null,
      });
      const errs = [];
      if (needGsc && gsc && !gsc.ok) errs.push(`GSC: ${gsc.error}`);
      if (needGa4 && ga4 && !ga4.ok) errs.push(`GA4: ${ga4.error}`);
      if (errs.length) setGResErr(errs.join(" · "));
    } catch (e) {
      setGResErr(String(e?.message || e));
    } finally {
      setGResBusy(false);
    }
  };
  // Sobald in Schritt 3 verbunden ist, Auswahllisten einmal automatisch laden.
  useEffect(() => {
    if (
      step === 3 &&
      gConn?.connected &&
      created?.id &&
      gRes.gsc === null &&
      gRes.ga4 === null &&
      !gResBusy
    ) {
      void loadGoogleResources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gConn?.connected, created?.id]);

  const createClient = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = normalizeClientShape({
        defaults: { ...effectiveDefaults, visibleTabs: [...tabsSel] },
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
        canonryProject: slugifyProjectName(draft.domain),
        brandTerms: splitCsv(draft.brandTerms),
        revenueMode: draft.revenueMode === "clicks" ? "clicks" : "revenue",
      });
      next.services = [...(draft.services || [])];
      const mapped = await onCreate(next);
      if (!mapped?.id) return; // Fehler-Toast kommt aus dem Upsert-Wrapper
      setCreated(mapped);
      setStep(3);
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (openPanel) => {
    if (busy) return;
    setBusy(true);
    try {
      const patch = {};
      if (draft.gscSiteUrl.trim()) patch.gscSiteUrl = draft.gscSiteUrl.trim();
      if (draft.ga4PropertyId.trim()) patch.ga4PropertyId = draft.ga4PropertyId.trim();
      let final = created;
      if (created && Object.keys(patch).length)
        final = (await onCreate({ ...created, ...patch })) || created;
      onFinished?.(final);
      if (openPanel && final) onOpenPanel?.(final);
      onClose();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const StepDots = () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
      {[1, 2, 3].map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              background: s === step ? C.accent : s < step ? `${C.green}33` : C.surface,
              color: s === step ? "#fff" : s < step ? C.green : C.textDim,
              border: `1px solid ${s <= step ? "transparent" : C.border}`,
            }}
          >
            {s < step ? "✓" : s}
          </div>
          <span
            style={{
              fontSize: 12,
              color: s === step ? C.text : C.textDim,
              fontWeight: s === step ? 600 : 400,
            }}
          >
            {s === 1 ? "Kundendaten" : s === 2 ? "Dashboards & Dienste" : "Verbindungen"}
          </span>
          {s < 3 && <div style={{ width: 24, height: 1, background: C.border }} />}
        </div>
      ))}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Neuen Kunden onboarden" width={680}>
      <StepDots />
      {step === 1 && (
        <>
          {/* Verschlankt (Volkan 06.08.): nur die Pflicht-Essentials. E-Mail/
              Telefon/Budget/Standorte/Tags/Brand-Begriffe/Notizen bleiben im
              Kunden-Editor („Bearbeiten") pflegbar; Umsatz-Modus ist fix
              "revenue" (Umsatz-Tracking vollständig, Draft-Default) — keine
              Auswahl mehr beim Onboarding. */}
          <div
            className="ezy-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <Inp label="Name" value={draft.name} onChange={set("name")} required />
            <Inp
              label="Domain"
              value={draft.domain}
              onChange={set("domain")}
              placeholder="example.com"
              required
            />
            <Inp label="Branche" value={draft.industry} onChange={set("industry")} />
            <Inp
              label="Status"
              value={draft.status}
              onChange={set("status")}
              options={["active", "paused"]}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={onClose}>
              Abbrechen
            </Btn>
            <Btn
              onClick={() => {
                if (!draft.name.trim() || !draft.domain.trim()) {
                  toast("Name und Domain sind erforderlich", "error");
                  return;
                }
                setStep(2);
              }}
            >
              Weiter: Dashboards & Dienste
            </Btn>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>
            Dashboards
          </div>
          <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px" }}>
            Welche Bereiche soll dieser Kunde im Dashboard sehen?
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}
          >
            {ONBOARD_TABS.map((t) => {
              const on = tabsSel.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTab(t.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accentDim : "transparent",
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: on ? C.accentLight : C.text }}
                  >
                    {on ? "☑" : "☐"} {t.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{t.hint}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>
            Dienste
          </div>
          <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px" }}>
            Aktivierte Dienste werden fuer diesen Kunden freigeschaltet (client_integrations).
          </p>
          <ServicesPicker
            C={C}
            value={draft.services}
            onChange={(next) => setDraft((p) => ({ ...p, services: next }))}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={() => setStep(1)}>
              Zurück
            </Btn>
            <Btn onClick={createClient} disabled={busy}>
              {busy ? "Wird angelegt…" : "Kunde anlegen & weiter: Verbindungen"}
            </Btn>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p style={{ fontSize: 12, color: C.textMuted, margin: "0 0 12px" }}>
            Basierend auf deiner Auswahl braucht{" "}
            <strong style={{ color: C.text }}>{created?.name || draft.name}</strong> diese
            Verbindungen. Properties kannst du direkt hier eintragen.
          </p>
          {connections.some((c) => ["gsc", "ga4", "google-ads", "gbp"].includes(c.key)) && (
            <div
              style={{
                border: `1px solid ${gConn?.connected ? C.green : C.accent}`,
                borderRadius: 12,
                padding: "12px 14px",
                background: gConn?.connected ? `${C.green}14` : C.accentDim,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  Google-Konto {gConn?.connected ? "verbunden ✓" : "verbinden"}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                  {gConn?.connected
                    ? `Verbunden${gConn?.email ? ` als ${gConn.email}` : ""} — GSC, GA4 & Ads können jetzt Daten liefern.`
                    : "Eine Verbindung deckt Search Console, Analytics (GA4) und Google Ads gemeinsam ab."}
                </div>
              </div>
              {gConn?.connected ? (
                <Btn variant="secondary" onClick={connectGoogle} disabled={gBusy}>
                  {gBusy ? "Wartet auf Google…" : "Neu verbinden"}
                </Btn>
              ) : (
                <Btn onClick={connectGoogle} disabled={gBusy}>
                  {gBusy ? "Wartet auf Google…" : "Mit Google verbinden"}
                </Btn>
              )}
            </div>
          )}
          {gResErr && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>
              Google-Ressourcen konnten nicht geladen werden: {gResErr}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {connections.length === 0 && (
              <div
                style={{
                  fontSize: 13,
                  color: C.textMuted,
                  padding: 12,
                  background: C.surface,
                  borderRadius: 10,
                }}
              >
                Keine Verbindungen nötig — dieser Kunde nutzt nur globale Dienste.
              </div>
            )}
            {connections.map((c) => (
              <div
                key={c.key}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  background: C.card,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.label}</span>
                  {c.auto && <Badge color={C.green}>automatisch</Badge>}
                  {c.reason.map((r) => (
                    <Badge key={r} color={C.blue}>
                      {r}
                    </Badge>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{c.action}</div>
                {c.field &&
                  (() => {
                    const list = c.key === "gsc" ? gRes.gsc : c.key === "ga4" ? gRes.ga4 : null;
                    const hasList = Array.isArray(list) && list.length > 0;
                    const fieldLabel = c.key === "gsc" ? "GSC Property" : "GA4 Property ID";
                    return (
                      <div style={{ marginTop: 8, maxWidth: 440 }}>
                        {gConn?.connected && hasList ? (
                          <label style={{ display: "block" }}>
                            <span style={{ fontSize: 12, color: C.textMuted }}>
                              {fieldLabel} — aus Google wählen
                            </span>
                            <select
                              value={draft[c.field]}
                              onChange={(e) => set(c.field)(e.target.value)}
                              style={{
                                width: "100%",
                                marginTop: 4,
                                background: C.card,
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontSize: 13,
                              }}
                            >
                              <option value="">— auswählen —</option>
                              {list.map((o) => {
                                const val = c.key === "gsc" ? o.url : o.id;
                                const lbl =
                                  c.key === "gsc"
                                    ? o.url
                                    : `${o.account ? `${o.account} · ` : ""}${o.displayName || o.id} (${o.id})`;
                                return (
                                  <option key={val} value={val}>
                                    {lbl}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                        ) : (
                          <Inp
                            label={fieldLabel}
                            value={draft[c.field]}
                            onChange={set(c.field)}
                            placeholder={c.placeholder}
                          />
                        )}
                        {gConn?.connected && (
                          <div
                            style={{
                              marginTop: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              onClick={loadGoogleResources}
                              disabled={gResBusy}
                              style={{
                                fontSize: 11,
                                color: C.accentLight,
                                background: "none",
                                border: "none",
                                cursor: gResBusy ? "default" : "pointer",
                                padding: 0,
                              }}
                            >
                              {gResBusy
                                ? "Lädt aus Google…"
                                : hasList
                                  ? "↻ Neu aus Google laden"
                                  : "Aus Google laden"}
                            </button>
                            {Array.isArray(list) && list.length === 0 && !gResBusy && (
                              <span style={{ fontSize: 11, color: C.textDim }}>
                                Keine gefunden — manuell eintragen.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: C.textDim, margin: "12px 0 0" }}>
            DataForSEO & Co. laufen über globale Schlüssel — dafür ist nichts zu tun.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={() => finish(false)} disabled={busy}>
              Später verbinden — fertig
            </Btn>
            <Btn onClick={() => finish(true)} disabled={busy}>
              {busy ? "Speichert…" : "Speichern & Kunden-Panel öffnen"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team-/Mitarbeiter-Verwaltung (RBAC, 2026-07-15). Nur SuperAdmin(owner)/admin.
// Mitarbeiter (role member) sehen NUR zugewiesene Kunden (RLS) und koennen keine
// Kunden-Einstellungen aendern. Anlage nur hier (kein Self-Signup).
// ─────────────────────────────────────────────────────────────────────────────
function TeamPage({ clients }) {
  const toast = useToast();
  const { role: myRole, organizationId } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null); // userId, dessen Kunden-Zuweisung offen ist
  const [draftAccess, setDraftAccess] = useState(new Set());

  const callTeam = useCallback(async (body) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/admin/team", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ error: "Antwort ungültig" }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await callTeam({ action: "list" });
    if (j.ok) setUsers(j.users || []);
    else toast(j.error || "Laden fehlgeschlagen", "error");
    setLoading(false);
  }, [callTeam, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    const j = await callTeam({ action: "invite", email: inviteEmail.trim(), role: inviteRole });
    setBusy(false);
    if (j.ok) {
      toast(`Einladung an ${inviteEmail} gesendet`, "success");
      setInviteEmail("");
      await load();
    } else toast(j.error || "Einladung fehlgeschlagen", "error");
  };
  const setRole = async (userId, r) => {
    const j = await callTeam({ action: "setRole", userId, role: r });
    if (j.ok) {
      toast("Rolle aktualisiert", "success");
      await load();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };
  const remove = async (userId, email) => {
    if (!window.confirm(`${email || "Nutzer"} aus dem Team entfernen?`)) return;
    const j = await callTeam({ action: "remove", userId });
    if (j.ok) {
      toast("Entfernt", "success");
      await load();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };
  const openAssign = (u) => {
    setExpanded(u.userId);
    setDraftAccess(new Set(u.clientIds || []));
  };
  const saveAssign = async (userId) => {
    setBusy(true);
    const j = await callTeam({ action: "assign", userId, clientIds: [...draftAccess] });
    setBusy(false);
    if (j.ok) {
      toast(`${j.assigned} Kunden zugewiesen`, "success");
      setExpanded(null);
      await load();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };
  // Admin-Umbau 06.08.: viewer = Kunden-Login (Portal) — kuratierte Sicht,
  // Funktions-Freischaltung über Kunden-Detail → App-Zugriff.
  const roleLabel = {
    owner: "SuperAdmin",
    admin: "Admin",
    member: "Mitarbeiter",
    viewer: "Kunde (Portal)",
  };
  const roleColor = { owner: C.pink, admin: C.accent, member: C.green, viewer: C.textDim };

  // App-Zugriffe (Plattform-Umbau Phase 1, 2026-07-31): welcher Member darf
  // welche Apps im Launcher öffnen. Direkt via Supabase (RLS: org-admin-write);
  // owner/admin sehen implizit alles und tauchen hier nicht auf.
  const [appAccessMap, setAppAccessMap] = useState({}); // userId -> Set(app)
  const loadAppAccess = useCallback(async () => {
    const { data } = await supabase.from("app_access").select("user_id, app");
    const m = {};
    for (const r of data || []) (m[r.user_id] = m[r.user_id] || new Set()).add(r.app);
    setAppAccessMap(m);
  }, []);
  useEffect(() => {
    void loadAppAccess();
  }, [loadAppAccess]);
  const toggleApp = async (userId, app) => {
    const has = appAccessMap[userId]?.has(app);
    const q = has
      ? supabase.from("app_access").delete().eq("user_id", userId).eq("app", app)
      : supabase
          .from("app_access")
          .insert({ user_id: userId, organization_id: organizationId, app });
    const { error } = await q;
    if (error) toast(error.message || "App-Zugriff fehlgeschlagen", "error");
    await loadAppAccess();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Team</h2>
        <p style={{ fontSize: 12, color: C.textMuted, margin: "4px 0 0" }}>
          Mitarbeiter anlegen und pro Kunde freischalten. Mitarbeiter sehen nur zugewiesene Kunden
          und können keine Kunden-Einstellungen ändern.
        </p>
      </div>

      {/* Einladen */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Mitarbeiter einladen</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Inp
              label="E-Mail"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="mitarbeiter@firma.ch"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Rolle</div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 8,
                background: C.surface,
                color: C.text,
                border: `1px solid ${C.border}`,
                fontSize: 13,
              }}
            >
              <option value="member">Mitarbeiter (Audits + zugewiesene Kunden)</option>
              <option value="viewer">Kunde / Portal (nur freigeschaltete Funktionen)</option>
              {myRole === "owner" && (
                <option value="admin">Admin (alle Kunden, volle Rechte)</option>
              )}
            </select>
          </div>
          <Btn onClick={invite} disabled={busy || !inviteEmail.trim()}>
            {busy ? "…" : "Einladen"}
          </Btn>
        </div>
        <p style={{ fontSize: 11, color: C.textDim, margin: "8px 0 0" }}>
          Die Person erhält eine E-Mail zum Passwort-Setzen. Selbstregistrierung ist deaktiviert.
        </p>
      </div>

      {/* Nutzerliste */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          Nutzer ({users.length})
        </div>
        {loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Lädt…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users.map((u) => (
              <div
                key={u.userId}
                style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                    {u.email || u.userId.slice(0, 8)}
                  </span>
                  <Badge color={roleColor[u.role] || C.textDim}>
                    {roleLabel[u.role] || u.role}
                  </Badge>
                  {u.self && <Badge color={C.blue}>Du</Badge>}
                  {u.role !== "owner" && u.role !== "admin" && (
                    <span style={{ fontSize: 11, color: C.textMuted }}>
                      {u.clientIds.length} von {clients.length} Kunden
                    </span>
                  )}
                  {(u.role === "owner" || u.role === "admin") && (
                    <span style={{ fontSize: 11, color: C.textMuted }}>alle Kunden</span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {!u.self && u.role !== "owner" && u.role !== "admin" && (
                      <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => (expanded === u.userId ? setExpanded(null) : openAssign(u))}
                      >
                        Berechtigungen
                      </Btn>
                    )}
                    {!u.self && u.role !== "owner" && (
                      <select
                        value={u.role}
                        onChange={(e) => setRole(u.userId, e.target.value)}
                        style={{
                          padding: "5px 8px",
                          borderRadius: 7,
                          background: C.surface,
                          color: C.text,
                          border: `1px solid ${C.border}`,
                          fontSize: 12,
                        }}
                      >
                        <option value="member">Mitarbeiter</option>
                        <option value="viewer">Nur-Lesen</option>
                        {myRole === "owner" && <option value="admin">Admin</option>}
                      </select>
                    )}
                    {!u.self && u.role !== "owner" && (
                      <Btn variant="danger" size="sm" onClick={() => remove(u.userId, u.email)}>
                        Entfernen
                      </Btn>
                    )}
                  </div>
                </div>
                {/* Konsolidiert (Phase C, 06.08.): EIN Berechtigungen-Panel pro
                    Person — Apps + Kunden zusammen, statt zwei Bedienstellen. */}
                {expanded === u.userId && (
                  <div
                    style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}
                  >
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                      Apps: welche Apps darf {u.email || "diese Person"} öffnen?
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      {EZY_APPS.filter((a) => !a.adminOnly).map((a) => {
                        const on = appAccessMap[u.userId]?.has(a.id);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => toggleApp(u.userId, a.id)}
                            title={on ? `${a.name} entziehen` : `${a.name} freischalten`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "4px 10px",
                              borderRadius: 99,
                              cursor: "pointer",
                              fontSize: 11.5,
                              border: `1px solid ${on ? a.color : C.border}`,
                              background: on ? a.tint : "transparent",
                              color: on ? a.color : C.textDim,
                            }}
                          >
                            {a.icon} {a.name}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
                      Kunden: welche Kunden darf {u.email || "diese Person"} sehen?
                      {u.role === "viewer" && " (Portal-Logins gehören zu genau EINEM Kunden)"}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                        gap: 6,
                        marginBottom: 10,
                      }}
                    >
                      {clients.map((c) => {
                        const on = draftAccess.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setDraftAccess((prev) => {
                                const n = new Set(prev);
                                if (n.has(c.id)) n.delete(c.id);
                                else n.add(c.id);
                                return n;
                              })
                            }
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              textAlign: "left",
                              padding: "6px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 12,
                              border: `1px solid ${on ? C.accent : C.border}`,
                              background: on ? C.accentDim : "transparent",
                              color: on ? C.accentLight : C.text,
                            }}
                          >
                            <span>{on ? "☑" : "☐"}</span>
                            <ClientAvatar
                              name={c.name}
                              domain={c.domain}
                              size={20}
                              radius={5}
                              bg={C.accentDim}
                              fg={C.accentLight}
                              fontSize={9}
                            />
                            <span
                              style={{
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {c.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Btn variant="secondary" size="sm" onClick={() => setExpanded(null)}>
                        Abbrechen
                      </Btn>
                      <Btn size="sm" onClick={() => saveAssign(u.userId)} disabled={busy}>
                        Speichern
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Tech-Stack-Erkennung (06.08., DataForSEO Domain Analytics): erkennt CMS/
// Page-Builder/Server/Analytics der Kunden-Website auf Knopfdruck — fuer
// Onboarding (welcher Connector passt?) und Speed-Empfehlungen (LiteSpeed?
// Elementor = Minify-Sperre). Kein Auto-Fetch: kostet erst beim Klick.
function TechStackCard({ domain }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const detect = async () => {
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch(`/api/admin/tech-detect?domain=${encodeURIComponent(domain)}`, {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      setData(await r.json().catch(() => ({ ok: false, error: "Antwort ungültig" })));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: data?.ok ? 10 : 0 }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Tech-Stack</div>
        <Btn
          variant="secondary"
          size="sm"
          style={{ marginLeft: "auto" }}
          onClick={detect}
          disabled={busy || !domain}
        >
          {busy ? "Erkenne…" : data ? "Neu erkennen" : "Erkennen"}
        </Btn>
      </div>
      {data && !data.ok && (
        <div style={{ fontSize: 12, color: C.textMuted }}>
          Nicht erkennbar: {data.error || "unbekannter Fehler"}
        </div>
      )}
      {data?.ok &&
        ((data.groups || []).length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Keine Technologien in der Datenbank für {data.domain}.
          </div>
        ) : (
          (data.groups || []).map((g) => (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: C.textDim,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 4,
                }}
              >
                {g.group}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {g.items.map((t) => (
                  <Badge key={t} color={C.blue}>
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          ))
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Umbau Teil 2 (06.08.): kundenbezogene Einstellungen im Kunden-Detail —
// Sprache/Tonalität/Report-Template/Tab-Auswahl + Conversion-Werte. Vorher
// unter Einstellungen (nur über den Kunden-Umschalter erreichbar), jetzt direkt
// beim Kunden. Speichern schreibt wie die alte Settings-Seite DOPPELT:
// customer_defaults (Hook, localStorage+DB) UND clients.metadata.defaults —
// Letzteres ist die maßgebliche, geräteübergreifende Quelle des Tab-Filters
// (fix 2026-07-14).
// ─────────────────────────────────────────────────────────────────────────────
function ClientSettingsPanel({ client, onUpsertClient }) {
  const toast = useToast();
  const defaultsHook = useEzyDefaults(client.id);
  const [draft, setDraft] = useState(defaultsFromStored(defaultsHook.defaults));
  useEffect(() => {
    // Kunden-Datensatz bevorzugen (maßgebliche Quelle), sonst Hook-Stand.
    const fromClient =
      client?.defaults && Object.keys(client.defaults).length ? client.defaults : null;
    setDraft(defaultsFromStored(fromClient || defaultsHook.defaults));
  }, [client.id, client?.defaults, defaultsHook.defaults]);
  const saveAll = async () => {
    const saved = await defaultsHook.save(draft);
    try {
      await onUpsertClient?.({
        ...client,
        defaults: { ...(client.defaults || {}), ...(saved || draft) },
      });
    } catch {
      /* customer_defaults/localStorage haben bereits gespeichert */
    }
    toast(`Einstellungen für ${client.name} gespeichert`, "success");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
          Kunden-Einstellungen
        </div>
        <Inp
          label="Standard-Sprache"
          value={draft.language}
          onChange={(v) => setDraft((p) => ({ ...p, language: v }))}
          options={["Deutsch", "Englisch", "Französisch"]}
        />
        <Inp
          label="Standard-Tonalität"
          value={draft.tone}
          onChange={(v) => setDraft((p) => ({ ...p, tone: v }))}
          options={["Professionell", "Informativ", "Conversational"]}
        />
        <Inp
          label="Report-Template"
          value={draft.reportTemplate}
          onChange={(v) => setDraft((p) => ({ ...p, reportTemplate: v }))}
          options={["Standard", "Detailliert", "Executive Summary"]}
        />
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>
            Sichtbare Dashboard-Tabs
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
              { id: "seo", label: "SEO", icon: Globe },
              { id: "blog", label: "Blog", icon: PenTool },
              { id: "localgrid", label: "Local Grid", icon: MapPin },
              { id: "aivis", label: "KI-Sichtbarkeit", icon: Bot },
              { id: "conversions", label: "Conversions", icon: DollarSign },
              { id: "ads", label: "Ads", icon: Megaphone },
            ].map((t) => {
              const on = (
                draft.visibleTabs || ["overview", "seo", "aivis", "conversions", "ads"]
              ).includes(t.id);
              return (
                <label
                  key={t.id}
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const cur = draft.visibleTabs || [
                        "overview",
                        "seo",
                        "aivis",
                        "conversions",
                        "ads",
                      ];
                      const next = on ? cur.filter((x) => x !== t.id) : [...cur, t.id];
                      setDraft((p) => ({ ...p, visibleTabs: next.length > 0 ? next : [t.id] }));
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
            Nur ausgewählte Tabs werden im Dashboard dieses Kunden angezeigt.
          </div>
        </div>
        <Btn icon={Save} style={{ marginTop: 14 }} onClick={saveAll}>
          Speichern
        </Btn>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <ConversionValuesPanel client={client} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Umbau 06.08.: App-Zugriff & Portal je Kunde. Stufe 1 = App an/aus,
// Stufe 2 = Funktions-Freischaltung (APP_FEATURES), Stufe 3 = Portal-Logins
// (Rolle viewer, fest an diesen Kunden gebunden). Keine DB-Zeile = App aktiv
// mit allen Funktionen (Legacy) — Häkchen materialisieren erst beim Ändern.
// ─────────────────────────────────────────────────────────────────────────────
// ── Einsatzbereitschaft (Admin-Ausbau 17.08.2026) ────────────────────────────
// Zeigt je App, ob der Kunde WIRKLICH einsatzbereit ist (App-Zugriff, Services,
// Integration, letzter Datenlauf, Portalzugang) — serverseitig berechnet
// (/api/admin/client-readiness, nur Owner/Admin), Anforderungen zentral in
// appRequirements.ts. Jede Luecke hat eine konkrete, rollensichere Aktion.
// Gezielte Navigation (21.08.): scrollt zum konkreten Feld (Anker-Id) im
// Kunden-Detail, hebt es kurz hervor und fokussiert den Eingabe-Input.
function fokusFeld(ankerId) {
  const el = document.getElementById(ankerId);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector("input, select, button");
  setTimeout(() => input?.focus?.(), 450);
  el.style.transition = "box-shadow .3s";
  el.style.boxShadow = `0 0 0 3px ${C.accent}66`;
  setTimeout(() => {
    el.style.boxShadow = "none";
  }, 2200);
  return true;
}
// Nach jedem Verbindungs-/Property-Speichern feuern die Panels dieses Event —
// die Einsatzbereitschaft berechnet sich dann automatisch neu.
const READINESS_EVENT = "ezy:readiness-refresh";

async function fetchReadiness(clientId) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const r = await fetch(`/api/admin/client-readiness?client=${encodeURIComponent(clientId)}`, {
    headers: { Authorization: `Bearer ${token || ""}` },
  });
  return r.json().catch(() => ({ ok: false, error: "Antwort ungültig" }));
}

// Portal-Einladung (21.08.): validierter Dialog statt window.prompt — E-Mail,
// Rolle, Kundenzuweisung und optionale Nachricht; doppelte Einladungen weist
// der Server mit einem verstaendlichen 409 ab.
function PortalEinladungDialog({ client, onClose, onInvited }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [rolle, setRolle] = useState("viewer");
  const [nachricht, setNachricht] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const senden = async () => {
    if (!emailOk) {
      setFehler("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    setBusy(true);
    setFehler("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/admin/team", {
        method: "POST",
        headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite",
          email: email.trim(),
          role: rolle,
          clientIds: [client.id],
          ...(nachricht.trim() ? { nachricht: nachricht.trim() } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        setFehler(String(j.error || `Einladung fehlgeschlagen (HTTP ${r.status})`));
        return;
      }
      toast(`Einladung an ${email.trim()} verschickt`, "success");
      onInvited?.();
    } catch (e) {
      setFehler(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const feld = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,10,25,.55)",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
          width: "min(440px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>Portalzugang einladen</div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>
            E-Mail-Adresse *
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@firma.ch"
            style={feld}
            autoFocus
          />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>Rolle</div>
          <select value={rolle} onChange={(e) => setRolle(e.target.value)} style={feld}>
            <option value="viewer">Kunde (Portal, nur zugewiesene Kunden)</option>
            <option value="member">Mitarbeiter (Team, zugewiesene Kunden)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>Kundenzuweisung</div>
          <div
            style={{
              fontSize: 12.5,
              color: C.text,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {client.name} <span style={{ color: C.textDim }}>({client.domain})</span>
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
            Weitere Kunden lassen sich danach unter App-Zugriff bzw. Team zuweisen.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>
            Nachricht (optional)
          </div>
          <textarea
            value={nachricht}
            onChange={(e) => setNachricht(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Persönliche Zeile in der Einladungs-Mail…"
            style={{ ...feld, resize: "vertical" }}
          />
        </div>
        {fehler && <div style={{ fontSize: 12.5, color: C.red }}>{fehler}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>
            Abbrechen
          </Btn>
          <Btn onClick={senden} disabled={busy || !emailOk}>
            {busy ? "Sende…" : "Einladung senden"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ClientReadinessPanel({ client, onOpenSettings }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const svc = useEzyServiceSettings(client.id);
  const [data, setData] = useState(null); // { snapshot, readiness }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(""); // `${app}:${checkId}` der laufenden Aktion
  const reload = useCallback(async () => {
    const j = await fetchReadiness(client.id);
    if (j?.ok) {
      setData(j);
      setErr("");
    } else setErr(j?.error || "Laden fehlgeschlagen");
  }, [client.id]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  // Nach Speicherungen in den Verbindungs-Panels automatisch neu berechnen.
  useEffect(() => {
    const h = () => void reload();
    window.addEventListener(READINESS_EVENT, h);
    return () => window.removeEventListener(READINESS_EVENT, h);
  }, [reload]);
  const [einladungOffen, setEinladungOffen] = useState(false);
  const [lauf, setLauf] = useState(null); // { jobId, status }
  const laufRef = useRef(false);
  // Async-Datenlauf (21.08.): sofortige jobId, danach Status-Polling — kein
  // minutenlang blockierender Request mehr.
  const pollJob = useCallback(
    async (jobId) => {
      if (laufRef.current) return;
      laufRef.current = true;
      try {
        for (;;) {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const r = await fetch(`/api/admin/client-readiness?job=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${token || ""}` },
          });
          const j = await r.json().catch(() => ({}));
          if (j?.ok) {
            setLauf({ jobId, status: j.job.status, error: j.job.error });
            if (j.job.status === "fertig") {
              toast("Datenlauf abgeschlossen", "success");
              setLauf(null);
              await reload();
              return;
            }
            if (j.job.status === "fehler") {
              toast(`Datenlauf fehlgeschlagen: ${j.job.error || "unbekannt"}`, "error");
              setLauf(null);
              return;
            }
          }
          await new Promise((res) => setTimeout(res, 5000));
        }
      } finally {
        laufRef.current = false;
      }
    },
    [reload, toast],
  );

  const statusColor = (st) =>
    st === "bereit"
      ? C.green
      : st === "unvollstaendig"
        ? C.orange
        : st === "fehler"
          ? C.red
          : C.textDim;

  const connectGoogle = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch(`/api/google/oauth/start?client_id=${encodeURIComponent(client.id)}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
    const popup = window.open(json.url, "google-oauth", "width=520,height=640");
    await new Promise((resolve) => {
      const t = setInterval(() => {
        if (popup?.closed) {
          clearInterval(t);
          resolve();
        }
      }, 800);
    });
  };

  const doAktion = async (app, check) => {
    const key = `${app}:${check.id}`;
    if (busy) return;
    setBusy(key);
    try {
      switch (check.aktion?.id) {
        case "app_freischalten": {
          const e = await caa.setAccess(client.id, app, { enabled: true });
          if (e) throw new Error(e);
          toast(`${readinessAppLabel(app)} freigeschaltet`, "success");
          break;
        }
        case "service_aktivieren": {
          // Sinnvoller Default je App: ads -> google-ads, geo -> perplexity
          // (DFS-Korpus-Standard seit 06.08.; Canonry bleibt optional zuschaltbar).
          const provider = app === "ads" ? "google-ads" : "perplexity";
          await svc.setEnabled(provider, true);
          toast(`Service ${provider} aktiviert`, "success");
          break;
        }
        case "google_verbinden":
          await connectGoogle();
          break;
        case "property_waehlen": {
          // Gezielt zum konkreten Feld (21.08.): Ads-Kundennummer bzw. GSC/GA4.
          const anker = app === "ads" ? "anker-google-ads" : "anker-google-props";
          if (!fokusFeld(anker)) onOpenSettings?.();
          return;
        }
        case "wordpress_verbinden":
          if (!fokusFeld("anker-wordpress")) onOpenSettings?.();
          return;
        case "portal_einladen":
          // Validierter Dialog statt window.prompt (21.08.).
          setEinladungOffen(true);
          return;
        case "datenlauf_starten": {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const r = await fetch("/api/admin/client-readiness", {
            method: "POST",
            headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "datenlauf", client: client.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setLauf({ jobId: j.jobId, status: j.status });
          toast(
            j.bereitsLaufend
              ? "Für diesen Kunden läuft bereits ein Datenlauf — Fortschritt wird angezeigt."
              : "Datenlauf eingeplant — läuft im Hintergrund (1–4 Minuten).",
            "info",
          );
          void pollJob(j.jobId);
          break;
        }
        default:
          return;
      }
      await reload();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy("");
    }
  };

  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!data)
    return <div style={{ fontSize: 13, color: C.textMuted }}>Prüfe Einsatzbereitschaft…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
        Serverseitig geprüft: App-Zugriff, Services, Integrationen, Datenläufe und Portalzugang —
        jede Lücke hat eine direkte Aktion.
      </p>
      {lauf && (
        <div
          style={{
            background: C.blueDim,
            border: `1px solid ${C.blue}30`,
            borderRadius: 10,
            padding: "9px 14px",
            fontSize: 12.5,
            color: C.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <RefreshCw size={13} color={C.blue} style={{ animation: "spin 1.2s linear infinite" }} />
          Datenlauf läuft im Hintergrund ({lauf.status}) — die Ansicht aktualisiert sich
          automatisch.
        </div>
      )}
      {einladungOffen && (
        <PortalEinladungDialog
          client={client}
          onClose={() => setEinladungOffen(false)}
          onInvited={async () => {
            setEinladungOffen(false);
            await reload();
          }}
        />
      )}
      {data.readiness.map((r) => (
        <div
          key={r.app}
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{readinessAppLabel(r.app)}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 700,
                color: statusColor(r.status),
                background: `${statusColor(r.status)}1a`,
                borderRadius: 99,
                padding: "3px 10px",
              }}
            >
              {READINESS_STATUS_LABEL[r.status] || r.status}
            </span>
          </div>
          {r.checks.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 0",
                borderTop: `1px solid ${C.border}55`,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 18,
                  textAlign: "center",
                  fontWeight: 800,
                  color: c.ok ? C.green : c.severity === "kritisch" ? C.red : C.orange,
                }}
              >
                {c.ok ? "✓" : c.severity === "kritisch" ? "✕" : "△"}
              </span>
              <span style={{ color: C.text }}>{c.label}</span>
              <span
                style={{
                  color: C.textMuted,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.detail}
              </span>
              {!c.ok && c.aktion && (
                <button
                  onClick={() => doAktion(r.app, c)}
                  disabled={!!busy}
                  style={{
                    marginLeft: "auto",
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.accent,
                    background: C.accentDim,
                    border: "none",
                    borderRadius: 8,
                    padding: "5px 10px",
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit",
                    opacity: busy && busy !== `${r.app}:${c.id}` ? 0.5 : 1,
                  }}
                >
                  {busy === `${r.app}:${c.id}` ? "läuft…" : c.aktion.label}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Aenderungsprotokoll des Kunden (admin_audit_log via DB-Trigger; nur Whitelist-
// Felder — keine Secrets). Lesezugriff ausschliesslich Owner/Admin.
function ClientAuditLogPanel({ client }) {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch(
        `/api/admin/audit-log?client=${encodeURIComponent(client.id)}&limit=80`,
        {
          headers: { Authorization: `Bearer ${token || ""}` },
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (j?.ok) setEntries(j.entries);
      else setErr(j?.error || "Laden fehlgeschlagen");
    })();
    return () => {
      alive = false;
    };
  }, [client.id]);

  const diffText = (e) => {
    const o = e.old_value || {},
      n = e.new_value || {};
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
    const parts = [];
    for (const k of keys) {
      const ov = JSON.stringify(o[k] ?? null),
        nv = JSON.stringify(n[k] ?? null);
      if (e.action === "update" && ov === nv) continue;
      parts.push(
        e.action === "update" ? `${k}: ${ov} → ${nv}` : `${k}: ${nv !== "null" ? nv : ov}`,
      );
    }
    return parts.join(" · ") || "—";
  };

  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!entries) return <div style={{ fontSize: 13, color: C.textMuted }}>Lade Protokoll…</div>;
  if (!entries.length)
    return (
      <div style={{ fontSize: 13, color: C.textMuted }}>
        Noch keine protokollierten Änderungen — das Protokoll läuft seit dem 17.08.2026.
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {entries.map((e) => (
        <div
          key={e.id}
          style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}55`, fontSize: 12.5 }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: C.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {new Date(e.at).toLocaleString("de-CH", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <Badge color={C.accent}>{e.bereich}</Badge>
            <span style={{ color: C.textMuted }}>
              {e.action === "insert" ? "angelegt" : e.action === "delete" ? "entfernt" : "geändert"}
            </span>
            <span style={{ color: C.textDim, fontSize: 11.5, marginLeft: "auto" }}>
              {e.userEmail || "System/Automation"}
            </span>
          </div>
          <div style={{ color: C.text, marginTop: 3, wordBreak: "break-word" }}>{diffText(e)}</div>
        </div>
      ))}
    </div>
  );
}

function ClientAppAccessPanel({ client }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const apps = EZY_APPS.filter((a) => !a.adminOnly && !a.internalOnly);
  const catalogOf = (appId) => APP_FEATURES[appId] || [];
  const entryOf = (appId) => caa.map.get(client.id)?.get(appId) || null;

  const toggleApp = async (appId) => {
    const enabled = appEnabledFor(caa.map, client.id, appId);
    // Konfigurationsvalidierung (17.08.): App aktivieren, obwohl kritische
    // Voraussetzungen fehlen -> verstaendliche Warnung statt stiller Widerspruch.
    if (!enabled) {
      try {
        const j = await fetchReadiness(client.id);
        const warnungen = j?.ok ? warneBeimAppAktivieren(appId, j.snapshot) : [];
        if (warnungen.length) {
          const text = `Für ${readinessAppLabel(appId)} fehlen Voraussetzungen:\n\n${warnungen
            .map((w) => `• ${w.text}`)
            .join(
              "\n",
            )}\n\nDie App erscheint sonst leer bzw. der Kunde taucht dort nicht auf. Trotzdem freischalten?`;
          if (!window.confirm(text)) return;
        }
      } catch {
        /* Validierung best effort — Freischalten nicht blockieren */
      }
    }
    const err = await caa.setAccess(client.id, appId, { enabled: !enabled });
    if (err) toast(err, "error");
  };
  const toggleFeature = async (appId, featureId) => {
    const cat = catalogOf(appId).map((f) => f.id);
    const e = entryOf(appId);
    // [] = alle Funktionen → beim ersten Abwählen die volle Liste materialisieren.
    const current = e && e.features.length ? e.features : cat;
    const next = current.includes(featureId)
      ? current.filter((f) => f !== featureId)
      : [...current, featureId];
    // Local Grid braucht einen Standort (GBP) — vor dem Aktivieren pruefen.
    if (featureId === "localgrid" && next.includes("localgrid") && !current.includes("localgrid")) {
      try {
        const j = await fetchReadiness(client.id);
        const warnungen = j?.ok ? warneBeimLocalGrid(j.snapshot) : [];
        if (warnungen.length && !window.confirm(`${warnungen[0].text}\n\nTrotzdem aktivieren?`))
          return;
      } catch {
        /* best effort */
      }
    }
    const err = await caa.setAccess(client.id, appId, { features: next });
    if (err) toast(err, "error");
  };

  // Portal-Logins (Rolle viewer) dieses Kunden über die Team-API.
  const [portalUsers, setPortalUsers] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const callTeam = useCallback(async (body) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/admin/team", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ error: "Antwort ungültig" }));
  }, []);
  const loadPortal = useCallback(async () => {
    const j = await callTeam({ action: "list" });
    if (j.ok)
      setPortalUsers(
        (j.users || []).filter(
          (u) => u.role === "viewer" && (u.clientIds || []).includes(client.id),
        ),
      );
  }, [callTeam, client.id]);
  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);
  const invitePortal = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    const j = await callTeam({
      action: "invite",
      email: inviteEmail.trim(),
      role: "viewer",
      clientIds: [client.id],
    });
    setBusy(false);
    if (j.ok) {
      toast(`Portal-Einladung an ${inviteEmail} gesendet`, "success");
      setInviteEmail("");
      await loadPortal();
    } else toast(j.error || "Einladung fehlgeschlagen", "error");
  };
  const removePortal = async (u) => {
    if (!window.confirm(`Portal-Zugang von ${u.email || "Nutzer"} entfernen?`)) return;
    const j = await callTeam({ action: "remove", userId: u.userId });
    if (j.ok) {
      toast("Portal-Zugang entfernt", "success");
      await loadPortal();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {caa.legacy && (
        <div
          style={{
            fontSize: 12,
            color: C.orange,
            border: `1px solid ${C.orange}44`,
            background: `${C.orange}11`,
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Die Datenbank-Migration <code>client_app_portal</code> ist noch nicht angewendet —
          Freischaltungen können noch nicht gespeichert werden (aktuell gilt: alle Apps/Funktionen
          aktiv).
        </div>
      )}
      {apps.map((a) => {
        const enabled = appEnabledFor(caa.map, client.id, a.id);
        const cat = catalogOf(a.id);
        return (
          <div
            key={a.id}
            style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15 }}>{a.icon}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{a.name}</span>
              {!cat.length && <Badge color={C.textDim}>nur intern</Badge>}
              <button
                type="button"
                onClick={() => toggleApp(a.id)}
                disabled={caa.legacy}
                title={
                  enabled
                    ? "App für diesen Kunden deaktivieren"
                    : "App für diesen Kunden aktivieren"
                }
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 99,
                  cursor: caa.legacy ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${enabled ? a.color : C.border}`,
                  background: enabled ? a.tint : "transparent",
                  color: enabled ? a.color : C.textDim,
                }}
              >
                {enabled ? "aktiv" : "inaktiv"}
              </button>
            </div>
            {enabled && cat.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {cat.map((f) => {
                  const on = featureEnabledFor(caa.map, client.id, a.id, f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFeature(a.id, f.id)}
                      disabled={caa.legacy}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 10px",
                        borderRadius: 99,
                        cursor: caa.legacy ? "default" : "pointer",
                        fontSize: 11.5,
                        border: `1px solid ${on ? C.accent : C.border}`,
                        background: on ? C.accentDim : "transparent",
                        color: on ? C.accentLight : C.textDim,
                      }}
                    >
                      {on ? "☑" : "☐"} {f.label}
                    </button>
                  );
                })}
                {!entryOf(a.id)?.features?.length && (
                  <span style={{ fontSize: 11, color: C.textDim, alignSelf: "center" }}>
                    alle Funktionen (Standard)
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Portal-Zugänge (Kunden-Logins, Rolle viewer) */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          Portal-Zugänge
        </div>
        <p style={{ fontSize: 11.5, color: C.textMuted, margin: "0 0 10px" }}>
          Kunden-Logins sehen ausschließlich die oben freigeschalteten Funktionen dieses Kunden —
          read-only, ohne Agenten, Einstellungen oder interne Notizen.
        </p>
        {portalUsers === null ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>Lädt…</div>
        ) : portalUsers.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
            Noch keine Portal-Zugänge.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {portalUsers.map((u) => (
              <div key={u.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge color={C.green}>aktiv</Badge>
                <span style={{ fontSize: 12.5, color: C.text }}>
                  {u.email || u.userId.slice(0, 8)}
                </span>
                <Btn
                  variant="danger"
                  size="sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => removePortal(u)}
                >
                  Sperren
                </Btn>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Inp
              label="E-Mail"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="kunde@firma.ch"
            />
          </div>
          <Btn size="sm" onClick={invitePortal} disabled={busy || !inviteEmail.trim()}>
            {busy ? "…" : "Kunden-Login einladen"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// Zugriffs-Matrix (Admin-Umbau 06.08.): Kunden × Apps auf einen Blick.
// Zelle klicken = App an/aus; Kunde aufklappen = Funktions-Details + Portal.
function MatrixPage({ clients }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const [expanded, setExpanded] = useState(null); // clientId
  const apps = EZY_APPS.filter((a) => !a.adminOnly && !a.internalOnly);
  const toggle = async (clientId, appId) => {
    const err = await caa.setAccess(clientId, appId, {
      enabled: !appEnabledFor(caa.map, clientId, appId),
    });
    if (err) toast(err, "error");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Zugriffs-Matrix</h2>
        <p style={{ fontSize: 12, color: C.textMuted, margin: "4px 0 0" }}>
          Welcher Kunde erscheint in welcher App. Zelle klicken zum Umschalten; Kunde aufklappen für
          Funktions-Freischaltung und Portal-Zugänge. Mitarbeiter-Rechte verwaltest du auf der
          Team-Seite.
        </p>
      </div>
      {caa.legacy && (
        <div
          style={{
            fontSize: 12,
            color: C.orange,
            border: `1px solid ${C.orange}44`,
            background: `${C.orange}11`,
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Migration <code>client_app_portal</code> noch nicht angewendet — die Matrix ist read-only
          (alle Apps gelten als aktiv).
        </div>
      )}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 16,
          overflowX: "auto",
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  fontSize: 11.5,
                  color: C.textMuted,
                  fontWeight: 600,
                  padding: "6px 10px",
                }}
              >
                Kunde
              </th>
              {apps.map((a) => (
                <th
                  key={a.id}
                  style={{
                    fontSize: 11.5,
                    color: C.textMuted,
                    fontWeight: 600,
                    padding: "6px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.icon} {a.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <Fragment key={c.id}>
                <tr style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: C.text,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: 0,
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ width: 12 }}>{expanded === c.id ? "▾" : "▸"}</span>
                      <ClientAvatar
                        name={c.name}
                        domain={c.domain}
                        size={22}
                        radius={6}
                        bg={C.accentDim}
                        fg={C.accentLight}
                        fontSize={9}
                      />
                      {c.name}
                    </button>
                  </td>
                  {apps.map((a) => {
                    const on = appEnabledFor(caa.map, c.id, a.id);
                    return (
                      <td key={a.id} style={{ textAlign: "center", padding: "8px 10px" }}>
                        <button
                          type="button"
                          onClick={() => toggle(c.id, a.id)}
                          disabled={caa.legacy}
                          title={`${a.name} für ${c.name} ${on ? "deaktivieren" : "aktivieren"}`}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            cursor: caa.legacy ? "default" : "pointer",
                            border: `1px solid ${on ? a.color : C.border}`,
                            background: on ? a.tint : "transparent",
                            color: on ? a.color : C.textDim,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {on ? "✓" : "–"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
                {expanded === c.id && (
                  <tr>
                    <td colSpan={apps.length + 1} style={{ padding: "4px 10px 14px" }}>
                      <ClientAppAccessPanel client={c} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
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
  // Deep-Link (18.08.): /admin?client=<uuid> oeffnet das Kundendetail direkt in
  // der Bereitschafts-Ansicht — genutzt von der Analyse-Lead-Uebernahme.
  useEffect(() => {
    try {
      const cid = new URLSearchParams(window.location.search).get("client");
      if (cid && /^[0-9a-f-]{36}$/i.test(cid)) {
        setDetailId(cid);
        setDt("readiness");
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {
      /* egal */
    }
  }, []);
  const [dt, setDt] = useState("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [draft, setDraft] = useState(clientFormFromClient());
  const detail = clients.find((c) => c.id === detailId) || null;
  const effectiveDefaults = defaultsFromStored(customerDefaults);
  useEffect(() => {
    if (detailId && !clients.some((c) => c.id === detailId)) setDetailId(null);
  }, [clients, detailId]);
  // Kundenuebersicht-Readiness (21.08.): ein Batch-Call fuer alle Kunden.
  const [readyAll, setReadyAll] = useState(null); // Map id -> {status, luecke}
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/admin/client-readiness?all=1", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (alive && j?.ok) {
          const m = {};
          for (const k of j.kunden || []) m[k.id] = { status: k.status, luecke: k.luecke };
          setReadyAll(m);
        }
      } catch {
        /* Readiness ist Zusatzinfo — Liste funktioniert auch ohne */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clients.length]);
  const READY_FILTER = ["bereit", "unvollstaendig", "fehler", "deaktiviert"];
  const fl = clients.filter(
    (c) =>
      (sf === "all" ||
        (READY_FILTER.includes(sf) ? (readyAll?.[c.id]?.status || "") === sf : c.status === sf)) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) || c.domain.includes(search)),
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  // Neuanlage laeuft seit 2026-07-14 ueber den 3-Schritte-Onboarding-Wizard;
  // der klassische Editor bleibt fuer "Bearbeiten" bestehen.
  const openCreate = () => setWizardOpen(true);
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
      brandTerms: splitCsv(draft.brandTerms),
      revenueMode: draft.revenueMode === "clicks" ? "clicks" : "revenue",
    });
    // Beim Anlegen die gewaehlten Dienste mitgeben (transient -> client_integrations-Seed).
    if (editorMode === "create") next.services = [...(draft.services || [])];
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
            // Einsatzbereitschafts-Filter (21.08.)
            { id: "bereit", label: "Bereit" },
            { id: "unvollstaendig", label: "Unvollständig" },
            { id: "fehler", label: "Fehler" },
            { id: "deaktiviert", label: "Deaktiviert" },
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
                {/* Favicon der Kundendomain, Fallback auf Initialen (Volkan 13.08.). */}
                <ClientAvatar
                  name={c.name}
                  domain={c.domain}
                  size={42}
                  radius={10}
                  bg={C.accentDim}
                  fg={C.accentLight}
                  fontSize={16}
                />
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
                {readyAll?.[c.id] && (
                  <Badge
                    color={
                      readyAll[c.id].status === "bereit"
                        ? C.green
                        : readyAll[c.id].status === "unvollstaendig"
                          ? C.orange
                          : readyAll[c.id].status === "fehler"
                            ? C.red
                            : C.textDim
                    }
                  >
                    {READINESS_STATUS_LABEL[readyAll[c.id].status] || readyAll[c.id].status}
                  </Badge>
                )}
              </div>
            </div>
            {readyAll?.[c.id]?.luecke && readyAll[c.id].status !== "bereit" && (
              <div
                style={{
                  fontSize: 11.5,
                  color: readyAll[c.id].status === "fehler" ? C.red : C.orange,
                  margin: "-6px 0 10px",
                }}
              >
                Wichtigste Lücke: {readyAll[c.id].luecke}
              </div>
            )}
            <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
              <Badge color={C.textDim}>{c.industry || "—"}</Badge>
              {c.tags.map((t) => (
                <Badge key={t} color={C.blue}>
                  {t}
                </Badge>
              ))}
            </div>
            {/* Score/Keywords/Budget-Kacheln entfernt (2026-07-14): waren statische
                metadata-Platzhalter (ueberall 0) — die echten Zahlen zeigt das
                Dashboard aus audit_runs. Budget bleibt im Detail/Editor pflegbar. */}
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
              {/* Favicon der Kundendomain, Fallback auf Initialen (Volkan 13.08.). */}
              <ClientAvatar
                name={detail.name}
                domain={detail.domain}
                size={36}
                radius={8}
                bg={C.accentDim}
                fg={C.accentLight}
                fontSize={14}
              />
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
                // Admin-Ausbau 17.08.: Einsatzbereitschaft + Änderungsprotokoll.
                { id: "readiness", label: "Bereitschaft" },
                { id: "kpis", label: "KPIs" },
                { id: "notes", label: "Notizen" },
                // Admin-Umbau 06.08.: Lauf-Nachweis + App-/Portal-Freischaltung
                // + Kunden-Einstellungen leben jetzt beim Kunden (statt eigenem
                // Admin-Dashboard bzw. Einstellungen-mit-Kunden-Umschalter).
                { id: "runs", label: "Agent-Läufe" },
                { id: "access", label: "App-Zugriff" },
                { id: "log", label: "Protokoll" },
                { id: "settings", label: "Einstellungen" },
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
            <TechStackCard domain={detail.domain} />
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>
                Integrationen / Dienste
              </div>
              <ServicesPanel C={C} clientId={detail.id} />
            </div>
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
            {dt === "readiness" && (
              <ClientReadinessPanel client={detail} onOpenSettings={() => setDt("settings")} />
            )}
            {dt === "log" && <ClientAuditLogPanel client={detail} />}
            {dt === "runs" && <AgentRunsPanel selectedClient={detail} />}
            {dt === "access" && <ClientAppAccessPanel client={detail} />}
            {dt === "settings" && (
              <ClientSettingsPanel client={detail} onUpsertClient={onUpsertClient} />
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
      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        effectiveDefaults={effectiveDefaults}
        onCreate={onUpsertClient}
        onFinished={(c) => {
          if (!c) return;
          onSelectClient?.(c);
          setDetailId(c.id);
          // Onboarding-Abschluss (17.08.): direkt zeigen, welche Apps bereit sind.
          setDt("readiness");
        }}
        onOpenPanel={(c) => {
          setDetailId(c.id);
          setDt("readiness");
        }}
      />
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
        {/* B5d (Dashboard-Ausbau): Brand-Terms fuer den GSC-Split + Umsatz-Modus */}
        <Inp
          label="Brand-Begriffe (GSC Brand/Non-Brand)"
          value={draft.brandTerms}
          onChange={(v) => setDraft((p) => ({ ...p, brandTerms: v }))}
          placeholder="hotel ava, hotelava, hotel-ava"
        />
        <div style={{ margin: "4px 0 8px" }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Umsatz-Modus</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              ["revenue", "Umsatz-Tracking vollstaendig"],
              ["clicks", "nur Buchungsklicks"],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDraft((p) => ({ ...p, revenueMode: val }))}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${draft.revenueMode === val ? C.accent : C.border}`,
                  background: draft.revenueMode === val ? C.accentDim : "transparent",
                  color: draft.revenueMode === val ? C.accentLight : C.textMuted,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Inp
          label="Notizen"
          value={draft.notes}
          onChange={(v) => setDraft((p) => ({ ...p, notes: v }))}
          textarea
        />
        {editorMode === "create" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>
              Dienste auswählen
            </div>
            <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px", lineHeight: 1.4 }}>
              Aktivierte Dienste werden automatisch verbunden. Nicht gewählte bleiben deaktiviert,
              bis du sie später unter „Integrationen" einschaltest.
            </p>
            <ServicesPicker
              C={C}
              value={draft.services}
              onChange={(s) => setDraft((p) => ({ ...p, services: s }))}
            />
          </div>
        )}
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

// Conversions je Kunde (05.08.2026): zeigt die in GA4 erkannten Key-Events
// (Anzahl 30 Tage, ob GA4 selbst Werte liefert) und erlaubt, pro Conversion
// einen manuellen Wert zu hinterlegen. Der wirkt in der Attribution als
// letzte Stufe der Betrags-Kaskade (dl_value > Umsatz > value > manuell).
function ConversionValuesPanel({ client }) {
  const toast = useToast();
  const [state, setState] = useState({
    loading: true,
    error: "",
    ga4: false,
    events: [],
    setup: null,
  });
  const [drafts, setDrafts] = useState({}); // event -> { value, currency }
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!client?.id) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/admin/ga4-conversions?client=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setState({
        loading: false,
        error: "",
        ga4: !!j.ga4,
        events: j.events || [],
        setup: j.setup || null,
      });
      setDrafts({});
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  };
  useEffect(() => {
    load();
  }, [client?.id]);

  const draftOf = (ev) =>
    drafts[ev.name] ?? { value: ev.manualValue || "", currency: ev.currency || "CHF" };
  const setDraft = (name, patch) =>
    setDrafts((d) => ({ ...d, [name]: { ...(d[name] ?? {}), ...patch } }));
  const dirty = Object.keys(drafts).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const values = Object.entries(drafts).map(([event, d]) => ({
        event,
        value: Number(d.value) || 0,
        currency: /^[A-Z]{3}$/.test(String(d.currency || "")) ? d.currency : "CHF",
      }));
      const r = await fetch("/api/admin/ga4-conversions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ client: client.id, values }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast("Conversion-Werte gespeichert — wirken ab dem nächsten Daten-Lauf", "success");
      await load();
    } catch (e) {
      toast("Speichern fehlgeschlagen: " + String(e?.message || e), "error");
    } finally {
      setSaving(false);
    }
  };

  const inpStyle = {
    width: 90,
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    textAlign: "right",
  };
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>
        Conversions{client?.name ? ` — ${client.name}` : ""}
      </h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
        Alle Conversions (Key-Events), die GA4 für diesen Kunden erkennt. Liefert GA4 selbst keinen
        Betrag, kannst du hier pro Conversion einen Wert hinterlegen — er wird ab dem nächsten
        Daten-Lauf automatisch angewendet.
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
        }}
      >
        {state.loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Lade GA4-Conversions…</div>
        ) : state.error ? (
          <div style={{ color: C.red || "#e05d5d", fontSize: 13 }}>{state.error}</div>
        ) : !state.ga4 && !state.events.length ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>
            Für diesen Kunden ist kein GA4 verbunden — sobald die Verbindung steht, erscheinen die
            erkannten Conversions hier automatisch.
          </div>
        ) : (
          <>
            {state.setup?.dlValue && (
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                ✓ Diese Property sendet Buchungswerte bereits selbst (dl_value) — manuelle Werte
                sind nur für Events nötig, die keinen eigenen Betrag tragen.
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      color: C.textMuted,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "6px 8px" }}>Conversion</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>30 Tage</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Wert aus GA4</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Manueller Wert</th>
                    <th style={{ padding: "6px 8px" }}>Währung</th>
                  </tr>
                </thead>
                <tbody>
                  {state.events.map((ev) => {
                    const d = draftOf(ev);
                    return (
                      <tr key={ev.name} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px", color: C.text, fontWeight: 600 }}>
                          {ev.name}
                          {!ev.isKeyEvent && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10.5,
                                color: C.textMuted,
                                fontWeight: 400,
                              }}
                            >
                              nicht als Key-Event markiert
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: C.text,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {ev.count30d.toLocaleString("de-CH")}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: ev.ga4Value > 0 ? C.green : C.textMuted,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {ev.ga4Value > 0 ? Math.round(ev.ga4Value).toLocaleString("de-CH") : "—"}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={d.value}
                            placeholder="0"
                            onChange={(e) =>
                              setDraft(ev.name, { value: e.target.value, currency: d.currency })
                            }
                            style={inpStyle}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <select
                            value={d.currency}
                            onChange={(e) =>
                              setDraft(ev.name, { value: d.value, currency: e.target.value })
                            }
                            style={{ ...inpStyle, width: 74, textAlign: "left" }}
                          >
                            {["CHF", "EUR", "USD", "GBP"].map((cu) => (
                              <option key={cu} value={cu}>
                                {cu}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <Btn icon={Save} onClick={save} disabled={!dirty || saving}>
                {saving ? "Speichert…" : "Werte speichern"}
              </Btn>
              <span style={{ fontSize: 11.5, color: C.textMuted }}>
                Wert 0 entfernt einen hinterlegten Betrag wieder.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS (5 tabs)
// ═══════════════════════════════════════════════════════════════════════════
// Security-Runde 2 (21.08.): Zustand der WordPress-Secrets — NUR Zaehler
// (aktuell/veraltet/Klartext/fehlerhaft), niemals Inhalte. Quelle:
// /api/admin/secret-status (owner/admin, Org-gebunden).
function WpSecretStatusCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/admin/secret-status", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (j?.ok) setData(j);
      } catch {}
    })();
  }, []);
  if (!data) return null;
  const pill = (label, n, color) => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 8,
        background: `${color}18`,
        color,
      }}
    >
      {label}: {n}
    </span>
  );
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        WordPress-Zugänge (verschlüsselt gespeichert)
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {pill("Aktuell", data.aktuell, C.green)}
        {pill("Veraltete Version", data.veraltet, C.orange)}
        {pill("Klartext", data.klartext, data.klartext ? C.red : C.textMuted)}
        {pill("Fehlerhaft", data.fehlerhaft, data.fehlerhaft ? C.red : C.textMuted)}
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {data.gesamt} Verbindung(en)
          {data.strictModus ? " · Klartext-Fallback deaktiviert" : ""}
          {!data.dedizierterSchluessel ? " · Hinweis: WP_SECRET_KEY_V1 noch nicht gesetzt" : ""}
        </span>
      </div>
    </div>
  );
}

// Analyse-Worker-Ueberwachung (21.08.): letzter Lauf, Laufzeit, bearbeitete
// Jobs und Fehler des EzyAI-Analyse-Workers — Zustand aktiv/verzoegert/
// ausgefallen. Quelle: /api/agent/analyse?worker=1 (Heartbeat-Tabelle).
function AnalyseWorkerCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/agent/analyse?worker=1", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (alive && j?.ok) setData(j);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  const farbe =
    data.zustand === "aktiv" ? C.green : data.zustand === "verzoegert" ? C.orange : C.red;
  const label =
    data.zustand === "aktiv"
      ? "aktiv"
      : data.zustand === "verzoegert"
        ? "verzögert"
        : "ausgefallen";
  const hb = data.heartbeat || {};
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Analyse-Worker (EzyAI Analyse)
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 8,
            background: `${farbe}18`,
            color: farbe,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {hb.last_run_at
            ? `Letzter Lauf ${new Date(hb.last_run_at).toLocaleString("de-CH")} · ${hb.duration_ms} ms · ${hb.jobs_processed} Etappe(n) · ${hb.errors} Fehler`
            : "Noch kein Lauf registriert"}
          {" · Zeitplan: Task «EzyOne-Analyse-Worker», minütlich"}
        </span>
      </div>
      {data.zustand !== "aktiv" && (
        <div style={{ marginTop: 8, fontSize: 12, color: farbe, fontWeight: 600 }}>
          Der Worker lief länger als das erlaubte Intervall nicht — Analysen bleiben in der
          Warteschlange. Task-Scheduler auf dem Cloud-PC prüfen.
        </div>
      )}
    </div>
  );
}

// Systemcheck (Admin-Ausbau 21.08.): zeigt serverseitig geprueft, ob die
// erwarteten Tabellen/Spalten/RLS wirklich existieren (fehlende Migrationen
// erschienen frueher als "leere Daten"), plus Worker-Heartbeat und
// WP-Secret-Migrationsstatus. Quelle: /api/admin/system-check (owner/admin).
function SystemCheckPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const lade = useCallback(async () => {
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/admin/system-check", {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        setData(j);
        setErr("");
      } else setErr(j?.error || `HTTP ${r.status}`);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void lade();
  }, [lade]);
  const farbe = (st) =>
    st === "vorhanden" ? C.green : st === "fehlt" ? C.red : st === "fehlerhaft" ? C.red : C.orange;
  const label = (st) =>
    st === "vorhanden"
      ? "vorhanden"
      : st === "fehlt"
        ? "FEHLT"
        : st === "fehlerhaft"
          ? "FEHLERHAFT"
          : "nicht prüfbar";
  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: C.textMuted }}>Prüfe System…</div>;
  const workerFarbe =
    data.worker?.zustand === "aktiv"
      ? C.green
      : data.worker?.zustand === "verzoegert"
        ? C.orange
        : C.red;
  const pill = (bg, txt) => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 8,
        background: `${bg}18`,
        color: bg,
        whiteSpace: "nowrap",
      }}
    >
      {txt}
    </span>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Systemcheck</h2>
        <Btn size="sm" variant="secondary" icon={RefreshCw} onClick={lade} disabled={busy}>
          {busy ? "Prüft…" : "Neu prüfen"}
        </Btn>
        <span style={{ fontSize: 11, color: C.textDim }}>
          Stand {new Date(data.stand).toLocaleTimeString("de-CH")}
        </span>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Analyse-Worker</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {pill(workerFarbe, data.worker?.zustand || "nicht prüfbar")}
          <span style={{ fontSize: 11.5, color: C.textMuted }}>
            {data.worker?.lastRunAt
              ? `Letzter Lauf ${new Date(data.worker.lastRunAt).toLocaleString("de-CH")} · ${data.worker.jobsProcessed} Etappe(n) · ${data.worker.errors} Fehler`
              : "Noch kein Lauf registriert"}
          </span>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>WordPress-Secrets</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {pill(C.green, `Aktuell: ${data.secrets.aktuell}`)}
          {pill(
            data.secrets.veraltet ? C.orange : C.textMuted,
            `Veraltet: ${data.secrets.veraltet}`,
          )}
          {pill(data.secrets.klartext ? C.red : C.textMuted, `Klartext: ${data.secrets.klartext}`)}
          {pill(
            data.secrets.fehlerhaft ? C.red : C.textMuted,
            `Fehlerhaft: ${data.secrets.fehlerhaft}`,
          )}
          <span style={{ fontSize: 11, color: C.textDim }}>
            {data.secrets.dedizierterSchluessel
              ? "dedizierter Schlüssel aktiv"
              : "WP_SECRET_KEY_V1 noch nicht gesetzt"}
            {data.secrets.strictModus ? " · Klartext-Fallback deaktiviert" : ""}
          </span>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "6px 16px",
        }}
      >
        {data.checks.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 0",
              borderBottom: `1px solid ${C.border}55`,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
            <span
              style={{
                fontSize: 11.5,
                color: C.textDim,
                maxWidth: 360,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.detail}
            >
              {c.detail !== "ok" ? c.detail : ""}
            </span>
            {pill(farbe(c.status), label(c.status))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsPage({
  tools,
  onToggleTool,
  selectedClient,
  profile,
  onSaveProfile,
  customerDefaults,
  onSaveDefaults,
  onClientUpdated,
  onOpenAgents = null,
}) {
  const toast = useToast();
  const [sec, setSec] = useState("profil");
  const [profileDraft, setProfileDraft] = useState(profile);
  const live = useLiveIntegrations();
  const dash = useEzyDashboardConfig();
  useEffect(() => setProfileDraft(profile), [profile]);
  // Admin-Umbau Teil 2 (06.08.): "Kunden-Einstellungen" + "Conversions" sind
  // ins Kunden-Detail gezogen (Kunden → Kunde → Einstellungen) — hier bleiben
  // nur noch organisationsweite Einstellungen, der Kunden-Umschalter entfällt.
  const sects = [
    ["profil", "Profil", Users],
    ["api", "API-Schlüssel", Key],
    ["skills", "Skills / Tools", Zap],
    ["dashboard", "Dashboard-Metriken", BarChart3],
    // Admin-Umbau 06.08.: Agenten-Verwaltung wohnt jetzt hier (statt eigenem
    // Nav-Punkt) — der Eintrag springt auf die (unveränderte) Agents-Seite.
    ...(onOpenAgents ? [["agents", "Agenten & Automatisierung", Bot]] : []),
    ["system", "Systemcheck", Activity],
    ["about", "Über Ezy One", Info],
  ];
  const providerRows = [
    ["Gemini", live.data?.providers?.gemini, C.green, Bot],
    ["OpenAI", live.data?.providers?.openai, C.blue, Bot],
    ["Anthropic", live.data?.providers?.anthropic, C.pink, Bot],
    ["Perplexity", live.data?.providers?.perplexity, C.orange, Sparkles],
    ["DataForSEO", live.data?.providers?.dataforseo, C.green, Link2],
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
            onClick={() => (id === "agents" && onOpenAgents ? onOpenAgents() : setSec(id))}
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
        <div style={{ fontSize: 11, color: C.textDim, padding: "10px 14px", lineHeight: 1.5 }}>
          Kundenbezogene Einstellungen (Sprache, Tabs, Conversions, App-Zugriff) findest du im
          Kunden-Detail: Kunden → Kunde anklicken.
        </div>
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
            <WpSecretStatusCard />
            <AnalyseWorkerCard />
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
                    background: `linear-gradient(135deg,${live.data?.canonry?.configured && live.data?.canonry?.reachable && live.data?.canonry?.authenticated ? C.greenDim : C.orangeDim},${C.blueDim}), ${C.card}`,
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
              schalte einfach ab, was du nicht brauchst. Gilt für die ganze Organisation (nur
              Admins).
            </p>
            {[
              [
                "SEO",
                [
                  ["seo.ahrefs", "Backlink-KPIs (Traffic, Visibility, Authority, Keywords)"],
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
        {sec === "system" && <SystemCheckPanel />}
        {sec === "about" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Über Ezy One</h2>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                Ezy One Platform
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
    width: 16,
    height: 16,
    borderRadius: 4,
    border: `1.5px solid ${on ? C.accent : C.border}`,
    background: on ? C.accent : "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
    cursor: "pointer",
  });
  return (
    <div
      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}
    >
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {selected.map((s) => {
            const cb = skillCategoryBadge(s);
            return (
              <span
                key={s}
                onClick={() => toggle(s)}
                title={cb.label ? `Kategorie: ${cb.label}` : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 5,
                  padding: "2px 7px",
                  fontSize: 11,
                  color: C.text,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: cb.color,
                    flexShrink: 0,
                  }}
                />
                {cb.label && <span style={{ color: cb.color, fontWeight: 600 }}>{cb.label}</span>}
                {s} ×
              </span>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {SKILL_CATEGORIES.map((cat) => {
          const skills = SKILL_CATALOG.filter((s) => s.category === cat.id);
          const selectedCount = skills.filter((s) => selected.includes(s.skill)).length;
          const isOpen = expanded === cat.id;
          return (
            <div key={cat.id} style={{ border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div
                onClick={() => setExpanded(isOpen ? null : cat.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  cursor: "pointer",
                  background: isOpen ? `${cat.color}11` : "transparent",
                  borderRadius: 6,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>
                  {cat.label}
                </span>
                {selectedCount > 0 && (
                  <span style={{ fontSize: 10, color: cat.color }}>
                    {selectedCount}/{skills.length}
                  </span>
                )}
                <span style={{ fontSize: 10, color: C.textMuted }}>{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && (
                <div
                  style={{
                    padding: "6px 10px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    onClick={() => selectAll(cat.id)}
                    style={{ fontSize: 10, color: C.accent, cursor: "pointer", marginBottom: 4 }}
                  >
                    {skills.every((s) => selected.includes(s.skill))
                      ? "Alle abwählen"
                      : "Alle auswählen"}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 4,
                    }}
                  >
                    {skills.map((s) => {
                      const on = selected.includes(s.skill);
                      return (
                        <div
                          key={s.id}
                          onClick={() => toggle(s.skill)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 6px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background: on ? `${C.accent}11` : "transparent",
                            borderLeft: `3px solid ${cat.color}`,
                          }}
                          title={`${cat.label} · ${s.description}`}
                        >
                          <span style={checkStyle(on)}>{on ? "✓" : ""}</span>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: cat.color,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              color: C.text,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.skill}
                          </span>
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

// ── Activity / Runs tab ──────────────────────────────────────────────────────
// Live view of agent runs (running/done/error), active schedules, and the
// per-client protocol (Obsidian vault page) — so you can verify at a glance
// whether the agents are running and trace what they did.
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function ActivityPage({ selectedClient, clients }) {
  // Kostenübersicht ist ausschliesslich fuer den SuperAdmin (owner) sichtbar –
  // Admins und Mitarbeiter sehen sie nicht (RBAC 2026-07-15).
  const { role } = useAuth();
  const isOwner = role === "owner";
  const [data, setData] = useState({
    runs: [],
    running: 0,
    schedules: [],
    uptime: [],
    uptimeDown: 0,
    costs: null,
  });
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const auth = { Authorization: `Bearer ${session?.access_token || ""}` };
      const r = await fetch("/api/agent/runs", { headers: auth });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setData({
          runs: j.runs || [],
          running: j.running || 0,
          schedules: j.schedules || [],
          uptime: j.uptime || [],
          uptimeDown: j.uptimeDown || 0,
          costs: j.costs || null,
        });
        setErr("");
      } else setErr(j.error || "Laden fehlgeschlagen");
      const ar = await fetch("/api/agent/approvals", { headers: auth })
        .then((x) => x.json())
        .catch(() => ({}));
      if (ar?.ok) setApprovals(ar.items || []);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 8s so "running" status is live.
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const fmtTime = (ts) =>
    ts
      ? new Date(ts).toLocaleString("de-CH", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const fmtDur = (ms) =>
    ms ? (ms >= 60000 ? `${Math.round(ms / 60000)}min` : `${Math.round(ms / 1000)}s`) : "";
  const statusMeta = (s) =>
    s === "running"
      ? { c: C.blue, label: "läuft" }
      : s === "done"
        ? { c: C.green, label: "fertig" }
        : { c: C.red, label: "Fehler" };

  const freqLabel = (sch) => {
    if (sch.dayOfMonth) return `am ${sch.dayOfMonth}. um ${sch.time}`;
    if (Array.isArray(sch.weekdays) && sch.weekdays.length)
      return `${sch.weekdays.map((d) => WEEKDAY_SHORT[d]).join(",")} um ${sch.time}`;
    return `täglich um ${sch.time}`;
  };

  // Pro gewähltem Kunde filtern: Runs/Schedules tragen clientId, Uptime via Domain.
  // Reaktiv aus den geladenen Daten abgeleitet → Kundenwechsel filtert sofort neu.
  const cid = selectedClient?.id || "";
  const normDom = (d) =>
    String(d || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim();
  const selDom = normDom(selectedClient?.domain);
  const runs = cid ? (data.runs || []).filter((r) => r.clientId === cid) : data.runs || [];
  const schedules = cid
    ? (data.schedules || []).filter((s) => s.clientId === cid)
    : data.schedules || [];
  const uptime =
    cid && selDom
      ? (data.uptime || []).filter((u) => normDom(u.domain) === selDom)
      : data.uptime || [];
  const costs = data.costs;
  const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
  const clientCost =
    costs && cid ? (costs.byClient || []).find((c) => c.name === selectedClient?.name)?.usd : null;
  const running = runs.filter((r) => r.status === "running").length;
  const uptimeDown = uptime.filter((u) => !u.ok).length;
  // Freigaben pro gewähltem Kunde (lose Namens-Übereinstimmung mit dem Vault-Namen).
  const normName = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const clientApprovals = approvals.filter(
    (a) => !cid || normName(a.clientName) === normName(selectedClient?.name),
  );
  const setApprovalStatus = async (id, status) => {
    setApprovals((p) => p.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      await fetch("/api/agent/approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, status }),
      });
    } catch {}
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: C.accentDim,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Activity size={19} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: C.text }}>Aktivität</h1>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              {running > 0
                ? `${running} Agent${running === 1 ? "" : "en"} läuft gerade`
                : "Keine laufenden Agenten"}
              {" · aktualisiert alle 8s"}
            </div>
          </div>
        </div>
        <Btn variant="secondary" size="sm" icon={RefreshCw} onClick={load}>
          Aktualisieren
        </Btn>
      </div>

      {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}

      {/* API-Kosten – nur SuperAdmin (owner) */}
      {isOwner && costs && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
            API-Kosten
            {costs.runs ? (
              <span style={{ color: C.textDim, fontWeight: 400 }}> · {costs.runs} Läufe</span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "Heute", v: costs.today },
              { label: "7 Tage", v: costs.last7Days },
              { label: "Dieser Monat", v: costs.thisMonth },
              { label: "Gesamt", v: costs.total },
              ...(cid
                ? [
                    {
                      label: `${selectedClient?.name || "Kunde"} (gesamt)`,
                      v: clientCost,
                      accent: true,
                    },
                  ]
                : []),
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: "1 1 130px",
                  minWidth: 130,
                  background: C.card,
                  border: `1px solid ${s.accent ? C.accent : C.border}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 11, color: C.textMuted }}>{s.label}</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: s.accent ? C.accentLight : C.text,
                  }}
                >
                  {fmtUsd(s.v)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Freigaben (Wartet auf dich) */}
      {clientApprovals.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
            Freigaben
            {(() => {
              const o = clientApprovals.filter((a) => a.status === "offen").length;
              return o ? (
                <span style={{ color: C.accent, fontWeight: 400 }}> · {o} offen</span>
              ) : (
                <span style={{ color: C.green, fontWeight: 400 }}> · alle bearbeitet</span>
              );
            })()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {clientApprovals.map((a) => {
              const stc =
                a.status === "offen"
                  ? C.accent
                  : a.status === "freigegeben"
                    ? C.blue
                    : a.status === "abgelehnt"
                      ? C.red
                      : C.green;
              return (
                <div
                  key={a.id}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.45 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                        {a.clientName}
                      </div>
                    </div>
                    <Badge color={stc}>{a.status}</Badge>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    {a.status !== "freigegeben" && (
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => setApprovalStatus(a.id, "freigegeben")}
                      >
                        Freigeben
                      </Btn>
                    )}
                    {a.status !== "erledigt" && (
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => setApprovalStatus(a.id, "erledigt")}
                      >
                        Erledigt
                      </Btn>
                    )}
                    {a.status !== "abgelehnt" && (
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => setApprovalStatus(a.id, "abgelehnt")}
                      >
                        Ablehnen
                      </Btn>
                    )}
                    {a.status !== "offen" && (
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => setApprovalStatus(a.id, "offen")}
                      >
                        Zurücksetzen
                      </Btn>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Schedules */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
          Zeitpläne
        </div>
        {schedules.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: "8px 0" }}>
            Keine Zeitpläne angelegt.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {schedules.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.enabled ? C.green : C.textDim,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>
                    {s.clientName || "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.textMuted }}>
                    {freqLabel(s)}
                    {s.enabled ? "" : " · pausiert"}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.textDim, textAlign: "right" }}>
                  {s.lastRunDate ? `zuletzt: ${s.lastRunDate}` : "noch nie gelaufen"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent runs */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
          Letzte Läufe
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: C.textDim }}>Lädt…</div>
        ) : runs.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: "8px 0" }}>
            Noch keine Läufe registriert.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {runs.map((r) => {
              const m = statusMeta(r.status);
              return (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: m.c,
                      fontSize: 12,
                      fontWeight: 700,
                      minWidth: 70,
                    }}
                  >
                    {r.status === "running" ? (
                      <Clock size={13} />
                    ) : r.status === "done" ? (
                      <CheckCircle size={13} />
                    ) : (
                      <AlertCircle size={13} />
                    )}
                    {m.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: C.text,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.agentName || "Agent"}
                      {r.clientName ? ` · ${r.clientName}` : ""}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: C.textDim,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.inputPreview || ""}
                      {r.error ? ` — ${r.error}` : ""}
                    </div>
                  </div>
                  <div
                    style={{ fontSize: 11, color: C.textDim, textAlign: "right", flexShrink: 0 }}
                  >
                    {fmtTime(r.createdAt)}
                    {r.durationMs ? ` · ${fmtDur(r.durationMs)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Verfügbarkeit (Uptime) */}
      {uptime.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
            Verfügbarkeit{" "}
            {uptimeDown > 0 ? (
              <span style={{ color: C.red }}>· {uptimeDown} offline</span>
            ) : (
              <span style={{ color: C.green }}>· alle online</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {uptime.map((s) => (
              <div
                key={s.domain}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.ok ? C.green : C.red,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{s.name || s.domain}</span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: s.ok ? C.textMuted : C.red,
                    fontWeight: s.ok ? 400 : 600,
                  }}
                >
                  {s.ok ? `online (HTTP ${s.code})` : `offline (${s.code || "kein Response"})`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Änderungen werden jetzt täglich unter Content → Notes protokolliert. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 12.5,
          color: C.textMuted,
        }}
      >
        <FileText size={15} color={C.textDim} />
        Alle vom Agenten durchgeführten Änderungen werden täglich unter{" "}
        <strong style={{ color: C.text, margin: "0 3px" }}>Content → Notes</strong> protokolliert
        („Agent-Änderungen JJJJ-MM-TT").
      </div>
    </div>
  );
}

function AgentsPage({ selectedClient }) {
  // Kosten sind nur fuer den SuperAdmin (owner) sichtbar (RBAC 2026-07-15).
  const { role } = useAuth();
  const isOwner = role === "owner";
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
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await ezyFetch("/api/agent/templates");
      const j = await r.json().catch(() => ({}));
      if (j.ok) setTemplates(j.templates || []);
    } catch {}
  }, []);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const createFromTemplate = async (tpl) => {
    if (clientId === "global") {
      setMsg("Bitte zuerst einen Kunden wählen");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const r = await ezyFetch("/api/agent/templates", {
        method: "POST",
        headers: JSON_HEAD,
        body: JSON.stringify({
          templateId: tpl.id,
          clientId,
          clientName: selectedClient?.name || "",
          clientDomain: selectedClient?.domain || "",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || "Erstellen fehlgeschlagen");
      setShowTemplates(false);
      await load();
      setMsg(`Agent „${j.agent?.name}" aus Vorlage erstellt`);
    } catch (e) {
      setMsg(String(e?.message || e));
    }
    setBusy(false);
  };

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
      await ezyFetch(
        `/api/agent/memory?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      await loadMemory(agentId);
      if (selectedSessions[agentId] === sessionId)
        setSelectedSessions((p) => ({ ...p, [agentId]: null }));
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

  // Autonomie-Schalter (2026-07-20): "autonom" = darf deployen (qa-gate),
  // "report" = hartes Deploy-Verbot im agent-service (buildAgentPrompt) —
  // der Agent analysiert und legt Freigabe-Punkte an, setzt aber nichts um.
  const toggleAutonomy = async (a) => {
    const next = a.autonomy === "report" ? "autonom" : "report";
    try {
      const r = await ezyFetch(`/api/agent/agents?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: JSON_HEAD,
        body: JSON.stringify({ id: a.id, clientId, autonomy: next }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Fehler");
      await load();
      setMsg(
        next === "report"
          ? `„${a.name}" arbeitet jetzt NUR-REPORT (keine Deploys).`
          : `„${a.name}" arbeitet jetzt AUTONOM (Deploys via QA-Gate erlaubt).`,
      );
    } catch (e) {
      setMsg(String(e?.message || e));
    }
  };

  const del = async (id) => {
    if (!window.confirm("Agent wirklich löschen?")) return;
    try {
      await ezyFetch(
        `/api/agent/agents?clientId=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
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
        body: JSON.stringify({
          id: agent.id,
          clientId,
          clientName: selectedClient?.name || null,
          input: runInputs[agent.id] || "",
          resumeSessionId,
        }),
      });
      const j = await r.json();
      if (!j.jobId) throw new Error(j.error || "Start fehlgeschlagen");
      for (let i = 0; i < 180; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const pr = await ezyFetch(`/api/agent/run-agent?jobId=${encodeURIComponent(j.jobId)}`);
        const pj = await pr.json();
        if (pj.status === "done") {
          setRunResult({
            id: agent.id,
            ok: true,
            text: pj.result,
            cost: pj.costUsd,
            sessionId: pj.sessionId,
          });
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
      <div
        className="mobile-wrap"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>
            Agents{selectedClient?.name ? ` — ${selectedClient.name}` : ""}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            KI-Assistenten für diesen Kunden. Wechsle den Kunden, um dessen Agents zu sehen.
          </div>
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            {templates.length > 0 && (
              <button
                onClick={() => setShowTemplates((v) => !v)}
                style={btn(C.card)}
                title="Agent aus einer Vorlage erstellen"
              >
                ▦ Aus Vorlage
              </button>
            )}
            <button
              onClick={() =>
                setEditing({
                  name: "",
                  description: "",
                  instructions: "",
                  model: "claude-sonnet-4-6",
                  skills: [],
                })
              }
              style={btn(C.accent)}
            >
              + Neuer Agent
            </button>
            {showTemplates && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 6,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 8,
                  minWidth: 320,
                  zIndex: 30,
                  boxShadow: "0 8px 32px rgba(0,0,0,.4)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: C.textDim,
                    textTransform: "uppercase",
                    letterSpacing: ".5px",
                    padding: "4px 8px 8px",
                  }}
                >
                  Vorlagen
                </div>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => createFromTemplate(t)}
                    disabled={busy}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.name}</div>
                    <div
                      style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2, lineHeight: 1.4 }}
                    >
                      {t.description}
                    </div>
                  </button>
                ))}
                <div
                  style={{
                    fontSize: 10.5,
                    color: C.textDim,
                    padding: "8px 8px 2px",
                    borderTop: `1px solid ${C.border}`,
                    marginTop: 6,
                  }}
                >
                  Wird für „{selectedClient?.name || "—"}" angelegt (Name/Domain automatisch
                  eingesetzt).
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, color: C.textMuted }}>{msg}</div>}

      {editing && (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            className="ezy-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div>
              <div style={lbl}>Name</div>
              <input
                style={inputStyle}
                value={editing.name}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                placeholder="z. B. SEO-Audit-Bot"
              />
            </div>
            <div>
              <div style={lbl}>Modell</div>
              <select
                style={inputStyle}
                value={editing.model}
                onChange={(e) => setEditing((p) => ({ ...p, model: e.target.value }))}
              >
                {AGENT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div style={lbl}>Arbeitsmodus</div>
            <div
              style={{
                display: "flex",
                gap: 0,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                overflow: "hidden",
                width: "fit-content",
              }}
            >
              {[
                ["autonom", "🤖 Autonom (deployt via QA-Gate)"],
                ["report", "📋 Nur Report (keine Deploys)"],
              ].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setEditing((p) => ({ ...p, autonomy: val }))}
                  style={{
                    background:
                      (editing.autonomy === "report" ? "report" : "autonom") === val
                        ? val === "report"
                          ? C.orange || "#f59e0b"
                          : C.green
                        : "transparent",
                    color:
                      (editing.autonomy === "report" ? "report" : "autonom") === val
                        ? "#fff"
                        : C.textMuted,
                    border: "none",
                    padding: "8px 14px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              „Nur Report" wird im agent-service hart durchgesetzt: der Agent analysiert und legt
              Freigabe-Punkte an, verändert aber nichts an Kundensystemen — auch keine bereits
              freigegebenen Punkte.
            </div>
          </div>
          <div>
            <div style={lbl}>Beschreibung (optional)</div>
            <input
              style={inputStyle}
              value={editing.description}
              onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
              placeholder="Wofür ist dieser Agent?"
            />
          </div>
          <div>
            <div style={lbl}>Instruktionen (System-Prompt)</div>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 120,
                fontFamily: "'JetBrains Mono',monospace",
                lineHeight: 1.6,
                resize: "vertical",
              }}
              value={editing.instructions}
              onChange={(e) => setEditing((p) => ({ ...p, instructions: e.target.value }))}
              placeholder="Du bist ein SEO-Experte für Schweizer KMU. Antworte strukturiert, auf Deutsch ..."
            />
          </div>
          <div>
            <div style={lbl}>Skills (optional)</div>
            <SkillPicker
              selected={editing.skills || []}
              onChange={(skills) => setEditing((p) => ({ ...p, skills }))}
            />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              Leer = freier Assistent. Skills geben dem Agent spezialisierte Fähigkeiten.
            </div>
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
          <div
            style={{
              color: C.textMuted,
              fontSize: 13,
              padding: 24,
              textAlign: "center",
              border: `1px dashed ${C.border}`,
              borderRadius: 12,
            }}
          >
            Noch keine Agents. Erstelle deinen ersten mit „+ Neuer Agent".
          </div>
        ) : (
          <div
            className="client-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
              gap: 14,
            }}
          >
            {agents.map((a) => (
              <div
                key={a.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{a.name}</div>
                    {a.description && (
                      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                        {a.description}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      alignItems: "flex-end",
                    }}
                  >
                    <Badge color={C.blue}>
                      {
                        (AGENT_MODELS.find((m) => m.id === a.model)?.label || a.model || "").split(
                          " ",
                        )[0]
                      }
                    </Badge>
                    <button
                      onClick={() => toggleAutonomy(a)}
                      title={
                        a.autonomy === "report"
                          ? "Klick: auf Autonom umschalten (Deploys via QA-Gate erlaubt)"
                          : "Klick: auf Nur-Report umschalten (hartes Deploy-Verbot)"
                      }
                      style={{
                        background:
                          a.autonomy === "report" ? "rgba(245,158,11,.15)" : "rgba(16,185,129,.15)",
                        color: a.autonomy === "report" ? "#f59e0b" : C.green,
                        border: `1px solid ${a.autonomy === "report" ? "#f59e0b55" : C.green + "55"}`,
                        borderRadius: 6,
                        padding: "3px 8px",
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {a.autonomy === "report" ? "📋 Nur Report" : "🤖 Autonom"}
                    </button>
                  </div>
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
                <textarea
                  style={{ ...inputStyle, minHeight: 54, resize: "vertical" }}
                  placeholder="Anfrage / Aufgabe an den Agenten…"
                  value={runInputs[a.id] || ""}
                  onChange={(e) => setRunInputs((p) => ({ ...p, [a.id]: e.target.value }))}
                />
                {selectedSessions[a.id] && (
                  <div
                    style={{
                      fontSize: 11,
                      color: C.green,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }}
                    />
                    Session aktiv — fortsetzen
                    <button
                      onClick={() => setSelectedSessions((p) => ({ ...p, [a.id]: null }))}
                      style={{
                        background: "none",
                        border: "none",
                        color: C.textMuted,
                        cursor: "pointer",
                        fontSize: 11,
                        padding: 0,
                      }}
                    >
                      (neue starten)
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => run(a)} disabled={runningId === a.id} style={btn(C.green)}>
                    {runningId === a.id
                      ? "läuft…"
                      : selectedSessions[a.id]
                        ? "▶ Fortsetzen"
                        : "▶ Ausführen"}
                  </button>
                  <button
                    onClick={() => {
                      loadMemory(a.id);
                      setShowMemory(showMemory === a.id ? null : a.id);
                    }}
                    style={btn()}
                  >
                    {showMemory === a.id ? "Gedächtnis ▲" : "Gedächtnis ▼"}
                  </button>
                  <button
                    onClick={() => setEditing({ ...a, skills: a.skills || [] })}
                    style={btn()}
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => del(a.id)}
                    style={{ ...btn(), color: C.textMuted, marginLeft: "auto" }}
                  >
                    Löschen
                  </button>
                </div>
                {showMemory === a.id && (
                  <div
                    style={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: 10,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6, color: C.text }}>
                      Sessions (Gedächtnis)
                    </div>
                    {(agentSessions[a.id] || []).length === 0 ? (
                      <div style={{ color: C.textMuted }}>Noch keine Sessions gespeichert.</div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          maxHeight: 180,
                          overflow: "auto",
                        }}
                      >
                        {(agentSessions[a.id] || []).map((s) => (
                          <div
                            key={s.sessionId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 8px",
                              borderRadius: 6,
                              background:
                                selectedSessions[a.id] === s.sessionId
                                  ? `${C.accent}22`
                                  : C.surface,
                              border: `1px solid ${selectedSessions[a.id] === s.sessionId ? C.accent : C.border}`,
                              cursor: "pointer",
                            }}
                            onClick={() =>
                              setSelectedSessions((p) => ({ ...p, [a.id]: s.sessionId }))
                            }
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: C.text,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {s.title}
                              </div>
                              <div style={{ fontSize: 10, color: C.textMuted }}>
                                {s.messageCount || 1} Nachr. ·{" "}
                                {new Date(s.lastMessageAt).toLocaleDateString("de-CH")}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSession(a.id, s.sessionId);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                color: C.textMuted,
                                cursor: "pointer",
                                fontSize: 14,
                                padding: 2,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSelectedSessions((p) => ({ ...p, [a.id]: null }));
                        setShowMemory(null);
                      }}
                      style={{ ...btn(), marginTop: 8, fontSize: 11, padding: "5px 10px" }}
                    >
                      + Neue Session starten
                    </button>
                  </div>
                )}
                {runResult?.id === a.id && (
                  <div
                    style={{
                      background: C.bg,
                      border: `1px solid ${runResult.ok ? C.border : C.red}55`,
                      borderRadius: 8,
                      padding: 10,
                      fontSize: 12,
                      color: C.text,
                      whiteSpace: "pre-wrap",
                      maxHeight: 320,
                      overflow: "auto",
                    }}
                  >
                    {runResult.text}
                    {isOwner && runResult.ok && runResult.cost != null && (
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>
                        Kosten: ${Number(runResult.cost).toFixed(3)}
                      </div>
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

// Agent-Läufe: deterministischer Lauf-Nachweis pro Kunde (Quelle: agent_runs,
// befüllt vom agent-service nach JEDEM Lauf — auch an Tagen ohne Änderung).
function AgentRunsPanel({ selectedClient }) {
  const { runs, loading, refresh } = useEzyAgentRuns(selectedClient?.id, 50);
  const stCo = { ok: C.green, fehler: C.red, partial: C.orange };
  const stIc = { ok: CheckCircle, fehler: AlertCircle, partial: Clock };
  const stLbl = { ok: "OK", fehler: "Fehler", partial: "Teilweise" };

  useEffect(() => {
    const iv = setInterval(refresh, 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (loading && runs.length === 0)
    return (
      <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>Lade Agent-Läufe …</div>
    );

  if (!runs.length)
    return (
      <LiveEmptyState
        title="Noch keine Agent-Läufe"
        hint="Sobald der Autopilot für diesen Kunden läuft, erscheint hier jeder Lauf — auch an Tagen ohne Änderung."
      />
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text }}>
          Agent-Läufe ({runs.length})
        </h3>
        <Btn size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>
          Aktualisieren
        </Btn>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {runs.map((r, i) => {
          const st = String(r.status || "ok").toLowerCase();
          const SI = stIc[st] || Clock;
          const d = new Date(r.run_at || r.created_at);
          const dur = r.duration_ms ? `${Math.max(1, Math.round(r.duration_ms / 1000))}s` : "—";
          return (
            <div
              key={r.id}
              style={{
                padding: "13px 20px",
                borderBottom: i < runs.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <SI
                size={16}
                color={stCo[st] || C.textMuted}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {r.agent_name || "Agent"}
                  </span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>
                    {d.toLocaleDateString("de-CH")}{" "}
                    {d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} · {dur}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.textMuted,
                    marginTop: 3,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {r.deploy_count > 0
                      ? `${r.deploy_count} Deploy${r.deploy_count === 1 ? "" : "s"}`
                      : "0 Deploys"}
                  </span>
                  {r.health_score != null && <span>Health {r.health_score}/100</span>}
                </div>
                {r.summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: C.textMuted,
                      marginTop: 6,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {r.summary}
                  </div>
                )}
                {r.error_message && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{r.error_message}</div>
                )}
              </div>
              <Badge color={stCo[st] || C.textMuted}>{stLbl[st] || st}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr,
  // EzyRank (und Portal) starten direkt im SEO-Tab.
  { id: "seo", label: "SEO", icon: Globe },
  { id: "blog", label: "Blog", icon: PenTool },
  // Local Grid (2026-08-17): Maps-Heatmap aus dem woechentlichen Geo-Grid-Scan.
  { id: "localgrid", label: "Local Grid", icon: MapPin },
  // aivis: seit Phase 2 eigene EzyAI-App unter /ezyai (Tab entfernt 31.07.)
  { id: "conversions", label: "Conversions", icon: DollarSign },
  { id: "ads", label: "Ads", icon: Megaphone },
  { id: "runs", label: "Agent-Läufe", icon: Clock },
];
// Welcher Dienst muss beim Kunden aktiv sein, damit ein Dashboard-Sub-Tab erscheint.
// null = Kern-Ansicht (immer). Sonst: Tab zeigt sich, wenn MIND. EINER aktiv ist.
const TAB_SERVICE = {
  overview: null,
  seo: null,
  blog: null, // Refresh-Radar: opt-in rein über die Tab-Auswahl je Kunde
  // Local Grid: opt-in über die Tab-Auswahl — nur Kunden mit physischem
  // Standort/GBP (z. B. FiH bewusst nicht).
  localgrid: null,

  conversions: ["ga4"],
  ads: ["google-ads"],
  runs: null, // Lauf-Nachweis: immer sichtbar
};
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "copilot", label: "EzyPilot", icon: Sparkles },
  { id: "tasks", label: "Projekt", icon: ListChecks },
  { id: "tools", label: "AI Tools", icon: Zap },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "content", label: "Content", icon: FileText },
  { id: "reports", label: "Reports", icon: TrendingUp },
  { id: "clients", label: "Kunden", icon: Users },
  { id: "team", label: "Team", icon: Users }, // nur owner/admin (RBAC 2026-07-15)
  { id: "matrix", label: "Zugriffs-Matrix", icon: Key }, // nur owner/admin (Admin-Umbau 06.08.)
  { id: "settings", label: "Einstellungen", icon: Settings },
];

const UI_LS = "ezyUi.v1";
function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_LS);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") return p;
    }
  } catch {}
  return {};
}
function App({ appScope = null }) {
  // Phase 3 (31.07.): appScope macht den Monolithen zur Engine — die Routen
  // /ezyrank /ezyperformance /reakt /admin mounten dieselbe App mit gefilterter
  // Navigation + Tabs (APP_SCOPES). Ohne Scope: Legacy-Vollansicht (nur Viewer).
  const scope = appScope ? APP_SCOPES[appScope] : null;
  const isMobile = useMediaQuery("(max-width: 760px)");
  const { role, isOrgAdmin } = useAuth();
  // viewer = read-only customer report: dashboards only, no tools/clients/settings.
  const isViewer = role === "viewer";
  // Team + Einstellungen nur fuer SuperAdmin(owner)/admin (RBAC 2026-07-15).
  // Mitarbeiter (member/viewer) duerfen keine Kunden-Einstellungen sehen/aendern.
  const navBase = useMemo(
    () =>
      isViewer
        ? NAV.filter((n) => n.id === "dashboard" || n.id === "reports")
        : NAV.filter(
            (n) =>
              n.id !== "reports" &&
              ((n.id !== "team" && n.id !== "settings" && n.id !== "matrix") || isOrgAdmin) &&
              (!scope || scope.pages.includes(n.id)) && // Phase 3: App-Scope
              // Admin-Umbau 06.08.: Agenten-Verwaltung liegt im Admin unter
              // Einstellungen → Agenten & Automatisierung (Seite bleibt im Scope).
              !(appScope === "admin" && n.id === "agents") &&
              // copilot kommt über den Dashboard/Agent-Switcher (nicht doppelt in der Nav)
              !(scope?.pages?.includes("copilot") && n.id === "copilot"),
          ),
    [isViewer, isOrgAdmin, scope, appScope],
  );
  const ezy = useEzyClients();
  // Service-Filter je App (01.08.): EzyPerformance zeigt nur Kunden mit
  // aktiviertem google-ads-Service (scope.services); ohne Filter alle Kunden.
  const svcMatrix = useEzyServiceMatrix();
  // Admin-Umbau 06.08.: Kunde↔App-Freischaltung (client_app_access). Keine
  // Zeile = App aktiv (Legacy). Admin-App zeigt immer alle Kunden.
  const caa = useClientAppAccess();
  const clients = useMemo(() => {
    const all = ezy.clients.map((c) => normalizeClientShape(c));
    const svc = scope?.services
      ? all.filter((c) => svcMatrix.hasService(c.id, scope.services))
      : all;
    if (!appScope || appScope === "admin") return svc;
    return svc.filter((c) => appEnabledFor(caa.map, c.id, appScope));
  }, [ezy.clients, scope, svcMatrix.hasService, appScope, caa.map]);
  const ui0 = useMemo(() => loadUiState(), []); // letzter UI-Stand aus localStorage
  const [clientId, setClientId] = useState(ui0.clientId || "");
  // App-Einstieg (Volkan 11.08., präzisiert): "Alle Kunden" nur beim FRISCHEN
  // Einstieg (Login, App-Wechsel per Link). Ein Reload/Zurück stellt die
  // letzte Auswahl wieder her — mitten in der Kunden-Arbeit bleibt man drin.
  // Admin startet in der Verwaltung; Viewer haben keine Alle-Kunden-Sicht.
  const [showAll, setShowAll] = useState(() => {
    if (appScope === "admin") return false;
    if (isReloadNavigation() && ui0.showAll === false && ui0.clientId) return false;
    return true;
  });
  useEffect(() => {
    if (isViewer) setShowAll(false);
  }, [isViewer]);
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
  // Portal-Gating (06.08.): Kunden-Logins (viewer) sehen "Reports" nur, wenn
  // die Funktion für ihren Kunden freigeschaltet ist (client_app_access).
  const nav = useMemo(
    () =>
      isViewer && client?.id
        ? navBase.filter(
            (n) => n.id !== "reports" || featureEnabledFor(caa.map, client.id, "seo", "reports"),
          )
        : navBase,
    [navBase, isViewer, client?.id, caa.map],
  );
  const profileHook = useEzyProfile();
  const defaultsHook = useEzyDefaults(client?.id);
  const contentHook = useEzyContent();
  // Plattform-Umbau Phase 1 (2026-07-31): ?app=<id> vom Launcher übersteuert
  // den letzten UI-Stand und springt in die Start-Ansicht der gewählten App.
  const appParam = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("app");
    } catch {
      return null;
    }
  }, []);
  const appStart = (appParam && APP_START[appParam]) || null;
  // Phase 2: EzyAI lebt unter /ezyai — alte ?app=geo-Links dorthin umleiten.
  useEffect(() => {
    if (appParam === "geo") window.location.replace("/ezyai");
  }, [appParam]);
  const [page, setPage] = useState(appStart?.page || ui0.page || "dashboard");
  // Dashboard/Agent-Switcher (04.08.): "Agent" = copilot-Seite, "Dashboard" =
  // zurück zur zuletzt aktiven Nicht-Agent-Seite (Searchable-Muster).
  const lastDashRef = useRef(page === "copilot" ? "dashboard" : page);
  if (page !== "copilot") lastDashRef.current = page;
  // gemerkte Tabs, die nicht mehr existieren (aivis seit Phase 2, overview seit
  // 10.08.) → SEO, damit der Einstieg direkt im SEO-Tab landet.
  const [tab, setTab] = useState(
    appStart?.tab || (ui0.tab === "aivis" || ui0.tab === "overview" ? "seo" : ui0.tab) || "seo",
  );
  useEffect(() => {
    // Param nach dem Einstieg aus der URL nehmen, damit Reload/Bookmark wieder
    // beim gemerkten UI-Stand landet statt ewig in der Deep-Link-Ansicht.
    if (!appParam) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("app");
      window.history.replaceState({}, "", u.pathname + (u.search || ""));
    } catch {
      /* egal */
    }
  }, [appParam]);
  // Viewers (Kunden) dürfen Dashboard + ihre Reports sehen, sonst nichts.
  useEffect(() => {
    if (isViewer && page !== "dashboard" && page !== "reports") setPage("dashboard");
  }, [isViewer, page]);
  // Mitarbeiter (kein Admin) haben keinen Zugriff auf Einstellungen/Team –
  // auch nicht per direkter URL/localStorage-Wiederherstellung.
  useEffect(() => {
    if (!isOrgAdmin && (page === "settings" || page === "team" || page === "matrix"))
      setPage("dashboard");
  }, [isOrgAdmin, page]);
  // Portal-Gating: Reports-Seite ohne Freischaltung → zurück aufs Dashboard.
  useEffect(() => {
    if (
      isViewer &&
      page === "reports" &&
      client?.id &&
      !featureEnabledFor(caa.map, client.id, "seo", "reports")
    )
      setPage("dashboard");
  }, [isViewer, page, client?.id, caa.map]);
  // Phase 3: der (App-übergreifend gemerkte) UI-Stand darf nicht aus dem Scope
  // der aktuellen App herausführen — sonst zeigt EzyPerformance z. B. "clients".
  useEffect(() => {
    if (scope && !scope.pages.includes(page)) setPage(scope.pages[0]);
  }, [scope, page]);
  useEffect(() => {
    if (scope && page === "dashboard" && !scope.tabs.includes(tab)) setTab(scope.primary);
  }, [scope, page, tab]);
  // „Aktivität" → Agenten-Tab, „Reports" (Team) → Content-Tab integriert.
  // Viewer behalten ihren eigenen Reports-Tab.
  useEffect(() => {
    if (page === "activity") setPage("agents");
    else if (!isViewer && page === "reports") setPage("content");
  }, [page, isViewer]);
  const [cdd, setCdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  // App-Switcher (Plattform-Umbau Phase 1)
  const appAccess = useAppAccess();
  const [swOpen, setSwOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dateRange, setDateRange] = useState(() => {
    // Geteilter Zeitraum über alle Apps (2026-08-10) + Custom-Restore-Fix:
    // eigene Zeiträume kommen mit exakten start/end aus dem Store zurück
    // (vorher wurden nur label+days gespeichert und der Restore verfälschte
    // den Zeitraum auf "letzte N Tage bis heute").
    const shared = loadSharedRange();
    if (shared?.preset === "custom" && shared.start && shared.end) {
      return {
        label: shared.label,
        days: shared.days,
        start: new Date(shared.start),
        end: new Date(shared.end),
        preset: "custom",
      };
    }
    const now = new Date();
    const days = shared?.days || ui0.dateRange?.days || 30;
    const label = shared?.label || ui0.dateRange?.label || "30 Tage";
    const preset = shared?.preset || `${days}d`;
    return {
      label,
      days,
      start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
      end: now,
      preset,
    };
  });
  const [compareMode, setCompareMode] = useState(ui0.compareMode || "none");
  // Enrich the dateRange with a computed comparison period so dashboards can use it.
  const dateRangeWithCompare = useMemo(() => {
    const compare = computeCompareRange(dateRange, compareMode);
    return { ...dateRange, compareMode, compare };
  }, [dateRange, compareMode]);
  // Letzten UI-Stand merken, damit ein Reload genau dort wieder öffnet.
  useEffect(() => {
    try {
      localStorage.setItem(
        UI_LS,
        JSON.stringify({
          page,
          tab,
          clientId,
          showAll, // Reload stellt die Auswahl wieder her (11.08.)
          dateRange: { label: dateRange.label, days: dateRange.days },
          compareMode,
        }),
      );
    } catch {}
  }, [page, tab, clientId, showAll, dateRange.label, dateRange.days, compareMode]);
  // Geteilter Zeitraum (2026-08-10): jede Änderung wandert in den App-übergreifenden
  // Store — EzyAI & Co. lesen denselben Stand. Custom-Zeiträume mit exakten Daten.
  useEffect(() => {
    saveSharedRange({
      label: dateRange.label,
      days: dateRange.days,
      preset: dateRange.preset || `${dateRange.days}d`,
      start:
        dateRange.preset === "custom" && dateRange.start
          ? new Date(dateRange.start).toISOString()
          : undefined,
      end:
        dateRange.preset === "custom" && dateRange.end
          ? new Date(dateRange.end).toISOString()
          : undefined,
    });
  }, [dateRange]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const toast = useToast();
  const sw = isMobile ? 0 : collapsed ? 68 : 240;
  const toolSettings = useEzyToolSettings(client?.id);
  const svc = useEzyServiceSettings(client?.id); // aktive Dienste des Kunden (Tab-Gating)
  // App-Split (06.08., Volkan): jede App zeigt nur ihre Skill-Kategorien —
  // EzyRank ohne geo/Ads, EzyPerformance nur Ads; Admin/Legacy sieht alles.
  const tools = useMemo(() => {
    const all = toolSettings.applyTo(ALL_TOOLS);
    return scope?.skillCats ? all.filter((t) => scope.skillCats.includes(t.category)) : all;
  }, [toolSettings, scope]);
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
        return saved; // Onboarding-Wizard braucht die erzeugte ID (Schritt 3)
      } catch (e) {
        toast?.(e?.message || "Speichern fehlgeschlagen", "error");
        return null;
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
  const saveCustomerDefaults = useCallback(
    async (next) => {
      const saved = await defaultsHook.save(next);
      // Zusaetzlich in den KUNDEN-DATENSATZ schreiben (clients.metadata.defaults) —
      // das ist die geraeteuebergreifend zuverlaessige Quelle, aus der der
      // Tab-Filter primaer liest (fix 2026-07-14). Ohne Toast (stilles Persistieren).
      try {
        if (client?.id && client.id !== emptyClient.id) {
          await ezy.upsert({
            ...client,
            defaults: { ...(client.defaults || {}), ...(saved || next) },
          });
        }
      } catch {
        /* localStorage/customer_defaults haben bereits gespeichert */
      }
      return saved;
    },
    [defaultsHook, ezy, client, emptyClient.id],
  );
  const onSaveContent = useCallback((id, md) => contentHook.updateContent(id, md), [contentHook]);
  // Tool-Ergebnis → Content-Entwurf (EzyRank-Ausbau 2026-08-18): legt eine echte
  // content_items-Zeile an (Status draft) — Weiterbearbeitung im Content-Bereich.
  const onCreateContent = useCallback((input) => contentHook.create(input), [contentHook]);
  // Durchgehender Flow Tool-Ergebnis → Entwurf → Editor (2026-08-18):
  // "Im Editor weiterbearbeiten" springt direkt in den Content-Editor.
  const [contentEditId, setContentEditId] = useState(null);
  const openDraftInEditor = useCallback((id) => {
    setContentEditId(id);
    setPage("content");
  }, []);
  // Globaler „Aktualisieren": remountet den Inhaltsbereich (alle Dashboard-Hooks
  // holen frische Daten) UND lädt die App-Level-Hooks neu. Auf jedem Tab im Header.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshAll = useCallback(() => {
    setRefreshNonce((n) => n + 1);
    ezy.reload?.();
    contentHook.reload?.();
    svc.reload?.();
    defaultsHook.reload?.();
    profileHook.reload?.();
    toolSettings.reload?.();
    toast?.("Daten neu geladen (Datenbankstand)", "success");
  }, [ezy, contentHook, svc, defaultsHook, profileHook, toolSettings, toast]);
  // Tab-Auswahl: der KUNDEN-DATENSATZ (clients.metadata.defaults) ist die
  // maSSgebliche, geraeteuebergreifend zuverlaessige Quelle — er wird bei jedem
  // Laden aus Supabase gelesen. Der localStorage-basierte defaultsHook ist nur
  // Fallback (fix 2026-07-14: Einstellungen wirkten nur auf dem Geraet, auf dem
  // sie gesetzt wurden). "runs" (Agent-Läufe) ist für Admins immer sichtbar,
  // für Mitarbeiter (member/viewer) hingegen ausgeblendet (RBAC 2026-07-15).
  const effectiveVisibleTabs = useMemo(() => {
    const fromClient =
      Array.isArray(client?.defaults?.visibleTabs) && client.defaults.visibleTabs.length
        ? client.defaults.visibleTabs
        : null;
    const base = fromClient || customerDefaults.visibleTabs || ["seo", "aivis", "conversions"];
    const withRuns = base.includes("runs") ? base : [...base, "runs"];
    return isOrgAdmin ? withRuns : withRuns.filter((t) => t !== "runs");
  }, [client?.defaults?.visibleTabs, customerDefaults.visibleTabs, isOrgAdmin]);
  const visibleTabs = useMemo(
    () =>
      TABS.filter((t) => {
        // 0) Phase 3: App-Scope — nur Tabs der jeweiligen App
        if (scope && !scope.tabs.includes(t.id)) return false;
        // runs bleibt RBAC-geschützt (nur owner/admin), auch im Scope-Modus
        if (t.id === "runs" && !isOrgAdmin) return false;
        // Portal-Gating (06.08.): Kunden-Logins (viewer) sehen nur Tabs, deren
        // App+Funktion für den gewählten Kunden freigeschaltet ist.
        if (isViewer && client?.id) {
          const gate = TAB_APP_FEATURE[t.id];
          if (gate && !featureEnabledFor(caa.map, client.id, gate.app, gate.feature)) return false;
        }
        // 1) manuelle Tab-Auswahl (Kunden-Datensatz bevorzugt) — der PRIMÄR-Tab
        //    einer App umgeht sie, sonst wäre z. B. EzyPerformance bei Kunden
        //    ohne "ads" in der Tab-Auswahl komplett leer (Service-Gate reicht).
        const isPrimary = scope && scope.primary === t.id;
        if (!isPrimary && !effectiveVisibleTabs.includes(t.id)) return false;
        // 2) Service-Gate: Tab nur, wenn ein zugehöriger Dienst aktiv ist.
        //    Während Services laden NICHT ausblenden (kein Flackern).
        const req = TAB_SERVICE[t.id];
        if (!req || svc.loading) return true;
        return req.some((k) => svc.enabled?.[k]);
      }),
    [
      effectiveVisibleTabs,
      svc.enabled,
      svc.loading,
      scope,
      isOrgAdmin,
      isViewer,
      client?.id,
      caa.map,
    ],
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
        Lädt Ezy One…
      </div>
    );

  return (
    <EzyPilotProvider selectedClient={client} clients={clients} tools={tools}>
      <div
        className="app-shell"
        style={{
          // CD: Aceh Soft (Fließtext) — Nunito Sans als freier Ersatzschnitt.
          fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',sans-serif",
          position: "relative", // Bezug für Grund-/Glow-Unterlage (beide zIndex -1)
          // isolation: eigener Stacking-Kontext — die -1-Ebenen liegen dadurch
          // HINTER dem Shell-Inhalt, aber VOR dem (deckenden) body-Hintergrund.
          // Ohne das landen sie im Root-Kontext unter dem body-Grund = unsichtbar.
          isolation: "isolate",
          color: C.text,
          minHeight: "100vh",
          display: "flex",
          fontSize: 14,
          lineHeight: 1.5,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Nunito+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400&display=swap"
          rel="stylesheet"
        />
        <style>{CSS}</style>
        {/* Grundfarbe + Waben-Pattern als -1-Unterlage; Glow ebenfalls -1 (danach
          im DOM = darüber). Inhalt bleibt unangehoben — Dropdowns/Sidebar-Stacking
          wie vor dem Pattern-Umbau (Fix 10.08. abends). */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: -1,
            backgroundColor: C.bg,
            backgroundImage: HEX_BG,
            pointerEvents: "none",
          }}
        />
        <HexGlowLayer />
        {/* Versionsnummer unten rechts (Volkan 13.08.) — je App eigene Nummer +
          Änderungshistorie beim Hover. */}
        <AppVersionBadge
          appId={appScope}
          palette={{
            accent: C.accent,
            text: C.text,
            muted: C.textMuted,
            border: C.border,
            card: C.card,
          }}
        />

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
            {/* CD-Symbol: neues Marken-Icon (E + Power-O im Hexagon). */}
            <EzyOneMark width={34} />
            {!collapsed && (
              <div>
                {/* CD: Wortmarke "Ezy One" — Sentence case, nie ALL CAPS. */}
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    letterSpacing: "-.2px",
                    fontFamily: "'Kamerik 105',Poppins,sans-serif",
                  }}
                >
                  Ezy One
                </div>
                <div style={{ fontSize: 10, color: C.textMuted }}>SEO & GEO Platform</div>
              </div>
            )}
          </div>
          {/* App-Switcher (Plattform-Umbau Phase 1, 2026-07-31): Atlassian-Muster —
            Raster-Button unter dem Logo, Dropdown mit erlaubten Apps + Launcher. */}
          {!isViewer && (
            <div
              style={{
                position: "relative",
                borderBottom: `1px solid ${C.border}`,
                padding: "8px 10px",
              }}
            >
              <button
                onClick={() => setSwOpen((v) => !v)}
                title="App wechseln"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  background: swOpen ? "rgba(0,0,0,.05)" : "none",
                  border: "none",
                  borderRadius: 8,
                  padding: collapsed ? "8px 6px" : "8px 10px",
                  color: C.text,
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: 600,
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1, letterSpacing: 1 }}>⣿</span>
                {!collapsed &&
                  (() => {
                    const cur = EZY_APPS.find(
                      (a) => a.id === (appScope || currentAppOf(page, tab)),
                    );
                    return (
                      <span style={{ color: cur?.color || C.text }}>{cur?.name || "Apps"}</span>
                    );
                  })()}
              </button>
              {swOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 10,
                    zIndex: 200,
                    width: 236,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 8,
                    boxShadow: "0 14px 44px rgba(0,0,0,.55)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      color: C.textMuted,
                      padding: "4px 10px 8px",
                      fontWeight: 700,
                    }}
                  >
                    Apps wechseln
                  </div>
                  {EZY_APPS.filter((a) => appAccess.canOpen(a.id)).map((a) => {
                    const active = (appScope || currentAppOf(page, tab)) === a.id;
                    return (
                      <a
                        key={a.id}
                        href={a.href}
                        onClick={(e) => {
                          if (active) {
                            e.preventDefault();
                            setSwOpen(false);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 8,
                          fontSize: 13,
                          textDecoration: "none",
                          color: active ? a.color : C.text,
                          background: active ? a.tint : "none",
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: a.tint,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            flexShrink: 0,
                          }}
                        >
                          {a.icon}
                        </span>
                        {a.name}
                      </a>
                    );
                  })}
                  <div style={{ borderTop: `1px solid ${C.border}`, margin: "8px 4px" }} />
                  <a
                    href="/apps"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: 12.5,
                      textDecoration: "none",
                      color: C.textMuted,
                    }}
                  >
                    ✦ Zum Launcher
                  </a>
                </div>
              )}
            </div>
          )}
          {/* Kunden-Auswahl in der Sidebar (Position wie EzyAI; Desktop).
            Admin-Umbau Teil 2 (06.08.): im Admin überflüssig — alle kunden-
            bezogenen Einstellungen leben im Kunden-Detail; nur die Agenten-
            Seite (unter Einstellungen) braucht die Auswahl noch. */}
          {!collapsed && hasClients && (appScope !== "admin" || page === "agents") && (
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              <select
                aria-label="Kunde"
                value={showAll ? "__all" : client?.id || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__all") {
                    setShowAll(true);
                  } else {
                    setClientId(v);
                    setShowAll(false);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: C.bg,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              >
                {!isViewer && <option value="__all">Alle Kunden</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Dashboard / Agent — Switcher (nur Apps mit EzyPilot: seo/ads). */}
          {!isViewer && !collapsed && scope?.pages?.includes("copilot") && (
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 3,
                }}
              >
                {[
                  ["dashboard", "Dashboard", LayoutDashboard],
                  ["agent", "Agent", Bot],
                ].map(([v, label, Icon]) => {
                  const on = v === "agent" ? page === "copilot" : page !== "copilot";
                  return (
                    <button
                      key={v}
                      onClick={() =>
                        setPage(v === "agent" ? "copilot" : lastDashRef.current || "dashboard")
                      }
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "7px 10px",
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer",
                        background: on ? C.surface : "transparent",
                        color: on ? C.text : C.textMuted,
                        fontSize: 12.5,
                        fontWeight: on ? 700 : 500,
                        boxShadow: on ? "0 1px 2px rgba(0,0,0,.06)" : "none",
                        fontFamily: "inherit",
                      }}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <nav style={{ flex: 1, padding: "12px 8px" }}>
            {/* "Alle Kunden" (Volkan 10.08.): in EzyRank/EzyPerformance bleibt die
              linke Navigation leer — alle Punkte sind kundenspezifisch. Admin
              behält seine (Verwaltungs-)Navigation. */}
            {!(showAll && (appScope === "seo" || appScope === "ads")) &&
              nav.map((n) => {
                // EzyRank (Volkan 06.08.): die Dashboard-Sub-Tabs (Übersicht/SEO/
                // Blog/Conversions) wandern aus der oberen Tab-Leiste in die linke
                // Navigation — der "Dashboard"-Punkt wird durch die Tabs ersetzt.
                // visibleTabs respektiert bereits Scope, Tab-Auswahl und Service-Gates.
                if (appScope === "seo" && n.id === "dashboard") {
                  return visibleTabs.map((t) => {
                    const T = t.icon;
                    const on = page === "dashboard" && tab === t.id;
                    return (
                      <button
                        key={`tab-${t.id}`}
                        onClick={() => {
                          setPage("dashboard");
                          setTab(t.id);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          cursor: "pointer",
                          background: on ? C.accentDim : "transparent",
                          color: on ? C.accentLight : C.textMuted,
                          fontSize: 13,
                          fontWeight: on ? 600 : 400,
                          marginBottom: 2,
                          transition: "all .15s",
                          justifyContent: collapsed ? "center" : "flex-start",
                          fontFamily: "inherit",
                        }}
                      >
                        <T size={18} />
                        {!collapsed && t.label}
                      </button>
                    );
                  });
                }
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
              // z60 > Sidebar (z50), Fix 11.08.: der Header ist ein Stacking-
              // Kontext — seine Dropdowns (Datum/Vergleich, z60 intern) waren
              // sonst auf Header-Niveau gedeckelt und wurden von der Sidebar
              // abgeschnitten, sobald das Popup über deren Kante ragte.
              // Header und Sidebar überlappen sich räumlich nie (marginLeft).
              zIndex: 60,
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
              {/* Mobile-App-Wechsler (01.08.): die Sidebar (inkl. ⣿-Switcher) ist
                unter 760px ausgeblendet — ohne dieses Select wären die Apps auf
                dem Handy unerreichbar. */}
              {isMobile && !isViewer && (
                <select
                  aria-label="App wechseln"
                  value={appScope || currentAppOf(page, tab)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__launcher") {
                      window.location.href = "/apps";
                      return;
                    }
                    const a = EZY_APPS.find((x) => x.id === v);
                    if (a) window.location.href = a.href;
                  }}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "8px 8px",
                    color: C.text,
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    outline: "none",
                    maxWidth: 130,
                  }}
                >
                  {EZY_APPS.filter((a) => appAccess.canOpen(a.id)).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon} {a.name}
                    </option>
                  ))}
                  <option value="__launcher">✦ Launcher</option>
                </select>
              )}
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
                  {nav.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              )}
              {/* Kunden-Switcher: auf Desktop in der Sidebar (wie EzyAI), im Header nur mobil.
                Im Admin ausgeblendet (außer Agenten-Seite) — siehe Sidebar-Kommentar. */}
              <div
                style={{
                  position: "relative",
                  display:
                    isMobile && (appScope !== "admin" || page === "agents") ? "block" : "none",
                }}
              >
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
                  {showAll ? (
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
                      ✦
                    </div>
                  ) : (
                    <ClientAvatar
                      name={client.name}
                      domain={client.domain}
                      size={24}
                      radius={6}
                      bg={C.accentDim}
                      fg={C.accentLight}
                      fontSize={10}
                    />
                  )}
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
                    {!isViewer && (
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
                    )}
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
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "8px 14px",
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
                        <ClientAvatar
                          name={entry.name}
                          domain={entry.domain}
                          size={26}
                          radius={7}
                          bg={C.accentDim}
                          fg={C.accentLight}
                          fontSize={10}
                        />
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 13,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {entry.name}
                          </span>
                          <span
                            style={{
                              color: C.textMuted,
                              fontSize: 11,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {entry.domain}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Tab-Leiste erst ab 2 Ansichten (01.08.): Ein-Tab-Apps wie
                EzyPerformance/Reaktivierung zeigen den Inhalt direkt. */}
              {/* EzyRank: Tabs leben in der linken Nav (06.08.) — Leiste bleibt in
                anderen Scopes/Legacy UND mobil (dort gibt es keine Sidebar). */}
              {page === "dashboard" &&
                visibleTabs.length > 1 &&
                (appScope !== "seo" || isMobile) && (
                  <TabBar tabs={visibleTabs} active={tab} onChange={setTab} />
                )}
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
              {/* Filter/Aktionen links neben dem Titel (Volkan 10.08.): Zeitraum,
                Vergleich, Export, Aktualisieren aus dem rechten Cluster nach links
                verschoben — EzyPilot/Audit/Glocke bleiben rechts. */}
              <div
                className="header-filters"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                {page !== "tasks" && <DateRangePicker value={dateRange} onChange={setDateRange} />}
                {page === "dashboard" && (
                  <ComparePicker value={compareMode} onChange={setCompareMode} />
                )}
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
                <Btn
                  variant="secondary"
                  size="md"
                  icon={RefreshCw}
                  onClick={refreshAll}
                  title="Liest nur den gespeicherten Datenbankstand neu — startet KEINE Messung"
                >
                  {isMobile ? null : "Daten neu laden"}
                </Btn>
              </div>
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
              {!isViewer && <EzyPilotButton />}
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
          <div
            key={refreshNonce}
            className="app-content"
            style={{ padding: isMobile ? "16px 12px" : "24px 28px" }}
          >
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
                {/* "Alle Kunden": gleicher zentrierter 1180px-Rahmen wie in EzyAI
                  (Volkan 11.08.) — Titel und Kacheln bündig, ein Layout überall. */}
                <div
                  style={showAll ? { maxWidth: 1180, margin: "0 auto 20px" } : { marginBottom: 20 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                      {showAll
                        ? "Agentur-Übersicht"
                        : tab === "overview"
                          ? "Übersicht"
                          : tab === "seo"
                            ? "SEO Dashboard"
                            : tab === "localgrid"
                              ? "Local Grid"
                              : tab === "blog"
                                ? "Blog"
                                : tab === "aivis"
                                  ? "KI-Sichtbarkeit"
                                  : tab === "ads"
                                    ? "Ads Dashboard"
                                    : "Conversions"}
                    </h1>
                    {isViewer && <Badge color={C.blue}>Nur-Lese-Ansicht</Badge>}
                  </div>
                  <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
                    {showAll ? "Alle Kunden" : `${client.name} — ${client.domain}`}
                    {dateRange.label ? ` • ${dateRange.label}` : ""}
                    {dateRangeWithCompare.compare && (
                      <span style={{ color: C.accentLight }}>
                        {" "}
                        vs. {dateRangeWithCompare.compare.label}
                      </span>
                    )}
                  </p>
                </div>
                {showAll && (
                  <div style={{ maxWidth: 1180, margin: "0 auto" }}>
                    <AgencyOverview
                      clients={clients}
                      appScope={appScope}
                      onSelect={(id) => {
                        setClientId(id);
                        setShowAll(false);
                      }}
                    />
                  </div>
                )}
                {!showAll && (
                  <>
                    {tab === "overview" && (
                      <OverviewDashboard selectedClient={client} dateRange={dateRangeWithCompare} />
                    )}
                    {tab === "seo" && (
                      <SeoDashboard selectedClient={client} dateRange={dateRangeWithCompare} />
                    )}
                    {tab === "localgrid" && <LocalGridDashboard selectedClient={client} />}
                    {tab === "blog" && <RefreshRadar selectedClient={client} />}
                    {/* aivis: seit Phase 2 in der EzyAI-App (/ezyai) */}
                    {tab === "conversions" && (
                      <ConvDashboard selectedClient={client} dateRange={dateRangeWithCompare} />
                    )}
                    {tab === "ads" && (
                      <>
                        <AdsDashboard selectedClient={client} dateRange={dateRangeWithCompare} />
                        <AdsAutopilotPanel selectedClient={client} />
                      </>
                    )}
                    {tab === "runs" && <AgentRunsPanel selectedClient={client} />}
                  </>
                )}
              </>
            )}
            {hasClients && page === "tasks" && <TasksDashboard selectedClient={client} />}
            {!isViewer && hasClients && page === "tools" && (
              <ToolsPage
                selectedClient={client}
                tools={tools}
                onSaveDraft={onCreateContent}
                onOpenDraft={openDraftInEditor}
              />
            )}
            {!isViewer && hasClients && page === "content" && (
              <ContentPage
                clients={clients}
                items={contentHook.items}
                onSaveContent={onSaveContent}
                selectedClient={client}
                openEditId={contentEditId}
                onOpenEditConsumed={() => setContentEditId(null)}
              />
            )}
            {hasClients && page === "reports" && (
              <ReportsPage items={contentHook.items} selectedClient={client} />
            )}
            {!isViewer && page === "clients" && (
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
            {isOrgAdmin && page === "team" && <TeamPage clients={clients} />}
            {isOrgAdmin && page === "matrix" && <MatrixPage clients={clients} />}
            {isOrgAdmin && page === "settings" && (
              <SettingsPage
                tools={tools}
                onToggleTool={toggleTool}
                selectedClient={client}
                profile={profile}
                onSaveProfile={saveProfile}
                customerDefaults={customerDefaults}
                onSaveDefaults={saveCustomerDefaults}
                onClientUpdated={ezy.reload}
                onOpenAgents={appScope === "admin" ? () => setPage("agents") : null}
              />
            )}
            {!isViewer && page === "agents" && (
              <>
                <AgentsPage selectedClient={client} />
                <div style={{ marginTop: 28, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
                  <ActivityPage selectedClient={client} clients={clients} />
                </div>
              </>
            )}
            {!isViewer &&
              page === "copilot" &&
              // RBAC 2026-07-20: der volle EzyPilot-Agent (Bash/WP-Publish/Vault)
              // ist owner/admin vorbehalten; Mitarbeiter bekommen den werkzeug-
              // losen, kunden-scoped Frage-&-Notiz-Piloten unter /pilot.
              (isOrgAdmin ? (
                <EzyPilotPage selectedClient={client} />
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                  <div style={{ fontSize: 18, color: C.text, marginBottom: 8 }}>
                    EzyPilot für Mitarbeitende
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    Dein EzyPilot beantwortet Fragen zu deinen Kunden und nimmt Notizen ins
                    Firmen-Gedächtnis auf.
                  </div>
                  <a
                    href="/pilot"
                    style={{
                      display: "inline-block",
                      background: C.accent,
                      color: "#fff",
                      padding: "10px 22px",
                      borderRadius: 8,
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    EzyPilot öffnen
                  </a>
                </div>
              ))}
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
        <EzyPilotPopup />
      </div>
    </EzyPilotProvider>
  );
}

const W = ({ appScope = null }) => (
  <ToastProvider>
    <App appScope={appScope} />
  </ToastProvider>
);
export default W;

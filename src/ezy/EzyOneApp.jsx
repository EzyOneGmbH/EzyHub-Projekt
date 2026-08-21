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
  DEFAULT_PROFILE,
  computeCompareRange,
  downloadFile,
  normalizeClientShape,
  useMediaQuery,
} from "./ui-kit";
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
// Modularisierung 21.08.2026: Bereichs-Module (reines Verschieben).
import { AgentRunsPanel, ClientsPage, MatrixPage } from "./AdminClients";
import { SettingsPage } from "./AdminSettings";
import { AdsDashboard } from "./AdsDashboardModule";
import { ContentPage, RefreshRadar, ReportsPage } from "./ContentModule";
import { AgencyOverview, ConvDashboard, OverviewDashboard, SeoDashboard } from "./RankDashboards";
import {
  CalendarMonth,
  ComparePicker,
  DateRangePicker,
  LiveEmptyState,
  MONTHS,
  Skeleton,
  TabBar,
  initialsFromName,
} from "./ui-kit";

const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2377008C' fill-opacity='0.04' fill-rule='evenodd'/%3E%3C/svg%3E")`;

const CSS = `html,body,#root{min-height:100%;margin:0;overflow-x:hidden}*{box-sizing:border-box}@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes slideUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeScale{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}::selection{background:rgba(119,0,140,.18);color:#161217}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}@media(max-width:760px){.app-sidebar{display:none!important}.app-main{margin-left:0!important;min-width:0!important;width:100%!important}.app-header{align-items:flex-start!important;gap:10px!important}.header-left,.header-actions{width:100%;flex-wrap:wrap}.app-content{padding:16px 12px!important}.settings-shell{flex-direction:column!important;gap:16px!important}.settings-nav{width:100%!important;display:flex!important;overflow-x:auto;padding-bottom:4px}.settings-nav button{width:auto!important;white-space:nowrap;flex-shrink:0}.settings-panel{max-width:none!important}.client-toolbar{flex-direction:column!important;align-items:stretch!important}.client-toolbar>div{width:100%!important}.client-grid{grid-template-columns:minmax(0,1fr)!important}.ezy-form-grid{grid-template-columns:1fr!important}.kpi-grid{grid-template-columns:1fr!important}.kpi-grid>div{grid-column:auto!important}.client-drawer,.quick-audit-panel{width:100vw!important;max-width:100vw!important}.quick-audit-panel{padding:18px 14px!important}.cmd-palette{width:min(calc(100vw - 24px),520px)!important}.mobile-wrap{flex-wrap:wrap!important}.dash-kpis{grid-template-columns:1fr 1fr!important}.split-pane{grid-template-columns:1fr!important}.tabbar{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;max-width:100%}.tabbar::-webkit-scrollbar{display:none}.tabbar button{flex-shrink:0;white-space:nowrap}.tools-shell{flex-direction:column!important;gap:12px!important}.tools-cats{display:flex!important;flex-direction:row!important;width:100%!important;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-bottom:6px;scrollbar-width:none}.tools-cats::-webkit-scrollbar{display:none}.tools-cats>div:first-child{display:none}.tools-cats button{width:auto!important;flex-shrink:0;white-space:nowrap;margin-bottom:0!important}.google-props-grid{grid-template-columns:1fr!important}.ads-hero-head{flex-wrap:nowrap!important;align-items:flex-start!important}.ads-hero-head>button{flex:none!important}.ads-flow{display:grid!important;grid-template-columns:1fr 1fr!important;gap:14px 16px!important;align-items:start!important}.ads-arrow{display:none!important}.ads-roas{order:-1!important;grid-column:1/-1!important;flex-direction:row!important;align-items:baseline!important;justify-content:flex-start!important;gap:9px!important;padding:0!important}.ads-roas>div:last-child{margin-top:0!important}.ads-stat-right{text-align:left!important}.ads-flow .ads-val{font-size:24px!important}.app-content [style*="minmax(200px"],.app-content [style*="minmax(220px"],.app-content [style*="minmax(240px"]{grid-template-columns:1fr 1fr!important;gap:10px!important}.app-content [style*="minmax(320px"]{grid-template-columns:1fr!important}}@media(max-width:480px){.app-header{padding:8px 10px!important}.app-content{padding:12px 10px!important}.app-content [style*="minmax(200px"],.app-content [style*="minmax(220px"],.app-content [style*="minmax(240px"]{grid-template-columns:1fr!important}}
.ezy-md{font-size:13.5px;line-height:1.65;color:${C.text};overflow-wrap:break-word}.ezy-md h1{font-size:19px;margin:18px 0 8px;color:${C.text}}.ezy-md h2{font-size:16px;margin:16px 0 6px;color:${C.text}}.ezy-md h3{font-size:14px;margin:14px 0 4px;color:${C.text}}.ezy-md p{margin:7px 0}.ezy-md ul,.ezy-md ol{margin:7px 0;padding-left:22px}.ezy-md li{margin:3px 0}.ezy-md code{background:${C.bg};border:1px solid ${C.border};border-radius:4px;padding:1px 5px;font-size:12px}.ezy-md a{color:${C.accent}}.ezy-md h1:first-child,.ezy-md h2:first-child,.ezy-md h3:first-child{margin-top:0}`;

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

// Map provider/audit_type -> Tool-Label-Fallback (statisch, 21.08. aus der
// Komponente gehoben — stabil fuer useMemo-Abhaengigkeiten).
const AUDIT_TYPE_TO_TOOL_ID = {
  ahrefs: "full-seo-audit",
  geo: "geo-aeo-audit",
  geo_overview: "canonry",
  seo: "open-seo-audit",
};

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
  const history = useMemo(
    () =>
      runs.map((r) => {
        const created = r.finished_at || r.started_at || r.created_at;
        const d = new Date(created);
        const inputToolId =
          (r.input && r.input.toolId) || AUDIT_TYPE_TO_TOOL_ID[r.audit_type] || r.audit_type;
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
  }, [ezy.clients, scope, svcMatrix, appScope, caa.map]);
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

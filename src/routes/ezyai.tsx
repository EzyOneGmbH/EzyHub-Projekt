import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppRail, SegmentedTabs } from "@/ezy/shell";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { useClientAppAccess, appEnabledFor } from "@/ezy/data/useClientAppAccess";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { useEzyServiceMatrix } from "@/ezy/data/useEzyServiceMatrix";
// Bundle-Split 18.08.: Direktimporte aus den extrahierten Modulen — /ezyai
// laedt den 1.2-MB-Monolith-Chunk (EzyOneApp) nicht mehr.
import { AiVisibilityTab } from "@/ezy/AiVisibilityTab";
import {
  ToastProvider,
  EzyPilotProvider,
  EzyPilotButton,
  EzyPilotFab,
  EzyPilotPopup,
} from "@/ezy/shared-ui";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import { EzyOneMark } from "@/components/ezy-one-mark";
import {
  loadSharedRange,
  saveSharedRange,
  cacheGet,
  cachePut,
  RANGE_TTL_MS,
  isReloadNavigation,
  resolveRange,
  previousPeriod,
  isoDay,
  type ResolvedRange,
  type SharedRange,
} from "@/ezy/data/rangeStore";
import {
  oppFingerprint,
  oppFingerprintLegacy,
  gapKey,
  isResurfaceDue,
  OPP_STATUS,
  type OppStatus,
} from "@/ezy/data/aiOpportunities";
import { HexGlowLayer } from "@/ezy/HexGlow";
import { AppVersionBadge } from "@/ezy/AppVersionBadge";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import {
  LogOut,
  LineChart,
  Zap,
  Activity,
  MessageSquare,
  FileText,
  Lightbulb,
  Globe,
  AlertTriangle,
  LayoutDashboard,
  Bot,
  Sparkles,
  Bell,
  LayoutGrid,
  Home,
} from "lucide-react";

// Initialen aus einem Namen (Shell-Profilblock, wie in der EzyRank-Shell).
function initials(name: string) {
  return (
    String(name || "?")
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// Mobile (08.08.): SVG-Charts in echter Containerbreite zeichnen — feste
// viewBox-Breiten (1000px) schrumpften Achsen-Labels auf Smartphones auf ~3px.
// Misst den Wrapper per Callback-Ref; unter `min` px scrollt der Chart
// horizontal (Wrapper braucht overflowX:auto), wie bei den Tabellen.
function useChartWidth(
  fallback: number,
  min: number,
): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const W = w > 40 ? Math.max(Math.round(w), min) : fallback;
  return [attach, W];
}

// App-Navigation der Sidebar (Searchable-Struktur). Alle Bereiche sind echt —
// keine "bald"-Platzhalter (18.08.): "Your Prompts" ist die frühere Kurations-
// Schublade als regulärer Bereich; "Prompt Research" bleibt ausgeblendet, bis
// es funktional angebunden ist.
type NavItem = { id: string; label: string; icon: any; badge?: number };
const APP_NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Analytics",
    items: [
      { id: "aeo-insights", label: "Insights", icon: LineChart },
      { id: "llm-analytics", label: "LLM Analytics", icon: Zap },
      { id: "traffic", label: "Traffic", icon: Activity },
    ],
  },
  { group: "Prompts", items: [{ id: "your-prompts", label: "Your Prompts", icon: MessageSquare }] },
  {
    group: "Actions",
    items: [
      // Content-Briefs (13.08., Content-Loop): aus Chancen erzeugte Briefs.
      { id: "content", label: "Content", icon: FileText },
      // Chancen (11.08., Searchable "Opportunities"): konsolidierte Queue über
      // alle Signalquellen — Site-Health-Issues, Prompt-Chancen, Prüf-Aufgaben.
      { id: "opportunities", label: "Chancen", icon: Lightbulb },
    ],
  },
  {
    group: "On Page",
    items: [
      { id: "site-health", label: "Site Health", icon: Globe },
      { id: "issues", label: "Issues", icon: AlertTriangle },
    ],
  },
];
// Ads-Modus (ChatGPT Ads, 26.08.2026): eigene Bereichs-Nav — der Organic/Ads-
// Schalter in der AppRail (unter der Trennlinie) wechselt zwischen den Welten.
const ADS_NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "ChatGPT Ads",
    items: [
      { id: "ads-overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "ads-conversions", label: "Conversions", icon: Activity },
      { id: "ads-events", label: "Event-Log", icon: FileText },
    ],
  },
];
const NAV_LABEL: Record<string, string> = Object.fromEntries(
  [...APP_NAV, ...ADS_NAV].flatMap((g) => g.items.map((i) => [i.id, i.label])),
);
// Ads-Panel lazy (Bundle-Split-Muster wie die Bereichs-Module).
const EzyAiAdsPanel = lazy(() => import("@/ezy/EzyAiAdsPanel"));

/** Organic/Ads-Schalter (Segmented, Hi-Fi) — sitzt in der AppRail unter der
 *  Trennlinie, damit die Apps-Zone abgegrenzt bleibt (Volkan 26.08.). */
function OrganicAdsSwitch({
  adsMode,
  onChange,
  compact = false,
}: {
  adsMode: boolean;
  onChange: (ads: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Organic oder Ads"
      style={{
        display: "flex",
        background: "rgba(43,0,51,.05)",
        border: `1px solid ${S.line}`,
        borderRadius: 10,
        padding: 3,
        margin: compact ? 0 : "0 4px 6px",
        flexShrink: 0,
      }}
    >
      {(
        [
          [false, "Organic"],
          [true, "Ads"],
        ] as Array<[boolean, string]>
      ).map(([ads, label]) => {
        const aktiv = adsMode === ads;
        return (
          <button
            key={label}
            role="tab"
            aria-selected={aktiv}
            onClick={() => onChange(ads)}
            style={{
              flex: 1,
              padding: compact ? "5px 12px" : "6px 8px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11.5,
              fontWeight: aktiv ? 700 : 600,
              background: aktiv ? "#fff" : "transparent",
              color: aktiv ? S.app : S.mut,
              boxShadow: aktiv ? "0 1px 3px rgba(43,0,51,.10)" : "none",
              transition: "background .15s",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Redesign 1b (2h): "Heute" — nativer Handy-Einstieg für EzyAI. Begrüssung +
// aktiver Kunde + Schnellzugriff in die Bereiche. Keine erfundenen Zahlen.
function EzyaiHeuteHome({
  client,
  showAll,
  profileName,
  onSection,
}: {
  client: any;
  showAll: boolean;
  profileName: string;
  onSection: (id: string) => void;
}) {
  const now = new Date();
  const h = now.getHours();
  const gruss = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  const datum = now.toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const vorname =
    String(profileName || "")
      .trim()
      .split(/\s+/)[0] || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1
          style={{
            fontFamily: "'Kamerik 105',Poppins,sans-serif",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-.02em",
            margin: 0,
            color: S.txt,
          }}
        >
          Heute
        </h1>
        <div style={{ fontSize: 13, color: S.mut, marginTop: 2, textTransform: "capitalize" }}>
          {datum}
        </div>
      </div>
      <div
        style={{
          background: "linear-gradient(135deg,#71008B,#B9009C)",
          borderRadius: 20,
          padding: "20px 22px",
          color: "#fff",
          boxShadow: "0 14px 30px -16px rgba(119,0,140,.55)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            opacity: 0.85,
            textTransform: "uppercase",
            letterSpacing: ".06em",
            marginBottom: 8,
          }}
        >
          KI-Sichtbarkeit
        </div>
        <div
          style={{
            fontFamily: "'Kamerik 105',Poppins,sans-serif",
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.3,
          }}
        >
          {gruss}
          {vorname ? `, ${vorname}` : ""}
        </div>
        {!showAll && client && (
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            {client.name}
            {client.domain ? ` · ${client.domain}` : ""}
          </div>
        )}
        <button
          onClick={() => onSection("aeo-insights")}
          style={{
            marginTop: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255,255,255,.18)",
            border: "none",
            color: "#fff",
            borderRadius: 99,
            padding: "8px 15px",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Zu den Insights ›
        </button>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: S.mut,
          textTransform: "uppercase",
          letterSpacing: ".06em",
        }}
      >
        Schnellzugriff
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {APP_NAV.flatMap((g) => g.items).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onSection(t.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-start",
                background: S.panel,
                border: `1px solid ${S.line}`,
                borderRadius: 16,
                padding: "16px",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                boxShadow: "0 1px 2px rgba(43,0,51,.04)",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: S.appTint,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {Icon && <Icon size={18} color={S.app} />}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: S.txt }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── KI-Crawler-Karte (Searchable-Nachbau ⑤, Beta 08/2026) ────────────────────
// Zeigt Bot-Besuche der letzten 7 Tage aus ai_crawler_hits (Ingest-Endpoint
// /api/admin/ai-crawler-ingest). Rollout des Erfassungs-Snippets auf Kunden-
// Websites läuft über den normalen Freigabe-Workflow — nie autonom.
function CrawlerCard({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [rows, setRows] = useState<Array<{ bot: string; url: string; at: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    (supabase as any)
      .from("ai_crawler_hits")
      .select("bot, url, at")
      .eq("client_id", clientId)
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(1000)
      .then(({ data }: any) => {
        if (alive) setRows(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [clientId]);
  if (rows === null) return null;
  const byBot: Record<string, number> = {};
  const byUrl: Record<string, number> = {};
  for (const r of rows) {
    byBot[r.bot] = (byBot[r.bot] || 0) + 1;
    byUrl[r.url] = (byUrl[r.url] || 0) + 1;
  }
  const bots = Object.entries(byBot).sort((a, b) => b[1] - a[1]);
  const urls = Object.entries(byUrl)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <div
      style={{
        background: S.panel,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        padding: 18,
        marginTop: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>KI-Crawler auf der Website</div>
        <span
          style={{
            fontSize: 10,
            color: S.app,
            border: `1px solid ${S.app}55`,
            borderRadius: 99,
            padding: "1px 8px",
          }}
        >
          Beta
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: S.mut }}>letzte 7 Tage</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: S.mut, marginTop: 10 }}>
          Noch keine Daten — das Erfassungs-Snippet ist auf dieser Kunden-Website noch nicht
          ausgerollt (Rollout läuft über den Freigabe-Workflow).
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
            gap: 14,
            marginTop: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                marginBottom: 6,
              }}
            >
              Besuche je Bot ({rows.length})
            </div>
            {bots.map(([b, n]) => (
              <div
                key={b}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  padding: "3px 0",
                  borderBottom: `1px solid ${S.line}`,
                }}
              >
                <span>{b}</span>
                <span style={{ color: S.mut }}>{n}</span>
              </div>
            ))}
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                marginBottom: 6,
              }}
            >
              Meistgecrawlte Seiten
            </div>
            {urls.map(([u, n]) => (
              <div
                key={u}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11.5,
                  padding: "3px 0",
                  borderBottom: `1px solid ${S.line}`,
                }}
              >
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {u}
                </span>
                <span style={{ color: S.mut }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LLM Analytics (Searchable-Nachbau "/ai-traffic", 05.08.2026) ─────────────
// Zwei Datenhälften wie bei Searchable: (1) KI-Crawler auf der Website aus
// ai_crawler_hits (Log-Snippet, RLS-direkt gelesen), (2) KI-Referral-Besucher
// aus GA4 via /api/admin/llm-traffic (Tages-Zeitreihe je Engine + Top-Seiten).
const BOT_PLATFORM: Array<[RegExp, string]> = [
  [/gptbot|oai-searchbot|chatgpt/i, "OpenAI"],
  [/claude|anthropic/i, "Anthropic"],
  [/perplexity/i, "Perplexity"],
  [/google/i, "Google"],
  [/meta-/i, "Meta"],
  [/bytespider/i, "ByteDance"],
  [/amazonbot/i, "Amazon"],
  [/applebot/i, "Apple"],
  [/cohere/i, "Cohere"],
];
const botPlatform = (b: string) => BOT_PLATFORM.find(([re]) => re.test(b))?.[1] || "Weitere";
const ENGINE_COLORS: Record<string, string> = {
  ChatGPT: "#10a37f",
  Perplexity: "#20808d",
  Gemini: "#4285f4",
  Claude: "#d97757",
  Copilot: "#0b76b7",
  Grok: "#1c1c1e",
  DeepSeek: "#4d6bfe",
};

// Vergleichsfenster (Vorperiode/Vorjahr) für die Range-Panels.
type CompareWin = { start: Date; end: Date; name: string } | null;

// Tages-Schlüssel YYYYMMDD von start bis end (lückenlos, lokale Zeit).
function rangeDayKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  for (let i = 0; d <= e && i < 400; i++, d.setDate(d.getDate() + 1)) {
    out.push(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function LlmAnalyticsPanel({
  clientId,
  S,
  range,
  compare,
}: {
  clientId: string;
  S: Record<string, string>;
  range: ResolvedRange;
  compare: CompareWin;
}) {
  // Zeitraum kommt zentral aus dem Header — seit 18.08. inkl. eigener Zeiträume
  // (exakte Start/Ende-Daten statt gerundeter 7/30/90-Stufen).
  const [hits, setHits] = useState<Array<{ bot: string; url: string; at: string }> | null>(null);
  const [traffic, setTraffic] = useState<any>(null);
  const [pageEngine, setPageEngine] = useState<string>("");
  const startKey = isoDay(range.start);
  const endKey = isoDay(range.end);
  const days = range.days;

  useEffect(() => {
    let alive = true;
    setHits(null);
    const since = new Date(`${startKey}T00:00:00`).toISOString();
    const until = new Date(new Date(`${endKey}T00:00:00`).getTime() + 864e5).toISOString();
    (supabase as any)
      .from("ai_crawler_hits")
      .select("bot, url, at")
      .eq("client_id", clientId)
      .gte("at", since)
      .lt("at", until)
      .order("at", { ascending: false })
      .limit(5000)
      .then(({ data }: any) => {
        if (alive) setHits(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [clientId, startKey, endKey]);

  useEffect(() => {
    let alive = true;
    // Range-Cache (2026-08-10): gecachten Stand SOFORT zeigen; ist er frisch
    // (< TTL), entfällt der Netz-Call ganz — sonst still im Hintergrund laden.
    const cacheKey = `llm-traffic:${clientId}:${startKey}:${endKey}`;
    const cached = cacheGet(cacheKey);
    setTraffic(cached ? cached.data : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/admin/llm-traffic?client=${encodeURIComponent(clientId)}&start=${startKey}&end=${endKey}`,
          {
            headers: { Authorization: `Bearer ${session?.access_token || ""}` },
          },
        );
        const j = await r.json().catch(() => ({}));
        if (j.ok) cachePut(cacheKey, j);
        // Fehler ersetzen einen vorhandenen Cache-Stand nicht (SWR-Prinzip).
        if (alive && (j.ok || !cached))
          setTraffic(j.ok ? j : { ok: false, error: j.error || `HTTP ${r.status}` });
      } catch (e: any) {
        if (alive && !cached) setTraffic({ ok: false, error: String(e?.message || e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, startKey, endKey]);

  // Vergleichsperiode (18.08.): Crawler-Zahl direkt aus der Tabelle, GA4-Summen
  // über denselben Endpoint mit exakten Vergleichs-Daten — keine Schätzwerte.
  const cmpStart = compare ? isoDay(compare.start) : "";
  const cmpEnd = compare ? isoDay(compare.end) : "";
  const [cmp, setCmp] = useState<null | {
    crawler: number | null;
    sessions: number | null;
    newUsers: number | null;
  }>(null);
  useEffect(() => {
    let alive = true;
    setCmp(null);
    if (!cmpStart || !cmpEnd) return;
    (async () => {
      try {
        const since = new Date(`${cmpStart}T00:00:00`).toISOString();
        const until = new Date(new Date(`${cmpEnd}T00:00:00`).getTime() + 864e5).toISOString();
        const { count } = await (supabase as any)
          .from("ai_crawler_hits")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .gte("at", since)
          .lt("at", until);
        const cacheKey = `llm-traffic:${clientId}:${cmpStart}:${cmpEnd}`;
        const cached = cacheGet(cacheKey);
        let j: any = cached && Date.now() - cached.at < RANGE_TTL_MS ? cached.data : null;
        if (!j) {
          const session = (await supabase.auth.getSession()).data.session;
          const r = await fetch(
            `/api/admin/llm-traffic?client=${encodeURIComponent(clientId)}&start=${cmpStart}&end=${cmpEnd}`,
            {
              headers: { Authorization: `Bearer ${session?.access_token || ""}` },
            },
          );
          j = await r.json().catch(() => ({}));
          if (j?.ok) cachePut(cacheKey, j);
        }
        const totals: any[] = j?.ok && j.ga4 ? Object.values(j.totals || {}) : [];
        if (alive)
          setCmp({
            crawler: count ?? 0,
            sessions:
              j?.ok && j.ga4 ? totals.reduce((a, t: any) => a + (t.sessions || 0), 0) : null,
            newUsers:
              j?.ok && j.ga4 ? totals.reduce((a, t: any) => a + (t.newUsers || 0), 0) : null,
          });
      } catch {
        /* Vergleich ist optional — Hauptzahlen bleiben unberührt */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, cmpStart, cmpEnd]);

  // Lückenlose Tages-Skala (fehlende Tage = 0), GA4-Format YYYYMMDD.
  const dayKeys = useMemo(() => rangeDayKeys(range.start, range.end), [range.start, range.end]);
  const dayLabel = (k: string) => `${k.slice(6, 8)}.${k.slice(4, 6)}.`;

  const crawler = useMemo(() => {
    const byDay: Record<string, number> = {};
    const byBot: Record<string, { n: number; last: string }> = {};
    const byUrl: Record<string, { n: number; bots: Record<string, number> }> = {};
    for (const h of hits || []) {
      const k = String(h.at || "")
        .slice(0, 10)
        .replace(/-/g, "");
      byDay[k] = (byDay[k] || 0) + 1;
      const b = byBot[h.bot] || { n: 0, last: h.at };
      b.n++;
      if (h.at > b.last) b.last = h.at;
      byBot[h.bot] = b;
      const u = byUrl[h.url] || { n: 0, bots: {} };
      u.n++;
      u.bots[h.bot] = (u.bots[h.bot] || 0) + 1;
      byUrl[h.url] = u;
    }
    return {
      byDay,
      bots: Object.entries(byBot).sort((a, b) => b[1].n - a[1].n),
      urls: Object.entries(byUrl)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 10),
      total: (hits || []).length,
    };
  }, [hits]);

  const engines: string[] = useMemo(
    () =>
      Object.entries((traffic?.totals || {}) as Record<string, any>)
        .sort((a: any, b: any) => b[1].sessions - a[1].sessions)
        .map(([k]) => k),
    [traffic],
  );
  const refTotal = engines.reduce((a, k) => a + (traffic?.totals?.[k]?.sessions || 0), 0);
  const refNew = engines.reduce((a, k) => a + (traffic?.totals?.[k]?.newUsers || 0), 0);
  const platformCount = new Set([...crawler.bots.map(([b]) => botPlatform(b)), ...engines]).size;
  const tsByDay = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of traffic?.timeseries || []) m.set(String(p.date), p.byEngine || {});
    return m;
  }, [traffic]);
  const pageEngines = Object.keys(traffic?.pagesByEngine || {});
  const activePageEngine =
    pageEngine && pageEngines.includes(pageEngine) ? pageEngine : pageEngines[0] || "";

  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const secTitle = (t: string, sub?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>{t}</div>
      {sub && <span style={{ fontSize: 11, color: S.mut }}>{sub}</span>}
    </div>
  );

  // Referral-Linienchart
  const [rwRef, RW] = useChartWidth(1000, 560);
  const RH = 190,
    RP = 8,
    RAXL = 34,
    RAXB = 16;
  const refMax = Math.max(
    1,
    ...dayKeys.map((k) =>
      engines.reduce((a, e) => Math.max(a, tsByDay.get(k)?.[e]?.sessions || 0), 0),
    ),
  );
  const rx = (i: number) =>
    RAXL + RP + (i / Math.max(1, dayKeys.length - 1)) * (RW - RAXL - 2 * RP);
  const ry = (v: number) => RH - RAXB - RP - (v / refMax) * (RH - RAXB - 2 * RP);
  // Crawler-Balkenchart
  const [cwRef, CW] = useChartWidth(1000, 560);
  const CH = 150,
    CP = 8,
    CAXL = 34,
    CAXB = 16;
  const crMax = Math.max(1, ...dayKeys.map((k) => crawler.byDay[k] || 0));
  const cx = (i: number) => CAXL + CP + (i / Math.max(1, dayKeys.length)) * (CW - CAXL - 2 * CP);
  const cy = (v: number) => CH - CAXB - CP - (v / crMax) * (CH - CAXB - 2 * CP);
  const barW = Math.max(2, (CW - CAXL - 2 * CP) / Math.max(1, dayKeys.length) - 2);
  const labelEvery = Math.max(1, Math.ceil(dayKeys.length / 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI-Zeile — mit optionalem Vergleich zur Vorperiode/zum Vorjahr */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12,
        }}
      >
        {(
          [
            [
              "Crawler-Besuche",
              hits === null ? "…" : crawler.total.toLocaleString("de-CH"),
              "KI-Bots auf der Website",
              hits !== null && compare && cmp ? (
                <DeltaBadge cur={crawler.total} prev={cmp.crawler} name={compare.name} />
              ) : null,
            ],
            [
              "KI-Besucher",
              traffic === null ? "…" : traffic.ga4 ? refTotal.toLocaleString("de-CH") : "—",
              "Sessions aus KI-Antworten (GA4)",
              traffic?.ga4 && compare && cmp ? (
                <DeltaBadge cur={refTotal} prev={cmp.sessions} name={compare.name} />
              ) : null,
            ],
            [
              "Neue Besucher",
              traffic === null ? "…" : traffic.ga4 ? refNew.toLocaleString("de-CH") : "—",
              "davon erstmals auf der Website",
              traffic?.ga4 && compare && cmp ? (
                <DeltaBadge cur={refNew} prev={cmp.newUsers} name={compare.name} />
              ) : null,
            ],
            ["Aktive Plattformen", String(platformCount), "Crawler + Referral kombiniert", null],
          ] as Array<[string, string, string, any]>
        ).map(([t, v, sub, delta]) => (
          <div key={t} style={card}>
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              {t}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: S.txt,
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {v}
            </div>
            <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>{sub}</div>
            {delta && <div style={{ marginTop: 4 }}>{delta}</div>}
          </div>
        ))}
      </div>

      {/* KI-Besucher pro Tag (GA4) */}
      <div style={card}>
        {secTitle("KI-Besucher pro Tag", "Referral-Sessions aus ChatGPT, Perplexity & Co. (GA4)")}
        {traffic === null ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 20 }}>Lade GA4-Daten…</div>
        ) : !traffic.ga4 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            Für diesen Kunden ist kein GA4 verbunden — die Besucher-Hälfte füllt sich, sobald die
            Verbindung steht.
          </div>
        ) : refTotal === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            Im gewählten Zeitraum kamen keine Besucher aus KI-Antworten.
          </div>
        ) : (
          <>
            <div ref={rwRef} style={{ overflowX: "auto" }}>
              <svg viewBox={`0 0 ${RW} ${RH}`} style={{ width: RW, display: "block" }}>
                {[0, 0.5, 1].map((f) => (
                  <g key={f}>
                    <line
                      x1={RAXL + RP}
                      x2={RW - RP}
                      y1={ry(f * refMax)}
                      y2={ry(f * refMax)}
                      stroke={S.line}
                      strokeWidth={1}
                    />
                    <text
                      x={RAXL}
                      y={ry(f * refMax) + 3}
                      textAnchor="end"
                      fontSize={9}
                      fill={S.mut}
                    >
                      {Math.round(f * refMax)}
                    </text>
                  </g>
                ))}
                {dayKeys.map((k, i) =>
                  i % labelEvery === 0 ? (
                    <text
                      key={k}
                      x={rx(i)}
                      y={RH - 3}
                      textAnchor="middle"
                      fontSize={9}
                      fill={S.mut}
                    >
                      {dayLabel(k)}
                    </text>
                  ) : null,
                )}
                {engines.map((e) => (
                  <g key={e}>
                    <polyline
                      points={dayKeys
                        .map((k, i) => `${rx(i)},${ry(tsByDay.get(k)?.[e]?.sessions || 0)}`)
                        .join(" ")}
                      fill="none"
                      stroke={ENGINE_COLORS[e] || S.app}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={rx(dayKeys.length - 1)}
                      cy={ry(tsByDay.get(dayKeys[dayKeys.length - 1])?.[e]?.sessions || 0)}
                      r={3}
                      fill={ENGINE_COLORS[e] || S.app}
                    />
                  </g>
                ))}
              </svg>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 14,
                marginTop: 8,
                fontSize: 11.5,
                color: S.mut,
              }}
            >
              {engines.map((e) => (
                <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: ENGINE_COLORS[e] || S.app,
                      display: "inline-block",
                    }}
                  />
                  {e} · {(traffic?.totals?.[e]?.sessions || 0).toLocaleString("de-CH")}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Crawler pro Tag */}
      <div style={card}>
        {secTitle(
          "Crawler-Besuche pro Tag",
          "KI-Bots, die Seiten der Website abrufen (Log-Snippet)",
        )}
        {hits === null ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 20 }}>Lade Crawler-Daten…</div>
        ) : crawler.total === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            Noch keine Daten — das Erfassungs-Snippet ist auf dieser Kunden-Website noch nicht
            ausgerollt (Rollout läuft über den Freigabe-Workflow).
          </div>
        ) : (
          <div ref={cwRef} style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: CW, display: "block" }}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={CAXL + CP}
                    x2={CW - CP}
                    y1={cy(f * crMax)}
                    y2={cy(f * crMax)}
                    stroke={S.line}
                    strokeWidth={1}
                  />
                  <text x={CAXL} y={cy(f * crMax) + 3} textAnchor="end" fontSize={9} fill={S.mut}>
                    {Math.round(f * crMax)}
                  </text>
                </g>
              ))}
              {dayKeys.map((k, i) =>
                i % labelEvery === 0 ? (
                  <text
                    key={k}
                    x={cx(i) + barW / 2}
                    y={CH - 3}
                    textAnchor="middle"
                    fontSize={9}
                    fill={S.mut}
                  >
                    {dayLabel(k)}
                  </text>
                ) : null,
              )}
              {dayKeys.map((k, i) => {
                const v = crawler.byDay[k] || 0;
                return v > 0 ? (
                  <rect
                    key={k}
                    x={cx(i)}
                    y={cy(v)}
                    width={barW}
                    height={CH - CAXB - CP - cy(v)}
                    rx={2}
                    fill={S.app}
                  >
                    <title>{`${dayLabel(k)} ${v} Besuche`}</title>
                  </rect>
                ) : null;
              })}
            </svg>
          </div>
        )}
      </div>

      {/* Tabellen-Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 16,
        }}
      >
        <div style={card}>
          {secTitle(
            "Meistgecrawlte Seiten",
            `${crawler.urls.length ? "Top " + crawler.urls.length : "—"}`,
          )}
          {crawler.urls.length === 0 ? (
            <div style={{ fontSize: 12, color: S.mut }}>Noch keine Crawler-Daten.</div>
          ) : (
            crawler.urls.map(([u, info]) => {
              const topBot = Object.entries(info.bots).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
              return (
                <div
                  key={u}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    padding: "5px 0",
                    borderBottom: `1px solid ${S.line}`,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: S.txt,
                    }}
                  >
                    {u}
                  </span>
                  <span style={{ fontSize: 10.5, color: S.mut, whiteSpace: "nowrap" }}>
                    {botPlatform(topBot)}
                  </span>
                  <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>{info.n}</span>
                </div>
              );
            })
          )}
        </div>
        <div style={card}>
          {secTitle("KI-Bots", `${crawler.bots.length ? crawler.bots.length + " aktiv" : "—"}`)}
          {crawler.bots.length === 0 ? (
            <div style={{ fontSize: 12, color: S.mut }}>Noch keine Crawler-Daten.</div>
          ) : (
            crawler.bots.map(([b, info]) => (
              <div
                key={b}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  padding: "5px 0",
                  borderBottom: `1px solid ${S.line}`,
                }}
              >
                <span style={{ flex: 1, color: S.txt }}>{b}</span>
                <span style={{ fontSize: 10.5, color: S.mut }}>{botPlatform(b)}</span>
                <span style={{ fontSize: 10.5, color: S.mut }}>
                  {String(info.last).slice(0, 10)}
                </span>
                <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>{info.n}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Top-Referral-Seiten je Engine */}
      <div style={card}>
        {secTitle("Top-Seiten aus KI-Antworten", "Wohin KI-Besucher einsteigen (GA4-Landingpages)")}
        {traffic === null ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>Lade GA4-Daten…</div>
        ) : !traffic.ga4 || pageEngines.length === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            {traffic?.ga4
              ? "Im gewählten Zeitraum keine KI-Referral-Einstiege."
              : "Kein GA4 verbunden."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {pageEngines.map((e) => (
                <button
                  key={e}
                  onClick={() => setPageEngine(e)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 99,
                    border: `1px solid ${activePageEngine === e ? "transparent" : S.line}`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    fontWeight: 600,
                    background: activePageEngine === e ? S.app : "transparent",
                    color: activePageEngine === e ? "#fff" : S.mut,
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            {(traffic.pagesByEngine[activePageEngine] || []).map((p: any) => (
              <div
                key={p.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  padding: "5px 0",
                  borderBottom: `1px solid ${S.line}`,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: S.txt,
                  }}
                >
                  {p.path}
                </span>
                <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>
                  {p.sessions.toLocaleString("de-CH")}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Traffic (Searchable-Nachbau "Traffic", 05.08.2026) ───────────────────────
// Gesamt-Traffic-Blick als Ergänzung zu LLM Analytics: GA4-Kanäle je Tag,
// Engagement-Vergleich KI vs. Organisch vs. Direkt (Searchable-Kernwidget)
// und GSC-Klicks/Impressionen — alles live via /api/admin/traffic-overview.
const CHANNEL_COLORS: Record<string, string> = {
  "Organic Search": "#0f9d6c",
  Direct: "#64748b",
  Referral: "#d97706",
  "Paid Search": "#dc2626",
  "Organic Social": "#B9009C",
  Email: "#0b76b7",
  "Cross-network": "#b45309",
  Unassigned: "#9ca3af",
};
const fmtDur = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// SEO×AEO-Quadranten (Searchable GSC-Doku): GSC-Keywords gegen die KI-Erwähnungs-
// quote der thematisch passenden Mess-Prompts (Wortüberlappung wie beim
// AI-Volumen-Feature). Schwellen: SEO hoch = Position ≤ 10, AEO hoch = ≥ 30 %.
const QUAD_STOP = new Set([
  "der",
  "die",
  "das",
  "und",
  "oder",
  "für",
  "fuer",
  "mit",
  "von",
  "aus",
  "bei",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "auf",
  "als",
  "was",
  "wie",
  "wer",
  "ist",
  "sind",
  "the",
  "for",
  "and",
  "was",
  "you",
  "your",
  "nach",
  "zum",
  "zur",
  "über",
  "ueber",
]);
const kwWords = (kw: string) =>
  kw
    .toLowerCase()
    .split(/[^a-zäöüéèà0-9]+/)
    .filter((w) => w.length >= 3 && !QUAD_STOP.has(w));
const stemOf = (w: string) => (w.length > 7 ? w.slice(0, 7) : w);

// ── Zeitraum-Steuerung (18.08., Vereinheitlichung mit dem Range-Store) ───────
// 7/30/90-Presets + eigener Zeitraum über zwei Datumsfelder. Schreibt in den
// App-übergreifenden Store (saveSharedRange) — ein hier gewählter Zeitraum gilt
// auch in EzyRank & Co., und ein dort gewählter Kalender-Zeitraum kommt hier
// exakt an (früher wurde er auf 7/30/90 gerundet).
function RangeControl({
  range,
  onApply,
  S,
}: {
  range: ResolvedRange;
  onApply: (r: SharedRange) => void;
  S: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => isoDay(range.start));
  const [end, setEnd] = useState(() => isoDay(range.end));
  useEffect(() => {
    setStart(isoDay(range.start));
    setEnd(isoDay(range.end));
  }, [range]);
  const applyCustom = () => {
    const s = new Date(`${start}T00:00:00`);
    const e = new Date(`${end}T00:00:00`);
    if (isNaN(+s) || isNaN(+e) || s > e) return;
    const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 864e5) + 1);
    const fmt = (d: Date) => d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
    onApply({
      label: `${fmt(s)} – ${fmt(e)}`,
      days,
      preset: "custom",
      start: s.toISOString(),
      end: e.toISOString(),
    });
    setOpen(false);
  };
  // Kompakt (21.08., Header-Entschlackung): EIN Dropdown-Button statt der
  // vierteiligen Button-Gruppe — die Kopfzeile lief mit allen Bereichs-Tabs
  // sonst über und schnitt Tabs ab. Presets + eigener Zeitraum im Popover.
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Zeitraum wählen"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 11px",
          borderRadius: 10,
          border: `1px solid ${S.line}`,
          background: S.bg,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12.5,
          fontWeight: 600,
          color: S.app,
          whiteSpace: "nowrap",
        }}
      >
        {range.preset === "custom" ? range.label : `${range.days} Tage`}
        <span style={{ fontSize: 9, color: S.mut }}>▼</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 6,
              zIndex: 41,
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,.14)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 230,
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {[7, 30, 90].map((d) => {
                const a = range.preset === `${d}d`;
                return (
                  <button
                    key={d}
                    onClick={() => {
                      onApply({ label: `${d} Tage`, days: d, preset: `${d}d` });
                      setOpen(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      borderRadius: 8,
                      border: `1px solid ${a ? S.app : S.line}`,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12.5,
                      fontWeight: 600,
                      background: a ? S.appTint : "transparent",
                      color: a ? S.app : S.mut,
                    }}
                  >
                    {d} Tage
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>Eigener Zeitraum</div>
            <label style={{ fontSize: 11, color: S.mut }}>
              Von
              <input
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: S.bg,
                  color: S.txt,
                  border: `1px solid ${S.line}`,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <label style={{ fontSize: 11, color: S.mut }}>
              Bis
              <input
                type="date"
                value={end}
                min={start}
                max={isoDay(new Date())}
                onChange={(e) => setEnd(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: S.bg,
                  color: S.txt,
                  border: `1px solid ${S.line}`,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <button
              onClick={applyCustom}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "none",
                background: S.app,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Anwenden
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// KPI-Vergleichsbadge: prozentuale Abweichung zur Vergleichsperiode.
// null-Basis (0 im Vergleich) wird ehrlich als "neu" statt +∞ gezeigt.
function DeltaBadge({ cur, prev, name }: { cur: number; prev: number | null; name: string }) {
  if (prev === null) return null;
  if (prev <= 0) {
    return cur > 0 ? (
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0f9d6c" }}>neu vs. {name}</span>
    ) : null;
  }
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: up ? "#0f9d6c" : "#dc2626" }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {pct} % vs. {name}
    </span>
  );
}

function TrafficPanel({
  clientId,
  S,
  range,
  compare,
}: {
  clientId: string;
  S: Record<string, string>;
  range: ResolvedRange;
  compare: CompareWin;
}) {
  // Zeitraum kommt zentral aus dem Header — seit 18.08. inkl. eigener Zeiträume.
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const startKey = isoDay(range.start);
  const endKey = isoDay(range.end);
  const days = range.days;

  useEffect(() => {
    let alive = true;
    setErr("");
    const cacheKey = `traffic-overview:${clientId}:${startKey}:${endKey}`;
    const cached = cacheGet(cacheKey);
    setData(cached ? cached.data : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/admin/traffic-overview?client=${encodeURIComponent(clientId)}&start=${startKey}&end=${endKey}`,
          {
            headers: { Authorization: `Bearer ${session?.access_token || ""}` },
          },
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        cachePut(cacheKey, j);
        if (alive) setData(j);
      } catch (e: any) {
        // Fehler ersetzen einen vorhandenen Cache-Stand nicht (SWR-Prinzip).
        if (alive && !cached) {
          setErr(String(e?.message || e));
          setData({ ok: false });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, startKey, endKey]);

  // Vergleichsperiode (18.08.): gleiche Quelle, exakte Vergleichs-Daten.
  const cmpStart = compare ? isoDay(compare.start) : "";
  const cmpEnd = compare ? isoDay(compare.end) : "";
  const [cmpData, setCmpData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    setCmpData(null);
    if (!cmpStart || !cmpEnd) return;
    (async () => {
      try {
        const cacheKey = `traffic-overview:${clientId}:${cmpStart}:${cmpEnd}`;
        const cached = cacheGet(cacheKey);
        let j: any = cached && Date.now() - cached.at < RANGE_TTL_MS ? cached.data : null;
        if (!j) {
          const session = (await supabase.auth.getSession()).data.session;
          const r = await fetch(
            `/api/admin/traffic-overview?client=${encodeURIComponent(clientId)}&start=${cmpStart}&end=${cmpEnd}`,
            {
              headers: { Authorization: `Bearer ${session?.access_token || ""}` },
            },
          );
          j = await r.json().catch(() => ({}));
          if (j?.ok) cachePut(cacheKey, j);
        }
        if (alive && j?.ok) setCmpData(j);
      } catch {
        /* Vergleich ist optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, cmpStart, cmpEnd]);

  // KI-Mess-Prompts des neuesten Reports (RLS-direkt) für die Quadranten-Matrix.
  const [prompts, setPrompts] = useState<Array<{ text: string; mentioned: boolean }> | null>(null);
  useEffect(() => {
    let alive = true;
    setPrompts(null);
    (async () => {
      const { data: rep } = await (supabase as any)
        .from("ai_visibility_reports")
        .select("id")
        .eq("client_id", clientId)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rep?.id) {
        if (alive) setPrompts([]);
        return;
      }
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any)
          .from("ai_visibility_prompts")
          .select("prompt, topic, status")
          .eq("report_id", rep.id)
          .range(from, from + 999);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      if (alive)
        setPrompts(
          rows.map((p) => ({
            text: `${p.topic || ""} ${p.prompt || ""}`.toLowerCase(),
            mentioned: p.status === "Erwähnt" || p.status === "Referenziert",
          })),
        );
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);

  const quad = useMemo(() => {
    const queries: any[] = data?.queries || [];
    if (!queries.length || !prompts || !prompts.length) return null;
    const pts = queries
      .slice(0, 80)
      .map((q) => {
        const stems = kwWords(q.query).map(stemOf);
        if (!stems.length) return null;
        const matched = prompts.filter((p) => stems.every((s) => p.text.includes(s)));
        const aeo = matched.length
          ? Math.round((matched.filter((m) => m.mentioned).length / matched.length) * 100)
          : null;
        return { ...q, aeo, matchedPrompts: matched.length };
      })
      .filter(Boolean) as any[];
    const measured = pts.filter((p) => p.aeo != null);
    if (!measured.length) return null;
    const bucket = (p: any) =>
      p.position <= 10
        ? p.aeo >= 30
          ? "staerken"
          : "kiPotenzial"
        : p.aeo >= 30
          ? "seoPotenzial"
          : "aufbau";
    const buckets: Record<string, any[]> = {
      staerken: [],
      kiPotenzial: [],
      seoPotenzial: [],
      aufbau: [],
    };
    for (const p of measured) buckets[bucket(p)].push(p);
    for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b.impressions - a.impressions);
    return { measured, buckets, unmeasured: pts.length - measured.length };
  }, [data, prompts]);

  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const dayKeys = useMemo(() => rangeDayKeys(range.start, range.end), [range.start, range.end]);
  const dayLabel = (k: string) => `${k.slice(6, 8)}.${k.slice(4, 6)}.`;
  const labelEvery = Math.max(1, Math.ceil(dayKeys.length / 10));
  const [qwRef, QW] = useChartWidth(1000, 640); // Quadranten-Matrix (mobil scrollbar)

  // App-Split (06.08., Volkan): EzyAI zeigt NUR die KI-Sicht — Kanal-Trends,
  // GSC-Klicks & klassisches SEO leben in EzyRank. Die Gesamt-Sessions dienen
  // hier nur als Bezugsgröße für den KI-Anteil.
  const totalSessions = Object.values(
    (data?.channels?.totals || {}) as Record<string, number>,
  ).reduce((a, b) => a + b, 0);
  const aiSeg = (data?.segments || []).find((s: any) => s.name === "KI-Antworten");
  const aiShare =
    totalSessions && aiSeg ? Math.round((aiSeg.sessions / totalSessions) * 1000) / 10 : 0;
  const orgSeg = (data?.segments || []).find((s: any) => s.name === "Organische Suche");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div style={{ fontSize: 12, color: "#dc2626" }}>{err}</div>}

      {data === null ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade Traffic-Daten…</div>
      ) : !data.ga4 && !data.gsc ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🔌</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>
            Kein GA4/GSC verbunden
          </div>
          <div style={{ fontSize: 13, color: S.mut }}>
            Sobald Google Analytics oder die Search Console für diesen Kunden verbunden ist, füllt
            sich dieser Bereich automatisch.
          </div>
        </div>
      ) : (
        <>
          {/* KPI-Zeile — bewusst nur KI-Kennzahlen (Rest: EzyRank) */}
          {(() => {
            const cmpAi = (cmpData?.segments || []).find((s: any) => s.name === "KI-Antworten");
            const cmpTotal = Object.values(
              (cmpData?.channels?.totals || {}) as Record<string, number>,
            ).reduce((a, b) => a + b, 0);
            return (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  gap: 12,
                }}
              >
                {(
                  [
                    [
                      "KI-Besucher",
                      data.ga4 && aiSeg ? aiSeg.sessions.toLocaleString("de-CH") : "0",
                      "Sessions aus KI-Antworten (inkl. Copilot/Bing AI)",
                      data.ga4 && compare && cmpData?.ga4 ? (
                        <DeltaBadge
                          cur={aiSeg?.sessions || 0}
                          prev={cmpAi?.sessions ?? 0}
                          name={compare.name}
                        />
                      ) : null,
                    ],
                    [
                      "KI-Anteil",
                      data.ga4 ? `${aiShare} %` : "—",
                      `an ${totalSessions.toLocaleString("de-CH")} Sessions gesamt`,
                      data.ga4 && compare && cmpData?.ga4 && cmpTotal > 0 && cmpAi ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: S.mut }}>
                          {compare.name}: {Math.round((cmpAi.sessions / cmpTotal) * 1000) / 10} %
                        </span>
                      ) : null,
                    ],
                    [
                      "Ø Dauer (KI)",
                      data.ga4 && aiSeg ? fmtDur(aiSeg.avgDurationSec) : "—",
                      orgSeg ? `Organische Suche: ${fmtDur(orgSeg.avgDurationSec)}` : "",
                      null,
                    ],
                    [
                      "Engagement (KI)",
                      data.ga4 && aiSeg ? `${aiSeg.engagementRate} %` : "—",
                      orgSeg ? `Organische Suche: ${orgSeg.engagementRate} %` : "",
                      null,
                    ],
                  ] as Array<[string, string, string, any]>
                ).map(([t, v, sub, delta]) => (
                  <div key={t} style={card}>
                    <div
                      style={{
                        fontSize: 11,
                        color: S.mut,
                        textTransform: "uppercase",
                        letterSpacing: ".05em",
                      }}
                    >
                      {t}
                    </div>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: S.txt,
                        marginTop: 4,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {v}
                    </div>
                    <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>{sub}</div>
                    {delta && <div style={{ marginTop: 4 }}>{delta}</div>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Engagement-Vergleich (Searchable-Kernwidget) */}
          {data.ga4 && Array.isArray(data.segments) && data.segments.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 4 }}>
                Engagement im Vergleich
              </div>
              <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 10 }}>
                Wie sich Besucher aus KI-Antworten gegenüber klassischen Kanälen verhalten.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr
                      style={{
                        color: S.mut,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "6px 8px" }}>Segment</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Sessions</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Neue Besucher</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Ø Dauer</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Seiten/Session</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.segments.map((s: any) => (
                      <tr
                        key={s.name}
                        style={{
                          borderTop: `1px solid ${S.line}`,
                          background: s.name === "KI-Antworten" ? S.appTint : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "7px 8px",
                            fontWeight: s.name === "KI-Antworten" ? 700 : 500,
                            color: s.name === "KI-Antworten" ? S.app : S.txt,
                          }}
                        >
                          {s.name}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: S.txt,
                          }}
                        >
                          {s.sessions.toLocaleString("de-CH")}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: S.mut,
                          }}
                        >
                          {s.newUsers.toLocaleString("de-CH")}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: S.txt,
                          }}
                        >
                          {fmtDur(s.avgDurationSec)}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: S.txt,
                          }}
                        >
                          {s.pagesPerSession}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: S.txt,
                          }}
                        >
                          {s.engagementRate} %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SEO × KI-Sichtbarkeit: Quadranten-Matrix (Searchable GSC-Kombination) */}
          {quad &&
            (() => {
              const QH = 300,
                QP = 14,
                QAXL = 40,
                QAXB = 24;
              const qx = (pos: number) =>
                QAXL + QP + ((30 - Math.min(pos, 30)) / 30) * (QW - QAXL - 2 * QP);
              const qy = (aeo: number) => QH - QAXB - QP - (aeo / 100) * (QH - QAXB - 2 * QP);
              const maxImp = Math.max(1, ...quad.measured.map((p: any) => p.impressions));
              const rOf = (imp: number) => 3 + Math.sqrt(imp / maxImp) * 6;
              const QCOLOR: Record<string, string> = {
                staerken: "#0f9d6c",
                kiPotenzial: "#77008C",
                seoPotenzial: "#0b76b7",
                aufbau: "#9ca3af",
              };
              const bucketOf = (p: any) =>
                p.position <= 10
                  ? p.aeo >= 30
                    ? "staerken"
                    : "kiPotenzial"
                  : p.aeo >= 30
                    ? "seoPotenzial"
                    : "aufbau";
              const QMETA: Array<[string, string, string]> = [
                [
                  "kiPotenzial",
                  "KI-Potenzial",
                  "Stark bei Google, kaum in KI-Antworten — beste Kandidaten für FAQ-/Antwort-Content",
                ],
                ["staerken", "Stärken", "Stark bei Google UND in KI-Antworten"],
                [
                  "seoPotenzial",
                  "SEO-Potenzial",
                  "In KI-Antworten präsent, aber nicht auf Google-Seite 1",
                ],
                ["aufbau", "Aufbau nötig", "Weder Google-Seite 1 noch KI-Präsenz"],
              ];
              return (
                <div style={card}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 4 }}>
                    SEO × KI-Sichtbarkeit
                  </div>
                  <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 10 }}>
                    Google-Keywords (GSC, nach Impressionen) gegen die KI-Erwähnungsquote der
                    thematisch passenden Mess-Prompts. Schwellen: Google-Seite 1 (Position ≤ 10) ·
                    KI-Quote ≥ 30 %.
                  </div>
                  <div ref={qwRef} style={{ overflowX: "auto" }}>
                    <svg viewBox={`0 0 ${QW} ${QH}`} style={{ width: QW, display: "block" }}>
                      {/* Quadranten-Hintergründe */}
                      <rect
                        x={qx(10)}
                        y={qy(100)}
                        width={QW - QP - qx(10)}
                        height={qy(30) - qy(100)}
                        fill="#0f9d6c"
                        opacity={0.06}
                      />
                      <rect
                        x={qx(10)}
                        y={qy(30)}
                        width={QW - QP - qx(10)}
                        height={qy(0) - qy(30)}
                        fill="#77008C"
                        opacity={0.07}
                      />
                      <rect
                        x={QAXL + QP}
                        y={qy(100)}
                        width={qx(10) - QAXL - QP}
                        height={qy(30) - qy(100)}
                        fill="#0b76b7"
                        opacity={0.05}
                      />
                      <line
                        x1={qx(10)}
                        x2={qx(10)}
                        y1={QP}
                        y2={QH - QAXB - QP}
                        stroke={S.line}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                      <line
                        x1={QAXL + QP}
                        x2={QW - QP}
                        y1={qy(30)}
                        y2={qy(30)}
                        stroke={S.line}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                      {/* Achsen-Beschriftung */}
                      <text x={QAXL + QP} y={QH - 6} fontSize={10} fill={S.mut}>
                        ← schwächere Google-Position
                      </text>
                      <text x={QW - QP} y={QH - 6} fontSize={10} fill={S.mut} textAnchor="end">
                        Google-Seite 1 →
                      </text>
                      <text
                        x={QAXL - 6}
                        y={qy(100) + 8}
                        fontSize={10}
                        fill={S.mut}
                        textAnchor="end"
                      >
                        KI 100 %
                      </text>
                      <text x={QAXL - 6} y={qy(30) + 3} fontSize={10} fill={S.mut} textAnchor="end">
                        30 %
                      </text>
                      <text x={QAXL - 6} y={qy(0)} fontSize={10} fill={S.mut} textAnchor="end">
                        0 %
                      </text>
                      {/* Quadranten-Labels */}
                      <text
                        x={QW - QP - 6}
                        y={qy(100) + 14}
                        fontSize={10.5}
                        fontWeight={700}
                        fill="#0f9d6c"
                        textAnchor="end"
                      >
                        Stärken
                      </text>
                      <text
                        x={QW - QP - 6}
                        y={qy(0) - 8}
                        fontSize={10.5}
                        fontWeight={700}
                        fill="#77008C"
                        textAnchor="end"
                      >
                        KI-Potenzial
                      </text>
                      <text
                        x={QAXL + QP + 6}
                        y={qy(100) + 14}
                        fontSize={10.5}
                        fontWeight={700}
                        fill="#0b76b7"
                      >
                        SEO-Potenzial
                      </text>
                      <text
                        x={QAXL + QP + 6}
                        y={qy(0) - 8}
                        fontSize={10.5}
                        fontWeight={700}
                        fill="#9ca3af"
                      >
                        Aufbau nötig
                      </text>
                      {quad.measured.map((p: any) => (
                        <circle
                          key={p.query}
                          cx={qx(p.position)}
                          cy={qy(p.aeo)}
                          r={rOf(p.impressions)}
                          fill={QCOLOR[bucketOf(p)]}
                          opacity={0.75}
                          stroke="#fff"
                          strokeWidth={1}
                        >
                          <title>{`${p.query}\nGoogle-Position ${p.position} · ${p.impressions.toLocaleString("de-CH")} Impressionen\nKI-Quote ${p.aeo} % (${p.matchedPrompts} passende Prompts)`}</title>
                        </circle>
                      ))}
                    </svg>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    {QMETA.map(([key, title, desc]) => (
                      <div
                        key={key}
                        style={{
                          border: `1px solid ${key === "kiPotenzial" ? QCOLOR[key] : S.line}`,
                          borderRadius: 10,
                          padding: 12,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: QCOLOR[key] }}>
                          {title} · {quad.buckets[key].length}
                        </div>
                        <div
                          style={{ fontSize: 10.5, color: S.mut, marginTop: 2, marginBottom: 6 }}
                        >
                          {desc}
                        </div>
                        {quad.buckets[key].slice(0, 6).map((p: any) => (
                          <div
                            key={p.query}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              fontSize: 11.5,
                              padding: "3px 0",
                              borderTop: `1px solid ${S.line}`,
                            }}
                          >
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: S.txt,
                              }}
                            >
                              {p.query}
                            </span>
                            <span
                              style={{
                                color: S.mut,
                                whiteSpace: "nowrap",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              #{p.position} · {p.aeo} %
                            </span>
                          </div>
                        ))}
                        {!quad.buckets[key].length && (
                          <div style={{ fontSize: 11, color: S.mut }}>—</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {quad.unmeasured > 0 && (
                    <div style={{ fontSize: 10.5, color: S.mut, marginTop: 8 }}>
                      {quad.unmeasured} Keywords ohne thematisch passenden Mess-Prompt (nicht in der
                      Matrix) — mehr Abdeckung entsteht über zusätzliche Prompts in „Prompts
                      verwalten".
                    </div>
                  )}
                </div>
              );
            })()}

          <div style={{ fontSize: 11, color: S.mut }}>
            EzyAI zeigt hier bewusst nur den KI-Traffic (inkl. Copilot/Bing AI). Kanal-Trends,
            GSC-Klicks und SEO-Keywords findest du in EzyRank, Ads in EzyPerformance.
          </div>
        </>
      )}
    </div>
  );
}

// ── Benachrichtigungs-Glocke (13.08., Volkan) ────────────────────────────────
// Zeigt Sichtbarkeits-Alarme aus app_notifications (Sync-Wächter: Score-
// Einbruch, verlorene Zitierungen, SoV-Überholung). RLS filtert auf die
// Kunden, die der User sehen darf. Klick auf die Glocke öffnet die Liste;
// "Alle gelesen" setzt read_at. Kein Polling — lädt beim Mount und bei Öffnen.
const NOTIF_SEV: Record<string, string> = {
  kritisch: "#dc2626",
  hoch: "#f59e0b",
  mittel: "#6366f1",
  info: "#9ca3af",
};
function NotificationsBell({ S }: { S: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("app_notifications")
      .select("id, kind, severity, title, body, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data || []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const unread = items.filter((i) => !i.read_at).length;
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    await (supabase as any)
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    void load();
  };
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-label="Benachrichtigungen"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 10,
          border: `1px solid ${S.line}`,
          background: open ? S.appTint : "transparent",
          cursor: "pointer",
        }}
      >
        <Bell size={16} color={unread ? S.app : S.mut} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              minWidth: 17,
              height: 17,
              borderRadius: 99,
              background: "#dc2626",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: 40,
              right: 0,
              zIndex: 41,
              width: "min(400px, 90vw)",
              maxHeight: 420,
              overflowY: "auto",
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: `1px solid ${S.line}`,
                position: "sticky",
                top: 0,
                background: S.panel,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: S.txt }}>Meldungen</span>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  style={{
                    marginLeft: "auto",
                    fontSize: 11.5,
                    color: S.app,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  Alle als gelesen markieren
                </button>
              )}
            </div>
            {!items.length ? (
              <div
                style={{ padding: "22px 14px", textAlign: "center", fontSize: 12.5, color: S.mut }}
              >
                Keine Meldungen — der Sichtbarkeits-Wächter meldet sich bei Score-Einbrüchen,
                verlorenen Zitierungen oder SoV-Überholungen.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    gap: 9,
                    padding: "10px 14px",
                    borderBottom: `1px solid ${S.line}`,
                    opacity: n.read_at ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      marginTop: 5,
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: NOTIF_SEV[n.severity] || NOTIF_SEV.info,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ fontSize: 12.5, fontWeight: n.read_at ? 500 : 700, color: S.txt }}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{n.body}</div>
                    )}
                    <div style={{ fontSize: 10.5, color: S.mut, marginTop: 3 }}>
                      {new Date(n.created_at).toLocaleDateString("de-CH", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Site Health (Searchable-Nachbau "Site Audits", 05.08.2026) ───────────────
// On-demand-Audit über /api/admin/site-health (kostenlose Live-Checks auf der
// Kundendomain). Drei Säulen mit Searchable-Gewichten (Technical 30 % /
// Content 35 % / AEO 35 %), Issue-Liste mit Severity. mode="issues" zeigt
// dieselben Daten mit Fokus auf die Problemliste (Sidebar-Punkt "Issues").
const SEV_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  kritisch: { bg: "#fde8e8", fg: "#b91c1c", label: "Kritisch" },
  hoch: { bg: "#fdf0e3", fg: "#b45309", label: "Hoch" },
  mittel: { bg: "#fdf6e3", fg: "#8a6d1b", label: "Mittel" },
  niedrig: { bg: "#e8f0fd", fg: "#1d4ed8", label: "Niedrig" },
};
const scoreColor = (v: number) =>
  v >= 90 ? "#0f9d6c" : v >= 70 ? "#6aa84f" : v >= 50 ? "#d97706" : v >= 30 ? "#ea580c" : "#dc2626";
const scoreLabel = (v: number) =>
  v >= 90
    ? "Ausgezeichnet"
    : v >= 70
      ? "Gut"
      : v >= 50
        ? "Befriedigend"
        : v >= 30
          ? "Schlecht"
          : "Kritisch";

// ── Chancen-Queue (11.08., Searchable "Opportunities"-Parität) ───────────────
// EIN Ort für alles Handlungsrelevante, priorisiert nach Schwere — aggregiert
// read-only aus vorhandenen Quellen: Site-Health-Issues (Endpoint), Prompt-
// Chancen (Konkurrenz empfohlen, Kunde nicht — RLS-Read), Prüf-Aufgaben
// (Prompt-Queue, Faktenprofil). Bewusst ohne neue Tabellen: Erledigen heisst
// die Ursache beheben, nicht einen Status pflegen.
const OPP_SEV_ORDER: Record<string, number> = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
function OpportunitiesPanel({
  clientId,
  clientName,
  S,
  onOpenCuration,
  onGo,
  onBriefCreated,
}: {
  clientId: string;
  clientName: string;
  S: Record<string, string>;
  onOpenCuration: () => void;
  onGo: (section: string) => void;
  onBriefCreated: (id: string) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  // Workflow-Zustände (18.08., v2 21.08.): je Chance ein persistenter Status in
  // ai_opportunity_states, verknüpft über den stabilen Fingerprint — überlebt
  // Reload UND neue Messläufe (dieselbe erkannte Chance ⇒ derselbe Fingerprint).
  const [states, setStates] = useState<Record<string, any> | null>(null);
  // Supabase-Fehler werden NICHT mehr als "leerer Zustand" maskiert (21.08.):
  // fehlende Tabelle/Migration/RLS wird als Klartext-Banner gezeigt, Schreib-
  // aktionen sind dann gesperrt und ein Retry-Button lädt neu.
  const [statesErr, setStatesErr] = useState<string | null>(null);
  const loadStates = useCallback(async () => {
    setStatesErr(null);
    try {
      const { data, error } = await (supabase as any)
        .from("ai_opportunity_states")
        .select(
          "fingerprint, status, assignee, assignee_user_id, note, resurface_on, title, source, updated_at",
        )
        .eq("client_id", clientId);
      if (error) throw error;
      const m: Record<string, any> = {};
      for (const r of data || []) m[r.fingerprint] = r;
      setStates(m);
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || e);
      const hint =
        code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(msg)
          ? "Tabelle ai_opportunity_states fehlt — Migration 20260818090000/20260821100000 wurde in dieser Umgebung nicht angewendet."
          : code === "42501" || /permission denied|row-level security/i.test(msg)
            ? "Zugriff verweigert (RLS-Policy) — Rolle/Policies für ai_opportunity_states prüfen."
            : "Workflow-Zustände konnten nicht geladen werden.";
      setStatesErr(`${hint} (${msg})`);
      setStates({});
    }
  }, [clientId]);
  useEffect(() => {
    setStates(null);
    void loadStates();
  }, [loadStates]);

  // Team-Liste für die Verantwortlichen-Auswahl (RPC, RLS-sicher via
  // SECURITY DEFINER — profiles selbst ist nur fürs eigene Profil lesbar).
  // Eigene Rolle daraus = Schreibrecht (Viewer sehen alles, ändern nichts).
  const [team, setTeam] = useState<Array<{
    user_id: string;
    name: string;
    email: string | null;
    org_role: string;
  }> | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTeam(null);
    (async () => {
      try {
        const uid = (await supabase.auth.getSession()).data.session?.user?.id || null;
        const { data, error } = await (supabase as any).rpc("ezyai_team_members", {
          _client_id: clientId,
        });
        if (!alive) return;
        setMeId(uid);
        setTeam(error ? [] : ((data as any[]) ?? []));
      } catch {
        if (alive) setTeam([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);
  const teamById = useMemo(() => {
    const m = new Map<string, { name: string; email: string | null }>();
    for (const t of team || []) m.set(t.user_id, { name: t.name, email: t.email });
    return m;
  }, [team]);
  const myRole = useMemo(
    () => (team || []).find((t) => t.user_id === meId)?.org_role || null,
    [team, meId],
  );
  // Schreibrecht: kein Fehlerzustand UND nicht Viewer. Solange die Team-Liste
  // lädt, lassen wir Bedienung zu — die RLS blockt Unbefugte ohnehin serverseitig.
  const canWrite = !statesErr && myRole !== "viewer";

  // Zustand einer Chance: v2-Fingerprint zuerst, Legacy-FNV als Fallback,
  // bis die Lazy-Migration (unten) die Zeile umgeschrieben hat.
  const stateFor = useCallback(
    (i: any) => (states || {})[i.fp] ?? (i.legacyFp ? (states || {})[i.legacyFp] : undefined),
    [states],
  );

  const [saveErr, setSaveErr] = useState("");
  // organization_id wird serverseitig per Trigger aus dem Kunden gesetzt —
  // hier bewusst NICHT mitschicken (kein Client-Input für Mandanten-Zuordnung).
  const saveState = useCallback(
    async (item: any, patch: Record<string, any>) => {
      if (statesErr) return; // Schreibaktionen im Fehlerfall deaktiviert
      const cur = stateFor(item) || {};
      const row = {
        client_id: clientId,
        fingerprint: item.fp,
        status: patch.status ?? cur.status ?? "offen",
        assignee: patch.assignee !== undefined ? patch.assignee || null : (cur.assignee ?? null),
        assignee_user_id:
          patch.assignee_user_id !== undefined
            ? patch.assignee_user_id || null
            : (cur.assignee_user_id ?? null),
        note: patch.note !== undefined ? patch.note || null : (cur.note ?? null),
        resurface_on:
          patch.resurface_on !== undefined
            ? patch.resurface_on || null
            : (cur.resurface_on ?? null),
        title: item.titel || cur.title || null,
        source: item.quelle || cur.source || null,
      };
      const { error } = await (supabase as any)
        .from("ai_opportunity_states")
        .upsert(row, { onConflict: "client_id,fingerprint" });
      if (error) {
        setSaveErr(
          /row-level security|permission denied/i.test(String(error.message))
            ? `Speichern nicht erlaubt (Viewer sind read-only). ${error.message}`
            : `Speichern fehlgeschlagen: ${error.message}`,
        );
      } else {
        setSaveErr("");
        // Migration im Vorbeigehen: existierte der Zustand nur unter dem alten
        // FNV-Fingerprint, ist er jetzt unter v2 gespeichert — Altzeile weg.
        if (item.legacyFp && item.legacyFp !== item.fp && (states || {})[item.legacyFp]) {
          await (supabase as any)
            .from("ai_opportunity_states")
            .delete()
            .eq("client_id", clientId)
            .eq("fingerprint", item.legacyFp);
        }
        await loadStates();
      }
    },
    [states, stateFor, clientId, loadStates, statesErr],
  );
  // Teilfehler je Chancenquelle (21.08.): jede Quelle meldet ihren Fehler
  // separat, die übrigen Quellen liefern trotzdem — vorher verschwanden
  // Ausfälle still in leeren Listen.
  const [srcErrors, setSrcErrors] = useState<Array<{ quelle: string; msg: string }>>([]);
  useEffect(() => {
    let alive = true;
    setItems(null);
    setErr("");
    setSrcErrors([]);
    (async () => {
      const out: any[] = [];
      const fails: Array<{ quelle: string; msg: string }> = [];
      const fail = (quelle: string, e: any) =>
        fails.push({ quelle, msg: String(e?.message || e).slice(0, 160) });
      const session = (await supabase.auth.getSession()).data.session;
      const authH = { Authorization: `Bearer ${session?.access_token || ""}` };
      // 1) Site-Health-Issues (letzter Audit; ohne Audit einfach leer).
      try {
        const r = await fetch(`/api/admin/site-health?client=${encodeURIComponent(clientId)}`, {
          headers: authH,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        for (const i of j?.audit?.issues || []) {
          const key = String(i.id || i.label || "");
          out.push({
            sev: String(i.severity || "niedrig"),
            quelle: "Site Health",
            titel: String(i.label || ""),
            text: String(i.tipp || i.detail || ""),
            go: "issues",
            fp: oppFingerprint("sh", key),
            legacyFp: oppFingerprintLegacy("sh", key),
          });
        }
      } catch (e) {
        fail("Site Health", e);
      }
      // 1b) KI-Zitat-Gaps (12.08., DataForSEO include/exclude): echte Fragen
      // aus dem CH-Korpus, bei denen ein Rival zitiert wird, der Kunde nicht.
      try {
        const r = await fetch(
          `/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&gaps=1`,
          { headers: authH },
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        for (const g of j?.gaps || []) {
          const thema = `KI-Zitat-Gap vs. ${g.rival}`;
          out.push({
            sev: "hoch",
            quelle: "KI-Zitat-Gap",
            titel: `${g.rival} gewinnt KI-Zitate bei ${g.total} echten Fragen — ${clientName} fehlt`,
            text: `Beispiele aus dem Schweizer KI-Korpus: ${g.questions
              .slice(0, 4)
              .map((q: any) => `„${q.q}"`)
              .join(" · ")}. Zitierfähigen Inhalt zu diesen Fragen aufbauen.`,
            // kein go-Ziel mehr: der Bereich KI-Konkurrenz wurde entfernt,
            // Hauptaktion des Gaps ist "Brief erstellen".
            // Content-Loop (13.08.): direkt aus dem Gap einen Brief erzeugen.
            brief: {
              rival: g.rival,
              thema,
              questions: g.questions.slice(0, 8),
            },
            // v2 (21.08.): Rivale + Thema + Quelle + sortierte Fragen — zwei
            // verschiedene Gaps gegen denselben Rivalen kollidieren nicht mehr.
            fp: oppFingerprint(
              "gap",
              gapKey(
                String(g.rival || ""),
                thema,
                "aivis-korpus-ch",
                (g.questions || []).map((q: any) => String(q?.q ?? q ?? "")),
              ),
            ),
            legacyFp: oppFingerprintLegacy("gap", String(g.rival || "")),
          });
        }
      } catch (e) {
        fail("KI-Zitat-Gaps", e);
      }
      // 2) Prompt-Chancen: Konkurrenz wird empfohlen, der Kunde nicht.
      try {
        const { data: rep, error: repErr } = await (supabase as any)
          .from("ai_visibility_reports")
          .select("id")
          .eq("client_id", clientId)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (repErr) throw repErr;
        if (rep?.id) {
          const { data: opps, error: oppErr } = await (supabase as any)
            .from("ai_visibility_prompts")
            .select("prompt, platform, competitors")
            .eq("report_id", rep.id)
            .eq("is_opportunity", true)
            .limit(1000);
          if (oppErr) throw oppErr;
          const byPrompt = new Map<string, { engines: number; comps: Set<string> }>();
          for (const o of opps || []) {
            const g = byPrompt.get(o.prompt) || { engines: 0, comps: new Set<string>() };
            g.engines += 1;
            for (const c of o.competitors || []) g.comps.add(String(c));
            byPrompt.set(o.prompt, g);
          }
          [...byPrompt.entries()]
            .sort((a, b) => b[1].comps.size - a[1].comps.size)
            .slice(0, 8)
            .forEach(([prompt, g]) =>
              out.push({
                sev: g.comps.size >= 3 ? "hoch" : "mittel",
                quelle: "KI-Sichtbarkeit",
                titel: `Konkurrenz wird empfohlen: „${prompt}"`,
                text: `${g.engines} KI-${g.engines === 1 ? "Antwort nennt" : "Antworten nennen"} ${[...g.comps].slice(0, 3).join(", ")}${g.comps.size > 3 ? ` (+${g.comps.size - 3})` : ""} — ${clientName} fehlt. Zitierfähigen Inhalt zu dieser Frage aufbauen.`,
                go: "aeo-insights",
                fp: oppFingerprint("opp", prompt),
                legacyFp: oppFingerprintLegacy("opp", prompt),
              }),
            );
        }
      } catch (e) {
        fail("KI-Sichtbarkeit", e);
      }
      // 3) Prüf-Aufgaben: Prompt-Queue + Faktenprofil.
      try {
        const { count, error: cntErr } = await (supabase as any)
          .from("ai_visibility_prompt_defs")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .eq("needs_review", true);
        if (cntErr) throw cntErr;
        if (count)
          out.push({
            sev: "niedrig",
            quelle: "Kuration",
            titel: `${count} ${count === 1 ? "Prompt wartet" : "Prompts warten"} auf Prüfung`,
            text: "Unklare Vorschläge freigeben oder archivieren — nur Bestätigtes wird gemessen.",
            action: "curation",
            fp: oppFingerprint("cur", "prompt-review"),
            legacyFp: oppFingerprintLegacy("cur", "prompt-review"),
          });
      } catch (e) {
        fail("Kuration (Prompt-Queue)", e);
      }
      try {
        const r = await fetch(`/api/admin/brand-facts?client=${encodeURIComponent(clientId)}`, {
          headers: authH,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (j?.ok && j.needsReview)
          out.push({
            sev: "niedrig",
            quelle: "Kuration",
            titel: "Faktenprofil bestätigen",
            text: "Der Fakten-Check prüft KI-Antworten gegen dieses Profil — einmal prüfen und bestätigen erhöht die Treffsicherheit.",
            action: "curation",
            fp: oppFingerprint("cur", "brand-facts"),
            legacyFp: oppFingerprintLegacy("cur", "brand-facts"),
          });
      } catch (e) {
        fail("Kuration (Faktenprofil)", e);
      }
      // 4) Entity-Check (13.08.): existiert die Marke als Wikidata-Entität?
      // Ohne eindeutige Entität können KIs die Firma schwer zuordnen (GEO-
      // Fundament; vgl. Ezy-Hotel-Verwechslung). Öffentliche API, CORS offen.
      try {
        const r = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(clientName)}&language=de&uselang=de&format=json&origin=*&limit=5`,
        );
        const j = await r.json().catch(() => null);
        if (j && Array.isArray(j.search) && j.search.length === 0)
          out.push({
            sev: "niedrig",
            quelle: "Entitäten",
            titel: "Kein Wikidata-Eintrag zur Marke gefunden",
            text: `Für „${clientName}" existiert keine Wikidata-Entität — KI-Systeme können die Firma schwerer eindeutig zuordnen (Verwechslungsgefahr). Einen Basis-Eintrag mit Branche, Ort und Website anlegen.`,
            go: "aeo-insights",
            fp: oppFingerprint("ent", "wikidata"),
            legacyFp: oppFingerprintLegacy("ent", "wikidata"),
          });
      } catch (e) {
        fail("Entitäten (Wikidata)", e);
      }
      out.sort((a, b) => (OPP_SEV_ORDER[a.sev] ?? 9) - (OPP_SEV_ORDER[b.sev] ?? 9));
      if (alive) {
        setItems(out);
        setSrcErrors(fails);
      }
    })().catch((e) => {
      if (alive) {
        setErr(String(e?.message || e));
        setItems([]);
      }
    });
    return () => {
      alive = false;
    };
  }, [clientId, clientName]);

  // Lazy-Migration alter FNV-Fingerprints (21.08.): existiert ein Zustand nur
  // unter dem Legacy-Fingerprint, wird er einmalig auf v2 umgeschrieben — für
  // Viewer (kein Schreibrecht) greift stattdessen dauerhaft der Lese-Fallback.
  const migratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!items || !states || statesErr || !canWrite) return;
    if (migratedRef.current === clientId) return;
    const todo = items.filter(
      (i) => i.legacyFp && i.legacyFp !== i.fp && states[i.legacyFp] && !states[i.fp],
    );
    if (!todo.length) {
      migratedRef.current = clientId;
      return;
    }
    migratedRef.current = clientId;
    (async () => {
      for (const i of todo) {
        const { error } = await (supabase as any)
          .from("ai_opportunity_states")
          .update({ fingerprint: i.fp, title: i.titel || null, source: i.quelle || null })
          .eq("client_id", clientId)
          .eq("fingerprint", i.legacyFp);
        if (error) return; // Viewer/RLS oder Konflikt — Lese-Fallback bleibt aktiv
      }
      await loadStates();
    })();
  }, [items, states, statesErr, canWrite, clientId, loadStates]);

  // Fällige Wiedervorlagen → einmalige In-App-Benachrichtigung (Glocke).
  // Dedupe passiert HART in der DB (unique dedupe_key je Kunde+Fingerprint+
  // Fälligkeitsdatum) — Reloads erzeugen keine Duplikate; das Session-Set
  // spart nur wiederholte RPC-Calls. Viewer lösen nichts aus (RPC prüft
  // can_edit_client serverseitig nochmals).
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!states || statesErr || !canWrite) return;
    const today = isoDay(new Date());
    for (const s of Object.values(states) as any[]) {
      if (!isResurfaceDue(s.status, s.resurface_on, today)) continue;
      const key = `${clientId}:${s.fingerprint}:${s.resurface_on}`;
      if (notifiedRef.current.has(key)) continue;
      notifiedRef.current.add(key);
      void (supabase as any).rpc("ezyai_notify_resurface", {
        _client_id: clientId,
        _fingerprint: s.fingerprint,
        _title: `Wiedervorlage fällig: ${s.title || "Chance"}`,
        _due: s.resurface_on,
      });
    }
  }, [states, statesErr, canWrite, clientId]);

  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const [briefBusy, setBriefBusy] = useState<number | null>(null);
  const [briefErr, setBriefErr] = useState("");
  const makeBrief = async (i: any, idx: number) => {
    setBriefBusy(idx);
    setBriefErr("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/admin/content-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ client: clientId, source: i.brief }),
      });
      const j = await r.json().catch(() => ({}));
      // Content-Loop (18.08.): den frisch erzeugten Brief direkt öffnen.
      if (j.ok && j.id) onBriefCreated(String(j.id));
      else if (j.ok) onGo("content");
      else setBriefErr(j.error || `Brief-Erstellung fehlgeschlagen (HTTP ${r.status})`);
    } finally {
      setBriefBusy(null);
    }
  };

  const [filter, setFilter] = useState<"aktiv" | "faellig" | "archiv">("aktiv");
  const [editFp, setEditFp] = useState<string | null>(null);
  // Verantwortlich seit 21.08. als Team-User (assignee_user_id); der Sentinel
  // "__legacy__" erhält einen bestehenden Freitext-Wert unangetastet.
  const [draft, setDraft] = useState<{ assigneeId: string; note: string; resurface: string }>({
    assigneeId: "",
    note: "",
    resurface: "",
  });
  const openEditor = (i: any) => {
    const st = stateFor(i) || {};
    setDraft({
      assigneeId: st.assignee_user_id || (st.assignee ? "__legacy__" : ""),
      note: st.note || "",
      resurface: st.resurface_on || "",
    });
    setEditFp(editFp === i.fp ? null : i.fp);
  };

  if (items === null || states === null)
    return <div style={{ ...card, color: S.mut, fontSize: 13 }}>Chancen werden gesammelt…</div>;

  const today = isoDay(new Date());
  const statusOf = (i: any): OppStatus => (stateFor(i)?.status as OppStatus) || "offen";
  const isDone = (s: OppStatus) => s === "erledigt" || s === "verworfen";
  const dueOf = (i: any) => {
    const st = stateFor(i);
    return st && isResurfaceDue(st.status, st.resurface_on, today) ? String(st.resurface_on) : null;
  };
  // Fällige Wiedervorlagen automatisch nach oben (älteste zuerst), danach Schwere.
  const active = items
    .filter((i) => !isDone(statusOf(i)))
    .sort((a, b) => {
      const da = dueOf(a);
      const db = dueOf(b);
      if (!!da !== !!db) return da ? -1 : 1;
      if (da && db && da !== db) return da < db ? -1 : 1;
      return (OPP_SEV_ORDER[a.sev] ?? 9) - (OPP_SEV_ORDER[b.sev] ?? 9);
    });
  const dueItems = active.filter((i) => dueOf(i));
  const done = items.filter((i) => isDone(statusOf(i)));
  // Erledigte/verworfene Zustände, deren Quelle inzwischen verschwunden ist
  // (z. B. behobenes Site-Health-Issue) — im Archiv über den Snapshot lesbar.
  const knownFp = new Set(items.flatMap((i) => [i.fp, i.legacyFp].filter(Boolean)));
  const orphaned = Object.values(states).filter(
    (s: any) =>
      !knownFp.has(s.fingerprint) && (s.status === "erledigt" || s.status === "verworfen"),
  );
  const counts = active.reduce((m: Record<string, number>, i) => {
    m[i.sev] = (m[i.sev] || 0) + 1;
    return m;
  }, {});
  const shown = filter === "archiv" ? done : filter === "faellig" ? dueItems : active;
  // Anzeige-Name des Verantwortlichen: Team-User (Name + E-Mail) vor Freitext-Erbe.
  const assigneeLabel = (st: any): string | null => {
    if (st?.assignee_user_id) {
      const t = teamById.get(st.assignee_user_id);
      if (t) return t.email ? `${t.name} (${t.email})` : t.name;
      return st.assignee || "Unbekannter Nutzer";
    }
    return st?.assignee ? `${st.assignee} (Freitext)` : null;
  };

  const statusSelect = (i: any) => {
    const s = statusOf(i);
    const meta = OPP_STATUS.find((x) => x.id === s) || OPP_STATUS[0];
    return (
      <select
        value={s}
        disabled={!canWrite}
        onChange={(e) => void saveState(i, { status: e.target.value })}
        title={canWrite ? "Bearbeitungsstatus" : "Nur Lesen (Viewer oder Ladefehler)"}
        style={{
          flexShrink: 0,
          alignSelf: "center",
          padding: "4px 8px",
          borderRadius: 99,
          border: `1px solid ${meta.color}55`,
          background: `${meta.color}18`,
          color: meta.color,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: canWrite ? "pointer" : "not-allowed",
          opacity: canWrite ? 1 : 0.6,
        }}
      >
        {OPP_STATUS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  const renderRow = (i: any, idx: number) => {
    const sv = SEV_STYLE[i.sev] || SEV_STYLE.niedrig;
    const st = stateFor(i);
    const resurfaceDue = !!dueOf(i);
    const who = assigneeLabel(st);
    return (
      <div
        key={i.fp || idx}
        style={{ padding: "10px 0", borderTop: idx ? `1px solid ${S.line}` : "none" }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10.5,
              fontWeight: 700,
              borderRadius: 99,
              padding: "2px 9px",
              background: sv.bg,
              color: sv.fg,
            }}
          >
            {sv.label}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>{i.titel}</div>
            <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{i.text}</div>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 3,
                fontSize: 10.5,
                color: S.mut,
              }}
            >
              {who && <span>👤 {who}</span>}
              {st?.resurface_on && (
                <span
                  style={{
                    color: resurfaceDue ? "#dc2626" : S.mut,
                    fontWeight: resurfaceDue ? 700 : 400,
                  }}
                >
                  ⏰ Wiedervorlage {String(st.resurface_on).split("-").reverse().join(".")}
                  {resurfaceDue ? " — fällig" : ""}
                </span>
              )}
              {st?.note && (
                <span
                  style={{
                    maxWidth: 380,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  📝 {st.note}
                </span>
              )}
            </div>
          </div>
          <span style={{ flexShrink: 0, fontSize: 10.5, color: S.mut, alignSelf: "center" }}>
            {i.quelle}
          </span>
          {statusSelect(i)}
          <button
            onClick={() => openEditor(i)}
            disabled={!canWrite}
            title={
              canWrite ? "Verantwortlicher, Notiz, Wiedervorlage" : "Nur Lesen (Viewer/Fehler)"
            }
            style={{
              flexShrink: 0,
              alignSelf: "center",
              padding: "5px 10px",
              borderRadius: 8,
              border: `1px solid ${S.line}`,
              background: editFp === i.fp ? S.appTint : S.bg,
              color: S.mut,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: canWrite ? "pointer" : "not-allowed",
              opacity: canWrite ? 1 : 0.6,
              fontFamily: "inherit",
            }}
          >
            Details
          </button>
          {i.brief && (
            <button
              onClick={() => makeBrief(i, idx)}
              disabled={briefBusy !== null}
              style={{
                flexShrink: 0,
                alignSelf: "center",
                padding: "5px 10px",
                borderRadius: 8,
                border: "none",
                background: S.app,
                color: "#fff",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: briefBusy !== null ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: briefBusy !== null && briefBusy !== idx ? 0.5 : 1,
              }}
            >
              {briefBusy === idx ? "Erzeuge Brief…" : "Brief erstellen"}
            </button>
          )}
          {(i.action === "curation" || i.go) && (
            <button
              onClick={() => (i.action === "curation" ? onOpenCuration() : onGo(i.go))}
              style={{
                flexShrink: 0,
                alignSelf: "center",
                padding: "5px 10px",
                borderRadius: 8,
                border: `1px solid ${S.line}`,
                background: S.bg,
                color: S.app,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {i.action === "curation" ? "Prüfen" : "Ansehen"}
            </button>
          )}
        </div>
        {editFp === i.fp && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "flex-end",
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: S.bg,
              border: `1px solid ${S.line}`,
            }}
          >
            <label
              style={{
                fontSize: 10.5,
                color: S.mut,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              Verantwortlich
              {/* Team-Auswahl statt Freitext (21.08.): eindeutig per user_id.
                  Ein bestehender Freitext-Wert bleibt als eigene Option lesbar
                  erhalten, bis bewusst ein Team-Mitglied gewählt wird. */}
              <select
                value={draft.assigneeId}
                onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: S.panel,
                  color: S.txt,
                  border: `1px solid ${S.line}`,
                  fontSize: 12,
                  fontFamily: "inherit",
                  minWidth: 180,
                  maxWidth: 260,
                }}
              >
                <option value="">— niemand —</option>
                {draft.assigneeId === "__legacy__" && (
                  <option value="__legacy__">
                    Bisher (Freitext): {stateFor(i)?.assignee || "?"}
                  </option>
                )}
                {(team || []).map((t) => (
                  <option key={t.user_id} value={t.user_id}>
                    {t.name}
                    {t.email ? ` (${t.email})` : ""}
                  </option>
                ))}
              </select>
              {team !== null && !team.length && (
                <span style={{ color: "#d97706" }}>Team-Liste nicht verfügbar</span>
              )}
            </label>
            <label
              style={{
                fontSize: 10.5,
                color: S.mut,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                flex: 1,
                minWidth: 180,
              }}
            >
              Notiz
              <input
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="z. B. wartet auf Kundeninput"
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: S.panel,
                  color: S.txt,
                  border: `1px solid ${S.line}`,
                  fontSize: 12,
                  fontFamily: "inherit",
                  width: "100%",
                }}
              />
            </label>
            <label
              style={{
                fontSize: 10.5,
                color: S.mut,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              Wiedervorlage
              <input
                type="date"
                value={draft.resurface}
                onChange={(e) => setDraft({ ...draft, resurface: e.target.value })}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: S.panel,
                  color: S.txt,
                  border: `1px solid ${S.line}`,
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <button
              onClick={() => {
                // "__legacy__" = Freitext-Erbe unangetastet lassen; sonst wird
                // eindeutig per user_id gespeichert (Name/E-Mail als Snapshot).
                const patch: Record<string, any> = {
                  note: draft.note,
                  resurface_on: draft.resurface,
                };
                if (draft.assigneeId !== "__legacy__") {
                  const t = teamById.get(draft.assigneeId);
                  patch.assignee_user_id = draft.assigneeId || null;
                  patch.assignee = t ? t.name : null;
                }
                void saveState(i, patch);
                setEditFp(null);
              }}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "none",
                background: S.app,
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Speichern
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: S.mut }}>
          Alles Handlungsrelevante an einem Ort — aus Site Health, KI-Sichtbarkeit und Kuration,
          nach Schwere sortiert. Status, Verantwortliche und Wiedervorlagen bleiben über Messläufe
          hinweg erhalten.
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {(["kritisch", "hoch", "mittel", "niedrig"] as const).map((sv) =>
            counts[sv] ? (
              <span
                key={sv}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 99,
                  padding: "2px 9px",
                  background: SEV_STYLE[sv].bg,
                  color: SEV_STYLE[sv].fg,
                }}
              >
                {counts[sv]} {SEV_STYLE[sv].label}
              </span>
            ) : null,
          )}
          {(
            [
              ["aktiv", `Aktiv (${active.length})`],
              ["faellig", `Fällig (${dueItems.length})`],
              ["archiv", `Erledigt & Verworfen (${done.length + orphaned.length})`],
            ] as Array<["aktiv" | "faellig" | "archiv", string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 99,
                padding: "3px 10px",
                border: `1px solid ${filter === id ? S.app : S.line}`,
                background: filter === id ? S.appTint : "transparent",
                color:
                  filter === id ? S.app : id === "faellig" && dueItems.length ? "#dc2626" : S.mut,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {/* Workflow-Speicher nicht erreichbar: Klartext + Retry; Schreiben ist
          solange gesperrt, die Chancen selbst bleiben lesbar. */}
      {statesErr && (
        <div
          style={{
            ...card,
            borderColor: "#dc262655",
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1, fontSize: 12.5, color: "#dc2626" }}>
            <b>Chancen-Workflow nicht verfügbar:</b> {statesErr}
            <div style={{ color: S.mut, marginTop: 2 }}>
              Status, Verantwortliche und Wiedervorlagen sind bis dahin schreibgeschützt.
            </div>
          </div>
          <button
            onClick={() => {
              setStates(null);
              void loadStates();
            }}
            style={{
              flexShrink: 0,
              padding: "7px 14px",
              borderRadius: 8,
              border: "none",
              background: S.app,
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Erneut versuchen
          </button>
        </div>
      )}
      {/* Teilfehler einzelner Chancenquellen — die übrigen Quellen laufen weiter. */}
      {srcErrors.length > 0 && (
        <div style={{ ...card, borderColor: "#d9770655", fontSize: 12, color: "#d97706" }}>
          <b>
            {srcErrors.length === 1
              ? "Eine Chancenquelle konnte nicht geladen werden"
              : `${srcErrors.length} Chancenquellen konnten nicht geladen werden`}
          </b>{" "}
          — angezeigt wird, was die übrigen Quellen liefern.
          <div
            style={{ color: S.mut, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}
          >
            {srcErrors.map((se, k) => (
              <span key={k}>
                {se.quelle}: {se.msg}
              </span>
            ))}
          </div>
        </div>
      )}
      {err && <div style={{ ...card, color: "#dc2626", fontSize: 12.5 }}>{err}</div>}
      {saveErr && <div style={{ ...card, color: "#dc2626", fontSize: 12.5 }}>{saveErr}</div>}
      {briefErr && <div style={{ ...card, color: "#dc2626", fontSize: 12.5 }}>{briefErr}</div>}
      {!shown.length && !(filter === "archiv" && orphaned.length) ? (
        <div style={{ ...card, textAlign: "center", color: S.mut, fontSize: 13 }}>
          {filter === "archiv"
            ? "Noch nichts erledigt oder verworfen."
            : filter === "faellig"
              ? "Keine fälligen Wiedervorlagen."
              : "🎉 Keine offenen Chancen — alle Signalquellen sind sauber. Neue Chancen erscheinen nach dem nächsten Messlauf/Audit."}
        </div>
      ) : (
        <div style={card}>
          {shown.map(renderRow)}
          {filter === "archiv" &&
            orphaned.map((s: any, idx: number) => (
              <div
                key={s.fingerprint}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 0",
                  borderTop: shown.length || idx ? `1px solid ${S.line}` : "none",
                  opacity: 0.7,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 99,
                    padding: "2px 9px",
                    background: S.bg,
                    color: S.mut,
                    border: `1px solid ${S.line}`,
                  }}
                >
                  Quelle weg
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>
                    {s.title || s.fingerprint}
                  </div>
                  <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>
                    {s.source || "—"}
                    {s.note ? ` · 📝 ${s.note}` : ""}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 700,
                    color: (OPP_STATUS.find((o) => o.id === s.status) || OPP_STATUS[0]).color,
                  }}
                >
                  {(OPP_STATUS.find((o) => o.id === s.status) || OPP_STATUS[0]).label}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Content-Briefs (13.08., Content-Loop) ────────────────────────────────────
// Aus Chancen erzeugte Briefs (content_briefs): Liste via RLS, Status-Zyklus
// Entwurf → In Arbeit → Erledigt, Markdown aufklappbar + kopierbar. Erzeugt
// wird über /api/admin/content-brief (Button an Gap-Chancen).
const BRIEF_STATUS: Array<{ id: string; label: string; color: string }> = [
  { id: "entwurf", label: "Entwurf", color: "#6366f1" },
  { id: "in_arbeit", label: "In Arbeit", color: "#f59e0b" },
  { id: "erledigt", label: "Erledigt", color: "#0f9d6c" },
];
function ContentBriefsPanel({
  clientId,
  S,
  onGoChances,
  focusId,
}: {
  clientId: string;
  S: Record<string, string>;
  onGoChances: () => void;
  focusId?: string | null;
}) {
  const [briefs, setBriefs] = useState<any[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("content_briefs")
      .select("id, title, brief_md, source, status, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    setBriefs(data || []);
  }, [clientId]);
  useEffect(() => {
    setBriefs(null);
    void load();
  }, [load]);
  // Content-Loop (18.08.): ein frisch aus einer Chance erzeugter Brief wird
  // direkt geöffnet — die ID kommt über focusId aus dem "Brief erstellen"-Klick.
  useEffect(() => {
    if (focusId && briefs?.some((b) => b.id === focusId)) setOpenId(focusId);
  }, [focusId, briefs]);
  // Status per eindeutiger Auswahl statt blindem Durchschalten (18.08.).
  const setStatus = async (b: any, next: string) => {
    await (supabase as any)
      .from("content_briefs")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", b.id);
    void load();
  };
  const copy = async (b: any) => {
    try {
      await navigator.clipboard.writeText(b.brief_md);
      setCopied(b.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* Clipboard optional */
    }
  };
  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  if (briefs === null)
    return <div style={{ ...card, color: S.mut, fontSize: 13 }}>Briefs werden geladen…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: S.mut }}>
        Redaktionsfertige Content-Briefs aus KI-Chancen — erzeugt mit echten Nutzerfragen,
        Konkurrenz-Kontext und KI-Folgefragen. Ziel: Inhalte, die von KI-Systemen zitiert werden.
      </div>
      {!briefs.length ? (
        <div style={{ ...card, textAlign: "center", color: S.mut, fontSize: 13 }}>
          Noch keine Briefs. Unter{" "}
          <button
            onClick={onGoChances}
            style={{
              color: S.app,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              padding: 0,
            }}
          >
            Chancen
          </button>{" "}
          bei einem KI-Zitat-Gap auf „Brief erstellen" klicken.
        </div>
      ) : (
        <div style={card}>
          {briefs.map((b, i) => {
            const st = BRIEF_STATUS.find((s) => s.id === b.status) || BRIEF_STATUS[0];
            return (
              <div
                key={b.id}
                style={{ padding: "10px 0", borderTop: i ? `1px solid ${S.line}` : "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => setOpenId(openId === b.id ? null : b.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      padding: 0,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: S.txt }}>
                      <span
                        style={{
                          display: "inline-block",
                          transform: openId === b.id ? "rotate(90deg)" : "none",
                          transition: "transform .15s",
                          marginRight: 6,
                        }}
                      >
                        ▸
                      </span>
                      {b.title}
                    </div>
                    <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>
                      {new Date(b.created_at).toLocaleDateString("de-CH")}
                      {b.source?.rival ? ` · vs. ${b.source.rival}` : ""}
                      {b.source?.questions?.length
                        ? ` · ${b.source.questions.length} echte Fragen`
                        : ""}
                    </div>
                  </button>
                  <button
                    onClick={() => copy(b)}
                    style={{
                      flexShrink: 0,
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: `1px solid ${S.line}`,
                      background: S.bg,
                      color: copied === b.id ? "#0f9d6c" : S.mut,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {copied === b.id ? "✓ kopiert" : "Kopieren"}
                  </button>
                  <select
                    value={st.id}
                    onChange={(e) => void setStatus(b, e.target.value)}
                    title="Status wählen"
                    style={{
                      flexShrink: 0,
                      padding: "4px 10px",
                      borderRadius: 99,
                      border: `1px solid ${st.color}55`,
                      background: `${st.color}18`,
                      color: st.color,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {BRIEF_STATUS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                {openId === b.id && (
                  <div style={{ margin: "10px 0 0" }}>
                    {/* Herkunft des Briefs: Anlass, Rival, echte Nutzerfragen, Datum. */}
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        background: S.appTint,
                        border: `1px solid ${S.line}`,
                        fontSize: 11.5,
                        color: S.txt,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div>
                        <b>Quelle:</b> {b.source?.thema || "—"}
                        {b.source?.rival ? (
                          <>
                            {" "}
                            · <b>Wettbewerber:</b> {b.source.rival}
                          </>
                        ) : null}
                        {" · "}
                        <b>Erstellt:</b>{" "}
                        {new Date(b.created_at).toLocaleDateString("de-CH", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                        {b.source?.fanoutCount ? (
                          <> · {b.source.fanoutCount} KI-Folgefragen eingeflossen</>
                        ) : null}
                      </div>
                      {Array.isArray(b.source?.questions) && b.source.questions.length > 0 && (
                        <div style={{ color: S.mut }}>
                          <b style={{ color: S.txt }}>Echte Nutzerfragen:</b>{" "}
                          {b.source.questions.map((q: any) => `„${String(q?.q ?? q)}"`).join(" · ")}
                        </div>
                      )}
                    </div>
                    <pre
                      style={{
                        margin: "8px 0 0",
                        padding: 14,
                        borderRadius: 10,
                        background: S.bg,
                        border: `1px solid ${S.line}`,
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: S.txt,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        overflowX: "auto",
                      }}
                    >
                      {b.brief_md}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Aufteilung 13.08. (Volkan, Screenshot-Feedback): Site Health = Scores +
// Seiten + Check-Tabellen (ohne Problem-Liste, nur Verweis), Issues = NUR die
// Problem-Liste. Beide lesen denselben letzten Audit.
function SiteHealthPanel({
  clientId,
  S,
  mode,
  onGoIssues,
}: {
  clientId: string;
  S: Record<string, string>;
  mode: "health" | "issues";
  onGoIssues?: () => void;
}) {
  const [audit, setAudit] = useState<any | undefined>(undefined); // undefined = lädt, null = keiner
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  const call = useCallback(
    async (method: "GET" | "POST", auditMode?: "quick" | "deep") => {
      const session = (await supabase.auth.getSession()).data.session;
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      };
      let url = `/api/admin/site-health?client=${encodeURIComponent(clientId)}`;
      if (method === "POST") {
        url = "/api/admin/site-health";
        init.headers = { ...init.headers, "Content-Type": "application/json" };
        init.body = JSON.stringify({ client: clientId, mode: auditMode || "quick" });
      }
      const r = await fetch(url, init);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j.audit ?? null;
    },
    [clientId],
  );

  useEffect(() => {
    let alive = true;
    setAudit(undefined);
    setErr("");
    call("GET")
      .then((a) => {
        if (alive) setAudit(a);
      })
      .catch((e) => {
        if (alive) {
          setErr(String(e?.message || e));
          setAudit(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [call]);

  const [runningMode, setRunningMode] = useState<"quick" | "deep" | null>(null);
  const runAudit = async (auditMode: "quick" | "deep") => {
    setRunning(true);
    setRunningMode(auditMode);
    setErr("");
    try {
      setAudit(await call("POST", auditMode));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setRunning(false);
      setRunningMode(null);
    }
  };

  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const issues = audit?.issues || [];
  const checks = audit?.checks || [];
  const pillars: Array<[string, string]> = [
    ["technical", "Technik"],
    ["content", "Inhalt"],
    ["aeo", "AI-Readiness"],
  ];

  // Problem-Liste (13.08. in den Issues-Tab verschoben, Volkan).
  const issuesCard = (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 10 }}>
        {issues.length
          ? `${issues.length} ${issues.length === 1 ? "Problem" : "Probleme"} gefunden`
          : "Keine Probleme gefunden 🎉"}
      </div>
      {issues.map((i: any) => {
        const sv = SEV_STYLE[i.severity] || SEV_STYLE.niedrig;
        return (
          <div
            key={i.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "9px 0",
              borderTop: `1px solid ${S.line}`,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 99,
                padding: "2px 9px",
                background: sv.bg,
                color: sv.fg,
              }}
            >
              {sv.label}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>
                {i.label} <span style={{ fontWeight: 400, color: S.mut }}>— {i.detail}</span>
              </div>
              <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{i.tipp}</div>
              {Array.isArray(i.pages) && i.pages.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {i.pages.slice(0, 6).map((p: string) => (
                    <span
                      key={p}
                      style={{
                        fontSize: 10,
                        color: S.mut,
                        border: `1px solid ${S.line}`,
                        borderRadius: 6,
                        padding: "1px 6px",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p}
                    </span>
                  ))}
                  {i.pages.length > 6 && (
                    <span style={{ fontSize: 10, color: S.mut }}>
                      +{i.pages.length - 6} weitere
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {mode === "health" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => runAudit("quick")}
            disabled={running}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "none",
              cursor: running ? "default" : "pointer",
              background: S.app,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running && runningMode === "quick" ? "Quick-Audit läuft… (~10 s)" : "Quick-Audit"}
          </button>
          <button
            onClick={() => runAudit("deep")}
            disabled={running}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: `1px solid ${S.app}`,
              cursor: running ? "default" : "pointer",
              background: "transparent",
              color: S.app,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running && runningMode === "deep"
              ? "Tiefen-Audit läuft… (~2 Min)"
              : "Tiefen-Audit (bis 50 Seiten)"}
          </button>
          {audit?.at && (
            <span style={{ fontSize: 12, color: S.mut }}>
              Letzter Audit: {new Date(audit.at).toLocaleString("de-CH")} · {audit.url}
              {audit.mode === "deep" && Array.isArray(audit.pages) && audit.pages.length > 1
                ? ` · ${audit.pages.length} Seiten`
                : " · Startseite"}
            </span>
          )}
          {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
        </div>
      )}

      {audit === undefined ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade letzten Audit…</div>
      ) : !audit ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🩺</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>
            Noch kein Audit für diesen Kunden
          </div>
          <div style={{ fontSize: 13, color: S.mut }}>
            {mode === "issues"
              ? "Im Tab «Site Health» einen Quick- oder Tiefen-Audit starten — die gefundenen Probleme erscheinen dann hier."
              : "Quick-Audit prüft Startseite, robots.txt, Sitemap und AI-Readiness (~10 s); der Tiefen-Audit nimmt bis zu 50 Unterseiten aus der Sitemap dazu (~2 Min). Beides ohne Zusatzkosten."}
          </div>
        </div>
      ) : mode === "issues" ? (
        /* Issues-Tab (13.08.): NUR die Problem-Liste. */
        <>
          {audit?.at && (
            <div style={{ fontSize: 12, color: S.mut }}>
              Stand: {new Date(audit.at).toLocaleString("de-CH")} · {audit.url}
              {audit.mode === "deep" && Array.isArray(audit.pages) && audit.pages.length > 1
                ? ` · ${audit.pages.length} Seiten geprüft`
                : " · Startseite"}
            </div>
          )}
          {issuesCard}
        </>
      ) : (
        <>
          {/* Score-Karten */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            {[["overall", "Gesamt-Score"], ...pillars].map(([k, label]) => {
              const v = audit.scores?.[k] ?? 0;
              return (
                <div key={k} style={card}>
                  <div
                    style={{
                      fontSize: 11,
                      color: S.mut,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        color: scoreColor(v),
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {v}
                    </span>
                    <span style={{ fontSize: 11.5, color: S.mut }}>/ 100 · {scoreLabel(v)}</span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 99,
                      background: S.line,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${v}%`,
                        height: "100%",
                        borderRadius: 99,
                        background: scoreColor(v),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Problem-Verweis (13.08.): Liste lebt im Issues-Tab. */}
          {issues.length > 0 && (
            <button
              onClick={onGoIssues}
              style={{
                ...card,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                width: "100%",
              }}
            >
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: S.txt }}>
                {issues.length} {issues.length === 1 ? "Problem" : "Probleme"} gefunden
              </span>
              <span style={{ fontSize: 12, color: S.mut }}>— Details im Tab «Issues»</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: S.app }}>
                Ansehen →
              </span>
            </button>
          )}

          {/* Seiten-Tabelle (Tiefen-Audit) */}
          {Array.isArray(audit.pages) && audit.pages.length > 1 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 8 }}>
                Geprüfte Seiten · {audit.pages.length}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        color: S.mut,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "5px 8px" }}>Seite</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Score</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Probleme</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>HTTP</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Zeit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.pages]
                      .sort((a: any, b: any) => a.score - b.score)
                      .map((p: any) => (
                        <tr key={p.path} style={{ borderTop: `1px solid ${S.line}` }}>
                          <td
                            style={{
                              padding: "6px 8px",
                              maxWidth: 340,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: S.txt,
                            }}
                            title={p.title || p.path}
                          >
                            {p.path}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: scoreColor(p.score),
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.score}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: p.issues ? S.txt : S.mut,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.issues || "—"}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: p.status === 200 ? S.mut : "#dc2626",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.status}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: S.mut,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.ms} ms
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Check-Tabellen je Säule (nur im Site-Health-Modus) */}
          {mode === "health" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 16,
              }}
            >
              {pillars.map(([p, label]) => (
                <div key={p} style={card}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: S.txt, marginBottom: 8 }}>
                    {label} · {audit.scores?.[p] ?? 0}/100
                  </div>
                  {checks
                    .filter((c: any) => c.pillar === p)
                    .map((c: any) => (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "baseline",
                          fontSize: 12,
                          padding: "4px 0",
                          borderTop: `1px solid ${S.line}`,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>
                          {c.status === "ok" ? "✅" : c.status === "warn" ? "⚠️" : "❌"}
                        </span>
                        <span style={{ flex: 1, color: S.txt }}>{c.label}</span>
                        <span
                          style={{
                            color: S.mut,
                            fontSize: 11,
                            textAlign: "right",
                            maxWidth: 150,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.detail}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: S.mut }}>
            Basis: robots.txt, llms.txt, Sitemap und{" "}
            {audit.mode === "deep" ? "die geprüften Seiten" : "die Startseite"} — Gewichtung Technik
            30 % · Inhalt 35 % · AI-Readiness 35 %. Umsetzung der Fixes läuft wie gewohnt über die
            SEO-Agenten mit Freigabe.
          </div>
        </>
      )}
    </div>
  );
}

// ── Prompt-Kuration (Searchable-Nachbau 08/2026) ─────────────────────────────
// Vorgeschlagen (needs_review) annehmen/ablehnen, Aktiv/Archiviert schalten —
// Archivieren stoppt Messkosten ohne Datenverlust. Schreibt direkt auf
// ai_visibility_prompt_defs (RLS: Org-Mitglieder dürfen pflegen).
type PromptDef = {
  id: string;
  prompt: string;
  topic: string | null;
  intent: string | null;
  active: boolean;
  needs_review: boolean;
  prompt_type: string | null;
};

// ── Brand-Facts-Kuration (11.08., Searchable "Brand Facts"-Parität) ──────────
// Das Faktenprofil ist die Abgleichsbasis des Brand-Judge (Faktentreue/
// Halluzinations-Erkennung). Bisher rein maschinell generiert — hier prüft
// und korrigiert es ein Mensch; Bestätigen setzt needs_review=false.
function BrandFactsEditor({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<null | {
    angebot: string;
    ort: string;
    kernfakten: string;
    needsReview: boolean;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch(`/api/admin/brand-facts?client=${encodeURIComponent(clientId)}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok)
      setState({
        angebot: String(j.facts?.angebot || ""),
        ort: String(j.facts?.ort || ""),
        kernfakten: (Array.isArray(j.facts?.kernfakten) ? j.facts.kernfakten : []).join("\n"),
        needsReview: !!j.needsReview,
      });
  }, [clientId]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (!state) return;
    setBusy(true);
    setMsg("");
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch("/api/admin/brand-facts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token || ""}`,
      },
      body: JSON.stringify({
        client: clientId,
        facts: {
          angebot: state.angebot,
          ort: state.ort,
          kernfakten: state.kernfakten
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.ok) {
      setState((s) => (s ? { ...s, needsReview: false } : s));
      setMsg("Profil bestätigt — der Fakten-Check nutzt ab jetzt diese Fassung.");
    } else setMsg(j.error || "Speichern fehlgeschlagen");
  };
  if (!state) return null;
  const inp: any = {
    width: "100%",
    padding: "7px 10px",
    borderRadius: 8,
    background: S.bg,
    color: S.txt,
    border: `1px solid ${S.line}`,
    fontSize: 12.5,
    fontFamily: "inherit",
  };
  return (
    <div style={{ borderBottom: `1px solid ${S.line}`, padding: "10px 18px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          color: S.txt,
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        <span
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .15s",
            display: "inline-flex",
          }}
        >
          ▸
        </span>
        Faktenprofil (Grundlage des Fakten-Checks)
        {state.needsReview && (
          <span
            style={{
              marginLeft: 6,
              borderRadius: 99,
              padding: "2px 8px",
              fontSize: 10.5,
              fontWeight: 700,
              background: "#fdf6e3",
              color: "#8a6d1b",
              border: "1px solid #f0c36d",
            }}
          >
            zur Prüfung
          </span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: S.mut }}>
            Gegen dieses Profil prüft der Marken-Check, ob KI-Antworten über die Firma faktisch
            stimmen. Automatisch generiert — bitte prüfen, korrigieren, bestätigen.
          </div>
          <label style={{ fontSize: 11, color: S.mut }}>
            Angebot
            <input
              value={state.angebot}
              onChange={(e) => setState({ ...state, angebot: e.target.value })}
              style={inp}
            />
          </label>
          <label style={{ fontSize: 11, color: S.mut }}>
            Standort(e)
            <input
              value={state.ort}
              onChange={(e) => setState({ ...state, ort: e.target.value })}
              style={inp}
            />
          </label>
          <label style={{ fontSize: 11, color: S.mut }}>
            Kernfakten (eine je Zeile, max. 12)
            <textarea
              value={state.kernfakten}
              onChange={(e) => setState({ ...state, kernfakten: e.target.value })}
              rows={5}
              style={{ ...inp, resize: "vertical" }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={save}
              disabled={busy}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "none",
                cursor: busy ? "default" : "pointer",
                background: S.app,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: "inherit",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Speichert…" : "Profil bestätigen"}
            </button>
            {msg && (
              <span
                style={{
                  fontSize: 11.5,
                  color: msg.startsWith("Profil bestätigt") ? "#0f9d6c" : "#dc2626",
                }}
              >
                {msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Frage-Mining (12.08., DataForSEO search_scope "question") ────────────────
// Echte Nutzerfragen aus dem Schweizer KI-Korpus zu den Kernbegriffen des
// Kunden — als belegte Prompt-Kandidaten. "Übernehmen" legt die Frage als
// Vorschlag (needs_review=true) an; Freigabe läuft über den normalen
// Kurations-Weg. Lazy geladen (7-Tage-Cache serverseitig).
function CorpusQuestionsSection({
  clientId,
  S,
  onAdded,
}: {
  clientId: string;
  S: Record<string, string>;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<null | { questions: any[]; terms: string[] }>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!open || state) return;
    let alive = true;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&questions=1`,
          {
            headers: { Authorization: `Bearer ${session?.access_token || ""}` },
          },
        );
        const j = await r.json().catch(() => ({}));
        if (alive)
          setState(
            j.ok
              ? { questions: j.questions || [], terms: j.terms || [] }
              : { questions: [], terms: [] },
          );
      } catch {
        if (alive) setState({ questions: [], terms: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, state, clientId]);
  const take = async (q: { q: string; term: string }) => {
    setBusy(q.q);
    const { error } = await (supabase as any).from("ai_visibility_prompt_defs").insert({
      client_id: clientId,
      prompt: q.q,
      topic: q.term,
      active: false,
      needs_review: true,
      prompt_type: "markt",
    });
    setBusy("");
    if (!error) {
      setAdded((s) => new Set(s).add(q.q));
      onAdded();
    }
  };
  return (
    <div style={{ borderBottom: `1px solid ${S.line}`, padding: "10px 18px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          color: S.txt,
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        <span
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .15s",
            display: "inline-flex",
          }}
        >
          ▸
        </span>
        Echte Nutzerfragen aus dem KI-Korpus
        <span style={{ fontWeight: 400, fontSize: 11, color: S.mut }}>
          — belegte Prompt-Kandidaten statt nur generierter
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {state === null ? (
            <div style={{ fontSize: 11.5, color: S.mut }}>
              Korpus-Fragen werden geladen… (erster Abruf bis ~30 s)
            </div>
          ) : !state.questions.length ? (
            <div style={{ fontSize: 11.5, color: S.mut }}>
              Keine passenden Fragen im Schweizer Korpus gefunden.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: S.mut, marginBottom: 8 }}>
                Fragen, die Nutzer laut DataForSEO-Korpus wirklich an KI-Systeme stellen
                (Kernbegriffe: {state.terms.join(", ")}). „Übernehmen" legt sie unter
                „Vorgeschlagen" ab.
              </div>
              {state.questions.map((q: any) => (
                <div
                  key={q.q}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 0",
                    borderTop: `1px solid ${S.line}`,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: S.txt }}>{q.q}</span>
                  {q.vol > 0 && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        color: S.mut,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      Vol. {q.vol}
                    </span>
                  )}
                  <button
                    onClick={() => take(q)}
                    disabled={added.has(q.q) || busy === q.q}
                    style={{
                      flexShrink: 0,
                      padding: "3px 10px",
                      borderRadius: 7,
                      border: `1px solid ${added.has(q.q) ? S.line : S.app}`,
                      background: added.has(q.q) ? "transparent" : S.appTint,
                      color: added.has(q.q) ? S.mut : S.app,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: added.has(q.q) ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {added.has(q.q) ? "✓ übernommen" : busy === q.q ? "…" : "Übernehmen"}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Seit 18.08. KEINE Schublade mehr, sondern der reguläre Bereich "Your Prompts"
// (Sidebar → Prompts): Kuration, echte Nutzerfragen und Faktenprofil an einem
// Ort — die frühere Doppel-Navigation (Sidebar-Button + Overlay) ist weg.
function PromptCurationPanel({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [defs, setDefs] = useState<PromptDef[] | null>(null);
  const [view, setView] = useState<"review" | "active" | "archived">("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("ai_visibility_prompt_defs")
      .select("id, prompt, topic, intent, active, needs_review, prompt_type")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setDefs((data ?? []) as PromptDef[]);
  }, [clientId]);
  useEffect(() => {
    void load();
  }, [load]);

  const update = async (id: string, patch: Partial<PromptDef>) => {
    setBusy(id);
    setErr(null);
    const { error } = await (supabase as any)
      .from("ai_visibility_prompt_defs")
      .update(patch)
      .eq("id", id);
    if (error) setErr(error.message);
    await load();
    setBusy(null);
  };

  const all = defs ?? [];
  const groups = {
    review: all.filter((d) => d.needs_review),
    active: all.filter((d) => d.active && !d.needs_review),
    archived: all.filter((d) => !d.active && !d.needs_review),
  };
  const rows = groups[view];
  const tabBtn = (
    id: "review" | "active" | "archived",
    label: string,
    n: number,
    warn?: boolean,
  ) => (
    <button
      key={id}
      onClick={() => setView(id)}
      style={{
        padding: "5px 12px",
        borderRadius: 99,
        fontSize: 12,
        cursor: "pointer",
        border: `1px solid ${view === id ? S.app : S.line}`,
        background: view === id ? S.appTint : "transparent",
        color: view === id ? S.app : warn && n > 0 ? "#fbbf24" : S.mut,
      }}
    >
      {label} {n}
    </button>
  );

  return (
    <div
      style={{
        background: S.panel,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          borderBottom: `1px solid ${S.line}`,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {tabBtn("review", "Vorgeschlagen", groups.review.length, true)}
          {tabBtn("active", "Aktiv", groups.active.length)}
          {tabBtn("archived", "Archiviert", groups.archived.length)}
        </div>
      </div>
      <div
        style={{
          padding: "8px 18px",
          fontSize: 11,
          color: S.mut,
          borderBottom: `1px solid ${S.line}`,
        }}
      >
        Nur <b style={{ color: S.txt }}>aktive</b> Prompts laufen im Messzyklus (Kosten!).
        Archivieren behält die Historie. „Vorgeschlagen" = vom Seeder/Relevanz-Audit zur Prüfung
        markiert.
      </div>
      <BrandFactsEditor clientId={clientId} S={S} />
      <CorpusQuestionsSection clientId={clientId} S={S} onAdded={() => void load()} />
      {err && (
        <div
          style={{
            margin: "10px 18px 0",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #f8717155",
            color: "#f87171",
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ padding: "10px 18px 24px" }}>
        {defs === null ? (
          <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Lade…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>
            Keine Einträge in dieser Ansicht.
          </div>
        ) : (
          rows.map((d) => (
            <div
              key={d.id}
              style={{
                border: `1px solid ${S.line}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 8,
                background: S.panel,
              }}
            >
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{d.prompt}</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                {d.topic && (
                  <span
                    style={{
                      fontSize: 10.5,
                      color: S.mut,
                      border: `1px solid ${S.line}`,
                      borderRadius: 99,
                      padding: "2px 8px",
                    }}
                  >
                    {d.topic}
                  </span>
                )}
                {d.intent && (
                  <span
                    style={{
                      fontSize: 10.5,
                      color: S.mut,
                      border: `1px solid ${S.line}`,
                      borderRadius: 99,
                      padding: "2px 8px",
                    }}
                  >
                    {d.intent}
                  </span>
                )}
                {d.prompt_type === "brand" && (
                  <span
                    style={{
                      fontSize: 10.5,
                      color: "#a78bfa",
                      border: "1px solid #a78bfa55",
                      borderRadius: 99,
                      padding: "2px 8px",
                    }}
                  >
                    Marken-Check
                  </span>
                )}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {d.needs_review ? (
                    <>
                      <button
                        disabled={busy === d.id}
                        onClick={() => update(d.id, { needs_review: false, active: true })}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 8,
                          fontSize: 11.5,
                          cursor: "pointer",
                          border: `1px solid ${S.app}`,
                          background: "transparent",
                          color: S.app,
                        }}
                      >
                        ✓ Annehmen
                      </button>
                      <button
                        disabled={busy === d.id}
                        onClick={() => update(d.id, { needs_review: false, active: false })}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 8,
                          fontSize: 11.5,
                          cursor: "pointer",
                          border: `1px solid ${S.line}`,
                          background: "transparent",
                          color: S.mut,
                        }}
                      >
                        Archivieren
                      </button>
                    </>
                  ) : d.active ? (
                    <button
                      disabled={busy === d.id}
                      onClick={() => update(d.id, { active: false })}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 8,
                        fontSize: 11.5,
                        cursor: "pointer",
                        border: `1px solid ${S.line}`,
                        background: "transparent",
                        color: S.mut,
                      }}
                    >
                      Archivieren
                    </button>
                  ) : (
                    <button
                      disabled={busy === d.id}
                      onClick={() => update(d.id, { active: true })}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 8,
                        fontSize: 11.5,
                        cursor: "pointer",
                        border: `1px solid ${S.app}`,
                        background: "transparent",
                        color: S.app,
                      }}
                    >
                      Aktivieren
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Agentur-Übersicht (Volkan 10.08., analog EzyRank) ────────────────────────
// "Alle Kunden": alle berechtigten Kunden als anklickbare Kacheln mit
// KI-Sichtbarkeit / Erwähnungen / Citations aus dem jeweils neuesten
// ai_visibility_report. Batch: EINE Query über alle Kunden-IDs.
function AiAgencyOverview({
  clients,
  onSelect,
  S,
}: {
  clients: any[];
  onSelect: (id: string) => void;
  S: Record<string, string>;
}) {
  const [stats, setStats] = useState<
    Record<string, { score: number; mentions: number; citations: number; date: string }>
  >({});
  useEffect(() => {
    let alive = true;
    const ids = clients.map((c: any) => c.id).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("ai_visibility_reports")
        .select("client_id, snapshot_date, score, mentions, citations")
        .in("client_id", ids)
        .order("snapshot_date", { ascending: false })
        .limit(400);
      if (!alive) return;
      const next: Record<
        string,
        { score: number; mentions: number; citations: number; date: string }
      > = {};
      for (const r of data ?? []) {
        if (next[r.client_id]) continue; // erste Zeile = neuester Snapshot je Kunde
        next[r.client_id] = {
          score: Number(r.score ?? 0),
          mentions: Number(r.mentions ?? 0),
          citations: Number(r.citations ?? 0),
          date: String(r.snapshot_date || ""),
        };
      }
      setStats(next);
    })();
    return () => {
      alive = false;
    };
  }, [clients]);
  // Alphabetisch — Kundenreihenfolge ist überall gleich (Volkan 13.08.).
  const tiles = [...clients].sort((a: any, b: any) =>
    String(a.name).localeCompare(String(b.name), "de-CH", { sensitivity: "base" }),
  );
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "0 2px 12px",
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: S.txt }}>Kunden</h2>
        <span style={{ fontSize: 12, color: S.mut }}>{clients.length} berechtigt</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {tiles.map((c: any) => {
          const st = stats[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              style={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                background: S.panel,
                border: `1px solid ${S.line}`,
                borderRadius: 14,
                padding: 16,
                cursor: "pointer",
                fontFamily: "inherit",
                color: S.txt,
                transition: "border-color .15s, box-shadow .15s, transform .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = S.app;
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,.08)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = S.line;
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
                  bg={S.appTint}
                  fg={S.app}
                  fontSize={13}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
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
                      color: S.mut,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.domain || "keine Domain"}
                  </div>
                </div>
                {st?.date && (
                  <span
                    title={`Letzter Messlauf: ${st.date}`}
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      color: S.mut,
                      border: `1px solid ${S.line}`,
                      borderRadius: 999,
                      padding: "3px 8px",
                    }}
                  >
                    {st.date.slice(8, 10)}.{st.date.slice(5, 7)}.
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[
                  { label: "KI-Sichtbarkeit", value: st ? `${st.score}/100` : null },
                  { label: "Erwähnungen", value: st ? st.mentions.toLocaleString("de-CH") : null },
                  { label: "Citations", value: st ? st.citations.toLocaleString("de-CH") : null },
                ].map((m) => (
                  <div key={m.label}>
                    <div
                      style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
                    >
                      {m.value ?? "—"}
                    </div>
                    <div style={{ fontSize: 10, color: S.mut }}>{m.label}</div>
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

export const Route = createFileRoute("/ezyai")({
  component: EzyAiApp,
});

// Plattform-Umbau Phase 2 (2026-07-31): EzyAI als erste eigenständige App.
// Die Fach-Komponente (AiVisibilityTab) ist aus dem Dashboard UMGEZOGEN, nicht
// neu gebaut — diese Route liefert nur die App-Shell drumherum (Header mit
// App-Switcher, Kunden-Auswahl, Service-Gate). Muster für Phase 3.
// Ezy One CD (2026-08-10): Pale Gray mit Purple-Bias, Purple #77008C als Akzent.
// Redesign 1b (21.08.): Hi-Fi-Tokens — EzyAI-App-Farbe #7c3aed fuer die
// Segmented-Auszeichnung, Marken-Purple bleibt fuer Aktionen.
const S = {
  bg: "#FCFCFC",
  panel: "#ffffff",
  line: "rgba(43,0,51,.08)",
  txt: "#0D0D0D",
  mut: "#5d5563",
  app: "#77008C",
  appTint: "rgba(119,0,140,.10)",
  navAccent: "#7c3aed",
  navDim: "rgba(124,58,237,.10)",
};
const SIDEBAR_W = 210;

// Redesign 1b (2h): Stil eines Bottom-Tab-Bar-Buttons (aktiv = Akzentfarbe).
const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: "2px 0",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: "inherit",
  color: active ? S.navAccent : S.mut,
});
// CD-Pattern: Hexagon-Waben-Mesh als Seiten-Textur, sehr dezent (4% Purple).
const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2377008C' fill-opacity='0.04' fill-rule='evenodd'/%3E%3C/svg%3E")`;
const CLIENT_LS = "ezyai.clientId";

function EzyAiApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role, isOrgAdmin } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const { profile } = useEzyProfile();
  const ezy = useEzyClients();
  const [swOpen, setSwOpen] = useState(false);
  // Native-Mobile (2h): "Heute" ist der Handy-Einstieg (<900px), sonst Dashboard.
  const [view, setView] = useState<"dashboard" | "agent" | "heute">(() =>
    typeof window !== "undefined" && window.innerWidth < 900 ? "heute" : "dashboard",
  );
  const [section, setSection] = useState("aeo-insights"); // aktiver Sidebar-App-Bereich
  // Organic/Ads-Schalter (26.08.): Ads = ChatGPT-Ads-Conversions (OpenAI
  // Conversions API). Eigener Bereichs-State je Modus, Wahl bleibt erhalten.
  const [adsMode, setAdsMode] = useState(() => {
    try {
      return localStorage.getItem("ezyai.mode.v1") === "ads";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ezyai.mode.v1", adsMode ? "ads" : "organic");
    } catch {
      /* egal */
    }
  }, [adsMode]);
  const [adsSection, setAdsSection] = useState("ads-overview");
  // Prompt-Kuration ist seit 18.08. der reguläre Bereich "Your Prompts" —
  // alle früheren "Prompts verwalten"-Einstiege führen hierhin.
  const goPrompts = useCallback(() => {
    setView("dashboard");
    setSection("your-prompts");
  }, []);
  // Zeitraum zentral im Header (Volkan 10.08., Layout wie EzyRank): EINE Quelle
  // für alle Panels, geteilt über alle Apps (Range-Store). Seit 18.08. voll
  // vereinheitlicht: 7/30/90 UND eigene Zeiträume — ein in EzyRank gewählter
  // Kalender-Zeitraum kommt hier exakt an (vorher auf 7/30/90 gerundet).
  const [range, setRange] = useState<ResolvedRange>(() => resolveRange(loadSharedRange()));
  const applyShared = useCallback((r: SharedRange) => {
    saveSharedRange(r);
    setRange(resolveRange(r));
  }, []);
  // Vergleichsperiode (18.08.): Vorperiode/Vorjahr für die Range-Panels
  // (LLM Analytics, Traffic) — die Datenquellen (GA4/Crawler-Log) erlauben es.
  // Content-Loop (18.08.): frisch erzeugter Brief wird im Content-Bereich
  // direkt geöffnet — die ID kommt aus dem "Brief erstellen"-Klick der Chancen.
  const [briefFocus, setBriefFocus] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<"none" | "prevPeriod" | "prevYear">(() => {
    try {
      return (localStorage.getItem("ezyai.compare.v1") as any) || "none";
    } catch {
      return "none";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ezyai.compare.v1", compareMode);
    } catch {
      /* egal */
    }
  }, [compareMode]);
  const compare = useMemo(() => {
    if (compareMode === "prevPeriod") return { ...previousPeriod(range), name: "Vorperiode" };
    if (compareMode === "prevYear") {
      const s = new Date(range.start);
      s.setFullYear(s.getFullYear() - 1);
      const e = new Date(range.end);
      e.setFullYear(e.getFullYear() - 1);
      return { start: s, end: e, name: "Vorjahr" };
    }
    return null;
  }, [range, compareMode]);
  const [clientId, setClientId] = useState(() => {
    try {
      return localStorage.getItem(CLIENT_LS) || "";
    } catch {
      return "";
    }
  });
  // Agentur-Übersicht (10.08.): "Alle Kunden" zeigt Kacheln statt eines Kunden.
  // App-Einstieg (Volkan 11.08., präzisiert): "Alle Kunden" nur beim FRISCHEN
  // Einstieg (Login, App-Wechsel per Link); Reload/Zurück stellt die letzte
  // Auswahl wieder her. Viewer werden ohnehin ins Portal umgeleitet.
  const [showAll, setShowAll] = useState(() => {
    if (isReloadNavigation()) {
      try {
        return localStorage.getItem("ezyai.showAll.v1") !== "0";
      } catch {
        /* egal */
      }
    }
    return true;
  });
  useEffect(() => {
    try {
      localStorage.setItem("ezyai.showAll.v1", showAll ? "1" : "0");
    } catch {
      /* egal */
    }
  }, [showAll]);
  const pickClient = (v: string) => {
    if (v === "__all") {
      setShowAll(true);
      return;
    }
    setClientId(v);
    setShowAll(false);
  };

  useEffect(() => {
    if (!authLoading && !session)
      navigate({ to: "/login", search: { next: "/ezyai" }, replace: true });
  }, [authLoading, session, navigate]);
  useEffect(() => {
    if (!authLoading && role === "viewer") window.location.replace("/dashboard");
  }, [authLoading, role]);
  useEffect(() => {
    // Member ohne EzyAI-Freigabe → zurück zum Launcher (Kachel dort erklärt es)
    if (!accessLoading && session && !canOpen("geo")) window.location.replace("/apps");
  }, [accessLoading, session, canOpen]);

  // Nur Kunden mit aktiver KI-Sichtbarkeit (canonry|perplexity) anbieten (01.08.)
  // + Kunde↔App-Freischaltung (client_app_access, Admin-Umbau 06.08.):
  // in der Zugriffs-Matrix deaktivierte Kunden erscheinen hier nicht.
  const svcMatrix = useEzyServiceMatrix();
  const caa = useClientAppAccess();
  const clients = useMemo(
    () =>
      (ezy.clients || [])
        // Pausierte (= reversibel deaktivierte) Kunden nur im Admin sichtbar.
        .filter((c: any) => c.status !== "paused")
        .filter((c: any) => svcMatrix.hasService(c.id, ["canonry", "perplexity"]))
        .filter((c: any) => appEnabledFor(caa.map, c.id, "geo")),
    [ezy.clients, svcMatrix, caa.map],
  );
  const client = useMemo(
    () => clients.find((c: any) => c.id === clientId) || clients[0] || null,
    [clients, clientId],
  );
  useEffect(() => {
    if (client?.id) {
      try {
        localStorage.setItem(CLIENT_LS, client.id);
      } catch {
        /* egal */
      }
    }
  }, [client?.id]);

  const svc = useEzyServiceSettings(client?.id);
  const aivisOn = svc.loading || svc.enabled?.canonry || svc.enabled?.perplexity;

  if (authLoading || !session || role === "viewer") return null;

  const shareReport = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/public/report", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client!.id, days: 30 }),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && j.url) {
      const full = `${window.location.origin}${j.url}`;
      try {
        await navigator.clipboard.writeText(full);
        alert(`Report-Link kopiert (30 Tage gültig):\n${full}`);
      } catch {
        window.prompt("Report-Link (30 Tage gültig) — kopieren:", full);
      }
    } else alert(j?.error || "Link konnte nicht erstellt werden");
  };

  return (
    <ToastProvider>
      <EzyPilotProvider selectedClient={client} clients={clients} tools={[]}>
        <div
          style={{
            minHeight: "100vh",
            position: "relative",
            isolation: "isolate",
            color: S.txt,
            fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',system-ui,sans-serif",
          }}
        >
          {/* Grund + Pattern als -1-Unterlage, Glow ebenfalls -1 (Fix 10.08. abends:
          Inhalt bleibt unangehoben, Popups/Sidebar-Stacking unverändert). */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              zIndex: -1,
              backgroundColor: S.bg,
              backgroundImage: HEX_BG,
              pointerEvents: "none",
            }}
          />
          <HexGlowLayer />
          {/* Versionsnummer unten rechts (Volkan 13.08.) — EzyAI = Scope "geo". */}
          <AppVersionBadge
            appId="geo"
            palette={{ accent: S.app, text: S.txt, muted: S.mut, border: S.line, card: S.panel }}
          />
          {/* Mobile (04.08.): Shell-Sidebar wird zur horizontalen Leiste oben. */}
          <style>{`
        .ezyai-shell{display:flex;min-height:100vh}
        .ezyai-side{display:none}
        .ezyai-body{flex:1;min-width:0;margin-left:${SIDEBAR_W}px}
        .ezyai-mnav{display:none}
        .ezyai-tabbar{display:none}
        @media(max-width:900px){
          .app-sidebar{display:none!important}
          .ezyai-body{margin-left:0}
          .ezyai-main{padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 84px)!important}
          .ezyai-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:90;justify-content:space-around;align-items:stretch;padding:8px 6px calc(env(safe-area-inset-bottom, 0px) + 8px);background:rgba(252,252,252,.9);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-top:1px solid ${S.line}}
          .ezyai-mnav{display:block;position:sticky;top:0;z-index:40;background:${S.panel};border-bottom:1px solid ${S.line};padding:8px 10px;overflow-x:auto}
          /* Mobile (08.08.): nur die Chip-Nav bleibt sticky — Kopfzeile scrollt
             mit, sonst fressen zwei fixierte Leisten ~110px Viewport-Höhe. */
          .ezyai-chead{flex-wrap:wrap!important;gap:8px!important;padding:10px!important;position:static!important}
          .ezyai-chead-nav{display:none!important}
          .ezyai-hm{display:none!important}
          .ezyai-main{padding:14px 10px 48px!important}
        }
      `}</style>

          <div className="ezyai-shell">
            {/* ── Shell-Seitenleiste (identisch zur EzyRank-Shell) ─────────────── */}
            {/* Redesign 1b: Icon-Rail ersetzt die Sidebar; Kunden-Pill,
              Dashboard/Agent und Bereichs-Segmented leben im Glas-Header. */}
            {/* Desktop-Nav-Umbau (Volkan 22.08.): Sidebar = Haupt-Apps +
              alle EzyAI-Bereiche (Gruppen aus APP_NAV) + Agent, klar getrennt. */}
            <AppRail
              current="geo"
              canOpen={canOpen}
              profile={profile}
              initials={initials(profile.name)}
              onLogout={() => supabase.auth.signOut()}
              railExtra={
                <OrganicAdsSwitch
                  adsMode={adsMode}
                  onChange={(ads) => {
                    setAdsMode(ads);
                    setView("dashboard");
                  }}
                />
              }
              nav={
                showAll
                  ? null
                  : [
                      ...(adsMode ? ADS_NAV : APP_NAV).flatMap((g) =>
                        g.items.map((t) => ({
                          id: `sec:${t.id}`,
                          label: t.badge && t.badge > 0 ? `${t.label} (${t.badge})` : t.label,
                          icon: t.icon,
                          group: g.group,
                          active: view === "dashboard" && (adsMode ? adsSection : section) === t.id,
                          onClick: () => {
                            setView("dashboard");
                            (adsMode ? setAdsSection : setSection)(t.id);
                          },
                        })),
                      ),
                      {
                        // Einheitlich mit EzyRank/EzyPerformance (Volkan 24.08.)
                        id: "view:agent",
                        label: "Ezy Tools",
                        icon: Zap,
                        group: "Werkzeuge",
                        active: view === "agent",
                        onClick: () => setView("agent"),
                      },
                    ]
              }
            />

            {/* ── Content ──────────────────────────────────────────────────────── */}
            <div className="ezyai-body">
              {/* Mobile-Nav (2h): Kunden-Pill + App-Bereiche als Chips.
                Dashboard/Agent + Apps + EzyPilot leben in der Bottom-Tab-Bar. */}
              <div className="ezyai-mnav">
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <select
                    value={showAll ? "__all" : client?.id || ""}
                    onChange={(e) => pickClient(e.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 999,
                      background: "#fff",
                      color: S.txt,
                      border: `1px solid ${S.line}`,
                      fontSize: 12.5,
                      fontWeight: 700,
                      fontFamily: "inherit",
                      maxWidth: "70%",
                    }}
                  >
                    <option value="__all">Alle Kunden</option>
                    {clients.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Bereichs-Chips nur mit gewähltem Kunden — "Alle Kunden" = leer.
                  Ads-Modus (26.08.): eigener Chip-Satz + kompakter Schalter. */}
                <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}>
                  {view !== "heute" && (
                    <OrganicAdsSwitch
                      adsMode={adsMode}
                      onChange={(ads) => {
                        setAdsMode(ads);
                        setView("dashboard");
                      }}
                      compact
                    />
                  )}
                  {!showAll &&
                    view !== "heute" &&
                    (adsMode ? ADS_NAV : APP_NAV)
                      .flatMap((g) => g.items)
                      .map((t) => {
                        const Icon = t.icon;
                        const a = view === "dashboard" && (adsMode ? adsSection : section) === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setView("dashboard");
                              (adsMode ? setAdsSection : setSection)(t.id);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              whiteSpace: "nowrap",
                              padding: "7px 11px",
                              borderRadius: 10,
                              border: "none",
                              cursor: "pointer",
                              background: a ? S.navDim : "transparent",
                              color: a ? S.navAccent : S.mut,
                              fontSize: 12.5,
                              fontWeight: a ? 600 : 400,
                              fontFamily: "inherit",
                            }}
                          >
                            <Icon size={15} />
                            {t.label}
                          </button>
                        );
                      })}
                </div>
              </div>

              {/* Kontext-Kopfzeile: Bereichs-Titel + Aktionen (Kunde ist jetzt in der Sidebar) */}
              <header
                className="ezyai-chead"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 24px",
                  background: "rgba(252,252,252,.72)",
                  backdropFilter: "blur(20px) saturate(180%)",
                  borderBottom: `1px solid ${S.line}`,
                  position: "sticky",
                  top: 0,
                  zIndex: 30,
                }}
              >
                {/* Kunden-Pill + Bereichs-Segmented — auf Mobile ausgeblendet,
                  dort übernimmt die Chip-Leiste (.ezyai-mnav) beides. */}
                <div
                  className="ezyai-chead-nav"
                  style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
                >
                  {/* Kunden-Pill (Hi-Fi ClientSwitcher) — funktional das select */}
                  <select
                    aria-label="Kunde"
                    value={showAll ? "__all" : client?.id || ""}
                    onChange={(e) => pickClient(e.target.value)}
                    style={{
                      appearance: "none",
                      WebkitAppearance: "none",
                      padding: "8px 26px 8px 12px",
                      borderRadius: 10,
                      background:
                        "#fff url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238b8092%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>') no-repeat right 9px center",
                      color: S.txt,
                      border: `1px solid rgba(43,0,51,.09)`,
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "inherit",
                      outline: "none",
                      maxWidth: 210,
                      flexShrink: 0,
                      boxShadow: "0 1px 2px rgba(43,0,51,.04)",
                    }}
                  >
                    <option value="__all">Alle Kunden</option>
                    {clients.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {/* Desktop-Nav-Umbau (Volkan 22.08.): Bereichs-Segmented in
                    die linke Sidebar gewandert (AppRail nav). */}
                </div>
                {/* Filter statt Titel im Header (Volkan 10.08., wie EzyRank) —
                der Bereichs-Titel steht jetzt im Body. */}
                {view !== "agent" && view !== "heute" && !showAll && (
                  <>
                    <RangeControl range={range} onApply={applyShared} S={S} />
                    {/* Vergleich nur dort anbieten, wo die Datenquelle es erlaubt
                    (GA4/Crawler-Log = Range-Panels). Insights ist Snapshot-basiert. */}
                    {!adsMode && (section === "llm-analytics" || section === "traffic") && (
                      <select
                        value={compareMode}
                        onChange={(e) => setCompareMode(e.target.value as any)}
                        title="Vergleichsperiode für die KPI-Karten"
                        style={{
                          padding: "7px 10px",
                          borderRadius: 10,
                          background: S.bg,
                          color: compareMode === "none" ? S.mut : S.app,
                          border: `1px solid ${S.line}`,
                          fontSize: 12,
                          fontFamily: "inherit",
                        }}
                      >
                        <option value="none">Kein Vergleich</option>
                        <option value="prevPeriod">vs. Vorperiode</option>
                        <option value="prevYear">vs. Vorjahr</option>
                      </select>
                    )}
                  </>
                )}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                  {!adsMode && isOrgAdmin && client?.id && !showAll && (
                    <button
                      className="ezyai-hm"
                      onClick={shareReport}
                      style={{
                        fontSize: 12,
                        color: S.app,
                        background: "none",
                        cursor: "pointer",
                        border: `1px solid ${S.app}55`,
                        borderRadius: 8,
                        padding: "6px 12px",
                      }}
                    >
                      Report teilen
                    </button>
                  )}
                  {!adsMode && (
                    <a
                      className="ezyai-hm"
                      href="/llm-ueberblick"
                      style={{
                        fontSize: 12,
                        color: S.mut,
                        textDecoration: "none",
                        border: `1px solid ${S.line}`,
                        borderRadius: 8,
                        padding: "6px 12px",
                      }}
                    >
                      LLM-Überblick
                    </a>
                  )}
                  <NotificationsBell S={S} />
                  {/* EzyPilot oben rechts — wie in EzyRank/EzyPerformance (Volkan 13.08.);
                    mobil versteckt (FAB in der Bottom-Bar). */}
                  <span className="ezyai-hm" style={{ display: "inline-flex" }}>
                    <EzyPilotButton />
                  </span>
                </div>
              </header>

              <main
                className="ezyai-main"
                style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 22px 60px" }}
              >
                {/* Bereichs-Titel im Body (Volkan 10.08., Layout wie EzyRank). */}
                {view !== "agent" && view !== "heute" && (
                  <div style={{ marginBottom: 20 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                      {showAll
                        ? adsMode
                          ? "ChatGPT Ads"
                          : "Agentur-Übersicht"
                        : adsMode
                          ? adsSection === "ads-overview"
                            ? "ChatGPT Ads"
                            : NAV_LABEL[adsSection] || "ChatGPT Ads"
                          : NAV_LABEL[section] || "Insights"}
                    </h1>
                    {!showAll && client && (
                      <div style={{ fontSize: 13, color: S.mut, marginTop: 4 }}>
                        {client.name}
                        {(client as { domain?: string }).domain
                          ? ` — ${(client as { domain?: string }).domain}`
                          : ""}{" "}
                        • {range.label}
                      </div>
                    )}
                  </div>
                )}
                {view === "heute" ? (
                  <EzyaiHeuteHome
                    client={client}
                    showAll={showAll}
                    profileName={profile.name}
                    onSection={(id) => {
                      setAdsMode(false); // Heute-Schnellzugriff zielt auf Organic-Bereiche
                      setView("dashboard");
                      setSection(id);
                    }}
                  />
                ) : view === "agent" ? (
                  <div
                    style={{
                      background: S.panel,
                      border: `1px solid ${S.line}`,
                      borderRadius: 14,
                      padding: 40,
                      textAlign: "center",
                      maxWidth: 560,
                      margin: "40px auto 0",
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 14,
                        background: S.appTint,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 14px",
                      }}
                    >
                      <Sparkles size={26} color={S.app} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>EzyPilot</div>
                    <div style={{ fontSize: 13, color: S.mut, lineHeight: 1.5, marginBottom: 18 }}>
                      Der KI-Assistent für Daten- und Portal-Fragen, Agenten-Bau und das
                      Obsidian-Gedächtnis{client ? ` — im Kontext von ${client.name}` : ""}.
                    </div>
                    <a
                      href="/pilot"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 18px",
                        borderRadius: 10,
                        background: S.app,
                        color: "#fff",
                        textDecoration: "none",
                        fontSize: 13.5,
                        fontWeight: 600,
                      }}
                    >
                      <Bot size={16} /> EzyPilot öffnen
                    </a>
                  </div>
                ) : ezy.loading && !clients.length ? (
                  <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
                    Lade Kunden…
                  </div>
                ) : showAll ? (
                  adsMode ? (
                    <div
                      style={{
                        background: S.panel,
                        border: `1px solid ${S.line}`,
                        borderRadius: 14,
                        padding: 40,
                        textAlign: "center",
                        maxWidth: 560,
                        margin: "40px auto 0",
                      }}
                    >
                      <div style={{ fontSize: 30, marginBottom: 12 }}>📣</div>
                      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                        ChatGPT Ads — Kunde wählen
                      </div>
                      <div style={{ fontSize: 13, color: S.mut }}>
                        Conversion-Tracking und Event-Log gibt es je Kunde — oben links einen Kunden
                        auswählen.
                      </div>
                    </div>
                  ) : (
                    <AiAgencyOverview clients={clients} S={S} onSelect={pickClient} />
                  )
                ) : !client ? (
                  <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
                    Keine Kunden zugewiesen.
                  </div>
                ) : adsMode ? (
                  <Suspense
                    fallback={
                      <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
                        Lade ChatGPT Ads…
                      </div>
                    }
                  >
                    <EzyAiAdsPanel
                      clientId={client.id}
                      clientName={client.name}
                      section={adsSection}
                      range={range}
                      S={S}
                      isOrgAdmin={!!isOrgAdmin}
                    />
                  </Suspense>
                ) : section === "llm-analytics" ? (
                  <LlmAnalyticsPanel clientId={client.id} S={S} range={range} compare={compare} />
                ) : section === "traffic" ? (
                  <TrafficPanel clientId={client.id} S={S} range={range} compare={compare} />
                ) : section === "site-health" || section === "issues" ? (
                  <SiteHealthPanel
                    clientId={client.id}
                    S={S}
                    mode={section === "issues" ? "issues" : "health"}
                    onGoIssues={() => setSection("issues")}
                  />
                ) : section === "opportunities" ? (
                  <OpportunitiesPanel
                    clientId={client.id}
                    clientName={client.name}
                    S={S}
                    onOpenCuration={goPrompts}
                    onGo={setSection}
                    onBriefCreated={(id) => {
                      setBriefFocus(id);
                      setSection("content");
                    }}
                  />
                ) : section === "content" ? (
                  <ContentBriefsPanel
                    clientId={client.id}
                    S={S}
                    onGoChances={() => setSection("opportunities")}
                    focusId={briefFocus}
                  />
                ) : section === "your-prompts" ? (
                  <PromptCurationPanel clientId={client.id} S={S} />
                ) : section !== "aeo-insights" ? (
                  <div
                    style={{
                      background: S.panel,
                      border: `1px solid ${S.line}`,
                      borderRadius: 14,
                      padding: 40,
                      textAlign: "center",
                      maxWidth: 560,
                      margin: "40px auto 0",
                    }}
                  >
                    <div style={{ fontSize: 30, marginBottom: 12 }}>🧭</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                      {NAV_LABEL[section]} — in Vorbereitung
                    </div>
                    <div style={{ fontSize: 13, color: S.mut }}>
                      Dieser Bereich wird noch konfiguriert. Der volle KI-Sichtbarkeits-Report liegt
                      unter „Insights".
                    </div>
                  </div>
                ) : !aivisOn ? (
                  <div
                    style={{
                      background: S.panel,
                      border: `1px solid ${S.line}`,
                      borderRadius: 14,
                      padding: 40,
                      textAlign: "center",
                      maxWidth: 560,
                      margin: "60px auto 0",
                    }}
                  >
                    <div style={{ fontSize: 30, marginBottom: 12 }}>🤖</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                      KI-Sichtbarkeit ist für {client.name} nicht aktiviert
                    </div>
                    <div style={{ fontSize: 13, color: S.mut }}>
                      Der Service lässt sich im Admin unter Kunden → Services (Canonry / Perplexity)
                      einschalten.
                    </div>
                  </div>
                ) : (
                  <>
                    <AiVisibilityTab
                      selectedClient={client}
                      navStyle="topbar"
                      onReviewPrompts={goPrompts}
                    />
                    <CrawlerCard clientId={client.id} S={S} />
                  </>
                )}
              </main>
            </div>
          </div>
          {/* Redesign 1b (Screen 2h): native Bottom-Tab-Bar (nur <900px) —
            Dashboard/Agent + EzyPilot + Apps; ersetzt die Rail auf dem Handy. */}
          <nav className="ezyai-tabbar">
            <button onClick={() => setView("heute")} style={tabBtn(view === "heute")} title="Heute">
              <Home size={21} />
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>Heute</span>
            </button>
            <button
              onClick={() => setView("dashboard")}
              style={tabBtn(view === "dashboard")}
              title="Dashboard"
            >
              <LayoutDashboard size={21} />
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>Insights</span>
            </button>
            <button
              onClick={() => setView("agent")}
              style={tabBtn(view === "agent")}
              title="Ezy Tools"
            >
              <Zap size={21} />
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>Ezy Tools</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <EzyPilotFab size={44} elevated />
            </div>
            <a href="/apps" style={{ ...tabBtn(false), textDecoration: "none" }} title="Alle Apps">
              <LayoutGrid size={21} />
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>Apps</span>
            </a>
          </nav>
          {/* EzyPilot-Popup (identisch zu den anderen Apps, Volkan 13.08.). */}
          <EzyPilotPopup />
        </div>
      </EzyPilotProvider>
    </ToastProvider>
  );
}

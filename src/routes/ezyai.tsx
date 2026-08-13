import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { useClientAppAccess, appEnabledFor } from "@/ezy/data/useClientAppAccess";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { useEzyServiceMatrix } from "@/ezy/data/useEzyServiceMatrix";
import { AiVisibilityTab } from "@/ezy/EzyOneApp.jsx";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import { loadSharedRange, saveSharedRange, cacheGet, cachePut, RANGE_TTL_MS, isReloadNavigation } from "@/ezy/data/rangeStore";
import { HexGlowLayer } from "@/ezy/HexGlow";
import {
  Search, LogOut, LineChart, Zap, Activity, MessageSquare, GraduationCap,
  FileText, Lightbulb, Globe, AlertTriangle, LayoutDashboard, Bot, Sparkles,
  Trophy,
} from "lucide-react";

// Initialen aus einem Namen (Shell-Profilblock, wie in der EzyRank-Shell).
function initials(name: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// Mobile (08.08.): SVG-Charts in echter Containerbreite zeichnen — feste
// viewBox-Breiten (1000px) schrumpften Achsen-Labels auf Smartphones auf ~3px.
// Misst den Wrapper per Callback-Ref; unter `min` px scrollt der Chart
// horizontal (Wrapper braucht overflowX:auto), wie bei den Tabellen.
function useChartWidth(fallback: number, min: number): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const W = w > 40 ? Math.max(Math.round(w), min) : fallback;
  return [attach, W];
}

// App-Navigation der Sidebar (Searchable-Struktur). "AEO Insights" = heutiges
// Dashboard; alle übrigen Bereiche sind Platzhalter (soon), bis konfiguriert.
type NavItem = { id: string; label: string; icon: any; soon?: boolean; badge?: number };
const APP_NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Analytics", items: [
    { id: "aeo-insights", label: "Insights", icon: LineChart },
    { id: "llm-analytics", label: "LLM Analytics", icon: Zap },
    { id: "traffic", label: "Traffic", icon: Activity },
    // KI-Konkurrenz (06.08.): DataForSEO LLM-Mentions top_domains/top_pages —
    // wer die KI-Antworten in den Mess-Themen des Kunden dominiert.
    { id: "ki-konkurrenz", label: "KI-Konkurrenz", icon: Trophy },
  ] },
  { group: "Prompts", items: [
    { id: "your-prompts", label: "Your Prompts", icon: MessageSquare, soon: true },
    { id: "prompt-research", label: "Prompt Research", icon: GraduationCap, soon: true },
  ] },
  { group: "Actions", items: [
    { id: "content", label: "Content", icon: FileText, soon: true },
    // Chancen (11.08., Searchable "Opportunities"): konsolidierte Queue über
    // alle Signalquellen — Site-Health-Issues, Prompt-Chancen, Prüf-Aufgaben.
    { id: "opportunities", label: "Chancen", icon: Lightbulb },
  ] },
  { group: "On Page", items: [
    { id: "site-health", label: "Site Health", icon: Globe },
    { id: "issues", label: "Issues", icon: AlertTriangle },
  ] },
];
const NAV_LABEL: Record<string, string> = Object.fromEntries(
  APP_NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

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
      .then(({ data }: any) => { if (alive) setRows(data ?? []); });
    return () => { alive = false; };
  }, [clientId]);
  if (rows === null) return null;
  const byBot: Record<string, number> = {};
  const byUrl: Record<string, number> = {};
  for (const r of rows) { byBot[r.bot] = (byBot[r.bot] || 0) + 1; byUrl[r.url] = (byUrl[r.url] || 0) + 1; }
  const bots = Object.entries(byBot).sort((a, b) => b[1] - a[1]);
  const urls = Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18, marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>KI-Crawler auf der Website</div>
        <span style={{ fontSize: 10, color: S.app, border: `1px solid ${S.app}55`, borderRadius: 99, padding: "1px 8px" }}>Beta</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: S.mut }}>letzte 7 Tage</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: S.mut, marginTop: 10 }}>
          Noch keine Daten — das Erfassungs-Snippet ist auf dieser Kunden-Website noch nicht ausgerollt
          (Rollout läuft über den Freigabe-Workflow).
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Besuche je Bot ({rows.length})</div>
            {bots.map(([b, n]) => (
              <div key={b} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${S.line}` }}>
                <span>{b}</span><span style={{ color: S.mut }}>{n}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Meistgecrawlte Seiten</div>
            {urls.map(([u, n]) => (
              <div key={u} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, padding: "3px 0", borderBottom: `1px solid ${S.line}` }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span><span style={{ color: S.mut }}>{n}</span>
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
  ChatGPT: "#10a37f", Perplexity: "#20808d", Gemini: "#4285f4", Claude: "#d97757",
  Copilot: "#0b76b7", Grok: "#1c1c1e", DeepSeek: "#4d6bfe",
};

function LlmAnalyticsPanel({ clientId, S, days }: { clientId: string; S: Record<string, string>; days: number }) {
  // Zeitraum kommt zentral aus dem Header (Volkan 10.08., Layout wie EzyRank).
  const [hits, setHits] = useState<Array<{ bot: string; url: string; at: string }> | null>(null);
  const [traffic, setTraffic] = useState<any>(null);
  const [pageEngine, setPageEngine] = useState<string>("");

  useEffect(() => {
    let alive = true;
    setHits(null);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    (supabase as any)
      .from("ai_crawler_hits")
      .select("bot, url, at")
      .eq("client_id", clientId)
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(5000)
      .then(({ data }: any) => { if (alive) setHits(data ?? []); });
    return () => { alive = false; };
  }, [clientId, days]);

  useEffect(() => {
    let alive = true;
    // Range-Cache (2026-08-10): gecachten Stand SOFORT zeigen; ist er frisch
    // (< TTL), entfällt der Netz-Call ganz — sonst still im Hintergrund laden.
    const cacheKey = `llm-traffic:${clientId}:${days}`;
    const cached = cacheGet(cacheKey);
    setTraffic(cached ? cached.data : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/llm-traffic?client=${encodeURIComponent(clientId)}&days=${days}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok) cachePut(cacheKey, j);
        // Fehler ersetzen einen vorhandenen Cache-Stand nicht (SWR-Prinzip).
        if (alive && (j.ok || !cached)) setTraffic(j.ok ? j : { ok: false, error: j.error || `HTTP ${r.status}` });
      } catch (e: any) {
        if (alive && !cached) setTraffic({ ok: false, error: String(e?.message || e) });
      }
    })();
    return () => { alive = false; };
  }, [clientId, days]);

  // Lückenlose Tages-Skala (fehlende Tage = 0), GA4-Format YYYYMMDD.
  const dayKeys = useMemo(() => {
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
    }
    return out;
  }, [days]);
  const dayLabel = (k: string) => `${k.slice(6, 8)}.${k.slice(4, 6)}.`;

  const crawler = useMemo(() => {
    const byDay: Record<string, number> = {};
    const byBot: Record<string, { n: number; last: string }> = {};
    const byUrl: Record<string, { n: number; bots: Record<string, number> }> = {};
    for (const h of hits || []) {
      const k = String(h.at || "").slice(0, 10).replace(/-/g, "");
      byDay[k] = (byDay[k] || 0) + 1;
      const b = byBot[h.bot] || { n: 0, last: h.at };
      b.n++; if (h.at > b.last) b.last = h.at; byBot[h.bot] = b;
      const u = byUrl[h.url] || { n: 0, bots: {} };
      u.n++; u.bots[h.bot] = (u.bots[h.bot] || 0) + 1; byUrl[h.url] = u;
    }
    return {
      byDay,
      bots: Object.entries(byBot).sort((a, b) => b[1].n - a[1].n),
      urls: Object.entries(byUrl).sort((a, b) => b[1].n - a[1].n).slice(0, 10),
      total: (hits || []).length,
    };
  }, [hits]);

  const engines: string[] = useMemo(
    () => Object.entries((traffic?.totals || {}) as Record<string, any>).sort((a: any, b: any) => b[1].sessions - a[1].sessions).map(([k]) => k),
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
  const activePageEngine = pageEngine && pageEngines.includes(pageEngine) ? pageEngine : pageEngines[0] || "";

  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  const secTitle = (t: string, sub?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>{t}</div>
      {sub && <span style={{ fontSize: 11, color: S.mut }}>{sub}</span>}
    </div>
  );

  // Referral-Linienchart
  const [rwRef, RW] = useChartWidth(1000, 560);
  const RH = 190, RP = 8, RAXL = 34, RAXB = 16;
  const refMax = Math.max(1, ...dayKeys.map((k) => engines.reduce((a, e) => Math.max(a, tsByDay.get(k)?.[e]?.sessions || 0), 0)));
  const rx = (i: number) => RAXL + RP + (i / Math.max(1, dayKeys.length - 1)) * (RW - RAXL - 2 * RP);
  const ry = (v: number) => RH - RAXB - RP - (v / refMax) * (RH - RAXB - 2 * RP);
  // Crawler-Balkenchart
  const [cwRef, CW] = useChartWidth(1000, 560);
  const CH = 150, CP = 8, CAXL = 34, CAXB = 16;
  const crMax = Math.max(1, ...dayKeys.map((k) => crawler.byDay[k] || 0));
  const cx = (i: number) => CAXL + CP + (i / Math.max(1, dayKeys.length)) * (CW - CAXL - 2 * CP);
  const cy = (v: number) => CH - CAXB - CP - (v / crMax) * (CH - CAXB - 2 * CP);
  const barW = Math.max(2, (CW - CAXL - 2 * CP) / Math.max(1, dayKeys.length) - 2);
  const labelEvery = Math.max(1, Math.ceil(dayKeys.length / 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* KPI-Zeile */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        {[
          ["Crawler-Besuche", hits === null ? "…" : crawler.total.toLocaleString("de-CH"), "KI-Bots auf der Website"],
          ["KI-Besucher", traffic === null ? "…" : traffic.ga4 ? refTotal.toLocaleString("de-CH") : "—", "Sessions aus KI-Antworten (GA4)"],
          ["Neue Besucher", traffic === null ? "…" : traffic.ga4 ? refNew.toLocaleString("de-CH") : "—", "davon erstmals auf der Website"],
          ["Aktive Plattformen", String(platformCount), "Crawler + Referral kombiniert"],
        ].map(([t, v, sub]) => (
          <div key={t as string} style={card}>
            <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em" }}>{t}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: S.txt, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>{sub}</div>
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
            Für diesen Kunden ist kein GA4 verbunden — die Besucher-Hälfte füllt sich, sobald die Verbindung steht.
          </div>
        ) : refTotal === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>Im gewählten Zeitraum kamen keine Besucher aus KI-Antworten.</div>
        ) : (
          <>
            <div ref={rwRef} style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${RW} ${RH}`} style={{ width: RW, display: "block" }}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={RAXL + RP} x2={RW - RP} y1={ry(f * refMax)} y2={ry(f * refMax)} stroke={S.line} strokeWidth={1} />
                  <text x={RAXL} y={ry(f * refMax) + 3} textAnchor="end" fontSize={9} fill={S.mut}>{Math.round(f * refMax)}</text>
                </g>
              ))}
              {dayKeys.map((k, i) => (i % labelEvery === 0 ? (
                <text key={k} x={rx(i)} y={RH - 3} textAnchor="middle" fontSize={9} fill={S.mut}>{dayLabel(k)}</text>
              ) : null))}
              {engines.map((e) => (
                <g key={e}>
                  <polyline
                    points={dayKeys.map((k, i) => `${rx(i)},${ry(tsByDay.get(k)?.[e]?.sessions || 0)}`).join(" ")}
                    fill="none" stroke={ENGINE_COLORS[e] || S.app} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  />
                  <circle cx={rx(dayKeys.length - 1)} cy={ry(tsByDay.get(dayKeys[dayKeys.length - 1])?.[e]?.sessions || 0)} r={3} fill={ENGINE_COLORS[e] || S.app} />
                </g>
              ))}
            </svg>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8, fontSize: 11.5, color: S.mut }}>
              {engines.map((e) => (
                <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: ENGINE_COLORS[e] || S.app, display: "inline-block" }} />
                  {e} · {(traffic?.totals?.[e]?.sessions || 0).toLocaleString("de-CH")}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Crawler pro Tag */}
      <div style={card}>
        {secTitle("Crawler-Besuche pro Tag", "KI-Bots, die Seiten der Website abrufen (Log-Snippet)")}
        {hits === null ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 20 }}>Lade Crawler-Daten…</div>
        ) : crawler.total === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            Noch keine Daten — das Erfassungs-Snippet ist auf dieser Kunden-Website noch nicht ausgerollt
            (Rollout läuft über den Freigabe-Workflow).
          </div>
        ) : (
          <div ref={cwRef} style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: CW, display: "block" }}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={CAXL + CP} x2={CW - CP} y1={cy(f * crMax)} y2={cy(f * crMax)} stroke={S.line} strokeWidth={1} />
                <text x={CAXL} y={cy(f * crMax) + 3} textAnchor="end" fontSize={9} fill={S.mut}>{Math.round(f * crMax)}</text>
              </g>
            ))}
            {dayKeys.map((k, i) => (i % labelEvery === 0 ? (
              <text key={k} x={cx(i) + barW / 2} y={CH - 3} textAnchor="middle" fontSize={9} fill={S.mut}>{dayLabel(k)}</text>
            ) : null))}
            {dayKeys.map((k, i) => {
              const v = crawler.byDay[k] || 0;
              return v > 0 ? (
                <rect key={k} x={cx(i)} y={cy(v)} width={barW} height={CH - CAXB - CP - cy(v)} rx={2} fill={S.app}>
                  <title>{`${dayLabel(k)} ${v} Besuche`}</title>
                </rect>
              ) : null;
            })}
          </svg>
          </div>
        )}
      </div>

      {/* Tabellen-Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
        <div style={card}>
          {secTitle("Meistgecrawlte Seiten", `${crawler.urls.length ? "Top " + crawler.urls.length : "—"}`)}
          {crawler.urls.length === 0 ? (
            <div style={{ fontSize: 12, color: S.mut }}>Noch keine Crawler-Daten.</div>
          ) : crawler.urls.map(([u, info]) => {
            const topBot = Object.entries(info.bots).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
            return (
              <div key={u} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${S.line}` }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: S.txt }}>{u}</span>
                <span style={{ fontSize: 10.5, color: S.mut, whiteSpace: "nowrap" }}>{botPlatform(topBot)}</span>
                <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>{info.n}</span>
              </div>
            );
          })}
        </div>
        <div style={card}>
          {secTitle("KI-Bots", `${crawler.bots.length ? crawler.bots.length + " aktiv" : "—"}`)}
          {crawler.bots.length === 0 ? (
            <div style={{ fontSize: 12, color: S.mut }}>Noch keine Crawler-Daten.</div>
          ) : crawler.bots.map(([b, info]) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${S.line}` }}>
              <span style={{ flex: 1, color: S.txt }}>{b}</span>
              <span style={{ fontSize: 10.5, color: S.mut }}>{botPlatform(b)}</span>
              <span style={{ fontSize: 10.5, color: S.mut }}>{String(info.last).slice(0, 10)}</span>
              <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>{info.n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top-Referral-Seiten je Engine */}
      <div style={card}>
        {secTitle("Top-Seiten aus KI-Antworten", "Wohin KI-Besucher einsteigen (GA4-Landingpages)")}
        {traffic === null ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>Lade GA4-Daten…</div>
        ) : !traffic.ga4 || pageEngines.length === 0 ? (
          <div style={{ fontSize: 12, color: S.mut, padding: 12 }}>
            {traffic?.ga4 ? "Im gewählten Zeitraum keine KI-Referral-Einstiege." : "Kein GA4 verbunden."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {pageEngines.map((e) => (
                <button key={e} onClick={() => setPageEngine(e)}
                  style={{ padding: "4px 10px", borderRadius: 99, border: `1px solid ${activePageEngine === e ? "transparent" : S.line}`, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, background: activePageEngine === e ? S.app : "transparent", color: activePageEngine === e ? "#fff" : S.mut }}>
                  {e}
                </button>
              ))}
            </div>
            {(traffic.pagesByEngine[activePageEngine] || []).map((p: any) => (
              <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${S.line}` }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: S.txt }}>{p.path}</span>
                <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums" }}>{p.sessions.toLocaleString("de-CH")}</span>
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
  "Organic Search": "#0f9d6c", "Direct": "#64748b", "Referral": "#d97706",
  "Paid Search": "#dc2626", "Organic Social": "#B9009C", "Email": "#0b76b7",
  "Cross-network": "#b45309", "Unassigned": "#9ca3af",
};
const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// SEO×AEO-Quadranten (Searchable GSC-Doku): GSC-Keywords gegen die KI-Erwähnungs-
// quote der thematisch passenden Mess-Prompts (Wortüberlappung wie beim
// AI-Volumen-Feature). Schwellen: SEO hoch = Position ≤ 10, AEO hoch = ≥ 30 %.
const QUAD_STOP = new Set(["der", "die", "das", "und", "oder", "für", "fuer", "mit", "von", "aus", "bei", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "auf", "als", "was", "wie", "wer", "ist", "sind", "the", "for", "and", "was", "you", "your", "nach", "zum", "zur", "über", "ueber"]);
const kwWords = (kw: string) => kw.toLowerCase().split(/[^a-zäöüéèà0-9]+/).filter((w) => w.length >= 3 && !QUAD_STOP.has(w));
const stemOf = (w: string) => (w.length > 7 ? w.slice(0, 7) : w);

// Panel-Zeitraum: geteilten Store-Wert auf die Stufen 7/30/90 runden.
function nearestPanelDays(d?: number | null): number {
  if (!d || !Number.isFinite(d)) return 30;
  return [7, 30, 90].reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), 30);
}

function TrafficPanel({ clientId, S, days }: { clientId: string; S: Record<string, string>; days: number }) {
  // Zeitraum kommt zentral aus dem Header (Volkan 10.08., Layout wie EzyRank).
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    const cacheKey = `traffic-overview:${clientId}:${days}`;
    const cached = cacheGet(cacheKey);
    setData(cached ? cached.data : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/traffic-overview?client=${encodeURIComponent(clientId)}&days=${days}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        cachePut(cacheKey, j);
        if (alive) setData(j);
      } catch (e: any) {
        // Fehler ersetzen einen vorhandenen Cache-Stand nicht (SWR-Prinzip).
        if (alive && !cached) { setErr(String(e?.message || e)); setData({ ok: false }); }
      }
    })();
    return () => { alive = false; };
  }, [clientId, days]);

  // KI-Mess-Prompts des neuesten Reports (RLS-direkt) für die Quadranten-Matrix.
  const [prompts, setPrompts] = useState<Array<{ text: string; mentioned: boolean }> | null>(null);
  useEffect(() => {
    let alive = true;
    setPrompts(null);
    (async () => {
      const { data: rep } = await (supabase as any)
        .from("ai_visibility_reports").select("id").eq("client_id", clientId)
        .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
      if (!rep?.id) { if (alive) setPrompts([]); return; }
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any)
          .from("ai_visibility_prompts").select("prompt, topic, status")
          .eq("report_id", rep.id).range(from, from + 999);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      if (alive) setPrompts(rows.map((p) => ({
        text: `${p.topic || ""} ${p.prompt || ""}`.toLowerCase(),
        mentioned: p.status === "Erwähnt" || p.status === "Referenziert",
      })));
    })();
    return () => { alive = false; };
  }, [clientId]);

  const quad = useMemo(() => {
    const queries: any[] = data?.queries || [];
    if (!queries.length || !prompts || !prompts.length) return null;
    const pts = queries.slice(0, 80).map((q) => {
      const stems = kwWords(q.query).map(stemOf);
      if (!stems.length) return null;
      const matched = prompts.filter((p) => stems.every((s) => p.text.includes(s)));
      const aeo = matched.length ? Math.round((matched.filter((m) => m.mentioned).length / matched.length) * 100) : null;
      return { ...q, aeo, matchedPrompts: matched.length };
    }).filter(Boolean) as any[];
    const measured = pts.filter((p) => p.aeo != null);
    if (!measured.length) return null;
    const bucket = (p: any) => (p.position <= 10 ? (p.aeo >= 30 ? "staerken" : "kiPotenzial") : p.aeo >= 30 ? "seoPotenzial" : "aufbau");
    const buckets: Record<string, any[]> = { staerken: [], kiPotenzial: [], seoPotenzial: [], aufbau: [] };
    for (const p of measured) buckets[bucket(p)].push(p);
    for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b.impressions - a.impressions);
    return { measured, buckets, unmeasured: pts.length - measured.length };
  }, [data, prompts]);

  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  const dayKeys = useMemo(() => {
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
    }
    return out;
  }, [days]);
  const dayLabel = (k: string) => `${k.slice(6, 8)}.${k.slice(4, 6)}.`;
  const labelEvery = Math.max(1, Math.ceil(dayKeys.length / 10));
  const [qwRef, QW] = useChartWidth(1000, 640); // Quadranten-Matrix (mobil scrollbar)

  // App-Split (06.08., Volkan): EzyAI zeigt NUR die KI-Sicht — Kanal-Trends,
  // GSC-Klicks & klassisches SEO leben in EzyRank. Die Gesamt-Sessions dienen
  // hier nur als Bezugsgröße für den KI-Anteil.
  const totalSessions = Object.values((data?.channels?.totals || {}) as Record<string, number>).reduce((a, b) => a + b, 0);
  const aiSeg = (data?.segments || []).find((s: any) => s.name === "KI-Antworten");
  const aiShare = totalSessions && aiSeg ? Math.round((aiSeg.sessions / totalSessions) * 1000) / 10 : 0;
  const orgSeg = (data?.segments || []).find((s: any) => s.name === "Organische Suche");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div style={{ fontSize: 12, color: "#dc2626" }}>{err}</div>}

      {data === null ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade Traffic-Daten…</div>
      ) : !data.ga4 && !data.gsc ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🔌</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>Kein GA4/GSC verbunden</div>
          <div style={{ fontSize: 13, color: S.mut }}>Sobald Google Analytics oder die Search Console für diesen Kunden verbunden ist, füllt sich dieser Bereich automatisch.</div>
        </div>
      ) : (
        <>
          {/* KPI-Zeile — bewusst nur KI-Kennzahlen (Rest: EzyRank) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            {[
              ["KI-Besucher", data.ga4 && aiSeg ? aiSeg.sessions.toLocaleString("de-CH") : "0", "Sessions aus KI-Antworten (inkl. Copilot/Bing AI)"],
              ["KI-Anteil", data.ga4 ? `${aiShare} %` : "—", `an ${totalSessions.toLocaleString("de-CH")} Sessions gesamt`],
              ["Ø Dauer (KI)", data.ga4 && aiSeg ? fmtDur(aiSeg.avgDurationSec) : "—", orgSeg ? `Organische Suche: ${fmtDur(orgSeg.avgDurationSec)}` : ""],
              ["Engagement (KI)", data.ga4 && aiSeg ? `${aiSeg.engagementRate} %` : "—", orgSeg ? `Organische Suche: ${orgSeg.engagementRate} %` : ""],
            ].map(([t, v, sub]) => (
              <div key={t as string} style={card}>
                <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em" }}>{t}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: S.txt, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Engagement-Vergleich (Searchable-Kernwidget) */}
          {data.ga4 && Array.isArray(data.segments) && data.segments.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 4 }}>Engagement im Vergleich</div>
              <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 10 }}>Wie sich Besucher aus KI-Antworten gegenüber klassischen Kanälen verhalten.</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: S.mut, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left" }}>
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
                      <tr key={s.name} style={{ borderTop: `1px solid ${S.line}`, background: s.name === "KI-Antworten" ? S.appTint : "transparent" }}>
                        <td style={{ padding: "7px 8px", fontWeight: s.name === "KI-Antworten" ? 700 : 500, color: s.name === "KI-Antworten" ? S.app : S.txt }}>{s.name}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: S.txt }}>{s.sessions.toLocaleString("de-CH")}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: S.mut }}>{s.newUsers.toLocaleString("de-CH")}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: S.txt }}>{fmtDur(s.avgDurationSec)}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: S.txt }}>{s.pagesPerSession}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: S.txt }}>{s.engagementRate} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SEO × KI-Sichtbarkeit: Quadranten-Matrix (Searchable GSC-Kombination) */}
          {quad && (() => {
            const QH = 300, QP = 14, QAXL = 40, QAXB = 24;
            const qx = (pos: number) => QAXL + QP + ((30 - Math.min(pos, 30)) / 30) * (QW - QAXL - 2 * QP);
            const qy = (aeo: number) => QH - QAXB - QP - (aeo / 100) * (QH - QAXB - 2 * QP);
            const maxImp = Math.max(1, ...quad.measured.map((p: any) => p.impressions));
            const rOf = (imp: number) => 3 + Math.sqrt(imp / maxImp) * 6;
            const QCOLOR: Record<string, string> = { staerken: "#0f9d6c", kiPotenzial: "#77008C", seoPotenzial: "#0b76b7", aufbau: "#9ca3af" };
            const bucketOf = (p: any) => (p.position <= 10 ? (p.aeo >= 30 ? "staerken" : "kiPotenzial") : p.aeo >= 30 ? "seoPotenzial" : "aufbau");
            const QMETA: Array<[string, string, string]> = [
              ["kiPotenzial", "KI-Potenzial", "Stark bei Google, kaum in KI-Antworten — beste Kandidaten für FAQ-/Antwort-Content"],
              ["staerken", "Stärken", "Stark bei Google UND in KI-Antworten"],
              ["seoPotenzial", "SEO-Potenzial", "In KI-Antworten präsent, aber nicht auf Google-Seite 1"],
              ["aufbau", "Aufbau nötig", "Weder Google-Seite 1 noch KI-Präsenz"],
            ];
            return (
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 4 }}>SEO × KI-Sichtbarkeit</div>
                <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 10 }}>
                  Google-Keywords (GSC, nach Impressionen) gegen die KI-Erwähnungsquote der thematisch passenden Mess-Prompts.
                  Schwellen: Google-Seite 1 (Position ≤ 10) · KI-Quote ≥ 30 %.
                </div>
                <div ref={qwRef} style={{ overflowX: "auto" }}>
                <svg viewBox={`0 0 ${QW} ${QH}`} style={{ width: QW, display: "block" }}>
                  {/* Quadranten-Hintergründe */}
                  <rect x={qx(10)} y={qy(100)} width={QW - QP - qx(10)} height={qy(30) - qy(100)} fill="#0f9d6c" opacity={0.06} />
                  <rect x={qx(10)} y={qy(30)} width={QW - QP - qx(10)} height={qy(0) - qy(30)} fill="#77008C" opacity={0.07} />
                  <rect x={QAXL + QP} y={qy(100)} width={qx(10) - QAXL - QP} height={qy(30) - qy(100)} fill="#0b76b7" opacity={0.05} />
                  <line x1={qx(10)} x2={qx(10)} y1={QP} y2={QH - QAXB - QP} stroke={S.line} strokeWidth={1.5} strokeDasharray="4 4" />
                  <line x1={QAXL + QP} x2={QW - QP} y1={qy(30)} y2={qy(30)} stroke={S.line} strokeWidth={1.5} strokeDasharray="4 4" />
                  {/* Achsen-Beschriftung */}
                  <text x={QAXL + QP} y={QH - 6} fontSize={10} fill={S.mut}>← schwächere Google-Position</text>
                  <text x={QW - QP} y={QH - 6} fontSize={10} fill={S.mut} textAnchor="end">Google-Seite 1 →</text>
                  <text x={QAXL - 6} y={qy(100) + 8} fontSize={10} fill={S.mut} textAnchor="end">KI 100 %</text>
                  <text x={QAXL - 6} y={qy(30) + 3} fontSize={10} fill={S.mut} textAnchor="end">30 %</text>
                  <text x={QAXL - 6} y={qy(0)} fontSize={10} fill={S.mut} textAnchor="end">0 %</text>
                  {/* Quadranten-Labels */}
                  <text x={QW - QP - 6} y={qy(100) + 14} fontSize={10.5} fontWeight={700} fill="#0f9d6c" textAnchor="end">Stärken</text>
                  <text x={QW - QP - 6} y={qy(0) - 8} fontSize={10.5} fontWeight={700} fill="#77008C" textAnchor="end">KI-Potenzial</text>
                  <text x={QAXL + QP + 6} y={qy(100) + 14} fontSize={10.5} fontWeight={700} fill="#0b76b7">SEO-Potenzial</text>
                  <text x={QAXL + QP + 6} y={qy(0) - 8} fontSize={10.5} fontWeight={700} fill="#9ca3af">Aufbau nötig</text>
                  {quad.measured.map((p: any) => (
                    <circle key={p.query} cx={qx(p.position)} cy={qy(p.aeo)} r={rOf(p.impressions)}
                      fill={QCOLOR[bucketOf(p)]} opacity={0.75} stroke="#fff" strokeWidth={1}>
                      <title>{`${p.query}\nGoogle-Position ${p.position} · ${p.impressions.toLocaleString("de-CH")} Impressionen\nKI-Quote ${p.aeo} % (${p.matchedPrompts} passende Prompts)`}</title>
                    </circle>
                  ))}
                </svg>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12, marginTop: 12 }}>
                  {QMETA.map(([key, title, desc]) => (
                    <div key={key} style={{ border: `1px solid ${key === "kiPotenzial" ? QCOLOR[key] : S.line}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: QCOLOR[key] }}>{title} · {quad.buckets[key].length}</div>
                      <div style={{ fontSize: 10.5, color: S.mut, marginTop: 2, marginBottom: 6 }}>{desc}</div>
                      {quad.buckets[key].slice(0, 6).map((p: any) => (
                        <div key={p.query} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, padding: "3px 0", borderTop: `1px solid ${S.line}` }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: S.txt }}>{p.query}</span>
                          <span style={{ color: S.mut, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>#{p.position} · {p.aeo} %</span>
                        </div>
                      ))}
                      {!quad.buckets[key].length && <div style={{ fontSize: 11, color: S.mut }}>—</div>}
                    </div>
                  ))}
                </div>
                {quad.unmeasured > 0 && (
                  <div style={{ fontSize: 10.5, color: S.mut, marginTop: 8 }}>
                    {quad.unmeasured} Keywords ohne thematisch passenden Mess-Prompt (nicht in der Matrix) — mehr Abdeckung entsteht über zusätzliche Prompts in „Prompts verwalten".
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

// ── KI-Konkurrenz (06.08.2026, DataForSEO LLM Mentions) ──────────────────────
// Zeigt je Plattform (Google AIO/AI-Mode vs. ChatGPT), welche Domains, Seiten
// und Marken in den LLM-Antworten zu den Mess-Themen des Kunden am häufigsten
// zitiert werden. Daten: /api/admin/aivis-competitors (Targets = aivis-Topics).
// KI-Erwähnungs-Trend (12.08., DataForSEO historical + timeseries_new_lost):
// monatliche Erwähnungen der KUNDEN-DOMAIN im LLM-Korpus (domain-basiert =
// sprachunabhängig, Daten ab 2025-08) + neue/verlorene Erwähnungen.
function MentionsTrendCard({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [t, setT] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    setT(null);
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&trend=1`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (alive) setT(j.ok ? j : { ok: false });
      } catch { if (alive) setT({ ok: false }); }
    })();
    return () => { alive = false; };
  }, [clientId]);
  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  if (t === null) return <div style={{ ...card, color: S.mut, fontSize: 12.5 }}>KI-Erwähnungs-Trend wird geladen…</div>;
  if (!t.ok) return null;
  const series: Array<{ label: string; color: string; pts: any[] }> = [
    { label: "Google AIO", color: "#77008C", pts: t.google || [] },
    { label: "ChatGPT", color: "#0f9d6c", pts: t.chatgpt || [] },
  ].filter((s) => s.pts.length);
  if (!series.length && !(t.newLost || []).length) return null;
  const months = [...new Set(series.flatMap((s) => s.pts.map((p: any) => `${p.y}-${String(p.m).padStart(2, "0")}`)))].sort();
  const maxV = Math.max(1, ...series.flatMap((s) => s.pts.map((p: any) => p.mentions)));
  const W = 560, H = 130, PL = 30, PR = 8, PT = 8, PB = 18;
  const x = (i: number) => PL + (months.length > 1 ? (i / (months.length - 1)) * (W - PL - PR) : 0);
  const y = (v: number) => PT + (1 - v / maxV) * (H - PT - PB);
  const nl = (t.newLost || []).slice(-6);
  const latest = nl[nl.length - 1];
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>KI-Erwähnungs-Trend</div>
        <span style={{ fontSize: 11, color: S.mut }}>Erwähnungen von {t.client?.domain} in gespeicherten KI-Antworten, je Monat (sprachunabhängig, Korpus ab Aug 2025)</span>
        {latest && (latest.new > 0 || latest.lost > 0) && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700 }}>
            <span style={{ color: "#0f9d6c" }}>+{latest.new} neu</span>
            <span style={{ color: S.mut }}> / </span>
            <span style={{ color: "#dc2626" }}>−{latest.lost} verloren</span>
            <span style={{ color: S.mut, fontWeight: 400 }}> (ChatGPT, aktueller Monat)</span>
          </span>
        )}
      </div>
      {months.length >= 2 && (
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 720, display: "block" }}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PL} x2={W - PR} y1={y(f * maxV)} y2={y(f * maxV)} stroke={S.line} strokeWidth="1" />
                <text x={PL - 4} y={y(f * maxV) + 3} textAnchor="end" fontSize="8.5" fill={S.mut}>{Math.round(f * maxV)}</text>
              </g>
            ))}
            {series.map((s) => {
              const map = new Map(s.pts.map((p: any) => [`${p.y}-${String(p.m).padStart(2, "0")}`, p.mentions]));
              const path = months.map((mo, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(map.get(mo) || 0)).toFixed(1)}`).join(" ");
              return <path key={s.label} d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />;
            })}
            {months.map((mo, i) => (i === 0 || i === months.length - 1 || i === Math.floor(months.length / 2)) ? (
              <text key={mo} x={x(i)} y={H - 4} textAnchor="middle" fontSize="8.5" fill={S.mut}>{mo.slice(2)}</text>
            ) : null)}
          </svg>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {series.map((s) => {
              // vs.-Vormonat-Badge (12.08.): aus den bereits geladenen
              // historical-Monatswerten — kein zusätzlicher API-Call.
              const pts2 = s.pts.slice(-2);
              const delta = pts2.length === 2 ? pts2[1].mentions - pts2[0].mentions : 0;
              return (
                <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: S.mut }}>
                  <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.label}
                  {delta !== 0 && (
                    <span style={{ fontWeight: 700, color: delta > 0 ? "#0f9d6c" : "#dc2626" }}>
                      {delta > 0 ? "▲+" : "▼"}{delta} vs. Vormonat
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CompetitorsPanel({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [platform, setPlatform] = useState<"google" | "chat_gpt">("google");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null); setErr("");
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&platform=${platform}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (alive) setData(j);
      } catch (e: any) {
        if (alive) { setErr(String(e?.message || e)); setData({ ok: false }); }
      }
    })();
    return () => { alive = false; };
  }, [clientId, platform]);

  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  const ownHost = String(data?.client?.domain || "").replace(/^www\./, "").toLowerCase();
  const isOwn = (key: string) => {
    if (!ownHost) return false;
    const h = key.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
    return h === ownHost || h.startsWith(ownHost + "/");
  };
  const maxMentions = Math.max(1, ...((data?.domains as any[]) || []).map((d) => d.mentions));

  const listCard = (title: string, sub: string, rows: Array<{ key: string; mentions: number; aiVolume: number }>, bar: boolean) => (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>{title}</div>
        <span style={{ fontSize: 11, color: S.mut }}>{sub}</span>
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 12, color: S.mut }}>
          Für die Mess-Themen dieses Kunden liefert die Mentions-Datenbank hier (noch) keine Daten —
          der Korpus ist bei ChatGPT dünner als bei Google und wächst laufend.
        </div>
      ) : rows.map((r, i) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "6px 0", borderBottom: `1px solid ${S.line}` }}>
          <span style={{ width: 18, textAlign: "right", color: S.mut, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isOwn(r.key) ? S.app : S.txt, fontWeight: isOwn(r.key) ? 700 : 500 }}>
            {r.key}{isOwn(r.key) ? " ← dieser Kunde" : ""}
          </span>
          {bar && (
            <span style={{ width: 90, height: 5, borderRadius: 99, background: S.line, overflow: "hidden", flexShrink: 0 }}>
              <span style={{ display: "block", width: `${Math.round((r.mentions / maxMentions) * 100)}%`, height: "100%", background: isOwn(r.key) ? S.app : S.mut, borderRadius: 99 }} />
            </span>
          )}
          <span style={{ color: S.txt, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }} title="Erwähnungen in LLM-Antworten">{r.mentions}×</span>
          <span style={{ color: S.mut, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontSize: 11 }} title="AI-Suchvolumen der zugehörigen Prompts">{r.aiVolume.toLocaleString("de-CH")}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: S.mut }}>Plattform</span>
        <div style={{ display: "flex", border: `1px solid ${S.line}`, borderRadius: 8, padding: 2, background: S.panel }}>
          {([["google", "Google AIO / AI Mode"], ["chat_gpt", "ChatGPT"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setPlatform(v)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: platform === v ? S.app : "transparent", color: platform === v ? "#fff" : S.mut }}>
              {label}
            </button>
          ))}
        </div>
        {data?.targets?.length ? (
          <span style={{ fontSize: 11, color: S.mut }}>Themen: {data.targets.slice(0, 5).join(" · ")}{data.targets.length > 5 ? ` (+${data.targets.length - 5})` : ""}</span>
        ) : null}
        {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
      </div>
      <MentionsTrendCard clientId={clientId} S={S} />
      {data === null ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade KI-Konkurrenz-Daten…</div>
      ) : !data.ok ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Daten derzeit nicht abrufbar{err ? ` — ${err}` : ""}.</div>
      ) : (
        <>
          {data.note && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 10, border: "1px solid #f0c36d", background: "#fdf6e3", color: "#8a6d1b", padding: "8px 12px", fontSize: 12 }}>
              <span aria-hidden>🌐</span>
              <span>{data.note}</span>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
            {listCard("Meistzitierte Domains", "wer die KI-Antworten dominiert", data.domains || [], true)}
            {listCard("Meistzitierte Seiten", "die konkreten Quellen-URLs", data.pages || [], false)}
          </div>
          {Array.isArray(data.brands) && data.brands.length > 0 && (
            listCard("Meistgenannte Marken", "Brand-Entitäten in den Antworten", data.brands, false)
          )}
          {/* Mentions-SoV (12.08., cross_aggregated_metrics): Kunde vs. Rivalen
              im echten Antwort-Korpus — unabhängige Zweitmessung zum
              prompt-basierten SoV des Dashboards. */}
          {Array.isArray(data.sov) && data.sov.some((s: any) => s.mentions > 0) && (
            <div style={card}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>Marken-SoV im KI-Korpus</div>
                <span style={{ fontSize: 11, color: S.mut }}>
                  Erwähnungen im {data.platform === "google" ? "Schweizer Google-AIO" : "globalen ChatGPT"}-Korpus — unabhängig von unseren Mess-Prompts
                </span>
              </div>
              {(() => {
                const maxM = Math.max(1, ...data.sov.map((s: any) => s.mentions));
                return data.sov.map((s: any) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "6px 0", borderBottom: `1px solid ${S.line}` }}>
                    <span style={{ flex: "0 0 220px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: s.isSelf ? S.app : S.txt, fontWeight: s.isSelf ? 700 : 500 }}>
                      {s.name}{s.isSelf ? " ← dieser Kunde" : ""}
                    </span>
                    <span style={{ flex: 1, height: 5, borderRadius: 99, background: S.line, overflow: "hidden" }}>
                      <span style={{ display: "block", width: `${Math.round((s.mentions / maxM) * 100)}%`, height: "100%", background: s.isSelf ? S.app : S.mut, borderRadius: 99 }} />
                    </span>
                    <span style={{ flexShrink: 0, width: 90, textAlign: "right", color: S.txt, fontVariantNumeric: "tabular-nums" }}>{s.mentions} · {s.share}%</span>
                  </div>
                ));
              })()}
            </div>
          )}
          {Array.isArray(data.categories) && data.categories.length > 0 && (
            <div style={card}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>KI-Kategorien der Branche</div>
                <span style={{ fontSize: 11, color: S.mut }}>in welche Kategorien ChatGPT die genannten Marken einsortiert</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.categories.map((c: any) => (
                  <span key={c.key} style={{ borderRadius: 99, border: `1px solid ${S.line}`, background: S.bg, padding: "3px 10px", fontSize: 11.5, color: S.txt }}>
                    {c.key} <span style={{ color: S.mut }}>({c.mentions})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: S.mut }}>
            Quelle: DataForSEO LLM-Mentions-Datenbank (Targets = aivis-Mess-Themen, partial match).
            Erwähnungen = Zitate in gespeicherten LLM-Antworten; zweite Zahl = AI-Suchvolumen der zugehörigen Prompts.
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
const scoreColor = (v: number) => (v >= 90 ? "#0f9d6c" : v >= 70 ? "#6aa84f" : v >= 50 ? "#d97706" : v >= 30 ? "#ea580c" : "#dc2626");
const scoreLabel = (v: number) => (v >= 90 ? "Ausgezeichnet" : v >= 70 ? "Gut" : v >= 50 ? "Befriedigend" : v >= 30 ? "Schlecht" : "Kritisch");

// ── Chancen-Queue (11.08., Searchable "Opportunities"-Parität) ───────────────
// EIN Ort für alles Handlungsrelevante, priorisiert nach Schwere — aggregiert
// read-only aus vorhandenen Quellen: Site-Health-Issues (Endpoint), Prompt-
// Chancen (Konkurrenz empfohlen, Kunde nicht — RLS-Read), Prüf-Aufgaben
// (Prompt-Queue, Faktenprofil). Bewusst ohne neue Tabellen: Erledigen heisst
// die Ursache beheben, nicht einen Status pflegen.
const OPP_SEV_ORDER: Record<string, number> = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
function OpportunitiesPanel({ clientId, clientName, S, onOpenCuration, onGo }: {
  clientId: string; clientName: string; S: Record<string, string>;
  onOpenCuration: () => void; onGo: (section: string) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setItems(null); setErr("");
    (async () => {
      const out: any[] = [];
      const session = (await supabase.auth.getSession()).data.session;
      const authH = { Authorization: `Bearer ${session?.access_token || ""}` };
      // 1) Site-Health-Issues (letzter Audit; ohne Audit einfach leer).
      try {
        const r = await fetch(`/api/admin/site-health?client=${encodeURIComponent(clientId)}`, { headers: authH });
        const j = await r.json().catch(() => ({}));
        for (const i of j?.audit?.issues || []) out.push({
          sev: String(i.severity || "niedrig"), quelle: "Site Health",
          titel: String(i.label || ""), text: String(i.tipp || i.detail || ""), go: "issues",
        });
      } catch { /* additiv */ }
      // 1b) KI-Zitat-Gaps (12.08., DataForSEO include/exclude): echte Fragen
      // aus dem CH-Korpus, bei denen ein Rival zitiert wird, der Kunde nicht.
      try {
        const r = await fetch(`/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&gaps=1`, { headers: authH });
        const j = await r.json().catch(() => ({}));
        for (const g of j?.gaps || []) out.push({
          sev: "hoch", quelle: "KI-Zitat-Gap",
          titel: `${g.rival} gewinnt KI-Zitate bei ${g.total} echten Fragen — ${clientName} fehlt`,
          text: `Beispiele aus dem Schweizer KI-Korpus: ${g.questions.slice(0, 4).map((q: any) => `„${q.q}"`).join(" · ")}. Zitierfähigen Inhalt zu diesen Fragen aufbauen.`,
          go: "ki-konkurrenz",
        });
      } catch { /* additiv */ }
      // 2) Prompt-Chancen: Konkurrenz wird empfohlen, der Kunde nicht.
      try {
        const { data: rep } = await (supabase as any)
          .from("ai_visibility_reports").select("id").eq("client_id", clientId)
          .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
        if (rep?.id) {
          const { data: opps } = await (supabase as any)
            .from("ai_visibility_prompts").select("prompt, platform, competitors")
            .eq("report_id", rep.id).eq("is_opportunity", true).limit(1000);
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
            .forEach(([prompt, g]) => out.push({
              sev: g.comps.size >= 3 ? "hoch" : "mittel", quelle: "KI-Sichtbarkeit",
              titel: `Konkurrenz wird empfohlen: „${prompt}"`,
              text: `${g.engines} KI-${g.engines === 1 ? "Antwort nennt" : "Antworten nennen"} ${[...g.comps].slice(0, 3).join(", ")}${g.comps.size > 3 ? ` (+${g.comps.size - 3})` : ""} — ${clientName} fehlt. Zitierfähigen Inhalt zu dieser Frage aufbauen.`,
              go: "aeo-insights",
            }));
        }
      } catch { /* additiv */ }
      // 3) Prüf-Aufgaben: Prompt-Queue + Faktenprofil.
      try {
        const { count } = await (supabase as any)
          .from("ai_visibility_prompt_defs").select("id", { count: "exact", head: true })
          .eq("client_id", clientId).eq("needs_review", true);
        if (count) out.push({
          sev: "niedrig", quelle: "Kuration",
          titel: `${count} ${count === 1 ? "Prompt wartet" : "Prompts warten"} auf Prüfung`,
          text: "Unklare Vorschläge freigeben oder archivieren — nur Bestätigtes wird gemessen.", action: "curation",
        });
      } catch { /* additiv */ }
      try {
        const r = await fetch(`/api/admin/brand-facts?client=${encodeURIComponent(clientId)}`, { headers: authH });
        const j = await r.json().catch(() => ({}));
        if (j?.ok && j.needsReview) out.push({
          sev: "niedrig", quelle: "Kuration",
          titel: "Faktenprofil bestätigen",
          text: "Der Fakten-Check prüft KI-Antworten gegen dieses Profil — einmal prüfen und bestätigen erhöht die Treffsicherheit.", action: "curation",
        });
      } catch { /* additiv */ }
      out.sort((a, b) => (OPP_SEV_ORDER[a.sev] ?? 9) - (OPP_SEV_ORDER[b.sev] ?? 9));
      if (alive) setItems(out);
    })().catch((e) => { if (alive) { setErr(String(e?.message || e)); setItems([]); } });
    return () => { alive = false; };
  }, [clientId, clientName]);

  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  if (items === null) return <div style={{ ...card, color: S.mut, fontSize: 13 }}>Chancen werden gesammelt…</div>;
  const counts = items.reduce((m: Record<string, number>, i) => { m[i.sev] = (m[i.sev] || 0) + 1; return m; }, {});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: S.mut }}>
          Alles Handlungsrelevante an einem Ort — aus Site Health, KI-Sichtbarkeit und Kuration, nach Schwere sortiert.
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(["kritisch", "hoch", "mittel", "niedrig"] as const).map((sv) => counts[sv] ? (
            <span key={sv} style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: "2px 9px", background: SEV_STYLE[sv].bg, color: SEV_STYLE[sv].fg }}>
              {counts[sv]} {SEV_STYLE[sv].label}
            </span>
          ) : null)}
        </span>
      </div>
      {err && <div style={{ ...card, color: "#dc2626", fontSize: 12.5 }}>{err}</div>}
      {!items.length ? (
        <div style={{ ...card, textAlign: "center", color: S.mut, fontSize: 13 }}>
          🎉 Keine offenen Chancen — alle Signalquellen sind sauber. Neue Chancen erscheinen nach dem nächsten Messlauf/Audit.
        </div>
      ) : (
        <div style={card}>
          {items.map((i, idx) => {
            const sv = SEV_STYLE[i.sev] || SEV_STYLE.niedrig;
            return (
              <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: idx ? `1px solid ${S.line}` : "none" }}>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: "2px 9px", background: sv.bg, color: sv.fg }}>{sv.label}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>{i.titel}</div>
                  <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{i.text}</div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 10.5, color: S.mut, alignSelf: "center" }}>{i.quelle}</span>
                <button
                  onClick={() => (i.action === "curation" ? onOpenCuration() : onGo(i.go))}
                  style={{ flexShrink: 0, alignSelf: "center", padding: "5px 10px", borderRadius: 8, border: `1px solid ${S.line}`, background: S.bg, color: S.app, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {i.action === "curation" ? "Prüfen" : "Ansehen"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SiteHealthPanel({ clientId, S, mode }: { clientId: string; S: Record<string, string>; mode: "health" | "issues" }) {
  const [audit, setAudit] = useState<any | undefined>(undefined); // undefined = lädt, null = keiner
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  const call = useCallback(async (method: "GET" | "POST", auditMode?: "quick" | "deep") => {
    const session = (await supabase.auth.getSession()).data.session;
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${session?.access_token || ""}` } };
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
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    setAudit(undefined); setErr("");
    call("GET").then((a) => { if (alive) setAudit(a); }).catch((e) => { if (alive) { setErr(String(e?.message || e)); setAudit(null); } });
    return () => { alive = false; };
  }, [call]);

  const [runningMode, setRunningMode] = useState<"quick" | "deep" | null>(null);
  const runAudit = async (auditMode: "quick" | "deep") => {
    setRunning(true); setRunningMode(auditMode); setErr("");
    try { setAudit(await call("POST", auditMode)); }
    catch (e: any) { setErr(String(e?.message || e)); }
    finally { setRunning(false); setRunningMode(null); }
  };

  const card: any = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18 };
  const issues = audit?.issues || [];
  const checks = audit?.checks || [];
  const pillars: Array<[string, string]> = [["technical", "Technik"], ["content", "Inhalt"], ["aeo", "AI-Readiness"]];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => runAudit("quick")} disabled={running}
          style={{ padding: "8px 16px", borderRadius: 10, border: "none", cursor: running ? "default" : "pointer", background: S.app, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", opacity: running ? 0.6 : 1 }}>
          {running && runningMode === "quick" ? "Quick-Audit läuft… (~10 s)" : "Quick-Audit"}
        </button>
        <button onClick={() => runAudit("deep")} disabled={running}
          style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${S.app}`, cursor: running ? "default" : "pointer", background: "transparent", color: S.app, fontSize: 13, fontWeight: 600, fontFamily: "inherit", opacity: running ? 0.6 : 1 }}>
          {running && runningMode === "deep" ? "Tiefen-Audit läuft… (~2 Min)" : "Tiefen-Audit (bis 50 Seiten)"}
        </button>
        {audit?.at && (
          <span style={{ fontSize: 12, color: S.mut }}>
            Letzter Audit: {new Date(audit.at).toLocaleString("de-CH")} · {audit.url}
            {audit.mode === "deep" && Array.isArray(audit.pages) && audit.pages.length > 1 ? ` · ${audit.pages.length} Seiten` : " · Startseite"}
          </span>
        )}
        {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
      </div>

      {audit === undefined ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade letzten Audit…</div>
      ) : !audit ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🩺</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>Noch kein Audit für diesen Kunden</div>
          <div style={{ fontSize: 13, color: S.mut }}>Quick-Audit prüft Startseite, robots.txt, Sitemap und AI-Readiness (~10 s); der Tiefen-Audit nimmt bis zu 50 Unterseiten aus der Sitemap dazu (~2 Min). Beides ohne Zusatzkosten.</div>
        </div>
      ) : (
        <>
          {/* Score-Karten */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            {[["overall", "Gesamt-Score"], ...pillars].map(([k, label]) => {
              const v = audit.scores?.[k] ?? 0;
              return (
                <div key={k} style={card}>
                  <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: scoreColor(v), fontVariantNumeric: "tabular-nums" }}>{v}</span>
                    <span style={{ fontSize: 11.5, color: S.mut }}>/ 100 · {scoreLabel(v)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: S.line, marginTop: 8, overflow: "hidden" }}>
                    <div style={{ width: `${v}%`, height: "100%", borderRadius: 99, background: scoreColor(v) }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Issues */}
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 10 }}>
              {issues.length ? `${issues.length} ${issues.length === 1 ? "Problem" : "Probleme"} gefunden` : "Keine Probleme gefunden 🎉"}
            </div>
            {issues.map((i: any) => {
              const sv = SEV_STYLE[i.severity] || SEV_STYLE.niedrig;
              return (
                <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: `1px solid ${S.line}` }}>
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: "2px 9px", background: sv.bg, color: sv.fg }}>{sv.label}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>{i.label} <span style={{ fontWeight: 400, color: S.mut }}>— {i.detail}</span></div>
                    <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{i.tipp}</div>
                    {Array.isArray(i.pages) && i.pages.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {i.pages.slice(0, 6).map((p: string) => (
                          <span key={p} style={{ fontSize: 10, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 6, padding: "1px 6px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                        ))}
                        {i.pages.length > 6 && <span style={{ fontSize: 10, color: S.mut }}>+{i.pages.length - 6} weitere</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Seiten-Tabelle (Tiefen-Audit) */}
          {Array.isArray(audit.pages) && audit.pages.length > 1 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 8 }}>Geprüfte Seiten · {audit.pages.length}</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: S.mut, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left" }}>
                      <th style={{ padding: "5px 8px" }}>Seite</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Score</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Probleme</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>HTTP</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Zeit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.pages].sort((a: any, b: any) => a.score - b.score).map((p: any) => (
                      <tr key={p.path} style={{ borderTop: `1px solid ${S.line}` }}>
                        <td style={{ padding: "6px 8px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: S.txt }} title={p.title || p.path}>{p.path}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: scoreColor(p.score), fontVariantNumeric: "tabular-nums" }}>{p.score}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: p.issues ? S.txt : S.mut, fontVariantNumeric: "tabular-nums" }}>{p.issues || "—"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: p.status === 200 ? S.mut : "#dc2626", fontVariantNumeric: "tabular-nums" }}>{p.status}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: S.mut, fontVariantNumeric: "tabular-nums" }}>{p.ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Check-Tabellen je Säule (nur im Site-Health-Modus) */}
          {mode === "health" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
              {pillars.map(([p, label]) => (
                <div key={p} style={card}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: S.txt, marginBottom: 8 }}>{label} · {audit.scores?.[p] ?? 0}/100</div>
                  {checks.filter((c: any) => c.pillar === p).map((c: any) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, padding: "4px 0", borderTop: `1px solid ${S.line}` }}>
                      <span style={{ flexShrink: 0 }}>{c.status === "ok" ? "✅" : c.status === "warn" ? "⚠️" : "❌"}</span>
                      <span style={{ flex: 1, color: S.txt }}>{c.label}</span>
                      <span style={{ color: S.mut, fontSize: 11, textAlign: "right", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.detail}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: S.mut }}>
            Basis: robots.txt, llms.txt, Sitemap und {audit.mode === "deep" ? "die geprüften Seiten" : "die Startseite"} — Gewichtung Technik 30 % · Inhalt 35 % · AI-Readiness 35 %. Umsetzung der Fixes läuft wie gewohnt über die SEO-Agenten mit Freigabe.
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
type PromptDef = { id: string; prompt: string; topic: string | null; intent: string | null; active: boolean; needs_review: boolean; prompt_type: string | null };

// ── Brand-Facts-Kuration (11.08., Searchable "Brand Facts"-Parität) ──────────
// Das Faktenprofil ist die Abgleichsbasis des Brand-Judge (Faktentreue/
// Halluzinations-Erkennung). Bisher rein maschinell generiert — hier prüft
// und korrigiert es ein Mensch; Bestätigen setzt needs_review=false.
function BrandFactsEditor({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<null | { angebot: string; ort: string; kernfakten: string; needsReview: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch(`/api/admin/brand-facts?client=${encodeURIComponent(clientId)}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) setState({
      angebot: String(j.facts?.angebot || ""),
      ort: String(j.facts?.ort || ""),
      kernfakten: (Array.isArray(j.facts?.kernfakten) ? j.facts.kernfakten : []).join("\n"),
      needsReview: !!j.needsReview,
    });
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!state) return;
    setBusy(true); setMsg("");
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch("/api/admin/brand-facts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ client: clientId, facts: { angebot: state.angebot, ort: state.ort, kernfakten: state.kernfakten.split("\n").map((s) => s.trim()).filter(Boolean) } }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.ok) { setState((s) => (s ? { ...s, needsReview: false } : s)); setMsg("Profil bestätigt — der Fakten-Check nutzt ab jetzt diese Fassung."); }
    else setMsg(j.error || "Speichern fehlgeschlagen");
  };
  if (!state) return null;
  const inp: any = { width: "100%", padding: "7px 10px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 12.5, fontFamily: "inherit" };
  return (
    <div style={{ borderBottom: `1px solid ${S.line}`, padding: "10px 18px" }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", color: S.txt, fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-flex" }}>▸</span>
        Faktenprofil (Grundlage des Fakten-Checks)
        {state.needsReview && (
          <span style={{ marginLeft: 6, borderRadius: 99, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, background: "#fdf6e3", color: "#8a6d1b", border: "1px solid #f0c36d" }}>zur Prüfung</span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: S.mut }}>
            Gegen dieses Profil prüft der Marken-Check, ob KI-Antworten über die Firma faktisch stimmen. Automatisch generiert — bitte prüfen, korrigieren, bestätigen.
          </div>
          <label style={{ fontSize: 11, color: S.mut }}>Angebot
            <input value={state.angebot} onChange={(e) => setState({ ...state, angebot: e.target.value })} style={inp} />
          </label>
          <label style={{ fontSize: 11, color: S.mut }}>Standort(e)
            <input value={state.ort} onChange={(e) => setState({ ...state, ort: e.target.value })} style={inp} />
          </label>
          <label style={{ fontSize: 11, color: S.mut }}>Kernfakten (eine je Zeile, max. 12)
            <textarea value={state.kernfakten} onChange={(e) => setState({ ...state, kernfakten: e.target.value })} rows={5} style={{ ...inp, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={save} disabled={busy}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer", background: S.app, color: "#fff", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Speichert…" : "Profil bestätigen"}
            </button>
            {msg && <span style={{ fontSize: 11.5, color: msg.startsWith("Profil bestätigt") ? "#0f9d6c" : "#dc2626" }}>{msg}</span>}
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
function CorpusQuestionsSection({ clientId, S, onAdded }: { clientId: string; S: Record<string, string>; onAdded: () => void }) {
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
        const r = await fetch(`/api/admin/aivis-competitors?client=${encodeURIComponent(clientId)}&questions=1`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (alive) setState(j.ok ? { questions: j.questions || [], terms: j.terms || [] } : { questions: [], terms: [] });
      } catch { if (alive) setState({ questions: [], terms: [] }); }
    })();
    return () => { alive = false; };
  }, [open, state, clientId]);
  const take = async (q: { q: string; term: string }) => {
    setBusy(q.q);
    const { error } = await (supabase as any).from("ai_visibility_prompt_defs").insert({
      client_id: clientId, prompt: q.q, topic: q.term, active: false, needs_review: true, prompt_type: "markt",
    });
    setBusy("");
    if (!error) { setAdded((s) => new Set(s).add(q.q)); onAdded(); }
  };
  return (
    <div style={{ borderBottom: `1px solid ${S.line}`, padding: "10px 18px" }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", color: S.txt, fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-flex" }}>▸</span>
        Echte Nutzerfragen aus dem KI-Korpus
        <span style={{ fontWeight: 400, fontSize: 11, color: S.mut }}>— belegte Prompt-Kandidaten statt nur generierter</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {state === null ? (
            <div style={{ fontSize: 11.5, color: S.mut }}>Korpus-Fragen werden geladen… (erster Abruf bis ~30 s)</div>
          ) : !state.questions.length ? (
            <div style={{ fontSize: 11.5, color: S.mut }}>Keine passenden Fragen im Schweizer Korpus gefunden.</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: S.mut, marginBottom: 8 }}>
                Fragen, die Nutzer laut DataForSEO-Korpus wirklich an KI-Systeme stellen (Kernbegriffe: {state.terms.join(", ")}). „Übernehmen" legt sie unter „Vorgeschlagen" ab.
              </div>
              {state.questions.map((q: any) => (
                <div key={q.q} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: `1px solid ${S.line}` }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: S.txt }}>{q.q}</span>
                  {q.vol > 0 && <span style={{ flexShrink: 0, fontSize: 10.5, color: S.mut, fontVariantNumeric: "tabular-nums" }}>Vol. {q.vol}</span>}
                  <button onClick={() => take(q)} disabled={added.has(q.q) || busy === q.q}
                    style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 7, border: `1px solid ${added.has(q.q) ? S.line : S.app}`, background: added.has(q.q) ? "transparent" : S.appTint, color: added.has(q.q) ? S.mut : S.app, fontSize: 11, fontWeight: 600, cursor: added.has(q.q) ? "default" : "pointer", fontFamily: "inherit" }}>
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

function PromptCurationPanel({ clientId, onClose, S }: { clientId: string; onClose: () => void; S: Record<string, string> }) {
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
  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, patch: Partial<PromptDef>) => {
    setBusy(id); setErr(null);
    const { error } = await (supabase as any).from("ai_visibility_prompt_defs").update(patch).eq("id", id);
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
  const tabBtn = (id: "review" | "active" | "archived", label: string, n: number, warn?: boolean) => (
    <button key={id} onClick={() => setView(id)}
      style={{ padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer", border: `1px solid ${view === id ? S.app : S.line}`, background: view === id ? S.appTint : "transparent", color: view === id ? S.app : warn && n > 0 ? "#fbbf24" : S.mut }}>
      {label} {n}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(30,28,24,.35)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(680px,100vw)", background: S.bg, borderLeft: `1px solid ${S.line}`, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${S.line}` }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Prompts verwalten</div>
          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
            {tabBtn("review", "Vorgeschlagen", groups.review.length, true)}
            {tabBtn("active", "Aktiv", groups.active.length)}
            {tabBtn("archived", "Archiviert", groups.archived.length)}
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: S.mut, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "8px 18px", fontSize: 11, color: S.mut, borderBottom: `1px solid ${S.line}` }}>
          Nur <b style={{ color: S.txt }}>aktive</b> Prompts laufen im Messzyklus (Kosten!). Archivieren behält die Historie. „Vorgeschlagen" = vom Seeder/Relevanz-Audit zur Prüfung markiert.
        </div>
        <BrandFactsEditor clientId={clientId} S={S} />
        <CorpusQuestionsSection clientId={clientId} S={S} onAdded={() => void load()} />
        {err && <div style={{ margin: "10px 18px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid #f8717155", color: "#f87171", fontSize: 12 }}>{err}</div>}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px 24px" }}>
          {defs === null ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Lade…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Keine Einträge in dieser Ansicht.</div>
          ) : rows.map((d) => (
            <div key={d.id} style={{ border: `1px solid ${S.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: S.panel }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{d.prompt}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {d.topic && <span style={{ fontSize: 10.5, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "2px 8px" }}>{d.topic}</span>}
                {d.intent && <span style={{ fontSize: 10.5, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "2px 8px" }}>{d.intent}</span>}
                {d.prompt_type === "brand" && <span style={{ fontSize: 10.5, color: "#a78bfa", border: "1px solid #a78bfa55", borderRadius: 99, padding: "2px 8px" }}>Marken-Check</span>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {d.needs_review ? (
                    <>
                      <button disabled={busy === d.id} onClick={() => update(d.id, { needs_review: false, active: true })}
                        style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.app}`, background: "transparent", color: S.app }}>
                        ✓ Annehmen
                      </button>
                      <button disabled={busy === d.id} onClick={() => update(d.id, { needs_review: false, active: false })}
                        style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.line}`, background: "transparent", color: S.mut }}>
                        Archivieren
                      </button>
                    </>
                  ) : d.active ? (
                    <button disabled={busy === d.id} onClick={() => update(d.id, { active: false })}
                      style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.line}`, background: "transparent", color: S.mut }}>
                      Archivieren
                    </button>
                  ) : (
                    <button disabled={busy === d.id} onClick={() => update(d.id, { active: true })}
                      style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.app}`, background: "transparent", color: S.app }}>
                      Aktivieren
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Agentur-Übersicht (Volkan 10.08., analog EzyRank) ────────────────────────
// "Alle Kunden": alle berechtigten Kunden als anklickbare Kacheln mit
// KI-Sichtbarkeit / Erwähnungen / Citations aus dem jeweils neuesten
// ai_visibility_report. Batch: EINE Query über alle Kunden-IDs.
function AiAgencyOverview({ clients, onSelect, S }: { clients: any[]; onSelect: (id: string) => void; S: Record<string, string> }) {
  const [stats, setStats] = useState<Record<string, { score: number; mentions: number; citations: number; date: string }>>({});
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
      const next: Record<string, { score: number; mentions: number; citations: number; date: string }> = {};
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
    return () => { alive = false; };
  }, [clients]);
  const tiles = [...clients].sort(
    (a: any, b: any) =>
      (stats[b.id]?.score ?? -1) - (stats[a.id]?.score ?? -1) || String(a.name).localeCompare(String(b.name)),
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 12px" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: S.txt }}>Kunden</h2>
        <span style={{ fontSize: 12, color: S.mut }}>{clients.length} berechtigt</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {tiles.map((c: any) => {
          const st = stats[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              style={{
                textAlign: "left", display: "flex", flexDirection: "column", gap: 12,
                background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 16,
                cursor: "pointer", fontFamily: "inherit", color: S.txt,
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
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: S.appTint, color: S.app, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                  {initials(c.name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "—"}</div>
                  <div style={{ fontSize: 11, color: S.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.domain || "keine Domain"}</div>
                </div>
                {st?.date && (
                  <span title={`Letzter Messlauf: ${st.date}`} style={{ flexShrink: 0, fontSize: 10, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 999, padding: "3px 8px" }}>
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
                    <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{m.value ?? "—"}</div>
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
const S = {
  bg: "#f7f5f9", panel: "#ffffff", line: "#eae4ee",
  txt: "#161217", mut: "#6d6473", app: "#77008C", appTint: "rgba(119,0,140,.09)",
  // Shell-Nav (identisch zur EzyRank-Shell): accentDim/accentLight.
  navAccent: "#B9009C", navDim: "rgba(119,0,140,0.09)",
};
const SIDEBAR_W = 256;
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
  const [curOpen, setCurOpen] = useState(false); // Prompt-Kuration (Nachbau 08/2026)
  const [view, setView] = useState<"dashboard" | "agent">("dashboard"); // Dashboard/Agent-Switcher
  const [section, setSection] = useState("aeo-insights"); // aktiver Sidebar-App-Bereich
  // Zeitraum zentral im Header (Volkan 10.08., Layout wie EzyRank): EINE Quelle
  // für alle Panels, geteilt über alle Apps (Range-Store).
  const [days, setDaysRaw] = useState(() => nearestPanelDays(loadSharedRange()?.days));
  const setDays = (d: number) => { setDaysRaw(d); saveSharedRange({ label: `${d} Tage`, days: d, preset: `${d}d` }); };
  const [clientId, setClientId] = useState(() => {
    try { return localStorage.getItem(CLIENT_LS) || ""; } catch { return ""; }
  });
  // Agentur-Übersicht (10.08.): "Alle Kunden" zeigt Kacheln statt eines Kunden.
  // App-Einstieg (Volkan 11.08., präzisiert): "Alle Kunden" nur beim FRISCHEN
  // Einstieg (Login, App-Wechsel per Link); Reload/Zurück stellt die letzte
  // Auswahl wieder her. Viewer werden ohnehin ins Portal umgeleitet.
  const [showAll, setShowAll] = useState(() => {
    if (isReloadNavigation()) {
      try { return localStorage.getItem("ezyai.showAll.v1") !== "0"; } catch { /* egal */ }
    }
    return true;
  });
  useEffect(() => {
    try { localStorage.setItem("ezyai.showAll.v1", showAll ? "1" : "0"); } catch { /* egal */ }
  }, [showAll]);
  const pickClient = (v: string) => {
    if (v === "__all") { setShowAll(true); return; }
    setClientId(v); setShowAll(false);
  };

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", search: { next: "/ezyai" }, replace: true });
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
        .filter((c: any) => svcMatrix.hasService(c.id, ["canonry", "perplexity"]))
        .filter((c: any) => appEnabledFor(caa.map, c.id, "geo")),
    [ezy.clients, svcMatrix.hasService, caa.map],
  );
  const client = useMemo(
    () => clients.find((c: any) => c.id === clientId) || clients[0] || null,
    [clients, clientId],
  );
  useEffect(() => {
    if (client?.id) { try { localStorage.setItem(CLIENT_LS, client.id); } catch { /* egal */ } }
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
      try { await navigator.clipboard.writeText(full); alert(`Report-Link kopiert (30 Tage gültig):\n${full}`); }
      catch { window.prompt("Report-Link (30 Tage gültig) — kopieren:", full); }
    } else alert(j?.error || "Link konnte nicht erstellt werden");
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", isolation: "isolate", color: S.txt, fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',system-ui,sans-serif" }}>
      {/* Grund + Pattern als -1-Unterlage, Glow ebenfalls -1 (Fix 10.08. abends:
          Inhalt bleibt unangehoben, Popups/Sidebar-Stacking unverändert). */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: -1, backgroundColor: S.bg, backgroundImage: HEX_BG, pointerEvents: "none" }} />
      <HexGlowLayer />
      {/* Mobile (04.08.): Shell-Sidebar wird zur horizontalen Leiste oben. */}
      <style>{`
        .ezyai-shell{display:flex;min-height:100vh}
        .ezyai-side{width:${SIDEBAR_W}px;flex-shrink:0;background:${S.panel};border-right:1px solid ${S.line};display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50;overflow-y:auto}
        .ezyai-body{flex:1;min-width:0;margin-left:${SIDEBAR_W}px}
        .ezyai-mnav{display:none}
        @media(max-width:900px){
          .ezyai-side{display:none}
          .ezyai-body{margin-left:0}
          .ezyai-mnav{display:block;position:sticky;top:0;z-index:40;background:${S.panel};border-bottom:1px solid ${S.line};padding:8px 10px;overflow-x:auto}
          /* Mobile (08.08.): nur die Chip-Nav bleibt sticky — Kopfzeile scrollt
             mit, sonst fressen zwei fixierte Leisten ~110px Viewport-Höhe. */
          .ezyai-chead{flex-wrap:wrap!important;gap:8px!important;padding:10px!important;position:static!important}
          .ezyai-main{padding:14px 10px 48px!important}
        }
      `}</style>

      <div className="ezyai-shell">
        {/* ── Shell-Seitenleiste (identisch zur EzyRank-Shell) ─────────────── */}
        <aside className="ezyai-side">
          {/* Logo */}
          <div style={{ padding: "20px 20px", borderBottom: `1px solid ${S.line}`, display: "flex", alignItems: "center", gap: 10 }}>
            {/* CD-Symbol: Hexagon-Badge mit Marken-Gradient (#71008B→#B9009C). */}
            <div style={{ width: 34, height: 38, clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", background: "linear-gradient(135deg,#71008B,#B9009C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>EO</div>
            <div>
              {/* CD: Wortmarke "Ezy One" — Sentence case, nie ALL CAPS. */}
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.2px", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Ezy One</div>
              <div style={{ fontSize: 10, color: S.mut }}>SEO &amp; GEO Platform</div>
            </div>
          </div>

          {/* App-Switcher */}
          <div style={{ position: "relative", borderBottom: `1px solid ${S.line}`, padding: "8px 10px" }}>
            <button
              onClick={() => setSwOpen((v) => !v)}
              title="App wechseln"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: swOpen ? "rgba(0,0,0,.05)" : "none", border: "none", borderRadius: 8, padding: "8px 10px", color: S.app, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}
            >
              <span style={{ fontSize: 14, lineHeight: 1, letterSpacing: 1 }}>⣿</span>
              <span style={{ color: S.app }}>EzyAI</span>
            </button>
            {swOpen && (
              <div style={{ position: "absolute", top: "100%", left: 10, zIndex: 200, width: 236, background: S.panel, border: `1px solid ${S.line}`, borderRadius: 12, padding: 8, boxShadow: "0 14px 44px rgba(0,0,0,.14)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: S.mut, padding: "4px 10px 8px", fontWeight: 700 }}>Apps wechseln</div>
                {EZY_APPS.filter((a) => canOpen(a.id)).map((a) => {
                  const active = a.id === "geo";
                  return (
                    <a key={a.id} href={a.href}
                      onClick={(e) => { if (active) { e.preventDefault(); setSwOpen(false); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, fontSize: 13, textDecoration: "none", color: active ? a.color : S.txt, background: active ? a.tint : "none" }}>
                      <span style={{ width: 24, height: 24, borderRadius: 6, background: a.tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{a.icon}</span>
                      {a.name}
                    </a>
                  );
                })}
                <div style={{ borderTop: `1px solid ${S.line}`, margin: "8px 4px" }} />
                <a href="/apps" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, textDecoration: "none", color: S.mut }}>✦ Zum Launcher</a>
              </div>
            )}
          </div>

          {/* Kunden-Auswahl (Searchable-Position: oben in der Sidebar) */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.line}` }}>
            <select
              value={showAll ? "__all" : client?.id || ""}
              onChange={(e) => pickClient(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 13, fontFamily: "inherit" }}
            >
              <option value="__all">Alle Kunden</option>
              {clients.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>

          {/* Dashboard / Agent — Switcher */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.line}` }}>
            <div style={{ display: "flex", gap: 4, background: S.bg, border: `1px solid ${S.line}`, borderRadius: 10, padding: 3 }}>
              {([["dashboard", "Dashboard", LayoutDashboard], ["agent", "Agent", Bot]] as const).map(([v, label, Icon]) => {
                const a = view === v;
                return (
                  <button key={v} onClick={() => setView(v)}
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: a ? S.panel : "transparent", color: a ? S.txt : S.mut, fontSize: 12.5, fontWeight: a ? 700 : 500, boxShadow: a ? "0 1px 2px rgba(0,0,0,.06)" : "none", fontFamily: "inherit" }}>
                    <Icon size={14} />{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* App-Nav (AEO Insights aktiv, Rest In Vorbereitung). Bei "Alle
              Kunden" (Agentur-Übersicht) bleibt die Navigation bewusst leer —
              die Bereiche sind kundenspezifisch (Volkan 10.08.). */}
          <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
            {!showAll && APP_NAV.map((g, gi) => (
              <div key={g.group} style={{ marginTop: gi ? 14 : 0 }}>
                <div style={{ padding: "0 14px 6px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: S.mut }}>{g.group}</div>
                {g.items.map((t) => {
                  const Icon = t.icon;
                  const a = view === "dashboard" && section === t.id;
                  return (
                    <button key={t.id} onClick={() => { setView("dashboard"); setSection(t.id); }}
                      title={t.soon ? "In Vorbereitung" : undefined}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: a ? S.navDim : "transparent", color: a ? S.navAccent : S.mut, fontSize: 13, fontWeight: a ? 600 : 400, marginBottom: 2, transition: "all .15s", fontFamily: "inherit", opacity: t.soon ? 0.75 : 1 }}>
                      <Icon size={18} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{t.label}</span>
                      {t.soon ? <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "1px 6px" }}>bald</span> : null}
                      {t.badge && t.badge > 0 ? <span style={{ background: "#fdf6e3", color: "#8a6d1b", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{t.badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Suche/Prompts (gleiche Position wie die ⌘K-Box der EzyRank-Shell) */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${S.line}` }}>
            <button onClick={() => setCurOpen(true)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: S.bg, border: `1px solid ${S.line}`, cursor: "pointer", color: S.mut, fontSize: 12, fontFamily: "inherit" }}>
              <Search size={13} />
              Prompts verwalten
            </button>
          </div>

          {/* Profil */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${S.line}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: S.app, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>{initials(profile.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: S.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name || "—"}</div>
              <div style={{ fontSize: 10, color: S.mut }}>{profile.role}</div>
            </div>
            <LogOut size={14} color={S.mut} style={{ cursor: "pointer" }} onClick={() => supabase.auth.signOut()} />
          </div>
        </aside>

        {/* ── Content ──────────────────────────────────────────────────────── */}
        <div className="ezyai-body">
          {/* Mobile-Nav: Dashboard/Agent + Kunden + App-Bereiche als Chips */}
          <div className="ezyai-mnav">
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              {([["dashboard", "Dashboard"], ["agent", "Agent"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: view === v ? S.navDim : S.bg, color: view === v ? S.navAccent : S.mut, fontSize: 12.5, fontWeight: view === v ? 700 : 500, fontFamily: "inherit" }}>{label}</button>
              ))}
              <select value={showAll ? "__all" : client?.id || ""} onChange={(e) => pickClient(e.target.value)}
                style={{ marginLeft: "auto", padding: "6px 8px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 12.5, maxWidth: 180 }}>
                <option value="__all">Alle Kunden</option>
                {clients.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
            {/* Bereichs-Chips nur mit gewähltem Kunden — "Alle Kunden" = leer. */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}>
              {!showAll && APP_NAV.flatMap((g) => g.items).map((t) => {
                const Icon = t.icon;
                const a = view === "dashboard" && section === t.id;
                return (
                  <button key={t.id} onClick={() => { setView("dashboard"); setSection(t.id); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", padding: "7px 11px", borderRadius: 10, border: "none", cursor: "pointer", background: a ? S.navDim : "transparent", color: a ? S.navAccent : S.mut, fontSize: 12.5, fontWeight: a ? 600 : 400, fontFamily: "inherit", opacity: t.soon ? 0.7 : 1 }}>
                    <Icon size={15} />{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kontext-Kopfzeile: Bereichs-Titel + Aktionen (Kunde ist jetzt in der Sidebar) */}
          <header className="ezyai-chead" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", background: S.panel, borderBottom: `1px solid ${S.line}`, position: "sticky", top: 0, zIndex: 30 }}>
            {/* Filter statt Titel im Header (Volkan 10.08., wie EzyRank) —
                der Bereichs-Titel steht jetzt im Body. */}
            {view !== "agent" && !showAll && (
              <div style={{ display: "flex", alignItems: "center", gap: 2, background: S.bg, border: `1px solid ${S.line}`, borderRadius: 10, padding: 3 }}>
                {[7, 30, 90].map((d) => (
                  <button key={d} onClick={() => setDays(d)}
                    style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, background: days === d ? S.appTint : "transparent", color: days === d ? S.app : S.mut }}>
                    {d} Tage
                  </button>
                ))}
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {isOrgAdmin && client?.id && !showAll && (
                <button onClick={shareReport} style={{ fontSize: 12, color: S.app, background: "none", cursor: "pointer", border: `1px solid ${S.app}55`, borderRadius: 8, padding: "6px 12px" }}>Report teilen</button>
              )}
              <a href="/llm-ueberblick" style={{ fontSize: 12, color: S.mut, textDecoration: "none", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>LLM-Überblick</a>
            </div>
          </header>

          <main className="ezyai-main" style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 22px 60px" }}>
            {/* Bereichs-Titel im Body (Volkan 10.08., Layout wie EzyRank). */}
            {view !== "agent" && (
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{showAll ? "Agentur-Übersicht" : NAV_LABEL[section] || "Insights"}</h1>
                {!showAll && client && (
                  <div style={{ fontSize: 13, color: S.mut, marginTop: 4 }}>
                    {client.name}{(client as { domain?: string }).domain ? ` — ${(client as { domain?: string }).domain}` : ""} • {days} Tage
                  </div>
                )}
              </div>
            )}
            {view === "agent" ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "40px auto 0" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: S.appTint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                  <Sparkles size={26} color={S.app} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>EzyPilot</div>
                <div style={{ fontSize: 13, color: S.mut, lineHeight: 1.5, marginBottom: 18 }}>
                  Der KI-Assistent für Daten- und Portal-Fragen, Agenten-Bau und das Obsidian-Gedächtnis{client ? ` — im Kontext von ${client.name}` : ""}.
                </div>
                <a href="/pilot" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: S.app, color: "#fff", textDecoration: "none", fontSize: 13.5, fontWeight: 600 }}>
                  <Bot size={16} /> EzyPilot öffnen
                </a>
              </div>
            ) : ezy.loading && !clients.length ? (
              <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Lade Kunden…</div>
            ) : showAll ? (
              <AiAgencyOverview clients={clients} S={S} onSelect={pickClient} />
            ) : !client ? (
              <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Keine Kunden zugewiesen.</div>
            ) : section === "llm-analytics" ? (
              <LlmAnalyticsPanel clientId={client.id} S={S} days={days} />
            ) : section === "traffic" ? (
              <TrafficPanel clientId={client.id} S={S} days={days} />
            ) : section === "ki-konkurrenz" ? (
              <CompetitorsPanel clientId={client.id} S={S} />
            ) : section === "site-health" || section === "issues" ? (
              <SiteHealthPanel clientId={client.id} S={S} mode={section === "issues" ? "issues" : "health"} />
            ) : section === "opportunities" ? (
              <OpportunitiesPanel clientId={client.id} clientName={client.name} S={S} onOpenCuration={() => setCurOpen(true)} onGo={setSection} />
            ) : section !== "aeo-insights" ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "40px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🧭</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{NAV_LABEL[section]} — in Vorbereitung</div>
                <div style={{ fontSize: 13, color: S.mut }}>Dieser Bereich wird noch konfiguriert. Der volle KI-Sichtbarkeits-Report liegt unter „Insights".</div>
              </div>
            ) : !aivisOn ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "60px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🤖</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>KI-Sichtbarkeit ist für {client.name} nicht aktiviert</div>
                <div style={{ fontSize: 13, color: S.mut }}>Der Service lässt sich im Admin unter Kunden → Services (Canonry / Perplexity) einschalten.</div>
              </div>
            ) : (
              <>
                <AiVisibilityTab selectedClient={client} navStyle="topbar" onReviewPrompts={() => setCurOpen(true)} />
                <CrawlerCard clientId={client.id} S={S} />
              </>
            )}
          </main>
        </div>
      </div>
      {curOpen && client?.id && <PromptCurationPanel clientId={client.id} onClose={() => setCurOpen(false)} S={S} />}
    </div>
  );
}

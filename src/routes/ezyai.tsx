import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { useEzyServiceMatrix } from "@/ezy/data/useEzyServiceMatrix";
import { AiVisibilityTab } from "@/ezy/EzyOneApp.jsx";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import {
  Search, LogOut, LineChart, Zap, Activity, MessageSquare, GraduationCap,
  FileText, Lightbulb, Globe, AlertTriangle, LayoutDashboard, Bot, Sparkles,
} from "lucide-react";

// Initialen aus einem Namen (Shell-Profilblock, wie in der EzyRank-Shell).
function initials(name: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// App-Navigation der Sidebar (Searchable-Struktur). "AEO Insights" = heutiges
// Dashboard; alle übrigen Bereiche sind Platzhalter (soon), bis konfiguriert.
type NavItem = { id: string; label: string; icon: any; soon?: boolean; badge?: number };
const APP_NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Analytics", items: [
    { id: "aeo-insights", label: "AEO Insights", icon: LineChart },
    { id: "llm-analytics", label: "LLM Analytics", icon: Zap },
    { id: "traffic", label: "Traffic", icon: Activity },
  ] },
  { group: "Prompts", items: [
    { id: "your-prompts", label: "Your Prompts", icon: MessageSquare, soon: true },
    { id: "prompt-research", label: "Prompt Research", icon: GraduationCap, soon: true },
  ] },
  { group: "Actions", items: [
    { id: "content", label: "Content", icon: FileText, soon: true },
    { id: "opportunities", label: "Opportunities", icon: Lightbulb, soon: true },
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

function LlmAnalyticsPanel({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [days, setDays] = useState(30);
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
    setTraffic(null);
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/llm-traffic?client=${encodeURIComponent(clientId)}&days=${days}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await r.json().catch(() => ({}));
        if (alive) setTraffic(j.ok ? j : { ok: false, error: j.error || `HTTP ${r.status}` });
      } catch (e: any) {
        if (alive) setTraffic({ ok: false, error: String(e?.message || e) });
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
  const RW = 1000, RH = 190, RP = 8, RAXL = 34, RAXB = 16;
  const refMax = Math.max(1, ...dayKeys.map((k) => engines.reduce((a, e) => Math.max(a, tsByDay.get(k)?.[e]?.sessions || 0), 0)));
  const rx = (i: number) => RAXL + RP + (i / Math.max(1, dayKeys.length - 1)) * (RW - RAXL - 2 * RP);
  const ry = (v: number) => RH - RAXB - RP - (v / refMax) * (RH - RAXB - 2 * RP);
  // Crawler-Balkenchart
  const CW = 1000, CH = 150, CP = 8, CAXL = 34, CAXB = 16;
  const crMax = Math.max(1, ...dayKeys.map((k) => crawler.byDay[k] || 0));
  const cx = (i: number) => CAXL + CP + (i / Math.max(1, dayKeys.length)) * (CW - CAXL - 2 * CP);
  const cy = (v: number) => CH - CAXB - CP - (v / crMax) * (CH - CAXB - 2 * CP);
  const barW = Math.max(2, (CW - CAXL - 2 * CP) / Math.max(1, dayKeys.length) - 2);
  const labelEvery = Math.max(1, Math.ceil(dayKeys.length / 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Zeitraum */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: S.mut }}>Zeitraum</span>
        <div style={{ display: "flex", border: `1px solid ${S.line}`, borderRadius: 8, padding: 2, background: S.panel }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: days === d ? S.app : "transparent", color: days === d ? "#fff" : S.mut }}>
              {d} Tage
            </button>
          ))}
        </div>
      </div>

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
            <svg viewBox={`0 0 ${RW} ${RH}`} style={{ width: "100%", maxHeight: 240 }}>
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
          <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: "100%", maxHeight: 190 }}>
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
  "Paid Search": "#dc2626", "Organic Social": "#7c3aed", "Email": "#0b76b7",
  "Cross-network": "#b45309", "Unassigned": "#9ca3af",
};
const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// SEO×AEO-Quadranten (Searchable GSC-Doku): GSC-Keywords gegen die KI-Erwähnungs-
// quote der thematisch passenden Mess-Prompts (Wortüberlappung wie beim
// AI-Volumen-Feature). Schwellen: SEO hoch = Position ≤ 10, AEO hoch = ≥ 30 %.
const QUAD_STOP = new Set(["der", "die", "das", "und", "oder", "für", "fuer", "mit", "von", "aus", "bei", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "auf", "als", "was", "wie", "wer", "ist", "sind", "the", "for", "and", "was", "you", "your", "nach", "zum", "zur", "über", "ueber"]);
const kwWords = (kw: string) => kw.toLowerCase().split(/[^a-zäöüéèà0-9]+/).filter((w) => w.length >= 3 && !QUAD_STOP.has(w));
const stemOf = (w: string) => (w.length > 7 ? w.slice(0, 7) : w);

function TrafficPanel({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null); setErr("");
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(`/api/admin/traffic-overview?client=${encodeURIComponent(clientId)}&days=${days}`, {
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

  // App-Split (06.08., Volkan): EzyAI zeigt NUR die KI-Sicht — Kanal-Trends,
  // GSC-Klicks & klassisches SEO leben in EzyRank. Die Gesamt-Sessions dienen
  // hier nur als Bezugsgröße für den KI-Anteil.
  const totalSessions = Object.values((data?.channels?.totals || {}) as Record<string, number>).reduce((a, b) => a + b, 0);
  const aiSeg = (data?.segments || []).find((s: any) => s.name === "KI-Antworten");
  const aiShare = totalSessions && aiSeg ? Math.round((aiSeg.sessions / totalSessions) * 1000) / 10 : 0;
  const orgSeg = (data?.segments || []).find((s: any) => s.name === "Organische Suche");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: S.mut }}>Zeitraum</span>
        <div style={{ display: "flex", border: `1px solid ${S.line}`, borderRadius: 8, padding: 2, background: S.panel }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: days === d ? S.app : "transparent", color: days === d ? "#fff" : S.mut }}>
              {d} Tage
            </button>
          ))}
        </div>
        {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
      </div>

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
            const QW = 1000, QH = 300, QP = 14, QAXL = 40, QAXB = 24;
            const qx = (pos: number) => QAXL + QP + ((30 - Math.min(pos, 30)) / 30) * (QW - QAXL - 2 * QP);
            const qy = (aeo: number) => QH - QAXB - QP - (aeo / 100) * (QH - QAXB - 2 * QP);
            const maxImp = Math.max(1, ...quad.measured.map((p: any) => p.impressions));
            const rOf = (imp: number) => 3 + Math.sqrt(imp / maxImp) * 6;
            const QCOLOR: Record<string, string> = { staerken: "#0f9d6c", kiPotenzial: "#7c3aed", seoPotenzial: "#0b76b7", aufbau: "#9ca3af" };
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
                <svg viewBox={`0 0 ${QW} ${QH}`} style={{ width: "100%", maxHeight: 340 }}>
                  {/* Quadranten-Hintergründe */}
                  <rect x={qx(10)} y={qy(100)} width={QW - QP - qx(10)} height={qy(30) - qy(100)} fill="#0f9d6c" opacity={0.06} />
                  <rect x={qx(10)} y={qy(30)} width={QW - QP - qx(10)} height={qy(0) - qy(30)} fill="#7c3aed" opacity={0.07} />
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
                  <text x={QW - QP - 6} y={qy(0) - 8} fontSize={10.5} fontWeight={700} fill="#7c3aed" textAnchor="end">KI-Potenzial</text>
                  <text x={QAXL + QP + 6} y={qy(100) + 14} fontSize={10.5} fontWeight={700} fill="#0b76b7">SEO-Potenzial</text>
                  <text x={QAXL + QP + 6} y={qy(0) - 8} fontSize={10.5} fontWeight={700} fill="#9ca3af">Aufbau nötig</text>
                  {quad.measured.map((p: any) => (
                    <circle key={p.query} cx={qx(p.position)} cy={qy(p.aeo)} r={rOf(p.impressions)}
                      fill={QCOLOR[bucketOf(p)]} opacity={0.75} stroke="#fff" strokeWidth={1}>
                      <title>{`${p.query}\nGoogle-Position ${p.position} · ${p.impressions.toLocaleString("de-CH")} Impressionen\nKI-Quote ${p.aeo} % (${p.matchedPrompts} passende Prompts)`}</title>
                    </circle>
                  ))}
                </svg>
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

export const Route = createFileRoute("/ezyai")({
  component: EzyAiApp,
});

// Plattform-Umbau Phase 2 (2026-07-31): EzyAI als erste eigenständige App.
// Die Fach-Komponente (AiVisibilityTab) ist aus dem Dashboard UMGEZOGEN, nicht
// neu gebaut — diese Route liefert nur die App-Shell drumherum (Header mit
// App-Switcher, Kunden-Auswahl, Service-Gate). Muster für Phase 3.
// Light Studio (2026-08-03): hell à la Searchable
const S = {
  bg: "#f7f6f2", panel: "#ffffff", line: "#e8e6df",
  txt: "#1c1c1e", mut: "#6e6c64", app: "#7c3aed", appTint: "rgba(124,58,237,.10)",
  // Shell-Nav (identisch zur EzyRank-Shell): accentDim/accentLight.
  navAccent: "#5b4bd6", navDim: "rgba(108,92,231,0.10)",
};
const SIDEBAR_W = 256;
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
  const [clientId, setClientId] = useState(() => {
    try { return localStorage.getItem(CLIENT_LS) || ""; } catch { return ""; }
  });

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
  const svcMatrix = useEzyServiceMatrix();
  const clients = useMemo(
    () => (ezy.clients || []).filter((c: any) => svcMatrix.hasService(c.id, ["canonry", "perplexity"])),
    [ezy.clients, svcMatrix.hasService],
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
    <div style={{ minHeight: "100vh", background: S.bg, color: S.txt, fontFamily: '"Segoe UI",system-ui,-apple-system,sans-serif' }}>
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
          .ezyai-chead{flex-wrap:wrap!important;gap:8px!important;padding:10px!important}
          .ezyai-main{padding:14px 10px 48px!important}
        }
      `}</style>

      <div className="ezyai-shell">
        {/* ── Shell-Seitenleiste (identisch zur EzyRank-Shell) ─────────────── */}
        <aside className="ezyai-side">
          {/* Logo */}
          <div style={{ padding: "20px 20px", borderBottom: `1px solid ${S.line}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6c5ce7,#0284c7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0 }}>EO</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.3px" }}>EZY ONE</div>
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
              value={client?.id || ""}
              onChange={(e) => setClientId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 13, fontFamily: "inherit" }}
            >
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

          {/* App-Nav (Searchable-Struktur; AEO Insights aktiv, Rest In Vorbereitung) */}
          <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
            {APP_NAV.map((g, gi) => (
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
              <select value={client?.id || ""} onChange={(e) => setClientId(e.target.value)}
                style={{ marginLeft: "auto", padding: "6px 8px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 12.5, maxWidth: 180 }}>
                {clients.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}>
              {APP_NAV.flatMap((g) => g.items).map((t) => {
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
            <div style={{ fontSize: 15, fontWeight: 700, color: S.txt }}>
              {view === "agent" ? "Agent" : NAV_LABEL[section] || "AEO Insights"}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {isOrgAdmin && client?.id && (
                <button onClick={shareReport} style={{ fontSize: 12, color: S.app, background: "none", cursor: "pointer", border: `1px solid ${S.app}55`, borderRadius: 8, padding: "6px 12px" }}>Report teilen</button>
              )}
              <a href="/llm-ueberblick" style={{ fontSize: 12, color: S.mut, textDecoration: "none", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>LLM-Überblick</a>
            </div>
          </header>

          <main className="ezyai-main" style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 22px 60px" }}>
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
            ) : !client ? (
              <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Keine Kunden zugewiesen.</div>
            ) : section === "llm-analytics" ? (
              <LlmAnalyticsPanel clientId={client.id} S={S} />
            ) : section === "traffic" ? (
              <TrafficPanel clientId={client.id} S={S} />
            ) : section === "site-health" || section === "issues" ? (
              <SiteHealthPanel clientId={client.id} S={S} mode={section === "issues" ? "issues" : "health"} />
            ) : section !== "aeo-insights" ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "40px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🧭</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{NAV_LABEL[section]} — in Vorbereitung</div>
                <div style={{ fontSize: 13, color: S.mut }}>Dieser Bereich wird noch konfiguriert. Der volle KI-Sichtbarkeits-Report liegt unter „AEO Insights".</div>
              </div>
            ) : !aivisOn ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "60px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🤖</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>KI-Sichtbarkeit ist für {client.name} nicht aktiviert</div>
                <div style={{ fontSize: 13, color: S.mut }}>Der Service lässt sich im Admin unter Kunden → Services (Canonry / Perplexity) einschalten.</div>
              </div>
            ) : (
              <>
                <AiVisibilityTab selectedClient={client} navStyle="topbar" />
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

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Sparkles, TrendingUp, TrendingDown, Quote, FileText, Eye,
  ExternalLink, MousePointerClick, ChevronRight, ChevronLeft, MessageSquareQuote,
  Filter, Hash, Layers, Link2, Info, MessageSquare, Swords, Tags,
} from "lucide-react";

// ── Karten-Shell im Searchable-Muster (03.08.2026): Icon + Titel + ⓘ-Tooltip
// + gedämpfte Beschreibung im Kopf; Fußzeile mit Stand-Text + optionaler
// Legende/Aktion. Einheitliche Optik für alle Report-Karten.
function RCard({ icon: Icon, title, info, desc, footer, legend, children, pad = true }) {
  return (
    <div className="rounded-xl border" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: C.line }}>
        {Icon && <Icon size={15} style={{ color: C.sub, flexShrink: 0 }} />}
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>{title}</h3>
        {info && (
          <span title={info} style={{ color: C.sub, cursor: "help", display: "inline-flex" }}>
            <Info size={13} />
          </span>
        )}
        {desc && <span className="truncate text-[12px]" style={{ color: C.sub }}>· {desc}</span>}
      </div>
      <div className={pad ? "px-5 py-4" : ""}>{children}</div>
      {(footer || legend) && (
        <div className="flex items-center justify-between border-t px-5 py-2.5 text-[11px]" style={{ borderColor: C.line, color: C.sub }}>
          <span>{footer || ""}</span>
          {legend || null}
        </div>
      )}
    </div>
  );
}
// Weak→Strong-Farblegende (Searchable-Fußzeilen-Muster)
function HeatLegend({ from = "Schwach", to = "Stark" }) {
  const cols = ["#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#6ee7b7"];
  return (
    <span className="inline-flex items-center gap-1.5">
      {from}
      <span className="inline-flex overflow-hidden rounded-sm">
        {cols.map((c) => <span key={c} style={{ width: 14, height: 8, background: c, display: "inline-block" }} />)}
      </span>
      {to}
    </span>
  );
}

/**
 * EzyHub — AI Visibility Dashboard (Hybrid)
 * -----------------------------------------------------------------------------
 * Layout/Charts wie in der Referenz — Farben auf die DUNKLE EzyOneApp-Palette
 * umgestellt, damit der KI-Tab optisch zum Rest der App passt. Daten kommen als
 * { data }-Prop im AIVisibilityData-Vertrag (src/ezy/data/useEzyAIVisibility.ts).
 * Jede Model-Zeile trägt `layer`: "macro" = Ahrefs Brand Radar,
 * "custom" = Prompt-Runner (Claude/Grok/DeepSeek etc.).
 */

// ── Tokens (dunkel, angeglichen an EzyOneApps C-Palette) ─────────────────────
// Light Studio (2026-08-03): hell à la Searchable — erbt hellen App-Hintergrund.
const C = {
  page: "transparent",
  card: "#ffffff",
  cardAlt: "#f7f6f2",  // aufgeklappte Zeilen / subtile Panels
  track: "#ecebe4",    // Balken-/Fortschritt-Hintergrund, Chips
  ink: "#1c1c1e",      // Haupttext
  sub: "#6e6c64",      // gedämpft
  line: "#e8e6df",     // Rahmen
  indigo: "#6c5ce7",
  teal: "#0d9488",
  amber: "#d97706",
  violet: "#7c5cf0",
  up: "#0f9d6c", down: "#dc2626",
};
const CARD = { background: C.card, borderColor: C.line };

const nf = (n) => new Intl.NumberFormat("de-CH").format(n);
const POS_LABEL = { top: "Top-Empfehlung", list: "in Liste", passing: "Randnotiz", none: "nicht genannt" };
const SENT_LABEL = { pos: "positiv", neu: "neutral", neg: "negativ" };
const SENT_COLOR = (s) => ({ pos: "#10b981", neu: "#8b8da3", neg: "#ef4444" }[s] || "#8b8da3");

// ── Small pieces ─────────────────────────────────────────────────────────────
function Delta({ v }) {
  const up = v >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold"
      style={{ color: up ? C.up : C.down }}>
      <Icon size={13} strokeWidth={2.5} /> {up ? "+" : ""}{v}
    </span>
  );
}

function ScoreRing({ value, delta, modelCount }) {
  const r = 34, circ = 2 * Math.PI * r, off = circ - (value / 100) * circ;
  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: 88, height: 88 }}>
        <svg width="88" height="88" className="-rotate-90">
          <circle cx="44" cy="44" r={r} fill="none" stroke={C.track} strokeWidth="8" />
          <circle cx="44" cy="44" r={r} fill="none" stroke={C.indigo} strokeWidth="8"
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
            style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color: C.ink }}>{value}</span>
          <span className="text-[10px] font-medium" style={{ color: C.sub }}>/ 100</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.ink }}>
          <Sparkles size={15} style={{ color: C.indigo }} /> KI-Sichtbarkeit
        </div>
        <div className="mt-1"><Delta v={delta} /> <span className="text-xs" style={{ color: C.sub }}>vs. Vormonat</span></div>
        <div className="mt-1.5 text-xs" style={{ color: C.sub }}>Über alle {modelCount} Modelle · Alle Länder</div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, delta, prev, color }) {
  return (
    <div className="rounded-xl border p-4" style={CARD}>
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: C.sub }}>
        <Icon size={14} style={{ color }} /> {label}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-3xl font-bold tabular-nums" style={{ color: C.ink }}>{nf(value)}</span>
        <Delta v={delta} />
      </div>
      <div className="mt-1 text-[11px]" style={{ color: C.sub }}>Vormonat {nf(prev)}</div>
    </div>
  );
}

// ── Signature: Verteilung nach Modell (Macro vs. Custom) ─────────────────────
function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
      style={{
        borderColor: active ? C.indigo : C.line,
        background: active ? C.indigo : C.card,
        color: active ? "#fff" : C.sub,
      }}
    >
      {children}
    </button>
  );
}

function ModelDistribution({ models }) {
  const totals = {};
  models.forEach((m) =>
    Object.entries(m.byCountry || {}).forEach(([c, v]) => {
      totals[c] = (totals[c] || 0) + v;
    })
  );
  const countries = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

  const [sel, setSel] = useState(null);

  const rows = models.map((m) => ({
    ...m,
    value: sel ? (m.byCountry?.[sel] || 0) : m.mentions,
  }));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="rounded-xl border p-5" style={CARD}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Verteilung nach Modell</h3>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterChip active={!sel} onClick={() => setSel(null)}>Alle Länder</FilterChip>
        {countries.map((c) => (
          <FilterChip key={c} active={sel === c} onClick={() => setSel(c)}>{c}</FilterChip>
        ))}
      </div>

      <div className="mt-4 space-y-2.5">
        {sorted.map((m) => (
          <div key={m.name} className="flex items-center gap-3">
            <div className="w-44 shrink-0 text-xs font-medium" style={{ color: C.ink }}>{m.name}</div>
            <div className="relative h-6 flex-1 overflow-hidden rounded" style={{ background: C.track }}>
              <div className="h-full rounded transition-all"
                style={{
                  width: `${(m.value / max) * 100}%`,
                  minWidth: m.value > 0 ? 8 : 0,
                  background: C.indigo,
                }} />
            </div>
            <div className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: C.ink }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendCard({ data }) {
  return (
    <div className="rounded-xl border p-5" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex items-center gap-2">
        <TrendingUp size={15} style={{ color: C.sub }} />
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>Entwicklung</h3>
        <span title="Monatlicher Verlauf von Erwähnungen, Citations und referenzierten Seiten (je Monat der neueste Report)." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={13} /></span>
        <span className="text-[12px]" style={{ color: C.sub }}>· 12 Monate</span>
      </div>
      <div className="mt-3" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              {[["gM", C.indigo], ["gC", C.teal], ["gP", C.amber]].map(([id, col]) => (
                <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={col} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={col} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 12 }} />
            <Area type="monotone" dataKey="mentions" name="Erwähnungen" stroke={C.indigo} fill="url(#gM)" strokeWidth={2} />
            <Area type="monotone" dataKey="citations" name="Citations" stroke={C.teal} fill="url(#gC)" strokeWidth={2} />
            <Area type="monotone" dataKey="pages" name="Ref. Seiten" stroke={C.amber} fill="url(#gP)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-4 text-[11px]" style={{ color: C.sub }}>
        {[["Erwähnungen", C.indigo], ["Citations", C.teal], ["Ref. Seiten", C.amber]].map(([l, c]) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {l}
          </span>
        ))}
      </div>
    </div>
  );
}

const intentColor = (i) => ({
  Kommerziell: C.violet, Transaktional: C.teal,
  Informativ: C.indigo, Navigativ: C.sub,
}[i] || C.sub);

const TOPICS_PAGE_SIZE = 10;
function TopicsTable({ rows }) {
  // 10er-Pagination wie bei den Prompts (User-Wunsch 2026-07-19).
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / TOPICS_PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const pageRows = rows.slice(cur * TOPICS_PAGE_SIZE, (cur + 1) * TOPICS_PAGE_SIZE);
  return (
    <div className="rounded-xl border" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <Tags size={15} style={{ color: C.sub }} />
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>Erfolgreichste Themen</h3>
        <span title="Themen-Cluster der Prompts mit Sichtbarkeit, Erwähnungen und KI-Suchvolumen." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={13} /></span>
        <span className="truncate text-[12px]" style={{ color: C.sub }}>· Sichtbarkeit je Themen-Cluster</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>
              <th className="px-5 py-2 font-medium">Thema</th>
              <th className="px-3 py-2 text-right font-medium">Sichtbar.</th>
              <th className="px-3 py-2 text-right font-medium">Erwähn.</th>
              <th className="px-3 py-2 text-right font-medium">AI-Vol.</th>
              <th className="px-5 py-2 font-medium">Intent</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.topic} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-5 py-2.5" style={{ color: C.ink }}>{r.topic}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-10 overflow-hidden rounded-full" style={{ background: C.track }}>
                      <span className="block h-full rounded-full" style={{ width: `${r.vis}%`, background: C.indigo }} />
                    </span>
                    <span className="tabular-nums font-medium" style={{ color: C.ink }}>{r.vis}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.ink }}>{r.mentions}</td>
                {/* "–" = keine Volumen-Daten (AI-Suchvolumen existiert nur für
                    gängige Suchbegriffe) — bewusst NICHT 0 anzeigen. */}
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.sub }}
                    title={r.vol == null ? "Für dieses Thema liegt kein KI-Suchvolumen vor" : "Geschätzte monatliche Anfragen an KI-Systeme"}>
                  {r.vol == null ? "–" : nf(r.vol)}
                </td>
                <td className="px-5 py-2.5">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: `${intentColor(r.intent)}26`, color: intentColor(r.intent) }}>
                    {r.intent}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: C.line }}>
          <span className="text-[11px]" style={{ color: C.sub }}>
            {cur * TOPICS_PAGE_SIZE + 1}–{Math.min(rows.length, (cur + 1) * TOPICS_PAGE_SIZE)} von {rows.length} Themen
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, cur - 1))}
              disabled={cur === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-35"
              style={{ borderColor: C.line, color: C.sub }}
              aria-label="Vorherige Seite"
            >
              <ChevronLeft size={14} />
            </button>
            {pageNumbers(cur, pages).map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="px-1 text-xs" style={{ color: C.sub }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="h-7 min-w-7 rounded-md px-1.5 text-xs font-medium tabular-nums transition"
                  style={{
                    background: p === cur ? C.indigo : "transparent",
                    color: p === cur ? "#fff" : C.sub,
                    border: `1px solid ${p === cur ? C.indigo : C.line}`,
                  }}
                >
                  {p + 1}
                </button>
              ),
            )}
            <button
              onClick={() => setPage(Math.min(pages - 1, cur + 1))}
              disabled={cur >= pages - 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-35"
              style={{ borderColor: C.line, color: C.sub }}
              aria-label="Nächste Seite"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourcesTable({ rows }) {
  return (
    <div className="rounded-xl border" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <Link2 size={15} style={{ color: C.sub }} />
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>Referenzierte Quellen</h3>
        <span title="Alle Domains, die in KI-Antworten als Quelle verlinkt oder genannt wurden." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={13} /></span>
        <span className="truncate text-[12px]" style={{ color: C.sub }}>· Jede zitierte Domain über alle KI-Antworten</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>
              <th className="px-5 py-2 font-medium">Domain</th>
              <th className="px-3 py-2 text-right font-medium">Erwähn.</th>
              <th className="px-3 py-2 text-right font-medium">Anteil</th>
              <th className="px-3 py-2 text-right font-medium">URLs</th>
              <th className="px-5 py-2 text-right font-medium">Org. Traffic</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.domain} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-5 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: C.indigo }}>
                    {r.domain} <ExternalLink size={11} />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.ink }}>{r.mentions}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.sub }}>{r.share}%</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.sub }}>{r.urls}</td>
                <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: C.sub }}>{nf(r.traffic)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Quelle->Engine-Zuordnung (identisch zur Server-Seite ENGINES in aivis-sync).
const ATTR_SOURCE_RE = {
  ChatGPT: /chatgpt|openai/i,
  Perplexity: /perplexity/i,
  Gemini: /gemini|bard/i,
  Claude: /claude|anthropic/i,
  Copilot: /copilot|bing/i,
  Grok: /grok|x\.ai/i,
  DeepSeek: /deepseek/i,
};
const fmtGa4Date = (d) =>
  typeof d === "string" && d.length === 8 ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : (d || "—");

function AttributionStrip({ rows, convRows = [] }) {
  const [open, setOpen] = useState(null); // engine-Name der aufgeklappten Kachel
  const totalS = rows.reduce((a, b) => a + b.sessions, 0);
  const totalC = rows.reduce((a, b) => a + b.conv, 0);
  const openRow = rows.find((r) => r.engine === open);
  // Einzel-Conversions der aufgeklappten Engine — bevorzugt die reichen
  // events aus der Attribution (Name+Land+Gerät+Datum+Wert, session-scoped),
  // sonst die ga4_conversions-Zeilen des Conversions-Tabs (Quelle-Filter).
  const richEvents = (openRow?.events || []).filter((e) => e.country || e.date || e.device);
  const detailRows = openRow
    ? richEvents.length
      ? richEvents.map((e) => ({
          description: e.name,
          date: e.date,
          value: e.value,
          country: e.country,
          device: e.device,
          count: e.count,
        }))
      : convRows.filter((r) => ATTR_SOURCE_RE[openRow.engine]?.test(String(r.source || "")))
    : [];
  return (
    <div className="rounded-xl border p-5" style={CARD}>
      <div className="flex items-center gap-2">
        <MousePointerClick size={15} style={{ color: C.teal }} />
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Conversions</h3>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: C.sub }}>
        letzte 30 Tage · {nf(totalS)} Sessions · {totalC} Conversions
        {totalC > 0 && <span> · Kachel anklicken für das Conversion-Detail</span>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r) => {
          const clickable = r.conv > 0;
          const isOpen = open === r.engine;
          return (
            <div
              key={r.engine}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => clickable && setOpen(isOpen ? null : r.engine)}
              onKeyDown={(e) => clickable && (e.key === "Enter" || e.key === " ") && setOpen(isOpen ? null : r.engine)}
              className={`rounded-lg border p-3 transition ${clickable ? "cursor-pointer hover:brightness-125 focus:outline-none focus-visible:ring-2" : ""}`}
              style={{ borderColor: isOpen ? C.teal : C.line, background: C.cardAlt }}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium" style={{ color: C.sub }}>{r.engine}</div>
                {clickable && (
                  <ChevronRight size={12} style={{ color: C.sub, transform: isOpen ? "rotate(90deg)" : "none" }} className="transition-transform" />
                )}
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: C.ink }}>{r.sessions}</div>
              <div className="text-[11px]" style={{ color: r.conv > 0 ? C.up : C.sub }}>
                {r.conv} Conv.
              </div>
            </div>
          );
        })}
      </div>
      {openRow && (
        <div className="mt-2 rounded-lg border p-3" style={{ borderColor: C.line, background: C.cardAlt }}>
          <div className="text-xs font-medium" style={{ color: C.ink }}>
            Ausgelöste Conversions über {openRow.engine}
          </div>
          {detailRows.length > 0 ? (
            // Einzel-Conversions wie im Conversions-Tab: Titel, Datum, Wert, Land, Gerät.
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 520 }}>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>
                    <th className="px-2 py-1.5 font-medium">Titel</th>
                    <th className="px-2 py-1.5 font-medium">Datum</th>
                    <th className="px-2 py-1.5 text-right font-medium">Wert</th>
                    <th className="px-2 py-1.5 font-medium">Land</th>
                    <th className="px-2 py-1.5 font-medium">Gerät</th>
                    <th className="px-2 py-1.5 text-right font-medium">Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.slice(0, 30).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: C.line }}>
                      <td className="px-2 py-1.5 font-semibold" style={{ color: C.ink }}>{r.description || r.eventName || "—"}</td>
                      <td className="px-2 py-1.5" style={{ color: C.sub }}>{fmtGa4Date(r.date)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: r.value > 0 ? C.up : C.sub }}>
                        {r.value > 0 ? `${Math.round(r.value).toLocaleString("de-CH")} CHF` : "—"}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: C.sub }}>{r.country || "—"}</td>
                      <td className="px-2 py-1.5" style={{ color: C.sub }}>{r.device || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: C.ink }}>
                        {Number(r.count || 0).toLocaleString("de-CH")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailRows.length > 30 && (
                <p className="mt-1 text-[11px]" style={{ color: C.sub }}>… {detailRows.length - 30} weitere Zeilen</p>
              )}
            </div>
          ) : openRow.events?.length ? (
            // Fallback: Event-Namen + Anzahl (wenn keine Einzelzeilen im ga4_conversions-Lauf liegen).
            <div className="mt-2 flex flex-col gap-1.5">
              {openRow.events.map((e) => (
                <div key={e.name} className="flex items-center justify-between gap-3 text-[13px]">
                  <span style={{ color: C.ink }}>{e.name}</span>
                  <span className="tabular-nums font-semibold" style={{ color: C.up }}>{e.count}×</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs" style={{ color: C.sub }}>
              Detail noch nicht erfasst — wird beim nächsten Daten-Lauf gefüllt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Prompts (Semrush-Style + aufklappbare Roh-Response) ──────────────────────
function StatusPill({ s }) {
  const map = {
    "Erwähnt": C.up,
    "Referenziert": C.indigo,
    "Nicht erwähnt": C.amber,
  }[s] || C.sub;
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${map}26`, color: map }}>{s}</span>
  );
}

function PlatformTag({ p }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: C.track, color: C.sub }}>
      {p}
    </span>
  );
}

const STATUS_COLOR = (s) =>
  ({ "Erwähnt": C.up, "Referenziert": C.indigo, "Nicht erwähnt": C.sub }[s] || C.sub);
const STATUS_RANK = { "Erwähnt": 0, "Referenziert": 1, "Nicht erwähnt": 2 };

// Flache Prompt×Engine-Zeilen -> eine Gruppe je Prompt (Semrush-Style Matrix).
function groupPrompts(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.prompt}·${r.country || ""}`;
    if (!map.has(key)) map.set(key, { prompt: r.prompt, country: r.country, engines: [] });
    map.get(key).engines.push(r);
  }
  const groups = [...map.values()].map((g) => {
    g.engines.sort(
      (a, b) =>
        (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
        String(a.platform).localeCompare(String(b.platform)),
    );
    g.mentioned = g.engines.filter((e) => e.status === "Erwähnt" || e.status === "Referenziert").length;
    g.total = g.engines.length;
    return g;
  });
  groups.sort((a, b) => b.mentioned - a.mentioned || b.total - a.total || a.prompt.localeCompare(b.prompt));
  return groups;
}

// Ein Engine-Chip: Plattformname + Status-Punkt (grün erwähnt / indigo referenziert / grau nicht).
function EngineChip({ e }) {
  const c = STATUS_COLOR(e.status);
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `${c}1f`, color: e.status === "Nicht erwähnt" ? C.sub : c }}
      title={`${e.platform}: ${e.status}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {e.platform}
    </span>
  );
}

// Leichte Markdown-Aufbereitung der Modell-Antworten (User-Wunsch 2026-07-19):
// **fett**, [Label](URL)- und nackte Links klickbar — ohne externe Library.
function InlineMd({ text }) {
  const s = String(text || "");
  const rx = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s)\]}>"',;]+)/g;
  const out = [];
  let last = 0, m, k = 0;
  while ((m = rx.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) {
      out.push(
        <a key={k++} href={m[2]} target="_blank" rel="noreferrer" className="underline" style={{ color: C.indigo }}>{m[1]}</a>,
      );
    } else if (m[3]) {
      out.push(<b key={k++} style={{ color: C.ink }}>{m[3]}</b>);
    } else {
      const label = m[4].replace(/^https?:\/\/(www\.)?/, "");
      out.push(
        <a key={k++} href={m[4]} target="_blank" rel="noreferrer" className="break-all underline" style={{ color: C.indigo }}>
          {label.length > 48 ? `${label.slice(0, 45)}…` : label}
        </a>,
      );
    }
    last = rx.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
}

// Blockebene: Überschriften (#…), Aufzählungen (-/*/•), nummerierte Listen,
// Absätze — macht aus dem Roh-Text der Engines eine lesbare Antwort.
function AnswerBlocks({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const mUl = line.match(/^[-*•]\s+(.*)/);
    const mOl = line.match(/^\d+[.)]\s+(.*)/);
    const mH = line.match(/^#{1,4}\s+(.*)/);
    if (mUl) {
      if (!list || list.type !== "ul") { flush(); list = { type: "ul", items: [] }; }
      list.items.push(mUl[1]);
    } else if (mOl) {
      if (!list || list.type !== "ol") { flush(); list = { type: "ol", items: [] }; }
      list.items.push(mOl[1]);
    } else if (mH) {
      flush();
      blocks.push({ type: "h", text: mH[1] });
    } else {
      flush();
      blocks.push({ type: "p", text: line });
    }
  }
  flush();
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b, i) =>
        b.type === "h" ? (
          <div key={i} className="text-[13px] font-semibold" style={{ color: C.ink }}><InlineMd text={b.text} /></div>
        ) : b.type === "p" ? (
          <p key={i} className="text-[13px] leading-relaxed" style={{ color: C.ink }}><InlineMd text={b.text} /></p>
        ) : b.type === "ul" ? (
          <ul key={i} className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: C.ink }}>
                <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.indigo }} />
                <span className="min-w-0"><InlineMd text={it} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: C.ink }}>
                <span className="w-5 shrink-0 text-right font-semibold tabular-nums" style={{ color: C.indigo }}>{j + 1}.</span>
                <span className="min-w-0"><InlineMd text={it} /></span>
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// Prompt-Detail als Pop-up (User-Wunsch 2026-07-19, Semrush-Vorbild):
// Header = Prompt + Modell-Tabs (Status-Punkt je Engine), linke Spalte =
// Quellen + Mit-genannt, rechte Spalte = Antwort mit Status/Position/Tonalität.
function PromptDetailModal({ g, opportunity, onClose }) {
  const [tab, setTab] = useState(0);
  const e = g.engines[Math.min(tab, g.engines.length - 1)] || {};
  useEffect(() => {
    const h = (ev) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-4xl flex-col overflow-hidden rounded-xl border"
        style={{ ...CARD, maxHeight: "85vh" }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="border-b px-5 py-4" style={{ borderColor: C.line }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-snug" style={{ color: C.ink }}>{g.prompt}</h3>
              {g.country && <div className="mt-0.5 text-[11px]" style={{ color: C.sub }}>{g.country}</div>}
            </div>
            <button
              onClick={onClose}
              aria-label="Schliessen"
              className="shrink-0 rounded-md border px-2 py-1 text-xs transition hover:brightness-125"
              style={{ borderColor: C.line, color: C.sub }}
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {g.engines.map((en, i) => {
              const c = STATUS_COLOR(en.status);
              const active = i === Math.min(tab, g.engines.length - 1);
              return (
                <button
                  key={en.platform}
                  onClick={() => setTab(i)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition"
                  style={{
                    borderColor: active ? C.indigo : C.line,
                    background: active ? `${C.indigo}22` : "transparent",
                    color: active ? C.indigo : C.sub,
                  }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                  {en.platform}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusPill s={e.status} />
              {e.position && (
                <span className="text-[11px]" style={{ color: C.sub }}>
                  Position: <b style={{ color: C.ink }}>{POS_LABEL[e.position] || e.position}</b>
                </span>
              )}
              {e.sentiment && (
                <span className="text-[11px]" style={{ color: C.sub }}>
                  Tonalität: <b style={{ color: SENT_COLOR(e.sentiment) }}>{SENT_LABEL[e.sentiment] || e.sentiment}</b>
                </span>
              )}
            </div>
            {e.response ? (
              <div className="mt-3 rounded-lg border p-4" style={{ borderColor: C.line, background: C.cardAlt }}>
                <AnswerBlocks text={e.response} />
              </div>
            ) : (
              <p className="mt-3 text-xs" style={{ color: C.sub }}>Keine Antwort gespeichert.</p>
            )}
            {e.comps?.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px]" style={{ color: C.sub }}>
                  {opportunity ? "Genannte Konkurrenten:" : "Mit-genannt:"}
                </span>
                {e.comps.map((c) => (
                  <span key={c} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: C.track, color: C.ink }}>{c}</span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PromptGroupRow({ g, opportunity }) {
  const [open, setOpen] = useState(false);
  const rate = g.total ? Math.round((g.mentioned / g.total) * 100) : 0;
  return (
    <>
      <tr
        className="border-t cursor-pointer transition-colors hover:bg-white/5"
        style={{ borderColor: C.line }}
        onClick={() => setOpen(true)}
      >
        <td className="px-5 py-3 align-top">
          <div className="flex items-start gap-2">
            <ChevronRight size={14} className="mt-0.5 shrink-0" style={{ color: C.sub }} />
            <div className="min-w-0">
              <span style={{ color: C.ink }}>{g.prompt}</span>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {g.engines.map((e) => (
                  <EngineChip key={e.platform} e={e} />
                ))}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 align-top text-xs" style={{ color: C.sub }}>{g.country}</td>
        {!opportunity && (
          <td className="px-5 py-3 align-top">
            <div className="flex items-center justify-end gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: C.track }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${rate}%`, background: rate >= 50 ? C.up : rate > 0 ? C.indigo : C.amber }}
                />
              </div>
              <span className="w-9 text-right text-xs tabular-nums" style={{ color: C.ink }}>{g.mentioned}/{g.total}</span>
            </div>
          </td>
        )}
      </tr>
      {open && <PromptDetailModal g={g} opportunity={opportunity} onClose={() => setOpen(false)} />}
    </>
  );
}

// Seitengröße der Prompt-Tabelle: 10 Prompts je Seite, blätterbar.
const PROMPTS_PAGE_SIZE = 10;

// Kompakte Seitenzahlen-Liste: 1 … (cur-1) cur (cur+1) … letzte.
function pageNumbers(cur, pages) {
  const set = new Set([0, pages - 1, cur - 1, cur, cur + 1]);
  const nums = [...set].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}

function PromptsTable({ prompts, opps, brand, brandPrompts = [], needsReview = 0 }) {
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const allRows = [...prompts, ...opps.map((o) => ({ ...o, status: "Nicht erwähnt" }))];
  const source = tab === "all" ? allRows : tab === "win" ? prompts : tab === "brand" ? brandPrompts : opps;
  const opportunity = tab === "opp";
  const groups = groupPrompts(source);
  const pages = Math.max(1, Math.ceil(groups.length / PROMPTS_PAGE_SIZE));
  const cur = Math.min(page, pages - 1); // Tab-Wechsel kann die Seitenzahl verkleinern
  const pageGroups = groups.slice(cur * PROMPTS_PAGE_SIZE, (cur + 1) * PROMPTS_PAGE_SIZE);
  return (
    <div className="rounded-xl border" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Prompts</h3>
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: C.line }}>
          {[{ k: "all", t: "Alle Prompts" }, { k: "win", t: "Erfolgreichste Prompts" }, { k: "opp", t: "Prompt-Chancen" }, ...(brandPrompts.length ? [{ k: "brand", t: "Marken-Prompts" }] : [])].map((x) => (
            <button key={x.k} onClick={() => { setTab(x.k); setPage(0); }}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2"
              style={{ background: tab === x.k ? C.indigo : "transparent", color: tab === x.k ? "#fff" : C.sub }}>
              {x.t}
            </button>
          ))}
        </div>
      </div>
      {needsReview > 0 && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]"
          style={{ borderColor: "#f0c36d", background: "#fdf6e3", color: "#8a6d1b" }}>
          <span aria-hidden>⚠️</span>
          <span>
            <strong>{needsReview} {needsReview === 1 ? "Prompt wartet" : "Prompts warten"} auf Prüfung.</strong>{" "}
            Frisch generierte oder vom Relevanz-Check als themenfremd deaktivierte Prompts – sie werden nicht gemessen, bis sie bestätigt sind. So landen keine falschen Prompts (z. B. aus einer fremden Branche) im Dashboard.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-2 text-[11px]" style={{ color: C.sub }}>
        <span>
          {tab === "all"
            ? `${groups.length} Prompts über alle KI-Modelle – Status je Modell für ${brand}. Zeile aufklappen für die echten Antworten.`
            : tab === "brand"
            ? `Fragen über die Marke selbst (Reputation/Faktentreue) – Auswertung im Marken-Check, fliesst nicht in den Score ein.`
            : opportunity
            ? `Prompts, bei denen Konkurrenten genannt werden – ${brand} aber nicht.`
            : `Prompts, in denen ${brand} erwähnt oder zitiert wird.`}
        </span>
        {/* Legende */}
        <span className="flex items-center gap-2">
          {[["Erwähnt", C.up], ["Referenziert", C.indigo], ["Nicht erwähnt", C.sub]].map(([t, c]) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />{t}
            </span>
          ))}
        </span>
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>
              <th className="px-5 py-2 font-medium">Prompt &amp; Modelle</th>
              <th className="px-3 py-2 font-medium">Land</th>
              {!opportunity && <th className="px-5 py-2 text-right font-medium">Abdeckung</th>}
            </tr>
          </thead>
          <tbody>
            {pageGroups.map((g) => (
              <PromptGroupRow key={`${g.prompt}·${g.country}`} g={g} opportunity={opportunity} />
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: C.line }}>
          <span className="text-[11px]" style={{ color: C.sub }}>
            {cur * PROMPTS_PAGE_SIZE + 1}–{Math.min(groups.length, (cur + 1) * PROMPTS_PAGE_SIZE)} von {groups.length} Prompts
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, cur - 1))}
              disabled={cur === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-35"
              style={{ borderColor: C.line, color: C.sub }}
              aria-label="Vorherige Seite"
            >
              <ChevronLeft size={14} />
            </button>
            {pageNumbers(cur, pages).map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="px-1 text-xs" style={{ color: C.sub }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="h-7 min-w-7 rounded-md px-1.5 text-xs font-medium tabular-nums transition"
                  style={{
                    background: p === cur ? C.indigo : "transparent",
                    color: p === cur ? "#fff" : C.sub,
                    border: `1px solid ${p === cur ? C.indigo : C.line}`,
                  }}
                >
                  {p + 1}
                </button>
              ),
            )}
            <button
              onClick={() => setPage(Math.min(pages - 1, cur + 1))}
              disabled={cur >= pages - 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-35"
              style={{ borderColor: C.line, color: C.sub }}
              aria-label="Nächste Seite"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Donut (Länder / Intent) ──────────────────────────────────────────────────
function DonutCard({ title, subtitle, data, palette, centerLabel = "gesamt" }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div className="rounded-xl border p-5" style={CARD}>
      <h3 className="text-sm font-semibold" style={{ color: C.ink }}>{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs" style={{ color: C.sub }}>{subtitle}</p>}
      <div className="mt-3 flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60}
                paddingAngle={2} stroke="none">
                {data.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 12 }}
                formatter={(v, n) => [`${v} · ${Math.round((v / total) * 100)}%`, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold tabular-nums" style={{ color: C.ink }}>{total}</span>
            <span className="text-[10px]" style={{ color: C.sub }}>{centerLabel}</span>
          </div>
        </div>
        <ul className="flex-1 space-y-1.5">
          {data.map((d, i) => (
            <li key={d.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5" style={{ color: C.ink }}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: palette[i % palette.length] }} />
                {d.name}
              </span>
              <span className="tabular-nums" style={{ color: C.sub }}>
                {d.value} · {Math.round((d.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Loading / Empty (Card-Layout, dunkel) ────────────────────────────────────
export function AIVisibilitySkeleton() {
  const Card = ({ h }) => (
    <div className="animate-pulse rounded-xl border" style={{ ...CARD, height: h }} />
  );
  return (
    <div className="w-full" style={{ background: C.page }}>
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <Card h={128} /><Card h={128} /><Card h={128} /><Card h={128} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"><Card h={280} /><Card h={280} /></div>
        <div className="mt-4"><Card h={340} /></div>
      </div>
    </div>
  );
}

export function AIVisibilityEmpty({ message }) {
  return (
    <div className="w-full" style={{ background: C.page }}>
      <div className="mx-auto max-w-6xl">
        <div className="rounded-xl border p-10 text-center" style={CARD}>
          <Sparkles size={28} style={{ color: C.sub, margin: "0 auto" }} />
          <div className="mt-3 text-sm font-semibold" style={{ color: C.ink }}>Noch keine AI-Visibility-Daten</div>
          <p className="mt-1 text-xs" style={{ color: C.sub }}>
            {message || "Sobald der erste Report-Lauf für diesen Kunden abgeschlossen ist, erscheint das Dashboard hier."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Share of Voice (eigene Marke vs. Konkurrenten) ───────────────────────────
function SovCard({ rows }) {
  const max = Math.max(...rows.map((r) => r.mentions), 1);
  return (
    <RCard icon={MessageSquare} title="Share of Voice" info="Anteil der Marken-Nennungen im Vergleich zu erkannten Konkurrenten über alle KI-Antworten." desc="Marke vs. Konkurrenten" footer={`${rows.length} Marken im Vergleich`} legend={<HeatLegend from="Wenig" to="Viel" />}>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.brand} className="flex items-center gap-3">
            <div className="w-44 shrink-0 truncate text-xs font-medium" style={{ color: r.isSelf ? C.ink : C.sub }}>
              {r.brand}{r.isSelf ? " · Sie" : ""}
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded" style={{ background: C.track }}>
              <div className="h-full rounded transition-all"
                style={{ width: `${(r.mentions / max) * 100}%`, minWidth: r.mentions > 0 ? 8 : 0, background: r.isSelf ? C.indigo : C.sub }} />
            </div>
            <div className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: r.isSelf ? C.ink : C.sub }}>
              {r.share}% <span className="font-normal" style={{ color: C.sub }}>({r.mentions})</span>
            </div>
          </div>
        ))}
      </div>
    </RCard>
  );
}

// ── Marken-Check (Brand-Prompts): Reputation/Faktentreue, klar getrennt vom Score ─
const TON_COLORS = { positiv: C.up, neutral: C.sub, negativ: C.down || "#ef4444", warnend: C.amber };

// Mini-Trend: ZWEI strikt getrennte Linien-Segmente — Korpus-Backfill (retro,
// gestrichelt/gedämpft) und eigene Messung (ab Erstlauf, kräftig). Nie gemischt.
function BrandTrend({ history }) {
  const pts = (history || []).filter((h) => h.answered > 0);
  if (pts.length < 2) return null;
  const eigene = pts.filter((h) => h.source === "eigene-prompts");
  const korpus = pts.filter((h) => h.source === "korpus-backfill");
  const erstlauf = eigene[0]?.date;
  const W = 560, H = 64, PAD = 6;
  const all = [...korpus, ...eigene];
  const x = (i) => PAD + (i / Math.max(1, all.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * PAD);
  const posShare = (h) => {
    const t = Object.values(h.tonalitaet || {}).reduce((a, b) => a + Number(b), 0);
    return t ? (Number(h.tonalitaet?.positiv || 0) / t) * 100 : 0;
  };
  const line = (arr, offset, val) =>
    arr.map((h, i) => `${x(offset + i)},${y(val(h))}`).join(" ");
  return (
    <div className="border-t px-5 py-3" style={{ borderColor: C.line }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: C.sub }}>
        <span className="uppercase tracking-wide">Verlauf (Faktentreue % durchgezogen · Tonalität positiv % gepunktet)</span>
        <span className="flex items-center gap-3">
          {korpus.length > 0 && (
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: C.sub }} />Korpus-Backfill (Ahrefs)</span>
          )}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: C.indigo }} />eigene Messung{erstlauf ? ` ab ${erstlauf}` : ""}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" style={{ maxHeight: 72 }}>
        {korpus.length > 1 && (
          <polyline points={line(korpus.filter((h) => h.faktentreueQuote != null), 0, (h) => h.faktentreueQuote)} fill="none" stroke={C.sub} strokeWidth="1.5" strokeDasharray="4 3" />
        )}
        {korpus.length > 1 && (
          <polyline points={line(korpus, 0, posShare)} fill="none" stroke={C.sub} strokeWidth="1" strokeDasharray="1 3" />
        )}
        {eigene.length > 0 && (
          <>
            <polyline points={line(eigene.filter((h) => h.faktentreueQuote != null), korpus.length, (h) => h.faktentreueQuote)} fill="none" stroke={C.indigo} strokeWidth="2" />
            <polyline points={line(eigene, korpus.length, posShare)} fill="none" stroke={C.indigo} strokeWidth="1" strokeDasharray="1 3" />
            {korpus.length > 0 && (
              <line x1={x(korpus.length) - 3} y1={PAD} x2={x(korpus.length) - 3} y2={H - PAD} stroke={C.amber} strokeWidth="1" strokeDasharray="2 2" />
            )}
          </>
        )}
      </svg>
      {korpus.length > 0 && eigene.length > 0 && (
        <div className="text-[10px]" style={{ color: C.amber }}>ab {erstlauf}: eigene Messung — davor Korpus-Archiv, getrennt erhoben</div>
      )}
    </div>
  );
}

function BrandCheckCard({ bc, brand, history }) {
  if (!bc) return null;
  const tonTotal = Object.values(bc.tonalitaetsVerteilung || {}).reduce((a, b) => a + Number(b), 0) || 1;
  return (
    <div className="mt-4 rounded-xl border" style={CARD}>
      <div className="border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Marken-Check</h3>
        <p className="mt-1 text-[11px]" style={{ color: C.sub }}>
          Der Marken-Check misst, WAS KI-Systeme über die Marke sagen — nicht die Sichtbarkeit. Er fliesst nicht in den Score ein.
        </p>
      </div>
      {bc.advisory?.text && (
        <div className="mx-5 mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: C.amber, color: C.amber }}>
          {bc.advisory.text}
          {bc.advisory.since ? ` (laut Korpus-Archiv seit mindestens ${bc.advisory.since})` : ""}
        </div>
      )}
      <BrandTrend history={history} />
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Faktentreue</div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: C.ink }}>
            {bc.faktentreueQuote != null ? `${bc.faktentreueQuote}%` : "–"}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: C.sub }}>
            {Object.entries(bc.faktentreueVerteilung || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "keine bewerteten Antworten"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Tonalität ({bc.answered} Antworten)</div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full" style={{ background: C.track }}>
            {["positiv", "neutral", "negativ", "warnend"].map((k) => {
              const v = Number(bc.tonalitaetsVerteilung?.[k] || 0);
              return v > 0 ? <div key={k} style={{ width: `${(v / tonTotal) * 100}%`, background: TON_COLORS[k] }} /> : null;
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]" style={{ color: C.sub }}>
            {["positiv", "neutral", "negativ", "warnend"].map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TON_COLORS[k] }} />
                {k} {Number(bc.tonalitaetsVerteilung?.[k] || 0)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Konkurrenz in Marken-Antworten</div>
          <div className="mt-1 text-[12px]" style={{ color: C.ink }}>
            {(bc.konkurrenzNennungen || []).slice(0, 5).map((k) => `${k.name} (${k.n}×)`).join(", ") || "keine"}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: C.sub }}>{brand} selbst: {bc.selfNennungen}× genannt</div>
        </div>
      </div>
      {(bc.halluzinationen?.length || 0) > 0 && (
        <div className="border-t px-5 py-3" style={{ borderColor: C.line }}>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Halluzinationen / erfundene Angaben</div>
          <ul className="mt-1 space-y-1 text-[12px]" style={{ color: C.ink }}>
            {bc.halluzinationen.slice(0, 5).map((h, i) => (
              <li key={i}><span className="font-medium">{h.engine}:</span> „{h.zitat}"</li>
            ))}
          </ul>
        </div>
      )}
      {(bc.topQuellen?.length || 0) > 0 && (
        <div className="border-t px-5 py-3 text-[11px]" style={{ borderColor: C.line, color: C.sub }}>
          Quellen der Marken-Antworten: {bc.topQuellen.slice(0, 8).map((q) => `${q.domain} (${q.n})`).join(" · ")}
        </div>
      )}
    </div>
  );
}

// ── Decision Journey (Searchable-Nachbau 08/2026): Erwähnungsrate je Funnel-
// Stufe. Datenbasis: Judge-Intent je Markt-Prompt-Antwort (bereits erhoben).
const FUNNEL_STAGES = [
  { id: "tofu", label: "Informieren (TOFU)", hint: "Optionen recherchieren, Grundlagen verstehen", intents: ["Informativ", "informational"] },
  { id: "mofu", label: "Vergleichen (MOFU)", hint: "Anbieter eingrenzen, Angebote vergleichen", intents: ["Kommerziell", "commercial"] },
  { id: "bofu", label: "Entscheiden (BOFU)", hint: "kauf-/buchungsbereit, gezielte Suche", intents: ["Transaktional", "transactional", "Navigativ", "navigational"] },
];
function funnelVerdict(rate) {
  if (rate == null) return { label: "keine Daten", color: C.sub };
  if (rate < 5) return { label: "Kritisch", color: "#ef4444" };
  if (rate < 15) return { label: "Schwach", color: C.amber };
  return { label: "Solide", color: "#10b981" };
}
// Weiche Füllfarben je Urteil (Searchable-Trapez-Optik)
const FUNNEL_FILL = { Kritisch: "#fecdd3", Schwach: "#fed7aa", Solide: "#bbf7d0", "keine Daten": "#eceae3" };
const FUNNEL_TEXT = { Kritisch: "#be123c", Schwach: "#b45309", Solide: "#047857", "keine Daten": "#8a877e" };
function FunnelCard({ prompts, opps }) {
  const rows = [...(prompts || []), ...(opps || [])].filter((p) => p.intent);
  if (!rows.length) return null;
  const stages = FUNNEL_STAGES.map((s) => {
    const inStage = rows.filter((p) => s.intents.includes(p.intent));
    const mentioned = inStage.filter((p) => p.status && p.status !== "Nicht erwähnt").length;
    const rate = inStage.length ? Math.round((mentioned / inStage.length) * 1000) / 10 : null;
    return { ...s, total: inStage.length, mentioned, rate };
  });
  // Trapez-Breiten: oben breit, nach unten schmaler (klassische Funnel-Silhouette)
  const widths = [100, 78, 58];
  return (
    <RCard icon={Filter} title="Kaufreise" info="Erwähnungsrate je Phase der Kundenreise, abgeleitet aus der Suchintention der Prompts (Judge-Klassifikation)." desc="Erwähnungsrate je Funnel-Phase über alle KI-Systeme" footer={`${rows.length} Prompt-Antworten ausgewertet`} legend={<HeatLegend />}>
      <div className="flex flex-col gap-2.5">
        {stages.map((s, i) => {
          const v = funnelVerdict(s.rate);
          const w = widths[i];
          const inset = (100 - w) / 2;
          return (
            <div key={s.id} className="flex items-center gap-4">
              <div className="flex-1" style={{ maxWidth: "52%" }}>
                <div
                  className="flex items-center justify-center py-4 text-[15px] font-bold tabular-nums"
                  style={{
                    background: FUNNEL_FILL[v.label] || C.track,
                    color: FUNNEL_TEXT[v.label] || C.ink,
                    clipPath: `polygon(${inset}% 0, ${100 - inset}% 0, ${100 - inset - 4}% 100%, ${inset + 4}% 100%)`,
                  }}
                >
                  {s.rate == null ? "–" : `${s.rate}%`}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold" style={{ color: C.ink }}>{s.label}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: FUNNEL_FILL[v.label], color: FUNNEL_TEXT[v.label] }}>{v.label}</span>
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: C.sub }}>{s.hint}</div>
                <div className="mt-0.5 text-[10.5px] tabular-nums" style={{ color: C.sub }}>{s.mentioned} von {s.total} Antworten erwähnen die Marke</div>
              </div>
            </div>
          );
        })}
      </div>
    </RCard>
  );
}

// ── Positions-Matrix + Head-to-Head (Searchable-Optik 08/2026) ───────────────
// Heatmap-Zelle: grüne Intensität nach Anteil (Searchable-Muster)
function HeatCell({ pct }) {
  if (pct == null || pct === 0) return <td className="px-3 py-2 text-center text-[11px]" style={{ color: C.sub }}>—</td>;
  const bg = pct >= 60 ? "#6ee7b7" : pct >= 35 ? "#a7f3d0" : pct >= 15 ? "#d1fae5" : "#ecfdf5";
  return (
    <td className="px-3 py-2 text-center text-[11.5px] font-semibold tabular-nums" style={{ background: bg, color: "#065f46" }}>
      {Math.round(pct)}%
    </td>
  );
}
function PositionHeadToHead({ prompts, sov, brand }) {
  const all = prompts || [];
  // Matrix: Engine × Antwort-Position der EIGENEN Marke (Konkurrenz-Positionen
  // erhebt der Judge nicht — nur ehrliche Daten zeigen, keine Fake-Zeilen).
  const engines = [...new Set(all.map((p) => p.platform).filter(Boolean))].sort();
  const matrix = engines.map((e) => {
    const rows = all.filter((p) => p.platform === e);
    const c = { top: 0, list: 0, passing: 0, none: 0 };
    for (const p of rows) {
      if (!p.status || p.status === "Nicht erwähnt") c.none++;
      else if (p.position && c[p.position] != null) c[p.position]++;
      else c.list++;
    }
    const n = rows.length || 1;
    return { engine: e, n: rows.length, top: (c.top / n) * 100, list: (c.list / n) * 100, passing: (c.passing / n) * 100, none: (c.none / n) * 100 };
  }).filter((r) => r.n > 0);

  const comps = (sov || []).filter((s) => !s.isSelf).slice(0, 5);
  const [rivalIdx, setRivalIdx] = useState(0);
  const rival = comps[Math.min(rivalIdx, Math.max(0, comps.length - 1))] || null;
  const answered = all.filter((p) => p.status && p.status !== "Nicht erwähnt");
  const rivalRows = rival ? all.filter((p) => (p.comps || []).some((c) => c.toLowerCase() === rival.brand.toLowerCase())) : [];
  const selfRate = all.length ? Math.round((answered.length / all.length) * 1000) / 10 : 0;
  const rivalRate = all.length ? Math.round((rivalRows.length / all.length) * 1000) / 10 : 0;
  const selfShare = (sov || []).find((s) => s.isSelf)?.share ?? null;
  if (!matrix.length && !rival) return null;

  return (
    <div className="grid grid-cols-1 gap-4">
      {matrix.length > 0 && (
        <RCard icon={Hash} title="Antwort-Position" info="Wo die eigene Marke in den KI-Antworten steht: Top-Empfehlung, in einer Liste, Randnotiz oder nicht genannt — je KI-System." desc="Wo die Marke in KI-Antworten erscheint" footer={`${all.length} Antworten · nur eigene Marke (Konkurrenz-Positionen werden nicht erhoben)`} legend={<HeatLegend from="Niedrig" to="Hoch" />} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: C.sub }}>
                <th className="px-5 py-2 text-left font-medium">KI-System</th>
                <th className="px-3 py-2 text-center font-medium">Top-Empfehlung</th>
                <th className="px-3 py-2 text-center font-medium">In Liste</th>
                <th className="px-3 py-2 text-center font-medium">Randnotiz</th>
                <th className="px-3 py-2 text-center font-medium">Nicht genannt</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.engine} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="px-5 py-2 font-semibold" style={{ color: C.ink }}>{r.engine}</td>
                  <HeatCell pct={r.top} />
                  <HeatCell pct={r.list} />
                  <HeatCell pct={r.passing} />
                  <td className="px-3 py-2 text-center text-[11.5px] tabular-nums" style={{ color: C.sub }}>{Math.round(r.none)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </RCard>
      )}
      {rival && (
        <RCard icon={Swords} title="Head-to-Head" info="Direktvergleich der Präsenz in denselben KI-Antworten: eigene Marke gegen einen wählbaren Konkurrenten." desc={`${brand} im 1:1-Vergleich`} footer="Präsenz = Anteil der Antworten, in denen die Marke vorkommt" legend={
          <select value={rivalIdx} onChange={(e) => setRivalIdx(Number(e.target.value))}
            className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: C.line, background: C.card, color: C.ink }}>
            {comps.map((c, i) => <option key={c.brand} value={i}>{c.brand}</option>)}
          </select>
        }>
          <div className="grid grid-cols-2 gap-4">
            {[{ name: brand, rate: selfRate, share: selfShare, self: true }, { name: rival.brand, rate: rivalRate, share: rival.share, self: false }].map((b) => (
              <div key={b.name} className="rounded-lg border p-3" style={{ borderColor: b.self ? C.indigo : C.line, background: b.self ? "rgba(108,92,231,.04)" : "transparent" }}>
                <div className="truncate text-[12px] font-semibold" style={{ color: b.self ? C.indigo : C.ink }}>{b.name}{b.self ? " (du)" : ""}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: C.ink }}>{b.rate}%</div>
                <div className="text-[10px]" style={{ color: C.sub }}>Präsenz in KI-Antworten</div>
                {b.share != null && <div className="mt-1 text-[11px] tabular-nums" style={{ color: C.sub }}>Share of Voice: {b.share}%</div>}
              </div>
            ))}
          </div>
        </RCard>
      )}
    </div>
  );
}

// ── Zitierquellen-Typologie + Gap (Searchable-Nachbau 08/2026, Heuristik) ────
const SOURCE_TYPE_RULES = [
  { type: "Video (YouTube)", re: /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/ },
  { type: "Community/Forum", re: /(^|\.)reddit\.com$|(^|\.)quora\.com$|forum/ },
  { type: "Wiki", re: /wikipedia\.org$|(^|\.)wikidata\.org$/ },
  { type: "Social", re: /(^|\.)linkedin\.com$|(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)tiktok\.com$|(^|\.)pinterest\./ },
  { type: "Verzeichnis & Reviews", re: /(^|\.)tripadvisor\.|(^|\.)booking\.com$|(^|\.)yelp\.|(^|\.)local\.ch$|(^|\.)search\.ch$|(^|\.)trustpilot\.|vergleich|(^|\.)maps\.google\./ },
  { type: "Presse/News", re: /(^|\.)nzz\.ch$|(^|\.)blick\.ch$|(^|\.)20min\.ch$|(^|\.)srf\.ch$|(^|\.)watson\.ch$|(^|\.)handelszeitung\.ch$|zeitung|news/ },
];
function classifySourceDomain(domain, ownHost) {
  const d = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (ownHost && (d === ownHost || d.endsWith("." + ownHost))) return "Eigene Website";
  for (const r of SOURCE_TYPE_RULES) if (r.re.test(d)) return r.type;
  return "Artikel/Website";
}
function CitedTypesCard({ sources, ownDomain }) {
  const rows = sources || [];
  if (!rows.length) return null;
  const ownHost = String(ownDomain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const byType = {};
  let total = 0;
  for (const s of rows) {
    const t = classifySourceDomain(s.domain, ownHost);
    (byType[t] = byType[t] || { mentions: 0, own: 0, domains: [] }).mentions += s.mentions || 1;
    byType[t].domains.push(s.domain);
    if (t === "Eigene Website") byType[t].own += s.mentions || 1;
    total += s.mentions || 1;
  }
  const entries = Object.entries(byType).sort((a, b) => b[1].mentions - a[1].mentions);
  const gaps = entries.filter(([t]) => t !== "Eigene Website" && t !== "Artikel/Website").filter(([t, v]) => v.own === 0).slice(0, 3);
  const TYPE_COLORS = [C.indigo, C.teal, C.amber, C.violet, "#10b981", "#ef4444", C.sub, "#f472b6"];
  return (
    <RCard icon={Layers} title="Content-Typen" info="Typ-Klassifikation der zitierten Domains (Heuristik): welche Content-Formate KI-Antworten in dieser Branche als Quelle nutzen." desc="Welche Inhalte zitiert werden" footer={`${rows.length} zitierte Domains klassifiziert`}>
      <div className="space-y-2">
        {entries.slice(0, 8).map(([t, v], i) => (
          <div key={t} className="flex items-center gap-3">
            <span className="w-44 truncate text-[12px]" style={{ color: t === "Eigene Website" ? C.indigo : C.ink }}>{t}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: C.track }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v.mentions / total) * 100)}%`, background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
            </div>
            <span className="w-14 text-right text-[11px] tabular-nums" style={{ color: C.sub }}>{Math.round((v.mentions / total) * 1000) / 10}%</span>
          </div>
        ))}
      </div>
      {gaps.length > 0 && (
        <div className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: "#fef3c7", color: "#92400e" }}>
          Lücke: In {gaps.map(([t]) => `„${t}"`).join(", ")} wird zitiert — aber nie die eigene Marke. Content-Chance für den nächsten Maßnahmenplan.
        </div>
      )}
    </RCard>
  );
}

// ── Layout-Klon Searchable (03.08.2026, Tab-für-Tab-Parität) ─────────────────

// Visibility-Tab Zeile 1 links: grosse Score-Zahl + Verlaufslinie (bei uns
// ehrlich: Monats-Score-Historie statt 7-Tage — der Zyklus läuft alle 3 Tage).
function VisibilityHero({ score, delta, history }) {
  const pts = (history || []).filter((h) => h.score != null).slice(-12);
  const W = 520, H = 150, PAD = 8;
  const maxS = Math.max(10, ...pts.map((p) => p.score));
  const x = (i) => PAD + (i / Math.max(1, pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (v / maxS) * (H - 2 * PAD);
  const line = pts.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");
  return (
    <RCard icon={Eye} title="Sichtbarkeit" info="Sichtbarkeits-Score der Marke über alle gemessenen KI-Systeme; Verlauf = Monatswerte." desc="Score-Trend über alle KI-Systeme" footer={`${pts.length} Monatspunkte`}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Sichtbarkeits-Score</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color: C.ink }}>{score}</span>
        {delta !== 0 && delta != null && (
          <span className="text-sm font-semibold" style={{ color: delta > 0 ? C.up : C.down }}>{delta > 0 ? `+${delta}` : delta}</span>
        )}
      </div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" style={{ maxHeight: 150 }}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - 2 * PAD)} y2={PAD + f * (H - 2 * PAD)} stroke={C.line} strokeWidth="1" />
          ))}
          <polyline points={line} fill="none" stroke={C.indigo} strokeWidth="2" />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].score)} r="3.5" fill={C.indigo} />
        </svg>
      )}
    </RCard>
  );
}

// Visibility-Tab Zeile 1 rechts: Rankings — Marke vs. Konkurrenten.
// Präsenz je Marke aus den Prompt-Zeilen (comps-Array); Sentiment nur für die
// eigene Marke erhoben → Konkurrenz ehrlich mit „—".
function RankingsTable({ prompts, sov, brand, sentimentPct }) {
  const all = prompts || [];
  const presence = (name, self) => {
    if (!all.length) return 0;
    const n = self
      ? all.filter((p) => p.status && p.status !== "Nicht erwähnt").length
      : all.filter((p) => (p.comps || []).some((c) => c.toLowerCase() === name.toLowerCase())).length;
    return Math.round((n / all.length) * 100);
  };
  const rows = [
    { brand, self: true, vis: presence(brand, true), share: (sov || []).find((s) => s.isSelf)?.share ?? null, senti: sentimentPct },
    ...(sov || []).filter((s) => !s.isSelf).slice(0, 8).map((s) => ({ brand: s.brand, self: false, vis: presence(s.brand, false), share: s.share, senti: null })),
  ].sort((a, b) => b.vis - a.vis);
  return (
    <RCard icon={Hash} title="Rankings" info="Präsenzrate je Marke = Anteil der KI-Antworten, in denen die Marke vorkommt. Sentiment wird nur für die eigene Marke bewertet." desc="Marke im Vergleich zum Wettbewerb" footer={`${rows.length} Marken`} pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: C.sub }}>
              <th className="px-5 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Marke</th>
              <th className="px-3 py-2 text-right font-medium">Präsenz</th>
              <th className="px-3 py-2 text-right font-medium">SoV</th>
              <th className="px-3 py-2 text-right font-medium">Sentiment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.brand} style={{ borderTop: `1px solid ${C.line}`, background: r.self ? "rgba(108,92,231,.05)" : "transparent" }}>
                <td className="px-5 py-2 tabular-nums" style={{ color: C.sub }}>{i + 1}</td>
                <td className="px-3 py-2 font-semibold" style={{ color: r.self ? C.indigo : C.ink }}>
                  {r.brand}
                  {r.self && <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: C.indigo, color: "#fff" }}>DU</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: C.ink }}>{r.vis}%</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.sub }}>{r.share != null ? `${r.share}%` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.senti != null ? C.up : C.sub }}>{r.senti != null ? r.senti : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RCard>
  );
}

// Erwähnungen-Tab Zeile 1: Kennzahl gross + Delta + Monats-Verlaufslinie
// (Searchable zeigt 7 Tage — unsere Messbasis ist der Monats-Trend, ehrlich beschriftet).
function MetricTrendCard({ icon, title, info, value, delta, series, color }) {
  const pts = (series || []).slice(-12);
  const W = 520, H = 120, PAD = 8;
  const maxV = Math.max(1, ...pts.map((p) => p.v));
  const x = (i) => PAD + (i / Math.max(1, pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (v / maxV) * (H - 2 * PAD);
  return (
    <RCard icon={icon} title={title} info={info} desc="Monats-Verlauf über alle KI-Systeme" footer={`${pts.length} Monate`}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>{title} gesamt</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color: C.ink }}>{value}</span>
        {delta !== 0 && delta != null && (
          <span className="text-sm font-semibold" style={{ color: delta > 0 ? C.up : C.down }}>{delta > 0 ? `+${delta}` : delta}</span>
        )}
      </div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" style={{ maxHeight: 120 }}>
          {[0.33, 0.66].map((f) => (
            <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - 2 * PAD)} y2={PAD + f * (H - 2 * PAD)} stroke={C.line} strokeWidth="1" />
          ))}
          <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke={color} strokeWidth="2" />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r="3.5" fill={color} />
        </svg>
      )}
    </RCard>
  );
}

// Themen-Tab: Treemap-Mosaik — Kachelgrösse nach Erwähnungen, Farbe nach
// Sichtbarkeit (grün hoch / beige mittel / rot niedrig — Searchable-Skala).
function TopicTreemap({ rows }) {
  const tops = (rows || []).slice(0, 9);
  if (!tops.length) return null;
  const fill = (vis) => (vis >= 25 ? { bg: "#34d399", fg: "#064e3b" } : vis >= 10 ? { bg: "#eceae3", fg: "#44423c" } : { bg: "#f16a6f", fg: "#ffffff" });
  const [big, ...rest] = tops;
  const Cell = ({ t, tall }) => {
    const f = fill(t.vis);
    return (
      <div className="flex flex-col items-center justify-center rounded-lg px-2 text-center" style={{ background: f.bg, color: f.fg, minHeight: tall ? 210 : 100 }}>
        <div className="text-[12px] font-semibold" style={{ maxWidth: "95%", overflow: "hidden", textOverflow: "ellipsis" }}>{t.topic}</div>
        <div className="text-[15px] font-bold tabular-nums">{t.vis}%</div>
      </div>
    );
  };
  return (
    <RCard icon={Tags} title="Themen-Verteilung" info="Kachelgrösse nach Erwähnungen, Farbe nach Sichtbarkeits-Quote je Thema." desc="Grösse = Erwähnungen · Farbe = Sichtbarkeit" footer={`${(rows || []).length} Themen`} legend={
      <span className="inline-flex items-center gap-3">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#34d399" }} />hoch</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#d9d6cc" }} />mittel</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#f16a6f" }} />niedrig</span>
      </span>
    }>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sm:row-span-2"><Cell t={big} tall /></div>
        {rest.slice(0, 8).map((t) => <Cell key={t.topic} t={t} />)}
      </div>
    </RCard>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────
// Sub-Tabs + Filterzeile (Searchable-Muster, 03.08.2026): statt einer langen
// Scroll-Seite navigiert der Report in Bereichen; der Modell-Filter wirkt auf
// alle prompt-basierten Karten (Kaufreise, Position, Intent, Prompts) —
// Report-Kennzahlen (Score/KPIs/Trend) sind Lauf-Aggregate und bleiben ungefiltert.
export default function AIVisibilityDashboard({ data, convRows = [] }) {
  const d = data;
  const [tab, setTab] = useState("uebersicht");
  const [modelF, setModelF] = useState("alle");
  if (!d) return <AIVisibilityEmpty />;

  const platforms = [...new Set([...(d.prompts || []), ...(d.promptOpps || [])].map((p) => p.platform).filter(Boolean))].sort();
  const fP = modelF === "alle" ? d.prompts : (d.prompts || []).filter((p) => p.platform === modelF);
  const fO = modelF === "alle" ? d.promptOpps : (d.promptOpps || []).filter((p) => p.platform === modelF);
  // Intent-Verteilung aus den (gefilterten) Prompt-Zeilen — ersetzt das
  // vorberechnete promptIntent, damit der Modell-Filter greift.
  const intentCounts = {};
  for (const p of [...(fP || []), ...(fO || [])]) if (p.intent) intentCounts[p.intent] = (intentCounts[p.intent] || 0) + 1;
  const intentData = Object.entries(intentCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Sentiment der eigenen Marke als Zahl (Rankings-Spalte, Searchable-Muster):
  // Anteil positiver Bewertungen an allen bewerteten Antworten, 0–100.
  const sentRows = (d.prompts || []).filter((p) => p.sentiment);
  const sentimentPct = sentRows.length
    ? Math.round((sentRows.filter((p) => p.sentiment === "pos").length / sentRows.length) * 100)
    : null;

  const hasBrand = !!d.brandCheck;
  const hasConv = Array.isArray(d.attribution) && d.attribution.length > 0;
  const TABS = [
    { id: "uebersicht", label: "Sichtbarkeit" },
    { id: "erwaehnungen", label: "Erwähnungen & Wettbewerb" },
    ...(hasBrand ? [{ id: "marke", label: "Marke" }] : []),
    { id: "quellen", label: "Quellen" },
    { id: "themen", label: "Themen" },
    { id: "prompts", label: "Prompts" },
    ...(hasConv ? [{ id: "conversions", label: "Conversions" }] : []),
  ];

  return (
    <div className="w-full" style={{ background: C.page, color: C.ink }}>
      <div className="mx-auto max-w-6xl">

        {/* Sub-Tab-Leiste (Searchable-Look: Underline, hell) */}
        <div className="border-b" style={{ borderColor: C.line }}>
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="whitespace-nowrap px-3 py-2 text-[13px]"
                style={{
                  color: tab === t.id ? C.ink : C.sub,
                  fontWeight: tab === t.id ? 700 : 500,
                  borderBottom: `2px solid ${tab === t.id ? C.ink : "transparent"}`,
                  marginBottom: -1,
                  background: "none", border: "none", borderBottomStyle: "solid", cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filterzeile */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: C.sub }}>
          <span className="rounded-full border px-2.5 py-1" style={{ borderColor: C.line }}>Stand {d.date}</span>
          {platforms.length > 1 && (
            <select
              value={modelF}
              onChange={(e) => setModelF(e.target.value)}
              className="rounded-full border px-2.5 py-1 text-[11.5px]"
              style={{ borderColor: modelF === "alle" ? C.line : C.indigo, background: C.card, color: modelF === "alle" ? C.sub : C.indigo }}
              title="Wirkt auf Kaufreise, Position, Intent und Prompts"
            >
              <option value="alle">Alle Modelle</option>
              {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {modelF !== "alle" && (
            <span className="rounded-full px-2.5 py-1" style={{ background: C.cardAlt }}>
              Filter aktiv: nur {modelF} (Score/KPIs bleiben Gesamtwerte)
            </span>
          )}
          {d.versionSwitch && (
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: C.amber, color: C.amber }}>
              Messung umgestellt am {d.versionSwitch}
            </span>
          )}
        </div>

        {tab === "uebersicht" && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border p-5 lg:col-span-1" style={CARD}>
                <ScoreRing value={d.score} delta={d.versionSwitch ? 0 : d.scoreDelta} modelCount={d.models.length} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
                <Kpi icon={Eye} label="Erwähnungen" color={C.indigo} {...d.kpis.mentions} />
                <Kpi icon={Quote} label="Citations" color={C.teal} {...d.kpis.citations} />
                <Kpi icon={FileText} label="Referenzierte Seiten" color={C.amber} value={d.kpis.citedPages.value} delta={d.kpis.citedPages.delta} prev={d.kpis.citedPages.prev} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: C.sub }}>
              {d.brHomeSplit && (
                <span className="rounded-full border px-2 py-0.5" style={{ borderColor: C.line }}>
                  KI-Antwort-Korpus: Heimmarkt CH {d.brHomeSplit.home} · International {d.brHomeSplit.intl}
                </span>
              )}
              <span>
                Der Score vergleicht die Sichtbarkeit eines Kunden über die Zeit. Vergleiche zwischen Kunden sind nur eingeschränkt möglich.
              </span>
            </div>
            {/* Zeile 1 wie Searchable Visibility: Score-Verlauf | Rankings */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <VisibilityHero score={d.score} delta={d.versionSwitch ? 0 : d.scoreDelta} history={d.trend} />
              <RankingsTable prompts={d.prompts} sov={d.sov} brand={d.client} sentimentPct={sentimentPct} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TrendCard data={d.trend} />
              <ModelDistribution models={d.models} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DonutCard
                title="Erwähnungen nach Land"
                subtitle={`Herkunft der Anfragen · ${d.date}`}
                data={d.countries}
                palette={[C.indigo, C.teal, C.amber, C.violet, C.sub]}
                centerLabel="Erwähnungen"
              />
              <DonutCard
                title="Prompts nach Intent"
                subtitle={modelF === "alle" ? "Suchintention der Prompts" : `Suchintention · nur ${modelF}`}
                data={intentData}
                palette={[C.violet, C.indigo, C.teal, C.sub, C.amber]}
                centerLabel="Prompts"
              />
            </div>
          </>
        )}

        {tab === "erwaehnungen" && (
          <>
            {/* Zeile 1 wie Searchable Mentions & Citations: zwei Kennzahl-Trends */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricTrendCard icon={MessageSquare} title="Erwähnungen" info="Wie oft die Marke in KI-Antworten genannt wird — Monatsverlauf über alle Systeme." value={d.kpis.mentions.value} delta={d.kpis.mentions.delta} series={(d.trend || []).map((t) => ({ v: t.mentions }))} color={C.indigo} />
              <MetricTrendCard icon={Link2} title="Citations" info="Wie oft KI-Antworten die eigene Website als Quelle verlinken — Monatsverlauf." value={d.kpis.citations.value} delta={d.kpis.citations.delta} series={(d.trend || []).map((t) => ({ v: t.citations }))} color={C.teal} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <FunnelCard prompts={fP} opps={fO} />
              <PositionHeadToHead prompts={fP} sov={d.sov} brand={d.client} />
            </div>
            {Array.isArray(d.sov) && d.sov.length > 1 && (
              <div className="mt-4">
                <SovCard rows={d.sov} />
              </div>
            )}
          </>
        )}

        {tab === "marke" && (
          <BrandCheckCard bc={d.brandCheck} brand={d.client} history={d.brandHistory || []} />
        )}

        {tab === "quellen" && (
          <div className="mt-4 grid grid-cols-1 gap-4">
            <CitedTypesCard sources={d.sources} ownDomain={d.domain} />
            <SourcesTable rows={d.sources} />
          </div>
        )}

        {tab === "themen" && (
          <div className="mt-4 grid grid-cols-1 gap-4">
            <TopicTreemap rows={d.topics} />
            <TopicsTable rows={d.topics} />
          </div>
        )}

        {tab === "prompts" && (
          <div className="mt-4">
            <PromptsTable prompts={fP} opps={fO} brand={d.client} brandPrompts={d.brandPrompts || []} needsReview={d.promptsNeedsReview || 0} />
          </div>
        )}

        {tab === "conversions" && (
          <div className="mt-4">
            <AttributionStrip rows={d.attribution} convRows={convRows} />
          </div>
        )}

        <p className="mt-6 text-center text-[11px]" style={{ color: C.sub }}>
          EzyHub · AI Visibility · {d.market} · {d.date}
        </p>
      </div>
    </div>
  );
}

import React, { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// Prompt-Historie (11.08., Searchable "Response History"): lazy im Detail-Modal.
import { fetchPromptHistory } from "./data/useEzyAIVisibility";
// Echte Landkarte (04.08.): react-freie Geo-Bausteine — kein Peer-Dep-Risiko.
import { geoNaturalEarth1, geoPath, geoBounds } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Sparkles, TrendingUp, TrendingDown, Quote, FileText, Eye,
  ExternalLink, MousePointerClick, ChevronRight, ChevronLeft, MessageSquareQuote,
  Filter, Hash, Layers, Link2, Info, MessageSquare, Swords, Tags, Crosshair, MapPin, Search,
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
// ── Mobile (08.08.): SVG-Charts in echter Containerbreite zeichnen ──────────
// Bisher wurden feste viewBox-Breiten (520–1100) per width:100% skaliert — auf
// Smartphones schrumpften Achsen-Labels auf ~3–6px. Der Hook misst den
// Container (Callback-Ref, funktioniert auch bei konditionalem Mount) und
// liefert die Zeichenbreite: mind. `min`, darunter scrollt der Chart im
// overflow-x-Wrapper horizontal (gleiches Muster wie die Tabellen).
function useChartWidth(fallback, min) {
  const [w, setW] = useState(0);
  const roRef = useRef(null);
  const attach = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const W = w > 40 ? Math.max(Math.round(w), min) : fallback;
  return [attach, W];
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
 * Jede Model-Zeile trägt `layer`: "macro" = Brand Radar (DataForSEO LLM-Mentions),
 * "custom" = Prompt-Runner (Claude/Grok/DeepSeek etc.).
 */

// ── Tokens (angeglichen an EzyOneApps C-Palette) ─────────────────────────────
// Ezy One CD (2026-08-10): Pale Gray mit Purple-Bias, Purple #77008C als
// EINE Akzentfarbe für alles Klickbare (vorher generisches #7c3aed-Violett).
const C = {
  page: "transparent",
  card: "#ffffff",
  cardAlt: "#f7f5f9",  // aufgeklappte Zeilen / subtile Panels
  track: "#ede8f1",    // Balken-/Fortschritt-Hintergrund, Chips
  ink: "#161217",      // Haupttext
  sub: "#6d6473",      // gedämpft
  line: "#eae4ee",     // Rahmen
  indigo: "#77008C", // Marken-Purple — EINE Akzentfarbe für alles Klickbare
  teal: "#0d9488",
  amber: "#d97706",
  violet: "#77008C",
  up: "#0f9d6c", down: "#dc2626",
};
const CARD = { background: C.card, borderColor: C.line };

const nf = (n) => new Intl.NumberFormat("de-CH").format(n);
// Relative Zeit ("vor 3 Std.") für den Antwort-Zeitstempel (checked_at, ab 03.08.).
const relTime = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 36e5);
  if (h < 1) return "vor <1 Std.";
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.floor(h / 24)} Tagen`;
};
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
// Themen-Tab-Panel (03.08., Searchable-Parität): Suche + Umschalter Treemap/Tabelle.
function TopicsPanel({ rows, prompts }) {
  const [view, setView] = useState("beides"); // beides | treemap | tabelle
  const [q, setQ] = useState("");
  // Ø-Position je Thema (O, 03.08.): aus den Prompt-Positionen, sobald der
  // Messlauf topic je Antwort schreibt (top=3, list=2, passing=1).
  const posByTopic = new Map();
  for (const p of prompts || []) {
    if (!p.topic || !p.status || p.status === "Nicht erwähnt") continue;
    const v = { top: 3, list: 2, passing: 1 }[p.position] || 0;
    if (!v) continue;
    const t = posByTopic.get(p.topic) || { sum: 0, n: 0 };
    t.sum += v; t.n += 1; posByTopic.set(p.topic, t);
  }
  const posLabel = (topic) => {
    const t = posByTopic.get(topic);
    if (!t || !t.n) return null;
    const avg = t.sum / t.n;
    return avg >= 2.5 ? "Top-Empfehlung" : avg >= 1.5 ? "in Liste" : "Randnotiz";
  };
  const hasPos = posByTopic.size > 0;
  const enriched = (rows || []).map((t) => ({ ...t, avgPosLabel: posLabel(t.topic) }));
  const shown = q.trim() ? enriched.filter((t) => t.topic.toLowerCase().includes(q.trim().toLowerCase())) : enriched;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Themen durchsuchen…"
          className="h-8 w-52 rounded-md border px-2 text-xs focus:outline-none focus-visible:ring-2"
          style={{ borderColor: C.line, background: C.card, color: C.ink }}
        />
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: C.line, background: C.card }}>
          {[["beides", "Beides"], ["treemap", "Treemap"], ["tabelle", "Tabelle"]].map(([k, t]) => (
            <button key={k} onClick={() => setView(k)}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none"
              style={{ background: view === k ? C.indigo : "transparent", color: view === k ? "#fff" : C.sub }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {view !== "tabelle" && <TopicTreemap rows={shown} />}
      {view !== "treemap" && <TopicsTable rows={shown} hasPos={hasPos} />}
    </div>
  );
}

function TopicsTable({ rows, hasPos = false }) {
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
              {hasPos && <th className="px-3 py-2 text-center font-medium">Ø-Position</th>}
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
                {hasPos && (
                  <td className="px-3 py-2.5 text-center text-[11.5px]" style={{ color: r.avgPosLabel ? C.ink : C.sub }}>
                    {r.avgPosLabel || "—"}
                  </td>
                )}
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
              style={{ borderColor: C.line, color: C.indigo }}
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
              style={{ borderColor: C.line, color: C.indigo }}
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

// Domain-Favicon mit Fallback auf Initial-Chip (Google-s2-Dienst).
function DomainFavicon({ domain }) {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`} alt=""
        width={16} height={16} className="shrink-0 rounded-sm" loading="lazy" onError={() => setImgOk(false)} />
    );
  }
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white" style={{ background: C.sub }}>
      {String(domain).charAt(0).toUpperCase()}
    </span>
  );
}

function SourcesTable({ rows, ownDomain }) {
  const [q, setQ] = useState(""); // Suche (Searchable-Parität 03.08.)
  const shown = q.trim() ? rows.filter((r) => r.domain.toLowerCase().includes(q.trim().toLowerCase())) : rows;
  // Gap-Sicht (11.08.): wie viele der zitierten Domains gehören Konkurrenten?
  const rivalN = rows.filter((r) => domainOwnership(r.domain, ownDomain) === "rival").length;
  const ownN = rows.filter((r) => domainOwnership(r.domain, ownDomain) === "own").length;
  return (
    <div className="rounded-xl border" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <Link2 size={15} style={{ color: C.sub }} />
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>Referenzierte Quellen</h3>
        <span title="Alle Domains, die in KI-Antworten als Quelle verlinkt oder genannt wurden." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={13} /></span>
        <span className="truncate text-[12px]" style={{ color: C.sub }}>· Jede zitierte Domain über alle KI-Antworten</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Domain suchen…"
          className="ml-auto h-7 w-40 rounded-md border px-2 text-xs focus:outline-none focus-visible:ring-2"
          style={{ borderColor: C.line, background: C.card, color: C.ink }}
        />
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
            {shown.map((r) => (
              <tr key={r.domain} className="border-t" style={{ borderColor: C.line }}>
                <td className="px-5 py-2.5">
                  <span className="inline-flex items-center gap-2 font-medium" style={{ color: C.indigo }}>
                    <DomainFavicon domain={r.domain} />
                    {r.domain} <ExternalLink size={11} />
                    <OwnershipChip kind={domainOwnership(r.domain, ownDomain)} />
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
      {rivalN > 0 && (
        <div className="border-t px-5 py-2.5 text-[11px]" style={{ borderColor: C.line, color: C.sub }}>
          <b style={{ color: "#b91c1c" }}>{rivalN}</b> der {rows.length} zitierten Domains {rivalN === 1 ? "gehört" : "gehören"} Konkurrenten
          {ownN ? <> — die eigene Website wird {ownN === 1 ? "als 1 Domain" : `über ${ownN} Domains`} zitiert.</> : <> — die eigene Website wird bisher nicht zitiert.</>}{" "}
          Eigene zitierfähige Inhalte zu diesen Themen schliessen die Lücke.
        </div>
      )}
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
          txn: e.txn,
          currency: e.currency,
        }))
      : convRows.filter((r) => ATTR_SOURCE_RE[openRow.engine]?.test(String(r.source || "")))
    : [];
  return (
    <div className="rounded-xl border p-5" style={CARD}>
      <div className="flex items-center gap-2">
        <MousePointerClick size={15} style={{ color: C.teal }} />
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Besucher</h3>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: C.sub }}>
        letzte 30 Tage · {nf(totalS)} Besucher · {totalC} Conversions
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
                      <td className="px-2 py-1.5 font-semibold" style={{ color: C.ink }}>
                        {r.description || r.eventName || "—"}
                        {r.txn && <span className="ml-1.5 font-normal text-[11px]" style={{ color: C.sub }}>#{r.txn}</span>}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: C.sub }}>{fmtGa4Date(r.date)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: r.value > 0 ? C.up : C.sub }}>
                        {r.value > 0 ? `${Math.round(r.value).toLocaleString("de-CH")} ${r.currency || "CHF"}` : "—"}
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
function InlineMd({ text, highlight }) {
  const s = String(text || "");
  const rx = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s)\]}>"',;]+)/g;
  const out = [];
  let last = 0, m, k = 0;
  // Marken-Highlight (04.08.): Vorkommen der eigenen Marke gelb markieren —
  // beantwortet direkt die Frage „WO steht die Marke in dieser Antwort?".
  const pushText = (str) => {
    if (!highlight || !str) { out.push(str); return; }
    const hre = new RegExp(String(highlight).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let hl = 0, hm;
    while ((hm = hre.exec(str))) {
      if (hm.index > hl) out.push(str.slice(hl, hm.index));
      out.push(<mark key={k++} style={{ background: "#fde68a", color: "#78350f", borderRadius: 3, padding: "0 2px", fontWeight: 600 }}>{hm[0]}</mark>);
      hl = hre.lastIndex;
    }
    if (hl < str.length) out.push(str.slice(hl));
  };
  while ((m = rx.exec(s))) {
    if (m.index > last) pushText(s.slice(last, m.index));
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
  if (last < s.length) pushText(s.slice(last));
  return <>{out}</>;
}

// Blockebene: Überschriften (#…), Aufzählungen (-/*/•), nummerierte Listen,
// Absätze — macht aus dem Roh-Text der Engines eine lesbare Antwort.
function AnswerBlocks({ text, highlight }) {
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
          <div key={i} className="text-[13px] font-semibold" style={{ color: C.ink }}><InlineMd text={b.text} highlight={highlight} /></div>
        ) : b.type === "p" ? (
          <p key={i} className="text-[13px] leading-relaxed" style={{ color: C.ink }}><InlineMd text={b.text} highlight={highlight} /></p>
        ) : b.type === "ul" ? (
          <ul key={i} className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: C.ink }}>
                <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.indigo }} />
                <span className="min-w-0"><InlineMd text={it} highlight={highlight} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: C.ink }}>
                <span className="w-5 shrink-0 text-right font-semibold tabular-nums" style={{ color: C.indigo }}>{j + 1}.</span>
                <span className="min-w-0"><InlineMd text={it} highlight={highlight} /></span>
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// Prompt-Detail als Pop-up (User-Wunsch 2026-07-19, Semrush-Vorbild):
// ── Antwort-Historie (11.08., Searchable "Response History") ─────────────────
// Verlauf desselben Prompts über die letzten Mess-Snapshots: Matrix Datum ×
// Engine (Status-Punkt), Klick auf einen Punkt zeigt die damalige Antwort.
// Lazy geladen (RLS-Read), damit das Modal ohne Zusatzkosten öffnet.
function PromptHistorySection({ clientId, prompt, brand }) {
  const [hist, setHist] = useState(null); // null=lädt, []=keine Daten
  const [sel, setSel] = useState(null);   // { date, platform, response }
  useEffect(() => {
    let alive = true;
    fetchPromptHistory(clientId, prompt)
      .then((rows) => { if (alive) setHist(rows); })
      .catch(() => { if (alive) setHist([]); });
    return () => { alive = false; };
  }, [clientId, prompt]);
  if (hist === null) return <p className="mt-5 text-[11px]" style={{ color: C.sub }}>Verlauf wird geladen…</p>;
  const dates = [...new Set(hist.map((r) => r.date))]; // absteigend sortiert
  if (dates.length < 2) return null; // erst ab 2 Snapshots interessant
  const platforms = [...new Set(hist.map((r) => r.platform))].sort();
  const cell = new Map(hist.map((r) => [`${r.date}|${r.platform}`, r]));
  const fmtD = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: C.line }}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: C.ink }}>
        Verlauf
        <span title="Dieselbe Frage über die letzten Messläufe: Wie stabil ist die Erwähnung je KI-Modell? Punkt anklicken für die damalige Antwort." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
        <span className="font-normal" style={{ color: C.sub }}>· {dates.length} Messungen</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr style={{ color: C.sub }}>
              <th className="pr-3 py-1 text-left font-medium">Datum</th>
              {platforms.map((p) => (
                <th key={p} className="px-2 py-1 text-center font-medium"><EngineFavicon platform={p} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.slice(0, 12).map((dt) => (
              <tr key={dt} className="border-t" style={{ borderColor: C.line }}>
                <td className="pr-3 py-1.5 tabular-nums" style={{ color: C.ink }}>{fmtD(dt)}</td>
                {platforms.map((p) => {
                  const r = cell.get(`${dt}|${p}`);
                  if (!r) return <td key={p} className="px-2 py-1.5 text-center" style={{ color: C.sub }}>·</td>;
                  const active = sel && sel.date === dt && sel.platform === p;
                  return (
                    <td key={p} className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => setSel(active ? null : { date: dt, platform: p, response: r.response, status: r.status })}
                        title={`${p} · ${r.status || "kein Status"}`}
                        className="inline-block h-3 w-3 rounded-full transition"
                        style={{ background: STATUS_COLOR(r.status || "Nicht erwähnt"), outline: active ? `2px solid ${C.indigo}` : "none", outlineOffset: 1 }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="mt-3 rounded-lg border p-3 text-[11.5px] leading-relaxed" style={{ borderColor: C.line, background: C.cardAlt, color: C.ink }}>
          <div className="mb-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: C.sub }}>
            <b>{sel.platform}</b> am {fmtD(sel.date)} · <StatusPill s={sel.status} />
          </div>
          {String(sel.response || "").slice(0, 1200) || "Keine Antwort gespeichert."}
          {String(sel.response || "").length > 1200 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

// Header = Prompt + Modell-Tabs (Status-Punkt je Engine), linke Spalte =
// Quellen + Mit-genannt, rechte Spalte = Antwort mit Status/Position/Tonalität.
function PromptDetailModal({ g, opportunity, brand, clientId, onClose }) {
  const [tab, setTab] = useState(0);
  const e = g.engines[Math.min(tab, g.engines.length - 1)] || {};
  useEffect(() => {
    const h = (ev) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  // Erklärungs-Banner (04.08., User-Befund): Status sagt „erwähnt", aber die
  // Marke steht nicht im gespeicherten Text — zwei ehrliche Gründe:
  // (a) gespeicherte Fassung war gekappt (bis 04.08. nur 1500 Zeichen; der
  //     Judge bewertet den VOLLEN Text), (b) „Referenziert" = Website als
  //     Quelle verlinkt, das braucht keine Namensnennung im Fliesstext.
  const mentioned = e.status && e.status !== "Nicht erwähnt";
  const brandInText = brand && String(e.response || "").toLowerCase().includes(String(brand).toLowerCase());
  // „Gekürzt"-Erkennung (05.08. präzisiert): NUR bei echter Kappung —
  // (a) Speicher-Slice bei 6000 Zeichen erreicht, oder (b) Alt-Messung vor dem
  // maxTokens-Fix (Token-Stopp landete exakt im Band 1450–1500). Lange, sauber
  // beendete Antworten sind seit dem Fix der Normalfall — keine Fussnote mehr.
  const respLen = String(e.response || "").length;
  const truncated = respLen >= 5990 || (respLen >= 1450 && respLen <= 1500);
  const explain = mentioned && !brandInText
    ? (e.status === "Referenziert" && !truncated
        ? `„Referenziert" heisst: Die Website von ${brand} ist in dieser Antwort als Quelle verlinkt — das kann auch ohne Namensnennung im Text passieren.`
        : `Die Bewertung basiert auf der vollständigen KI-Antwort. Hier ist nur eine gekürzte Fassung gespeichert — die Nennung von ${brand} liegt im abgeschnittenen Teil. Ab dem nächsten Messlauf wird deutlich mehr Text gespeichert.`)
    : null;
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
              <h3 className="text-[15px] font-bold leading-snug" style={{ color: C.ink }}>{g.prompt}</h3>
              {g.country && (
                <span className="mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10.5px]" style={{ borderColor: C.line, color: C.sub }}>{g.country}</span>
              )}
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
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition"
                  style={{
                    borderColor: active ? C.indigo : C.line,
                    background: active ? `${C.indigo}14` : C.card,
                    color: active ? C.indigo : C.sub,
                  }}
                >
                  <EngineFavicon platform={en.platform} status={en.status} />
                  {en.platform}
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
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
            {explain && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed"
                style={{ borderColor: "#f0c36d", background: "#fdf6e3", color: "#8a6d1b" }}>
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>{explain}</span>
              </div>
            )}
            {e.response ? (
              <div className="mt-3 rounded-xl border p-5" style={{ borderColor: C.line, background: "#fff" }}>
                <AnswerBlocks text={e.response} highlight={brandInText ? brand : null} />
                {truncated && (
                  <div className="mt-3 border-t pt-2 text-[10.5px] italic" style={{ borderColor: C.line, color: C.sub }}>
                    Gekürzte Fassung — die Bewertung basiert auf der vollständigen Antwort.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs" style={{ color: C.sub }}>Keine Antwort gespeichert.</p>
            )}
            {e.comps?.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium" style={{ color: C.sub }}>
                  {opportunity ? "Genannte Konkurrenten:" : "Mit-genannt:"}
                </span>
                {e.comps.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: C.line, background: C.card, color: C.ink }}>
                    <BrandIcon name={c} size={14} />
                    {c}
                  </span>
                ))}
              </div>
            )}
            {clientId && <PromptHistorySection clientId={clientId} prompt={g.prompt} brand={brand} />}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Engine-Favicon (Searchable-Optik): bekanntes KI-System -> echtes Favicon,
// unbekannt -> farbiger Status-Punkt wie bisher.
const ENGINE_DOMAIN = [
  ["chatgpt", "openai.com"], ["gpt", "openai.com"], ["openai", "openai.com"],
  ["claude", "claude.ai"], ["gemini", "gemini.google.com"], ["perplexity", "perplexity.ai"],
  ["grok", "x.ai"], ["deepseek", "deepseek.com"], ["copilot", "copilot.microsoft.com"],
  ["aio", "google.com"], ["ai-mode", "google.com"], ["ai mode", "google.com"], ["google", "google.com"],
  ["llama", "meta.com"], ["mistral", "mistral.ai"],
];
const engineDomain = (platform) => {
  const p = String(platform || "").toLowerCase();
  return ENGINE_DOMAIN.find(([k]) => p.includes(k))?.[1];
};
function EngineFavicon({ platform, status }) {
  const [imgOk, setImgOk] = useState(true);
  const dom = engineDomain(platform);
  if (dom && imgOk) {
    return (
      <img src={`https://www.google.com/s2/favicons?domain=${dom}&sz=32`} alt="" width={16} height={16}
        className="mt-0.5 shrink-0 rounded-sm" loading="lazy" onError={() => setImgOk(false)} />
    );
  }
  return <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR(status || "Nicht erwähnt") }} />;
}

// Marken-Zelle: bis 3 Initial-Chips der mit-genannten Marken + "+N" (Searchable-Stapel).
function BrandStack({ comps, total }) {
  const names = (comps || []).slice(0, 3);
  const rest = Math.max(0, (total ?? (comps || []).length) - names.length);
  if (!names.length && !rest) return <span style={{ color: C.sub }}>—</span>;
  return (
    <span className="inline-flex items-center -space-x-1" title={(comps || []).join(", ")}>
      {names.map((n) => (
        <span key={n} className="inline-flex overflow-hidden rounded-full ring-1 ring-white">
          <BrandIcon name={n} size={16} />
        </span>
      ))}
      {rest > 0 && <span className="pl-1.5 text-[10px] tabular-nums" style={{ color: C.sub }}>+{rest}</span>}
    </span>
  );
}

// Ja/Nein-Pill (Searchable All-Responses-Muster: grünes ✓ / rotes ✕)
function YesNoPill({ yes }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
      style={{ background: yes ? "#d1fae5" : "#fee2e2", color: yes ? "#065f46" : "#b91c1c" }}>
      {yes ? "✓ Ja" : "✕ Nein"}
    </span>
  );
}
// All-Responses-Optik (03.08.): Gruppe aufklappbar, je Engine EINE Zeile mit
// Erwähnt?/Zitiert?/Position/Marken/Quellen — Detail-Modal weiter per Klick.
function PromptGroupRow({ g, opportunity, brand, clientId }) {
  const [open, setOpen] = useState(false);      // Detail-Modal (Antwort-Volltexte)
  const [expanded, setExpanded] = useState(false); // Default zu (Volkan 06.08.); Klick auf die Zeile klappt auf
  const rate = g.total ? Math.round((g.mentioned / g.total) * 100) : 0;
  return (
    <>
      <tr
        className="border-t cursor-pointer transition-colors"
        style={{ borderColor: C.line, background: expanded ? C.cardAlt : "transparent" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-5 py-3 align-top" colSpan={4}>
          <div className="flex items-start gap-2">
            <ChevronRight size={14} className="mt-0.5 shrink-0 transition-transform" style={{ color: C.sub, transform: expanded ? "rotate(90deg)" : "none" }} />
            <div className="min-w-0">
              <span className="font-medium" style={{ color: C.ink }}>{g.prompt}</span>
              <span className="ml-2 text-[11px]" style={{ color: C.sub }}>
                {g.engines.length} Antworten · {g.country}
                {g.engines[0]?.checkedAt && ` · ${relTime(g.engines[0].checkedAt)}`}
              </span>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 align-top" colSpan={3}>
          <div className="flex items-center justify-end gap-2">
            {!opportunity && (
              <>
                <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: C.track }}>
                  <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 50 ? C.up : rate > 0 ? C.indigo : C.amber }} />
                </div>
                <span className="w-9 text-right text-xs tabular-nums" style={{ color: C.ink }}>{g.mentioned}/{g.total}</span>
              </>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(true); }}
              className="rounded-md border px-2.5 py-1 text-[10.5px] font-medium"
              style={{ borderColor: C.line, color: C.indigo, background: C.card }}
            >
              Details
            </button>
          </div>
        </td>
      </tr>
      {expanded && g.engines.map((e) => {
        const mentioned = e.status && e.status !== "Nicht erwähnt";
        const cited = e.status === "Referenziert";
        const snippet = String(e.response || "").replace(/\s+/g, " ").slice(0, 110);
        return (
          <tr key={e.platform} className="border-t" style={{ borderColor: C.line }}>
            <td className="py-2 pl-11 pr-3 align-top">
              <div className="flex items-start gap-2">
                <EngineFavicon platform={e.platform} status={e.status} />
                <div className="min-w-0">
                  <span className="text-[12px] font-semibold" style={{ color: C.ink }}>{e.platform}</span>
                  {snippet && <span className="ml-2 text-[11.5px]" style={{ color: C.sub }}>{snippet}{(e.response || "").length > 110 ? "…" : ""}</span>}
                </div>
              </div>
            </td>
            <td className="px-3 py-2 text-center align-top"><YesNoPill yes={mentioned} /></td>
            <td className="px-3 py-2 text-center align-top"><YesNoPill yes={cited} /></td>
            <td className="px-3 py-2 text-center align-top text-[11.5px]" style={{ color: mentioned ? C.ink : C.sub }}>
              {mentioned && e.position ? (POS_LABEL[e.position] || "—") : "—"}
            </td>
            <td className="px-3 py-2 text-center align-top text-[11.5px]"><BrandStack comps={e.comps} total={e.brands} /></td>
            <td className="px-3 py-2 text-center align-top text-[11.5px] tabular-nums" style={{ color: C.sub }}>{e.sources || "—"}</td>
            <td className="px-3 py-2 text-center align-top text-[11px] whitespace-nowrap" style={{ color: C.sub }}>{e.checkedAt ? relTime(e.checkedAt) : "—"}</td>
          </tr>
        );
      })}
      {open && <PromptDetailModal g={g} opportunity={opportunity} brand={brand} clientId={clientId} onClose={() => setOpen(false)} />}
    </>
  );
}

// Prompt Performance Matrix (Searchable-Doku „visibility-tracking"): Streudiagramm
// X = Erwähnungsquote, Y = Ø-Position, Blasengrösse = Anzahl zitierter Quellen
// (Searchable nutzt Suchvolumen — wir haben keins je Prompt, Quellen sind der
// ehrliche Ersatz), Farbe = Suchintention.
const INTENT_COLOR = {
  kommerziell: C.violet, commercial: C.violet,
  informativ: C.indigo, informational: C.indigo,
  transaktional: C.teal, transactional: C.teal,
  navigativ: C.amber, navigational: C.amber,
};
const POS_SCORE = { top: 3, list: 2, passing: 1 };

function PromptMatrix({ prompts, opps }) {
  const [chartRef, W] = useChartWidth(560, 460);
  const groups = groupPrompts([...(prompts || []), ...(opps || []).map((o) => ({ ...o, status: "Nicht erwähnt" }))]);
  const dots = groups.map((g) => {
    const rate = g.total ? (g.mentioned / g.total) * 100 : 0;
    const posVals = g.engines.map((e) => POS_SCORE[e.position] || 0);
    const avgPos = posVals.length ? posVals.reduce((a, b) => a + b, 0) / posVals.length : 0;
    const srcSum = g.engines.reduce((a, e) => a + (Number(e.sources) || 0), 0);
    const intent = (g.engines.find((e) => e.intent)?.intent || "").toLowerCase();
    return { prompt: g.prompt, country: g.country, rate, avgPos, srcSum, intent, mentioned: g.mentioned, total: g.total };
  });
  if (dots.length < 3) return null;
  const H = 290, PL = 42, PR = 14, PT = 18, PB = 34;
  const maxSrc = Math.max(1, ...dots.map((d) => d.srcSum));
  const x = (rate) => PL + (rate / 100) * (W - PL - PR);
  const y = (pos) => PT + (1 - pos / 3) * (H - PT - PB);
  const r = (src) => 5 + Math.sqrt(src / maxSrc) * 11;
  const intents = [...new Set(dots.map((d) => d.intent).filter((i) => INTENT_COLOR[i]))];
  const QUAD = [
    { tx: PL + 8, ty: PT + 12, anchor: "start", t: "Ausbaufähig" },       // selten erwähnt, gut platziert
    { tx: W - PR - 8, ty: PT + 12, anchor: "end", t: "Top-Performer" },   // oft erwähnt, gut platziert
    { tx: PL + 8, ty: H - PB - 6, anchor: "start", t: "Aufbau nötig" },   // selten erwähnt, schwach
    { tx: W - PR - 8, ty: H - PB - 6, anchor: "end", t: "Schwach platziert" },
  ];
  return (
    <RCard
      icon={Crosshair}
      title="Prompt Performance Matrix"
      info="Jede Blase = ein Prompt. X-Achse: Anteil der KI-Antworten mit Erwähnung. Y-Achse: durchschnittliche Position (Top-Empfehlung > in Liste > Randnotiz). Blasengrösse: Anzahl zitierter Quellen. Farbe: Suchintention."
      desc="Erwähnungsquote × Position je Prompt — Blase antippen für Details"
      footer={`${dots.length} Prompts`}
    >
      <div ref={chartRef} style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, display: "block" }}>
        {/* Quadranten-Hilfslinien */}
        <line x1={x(50)} x2={x(50)} y1={PT} y2={H - PB} stroke={C.line} strokeWidth="1" strokeDasharray="3 3" />
        <line x1={PL} x2={W - PR} y1={y(1.5)} y2={y(1.5)} stroke={C.line} strokeWidth="1" strokeDasharray="3 3" />
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke={C.line} strokeWidth="1" />
        <line x1={PL} x2={PL} y1={PT} y2={H - PB} stroke={C.line} strokeWidth="1" />
        {QUAD.map((q) => (
          <text key={q.t} x={q.tx} y={q.ty} textAnchor={q.anchor} fontSize="11.5" fontWeight="600" fill={C.sub} opacity="0.65">{q.t}</text>
        ))}
        {/* Achsen-Beschriftung */}
        {[0, 50, 100].map((v) => (
          <text key={v} x={x(v)} y={H - PB + 14} textAnchor="middle" fontSize="11" fill={C.sub}>{v}%</text>
        ))}
        {[["Top", 3], ["Liste", 2], ["Rand", 1]].map(([t, v]) => (
          <text key={t} x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="11" fill={C.sub}>{t}</text>
        ))}
        <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill={C.sub}>Erwähnungsquote</text>
        {/* Blasen — grösste zuerst, damit kleine anklickbar oben liegen.
            Identische Koordinaten (häufig: Quote 0/25/50 %, Position 0) werden
            deterministisch spiralförmig entzerrt, sonst sieht man 1 statt 75. */}
        {(() => {
          const seen = new Map();
          return [...dots].sort((a, b) => b.srcSum - a.srcSum).map((d, i) => {
            const key = `${Math.round(d.rate)}|${d.avgPos.toFixed(2)}`;
            const k = seen.get(key) || 0;
            seen.set(key, k + 1);
            const ang = k * 2.4, rad = 7 * Math.sqrt(k);
            const cx = Math.min(W - PR - 4, Math.max(PL + 4, x(d.rate) + rad * Math.cos(ang)));
            const cy = Math.min(H - PB - 4, Math.max(PT + 4, y(d.avgPos) + rad * Math.sin(ang)));
            return (
              <circle
                key={`${d.prompt}·${d.country}·${i}`}
                cx={cx} cy={cy} r={r(d.srcSum)}
                fill={INTENT_COLOR[d.intent] || C.sub} fillOpacity="0.55"
                stroke={INTENT_COLOR[d.intent] || C.sub} strokeWidth="1"
              >
                <title>{`${d.prompt}\nErwähnt: ${d.mentioned}/${d.total} (${Math.round(d.rate)} %) · Quellen: ${d.srcSum}${d.intent ? ` · ${d.intent}` : ""}`}</title>
              </circle>
            );
          });
        })()}
      </svg>
      </div>
      {intents.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px]" style={{ color: C.sub }}>
          {intents.map((i) => (
            <span key={i} className="inline-flex items-center gap-1.5 capitalize">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: INTENT_COLOR[i] }} />{i}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: C.sub }} />ohne Intent</span>
        </div>
      )}
    </RCard>
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

// CSV-Export (Searchable-Parität): flache Zeilen Prompt × Engine als Download.
function promptsToCsv(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Prompt", "Land", "KI-System", "Status", "Position", "Marken", "Quellen", "Antwort"];
  const lines = rows.map((r) =>
    [r.prompt, r.country, r.platform, r.status || "Nicht erwähnt", POS_LABEL[r.position] || "", r.brands ?? "", r.sources ?? "", String(r.response || "").slice(0, 500)].map(esc).join(";"),
  );
  return "﻿" + [head.map(esc).join(";"), ...lines].join("\r\n");
}

function PromptsTable({ prompts, opps, brand, brandPrompts = [], needsReview = 0, onReview, clientId }) {
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");            // Suchfeld (Searchable-Parität)
  const [statusF, setStatusF] = useState("alle"); // Status-Filter
  const allRows = [...prompts, ...opps.map((o) => ({ ...o, status: "Nicht erwähnt" }))];
  let source = tab === "all" ? allRows : tab === "win" ? prompts : tab === "brand" ? brandPrompts : opps;
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    source = source.filter((r) => r.prompt.toLowerCase().includes(needle) || String(r.response || "").toLowerCase().includes(needle));
  }
  if (statusF !== "alle") {
    source = source.filter((r) =>
      statusF === "zitiert" ? r.status === "Referenziert"
      : statusF === "erwaehnt" ? r.status && r.status !== "Nicht erwähnt"
      : !r.status || r.status === "Nicht erwähnt",
    );
  }
  const downloadCsv = () => {
    const blob = new Blob([promptsToCsv(source)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ezyai-prompts-${brand.replace(/[^a-z0-9.-]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const opportunity = tab === "opp";
  const groups = groupPrompts(source);
  const pages = Math.max(1, Math.ceil(groups.length / PROMPTS_PAGE_SIZE));
  const cur = Math.min(page, pages - 1); // Tab-Wechsel kann die Seitenzahl verkleinern
  const pageGroups = groups.slice(cur * PROMPTS_PAGE_SIZE, (cur + 1) * PROMPTS_PAGE_SIZE);
  return (
    <div className="rounded-xl border" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="flex items-baseline gap-2 text-sm font-semibold" style={{ color: C.ink }}>
          Alle Antworten
          <span className="text-[11.5px] font-normal" style={{ color: C.sub }}>· jede KI-Antwort über alle Prompts · {source.length} Antworten</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Prompts durchsuchen…"
            className="h-7 w-44 rounded-md border px-2 text-xs focus:outline-none focus-visible:ring-2"
            style={{ borderColor: C.line, background: C.card, color: C.ink }}
          />
          <select
            value={statusF}
            onChange={(e) => { setStatusF(e.target.value); setPage(0); }}
            className="h-7 rounded-md border px-1.5 text-xs focus:outline-none"
            style={{ borderColor: C.line, background: C.card, color: C.sub }}
          >
            <option value="alle">Alle Status</option>
            <option value="erwaehnt">Nur erwähnt</option>
            <option value="zitiert">Nur zitiert</option>
            <option value="nicht">Nicht erwähnt</option>
          </select>
          <button onClick={downloadCsv} className="h-7 rounded-md border px-2 text-xs font-medium" style={{ borderColor: C.line, color: C.indigo, background: C.card }}>
            CSV
          </button>
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
      </div>
      {needsReview > 0 && (
        <div
          role={onReview ? "button" : undefined}
          tabIndex={onReview ? 0 : undefined}
          onClick={onReview}
          onKeyDown={onReview ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReview(); } } : undefined}
          className="mx-5 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]"
          style={{ borderColor: "#f0c36d", background: "#fdf6e3", color: "#8a6d1b", cursor: onReview ? "pointer" : undefined }}>
          <span aria-hidden>⚠️</span>
          <span className="flex-1">
            <strong>{needsReview} {needsReview === 1 ? "Prompt wartet" : "Prompts warten"} auf Prüfung.</strong>{" "}
            Frisch generierte oder vom Relevanz-Check als themenfremd deaktivierte Prompts – sie werden nicht gemessen, bis sie bestätigt sind. So landen keine falschen Prompts (z. B. aus einer fremden Branche) im Dashboard.
          </span>
          {onReview && (
            <span className="whitespace-nowrap font-semibold underline" style={{ alignSelf: "center" }}>
              Jetzt prüfen →
            </span>
          )}
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
              <th className="px-5 py-2 font-medium">KI-Antwort</th>
              <th className="px-3 py-2 text-center font-medium">Erwähnt?</th>
              <th className="px-3 py-2 text-center font-medium">Zitiert?</th>
              <th className="px-3 py-2 text-center font-medium">Position</th>
              <th className="px-3 py-2 text-center font-medium">Marken</th>
              <th className="px-3 py-2 text-center font-medium">Quellen</th>
              <th className="px-3 py-2 text-center font-medium">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {pageGroups.map((g) => (
              <PromptGroupRow key={`${g.prompt}·${g.country}`} g={g} opportunity={opportunity} brand={brand} clientId={clientId} />
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
              style={{ borderColor: C.line, color: C.indigo }}
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
              style={{ borderColor: C.line, color: C.indigo }}
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
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: C.sub }} />Korpus-Backfill (DataForSEO)</span>
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
// only: "positions" = nur die Matrizen · "head2head" = nur der 1:1-Vergleich ·
// undefined = beides (04.08.: Head-to-Head wird separat in die linke Spalte gelegt).
function PositionHeadToHead({ prompts, opps, sov, brand, only }) {
  // Nenner-Fix (06.08., Volkan: "Präsenz immer 100%"): Nicht-erwähnte Prompts
  // liegen als CHANCEN (is_opportunity) in einer eigenen Liste — ohne sie war
  // die Grundgesamtheit nur "Antworten mit eigener Erwähnung" und die eigene
  // Präsenz konstant 100 %. Chancen-Zeilen haben keinen status (→ zählen als
  // "nicht genannt"), tragen aber comps/compPositions der Konkurrenz.
  const all = [...(prompts || []), ...(opps || [])];
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

  // Rival-Positions-Matrix (H, 03.08.): Marken × Position — erst befüllt, wenn
  // der Judge comp_positions liefert (ab dem Messlauf nach dem 03.08.).
  const withRivalPos = all.filter((p) => Array.isArray(p.compPositions) && p.compPositions.length);
  const brandMatrix = (() => {
    if (!withRivalPos.length) return [];
    const total = all.length || 1;
    const tally = new Map();
    const bump = (name, pos, self) => {
      const t = tally.get(name) || { name, self, top: 0, list: 0, passing: 0, seen: 0 };
      t[pos] = (t[pos] || 0) + 1; t.seen += 1; tally.set(name, t);
    };
    for (const p of all) {
      if (p.status && p.status !== "Nicht erwähnt" && p.position && p.position !== "none") bump(brand, p.position, true);
      for (const cp of p.compPositions || []) bump(cp.n, ["top", "list", "passing"].includes(cp.p) ? cp.p : "list", false);
    }
    return [...tally.values()]
      .sort((a, b) => (b.self ? 1 : 0) - (a.self ? 1 : 0) || b.seen - a.seen)
      .slice(0, 8)
      .map((t) => ({ ...t, topP: (t.top / total) * 100, listP: (t.list / total) * 100, passingP: (t.passing / total) * 100, noneP: ((total - t.seen) / total) * 100 }));
  })();

  const comps = (sov || []).filter((s) => !s.isSelf).slice(0, 5);
  const [rivalIdx, setRivalIdx] = useState(0);
  const rival = comps[Math.min(rivalIdx, Math.max(0, comps.length - 1))] || null;
  const answered = all.filter((p) => p.status && p.status !== "Nicht erwähnt");
  const rivalRows = rival ? all.filter((p) => (p.comps || []).some((c) => c.toLowerCase() === rival.brand.toLowerCase())) : [];
  const selfRate = all.length ? Math.round((answered.length / all.length) * 1000) / 10 : 0;
  const rivalRate = all.length ? Math.round((rivalRows.length / all.length) * 1000) / 10 : 0;
  const selfShare = (sov || []).find((s) => s.isSelf)?.share ?? null;
  if (!matrix.length && !rival) return null;
  if (only === "head2head" && !rival) return null;
  if (only === "positions" && !matrix.length && brandMatrix.length <= 1) return null;
  const showPositions = only !== "head2head";
  const showHead = only !== "positions";

  return (
    <div className="grid grid-cols-1 gap-4">
      {showPositions && matrix.length > 0 && (
        <RCard icon={Hash} title="Antwort-Position" info="Wo die eigene Marke in den KI-Antworten steht: Top-Empfehlung, in einer Liste, Randnotiz oder nicht genannt — je KI-System." desc="Wo die Marke in KI-Antworten erscheint" footer={`${all.length} Antworten · eigene Marke je KI-System${withRivalPos.length ? "" : " (Konkurrenz-Positionen ab dem nächsten Messlauf)"}`} legend={<HeatLegend from="Niedrig" to="Hoch" />} pad={false}>
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
      {showPositions && brandMatrix.length > 1 && (
        <RCard icon={Hash} title="Positions-Verteilung nach Marke" info="Wo jede Marke in denselben KI-Antworten erscheint — Rival-Positionen bewertet der Judge seit dem 03.08.2026." desc="Marken im Positions-Vergleich (Searchable Position Distribution)" footer={`${withRivalPos.length} Antworten mit Rival-Bewertung`} legend={<HeatLegend from="Niedrig" to="Hoch" />} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: C.sub }}>
                  <th className="px-5 py-2 text-left font-medium">Marke</th>
                  <th className="px-3 py-2 text-center font-medium">Top-Empfehlung</th>
                  <th className="px-3 py-2 text-center font-medium">In Liste</th>
                  <th className="px-3 py-2 text-center font-medium">Randnotiz</th>
                  <th className="px-3 py-2 text-center font-medium">Nicht genannt</th>
                </tr>
              </thead>
              <tbody>
                {brandMatrix.map((r) => (
                  <tr key={r.name} style={{ borderTop: `1px solid ${C.line}`, background: r.self ? "rgba(119,0,140,.05)" : "transparent" }}>
                    <td className="px-5 py-2 font-semibold" style={{ color: r.self ? C.indigo : C.ink }}>
                      {r.name}{r.self && <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: C.indigo, color: "#fff" }}>DU</span>}
                    </td>
                    <HeatCell pct={r.topP} />
                    <HeatCell pct={r.listP} />
                    <HeatCell pct={r.passingP} />
                    <td className="px-3 py-2 text-center text-[11.5px] tabular-nums" style={{ color: C.sub }}>{Math.round(r.noneP)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RCard>
      )}
      {showHead && rival && (
        <RCard icon={Swords} title="Head-to-Head" info="Direktvergleich der Präsenz in denselben KI-Antworten: eigene Marke gegen einen wählbaren Konkurrenten." desc={`${brand} im 1:1-Vergleich`} footer="Präsenz = Anteil der Antworten, in denen die Marke vorkommt" legend={
          <select value={rivalIdx} onChange={(e) => setRivalIdx(Number(e.target.value))}
            className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: C.line, background: C.card, color: C.ink }}>
            {comps.map((c, i) => <option key={c.brand} value={i}>{c.brand}</option>)}
          </select>
        }>
          <div className="grid grid-cols-2 gap-4">
            {[{ name: brand, rate: selfRate, share: selfShare, self: true }, { name: rival.brand, rate: rivalRate, share: rival.share, self: false }].map((b) => (
              <div key={b.name} className="rounded-lg border p-3" style={{ borderColor: b.self ? C.indigo : C.line, background: b.self ? "rgba(119,0,140,.04)" : "transparent" }}>
                <div className="truncate text-[12px] font-semibold" style={{ color: b.self ? C.indigo : C.ink }}>{b.name}{b.self ? " (du)" : ""}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: C.ink }}>{b.rate}%</div>
                <div className="text-[10px]" style={{ color: C.sub }}>Präsenz in KI-Antworten</div>
                {b.share != null && <div className="mt-1 text-[11px] tabular-nums" style={{ color: C.sub }}>Share of Voice: {b.share}%</div>}
              </div>
            ))}
          </div>
          {/* Auto-Vergleichstext (Searchable-Parität, deterministisch aus den Zahlen — kein LLM) */}
          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: C.sub }}>
            {selfRate > rivalRate
              ? <>{brand} ist mit <strong style={{ color: C.ink }}>{selfRate} %</strong> Präsenz häufiger in KI-Antworten vertreten als {rival.brand} ({rivalRate} %).</>
              : selfRate < rivalRate
              ? <>{rival.brand} ist mit <strong style={{ color: C.ink }}>{rivalRate} %</strong> Präsenz häufiger in KI-Antworten vertreten als {brand} ({selfRate} %).</>
              : <>{brand} und {rival.brand} sind mit je {selfRate} % gleich präsent.</>}
            {selfShare != null && rival.share != null && (
              <> Beim Share of Voice {selfShare > rival.share ? "führt" : selfShare < rival.share ? "liegt" : "gleichauf liegt"} {selfShare >= rival.share ? brand : rival.brand} mit {Math.max(selfShare, rival.share)} % gegenüber {Math.min(selfShare, rival.share)} %{selfShare < rival.share ? ` — ${rival.brand} wird pro Antwort öfter genannt, obwohl ${brand} ${selfRate >= rivalRate ? "häufiger vorkommt" : "seltener vorkommt"}` : ""}.</>
            )}
          </p>
        </RCard>
      )}
    </div>
  );
}

// Standorte (04.08., echte Landkarte auf User-Wunsch): world-atlas-TopoJSON +
// d3-geo, selbst als React-SVG gerendert (KEIN react-simple-maps — dessen
// React-Peer-Deps sind ein Build-Risiko; d3-geo/topojson sind react-frei).
// Klick auf ein Land öffnet die Detail-Ansicht (Erwähnungen je KI-System).
// Deutsche Messdaten-Namen -> englische world-atlas-Feature-Namen.
const DE2EN = {
  schweiz: "Switzerland", deutschland: "Germany", "österreich": "Austria", oesterreich: "Austria",
  frankreich: "France", italien: "Italy", spanien: "Spain", portugal: "Portugal",
  niederlande: "Netherlands", belgien: "Belgium", polen: "Poland", tschechien: "Czechia",
  ungarn: "Hungary", kroatien: "Croatia", griechenland: "Greece", "dänemark": "Denmark",
  daenemark: "Denmark", schweden: "Sweden", norwegen: "Norway", finnland: "Finland",
  irland: "Ireland", grossbritannien: "United Kingdom", "großbritannien": "United Kingdom",
  indien: "India", usa: "United States of America", "vereinigte staaten": "United States of America",
  kanada: "Canada", australien: "Australia", brasilien: "Brazil", china: "China", japan: "Japan",
  "türkei": "Turkey", tuerkei: "Turkey", luxemburg: "Luxembourg", liechtenstein: "Liechtenstein",
};
// world-atlas einmal modulweit in GeoJSON-Features wandeln (177 Länder).
const WORLD_FEATURES = topoFeature(worldTopo, worldTopo.objects.countries).features;

function LocationPanel({ countries, models }) {
  const rows = (countries || []).filter((c) => c.value > 0);
  const total = rows.reduce((a, c) => a + c.value, 0) || 1;
  const [selected, setSelected] = useState(null); // deutscher Ländername
  // deutsche Messnamen -> world-atlas-Feature + Wert
  const valueByEn = new Map();
  const deByEn = new Map();
  const unmapped = [];
  for (const c of rows) {
    const en = DE2EN[c.name.toLowerCase()];
    if (en) { valueByEn.set(en, c.value); deByEn.set(en, c.name); }
    else unmapped.push(c); // z. B. "International"
  }
  const dataFeatures = WORLD_FEATURES.filter((f) => valueByEn.has(f.properties.name));
  // Projektion auf die Länder mit Daten zoomen (mind. Europa-artiger Ausschnitt).
  const W = 640, H = 400;
  const [mapView, setMapView] = useState("fokus"); // fokus = Daten-Länder · welt = ganze Karte
  const projection = geoNaturalEarth1();
  if (dataFeatures.length && mapView === "fokus") {
    // Fix 05.08.: fitExtent auf eine GEPUFFERTE Box um die Daten-Länder statt
    // nachträglichem scale-Cap — der Cap verschob nur den Maßstab, nicht das
    // Zentrum, und schob den Ausschnitt aus dem Bild (leere/abgeschnittene Karte).
    // MultiPoint statt Polygon: keine sphärische Winding-Falle.
    const [[minX, minY], [maxX, maxY]] = geoBounds({ type: "FeatureCollection", features: dataFeatures });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 22) * 1.35; // Mindest-Ausschnitt + Rand-Kontext
    const spanY = Math.max(maxY - minY, 14) * 1.35;
    const lat = (v) => Math.max(-84, Math.min(84, v));
    const box = {
      type: "MultiPoint",
      coordinates: [
        [cx - spanX / 2, lat(cy - spanY / 2)], [cx + spanX / 2, lat(cy - spanY / 2)],
        [cx + spanX / 2, lat(cy + spanY / 2)], [cx - spanX / 2, lat(cy + spanY / 2)],
      ],
    };
    projection.fitExtent([[16, 16], [W - 16, H - 16]], box);
  } else {
    projection.fitExtent([[16, 16], [W - 16, H - 16]], { type: "FeatureCollection", features: WORLD_FEATURES });
  }
  const path = geoPath(projection);
  const shade = (v) => {
    if (!v) return "#eceae4";
    const share = v / total;
    return share >= 0.4 ? "#77008C" : share >= 0.15 ? "#b06cc0" : "#e4cfe9";
  };
  const selRow = selected ? rows.find((c) => c.name === selected) : null;
  // Engine-Aufschlüsselung fürs gewählte Land (models[].byCountry — echte Daten).
  const selEngines = selRow
    ? (models || [])
        .map((m) => ({ name: m.name, n: Number(m.byCountry?.[selRow.name] || 0) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
    : [];
  const selMax = Math.max(1, ...selEngines.map((x) => x.n));
  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <RCard icon={Layers} title="Regionen-Karte" info="Echte Landkarte (world-atlas): Länder nach Anteil der KI-Erwähnungen eingefärbt. Land oder Chip anklicken für die Detail-Ansicht." desc="Wo KI-Antworten die Marke erwähnen — Land anklicken" footer={`${rows.length} Regionen · ${nf(total)} Erwähnungen`} legend={
        <div className="flex rounded-md border p-0.5" style={{ borderColor: C.line, background: C.card }}>
          {[["fokus", "Fokus"], ["welt", "Welt"]].map(([k, t]) => (
            <button key={k} onClick={() => setMapView(k)} className="rounded px-2 py-0.5 text-[10.5px] font-medium focus:outline-none"
              style={{ background: mapView === k ? C.indigo : "transparent", color: mapView === k ? "#fff" : C.sub }}>
              {t}
            </button>
          ))}
        </div>
      }>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
          {WORLD_FEATURES.map((f) => {
            const en = f.properties.name;
            const v = valueByEn.get(en) || 0;
            const de = deByEn.get(en);
            const isSel = de && de === selected;
            return (
              <path
                key={en}
                d={path(f) || undefined}
                fill={shade(v)}
                stroke={isSel ? "#161217" : "#ffffff"}
                strokeWidth={isSel ? 1.5 : 0.5}
                style={{ cursor: v ? "pointer" : "default", transition: "fill .15s" }}
                onClick={() => { if (de) setSelected(de === selected ? null : de); }}
              >
                <title>{de ? `${de}: ${nf(v)} Erwähnungen (${Math.round((v / total) * 100)} %)` : en}</title>
              </path>
            );
          })}
        </svg>
        {unmapped.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {unmapped.map((c) => (
              <span key={c.name} className="rounded-lg px-3 py-2 text-[11px] font-semibold" style={{ background: "#d9d4f8", color: "#3b3667", cursor: "pointer" }}
                onClick={() => setSelected(c.name)}>
                {c.name} · {nf(c.value)}
              </span>
            ))}
          </div>
        )}
      </RCard>
      {selRow ? (
        <RCard icon={MapPin} title={selRow.name} info="Detail-Ansicht des gewählten Landes: Erwähnungen je KI-System aus der Messung. Zurück über den Alle-Regionen-Button." desc={`${nf(selRow.value)} Erwähnungen · ${Math.round((selRow.value / total) * 100)} % Anteil`} footer="Herkunft je KI-System" legend={
          <button onClick={() => setSelected(null)} className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: C.line, color: C.indigo, background: C.card }}>
            ← Alle Regionen
          </button>
        }>
          {selEngines.length ? (
            <div className="space-y-2">
              {selEngines.map((x) => (
                <div key={x.name} className="flex items-center gap-3">
                  <span className="w-40 truncate text-[12px]" style={{ color: C.ink }}>{x.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: C.track }}>
                    <div className="h-full rounded-full" style={{ width: `${(x.n / selMax) * 100}%`, background: C.indigo }} />
                  </div>
                  <span className="w-10 text-right text-[11px] tabular-nums" style={{ color: C.sub }}>{nf(x.n)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: C.sub }}>Für dieses Land liegt keine Aufschlüsselung je KI-System vor.</p>
          )}
          {selRow.name === "International" && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: C.line, background: C.cardAlt, color: C.sub }}>
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                <b style={{ color: C.ink }}>International</b> = Erwähnungen ohne Länderzuordnung — z. B. aus dem globalen ChatGPT-Korpus, der keine Herkunftsangabe mitliefert. Deshalb erscheinen sie nicht auf der Karte, sondern als eigene Region.
              </span>
            </div>
          )}
        </RCard>
      ) : (
      <RCard icon={Hash} title="Regionen" info="Erwähnungen und Anteil je Herkunftsregion der KI-Anfragen. Zeile oder Land anklicken für die Detail-Ansicht." desc="Erwähnungen nach Region — Zeile anklicken" footer={`${rows.length} Regionen`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: C.sub }}>
                <th className="px-5 py-2 text-left font-medium">Region</th>
                <th className="px-3 py-2 text-right font-medium">Erwähnungen</th>
                <th className="px-5 py-2 text-right font-medium">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name} className="cursor-pointer transition-colors hover:bg-black/[.03]" style={{ borderTop: `1px solid ${C.line}` }} onClick={() => setSelected(c.name)}>
                  <td className="px-5 py-2 font-semibold" style={{ color: C.ink }}>{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.ink }}>{nf(c.value)}</td>
                  <td className="px-5 py-2 text-right tabular-nums" style={{ color: C.sub }}>{Math.round((c.value / total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RCard>
      )}
    </div>
  );
}

// Conversions-Regionen (05.08., User-Wunsch): dieselbe Landkarte für die
// KI-Conversions — gespeist aus den GA4-Event-Ländern (englische Namen,
// matchen direkt auf die world-atlas-Features). Klick auf Land → Engines.
const EN2DE = (() => {
  const m = new Map();
  for (const [de, en] of Object.entries(DE2EN)) {
    if (!m.has(en)) m.set(en, de.charAt(0).toUpperCase() + de.slice(1));
  }
  return m;
})();
const WORLD_NAMES = new Set(WORLD_FEATURES.map((f) => f.properties.name));

function ConversionRegions({ attribution }) {
  const [selected, setSelected] = useState(null); // EN-Feature-Name oder Chip-Label
  const [mapView, setMapView] = useState("fokus");
  // Länder-Schlüssel normalisieren: GA4 liefert englische Namen, Messwerte deutsche.
  // GA4-Namen, die vom world-atlas-Feature-Namen abweichen:
  const GA4_ALIAS = {
    "united states": "United States of America",
    "north macedonia": "Macedonia",
    "türkiye": "Turkey",
    "bosnia & herzegovina": "Bosnia and Herz.",
    "dominican republic": "Dominican Rep.",
    "congo - kinshasa": "Dem. Rep. Congo",
    "congo - brazzaville": "Congo",
    "myanmar (burma)": "Myanmar",
  };
  const norm = (raw) => {
    const lo = raw.toLowerCase();
    const en = WORLD_NAMES.has(raw)
      ? raw
      : GA4_ALIAS[lo] && WORLD_NAMES.has(GA4_ALIAS[lo])
        ? GA4_ALIAS[lo]
        : DE2EN[lo] && WORLD_NAMES.has(DE2EN[lo])
          ? DE2EN[lo]
          : null;
    return { en, key: en || (raw === "(not set)" ? "Ohne Zuordnung" : raw) };
  };
  // Aggregation 1: Land -> Besucher (GA4-Sessions) + Engine-Split.
  const visAgg = new Map(); // key = EN-Name (oder Roh-Label wenn nicht mappbar)
  for (const a of attribution || []) {
    for (const v of a.visitors || []) {
      const raw = String(v.country || "").trim();
      if (!raw || !v.sessions) continue;
      const { en, key } = norm(raw);
      const t = visAgg.get(key) || { key, en, conv: 0, value: 0, engines: new Map() };
      t.conv += Number(v.sessions || 0);
      const e = t.engines.get(a.engine) || { conv: 0, value: 0 };
      e.conv += Number(v.sessions || 0);
      t.engines.set(a.engine, e);
      visAgg.set(key, t);
    }
  }
  // Aggregation 2: Land -> Conversions/Wert + Engine-Split.
  const convAgg = new Map();
  for (const a of attribution || []) {
    for (const ev of a.events || []) {
      const raw = String(ev.country || "").trim();
      if (!raw || !ev.count) continue;
      const { en, key } = norm(raw);
      const t = convAgg.get(key) || { key, en, conv: 0, value: 0, engines: new Map() };
      t.conv += Number(ev.count || 0);
      t.value += Number(ev.value || 0);
      const e = t.engines.get(a.engine) || { conv: 0, value: 0 };
      e.conv += Number(ev.count || 0); e.value += Number(ev.value || 0);
      t.engines.set(a.engine, e);
      convAgg.set(key, t);
    }
  }
  const visRows = [...visAgg.values()].sort((a, b) => b.conv - a.conv);
  const convRows2 = [...convAgg.values()].sort((a, b) => b.conv - a.conv);
  // Metrik-Umschalter: Besucher (Standard, sobald Daten da) oder Conversions.
  const [metric, setMetric] = useState(null);
  const m = metric ?? (visRows.length ? "besucher" : "conversions");
  const isVis = m === "besucher";
  const rows = isVis ? visRows : convRows2;
  const unit = isVis ? "Besucher" : "Conversions";
  if (!visRows.length && !convRows2.length) {
    // Empty-State statt stillem Ausblenden (05.08.): erklärt, warum keine Karte da ist.
    return (
      <div className="mt-4">
        <RCard icon={Layers} title="Besucher nach Region" info="Herkunftsländer der KI-Besucher und -Conversions aus GA4. Die Karte erscheint, sobald Daten mit Herkunftsland vorliegen." desc="Woher die KI-Besucher stammen" footer="Noch keine Daten">
          <p className="py-6 text-center text-[12.5px]" style={{ color: C.sub }}>
            Für diesen Kunden liegen noch keine KI-Besucher mit Herkunftsland vor.<br />
            Die Regionen-Karte füllt sich automatisch mit dem nächsten Attributions-Lauf.
          </p>
        </RCard>
      </div>
    );
  }
  const total = rows.reduce((a, c) => a + c.conv, 0) || 1;
  const valueByEn = new Map(rows.filter((r) => r.en).map((r) => [r.en, r.conv]));
  const display = (r) => (r.en ? EN2DE.get(r.en) || r.en : r.key);
  const dataFeatures = WORLD_FEATURES.filter((f) => valueByEn.has(f.properties.name));
  const W = 640, H = 400;
  const projection = geoNaturalEarth1();
  if (dataFeatures.length && mapView === "fokus") {
    const [[minX, minY], [maxX, maxY]] = geoBounds({ type: "FeatureCollection", features: dataFeatures });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 22) * 1.35;
    const spanY = Math.max(maxY - minY, 14) * 1.35;
    const lat = (v) => Math.max(-84, Math.min(84, v));
    const box = { type: "MultiPoint", coordinates: [
      [cx - spanX / 2, lat(cy - spanY / 2)], [cx + spanX / 2, lat(cy - spanY / 2)],
      [cx + spanX / 2, lat(cy + spanY / 2)], [cx - spanX / 2, lat(cy + spanY / 2)],
    ] };
    projection.fitExtent([[16, 16], [W - 16, H - 16]], box);
  } else {
    projection.fitExtent([[16, 16], [W - 16, H - 16]], { type: "FeatureCollection", features: WORLD_FEATURES });
  }
  const path = geoPath(projection);
  // Besucher = blau, Conversions = grün.
  const PAL = isVis ? ["#2563eb", "#8db2f2", "#d7e4fb"] : ["#059669", "#5db99a", "#c7e6da"];
  const shade = (v) => {
    if (!v) return "#eceae4";
    const share = v / total;
    return share >= 0.4 ? PAL[0] : share >= 0.15 ? PAL[1] : PAL[2];
  };
  const selRow = selected ? rows.find((r) => (r.en || r.key) === selected) : null;
  const selEngines = selRow
    ? [...selRow.engines.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.conv - a.conv)
    : [];
  const selMax = Math.max(1, ...selEngines.map((x) => x.conv));
  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <RCard icon={Layers} title={isVis ? "Besucher nach Region" : "Conversions nach Region"} info={isVis ? "Herkunftsländer der KI-Besucher (GA4-Sessions). Land oder Chip anklicken für die Detail-Ansicht." : "Herkunftsländer der KI-Conversions aus GA4. Land oder Chip anklicken für die Detail-Ansicht."} desc={isVis ? "Woher die KI-Besucher stammen — Land anklicken" : "Wo KI-Besucher konvertieren — Land anklicken"} footer={`${rows.length} Regionen · ${nf(total)} ${unit}`} legend={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5" style={{ borderColor: C.line, background: C.card }}>
            {[["besucher", "Besucher", visRows.length], ["conversions", "Conversions", convRows2.length]].map(([k, t, has]) => (
              <button key={k} onClick={() => { if (has) { setMetric(k); setSelected(null); } }} className="rounded px-2 py-0.5 text-[10.5px] font-medium focus:outline-none"
                title={has ? undefined : "Noch keine Daten"}
                style={{ background: m === k ? C.indigo : "transparent", color: has ? (m === k ? "#fff" : C.sub) : "#c2beb4", cursor: has ? "pointer" : "default" }}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border p-0.5" style={{ borderColor: C.line, background: C.card }}>
            {[["fokus", "Fokus"], ["welt", "Welt"]].map(([k, t]) => (
              <button key={k} onClick={() => setMapView(k)} className="rounded px-2 py-0.5 text-[10.5px] font-medium focus:outline-none"
                style={{ background: mapView === k ? C.indigo : "transparent", color: mapView === k ? "#fff" : C.sub }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      }>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
          {WORLD_FEATURES.map((f) => {
            const en = f.properties.name;
            const v = valueByEn.get(en) || 0;
            const isSel = en === selected;
            return (
              <path key={en} d={path(f) || undefined} fill={shade(v)}
                stroke={isSel ? "#161217" : "#ffffff"} strokeWidth={isSel ? 1.5 : 0.5}
                style={{ cursor: v ? "pointer" : "default", transition: "fill .15s" }}
                onClick={() => { if (v) setSelected(en === selected ? null : en); }}>
                <title>{v ? `${EN2DE.get(en) || en}: ${nf(v)} ${unit} (${Math.round((v / total) * 100)} %)` : en}</title>
              </path>
            );
          })}
        </svg>
      </RCard>
      {selRow ? (
        <RCard icon={MapPin} title={display(selRow)} info={`${unit} je KI-System im gewählten Land (GA4-Attribution).`} desc={`${nf(selRow.conv)} ${unit}${selRow.value > 0 ? ` · Wert ${nf(Math.round(selRow.value))}` : ""} · ${Math.round((selRow.conv / total) * 100)} % Anteil`} footer={`${unit} je KI-System`} legend={
          <button onClick={() => setSelected(null)} className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: C.line, color: C.indigo, background: C.card }}>
            ← Alle Regionen
          </button>
        }>
          <div className="space-y-2">
            {selEngines.map((x) => (
              <div key={x.name} className="flex items-center gap-3">
                <span className="w-40 truncate text-[12px]" style={{ color: C.ink }}>{x.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: C.track }}>
                  <div className="h-full rounded-full" style={{ width: `${(x.conv / selMax) * 100}%`, background: PAL[0] }} />
                </div>
                <span className="w-16 text-right text-[11px] tabular-nums" style={{ color: C.sub }}>{nf(x.conv)}{x.value > 0 ? ` · ${nf(Math.round(x.value))}` : ""}</span>
              </div>
            ))}
          </div>
          {selRow.key === "Ohne Zuordnung" && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: C.line, background: C.cardAlt, color: C.sub }}>
              <Info size={13} className="mt-0.5 shrink-0" />
              <span><b style={{ color: C.ink }}>Ohne Zuordnung</b> = GA4 konnte für diese {unit} kein Herkunftsland bestimmen („(not set)").</span>
            </div>
          )}
        </RCard>
      ) : (
        <RCard icon={Hash} title="Regionen" info={`${unit} und Anteil je Herkunftsland. Zeile oder Land anklicken für die Detail-Ansicht.`} desc={`${unit} nach Region — Zeile anklicken`} footer={`${rows.length} Regionen`} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: C.sub }}>
                  <th className="px-5 py-2 text-left font-medium">Region</th>
                  <th className="px-3 py-2 text-right font-medium">{unit}</th>
                  {!isVis && <th className="px-3 py-2 text-right font-medium">Wert</th>}
                  <th className="px-5 py-2 text-right font-medium">Anteil</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="cursor-pointer transition-colors hover:bg-black/[.03]" style={{ borderTop: `1px solid ${C.line}` }} onClick={() => setSelected(r.en || r.key)}>
                    <td className="px-5 py-2 font-semibold" style={{ color: C.ink }}>{display(r)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.ink }}>{nf(r.conv)}</td>
                    {!isVis && <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.sub }}>{r.value > 0 ? nf(Math.round(r.value)) : "—"}</td>}
                    <td className="px-5 py-2 text-right tabular-nums" style={{ color: C.sub }}>{Math.round((r.conv / total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RCard>
      )}
    </div>
  );
}

// Google AI Overviews & AI Mode (06.08.): WELCHE Suchanfragen den Kunden
// zitieren — SERP-Messung (keine Prompt-Antworten, deshalb eigene Karte
// statt Zeilen in der Antworten-Tabelle). Daten aus parts.sa.aio/aim;
// erscheint erst, sobald ein SERP-Lauf nach dem 06.08. die Details schrieb.
function GoogleSerpAiCard({ serpAi, brand }) {
  if (!serpAi || (!serpAi.aio && !serpAi.aim)) return null;
  const cols = [
    { key: "aio", label: "Google AI Overviews", data: serpAi.aio },
    { key: "aim", label: "Google AI Mode", data: serpAi.aim },
  ].filter((c) => c.data);
  return (
    <RCard icon={Sparkles} title="Google AI Overviews & AI Mode" info="Eigene SERP-Messung: Für die echten Google-Suchanfragen des Kunden (Search Console) wird geprüft, ob AI Overviews bzw. der AI Mode die Website zitieren. Das sind SERP-Zitate — keine Prompt-Antworten wie bei den Chat-Systemen oben." desc={`Bei welchen Suchanfragen Google-KI ${brand} zitiert`} footer={`Messung vom ${serpAi.gemessenAm || "—"}${serpAi.uebernommen ? " (letzter SERP-Check, Zwischentag)" : ""}`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cols.map((c) => (
          <div key={c.key}>
            <div className="flex items-baseline gap-2">
              <EngineFavicon platform="Google" />
              <span className="text-[12.5px] font-bold" style={{ color: C.ink }}>{c.label}</span>
            </div>
            <div className="mt-1 text-[11.5px]" style={{ color: C.sub }}>
              <b style={{ color: c.data.cited > 0 ? C.up : C.sub }}>{c.data.cited}</b> von {c.data.checked} geprüften Suchanfragen zitieren {brand}
              {c.data.citations > 0 && <> · {c.data.citations} Quellen-Verlinkungen</>}
            </div>
            {c.data.keywords.length > 0 ? (
              <div className="mt-2 overflow-y-auto rounded-lg border p-2" style={{ maxHeight: 240, borderColor: C.line, background: C.cardAlt }}>
                {c.data.keywords.map((k) => (
                  <div key={k} className="flex items-center gap-2 py-1 text-[12px]" style={{ color: C.ink, borderTop: `1px solid ${C.line}` }}>
                    <Search size={11} style={{ color: C.sub, flexShrink: 0 }} />
                    <span className="min-w-0 truncate">{k}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border p-3 text-[11.5px]" style={{ borderColor: C.line, background: C.cardAlt, color: C.sub }}>
                Im letzten Check wurde {brand} hier nicht zitiert{c.data.present > 0 ? ` — die KI-Box erschien bei ${c.data.present} Suchanfragen, zitierte aber andere Quellen` : ""}.
              </div>
            )}
          </div>
        ))}
      </div>
    </RCard>
  );
}

// Folgefragen (03.08., ehrliche Query-Fanout-Annäherung): Googles "People Also
// Ask"-Fragen + verwandte Suchen je GSC-Keyword — KEINE KI-internen Sub-Queries.
function FanoutPanel({ fanout }) {
  const [q, setQ] = useState("");
  const rows = (fanout || []).filter((f) =>
    !q.trim() || f.kw.toLowerCase().includes(q.trim().toLowerCase()) ||
    (f.questions || []).some((x) => x.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <div className="mt-4">
      <RCard icon={MessageSquare} title="Google-Folgefragen" info="Welche Folgefragen (People Also Ask) und verwandte Suchen Google zu den eigenen Keywords zeigt — erhoben in der AIO/AI-Mode-Messung ohne Zusatzkosten. Das sind Googles Folgefragen, nicht die internen Sub-Queries der KI-Systeme." desc="Folgefragen & verwandte Suchen zu den eigenen Keywords" footer={`${rows.length} Keywords mit Folgefragen`} legend={
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…"
          className="h-7 w-36 rounded-md border px-2 text-xs focus:outline-none"
          style={{ borderColor: C.line, background: C.card, color: C.ink }} />
      }>
        <div className="grid grid-cols-1 gap-3">
          {rows.slice(0, 40).map((f) => (
            <div key={`${f.kw}|${f.country}`} className="rounded-lg border p-3" style={{ borderColor: C.line, background: C.cardAlt }}>
              <div className="text-[12.5px] font-semibold" style={{ color: C.ink }}>{f.kw} <span className="font-normal text-[10.5px]" style={{ color: C.sub }}>· {f.country}</span></div>
              {(f.questions || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.questions.map((x) => <span key={x} className="rounded-md px-2 py-0.5 text-[11px]" style={{ background: "#e8e4fb", color: "#4c3fa8" }}>{x}</span>)}
                </div>
              )}
              {(f.related || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.related.map((x) => <span key={x} className="rounded-md px-2 py-0.5 text-[11px]" style={{ background: C.track, color: C.sub }}>{x}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
        {rows.length > 40 && <p className="mt-2 text-[11px]" style={{ color: C.sub }}>Top 40 von {rows.length} Keywords angezeigt — Suche nutzen zum Eingrenzen.</p>}
      </RCard>
    </div>
  );
}

// URL-Ebene der Quellen (L, 03.08., Searchable "All URLs"): jede zitierte URL
// einzeln, nach Domain gruppierbar — Daten ab dem Messlauf nach dem 03.08.
function UrlsTable({ prompts, ownDomain }) {
  const [q, setQ] = useState("");
  const [groupBy, setGroupBy] = useState(false);
  const tally = new Map();
  for (const p of prompts || []) {
    for (const u of p.sourceUrls || []) {
      if (!/^https?:\/\//i.test(u)) continue;
      const t = tally.get(u) || { url: u, n: 0, engines: new Set() };
      t.n += 1; t.engines.add(p.platform); tally.set(u, t);
    }
  }
  let rows = [...tally.values()].sort((a, b) => b.n - a.n);
  if (!rows.length) return null;
  const domOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  if (q.trim()) rows = rows.filter((r) => r.url.toLowerCase().includes(q.trim().toLowerCase()));
  const shown = rows.slice(0, 100);
  const grouped = groupBy
    ? [...shown.reduce((m, r) => { const d = domOf(r.url); (m.get(d) || m.set(d, []).get(d)).push(r); return m; }, new Map()).entries()]
    : null;
  const Row = ({ r }) => (
    <tr className="border-t" style={{ borderColor: C.line }}>
      <td className="px-5 py-2">
        <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 font-medium" style={{ color: C.indigo }}>
          <DomainFavicon domain={domOf(r.url)} />
          <span className="truncate" style={{ maxWidth: 480 }}>{r.url}</span>
          <ExternalLink size={11} className="shrink-0" />
          <OwnershipChip kind={domainOwnership(domOf(r.url), ownDomain)} />
        </a>
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.ink }}>{r.n}</td>
      <td className="px-5 py-2 text-right text-[11px]" style={{ color: C.sub }}>{[...r.engines].join(", ")}</td>
    </tr>
  );
  return (
    <div className="rounded-xl border" style={{ ...CARD, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <Link2 size={15} style={{ color: C.sub }} />
        <h3 className="text-[13px] font-semibold" style={{ color: C.ink }}>Zitierte URLs</h3>
        <span title="Jede in KI-Antworten zitierte URL einzeln — erfasst ab dem Messlauf vom 03.08.2026." style={{ color: C.sub, cursor: "help", display: "inline-flex" }}><Info size={13} /></span>
        <span className="truncate text-[12px]" style={{ color: C.sub }}>· Einzelne Seiten statt nur Domains</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setGroupBy((v) => !v)} className="h-7 rounded-md border px-2 text-xs font-medium" style={{ borderColor: groupBy ? C.indigo : C.line, color: groupBy ? C.indigo : C.sub, background: C.card }}>
            Nach Domain gruppieren
          </button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="URL suchen…"
            className="h-7 w-40 rounded-md border px-2 text-xs focus:outline-none focus-visible:ring-2"
            style={{ borderColor: C.line, background: C.card, color: C.ink }} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>
              <th className="px-5 py-2 font-medium">URL</th>
              <th className="px-3 py-2 text-right font-medium">Zitate</th>
              <th className="px-5 py-2 text-right font-medium">KI-Systeme</th>
            </tr>
          </thead>
          <tbody>
            {grouped
              ? grouped.map(([dom, rs]) => (
                  <Fragment key={dom}>
                    <tr style={{ background: C.cardAlt }}>
                      <td colSpan={3} className="px-5 py-1.5 text-[11px] font-bold" style={{ color: C.sub }}>{dom} · {rs.length} URLs</td>
                    </tr>
                    {rs.map((r) => <Row key={r.url} r={r} />)}
                  </Fragment>
                ))
              : shown.map((r) => <Row key={r.url} r={r} />)}
          </tbody>
        </table>
      </div>
      <div className="border-t px-5 py-2 text-[11px]" style={{ borderColor: C.line, color: C.sub }}>
        {rows.length > 100 ? `Top 100 von ${rows.length} URLs` : `${rows.length} URLs`}
      </div>
    </div>
  );
}

// Brand Perception (I, 03.08., Searchable-Parität): wie jedes KI-System die
// Marke wahrnimmt — Stärken grün, Schwächen rot, Engine per Pill wählbar.
// Erscheint erst, wenn der Messlauf perception geschrieben hat.
// ── Echtes ChatGPT-Query-Fanout (11.08., Searchable-Parität) ─────────────────
// Sub-Queries, die ChatGPT bei einer ECHTEN Consumer-Suche (llm_scraper,
// Standort CH) zu den Top-Money-Keywords wirklich stellt — im Unterschied zur
// früheren PAA-Annäherung sind das die KI-internen Folgefragen selbst.
function ChatgptFanoutCard({ fanout, brand }) {
  const list = Array.isArray(fanout) ? fanout.filter((f) => f.queries?.length) : [];
  if (!list.length) return null;
  const brandLc = String(brand || "").toLowerCase().split(".")[0];
  return (
    <RCard
      icon={Search}
      title="Echte KI-Folgefragen"
      info="Bei einer echten ChatGPT-Suche (Standort Schweiz) zu deinen wichtigsten Suchbegriffen stellt das Modell intern diese Folgefragen, bevor es antwortet. Wer für diese Fragen Inhalte hat, wird zitiert."
      desc="Welche Sub-Queries ChatGPT zu deinen Money-Keywords wirklich stellt"
      footer={`${list.reduce((a, f) => a + f.queries.length, 0)} Folgefragen aus ${list.length} echten ChatGPT-Suchen`}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.map((f) => (
          <div key={f.kw} className="rounded-lg border p-4" style={{ borderColor: C.line, background: C.cardAlt }}>
            <div className="text-[12.5px] font-semibold" style={{ color: C.ink }}>„{f.kw}"</div>
            <ul className="mt-2 space-y-1.5">
              {f.queries.slice(0, 12).map((q) => (
                <li key={q} className="flex items-start gap-1.5 text-[11.5px]" style={{ color: C.sub }}>
                  <ChevronRight size={12} className="mt-0.5 shrink-0" style={{ color: C.indigo }} />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
            {f.brands?.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: C.line }}>
                <span className="text-[10.5px] font-medium" style={{ color: C.sub }}>Genannte Marken:</span>
                {f.brands.slice(0, 8).map((b) => {
                  const self = brandLc && String(b).toLowerCase().includes(brandLc);
                  return (
                    <span key={b} className="rounded-full border px-2 py-0.5 text-[10.5px]" style={{ borderColor: self ? C.indigo : C.line, color: self ? C.indigo : C.ink, fontWeight: self ? 700 : 400, background: C.card }}>
                      {b}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </RCard>
  );
}

// ── Sentiment-Score 0-100 (11.08., Searchable-Parität) ───────────────────────
// pos=100 / neu=50 / neg=0 über alle Judge-bewerteten Antworten des Laufs;
// Trend aus parts->sentiment je Report (Backfill 11.08. über den Bestand).
function SentimentScoreCard({ sentiment, brand }) {
  const [chartRef, W] = useChartWidth(560, 320);
  if (!sentiment || sentiment.score == null) return null;
  const { score, pos, neu, neg, trend } = sentiment;
  const total = pos + neu + neg;
  const scoreColor = score >= 60 ? C.up : score >= 45 ? C.amber : C.down;
  const H = 120, PL = 30, PR = 10, PT = 8, PB = 18;
  const pts = (trend || []).slice(-14);
  const x = (i) => PL + (pts.length > 1 ? (i / (pts.length - 1)) * (W - PL - PR) : 0);
  const y = (v) => PT + (1 - v / 100) * (H - PT - PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  return (
    <RCard
      icon={MessageSquare}
      title="Sentiment-Score"
      info="Tonalität aller KI-Antworten mit Markennennung, verdichtet zu einer Zahl: positiv = 100, neutral = 50, negativ = 0. Der Trend zeigt die letzten Messläufe."
      desc={`Wie wohlwollend KI-Systeme über ${brand} schreiben`}
      footer={total ? `${total} bewertete Antworten · ${pos} positiv / ${neu} neutral / ${neg} negativ` : undefined}
    >
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <div className="text-[11px] font-medium" style={{ color: C.sub }}>Sentiment-Score</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums" style={{ color: scoreColor }}>{score}</span>
            <span className="text-xs" style={{ color: C.sub }}>/ 100</span>
          </div>
          {total > 0 && (
            <div className="mt-3 flex h-2 w-44 overflow-hidden rounded-full" title={`${pos} positiv · ${neu} neutral · ${neg} negativ`}>
              <span style={{ width: `${(pos / total) * 100}%`, background: "#10b981" }} />
              <span style={{ width: `${(neu / total) * 100}%`, background: "#d1d5db" }} />
              <span style={{ width: `${(neg / total) * 100}%`, background: "#ef4444" }} />
            </div>
          )}
        </div>
        {pts.length >= 2 && (
          <div ref={chartRef} className="min-w-0 flex-1" style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, display: "block" }}>
              {[0, 50, 100].map((v) => (
                <g key={v}>
                  <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth="1" strokeDasharray={v === 50 ? "3 3" : "0"} />
                  <text x={PL - 5} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill={C.sub}>{v}</text>
                </g>
              ))}
              <path d={path} fill="none" stroke={scoreColor} strokeWidth="2" strokeLinejoin="round" />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={x(i)} cy={y(p.score)} r="2.5" fill={scoreColor} />
                  {(i === 0 || i === pts.length - 1 || pts.length <= 7) && (
                    <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill={C.sub}>{p.d}</text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
    </RCard>
  );
}

function BrandPerceptionCard({ perception, brand }) {
  const list = Array.isArray(perception) ? perception.filter((p) => p.engine) : [];
  const [idx, setIdx] = useState(0);
  if (!list.length) return null;
  const cur = list[Math.min(idx, list.length - 1)];
  return (
    <RCard icon={Eye} title="Brand Perception" info="Verdichtet aus den echten KI-Antworten des letzten Messlaufs: Was hebt das jeweilige KI-System an der Marke hervor, was schränkt es ein?" desc={`Wie KI-Systeme ${brand} wahrnehmen`} footer={`${list.length} KI-Systeme bewertet`} legend={
      <div className="flex flex-wrap gap-1">
        {list.map((p, i) => (
          <button key={p.engine} onClick={() => setIdx(i)}
            className="rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition focus:outline-none"
            style={{ borderColor: i === idx ? C.indigo : C.line, background: i === idx ? C.indigo : C.card, color: i === idx ? "#fff" : C.sub }}>
            {p.engine}
          </button>
        ))}
      </div>
    }>
      {cur.zusammenfassung && <p className="text-[13px] leading-relaxed" style={{ color: C.ink }}>{cur.zusammenfassung}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: C.up }}>Stärken</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(cur.staerken || []).length ? cur.staerken.map((s) => (
              <span key={s} className="rounded-md px-2 py-1 text-[11.5px]" style={{ background: "#d1fae5", color: "#065f46" }}>{s}</span>
            )) : <span className="text-[11.5px]" style={{ color: C.sub }}>—</span>}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: C.down }}>Schwächen / Einschränkungen</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(cur.schwaechen || []).length ? cur.schwaechen.map((s) => (
              <span key={s} className="rounded-md px-2 py-1 text-[11.5px]" style={{ background: "#fee2e2", color: "#b91c1c" }}>{s}</span>
            )) : <span className="text-[11.5px]" style={{ color: C.sub }}>—</span>}
          </div>
        </div>
      </div>
    </RCard>
  );
}

// Top-Domains-Trend (03.08., Searchable "Top Domains"): Zitierhäufigkeit der
// Top-5-Domains je Monatsreport als Mehrlinien-Chart mit Favicon-Legende.
const DOMAIN_TREND_COLORS = ["#77008C", "#0d9488", "#d97706", "#dc2626", "#0284c7"];
function DomainTrendCard({ trend }) {
  const [hover, setHover] = useState(null); // Maus-Zeitstrahl (04.08.)
  const [chartRef, W] = useChartWidth(1100, 560);
  const allMonths = trend?.months || [];
  const allSeries = (trend?.series || []).filter((s) => s.values.some((v) => v > 0));
  // Leere Vormonate abschneiden (05.08.): die Quellen-Messung startete später
  // als der Report-Zeitraum — monatelange Null-Linien sagen nichts. Erster
  // Monat mit irgendeinem Wert, ein Monat Anlauf davor bleibt als Kontext.
  let first = allMonths.findIndex((_, i) => allSeries.some((s) => (s.values[i] || 0) > 0));
  if (first < 0) first = 0;
  const start = Math.max(0, first - 1);
  const months = allMonths.slice(start);
  const series = allSeries.map((s) => ({ ...s, values: s.values.slice(start) }));
  if (months.length < 2 || !series.length) return null;
  // Breites Seitenverhältnis (05.08.): der Chart füllt die gesamte Kartenbreite
  // statt schmal in der Mitte zu hängen (maxHeight deckelte das 560er-Format).
  const H = 220, PAD = 8, AXL = 30, AXB = 16;
  const maxV = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i) => AXL + PAD + (i / Math.max(1, months.length - 1)) * (W - AXL - 2 * PAD);
  const y = (v) => H - AXB - PAD - (v / maxV) * (H - AXB - 2 * PAD);
  const labelEvery = months.length <= 8 ? 1 : Math.ceil(months.length / 8);
  return (
    <RCard icon={Link2} title="Top-Domains-Trend" info="Wie oft die fünf meistzitierten Domains je Monatsmessung in KI-Antworten als Quelle auftauchen." desc="Zitierhäufigkeit der Top-Domains über die Monate" footer={`${series.length} Domains · ${months.length} Monate`}>
      <div ref={chartRef} style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`} style={{ width: W, display: "block" }}
        onMouseMove={(e) => setHover(svgHoverIndex(e, W, AXL, PAD, months.length))}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={AXL + PAD} x2={W - PAD} y1={y(f * maxV)} y2={y(f * maxV)} stroke={C.line} strokeWidth="1" />
            <text x={AXL} y={y(f * maxV) + 3} textAnchor="end" fontSize="9" fill={C.sub}>{Math.round(f * maxV)}</text>
          </g>
        ))}
        {months.map((m, i) => (
          (i % labelEvery === 0 || i === months.length - 1) ? (
            <text key={i} x={x(i)} y={H - 3} textAnchor="middle" fontSize="9" fill={C.sub}>{m}</text>
          ) : null
        ))}
        {series.map((s, si) => (
          <g key={s.domain}>
            <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={DOMAIN_TREND_COLORS[si % DOMAIN_TREND_COLORS.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {(months.length <= 10 ? s.values : [s.values[s.values.length - 1]]).map((v, i) => (
              <circle key={i} cx={x(months.length <= 10 ? i : s.values.length - 1)} cy={y(v)} r={months.length <= 10 ? 2.5 : 3} fill={DOMAIN_TREND_COLORS[si % DOMAIN_TREND_COLORS.length]} />
            ))}
          </g>
        ))}
        {hover != null && months[hover] != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - AXB - PAD} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" />
            {series.map((s, si) => (
              <circle key={s.domain} cx={x(hover)} cy={y(s.values[hover])} r="3.5" fill={DOMAIN_TREND_COLORS[si % DOMAIN_TREND_COLORS.length]} stroke="#fff" strokeWidth="1" />
            ))}
            <HoverBox x={x(hover)} top={PAD} W={W} lines={[
              { text: months[hover] },
              ...series.map((s, si) => ({ text: `${s.domain}: ${s.values[hover]}`, color: ["#b9aefc", "#7dd8cb", "#f3c98a", "#f3a1a1", "#9cc8f0"][si % 5] })),
            ]} />
          </g>
        )}
      </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px]" style={{ color: C.sub }}>
        {series.map((s, si) => (
          <span key={s.domain} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOMAIN_TREND_COLORS[si % DOMAIN_TREND_COLORS.length] }} />
            <DomainFavicon domain={s.domain} />
            {s.domain}
          </span>
        ))}
      </div>
    </RCard>
  );
}

// ── Zitierquellen-Typologie + Gap (Searchable-Nachbau 08/2026, Heuristik) ────
// Feinere Typologie (03.08., Searchable hat 15 Typen): erste Regel gewinnt.
const SOURCE_TYPE_RULES = [
  { type: "Video (YouTube)", re: /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/ },
  { type: "Reddit/Forum", re: /(^|\.)reddit\.com$|(^|\.)quora\.com$|(^|\.)gutefrage\.net$|forum/ },
  { type: "Wiki", re: /wikipedia\.org$|(^|\.)wikidata\.org$|(^|\.)wikivoyage\.org$/ },
  { type: "LinkedIn", re: /(^|\.)linkedin\.com$/ },
  { type: "Social (weitere)", re: /(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)tiktok\.com$|(^|\.)pinterest\.|(^|\.)x\.com$|(^|\.)twitter\.com$/ },
  { type: "Buchungsportal (OTA)", re: /(^|\.)booking\.com$|(^|\.)expedia\.|(^|\.)hotels\.com$|(^|\.)agoda\.|(^|\.)trivago\.|(^|\.)airbnb\.|(^|\.)hrs\.|(^|\.)ebookers\./ },
  { type: "Bewertungen", re: /(^|\.)tripadvisor\.|(^|\.)trustpilot\.|(^|\.)yelp\.|(^|\.)holidaycheck\.|(^|\.)provenexpert\.|(^|\.)kununu\./ },
  { type: "Vergleichsportal", re: /(^|\.)comparis\.ch$|(^|\.)check24\.|(^|\.)idealo\.|vergleich/ },
  { type: "Verzeichnis", re: /(^|\.)local\.ch$|(^|\.)search\.ch$|(^|\.)gelbeseiten\.|(^|\.)yellowpages\.|(^|\.)maps\.google\./ },
  { type: "Tourismus/Region", re: /(^|\.)myswitzerland\.com$|(^|\.)graubuenden\.ch$|(^|\.)stmoritz\.|(^|\.)engadin\.|(^|\.)pontresina\.|tourismus|tourism/ },
  { type: "Ratgeber/How-To", re: /blog|ratgeber|guide|magazin|howto|how-to|tipps/ },
  { type: "Presse/News", re: /(^|\.)nzz\.ch$|(^|\.)blick\.ch$|(^|\.)20min\.ch$|(^|\.)srf\.ch$|(^|\.)watson\.ch$|(^|\.)handelszeitung\.ch$|(^|\.)suedostschweiz\.ch$|zeitung|news/ },
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
// Maus-Zeitstrahl (04.08., wie das "Entwicklung"-Chart): nächstgelegenen
// Datenpunkt aus der Cursor-X-Position bestimmen + dunkle Werte-Box zeichnen.
function svgHoverIndex(e, W, AXL, PAD, n) {
  const r = e.currentTarget.getBoundingClientRect();
  const vx = ((e.clientX - r.left) / r.width) * W;
  const step = (W - AXL - 2 * PAD) / Math.max(1, n - 1);
  return Math.min(n - 1, Math.max(0, Math.round((vx - AXL - PAD) / step)));
}
function HoverBox({ x, top, lines, W }) {
  const w = 14 + Math.max(...lines.map((l) => l.text.length)) * 5.6;
  const left = x + 10 + w > W ? x - w - 10 : x + 10;
  const h = 8 + lines.length * 13;
  return (
    <g pointerEvents="none">
      <rect x={left} y={top} width={w} height={h} rx="4" fill="#161217" fillOpacity="0.92" />
      {lines.map((l, i) => (
        <text key={i} x={left + 7} y={top + 13 + i * 13} fontSize="9.5" fontWeight={i === 0 ? 700 : 500} fill={l.color || "#fff"}>{l.text}</text>
      ))}
    </g>
  );
}

// Score-Interpretation (Searchable-Schwellen 70/40): Status + konkrete Empfehlung
// direkt am Score, damit der Wert ohne Playbook-Blick handlungsleitend ist.
const SCORE_GUIDE = (s) =>
  s >= 70
    ? { label: "Stark", color: C.up, bg: "#d1fae5", tip: "Content-Qualität halten und auf verwandte Themen ausweiten." }
    : s >= 40
    ? { label: "Moderat", color: C.amber, bg: "#fdf6e3", tip: "Inhalte vertiefen: umfassender schreiben, Beispiele und Expertenwissen ergänzen." }
    : { label: "Niedrig", color: C.down, bg: "#fee2e2", tip: "Grundlagen aufbauen: Kernthemen-Content erstellen, strukturierte Daten und Quellen-Autorität stärken." };

function VisibilityHero({ score, delta, history, daily }) {
  // Tage/Monate + Linie/Balken (04.08., Searchable-Parität): Tagespunkte =
  // echte Mess-Snapshots (3-Tage-Kadenz), Monate = je Monat der neueste Report.
  const dailyPts = (daily || []).filter((h) => h.score != null).map((h) => ({ m: h.d, score: h.score }));
  const monthPts = (history || []).filter((h) => h.score != null).slice(-12);
  const [range, setRange] = useState(dailyPts.length >= 3 ? "tage" : "monate");
  const [chart, setChart] = useState("linie");
  const [hover, setHover] = useState(null); // Maus-Zeitstrahl (04.08.)
  const [chartRef, W] = useChartWidth(520, 340);
  const pts = range === "tage" && dailyPts.length >= 2 ? dailyPts : monthPts;
  const H = 150, PAD = 8, AXL = 30, AXB = 16;
  const maxS = Math.max(10, ...pts.map((p) => p.score));
  const x = (i) => AXL + PAD + (i / Math.max(1, pts.length - 1)) * (W - AXL - 2 * PAD);
  const y = (v) => H - AXB - PAD - (v / maxS) * (H - AXB - 2 * PAD);
  const line = pts.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");
  const prev = pts.length > 1 ? pts[pts.length - 2].score : null;
  const relDelta = prev ? Math.round(((score - prev) / prev) * 1000) / 10 : null;
  const barW = Math.max(6, Math.min(28, ((W - AXL - 2 * PAD) / Math.max(1, pts.length)) - 6));
  const Toggle = ({ value, set, options }) => (
    <div className="flex rounded-md border p-0.5" style={{ borderColor: C.line, background: C.card }}>
      {options.map(([k, t]) => (
        <button key={k} onClick={() => set(k)} className="rounded px-1.5 py-0.5 text-[10px] font-medium focus:outline-none"
          style={{ background: value === k ? C.indigo : "transparent", color: value === k ? "#fff" : C.sub }}>
          {t}
        </button>
      ))}
    </div>
  );
  return (
    <RCard icon={Eye} title="Sichtbarkeit" info="Sichtbarkeits-Score der Marke über alle gemessenen KI-Systeme. Tage = einzelne Messläufe (alle ~3 Tage), Monate = je Monat der neueste Stand." desc="Score-Trend über alle KI-Systeme" footer={range === "tage" ? `${pts.length} Messungen` : `${pts.length} Monatspunkte`} legend={
      <div className="flex items-center gap-1.5">
        {dailyPts.length >= 2 && <Toggle value={range} set={setRange} options={[["tage", "Tage"], ["monate", "Monate"]]} />}
        <Toggle value={chart} set={setChart} options={[["linie", "〰"], ["balken", "▥"]]} />
      </div>
    }>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: C.sub }}>Sichtbarkeits-Score</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color: C.ink }}>{score}</span>
        {delta !== 0 && delta != null && (
          <span className="text-sm font-semibold" style={{ color: delta > 0 ? C.up : C.down }}>{delta > 0 ? `+${delta}` : delta}</span>
        )}
        {relDelta != null && relDelta !== 0 && (
          <span className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: relDelta > 0 ? "#d1fae5" : "#fee2e2", color: relDelta > 0 ? "#065f46" : "#b91c1c" }}>
            {relDelta > 0 ? "+" : ""}{relDelta}%
          </span>
        )}
        {score != null && (
          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: SCORE_GUIDE(score).bg, color: SCORE_GUIDE(score).color }}>
            {SCORE_GUIDE(score).label}
          </span>
        )}
      </div>
      {score != null && (
        <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: C.sub }}>
          <span className="font-semibold" style={{ color: SCORE_GUIDE(score).color }}>Empfehlung:</span>{" "}
          {SCORE_GUIDE(score).tip}
        </p>
      )}
      {pts.length > 1 && (
        <div ref={chartRef} className="mt-2" style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`} style={{ width: W, display: "block" }}
          onMouseMove={(e) => setHover(svgHoverIndex(e, W, AXL, PAD, pts.length))}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={AXL + PAD} x2={W - PAD} y1={y(f * maxS)} y2={y(f * maxS)} stroke={C.line} strokeWidth="1" />
              <text x={AXL} y={y(f * maxS) + 3} textAnchor="end" fontSize="9" fill={C.sub}>{Math.round(f * maxS)}</text>
            </g>
          ))}
          {pts.map((p, i) => (
            (pts.length <= 7 || i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)) && p.m ? (
              <text key={i} x={x(i)} y={H - 3} textAnchor="middle" fontSize="9" fill={C.sub}>{p.m}</text>
            ) : null
          ))}
          {chart === "balken" ? (
            pts.map((p, i) => (
              <rect key={i} x={x(i) - barW / 2} y={y(p.score)} width={barW} height={Math.max(1, H - AXB - PAD - y(p.score))} rx="2"
                fill={C.indigo} fillOpacity={i === pts.length - 1 ? 1 : 0.55}>
                <title>{`${p.m}: ${p.score}`}</title>
              </rect>
            ))
          ) : (
            <>
              <polyline points={line} fill="none" stroke={C.indigo} strokeWidth="2" />
              {pts.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.score)} r={i === pts.length - 1 ? 3.5 : 2} fill={C.indigo} fillOpacity={i === pts.length - 1 ? 1 : 0.5}>
                  <title>{`${p.m}: ${p.score}`}</title>
                </circle>
              ))}
            </>
          )}
          {hover != null && pts[hover] && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - AXB - PAD} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(pts[hover].score)} r="4" fill={C.indigo} stroke="#fff" strokeWidth="1.5" />
              <HoverBox x={x(hover)} top={PAD} W={W} lines={[{ text: pts[hover].m }, { text: `Score ${pts[hover].score}`, color: "#b9aefc" }]} />
            </g>
          )}
        </svg>
        </div>
      )}
    </RCard>
  );
}

// Visibility-Tab Zeile 1 rechts: Rankings — Marke vs. Konkurrenten.
// Präsenz je Marke aus den Prompt-Zeilen (comps-Array); Sentiment nur für die
// eigene Marke erhoben → Konkurrenz ehrlich mit „—".
// Marken-Icon (04.08., „bei allen Icons"): echte Favicons für ALLE Marken.
// Von Rivalen kennen wir nur Namen → Domain-Rate-Kette Name→.ch→.com über
// DuckDuckGo-Favicons (liefert 404 bei Fehlversuch, anders als Google s2);
// Initial-Chip nur noch als letzter Fallback.
const AVATAR_COLORS = ["#77008C", "#0d9488", "#d97706", "#B9009C", "#0284c7", "#dc2626", "#059669", "#b45309"];
// Vom Judge gelieferte Rival-Domains (compPositions.d) — exakt statt geraten.
// Modul-Registry, vom Dashboard bei jedem Datenload befüllt (kein Prop-Drilling).
const BRAND_DOMAINS = new Map();
const registerBrandDomains = (prompts) => {
  for (const p of prompts || []) {
    for (const cp of p.compPositions || []) {
      if (cp.d && cp.n) BRAND_DOMAINS.set(String(cp.n).toLowerCase(), cp.d);
    }
  }
};
// Eigentümer-Klasse einer zitierten Domain (11.08., Searchable-Parität):
// "own" = Kundendomain, "rival" = bekannte Konkurrenz-Domain (Judge-Feld d in
// comp_positions), sonst null = Extern (Presse/Verzeichnis/…, siehe Typologie).
const domainOwnership = (domain, ownDomain) => {
  const norm = (s) => String(s || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const d = norm(domain);
  if (!d) return null;
  const own = norm(ownDomain);
  if (own && (d === own || d.endsWith("." + own))) return "own";
  for (const rd of BRAND_DOMAINS.values()) {
    const r = norm(rd);
    if (r && (d === r || d.endsWith("." + r))) return "rival";
  }
  return null;
};
function OwnershipChip({ kind }) {
  if (!kind) return null;
  const own = kind === "own";
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
      style={{ background: own ? "#d1fae5" : "#fee2e2", color: own ? "#065f46" : "#b91c1c" }}>
      {own ? "Eigene" : "Konkurrenz"}
    </span>
  );
}
const guessDomains = (name, domain) => {
  if (domain) return [String(domain).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")];
  const known = BRAND_DOMAINS.get(String(name || "").toLowerCase());
  if (known) return [known];
  const n = String(name || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/é|è|ê/g, "e")
    .replace(/&/g, "").replace(/[^a-z0-9.]/g, "");
  if (!n) return [];
  if (n.includes(".")) return [n];
  return [`${n}.ch`, `${n}.com`];
};
function BrandIcon({ name, domain, size = 18 }) {
  const cands = guessDomains(name, domain);
  const [idx, setIdx] = useState(0);
  if (idx < cands.length) {
    return (
      <img
        src={`https://icons.duckduckgo.com/ip3/${cands[idx]}.ico`}
        alt="" width={size} height={size} className="shrink-0 rounded" loading="lazy"
        onError={() => setIdx(idx + 1)}
      />
    );
  }
  const c = AVATAR_COLORS[[...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded font-bold text-white"
      style={{ background: c, width: size, height: size, fontSize: Math.max(8, size * 0.55) }}>
      {String(name).charAt(0).toUpperCase()}
    </span>
  );
}
const BrandAvatar = BrandIcon; // Rankings nutzen denselben Baustein

function RankingsTable({ prompts, opps, sov, brand, sentimentPct, domain }) {
  // Sortierbare Spalten (Searchable-Parität): Klick auf Kopf toggelt Richtung.
  const [sort, setSort] = useState({ key: "vis", dir: -1 });
  // Nenner-Fix (06.08., Volkan: "Präsenz immer 100%"): Chancen (= Antworten
  // OHNE eigene Erwähnung) gehören in die Grundgesamtheit, sonst ist die
  // eigene Präsenz per Konstruktion 100 % und die Konkurrenz zu niedrig.
  const all = [...(prompts || []), ...(opps || [])];
  const presence = (name, self) => {
    if (!all.length) return 0;
    const n = self
      ? all.filter((p) => p.status && p.status !== "Nicht erwähnt").length
      : all.filter((p) => (p.comps || []).some((c) => c.toLowerCase() === name.toLowerCase())).length;
    return Math.round((n / all.length) * 100);
  };
  // Ø-Position je Marke (04.08., Searchable "Avg Position"): 1=Top-Empfehlung,
  // 2=in Liste, 3=Randnotiz — eigene Marke aus position, Rivalen aus comp_positions.
  const POSN = { top: 1, list: 2, passing: 3 };
  const posAgg = new Map();
  const bumpPos = (name, p) => {
    const v = POSN[p];
    if (!v) return;
    const t = posAgg.get(name.toLowerCase()) || { sum: 0, n: 0 };
    t.sum += v; t.n += 1; posAgg.set(name.toLowerCase(), t);
  };
  for (const p of all) {
    if (p.status && p.status !== "Nicht erwähnt") bumpPos(brand, p.position);
    for (const cp of p.compPositions || []) bumpPos(cp.n, cp.p);
  }
  const avgPos = (name) => {
    const t = posAgg.get(name.toLowerCase());
    return t && t.n ? Math.round((t.sum / t.n) * 10) / 10 : null;
  };
  // Rival-Sentiment (04.08.): Anteil positiver Judge-Bewertungen je Konkurrent
  // (compPositions.s) — gleiche Skala wie die eigene Marke; ab 3 Bewertungen.
  const sentAgg = new Map();
  for (const p of all) {
    for (const cp of p.compPositions || []) {
      if (!cp.s) continue;
      const t = sentAgg.get(cp.n.toLowerCase()) || { pos: 0, n: 0 };
      if (cp.s === "pos") t.pos += 1;
      t.n += 1; sentAgg.set(cp.n.toLowerCase(), t);
    }
  }
  const rivalSenti = (name) => {
    const t = sentAgg.get(name.toLowerCase());
    return t && t.n >= 3 ? Math.round((t.pos / t.n) * 100) : null;
  };
  const rows = [
    { brand, self: true, vis: presence(brand, true), share: (sov || []).find((s) => s.isSelf)?.share ?? null, senti: sentimentPct, pos: avgPos(brand) },
    ...(sov || []).filter((s) => !s.isSelf).map((s) => ({ brand: s.brand, self: false, vis: presence(s.brand, false), share: s.share, senti: rivalSenti(s.brand), pos: avgPos(s.brand) })),
  ].sort((a, b) => {
    // dir=-1 = "beste zuerst"; bei Position ist KLEINER besser, sonst grösser.
    const na = a[sort.key] ?? (sort.key === "pos" ? Infinity : -Infinity);
    const nb = b[sort.key] ?? (sort.key === "pos" ? Infinity : -Infinity);
    const best = sort.key === "pos" ? na - nb : nb - na;
    return (sort.dir === -1 ? best : -best) || a.brand.localeCompare(b.brand);
  });
  const hasPos = rows.some((r) => r.pos != null);
  const SortTh = ({ k, label, align = "right" }) => (
    <th className={`px-3 py-2 text-${align} font-medium`}>
      <button
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}
        className="inline-flex items-center gap-0.5 focus:outline-none"
        style={{ color: sort.key === k ? C.indigo : C.sub }}
      >
        {label}
        <span className="text-[8px]">{sort.key === k ? (sort.dir === -1 ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
  return (
    <RCard icon={Hash} title="Rankings" info="Präsenzrate je Marke = Anteil der KI-Antworten, in denen die Marke vorkommt. Sentiment = Anteil positiver Bewertungen (Konkurrenten ab 3 Bewertungen, seit 04.08. vom Judge miterhoben). Ø-Position: 1 = Top-Empfehlung, 2 = in Liste, 3 = Randnotiz. Spalten sind per Klick sortierbar, die Liste scrollt." desc="Marke im Vergleich zum Wettbewerb" footer={`${rows.length} Marken`} pad={false}>
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 340 }}>
        <table className="w-full text-[12px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10" style={{ background: C.card, boxShadow: `0 1px 0 ${C.line}` }}>
            <tr style={{ color: C.sub }}>
              <th className="px-5 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Marke</th>
              <SortTh k="vis" label="Präsenz" />
              <SortTh k="share" label="SoV" />
              <SortTh k="senti" label="Sentiment" />
              {hasPos && <SortTh k="pos" label="Ø-Position" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.brand} style={{ borderTop: `1px solid ${C.line}`, background: r.self ? "rgba(119,0,140,.05)" : i % 2 ? C.cardAlt : "transparent" }}>
                <td className="px-5 py-2 tabular-nums" style={{ color: C.sub }}>{i + 1}</td>
                <td className="px-3 py-2 font-semibold" style={{ color: r.self ? C.indigo : C.ink }}>
                  <span className="inline-flex items-center gap-2">
                    <BrandAvatar name={r.brand} domain={r.self ? domain : undefined} />
                    {r.brand}
                    {r.self && <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: C.indigo, color: "#fff" }}>DU</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: C.ink }}>{r.vis}%</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.sub }}>{r.share != null ? `${r.share}%` : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.senti == null ? C.sub : r.senti >= 50 ? C.up : C.amber }}>{r.senti != null ? r.senti : "—"}</td>
                {hasPos && (
                  <td className="px-3 py-2 text-right tabular-nums" title="1 = Top-Empfehlung · 2 = in Liste · 3 = Randnotiz" style={{ color: r.pos != null ? C.ink : C.sub }}>
                    {r.pos != null ? `# ${r.pos.toFixed(1)}` : "—"}
                  </td>
                )}
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
  const [hover, setHover] = useState(null); // Maus-Zeitstrahl (04.08.)
  const [chartRef, W] = useChartWidth(520, 340);
  const H = 120, PAD = 8, AXL = 30, AXB = 16;
  const maxV = Math.max(1, ...pts.map((p) => p.v));
  const x = (i) => AXL + PAD + (i / Math.max(1, pts.length - 1)) * (W - AXL - 2 * PAD);
  const y = (v) => H - AXB - PAD - (v / maxV) * (H - AXB - 2 * PAD);
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
        <div ref={chartRef} className="mt-2" style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`} style={{ width: W, display: "block" }}
          onMouseMove={(e) => setHover(svgHoverIndex(e, W, AXL, PAD, pts.length))}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={AXL + PAD} x2={W - PAD} y1={y(f * maxV)} y2={y(f * maxV)} stroke={C.line} strokeWidth="1" />
              <text x={AXL} y={y(f * maxV) + 3} textAnchor="end" fontSize="9" fill={C.sub}>{Math.round(f * maxV)}</text>
            </g>
          ))}
          {pts.map((p, i) => (
            (pts.length <= 6 || i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)) && p.m ? (
              <text key={i} x={x(i)} y={H - 3} textAnchor="middle" fontSize="9" fill={C.sub}>{p.m}</text>
            ) : null
          ))}
          <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke={color} strokeWidth="2" />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r="3.5" fill={color} />
          {hover != null && pts[hover] && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - AXB - PAD} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(pts[hover].v)} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
              <HoverBox x={x(hover)} top={PAD} W={W} lines={[{ text: pts[hover].m || "" }, { text: `${title} ${nf(pts[hover].v)}` }]} />
            </g>
          )}
        </svg>
        </div>
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
// Gruppierte Sub-Navigation (04.08., Searchable-Look). Ausgelagert, damit die
// EzyAI-Shell (ezyai.tsx) dieselbe Nav in der linken Seitenleiste rendern kann.
function buildTabGroups(d) {
  const hasBrand = !!d?.brandCheck;
  const hasConv = Array.isArray(d?.attribution) && d.attribution.length > 0;
  // Prompts-Tab aufgelöst (04.08.): die All-Responses-Tabelle hängt jetzt am
  // Ende des Erwähnungen-Tabs (Searchable-Aufbau) — Badge wandert mit.
  return [
    { group: "Analyse", items: [
      { id: "uebersicht", label: "Sichtbarkeit", icon: Eye },
      { id: "erwaehnungen", label: "Erwähnungen", icon: Swords, badge: d?.promptsNeedsReview || 0 },
      ...(hasBrand ? [{ id: "marke", label: "Marke", icon: Tags }] : []),
    ] },
    { group: "Inhalte", items: [
      { id: "quellen", label: "Quellen", icon: Link2 },
      { id: "themen", label: "Themen", icon: Layers },
    ] },
    // Folgefragen-Tab entfernt (05.08., User-Entscheid); FanoutPanel bleibt
    // ungenutzt im Code, d.fanout wird weiter gemessen.
    { group: "Kontext", items: [
      ...(Array.isArray(d?.countries) && d.countries.length ? [{ id: "standorte", label: "Standorte", icon: MapPin }] : []),
      ...(hasConv ? [{ id: "conversions", label: "Conversions", icon: MousePointerClick }] : []),
    ] },
  ].map((g) => ({ ...g, items: g.items.filter(Boolean) })).filter((g) => g.items.length);
}

// navStyle: "sidebar" = eigene vertikale Nav (Standalone) · "topbar" = horizontale
// Bereichs-Leiste im Content (eingebettet in die EzyAI-Shell, Searchable-Layout).
export default function AIVisibilityDashboard({ data, convRows = [], navStyle = "sidebar", onReviewPrompts }) {
  const d = data;
  const isTop = navStyle === "topbar";
  const [tab, setTab] = useState("uebersicht");
  const [modelF, setModelF] = useState("alle");
  const [topicF, setTopicF] = useState("alle"); // Themen-Filter (C) — greift, sobald der Messlauf topic je Prompt schreibt
  const [countryF, setCountryF] = useState("alle"); // Standort-Filter (Searchable „Locations")
  // Branded-Filter (Searchable „Branded & Unbranded", Volkan 10.08.): Marken-
  // Prompts in die Präsenz-Sicht einbeziehen — seit 10.08. DEFAULT für alle
  // Kunden (Volkan). Score/KPIs bleiben Markt-only, damit die Historie
  // vergleichbar bleibt.
  const [brandedF, setBrandedF] = useState("beide");
  if (!d) return <AIVisibilityEmpty />;
  // Rival-Domains aus dem Judge für exakte Marken-Logos registrieren (04.08.).
  registerBrandDomains(d.prompts);

  const platforms = [...new Set([...(d.prompts || []), ...(d.promptOpps || [])].map((p) => p.platform).filter(Boolean))].sort();
  const topicsAvail = [...new Set([...(d.prompts || []), ...(d.promptOpps || [])].map((p) => p.topic).filter(Boolean))].sort();
  const countriesAvail = [...new Set([...(d.prompts || []), ...(d.promptOpps || [])].map((p) => p.country).filter(Boolean))].sort();
  const byFilter = (arr) => (arr || [])
    .filter((p) => modelF === "alle" || p.platform === modelF)
    .filter((p) => topicF === "alle" || p.topic === topicF)
    .filter((p) => countryF === "alle" || p.country === countryF);
  const fP = byFilter(d.prompts);
  const fO = byFilter(d.promptOpps);
  // Branded & Unbranded: Marken-Prompt-Zeilen haben dieselbe Form wie Markt-
  // Zeilen — erwähnte laufen als Prompts, nicht erwähnte als Chancen in den
  // Nenner. Wirkt auf Rankings, Kaufreise, Antwort-Position und Head-to-Head.
  // Brand-Zeilen tragen historisch KEINEN status (Brand-Judge schreibt nur
  // brand_eval) → Fallback: Markenname im Antwort-Text (10.08., Studioforma
  // 49/50 Brand-Antworten nennen die Marke, alle status=NULL).
  const brandNeedle = String(d.client || "").toLowerCase().split(".")[0];
  const isMention = (p) => p.status
    ? p.status !== "Nicht erwähnt"
    : !!brandNeedle && String(p.response || "").toLowerCase().includes(brandNeedle);
  const branded = brandedF === "beide" && (d.brandPrompts || []).length > 0;
  const fB = byFilter(d.brandPrompts);
  const fPB = branded ? [...fP, ...fB.filter(isMention)] : fP;
  const fOB = branded ? [...fO, ...fB.filter((p) => !isMention(p))] : fO;
  // Rankings rechnet bewusst ungefiltert (Gesamtwerte) — eigener Merge-Pool.
  const rankP = branded ? [...(d.prompts || []), ...(d.brandPrompts || []).filter(isMention)] : d.prompts;
  const rankO = branded ? [...(d.promptOpps || []), ...(d.brandPrompts || []).filter((p) => !isMention(p))] : d.promptOpps;
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

  const TAB_GROUPS = buildTabGroups(d);
  const TABS = TAB_GROUPS.flatMap((g) => g.items); // flache Liste für Mobile-Leiste

  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="w-full" style={{ background: C.page, color: C.ink }}>
      {/* topbar: horizontale Bereichs-Leiste im Content (Searchable-Layout).
          Sticky (04.08.): bleibt beim Runterscrollen oben sichtbar. */}
      {isTop && (
        <div className="border-b" style={{ borderColor: C.line, position: "sticky", top: isTop ? 53 : 0, zIndex: 20, background: "#f7f5f9" }}>
          <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden">
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px]"
                  style={{
                    color: on ? C.ink : C.sub, fontWeight: on ? 700 : 500,
                    background: "none", border: "none", cursor: "pointer",
                    borderBottom: `2px solid ${on ? C.indigo : "transparent"}`, marginBottom: -1,
                  }}
                >
                  <t.icon size={14} style={{ color: on ? C.indigo : C.sub }} />
                  {t.label}
                  {t.badge > 0 && <span className="rounded-full px-1 text-[9px] font-bold" style={{ background: "#fdf6e3", color: "#8a6d1b" }}>{t.badge}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className={isTop ? "" : "mx-auto max-w-6xl lg:flex lg:gap-6"}>

        {/* Seitenleiste (Desktop) — nur im Standalone-Modus (navStyle=sidebar). */}
        {!isTop && (
        <aside className="hidden shrink-0 lg:block lg:w-52">
          <nav className="sticky top-4" style={{ padding: "12px 8px" }}>
            {TAB_GROUPS.map((g, gi) => (
              <div key={g.group} style={{ marginTop: gi ? 14 : 0 }}>
                <div style={{ padding: "0 14px 6px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: C.sub }}>{g.group}</div>
                {g.items.map((t) => {
                  const Icon = t.icon;
                  const a = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: a ? "rgba(119,0,140,0.09)" : "transparent",
                        color: a ? "#77008C" : C.sub,
                        fontSize: 13, fontWeight: a ? 600 : 400, marginBottom: 2,
                        transition: "all .15s", fontFamily: "inherit",
                      }}
                    >
                      <Icon size={18} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{t.label}</span>
                      {t.badge > 0 && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums" style={{ background: "#fdf6e3", color: "#8a6d1b" }}>{t.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        )}

        {/* Mobile: horizontale Chip-Leiste (nur im Standalone-Modus) */}
        {!isTop && (
        <div className="lg:hidden">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {TABS.map((t) => {
              const a = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]"
                  style={{
                    padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                    background: a ? "rgba(119,0,140,0.09)" : "transparent",
                    color: a ? "#77008C" : C.sub, fontWeight: a ? 600 : 400, fontFamily: "inherit",
                  }}
                >
                  <t.icon size={16} />
                  {t.label}
                  {t.badge > 0 && <span className="rounded-full px-1 text-[9px] font-bold" style={{ background: "#fdf6e3", color: "#8a6d1b" }}>{t.badge}</span>}
                </button>
              );
            })}
          </div>
        </div>
        )}

      <div className="min-w-0 flex-1">
        {/* Aktiver Bereich als Überschrift (nur im Sidebar-Modus; topbar zeigt ihn schon) */}
        {!isTop && <h2 className="mt-1 hidden text-lg font-bold lg:block" style={{ color: C.ink }}>{activeTab?.label}</h2>}

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
          {topicsAvail.length > 1 && (
            <select
              value={topicF}
              onChange={(e) => setTopicF(e.target.value)}
              className="rounded-full border px-2.5 py-1 text-[11.5px]"
              style={{ borderColor: topicF === "alle" ? C.line : C.indigo, background: C.card, color: topicF === "alle" ? C.sub : C.indigo }}
              title="Wirkt auf Kaufreise, Position, Intent und Prompts"
            >
              <option value="alle">Alle Themen</option>
              {topicsAvail.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {countriesAvail.length > 1 && (
            <select
              value={countryF}
              onChange={(e) => setCountryF(e.target.value)}
              className="rounded-full border px-2.5 py-1 text-[11.5px]"
              style={{ borderColor: countryF === "alle" ? C.line : C.indigo, background: C.card, color: countryF === "alle" ? C.sub : C.indigo }}
              title="Standort-Filter (Herkunft der Anfragen) — wirkt auf Kaufreise, Position, Intent und Prompts"
            >
              <option value="alle">Alle Standorte</option>
              {countriesAvail.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {(d.brandPrompts || []).length > 0 && (
            <select
              value={brandedF}
              onChange={(e) => setBrandedF(e.target.value)}
              className="rounded-full border px-2.5 py-1 text-[11.5px]"
              style={{ borderColor: brandedF === "beide" ? C.line : C.indigo, background: C.card, color: brandedF === "beide" ? C.sub : C.indigo }}
              title="Marken-Prompts (Fragen über die Marke selbst) in Rankings, Kaufreise, Position und Head-to-Head einbeziehen — Standard (Searchable-Sicht). Score und KPIs bleiben Markt-only."
            >
              <option value="beide">Branded & Unbranded</option>
              <option value="markt">Nur Markt-Prompts</option>
            </select>
          )}
          {(modelF !== "alle" || topicF !== "alle" || countryF !== "alle" || (brandedF === "markt" && (d.brandPrompts || []).length > 0)) && (
            <span className="rounded-full px-2.5 py-1" style={{ background: C.cardAlt }}>
              Filter aktiv: {[modelF !== "alle" ? `nur ${modelF}` : null, topicF !== "alle" ? `Thema „${topicF}"` : null, countryF !== "alle" ? `Standort ${countryF}` : null, brandedF === "markt" && (d.brandPrompts || []).length > 0 ? "ohne Marken-Prompts (nur Markt)" : null].filter(Boolean).join(" · ")} (Score/KPIs bleiben Gesamtwerte)
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
              <VisibilityHero score={d.score} delta={d.versionSwitch ? 0 : d.scoreDelta} history={d.trend} daily={d.versionSwitch ? [] : d.dailyTrend} />
              <RankingsTable prompts={rankP} opps={rankO} sov={d.sov} brand={d.client} sentimentPct={sentimentPct} domain={d.domain} />
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
              {Array.isArray(d.sov) && d.sov.length > 1 && (
                <DonutCard
                  title="Share of Voice"
                  subtitle={`Marke vs. Konkurrenten · ${d.date}`}
                  data={[...d.sov].sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0) || b.share - a.share).slice(0, 8).map((s) => ({ name: s.isSelf ? `${s.brand} · Sie` : s.brand, value: s.share }))}
                  palette={[C.indigo, "#8b8da3", "#a7a9b8", "#c1c2cc", "#6d6473", "#54555f", "#9a9ba8", "#b5b6c2"]}
                  centerLabel="SoV %"
                />
              )}
            </div>
          </>
        )}

        {tab === "erwaehnungen" && (
          <>
            {/* Zeile 1 wie Searchable Mentions & Citations: zwei Kennzahl-Trends */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricTrendCard icon={MessageSquare} title="Erwähnungen" info="Wie oft die Marke in KI-Antworten genannt wird — Monatsverlauf über alle Systeme." value={d.kpis.mentions.value} delta={d.kpis.mentions.delta} series={(d.trend || []).map((t) => ({ v: t.mentions, m: t.m }))} color={C.indigo} />
              <MetricTrendCard icon={Link2} title="Citations" info="Wie oft KI-Antworten die eigene Website als Quelle verlinken — Monatsverlauf." value={d.kpis.citations.value} delta={d.kpis.citations.delta} series={(d.trend || []).map((t) => ({ v: t.citations, m: t.m }))} color={C.teal} />
            </div>
            <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              {/* Linke Spalte: Kaufreise + Head-to-Head (füllt den bisherigen Leerraum) */}
              <div className="grid grid-cols-1 gap-4">
                <FunnelCard prompts={fPB} opps={fOB} />
                <PositionHeadToHead prompts={fPB} opps={fOB} sov={d.sov} brand={d.client} only="head2head" />
              </div>
              {/* Rechte Spalte: Positions-Matrizen */}
              <PositionHeadToHead prompts={fPB} opps={fOB} sov={d.sov} brand={d.client} only="positions" />
            </div>
            {/* Share-of-Voice-Karte hier auf Wunsch entfernt (04.08.) —
                der SoV-Donut bleibt auf dem Sichtbarkeits-Tab. */}
            {/* Prompts-Tab aufgelöst (04.08.): Matrix + All-Responses-Tabelle
                hängen jetzt hier am Ende — wie Searchables Mentions & Citations. */}
            <div className="mt-4 grid grid-cols-1 gap-4">
              <PromptMatrix prompts={fP} opps={fO} />
              <PromptsTable prompts={fP} opps={fO} brand={d.client} brandPrompts={d.brandPrompts || []} needsReview={d.promptsNeedsReview || 0} onReview={onReviewPrompts} clientId={d.clientId} />
              <GoogleSerpAiCard serpAi={d.serpAi} brand={d.client} />
              <ChatgptFanoutCard fanout={d.chatgptFanout} brand={d.client} />
            </div>
          </>
        )}

        {tab === "marke" && (
          <div className="mt-0 grid grid-cols-1 gap-4">
            <SentimentScoreCard sentiment={d.sentiment} brand={d.client} />
            <BrandPerceptionCard perception={d.brandCheck?.perception} brand={d.client} />
            <BrandCheckCard bc={d.brandCheck} brand={d.client} history={d.brandHistory || []} />
          </div>
        )}

        {tab === "quellen" && (
          <div className="mt-4 grid grid-cols-1 gap-4">
            <DomainTrendCard trend={d.sourceTrend} />
            <CitedTypesCard sources={d.sources} ownDomain={d.domain} />
            <SourcesTable rows={d.sources} ownDomain={d.domain} />
            <UrlsTable prompts={[...(d.prompts || []), ...(d.brandPrompts || [])]} ownDomain={d.domain} />
          </div>
        )}

        {tab === "themen" && <TopicsPanel rows={d.topics} prompts={[...(fP || []), ...(fO || [])]} />}



        {tab === "standorte" && <LocationPanel countries={d.countries} models={d.models} />}

        {tab === "conversions" && (
          <div className="mt-4">
            <AttributionStrip rows={d.attribution} convRows={convRows} />
            <ConversionRegions attribution={d.attribution} />
          </div>
        )}

        <p className="mt-6 text-center text-[11px]" style={{ color: C.sub }}>
          EzyHub · AI Visibility · {d.market} · {d.date}
        </p>
      </div>
      </div>
    </div>
  );
}

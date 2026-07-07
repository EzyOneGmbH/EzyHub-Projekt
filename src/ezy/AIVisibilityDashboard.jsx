import React, { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Sparkles, TrendingUp, TrendingDown, Quote, FileText, Eye,
  ExternalLink, MousePointerClick, ChevronRight, MessageSquareQuote,
} from "lucide-react";

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
const C = {
  page: "transparent", // erbt den dunklen App-Hintergrund
  card: "#181923",
  cardAlt: "#12131a", // aufgeklappte Zeilen / subtile Panels
  track: "#252636",   // Balken-/Fortschritt-Hintergrund, Chips
  ink: "#e2e4f0",     // Haupttext
  sub: "#8b8da3",     // gedämpft
  line: "#252636",    // Rahmen
  indigo: "#6c5ce7",
  teal: "#14b8a6",
  amber: "#f59e0b",
  violet: "#a78bfa",
  up: "#10b981", down: "#ef4444",
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
    <div className="rounded-xl border p-5" style={CARD}>
      <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Entwicklung · 6 Monate</h3>
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

function TopicsTable({ rows }) {
  return (
    <div className="rounded-xl border" style={CARD}>
      <div className="border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Erfolgreichste Themen</h3>
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
            {rows.map((r) => (
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
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: C.sub }}>{nf(r.vol)}</td>
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
    </div>
  );
}

function SourcesTable({ rows }) {
  return (
    <div className="rounded-xl border" style={CARD}>
      <div className="border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Referenzierte Quellen</h3>
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

function AttributionStrip({ rows }) {
  const totalS = rows.reduce((a, b) => a + b.sessions, 0);
  const totalC = rows.reduce((a, b) => a + b.conv, 0);
  return (
    <div className="rounded-xl border p-5" style={CARD}>
      <div className="flex items-center gap-2">
        <MousePointerClick size={15} style={{ color: C.teal }} />
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Conversions</h3>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: C.sub }}>letzte 30 Tage · {nf(totalS)} Sessions · {totalC} Conversions</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.engine} className="rounded-lg border p-3" style={{ borderColor: C.line, background: C.cardAlt }}>
            <div className="text-xs font-medium" style={{ color: C.sub }}>{r.engine}</div>
            <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: C.ink }}>{r.sessions}</div>
            <div className="text-[11px]" style={{ color: r.conv > 0 ? C.up : C.sub }}>
              {r.conv} Conv.
            </div>
          </div>
        ))}
      </div>
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

function PromptGroupRow({ g, opportunity }) {
  const [open, setOpen] = useState(false);
  const rate = g.total ? Math.round((g.mentioned / g.total) * 100) : 0;
  return (
    <>
      <tr
        className="border-t cursor-pointer transition-colors hover:bg-white/5"
        style={{ borderColor: C.line }}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-5 py-3 align-top">
          <div className="flex items-start gap-2">
            <ChevronRight
              size={14}
              className="mt-0.5 shrink-0 transition-transform"
              style={{ color: C.sub, transform: open ? "rotate(90deg)" : "none" }}
            />
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
      {open && (
        <tr style={{ background: C.cardAlt }}>
          <td colSpan={opportunity ? 2 : 3} className="px-5 pb-3.5 pt-0">
            <div className="ml-6 flex flex-col gap-2">
              {g.engines.map((e) => (
                <div key={e.platform} className="rounded-lg border p-3" style={{ borderColor: C.line, background: C.card }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <PlatformTag p={e.platform} />
                      <StatusPill s={e.status} />
                    </div>
                    {(e.position || e.sentiment) && (
                      <div className="flex items-center gap-x-3 text-[11px]" style={{ color: C.sub }}>
                        {e.position && <span>Position: <b style={{ color: C.ink }}>{POS_LABEL[e.position] || e.position}</b></span>}
                        {e.sentiment && <span>Tonalität: <b style={{ color: SENT_COLOR(e.sentiment) }}>{SENT_LABEL[e.sentiment] || e.sentiment}</b></span>}
                      </div>
                    )}
                  </div>
                  {e.response && (
                    <p className="mt-2 text-[13px] leading-relaxed" style={{ color: C.ink }}>{e.response}</p>
                  )}
                  {e.comps?.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px]" style={{ color: C.sub }}>
                        {opportunity ? "Genannte Konkurrenten:" : "Mit-genannt:"}
                      </span>
                      {e.comps.map((c) => (
                        <span key={c} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: C.track, color: C.ink }}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PromptsTable({ prompts, opps, brand }) {
  const [tab, setTab] = useState("all");
  const allRows = [...prompts, ...opps.map((o) => ({ ...o, status: "Nicht erwähnt" }))];
  const source = tab === "all" ? allRows : tab === "win" ? prompts : opps;
  const opportunity = tab === "opp";
  const groups = groupPrompts(source);
  return (
    <div className="rounded-xl border" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: C.line }}>
        <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Prompts</h3>
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: C.line }}>
          {[{ k: "all", t: "Alle Prompts" }, { k: "win", t: "Erfolgreichste Prompts" }, { k: "opp", t: "Prompt-Chancen" }].map((x) => (
            <button key={x.k} onClick={() => setTab(x.k)}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2"
              style={{ background: tab === x.k ? C.indigo : "transparent", color: tab === x.k ? "#fff" : C.sub }}>
              {x.t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-2 text-[11px]" style={{ color: C.sub }}>
        <span>
          {tab === "all"
            ? `${groups.length} Prompts über alle KI-Modelle – Status je Modell für ${brand}. Zeile aufklappen für die echten Antworten.`
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
            {groups.map((g) => (
              <PromptGroupRow key={`${g.prompt}·${g.country}`} g={g} opportunity={opportunity} />
            ))}
          </tbody>
        </table>
      </div>
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
    <div className="rounded-xl border p-5" style={CARD}>
      <h3 className="text-sm font-semibold" style={{ color: C.ink }}>Share of Voice</h3>
      <p className="mt-0.5 text-xs" style={{ color: C.sub }}>Nennungen im Vergleich zu Konkurrenten – über alle KI-Antworten</p>
      <div className="mt-4 space-y-2.5">
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
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────
export default function AIVisibilityDashboard({ data }) {
  const d = data;
  if (!d) return <AIVisibilityEmpty />;

  return (
    <div className="w-full" style={{ background: C.page, color: C.ink }}>
      <div className="mx-auto max-w-6xl">

        {/* Top row: score + KPIs (Header entfällt — Tab-Kopf der App zeigt Titel + Kunde) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border p-5 lg:col-span-1" style={CARD}>
            <ScoreRing value={d.score} delta={d.scoreDelta} modelCount={d.models.length} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
            <Kpi icon={Eye} label="Erwähnungen" color={C.indigo} {...d.kpis.mentions} />
            <Kpi icon={Quote} label="Citations" color={C.teal} {...d.kpis.citations} />
            <Kpi icon={FileText} label="Referenzierte Seiten" color={C.amber} value={d.kpis.citedPages.value} delta={d.kpis.citedPages.delta} prev={d.kpis.citedPages.prev} />
          </div>
        </div>

        {/* Mid row: trend + distribution */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TrendCard data={d.trend} />
          <ModelDistribution models={d.models} />
        </div>

        {/* Geo + Intent */}
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
            subtitle="Suchintention der Prompts"
            data={d.promptIntent}
            palette={[C.violet, C.indigo, C.teal, C.sub, C.amber]}
            centerLabel="Prompts"
          />
        </div>

        {/* Share of Voice (nur wenn Konkurrenten erkannt) */}
        {Array.isArray(d.sov) && d.sov.length > 1 && (
          <div className="mt-4">
            <SovCard rows={d.sov} />
          </div>
        )}

        {/* Attribution */}
        <div className="mt-4">
          <AttributionStrip rows={d.attribution} />
        </div>

        {/* Tables */}
        <div className="mt-4 grid grid-cols-1 gap-4">
          <TopicsTable rows={d.topics} />
          <PromptsTable prompts={d.prompts} opps={d.promptOpps} brand={d.client} />
          <SourcesTable rows={d.sources} />
        </div>

        <p className="mt-6 text-center text-[11px]" style={{ color: C.sub }}>
          EzyHub · AI Visibility · {d.market} · {d.date}
        </p>
      </div>
    </div>
  );
}

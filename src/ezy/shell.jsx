// Redesign 1b «Icon-Rail + Glas-Header» (21.08.2026, Design-Handoff):
// Plattform-Shell-Bausteine — AppRail (76px App-Switcher), SegmentedTabs,
// Status-/Positions-Pills und Toggle. Reine Praesentationsschicht; Gating
// (useAppAccess.canOpen) und Navigation kommen vom Aufrufer.
import { useState } from "react";
import { Bot, LayoutGrid, LogOut, Mail, Megaphone, Radar, Search, Settings } from "lucide-react";
import { C } from "./theme";
import { EZY_APPS } from "@/ezy/data/appRegistry";

// Lucide-Glyphen je App (ersetzen die Registry-Emojis in Rail + Launcher).
export const APP_GLYPHS = {
  seo: Search,
  geo: Bot,
  analyse: Radar,
  ads: Megaphone,
  reakt: Mail,
  admin: Settings,
};
const APP_SHORT = {
  seo: "Rank",
  geo: "AI",
  analyse: "Analyse",
  ads: "Perf.",
  reakt: "Reakt",
  admin: "Admin",
};

/** Marken-Hexagon (E + Power-O) — SVG nach Hi-Fi, klickbar zum Launcher. */
export function EzyHexMark({ size = 30 }) {
  return (
    <svg
      width={size}
      height={(size * 38) / 34}
      viewBox="0 0 34 38"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="ezyhex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#71008B" />
          <stop offset="1" stopColor="#B9009C" />
        </linearGradient>
      </defs>
      <polygon points="17,0 34,9.5 34,28.5 17,38 0,28.5 0,9.5" fill="url(#ezyhex)" />
      <text
        x="11"
        y="23.6"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="#fff"
        fontFamily="Poppins,sans-serif"
      >
        E
      </text>
      <g
        transform="translate(22.3,18.9) scale(0.5) translate(-12,-12.5)"
        stroke="#fff"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        <line x1="12" y1="2" x2="12" y2="12" />
      </g>
    </svg>
  );
}

/**
 * AppRail — 76px-Icon-Rail links (ersetzt Sidebar-Logo + ⣿-App-Switcher).
 * current: aktive App-Id; canOpen: Gate aus useAppAccess; profile: {name, role}.
 */
export function AppRail({ current, canOpen, profile, onLogout, initials }) {
  const [menue, setMenue] = useState(false);
  return (
    <aside
      className="app-sidebar"
      style={{
        width: 76,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "16px 0",
        background: "rgba(252,252,252,.92)",
        borderRight: `1px solid ${C.border}`,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 50,
      }}
    >
      <a href="/apps" title="Zum Launcher" style={{ marginBottom: 8, display: "block" }}>
        <EzyHexMark size={30} />
      </a>
      {EZY_APPS.filter((a) => canOpen?.(a.id)).map((a) => {
        const Glyph = APP_GLYPHS[a.id] || LayoutGrid;
        const aktiv = current === a.id;
        return (
          <a
            key={a.id}
            href={a.href}
            title={a.name}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: C.rTile,
                background: aktiv ? a.tint : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background .15s",
              }}
            >
              <Glyph size={19} color={aktiv ? a.color : C.textDim} />
            </span>
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: ".03em",
                color: aktiv ? a.color : C.textDim,
              }}
            >
              {APP_SHORT[a.id] || a.name}
            </span>
          </a>
        );
      })}
      <div style={{ flex: 1 }} />
      <a
        href="/apps"
        title="Alle Apps"
        style={{
          width: 40,
          height: 40,
          borderRadius: C.rTile,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LayoutGrid size={18} color={C.textDim} />
      </a>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenue((v) => !v)}
          title={profile?.name || "Profil"}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: C.grad,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {initials || "?"}
        </button>
        {menue && (
          <div
            style={{
              position: "absolute",
              left: 46,
              bottom: 0,
              width: 190,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 10,
              boxShadow: C.cardShadow,
              zIndex: 200,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
              {profile?.name || "—"}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>
              {profile?.role || ""}
            </div>
            <button
              onClick={onLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "7px 9px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.bg,
                color: C.textMuted,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <LogOut size={13} /> Abmelden
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * SegmentedTabs — Apple-Segmented-Control (Hi-Fi 2a): Container mit
 * rgba-Tint, aktives Segment weiss mit Schatten + App-Farbe.
 * items: [{id, label, icon?}] — scrollt horizontal bei Platzmangel.
 */
export function SegmentedTabs({ items, active, onChange, color = C.accent }) {
  return (
    <div
      className="tabbar"
      style={{
        display: "flex",
        gap: 2,
        background: C.segBg,
        borderRadius: C.rCtl,
        padding: 3,
        maxWidth: "100%",
      }}
    >
      {items.map((t) => {
        const on = t.id === active;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              background: on ? "#fff" : "transparent",
              boxShadow: on ? C.segShadow : "none",
              fontSize: 12.5,
              fontWeight: on ? 700 : 600,
              color: on ? color : C.textMuted,
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              transition: "all .15s",
            }}
          >
            {Icon && <Icon size={14} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** StatusPill — 99px-Pille mit Farb-Tint (Hi-Fi 6). */
export function StatusPill({ children, color = C.textMuted, bg }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 11px",
        borderRadius: C.rPill,
        fontSize: 11.5,
        fontWeight: 700,
        color,
        background: bg || `${"transparent"}`,
        backgroundColor: bg || "rgba(43,0,51,.05)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** PosBadge — Ranking-Position (≤3 Purple, ≤10 Blau, >10 Orange). */
export function PosBadge({ pos }) {
  const n = Number(pos);
  const [bg, fg] =
    n <= 3 && n > 0
      ? [C.accentDim, C.accent]
      : n <= 10 && n > 0
        ? [C.blueDim, C.blue]
        : [C.orangeDim, C.orange];
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "3px 11px",
        borderRadius: C.rPill,
        fontSize: 12.5,
        fontWeight: 700,
      }}
    >
      {Number.isFinite(n) ? n : "—"}
    </span>
  );
}

/**
 * ScoreRing — 60px-Kreisscore (Hi-Fi 2g): Hairline-Ring, farbiger Bogen,
 * Zahl mittig. value 0–100; Farbe default nach Ampel (≥80 grün, ≥50 orange).
 */
export function ScoreRing({ value, size = 60, color, label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 26;
  const umfang = 2 * Math.PI * r;
  const fg = color || (v >= 80 ? C.green : v >= 50 ? C.orange : C.red);
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} role="img" aria-label={label || `${v}`}>
      <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(43,0,51,.07)" strokeWidth="6" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke={fg}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(umfang * v) / 100} ${umfang}`}
        transform="rotate(-90 30 30)"
      />
      <text
        x="30"
        y="35"
        textAnchor="middle"
        fontSize="16"
        fontWeight="800"
        fill={C.text}
        fontFamily="inherit"
      >
        {Math.round(v)}
      </text>
    </svg>
  );
}

/** ToggleSwitch — 38×22 (Hi-Fi 7). */
export function ToggleSwitch({ on, onChange, title }) {
  return (
    <button
      onClick={() => onChange?.(!on)}
      title={title}
      style={{
        width: 38,
        height: 22,
        borderRadius: C.rPill,
        border: "none",
        cursor: "pointer",
        background: on ? C.green : C.inputBorder,
        position: "relative",
        transition: "background .15s",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

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

// Desktop-Nav-Umbau (Volkan 22.08.): links nur noch die Haupt-WebApps —
// Analyse/Reakt/Admin sind ausschliesslich über den Launcher erreichbar.
export const RAIL_APPS = ["seo", "geo", "ads"];

/**
 * AppRail — linke Desktop-Sidebar (Volkan 22.08.): Zone 1 = Haupt-Apps
 * (EzyRank/EzyAI/EzyPerformance), Hairline-Trennung, Zone 2 = alle Tabs/
 * Bereiche der aktiven App (nav: [{id,label,icon?,active,onClick,group?}]).
 * current: aktive App-Id; canOpen: Gate aus useAppAccess; profile: {name, role}.
 */
export function AppRail({ current, canOpen, profile, onLogout, initials, nav = null }) {
  const [menue, setMenue] = useState(false);
  let letzteGruppe = null;
  return (
    <aside
      className="app-sidebar"
      style={{
        width: 210,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "16px 12px",
        background: "rgba(252,252,252,.92)",
        borderRight: `1px solid ${C.border}`,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 50,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <a
        href="/apps"
        title="Zum Launcher"
        style={{
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          gap: 9,
          textDecoration: "none",
          padding: "0 6px",
        }}
      >
        <EzyHexMark size={26} />
        <span
          style={{
            fontFamily: "'Kamerik 105',Poppins,sans-serif",
            fontWeight: 800,
            fontSize: 14.5,
            color: C.text,
          }}
        >
          Ezy One
        </span>
      </a>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: C.textFaint,
          padding: "0 8px 4px",
        }}
      >
        Apps
      </div>
      {EZY_APPS.filter((a) => RAIL_APPS.includes(a.id) && canOpen?.(a.id)).map((a) => {
        const Glyph = APP_GLYPHS[a.id] || LayoutGrid;
        const aktiv = current === a.id;
        return (
          <a
            key={a.id}
            href={a.href}
            title={a.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 8px",
              borderRadius: 10,
              textDecoration: "none",
              background: aktiv ? a.tint : "transparent",
              transition: "background .15s",
            }}
          >
            <Glyph size={17} color={aktiv ? a.color : C.textDim} />
            <span
              style={{
                fontSize: 13,
                fontWeight: aktiv ? 700 : 600,
                color: aktiv ? a.color : C.textMuted,
              }}
            >
              {a.name}
            </span>
          </a>
        );
      })}
      {Array.isArray(nav) && nav.length > 0 && (
        <>
          {/* Klare Trennung Apps ↔ Bereichs-Nav (Volkan 22.08.; App-Titel-
            Label auf Volkans Wunsch 24.08. wieder entfernt) */}
          <div style={{ height: 1, background: C.border, margin: "12px 4px" }} />
          {nav.map((t) => {
            const Icon = t.icon;
            const gruppenKopf =
              t.group && t.group !== letzteGruppe ? ((letzteGruppe = t.group), t.group) : null;
            return (
              <div key={t.id}>
                {gruppenKopf && (
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: ".07em",
                      textTransform: "uppercase",
                      color: C.textFaint,
                      padding: "10px 8px 3px",
                    }}
                  >
                    {gruppenKopf}
                  </div>
                )}
                <button
                  onClick={t.onClick}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "7px 8px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    background: t.active ? C.accentDim : "transparent",
                    color: t.active ? C.accent : C.textMuted,
                    fontSize: 12.5,
                    fontWeight: t.active ? 700 : 600,
                    transition: "background .15s",
                  }}
                >
                  {Icon && <Icon size={15} />}
                  {t.label}
                </button>
              </div>
            );
          })}
        </>
      )}
      <div style={{ flex: 1, minHeight: 12 }} />
      <div style={{ height: 1, background: C.border, margin: "8px 4px" }} />
      <a
        href="/apps"
        title="Alle Apps"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 8px",
          borderRadius: 10,
          textDecoration: "none",
          color: C.textMuted,
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <LayoutGrid size={16} color={C.textDim} /> Alle Apps
      </a>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenue((v) => !v)}
          title={profile?.name || "Profil"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "6px 8px",
            borderRadius: 10,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: C.grad,
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initials || "?"}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 700,
                color: C.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {profile?.name || "—"}
            </span>
            <span style={{ display: "block", fontSize: 10.5, color: C.textDim }}>
              {profile?.role || ""}
            </span>
          </span>
        </button>
        {menue && (
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: "100%",
              marginBottom: 6,
              width: 186,
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

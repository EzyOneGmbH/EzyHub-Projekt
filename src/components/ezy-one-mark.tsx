// CD-Symbol (Icon-Update 2026-08-14): neues Marken-Icon als Inline-SVG —
// Hexagon mit Marken-Gradient (#71008B→#B9009C), "E" + Power-Symbol als "O"
// (Vorlage: neues Profilbild). Ersetzt das alte Text-"EO"-Badge an allen
// Logo-Stellen (Sidebar EzyRank/EzyAI, App-Launcher, Login, Passwort-Setzen).
export function EzyOneMark({ width = 34 }: { width?: number }) {
  const height = (width * 38) / 34;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 34 38"
      aria-hidden
      style={{ flexShrink: 0, display: "block" }}
    >
      <defs>
        <linearGradient id="ezyOneMarkGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#71008B" />
          <stop offset="1" stopColor="#B9009C" />
        </linearGradient>
      </defs>
      <polygon points="17,0 34,9.5 34,28.5 17,38 0,28.5 0,9.5" fill="url(#ezyOneMarkGrad)" />
      <text
        x="11"
        y="23.6"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="#fff"
        fontFamily="'Kamerik 105',Poppins,sans-serif"
      >
        E
      </text>
      {/* Power-Symbol als "O" — Lucide-"Power"-Pfad, auf Kapitälchenhöhe skaliert. */}
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

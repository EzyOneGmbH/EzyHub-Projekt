// Hexagon-Glow v5 (Volkan 10.08.): NUR die EINZELNE Wabe unter dem Cursor
// leuchtet — keine Gruppen, kein Radius. Die Wabe bleibt hell, solange die
// Maus auf ihr steht; beim Verlassen glimmt sie ~1s langsam aus. Beim
// Überfahren entsteht so eine Spur einzeln nacheinander verlöschender Waben.
//
// Technik: Canvas (CSS-Masken haben kein Gedächtnis). Die Mausposition wird
// auf das Hexagon-Gitter der 28×49-Kachel quantisiert (Zellzentren bei
// 14a / 24.5b−0.25 mit a+b gerade — nächstes Zentrum = getroffene Wabe);
// je Zelle wird ein weißer Kreis mit Alterungs-Alpha gezeichnet und per
// source-in mit der Waben-Kachel gestanzt — deckungsgleich zum CSS-Grund-
// Pattern (gleicher Ursprung), scrollfest (Zellen kleben an den Waben).
// Die Ebene liegt in der Shell HINTER dem Inhalt (zIndex 0 vs. 1) und
// überlappt nie Widgets. rAF läuft nur, solange Zellen leuchten (idle = 0
// CPU). Touch-Geräte und prefers-reduced-motion bekommen den Effekt nicht.

import { useEffect, useRef } from "react";

const TILE_W = 28;
const TILE_H = 49;
const TILE_SVG =
  `<svg width='${TILE_W}' height='${TILE_H}' viewBox='0 0 ${TILE_W} ${TILE_H}' xmlns='http://www.w3.org/2000/svg'>` +
  `<path d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-rule='evenodd'/></svg>`;

const LIFE_MS = 1050; // Ausglimm-Dauer je Wabe (~1s)
const MAX_ALPHA = 0.14; // weiter gedimmt (Volkan 10.08., 2. Stufe: 0.34→0.22→0.14)
const MAX_CELLS = 60; // Sicherheitskappe für die Spur
// Hexagon-Gitter der Kachel: Zellzentren (14a, 24.5b − 0.25), (a+b) gerade.
const CELL_X = 14;
const CELL_Y = 24.5;
const CELL_R = 16; // Kreis deckt genau eine Wabe (Umkreis 15); Stanze schneidet exakt

// Nächstes gültiges Zellzentrum zur Position (px, py) in Container-Koordinaten.
function cellAt(px: number, py: number): { key: string; cx: number; cy: number } {
  const a0 = Math.round(px / CELL_X);
  const b0 = Math.round((py + 0.25) / CELL_Y);
  let best: { key: string; cx: number; cy: number } | null = null;
  let bestD = Infinity;
  for (let a = a0 - 1; a <= a0 + 1; a++) {
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      if (((a + b) % 2 + 2) % 2 !== 0) continue;
      const cx = a * CELL_X;
      const cy = b * CELL_Y - 0.25;
      const dx = cx - px;
      const dy = cy - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { key: `${a},${b}`, cx, cy };
      }
    }
  }
  return best as { key: string; cx: number; cy: number };
}

export function HexGlowLayer() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    const canvas = canvasRef.current;
    if (!anchor || !canvas) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let pattern: CanvasPattern | null = null;
    const img = new Image();
    img.onload = () => {
      pattern = ctx.createPattern(img, "repeat");
    };
    img.src = `data:image/svg+xml,${TILE_SVG}`;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let vw = 0;
    let vh = 0;
    const resize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Leuchtende Waben (Container-Koordinaten) + die aktuell überfahrene.
    const cells = new Map<string, { cx: number; cy: number; left: number }>(); // left = Zeitpunkt des Verlassens
    let currentKey: string | null = null;
    let raf = 0;

    const loop = () => {
      raf = 0;
      const now = performance.now();
      ctx.clearRect(0, 0, vw, vh);
      // Verloschene Zellen entsorgen.
      for (const [k, c] of cells) {
        if (k !== currentKey && now - c.left > LIFE_MS) cells.delete(k);
      }
      if (!cells.size) return; // alles verloschen → Schleife schläft bis zur nächsten Bewegung
      const rect = anchor.getBoundingClientRect();
      for (const [k, c] of cells) {
        // Aktive Wabe voll; verlassene glimmen quadratisch aus ("langsam").
        let a = MAX_ALPHA;
        if (k !== currentKey) {
          const t = (now - c.left) / LIFE_MS;
          a = MAX_ALPHA * (1 - t) * (1 - t);
        }
        if (a <= 0.005) continue;
        const sx = c.cx + rect.left;
        const sy = c.cy + rect.top;
        if (sx < -CELL_R || sy < -CELL_R || sx > vw + CELL_R || sy > vh + CELL_R) continue;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(sx, sy, CELL_R, 0, Math.PI * 2);
        ctx.fill();
      }
      // Waben-Stanze: Kachel deckungsgleich zum CSS-Pattern des Containers.
      if (pattern) {
        ctx.save();
        ctx.globalCompositeOperation = "source-in";
        ctx.translate(rect.left, rect.top);
        ctx.fillStyle = pattern;
        ctx.fillRect(-rect.left, -rect.top, vw, vh);
        ctx.restore();
      }
      raf = requestAnimationFrame(loop);
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    const onMove = (e: MouseEvent) => {
      const rect = anchor.getBoundingClientRect();
      const hit = cellAt(e.clientX - rect.left, e.clientY - rect.top);
      if (hit.key !== currentKey) {
        const now = performance.now();
        // Bisherige Wabe beginnt JETZT auszuglimmen.
        if (currentKey) {
          const prev = cells.get(currentKey);
          if (prev) prev.left = now;
        }
        currentKey = hit.key;
        cells.set(hit.key, { cx: hit.cx, cy: hit.cy, left: now });
        if (cells.size > MAX_CELLS) {
          const oldest = cells.keys().next().value;
          if (oldest && oldest !== currentKey) cells.delete(oldest);
        }
      }
      wake();
    };
    const onLeave = () => {
      // Fenster verlassen: auch die aktive Wabe ausglimmen lassen.
      if (currentKey) {
        const c = cells.get(currentKey);
        if (c) c.left = performance.now();
        currentKey = null;
        wake();
      }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", wake, { passive: true, capture: true });
    window.addEventListener("resize", resize);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", wake, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", resize);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    // zIndex -1 (Fix 10.08. abends): liegt unter ALLEM Inhalt, ohne dass der
    // Inhalt angehoben werden muss — ein zIndex:1 auf dem Hauptbereich hatte
    // einen Stacking-Kontext erzeugt und Dropdowns (z60) unter der fixen
    // Sidebar (z50) gefangen (Datumsfilter unlesbar). Voraussetzung: der
    // Shell-Container selbst ist transparent; Grundfarbe + Waben-Pattern
    // liegen auf einer eigenen Unterlage-Ebene (ebenfalls -1, vor dieser).
    <div ref={anchorRef} aria-hidden style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}>
      <canvas ref={canvasRef} style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none" }} />
    </div>
  );
}

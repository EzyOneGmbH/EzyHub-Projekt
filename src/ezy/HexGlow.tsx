// Hexagon-Glow v3 (Volkan 10.08.): Nachleucht-Spur — jede Wabe, über die die
// Maus fährt, glimmt ~1s langsam aus; der Lichtfleck weitet sich dabei leicht
// (Wellen-/Strahleffekt hinter dem Cursor).
//
// Technik: Canvas statt CSS-Mask (die Mask hat kein "Gedächtnis"). Der Cursor
// hinterlässt Energie-Punkte in Container-Koordinaten; jeder Frame zeichnet
// die Punkte mit Alterungs-Abfall als radiale Lichtflecken und stanzt darüber
// per source-in die Waben-Kachel — deckungsgleich mit dem CSS-Grund-Pattern
// (gleicher Ursprung), scrollfest (Punkte kleben an den Waben, nicht am
// Viewport). Die Ebene liegt in der Shell HINTER dem Inhalt (zIndex 0 vs. 1)
// und überlappt nie Widgets. rAF läuft nur, solange Punkte leben (idle = 0 CPU).
// Touch-Geräte und prefers-reduced-motion bekommen den Effekt nicht.

import { useEffect, useRef } from "react";

const TILE_W = 28;
const TILE_H = 49;
const TILE_SVG =
  `<svg width='${TILE_W}' height='${TILE_H}' viewBox='0 0 ${TILE_W} ${TILE_H}' xmlns='http://www.w3.org/2000/svg'>` +
  `<path d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-rule='evenodd'/></svg>`;

const LIFE_MS = 1050; // Nachleuchtdauer je Punkt (~1s)
const MAX_ALPHA = 0.22; // gedimmt (Volkan 10.08.); Text bleibt jederzeit lesbar
const R_START = 85; // Wirkungs-Radius beim Auftreffen …
const R_END = 150; // … weitet sich beim Ausklingen (Wave)
const MIN_DIST = 12; // neuer Punkt erst ab dieser Cursor-Distanz (Dichte der Spur)
const MAX_POINTS = 90;
// Hexagon-Gitter der 28×49-Kachel (Hero-Pattern): Zellzentren liegen bei
// (14a, 24.5b − 0.25) mit (a+b) gerade. Damit leuchten DISKRET ganze Waben
// auf statt eines weichen Flecks (Volkan 10.08.).
const CELL_X = 14;
const CELL_Y = 24.5;
const CELL_R = 16; // Kreis deckt eine ganze Wabe (Umkreis 15) ab; Stanze schneidet exakt

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

    // Energie-Punkte in Container-Koordinaten (kleben an den Waben, nicht am Viewport).
    const pts: Array<{ x: number; y: number; born: number }> = [];
    let raf = 0;
    let lastX = -1e9;
    let lastY = -1e9;

    const loop = () => {
      raf = 0;
      const now = performance.now();
      while (pts.length && now - pts[0].born > LIFE_MS) pts.shift();
      ctx.clearRect(0, 0, vw, vh);
      if (!pts.length) return; // Spur verloschen → Schleife schläft bis zur nächsten Bewegung
      const rect = anchor.getBoundingClientRect();
      // 1) Intensität PRO WABE: jeden Energie-Punkt aufs Hex-Gitter quantisieren
      //    und je Zelle die stärkste Intensität sammeln — eine Wabe leuchtet
      //    einheitlich als Ganzes und glimmt als Ganzes aus.
      const cells = new Map<string, { cx: number; cy: number; a: number }>();
      for (const p of pts) {
        const age = (now - p.born) / LIFE_MS;
        const pa = MAX_ALPHA * (1 - age) * (1 - age); // quadratisch = "langsames Ausglimmen"
        if (pa <= 0.004) continue;
        const r = R_START + (R_END - R_START) * age;
        const a0 = Math.floor((p.x - r) / CELL_X);
        const a1 = Math.ceil((p.x + r) / CELL_X);
        const b0 = Math.floor((p.y + 0.25 - r) / CELL_Y);
        const b1 = Math.ceil((p.y + 0.25 + r) / CELL_Y);
        for (let a = a0; a <= a1; a++) {
          for (let b = b0; b <= b1; b++) {
            if ((a + b) % 2 !== 0) continue;
            const cx = a * CELL_X;
            const cy = b * CELL_Y - 0.25;
            const dx = cx - p.x;
            const dy = cy - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > r) continue;
            const ca = pa * (1 - (d / r) * (d / r)); // weiche Welle zum Rand
            if (ca <= 0.004) continue;
            const key = `${a},${b}`;
            const prev = cells.get(key);
            if (!prev || ca > prev.a) cells.set(key, { cx, cy, a: ca });
          }
        }
      }
      for (const c of cells.values()) {
        const sx = c.cx + rect.left;
        const sy = c.cy + rect.top;
        if (sx < -CELL_R || sy < -CELL_R || sx > vw + CELL_R || sy > vh + CELL_R) continue;
        ctx.fillStyle = `rgba(255,255,255,${c.a})`;
        ctx.beginPath();
        ctx.arc(sx, sy, CELL_R, 0, Math.PI * 2);
        ctx.fill();
      }
      // 2) Waben-Stanze: Kachel deckungsgleich zum CSS-Pattern des Containers.
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
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) return;
      lastX = e.clientX;
      lastY = e.clientY;
      const rect = anchor.getBoundingClientRect();
      pts.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, born: performance.now() });
      if (pts.length > MAX_POINTS) pts.splice(0, pts.length - MAX_POINTS);
      wake();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", wake, { passive: true, capture: true });
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", wake, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={anchorRef} aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      {/* fixed füllt den Viewport, bleibt aber im Stacking der Ebene (z0) — nie über Widgets. */}
      <canvas ref={canvasRef} style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none" }} />
    </div>
  );
}

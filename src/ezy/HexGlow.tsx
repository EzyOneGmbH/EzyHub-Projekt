// Hexagon-Glow v2 (Volkan-Feedback 10.08.): der Lichtkegel liegt jetzt IN der
// Hintergrund-Ebene der jeweiligen Shell — als absolute Ebene mit derselben
// Waben-Kachel und demselben Ursprung wie das Grund-Pattern (pixelgenau
// deckungsgleich, scrollt mit der Seite: beim Scrollen wandern einzelne
// Hexagone durch den Lichtkegel). Inhalt liegt auf einer Ebene darüber
// (zIndex ≥ 1) — der Glow überlappt NIE Karten oder Widgets.
//
// Cursor-Tracking via CSS-Variablen + requestAnimationFrame (mousemove und
// scroll), keine React-Re-Renders. Touch-Geräte und prefers-reduced-motion
// bekommen den Effekt bewusst nicht.

import { useEffect, useRef } from "react";

const GLOW_TILE = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-opacity='0.35' fill-rule='evenodd'/%3E%3C/svg%3E")`;

// Kleiner Radius + steiler Abfall: es "leuchten" erkennbar einzelne Waben,
// kein grosser Spot.
const GLOW_MASK =
  "radial-gradient(circle 150px at var(--hx, -500px) var(--hy, -500px), black 0%, rgba(0,0,0,.7) 55%, transparent 80%)";

/**
 * Absolute Hintergrund-Ebene. Der einbettende Container braucht
 * position:relative; der Inhalt darüber position:relative + zIndex ≥ 1.
 */
export function HexGlowLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let cx = -1;
    let cy = -1;
    const paint = () => {
      raf = 0;
      if (cx < 0 || !ref.current) return;
      // Cursor in Ebenen-Koordinaten: so bleibt der Kegel auf den Waben des
      // Containers ausgerichtet — auch während des Scrollens.
      const r = ref.current.getBoundingClientRect();
      ref.current.style.setProperty("--hx", `${cx - r.left}px`);
      ref.current.style.setProperty("--hy", `${cy - r.top}px`);
      ref.current.style.opacity = "1";
    };
    const onMove = (e: MouseEvent) => {
      cx = e.clientX;
      cy = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      el.style.opacity = "0";
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        backgroundImage: GLOW_TILE,
        WebkitMaskImage: GLOW_MASK,
        maskImage: GLOW_MASK,
        opacity: 0,
        transition: "opacity .3s ease",
      }}
    />
  );
}

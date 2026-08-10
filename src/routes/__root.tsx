import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import {
  SupabaseConfigError,
  getMissingSupabaseEnv,
} from "@/components/supabase-config-error";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Seite nicht gefunden</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Die Seite existiert nicht oder wurde verschoben.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // CD 2025: Wortmarke "Ezy One" in Sentence case — nie ALL CAPS.
      { title: "Ezy One — SEO & GEO Plattform" },
      {
        name: "description",
        content:
          "Ezy One: Multi-Kunden SEO & GEO Plattform mit Content-Editor, Live-Recherche und KI-Generierung.",
      },
      { property: "og:title", content: "Ezy One — SEO & GEO Plattform" },
      { property: "og:description", content: "Ezy One Tool is a web application for SEO professionals to manage and analyze client data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Ezy One — SEO & GEO Plattform" },
      { name: "description", content: "EZY One Tool is a web application for SEO professionals to manage and analyze client data." },
      { name: "twitter:description", content: "EZY One Tool is a web application for SEO professionals to manage and analyze client data." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e78d1ac-dd30-4747-b980-b616516f2fdc/id-preview-0e7f9dca--3809d703-3b9d-49e8-a029-66c5c48795c6.lovable.app-1780249707839.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e78d1ac-dd30-4747-b980-b616516f2fdc/id-preview-0e7f9dca--3809d703-3b9d-49e8-a029-66c5c48795c6.lovable.app-1780249707839.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // CD-Typografie: Poppins ≈ Kamerik 105 (Titel), Nunito Sans ≈ Aceh Soft
      // (Fließtext) — freie Ersatzschnitte, bis die Originale lizenziert vorliegen.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Nunito+Sans:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// CD-Pattern interaktiv (Volkan 10.08.): die Hexagon-Waben leuchten in einem
// weichen Radius um den Mauszeiger in Marken-Magenta auf. Eine fixe Overlay-
// Ebene (pointer-events:none) trägt dieselbe Waben-Kachel wie der Hintergrund,
// sichtbar nur innerhalb einer radialen CSS-Mask, deren Zentrum per rAF dem
// Cursor folgt — keine React-Re-Renders, kein Layout-Thrash. Touch-Geräte und
// prefers-reduced-motion bekommen den Effekt bewusst nicht.
const HEX_GLOW_TILE = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-opacity='0.28' fill-rule='evenodd'/%3E%3C/svg%3E")`;

function HexCursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty("--hx", `${e.clientX}px`);
        el.style.setProperty("--hy", `${e.clientY}px`);
        el.style.opacity = "1";
      });
    };
    const onLeave = () => {
      el.style.opacity = "0";
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const mask = "radial-gradient(circle 220px at var(--hx, -400px) var(--hy, -400px), black 0%, rgba(0,0,0,.55) 45%, transparent 72%)";
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        backgroundImage: HEX_GLOW_TILE,
        WebkitMaskImage: mask,
        maskImage: mask,
        opacity: 0,
        transition: "opacity .35s ease",
        // multiply: leuchtet auf hellen Flächen als sattes Magenta, lässt
        // Text/Karten lesbar und bleibt auf dunklen Seiten unaufdringlich.
        mixBlendMode: "multiply",
      }}
    />
  );
}

function RootComponent() {
  const missing = getMissingSupabaseEnv();
  if (missing.length > 0) {
    return (
      <>
        <SupabaseConfigError missing={missing} />
        <Toaster />
      </>
    );
  }
  return (
    <AuthProvider>
      <Outlet />
      <HexCursorGlow />
      <Toaster />
    </AuthProvider>
  );
}

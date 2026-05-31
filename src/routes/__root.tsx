import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
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
      { title: "EZY ONE — SEO & GEO Plattform" },
      {
        name: "description",
        content:
          "EZY ONE: Multi-Kunden SEO & GEO Plattform mit Content-Editor, Live-Recherche und KI-Generierung.",
      },
      { property: "og:title", content: "EZY ONE — SEO & GEO Plattform" },
      { property: "og:description", content: "EZY One Tool is a web application for SEO professionals to manage and analyze client data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "EZY ONE — SEO & GEO Plattform" },
      { name: "description", content: "EZY One Tool is a web application for SEO professionals to manage and analyze client data." },
      { name: "twitter:description", content: "EZY One Tool is a web application for SEO professionals to manage and analyze client data." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e78d1ac-dd30-4747-b980-b616516f2fdc/id-preview-0e7f9dca--3809d703-3b9d-49e8-a029-66c5c48795c6.lovable.app-1780249707839.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e78d1ac-dd30-4747-b980-b616516f2fdc/id-preview-0e7f9dca--3809d703-3b9d-49e8-a029-66c5c48795c6.lovable.app-1780249707839.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
      <Toaster />
    </AuthProvider>
  );
}

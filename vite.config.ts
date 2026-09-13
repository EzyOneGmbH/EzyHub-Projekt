// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Bekannte Build-Warnung (Dependency-Hygiene 13.09.2026), bewusst NICHT
// unterdrueckt: «Unknown input options: platform». Ursache: nitro (3.0.2609xx-
// beta) baut den Server-Bundle mit Rolldown-Optionen (`platform: "node"|
// "neutral"`, nitro/dist/_build/rolldown.mjs) und erwartet Vite ^8 (Rolldown);
// unter Vite 7 (Rollup 4) reicht Vite dieselben Optionen an Rollup weiter,
// das `platform` nicht kennt und die Option ignoriert. Wirkung: keine —
// Externals/Builtins setzt nitro explizit. Weg ist mit dem Wechsel auf Vite 8,
// sobald das Lovable-Preset (@lovable.dev/vite-tanstack-config) dafuer
// freigegeben ist. Derselben Ursache entspringt der nitro-Hinweis «vite@7.x is
// installed but the vite builder requires ^8» — rein informativ, der Build
// laeuft unter Vite 7 vollstaendig durch (Client + Server + Cloudflare-Output).
// Die zweite fruehere Warnung («Wrangler config main is overridden») ist
// behoben: wrangler.jsonc setzt kein main mehr.

export default defineConfig({
  vite: {
    plugins: [mcpPlugin()],
    build: {
      rollupOptions: {
        output: {
          // Bundle-Split (21.08.2026): grosse Vendor-Pakete in eigene Chunks —
          // Ziel: kein Client-Chunk ueber 500 KB. recharts laedt damit nur,
          // wenn eine Chart-Ansicht es wirklich braucht.
          manualChunks(id) {
            if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-"))
              return "vendor-recharts";
            if (id.includes("node_modules/lucide-react")) return "vendor-lucide";
            if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
            return undefined;
          },
        },
      },
    },
  },
});

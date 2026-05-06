import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  target: z.string().min(1).max(500),
});

// Beispiel: Ahrefs Domain Rating endpoint.
// Siehe: https://docs.ahrefs.com/reference (eigene Endpoints je nach Plan).
export const ahrefsDomainRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.AHREFS_API_KEY;
    if (!apiKey) throw new Error("AHREFS_API_KEY ist nicht konfiguriert");

    const url = new URL("https://api.ahrefs.com/v3/site-explorer/domain-rating");
    url.searchParams.set("target", data.target);
    url.searchParams.set("date", new Date().toISOString().slice(0, 10));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ahrefs API Fehler [${res.status}]: ${text}`);
    }

    return await res.json();
  });

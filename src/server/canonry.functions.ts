import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  path: z.string().min(1).max(500),
  method: z.enum(["GET", "POST"]).default("GET"),
  body: z.unknown().optional(),
});

// Generischer Proxy zur Canonry API.
export const canonryRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const baseUrl = process.env.CANONRY_BASE_URL;
    const apiKey = process.env.CANONRY_API_KEY;
    if (!baseUrl) throw new Error("CANONRY_BASE_URL ist nicht konfiguriert");
    if (!apiKey) throw new Error("CANONRY_API_KEY ist nicht konfiguriert");

    const url = `${baseUrl.replace(/\/$/, "")}/${data.path.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method: data.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: data.method === "POST" && data.body ? JSON.stringify(data.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Canonry API Fehler [${res.status}]: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  });

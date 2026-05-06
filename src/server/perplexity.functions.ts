import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  query: z.string().min(1).max(2000),
  model: z.enum(["sonar", "sonar-pro", "sonar-reasoning"]).default("sonar"),
});

export const perplexitySearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error("PERPLEXITY_API_KEY ist nicht konfiguriert");

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: data.model,
        messages: [
          { role: "system", content: "Sei präzise und gib Quellen an." },
          { role: "user", content: data.query },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Perplexity API Fehler [${res.status}]: ${text}`);
    }

    const json = await res.json();
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      citations: json.citations ?? [],
    };
  });

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { messages } = await req.json();
    const KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!KEY) throw new Error("LOVABLE_API_KEY missing");

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [
          { role: "system", content: "Du bist der freundliche KI-Assistent in EZY ONE TOOL — einer App für Kunden- und Aufgabenverwaltung. Antworte klar und kurz auf Deutsch." },
          ...messages,
        ],
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: "Rate Limit" }), { status: 429, headers: { ...cors, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "Guthaben aufgebraucht" }), { status: 402, headers: { ...cors, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      console.error("AI error", r.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(r.body, { headers: { ...cors, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});

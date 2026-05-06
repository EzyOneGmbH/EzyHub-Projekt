import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { context } = await req.json();
    if (!context) return new Response(JSON.stringify({ error: "context required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!KEY) throw new Error("LOVABLE_API_KEY missing");

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Du schlägst konkrete, umsetzbare nächste Aufgaben auf Deutsch vor — kurz und handlungsorientiert." },
          { role: "user", content: context.slice(0, 6000) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_tasks",
            description: "Liefert 3-5 nächste Aufgaben",
            parameters: {
              type: "object",
              properties: {
                tasks: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
              },
              required: ["tasks"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_tasks" } },
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: "Rate Limit" }), { status: 429, headers: { ...cors, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "Guthaben aufgebraucht" }), { status: 402, headers: { ...cors, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      console.error("AI error", r.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let tasks: string[] = [];
    try { tasks = JSON.parse(args ?? "{}").tasks ?? []; } catch {}
    return new Response(JSON.stringify({ tasks }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});

import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Bot, Send, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
});

type Msg = { role: "user" | "assistant"; content: string };

function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Msg = { role: "user", content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;
    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });

      if (resp.status === 429) {
        toast.error("Rate Limit erreicht, bitte später erneut.");
        setLoading(false);
        return;
      }
      if (resp.status === 402) {
        toast.error("KI-Guthaben aufgebraucht.");
        setLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) {
        toast.error("Fehler beim Stream");
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            buffer = "";
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistant += delta;
              setMessages((m) =>
                m.map((msg, i) => (i === m.length - 1 ? { ...msg, content: assistant } : msg)),
              );
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e) {
      toast.error("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-foreground">KI-Assistent</h1>
        <p className="text-sm text-muted-foreground">Stelle Fragen oder lass dir helfen.</p>
      </div>

      <Card className="flex h-[calc(100vh-220px)] flex-col p-4">
        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Bot className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Wie kann ich helfen?</p>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
              >
                <div className="whitespace-pre-wrap">{m.content || "..."}</div>
              </div>
              {m.role === "user" && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input
            placeholder="Nachricht..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={loading}
          />
          <Button onClick={send} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}

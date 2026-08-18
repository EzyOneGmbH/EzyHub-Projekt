import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Modul 3 (2026-07-16): Seite "LLM-Ueberblick" — Overall-Sicht des monatlichen
// LLM-Antworten-Portfolio-Monitors (audit_runs type 'llm_responses', Sentinel
// result.client "__overall__"). Nur rendern, wenn eine Zeile existiert.

export const Route = createFileRoute("/llm-ueberblick")({
  component: LlmUeberblickRoute,
});

const C = {
  bg: "#0a0b0f",
  card: "#181923",
  border: "#252636",
  text: "#e2e4f0",
  muted: "#8b8da3",
  dim: "#5c5e72",
  accent: "#6c5ce7",
  accentLight: "#a78bfa",
  green: "#10b981",
  red: "#ef4444",
  surface: "#12131a",
};

function LlmUeberblickRoute() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [row, setRow] = useState<any>(null);
  const [state, setState] = useState<"loading" | "empty" | "ready">("loading");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from("audit_runs")
        .select("result, finished_at")
        .eq("audit_type", "llm_responses")
        .eq("status", "succeeded")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = (data as any)?.result;
      if (r && r.client === "__overall__") {
        setRow(r);
        setState("ready");
      } else setState("empty");
    })();
  }, [session]);

  if (loading || !session) return null;
  if (state === "loading")
    return (
      <Shell>
        <div style={{ color: C.muted }}>Laedt…</div>
      </Shell>
    );
  if (state === "empty")
    return (
      <Shell>
        <div style={{ color: C.muted, fontSize: 14 }}>
          Noch kein LLM-Antworten-Lauf vorhanden. Der Monitor laeuft monatlich automatisch; ein
          manueller Lauf ist ueber den agent-service moeglich.
        </div>
      </Shell>
    );

  const landscape = row.landscape || {};
  const prompts = row.prompts || [];
  const summary = row.clientSummary || [];
  const models = Object.entries(row.resolvedModels || {})
    .map(([p, m]) => `${p}: ${m || "—"}`)
    .join(" · ");

  return (
    <Shell>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            LLM-Ueberblick
          </h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Lauf vom {row.date} · {models}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 6, fontStyle: "italic" }}>
            Momentaufnahme ueber vier KI-Modelle. Antworten variieren pro Lauf — aussagekraeftig ist
            der Trend, nicht der Einzelwert.
          </div>
        </div>

        {/* Landschaft */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            KI-Antwort-Landschaft — meistzitierte Quellen
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {(landscape.topDomainsOverall || []).map((d: any, i: number) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  color: C.text,
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                }}
              >
                {d.domain} <span style={{ color: C.dim }}>{d.count}</span>
              </span>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 10,
            }}
          >
            {Object.entries(landscape.byCategory || {}).map(([cat, doms]: [string, any]) => (
              <div
                key={cat}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{ fontSize: 11, fontWeight: 600, color: C.accentLight, marginBottom: 6 }}
                >
                  {cat}
                </div>
                {(doms || []).slice(0, 5).map((d: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: C.muted,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{d.domain}</span>
                    <span style={{ color: C.dim }}>{d.count}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Kunden-Overlay */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Kunden in KI-Antworten
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: "left" }}>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Kunde</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Genannt in Prompts</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>davon relevant</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Provider</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s: any, i: number) => {
                const gap = s.ofRelevant > 0 && s.appearedInPrompts === 0;
                return (
                  <tr
                    key={i}
                    style={{
                      borderTop: `1px solid ${C.border}`,
                      background: gap ? "rgba(239,68,68,0.10)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px", color: C.text }}>{s.slug}</td>
                    <td
                      style={{
                        padding: "8px",
                        color: s.appearedInPrompts ? C.green : C.red,
                        fontWeight: 600,
                      }}
                    >
                      {s.appearedInPrompts}
                    </td>
                    <td style={{ padding: "8px", color: C.muted }}>{s.ofRelevant}</td>
                    <td style={{ padding: "8px", color: C.muted }}>
                      {(s.providers || []).join(", ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Prompts aufklappbar */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Prompts ({prompts.length})
          </div>
          {prompts.map((p: any, i: number) => (
            <Fragment key={i}>
              <div
                onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 8px",
                  borderTop: i ? `1px solid ${C.border}` : "none",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12, color: C.text }}>
                  {p.category ? (
                    <span style={{ color: C.accentLight, marginRight: 8 }}>[{p.category}]</span>
                  ) : null}
                  {p.prompt}
                </div>
                <div style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>
                  {(p.clientHits || []).length
                    ? `${p.clientHits.length} Kunde(n) genannt`
                    : "keine Kunden-Nennung"}{" "}
                  {open[i] ? "▲" : "▼"}
                </div>
              </div>
              {open[i] ? (
                <div
                  style={{
                    background: C.surface,
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 8,
                  }}
                >
                  {(p.clientHits || []).length ? (
                    <div style={{ fontSize: 11, color: C.green, marginBottom: 8 }}>
                      Genannt/zitiert:{" "}
                      {p.clientHits
                        .map(
                          (h: any) => `${h.slug} (${h.via.join("+")}: ${h.providers.join(", ")})`,
                        )
                        .join(" · ")}
                    </div>
                  ) : null}
                  {(p.byProvider || []).map((bp: any, k: number) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <div
                        style={{ fontSize: 11, fontWeight: 600, color: bp.error ? C.red : C.muted }}
                      >
                        {bp.provider}
                        {bp.model ? ` (${bp.model})` : ""}
                        {bp.error ? ` — Fehler: ${bp.error}` : ""}
                      </div>
                      {!bp.error ? (
                        <div style={{ fontSize: 11, color: C.dim }}>
                          Quellen: {(bp.citedDomains || []).join(", ") || "—"}
                          {(bp.fanOutQueries || []).length ? (
                            <span> · Suchanfragen: {(bp.fanOutQueries || []).join(" / ")}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: any }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "28px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

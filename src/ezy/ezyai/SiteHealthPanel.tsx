// SiteHealthPanel (QS-Runde 13.09.2026): aus src/routes/ezyai.tsx (5.7k Zeilen)
// unveraendert herausgeloest.
import { authedFetch } from "@/lib/authed-fetch";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { SEV_STYLE, scoreColor, scoreLabel } from "@/ezy/ezyai/severity";

// On-demand-Audit über /api/admin/site-health (kostenlose Live-Checks auf der
// Kundendomain). Drei Säulen mit Searchable-Gewichten (Technical 30 % /
// Content 35 % / AEO 35 %), Issue-Liste mit Severity. mode="issues" zeigt
// dieselben Daten mit Fokus auf die Problemliste (Sidebar-Punkt "Issues").
// Aufteilung 13.08. (Volkan, Screenshot-Feedback): Site Health = Scores +
// Seiten + Check-Tabellen (ohne Problem-Liste, nur Verweis), Issues = NUR die
// Problem-Liste. Beide lesen denselben letzten Audit.
export function SiteHealthPanel({
  clientId,
  S,
  mode,
  onGoIssues,
}: {
  clientId: string;
  S: Record<string, string>;
  mode: "health" | "issues";
  onGoIssues?: () => void;
}) {
  const [audit, setAudit] = useState<any | undefined>(undefined); // undefined = lädt, null = keiner
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  const call = useCallback(
    async (method: "GET" | "POST", auditMode?: "quick" | "deep") => {
      const session = (await supabase.auth.getSession()).data.session;
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      };
      let url = `/api/admin/site-health?client=${encodeURIComponent(clientId)}`;
      if (method === "POST") {
        url = "/api/admin/site-health";
        init.headers = { ...init.headers, "Content-Type": "application/json" };
        init.body = JSON.stringify({ client: clientId, mode: auditMode || "quick" });
      }
      const r = await authedFetch(url, init);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j.audit ?? null;
    },
    [clientId],
  );

  useEffect(() => {
    let alive = true;
    setAudit(undefined);
    setErr("");
    call("GET")
      .then((a) => {
        if (alive) setAudit(a);
      })
      .catch((e) => {
        if (alive) {
          setErr(String(e?.message || e));
          setAudit(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [call]);

  const [runningMode, setRunningMode] = useState<"quick" | "deep" | null>(null);
  const runAudit = async (auditMode: "quick" | "deep") => {
    setRunning(true);
    setRunningMode(auditMode);
    setErr("");
    try {
      setAudit(await call("POST", auditMode));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setRunning(false);
      setRunningMode(null);
    }
  };

  const card: any = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const issues = audit?.issues || [];
  const checks = audit?.checks || [];
  const pillars: Array<[string, string]> = [
    ["technical", "Technik"],
    ["content", "Inhalt"],
    ["aeo", "AI-Readiness"],
  ];

  // Problem-Liste (13.08. in den Issues-Tab verschoben, Volkan).
  const issuesCard = (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 10 }}>
        {issues.length
          ? `${issues.length} ${issues.length === 1 ? "Problem" : "Probleme"} gefunden`
          : "Keine Probleme gefunden 🎉"}
      </div>
      {issues.map((i: any) => {
        const sv = SEV_STYLE[i.severity] || SEV_STYLE.niedrig;
        return (
          <div
            key={i.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "9px 0",
              borderTop: `1px solid ${S.line}`,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: 10.5,
                fontWeight: 700,
                borderRadius: 99,
                padding: "2px 9px",
                background: sv.bg,
                color: sv.fg,
              }}
            >
              {sv.label}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>
                {i.label} <span style={{ fontWeight: 400, color: S.mut }}>— {i.detail}</span>
              </div>
              <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{i.tipp}</div>
              {Array.isArray(i.pages) && i.pages.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {i.pages.slice(0, 6).map((p: string) => (
                    <span
                      key={p}
                      style={{
                        fontSize: 10,
                        color: S.mut,
                        border: `1px solid ${S.line}`,
                        borderRadius: 6,
                        padding: "1px 6px",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p}
                    </span>
                  ))}
                  {i.pages.length > 6 && (
                    <span style={{ fontSize: 10, color: S.mut }}>
                      +{i.pages.length - 6} weitere
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {mode === "health" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => runAudit("quick")}
            disabled={running}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: "none",
              cursor: running ? "default" : "pointer",
              background: S.app,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running && runningMode === "quick" ? "Quick-Audit läuft… (~10 s)" : "Quick-Audit"}
          </button>
          <button
            onClick={() => runAudit("deep")}
            disabled={running}
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              border: `1px solid ${S.app}`,
              cursor: running ? "default" : "pointer",
              background: "transparent",
              color: S.app,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running && runningMode === "deep"
              ? "Tiefen-Audit läuft… (~2 Min)"
              : "Tiefen-Audit (bis 50 Seiten)"}
          </button>
          {audit?.at && (
            <span style={{ fontSize: 12, color: S.mut }}>
              Letzter Audit: {new Date(audit.at).toLocaleString("de-CH")} · {audit.url}
              {audit.mode === "deep" && Array.isArray(audit.pages) && audit.pages.length > 1
                ? ` · ${audit.pages.length} Seiten`
                : " · Startseite"}
            </span>
          )}
          {err && <span style={{ fontSize: 12, color: "#dc2626" }}>{err}</span>}
        </div>
      )}

      {audit === undefined ? (
        <div style={{ ...card, color: S.mut, fontSize: 13 }}>Lade letzten Audit…</div>
      ) : !audit ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🩺</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>
            Noch kein Audit für diesen Kunden
          </div>
          <div style={{ fontSize: 13, color: S.mut }}>
            {mode === "issues"
              ? "Im Tab «Site Health» einen Quick- oder Tiefen-Audit starten — die gefundenen Probleme erscheinen dann hier."
              : "Quick-Audit prüft Startseite, robots.txt, Sitemap und AI-Readiness (~10 s); der Tiefen-Audit nimmt bis zu 50 Unterseiten aus der Sitemap dazu (~2 Min). Beides ohne Zusatzkosten."}
          </div>
        </div>
      ) : mode === "issues" ? (
        /* Issues-Tab (13.08.): NUR die Problem-Liste. */
        <>
          {audit?.at && (
            <div style={{ fontSize: 12, color: S.mut }}>
              Stand: {new Date(audit.at).toLocaleString("de-CH")} · {audit.url}
              {audit.mode === "deep" && Array.isArray(audit.pages) && audit.pages.length > 1
                ? ` · ${audit.pages.length} Seiten geprüft`
                : " · Startseite"}
            </div>
          )}
          {issuesCard}
        </>
      ) : (
        <>
          {/* Score-Karten */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            {[["overall", "Gesamt-Score"], ...pillars].map(([k, label]) => {
              const v = audit.scores?.[k] ?? 0;
              return (
                <div key={k} style={card}>
                  <div
                    style={{
                      fontSize: 11,
                      color: S.mut,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        color: scoreColor(v),
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {v}
                    </span>
                    <span style={{ fontSize: 11.5, color: S.mut }}>/ 100 · {scoreLabel(v)}</span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 99,
                      background: S.line,
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${v}%`,
                        height: "100%",
                        borderRadius: 99,
                        background: scoreColor(v),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Problem-Verweis (13.08.): Liste lebt im Issues-Tab. */}
          {issues.length > 0 && (
            <button
              onClick={onGoIssues}
              style={{
                ...card,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                width: "100%",
              }}
            >
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: S.txt }}>
                {issues.length} {issues.length === 1 ? "Problem" : "Probleme"} gefunden
              </span>
              <span style={{ fontSize: 12, color: S.mut }}>— Details im Tab «Issues»</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: S.app }}>
                Ansehen →
              </span>
            </button>
          )}

          {/* Seiten-Tabelle (Tiefen-Audit) */}
          {Array.isArray(audit.pages) && audit.pages.length > 1 && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt, marginBottom: 8 }}>
                Geprüfte Seiten · {audit.pages.length}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr
                      style={{
                        color: S.mut,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".04em",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "5px 8px" }}>Seite</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Score</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Probleme</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>HTTP</th>
                      <th style={{ padding: "5px 8px", textAlign: "right" }}>Zeit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.pages]
                      .sort((a: any, b: any) => a.score - b.score)
                      .map((p: any) => (
                        <tr key={p.path} style={{ borderTop: `1px solid ${S.line}` }}>
                          <td
                            style={{
                              padding: "6px 8px",
                              maxWidth: 340,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: S.txt,
                            }}
                            title={p.title || p.path}
                          >
                            {p.path}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: scoreColor(p.score),
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.score}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: p.issues ? S.txt : S.mut,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.issues || "—"}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: p.status === 200 ? S.mut : "#dc2626",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.status}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: S.mut,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {p.ms} ms
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Check-Tabellen je Säule (nur im Site-Health-Modus) */}
          {mode === "health" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 16,
              }}
            >
              {pillars.map(([p, label]) => (
                <div key={p} style={card}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: S.txt, marginBottom: 8 }}>
                    {label} · {audit.scores?.[p] ?? 0}/100
                  </div>
                  {checks
                    .filter((c: any) => c.pillar === p)
                    .map((c: any) => (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "baseline",
                          fontSize: 12,
                          padding: "4px 0",
                          borderTop: `1px solid ${S.line}`,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>
                          {c.status === "ok" ? "✅" : c.status === "warn" ? "⚠️" : "❌"}
                        </span>
                        <span style={{ flex: 1, color: S.txt }}>{c.label}</span>
                        <span
                          style={{
                            color: S.mut,
                            fontSize: 11,
                            textAlign: "right",
                            maxWidth: 150,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.detail}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: S.mut }}>
            Basis: robots.txt, llms.txt, Sitemap und{" "}
            {audit.mode === "deep" ? "die geprüften Seiten" : "die Startseite"} — Gewichtung Technik
            30 % · Inhalt 35 % · AI-Readiness 35 %. Umsetzung der Fixes läuft wie gewohnt über die
            SEO-Agenten mit Freigabe.
          </div>
        </>
      )}
    </div>
  );
}

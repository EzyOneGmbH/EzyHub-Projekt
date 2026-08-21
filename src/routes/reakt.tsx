import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { AppRail } from "@/ezy/shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reakt")({
  component: ReaktApp,
});

// Plattform Phase 4 (2026-07-31): echte Reaktivierungs-App. Liest Waves/
// Entwürfe/Zeitplan über den Proxy /api/agent/reakt vom Cloud-PC.
// EISERNE REGEL: diese UI kann NIE senden — Entwürfe öffnet man in Outlook,
// nur der 03:00-Zeitplan lässt sich (mit Bestätigung) schalten.
// Light Studio (2026-08-03): hell à la Searchable
// Redesign 1b (21.08.): Hi-Fi-Neutrale; Reakt-Gruen bleibt App-Farbe.
const S = {
  bg: "#FCFCFC",
  panel: "#ffffff",
  line: "rgba(43,0,51,.08)",
  txt: "#0D0D0D",
  mut: "#5d5563",
  app: "#059669",
  appTint: "rgba(5,150,105,.10)",
  warn: "#b45309",
  red: "#dc2626",
};

type Wave = {
  file: string;
  rows: number;
  byStatus: Record<string, number>;
  modified: string | null;
};
type Draft = {
  file: string;
  date: string | null;
  id: number | null;
  org: string;
  ort: string;
  status: string;
  alias: string;
  name: string;
  weblink: string;
};

const waveLabel = (f: string) =>
  f
    .replace(/^results_/, "")
    .replace(/\.json$/, "")
    .replace(/^wave(\d+)$/, "Welle $1")
    .replace(/^test_/, "Testlauf ")
    .replace(/_run1$/, " (Lauf 1)");

function ReaktApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role, isOrgAdmin } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const [status, setStatus] = useState<{
    waves: Wave[];
    noted: number;
    targets: number;
    schedule: { time: string; enabled: boolean; lastRunDate: string | null } | null;
  } | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"ENTWURF" | "alle">("ENTWURF");

  useEffect(() => {
    if (!authLoading && !session)
      navigate({ to: "/login", search: { next: "/reakt" }, replace: true });
  }, [authLoading, session, navigate]);
  useEffect(() => {
    if (!authLoading && role === "viewer") window.location.replace("/dashboard");
  }, [authLoading, role]);
  useEffect(() => {
    if (!accessLoading && session && role !== "viewer" && !canOpen("reakt"))
      window.location.replace("/apps");
  }, [accessLoading, session, role, canOpen]);

  const call = useCallback(async (qs: string, init?: RequestInit) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch(`/api/agent/reakt${qs}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token || ""}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    return r.json().catch(() => ({ ok: false, error: "Antwort ungültig" }));
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    const [s, e] = await Promise.all([call("?what=status"), call("?what=entwuerfe")]);
    if (s.ok) setStatus(s);
    else setErr(s.error || "Status nicht erreichbar (läuft der Cloud-PC?)");
    if (e.ok) setDrafts(e.rows || []);
  }, [call]);
  useEffect(() => {
    if (session && !authLoading) void load();
  }, [session, authLoading, load]);

  const toggleSchedule = async () => {
    if (!status?.schedule) return;
    const on = !status.schedule.enabled;
    const msg = on
      ? "Nacht-Zeitplan (03:00) SCHARF schalten?\n\nDie Maschine erstellt dann jede Nacht neue Outlook-ENTWÜRFE (nie Versand). Vorher: aktuelle Entwürfe gesichtet?"
      : "Nacht-Zeitplan (03:00) deaktivieren?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    const j = await call("", { method: "POST", body: JSON.stringify({ enabled: on }) });
    setBusy(false);
    if (j.ok) await load();
    else setErr(j.error || "Schalten fehlgeschlagen");
  };

  const rows = useMemo(() => {
    const all = drafts || [];
    return filter === "ENTWURF" ? all.filter((r) => r.status === "ENTWURF") : all;
  }, [drafts, filter]);

  if (authLoading || !session || role === "viewer") return null;

  const sched = status?.schedule;
  const totalByStatus: Record<string, number> = {};
  for (const w of status?.waves || [])
    for (const [k, v] of Object.entries(w.byStatus)) totalByStatus[k] = (totalByStatus[k] || 0) + v;

  return (
    <div
      className="reakt-root"
      style={{
        minHeight: "100vh",
        background: S.bg,
        color: S.txt,
        fontFamily: '"Segoe UI",system-ui,-apple-system,sans-serif',
      }}
    >
      {/* Mobile (01.08.): Header umbricht, engere Paddings, Karten einspaltig */}
      <style>{`
      .reakt-root{padding-left:76px}
      .reakt-apps{display:none}
      @media(max-width:900px){.reakt-root{padding-left:0}.app-sidebar{display:none!important}.reakt-apps{display:inline-flex}}
      @media(max-width:640px){
        .reakt-head{flex-wrap:wrap!important;gap:8px!important;padding:8px 10px!important}
        .reakt-main{padding:14px 10px 48px!important}
      }`}</style>
      {/* Redesign 1b: Icon-Rail ersetzt den Grip-Switcher im Header. */}
      <AppRail
        current="reakt"
        canOpen={canOpen}
        profile={{ name: session.user?.email || "", role }}
        initials={(session.user?.email || "?").slice(0, 2).toUpperCase()}
        onLogout={() => supabase.auth.signOut()}
      />
      <header
        className="reakt-head"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 24px",
          background: "rgba(252,252,252,.72)",
          backdropFilter: "blur(20px) saturate(180%)",
          borderBottom: `1px solid ${S.line}`,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        {/* 2j: mobiler App-Einstieg (Rail ist <900px ausgeblendet) */}
        <a
          className="reakt-apps"
          href="/apps"
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            textDecoration: "none",
            background: S.appTint,
            color: S.app,
            fontSize: 12.5,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {"✦"} Apps
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: S.appTint,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
            }}
          >
            ✉️
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: S.app, lineHeight: 1.1 }}>
              Reaktivierung
            </div>
            <div style={{ fontSize: 10.5, color: S.mut }}>
              GEO-Beweis-Kampagnen · nur Entwürfe, nie Versand
            </div>
          </div>
        </div>
        <button
          onClick={() => void load()}
          style={{
            marginLeft: "auto",
            background: "none",
            border: `1px solid ${S.line}`,
            color: S.mut,
            borderRadius: 8,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Aktualisieren
        </button>
      </header>

      <main
        className="reakt-main"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "22px 18px 60px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {err && (
          <div
            style={{
              background: "rgba(248,113,113,.1)",
              border: `1px solid ${S.red}45`,
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13,
            }}
          >
            ⚠️ {err}
          </div>
        )}

        {/* Status-Karten */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            gap: 12,
          }}
        >
          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontWeight: 700,
              }}
            >
              Nacht-Zeitplan
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                margin: "6px 0",
                color: sched?.enabled ? S.app : S.warn,
              }}
            >
              {sched ? (sched.enabled ? `AKTIV · ${sched.time}` : `AUS · ${sched.time}`) : "—"}
            </div>
            <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 10 }}>
              {sched?.lastRunDate
                ? `letzter Lauf: ${sched.lastRunDate}`
                : "noch kein automatischer Lauf"}
            </div>
            {isOrgAdmin && sched && (
              <button
                onClick={toggleSchedule}
                disabled={busy}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: `1px solid ${sched.enabled ? S.red : S.app}`,
                  background: "transparent",
                  color: sched.enabled ? S.red : S.app,
                }}
              >
                {busy ? "…" : sched.enabled ? "Zeitplan deaktivieren" : "Scharf schalten (03:00)"}
              </button>
            )}
          </div>
          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontWeight: 700,
              }}
            >
              Ziel-Pool
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, margin: "6px 0" }}>
              {status?.targets ?? "—"} Leads
            </div>
            <div style={{ fontSize: 11.5, color: S.mut }}>
              {status?.noted ?? 0} manuell notierte Deals (Sperrliste)
            </div>
          </div>
          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontWeight: 700,
              }}
            >
              Bisher erzeugt
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, margin: "6px 0", color: S.app }}>
              {totalByStatus["ENTWURF"] || 0} Entwürfe
            </div>
            <div style={{ fontSize: 11.5, color: S.mut }}>
              {Object.entries(totalByStatus)
                .filter(([k]) => k.startsWith("skip"))
                .reduce((a, [, v]) => a + v, 0)}{" "}
              Skips ·{" "}
              {Object.entries(totalByStatus)
                .filter(([k]) => k.startsWith("FEHLER"))
                .reduce((a, [, v]) => a + v, 0)}{" "}
              Fehler
            </div>
          </div>
        </div>

        {/* Wellen */}
        <div
          style={{
            background: S.panel,
            border: `1px solid ${S.line}`,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Läufe / Wellen</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: S.mut, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Lauf</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Datum</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Gesichtet</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Entwürfe</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Skips</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Fehler</th>
                </tr>
              </thead>
              <tbody>
                {(status?.waves || []).map((w) => {
                  const skips = Object.entries(w.byStatus)
                    .filter(([k]) => k.startsWith("skip"))
                    .reduce((a, [, v]) => a + v, 0);
                  const fails = Object.entries(w.byStatus)
                    .filter(([k]) => k.startsWith("FEHLER"))
                    .reduce((a, [, v]) => a + v, 0);
                  return (
                    <tr key={w.file} style={{ borderTop: `1px solid ${S.line}` }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600 }}>{waveLabel(w.file)}</td>
                      <td style={{ padding: "7px 8px", color: S.mut }}>
                        {w.modified ? w.modified.slice(0, 10) : "—"}
                      </td>
                      <td style={{ padding: "7px 8px" }}>{w.rows}</td>
                      <td style={{ padding: "7px 8px", color: S.app, fontWeight: 600 }}>
                        {w.byStatus["ENTWURF"] || 0}
                      </td>
                      <td style={{ padding: "7px 8px" }}>{skips}</td>
                      <td style={{ padding: "7px 8px", color: fails ? S.red : S.mut }}>{fails}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Entwürfe */}
        <div
          style={{
            background: S.panel,
            border: `1px solid ${S.line}`,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Entwürfe</div>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              {(["ENTWURF", "alle"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 99,
                    fontSize: 11.5,
                    cursor: "pointer",
                    border: `1px solid ${filter === f ? S.app : S.line}`,
                    background: filter === f ? S.appTint : "transparent",
                    color: filter === f ? S.app : S.mut,
                  }}
                >
                  {f === "ENTWURF" ? "Nur Entwürfe" : "Alle Zeilen"}
                </button>
              ))}
            </div>
          </div>
          {drafts === null ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Lade…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Keine Zeilen.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: S.mut, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Firma</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Ort</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Empfänger-Name</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Absender-Alias</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}>Lauf</th>
                    <th style={{ padding: "6px 8px", fontWeight: 600 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.file}-${r.id}-${i}`} style={{ borderTop: `1px solid ${S.line}` }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600 }}>{r.org || "—"}</td>
                      <td style={{ padding: "7px 8px" }}>{r.ort || "—"}</td>
                      <td style={{ padding: "7px 8px" }}>
                        {r.name || <span style={{ color: S.mut }}>ohne Anrede</span>}
                      </td>
                      <td style={{ padding: "7px 8px", color: S.mut }}>{r.alias || "—"}</td>
                      <td
                        style={{
                          padding: "7px 8px",
                          color:
                            r.status === "ENTWURF"
                              ? S.app
                              : r.status.startsWith("FEHLER")
                                ? S.red
                                : S.mut,
                        }}
                      >
                        {r.status}
                      </td>
                      <td style={{ padding: "7px 8px", color: S.mut }}>{waveLabel(r.file)}</td>
                      <td style={{ padding: "7px 8px" }}>
                        {r.weblink ? (
                          <a
                            href={r.weblink}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: S.app,
                              fontSize: 12,
                              textDecoration: "none",
                              border: `1px solid ${S.app}55`,
                              borderRadius: 7,
                              padding: "3px 10px",
                            }}
                          >
                            In Outlook öffnen ↗
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: S.mut, margin: "12px 0 0" }}>
            Versand ausschließlich manuell aus Outlook heraus — diese Ansicht und die Maschine
            können keine E-Mails senden (Graph-App hat kein Mail.Send).
          </p>
        </div>
      </main>
    </div>
  );
}

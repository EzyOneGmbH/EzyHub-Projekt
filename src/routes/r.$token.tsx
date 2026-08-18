import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/r/$token")({
  component: PublicReport,
});

// Öffentlicher Read-only-Kunden-Report (Searchable-Nachbau, 2026-08-03).
// Kein Login: der signierte Token in der URL ist die Berechtigung. Zeigt nur
// aggregierte EzyAI-Ergebnisse (keine Antworttexte/Umsätze/Interna).
const S = {
  bg: "#f7f6f2",
  card: "#ffffff",
  line: "#e8e6df",
  txt: "#1c1c1e",
  mut: "#6e6c64",
  acc: "#6c5ce7",
  up: "#0f9d6c",
  down: "#dc2626",
  track: "#ecebe4",
};

type Rep = {
  ok: boolean;
  error?: string;
  client?: string;
  date?: string;
  score?: number;
  scoreDelta?: number;
  mentions?: number;
  citations?: number;
  citedPages?: number;
  models?: Array<{ name: string; mentions: number }>;
  topics?: Array<{ topic: string; vis: number; mentions: number }>;
  sources?: Array<{ domain: string; mentions: number; share: number }>;
  sov?: Array<{ brand: string; isSelf: boolean; share: number }>;
  history?: Array<{ d: string; score: number; mentions: number }>;
};

function PublicReport() {
  const { token } = Route.useParams();
  const [rep, setRep] = useState<Rep | null>(null);
  useEffect(() => {
    fetch(`/api/public/report?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setRep)
      .catch(() => setRep({ ok: false, error: "Report nicht erreichbar" }));
  }, [token]);

  if (!rep) return <Center>Lade Report…</Center>;
  if (!rep.ok) return <Center>⚠️ {rep.error || "Link ungültig"}</Center>;

  const hist = rep.history || [];
  const last12 = hist.slice(-12);
  const maxScore = Math.max(1, ...last12.map((h) => h.score || 0));
  return (
    <div
      style={{
        minHeight: "100vh",
        background: S.bg,
        color: S.txt,
        fontFamily: '"Segoe UI",system-ui,sans-serif',
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 20px 60px" }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: S.acc,
            fontWeight: 700,
          }}
        >
          KI-Sichtbarkeits-Report
        </div>
        <h1 style={{ margin: "4px 0 2px", fontSize: 26, letterSpacing: "-.02em" }}>{rep.client}</h1>
        <div style={{ fontSize: 12.5, color: S.mut }}>
          Stand {rep.date} · erstellt mit EzyHub / EzyAI
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: 12,
            marginTop: 22,
          }}
        >
          {[
            { l: "Sichtbarkeits-Score", v: rep.score, d: rep.scoreDelta },
            { l: "Erwähnungen", v: rep.mentions },
            { l: "Zitate (Citations)", v: rep.citations },
            { l: "Referenzierte Seiten", v: rep.citedPages },
          ].map((k) => (
            <div
              key={k.l}
              style={{
                background: S.card,
                border: `1px solid ${S.line}`,
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: S.mut,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                {k.l}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
                {k.v ?? "–"}
                {k.d != null && k.d !== 0 && (
                  <span style={{ fontSize: 13, marginLeft: 8, color: k.d > 0 ? S.up : S.down }}>
                    {k.d > 0 ? `+${k.d}` : k.d}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {last12.length > 1 && (
          <div
            style={{
              background: S.card,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
              marginTop: 14,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Score-Verlauf</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
              {last12.map((h) => (
                <div
                  key={h.d}
                  title={`${h.d}: ${h.score}`}
                  style={{
                    flex: 1,
                    background: S.acc,
                    opacity: 0.85,
                    borderRadius: "4px 4px 0 0",
                    height: `${Math.max(4, (h.score / maxScore) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: S.mut,
                marginTop: 4,
              }}
            >
              <span>{last12[0]?.d}</span>
              <span>{last12[last12.length - 1]?.d}</span>
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 14,
            marginTop: 14,
          }}
        >
          <div
            style={{
              background: S.card,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
              Erwähnungen je KI-System
            </div>
            {(rep.models || [])
              .sort((a, b) => b.mentions - a.mentions)
              .slice(0, 9)
              .map((m) => {
                const max = Math.max(1, ...(rep.models || []).map((x) => x.mentions));
                return (
                  <div
                    key={m.name}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
                  >
                    <span style={{ width: 110, fontSize: 12 }}>{m.name}</span>
                    <div style={{ flex: 1, height: 8, background: S.track, borderRadius: 99 }}>
                      <div
                        style={{
                          width: `${(m.mentions / max) * 100}%`,
                          height: "100%",
                          background: S.acc,
                          borderRadius: 99,
                        }}
                      />
                    </div>
                    <span style={{ width: 34, textAlign: "right", fontSize: 11.5, color: S.mut }}>
                      {m.mentions}
                    </span>
                  </div>
                );
              })}
          </div>
          {(rep.sov || []).length > 1 && (
            <div
              style={{
                background: S.card,
                border: `1px solid ${S.line}`,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Share of Voice</div>
              {(rep.sov || []).slice(0, 8).map((s) => (
                <div
                  key={s.brand}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
                >
                  <span
                    style={{
                      width: 140,
                      fontSize: 12,
                      fontWeight: s.isSelf ? 700 : 400,
                      color: s.isSelf ? S.acc : S.txt,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.brand}
                  </span>
                  <div style={{ flex: 1, height: 8, background: S.track, borderRadius: 99 }}>
                    <div
                      style={{
                        width: `${Math.min(100, s.share)}%`,
                        height: "100%",
                        background: s.isSelf ? S.acc : "#c9c6bc",
                        borderRadius: 99,
                      }}
                    />
                  </div>
                  <span style={{ width: 40, textAlign: "right", fontSize: 11.5, color: S.mut }}>
                    {s.share}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {(rep.topics || []).length > 0 && (
          <div
            style={{
              background: S.card,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              padding: 16,
              marginTop: 14,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Top-Themen</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: S.mut, textAlign: "left" }}>
                    <th style={{ padding: "5px 8px", fontWeight: 600 }}>Thema</th>
                    <th style={{ padding: "5px 8px", fontWeight: 600 }}>Sichtbarkeit</th>
                    <th style={{ padding: "5px 8px", fontWeight: 600 }}>Erwähnungen</th>
                  </tr>
                </thead>
                <tbody>
                  {(rep.topics || []).slice(0, 10).map((t) => (
                    <tr key={t.topic} style={{ borderTop: `1px solid ${S.line}` }}>
                      <td style={{ padding: "6px 8px" }}>{t.topic}</td>
                      <td style={{ padding: "6px 8px" }}>{t.vis}%</td>
                      <td style={{ padding: "6px 8px", color: S.mut }}>{t.mentions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p style={{ marginTop: 28, fontSize: 11, color: S.mut, textAlign: "center" }}>
          Vertraulicher Report für {rep.client} · Link läuft automatisch ab · EZY ONE GmbH
        </p>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: S.bg,
        color: S.mut,
        fontFamily: '"Segoe UI",system-ui,sans-serif',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

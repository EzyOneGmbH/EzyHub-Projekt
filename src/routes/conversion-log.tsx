import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { EzyOneLogo } from "@/components/ezy-one-mark";
import ConversionLog from "@/ezy/ConversionLog";

// Conversion-Log als eigene, schlanke Seite (15.10.2026, Volkan). Für Logins
// mit login_ansicht "conversion_log" (z. B. Studioforma-Mitarbeitende) ist das
// die EINZIGE Seite (AnsichtsGuard in __root). Der Kunde ergibt sich aus
// client_access (RLS) — bei mehreren Kunden erscheint eine Auswahl.
export const Route = createFileRoute("/conversion-log")({
  component: ConversionLogSeite,
});

function ConversionLogSeite() {
  const navigate = useNavigate();
  const { session, loading, user, signOut } = useAuth();
  const { clients, loading: kundenLaedt } = useEzyClients();
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session)
      navigate({ to: "/login", search: { next: "/conversion-log" }, replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!clientId && clients.length) setClientId(clients[0].id);
  }, [clients, clientId]);

  if (loading || !session) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FCFCFC",
        fontFamily: "Poppins, system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 20px",
          borderBottom: "1px solid rgba(43,0,51,.08)",
          background: "#fff",
          flexWrap: "wrap",
        }}
      >
        <EzyOneLogo height={30} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
          {clients.length > 1 && (
            <select
              value={clientId ?? ""}
              onChange={(e) => setClientId(e.target.value)}
              style={{
                fontSize: 12.5,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(43,0,51,.12)",
              }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {clients.length === 1 && <strong style={{ color: "#0D0D0D" }}>{clients[0].name}</strong>}
          <span style={{ color: "#8b8092" }}>{user?.email}</span>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              window.location.replace("/login");
            }}
            style={{
              fontSize: 12.5,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid rgba(43,0,51,.16)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Abmelden
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>
        {kundenLaedt && !clients.length ? null : clientId ? (
          <ConversionLog clientId={clientId} />
        ) : (
          <div style={{ fontSize: 13.5, color: "#5d5563" }}>
            Diesem Login ist noch kein Kunde zugeordnet. Bitte bei Ezy One melden.
          </div>
        )}
      </main>
    </div>
  );
}

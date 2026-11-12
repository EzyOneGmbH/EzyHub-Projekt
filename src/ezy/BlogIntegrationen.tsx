import { useEffect, useState, type ReactNode } from "react";
import { Block, HAARLINIE, Hinweis, Knopf, P, api, verweisStil, zeitText } from "@/ezy/BlogUi";

// Blog-Tab «Integrationen»: was mit dem Blog verbunden ist. Geändert werden
// die Verbindungen in der Einrichtung.

type Ton = "gruen" | "orange" | "grau";
const TON: Record<Ton, { farbe: string; grund: string }> = {
  gruen: { farbe: "#00704a", grund: P.greenDim },
  orange: { farbe: P.orange, grund: P.orangeDim },
  grau: { farbe: P.muted, grund: "rgba(43,0,51,.06)" },
};
const WP_STATUS: Record<string, { text: string; ton: Ton }> = {
  verbunden: { text: "Verbunden", ton: "gruen" },
  aktion_noetig: { text: "Aktion nötig", ton: "orange" },
  test_laeuft: { text: "Test läuft", ton: "grau" },
  nicht_verbunden: { text: "Nicht verbunden", ton: "grau" },
};

function Marke({ text, ton }: { text: string; ton: Ton }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12.5,
        fontWeight: 700,
        color: TON[ton].farbe,
        background: TON[ton].grund,
        borderRadius: 99,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Zeile({
  name,
  zweck,
  ziel,
  marke,
  zusatz,
  aktion,
  erste,
}: {
  name: string;
  zweck: string;
  ziel: string | null;
  marke: ReactNode;
  zusatz?: string | null;
  aktion?: ReactNode;
  erste?: boolean;
}) {
  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 20px",
        padding: "14px 0",
        borderTop: erste ? "none" : `1px solid ${HAARLINIE}`,
      }}
    >
      <div style={{ minWidth: 220, flex: "1 1 320px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{name}</span>
          {marke}
        </div>
        <div style={{ fontSize: 13.5, color: P.muted, marginTop: 3 }}>{zweck}</div>
        {ziel && (
          <div style={{ fontSize: 13.5, color: P.text, marginTop: 3, overflowWrap: "anywhere" }}>
            {ziel}
          </div>
        )}
        {zusatz && <div style={{ fontSize: 12.5, color: P.dim, marginTop: 3 }}>{zusatz}</div>}
      </div>
      {aktion && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {aktion}
        </div>
      )}
    </li>
  );
}

/** a >= b bei Versionen wie «2.1.0». */
function abVersion(a: string, b: string): boolean {
  const za = a.split(".").map((n) => parseInt(n, 10) || 0);
  const zb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((za[i] ?? 0) !== (zb[i] ?? 0)) return (za[i] ?? 0) > (zb[i] ?? 0);
  }
  return true;
}

export default function BlogIntegrationen({
  projekt,
  agentur,
  clientId,
  onProjekt,
}: {
  projekt: any;
  agentur: boolean;
  clientId: string;
  onProjekt: (neu: any) => void;
}) {
  const projektId: string = projekt.id;
  const [google, setGoogle] = useState<any>(undefined);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<{ ton: "fehler" | "ok"; text: string } | null>(null);

  useEffect(() => {
    let aktiv = true;
    setGoogle(undefined);
    void api(`/api/blog/projects/${projektId}/google`).then((r) => {
      if (aktiv) setGoogle(r.ok && r.json?.ok ? r.json.google : null);
    });
    return () => {
      aktiv = false;
    };
  }, [projektId]);

  const wp = projekt.wordpress ?? { status: "nicht_verbunden" };
  const wpStatus = WP_STATUS[wp.status] ?? WP_STATUS.nicht_verbunden;
  const nurHub = projekt.publish_mode === "hub_only";
  const aendern = (
    <a href={`/ezyrank/blog/einrichtung/6?client=${clientId}`} style={verweisStil}>
      Ändern
    </a>
  );

  const teste = async () => {
    setBusy(true);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/wp/test`, "POST");
    setBusy(false);
    if (r.json?.wordpress) onProjekt({ wordpress: { ...wp, ...r.json.wordpress } });
    if (r.ok && r.json?.ok) setMeldung({ ton: "ok", text: "Die Verbindung zu WordPress steht." });
    else
      setMeldung({
        ton: "fehler",
        text: r.json?.error || "WordPress antwortet nicht wie erwartet. Bitte Verbindung prüfen.",
      });
  };

  const googleMarke = (property: string | null | undefined) =>
    google === undefined ? (
      <Marke text="Wird geprüft…" ton="grau" />
    ) : property && google?.verbunden ? (
      <Marke text="Verbunden" ton="gruen" />
    ) : (
      <Marke text="Nicht verbunden" ton="grau" />
    );

  return (
    <Block titel="Integrationen">
      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Zeile
          erste
          name="WordPress"
          zweck={
            nurHub
              ? "Artikel bleiben im Hub und werden nicht an WordPress gesendet."
              : "Fertige Artikel landen als Entwurf in deiner Website."
          }
          ziel={wp.site_url ?? null}
          marke={<Marke text={wpStatus.text} ton={wpStatus.ton} />}
          zusatz={[
            wp.last_checked_at ? `Zuletzt geprüft: ${zeitText(wp.last_checked_at)}` : null,
            agentur && wp.plugin_version ? `Plugin ${wp.plugin_version}` : null,
            agentur && wp.site_url && !nurHub
              ? Array.isArray(wp.scopes) && wp.scopes.includes("publish")
                ? "Live stellen: aktiv"
                : "Live stellen: im Plugin nicht erlaubt"
              : null,
            agentur && wp.plugin_version && !abVersion(wp.plugin_version, "2.1.0")
              ? "Für Überarbeitungen und IndexNow: Plugin 2.1.0 nötig"
              : null,
            agentur && wp.status === "aktion_noetig" && wp.last_error_code
              ? `Fehler: ${wp.last_error_code}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          aktion={
            <>
              {agentur && wp.site_url && (
                <Knopf art="sekundaer" onClick={() => void teste()} disabled={busy}>
                  {busy ? "Wird getestet…" : "Verbindung testen"}
                </Knopf>
              )}
              {aendern}
            </>
          }
        />
        <Zeile
          name="Google Search Console"
          zweck="Zeigt, über welche Suchanfragen Besucher kommen."
          ziel={google?.gsc?.property ?? null}
          marke={googleMarke(google?.gsc?.property)}
          aktion={aendern}
        />
        <Zeile
          name="Google Analytics"
          zweck="Zeigt, was Besucher auf der Website tun."
          ziel={google?.ga4?.property ?? null}
          marke={googleMarke(google?.ga4?.property)}
          aktion={aendern}
        />
      </ul>
    </Block>
  );
}

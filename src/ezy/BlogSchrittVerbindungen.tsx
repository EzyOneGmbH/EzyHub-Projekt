// Blog-Autopilot Onboarding Schritt 6 · Verbindungen (Kap. 6A): WordPress
// (Pflicht, ausser «nur in EzyHub»), Search Console (empfohlen), GA4
// (empfohlen, «später verbinden» möglich).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, Feld, Fuss, Hinweis, Karte, Knopf, P, Titel, eingabe, type Ctx } from "@/ezy/BlogUi";

type Status = "verbunden" | "offen" | "optional";

function Badge({ status }: { status: Status }) {
  const f = {
    verbunden: [P.greenDim, P.green, "Verbunden"],
    offen: [P.orangeDim, P.orange, "Noch offen"],
    optional: ["rgba(43,0,51,.06)", P.muted, "Optional"],
  }[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 99,
        background: f[0],
        color: f[1],
        fontSize: 12.5,
        fontWeight: 700,
      }}
    >
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: f[1] }} />
      {f[2]}
    </span>
  );
}

function Kopf({
  titel,
  status,
  children,
}: {
  titel: string;
  status: Status;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 17 }}>{titel}</h2>
        {children && <div style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>{children}</div>}
      </div>
      <Badge status={status} />
    </div>
  );
}

export function BlogSchrittVerbindungen({ c }: { c: Ctx }) {
  const wp = c.project.wordpress ?? { status: "nicht_verbunden" };
  const wpOk = wp.status === "verbunden";
  const hubOnly = c.project.publish_mode === "hub_only";
  const [google, setGoogle] = useState<any | null>(null);
  const [gFehler, setGFehler] = useState<string | null>(null);
  const [ga4Spaeter, setGa4Spaeter] = useState(false);

  const ladeGoogle = useCallback(async () => {
    const r = await api(`/api/blog/projects/${c.project.id}/google`);
    if (r.ok) setGoogle(r.json.google);
    else setGFehler(r.json?.error || "Google-Stand konnte nicht geladen werden");
  }, [c.project.id]);
  useEffect(() => void ladeGoogle(), [ladeGoogle]);

  const setzeGoogle = async (body: Record<string, string>) => {
    setGFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/google`, "POST", body);
    if (!r.ok) return setGFehler(r.json?.error || "Speichern fehlgeschlagen");
    setGoogle(r.json.google);
  };

  const weiterOk = wpOk || hubOnly;
  const ga4Ok = !!google?.ga4?.property && !!c.project.ga4_stream_id;

  const weiter = async () => {
    if (!ga4Ok && ga4Spaeter)
      void api(`/api/blog/projects/${c.project.id}/events`, "POST", {
        type: "onboarding.ga4_skipped",
        payload: { step: 6 },
      });
    await c.weiter(6);
  };

  return (
    <>
      <Titel a="Verbindungen." b="Damit Entwürfe ankommen und wir messen können." />
      <WordPressKarte c={c} />
      <Karte style={{ marginTop: 16 }}>
        <Kopf titel="Google Search Console" status={google?.gsc?.property ? "verbunden" : "offen"}>
          Empfohlen. Ohne Search Console findet der KI-Audit keine Themen, die fast vorne sind.
        </Kopf>
        {google === null ? (
          <span style={{ color: P.dim, fontSize: 13 }}>Prüft die Google-Verbindung…</span>
        ) : !google.verbunden ? (
          <Hinweis>
            Google ist für diesen Kunden noch nicht verbunden. Ezy One richtet das für dich ein.
          </Hinweis>
        ) : google.gsc.property ? (
          <div style={{ fontSize: 14 }}>
            Zugeordnet: <strong>{google.gsc.property}</strong>
          </div>
        ) : google.gsc.kandidaten.length === 0 ? (
          <Hinweis>
            Keine Search-Console-Property für {c.project.domain} gefunden. Ezy One prüft die
            Freigabe.
          </Hinweis>
        ) : (
          <Feld label="Property wählen" id="gsc">
            <select
              id="gsc"
              defaultValue=""
              onChange={(e) => e.target.value && void setzeGoogle({ gsc_property: e.target.value })}
              style={eingabe}
            >
              <option value="">Bitte wählen…</option>
              {google.gsc.kandidaten.map((k: string) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Feld>
        )}
      </Karte>
      <Karte style={{ marginTop: 16 }}>
        <Kopf
          titel="Google Analytics 4"
          status={ga4Ok ? "verbunden" : ga4Spaeter ? "optional" : "offen"}
        >
          Empfohlen. Ohne GA4 fehlen Sitzungen im EzyRank-Dashboard, Conversions pro Artikel und der
          Vergleich zur Vorperiode.
        </Kopf>
        {google === null ? null : !google.verbunden ? null : google.ga4.kandidaten.length === 0 ? (
          <Hinweis>
            Keine GA4-Property mit einem Datenstream für {c.project.domain} gefunden.
          </Hinweis>
        ) : (
          <Ga4Wahl
            google={google}
            streamId={c.project.ga4_stream_id}
            onSetze={async (b) => {
              await setzeGoogle(b);
              await c.neuLaden();
            }}
          />
        )}
        {!ga4Ok && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              minHeight: 44,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={ga4Spaeter}
              onChange={(e) => setGa4Spaeter(e.target.checked)}
              style={{ width: 20, height: 20, accentColor: P.accent }}
            />
            GA4 später verbinden
          </label>
        )}
        {gFehler && <Hinweis ton="fehler">{gFehler}</Hinweis>}
      </Karte>
      {!weiterOk && (
        <div style={{ marginTop: 16 }}>
          <Hinweis>
            Weiter geht es, sobald WordPress verbunden ist. Ohne WordPress kannst du Artikel auch
            nur in EzyHub erstellen.
          </Hinweis>
        </div>
      )}
      {c.fehler && (
        <div style={{ marginTop: 12 }}>
          <Hinweis ton="fehler">{c.fehler}</Hinweis>
        </div>
      )}
      <Fuss
        zurueck={() => c.gehe(5)}
        weiter={() => void weiter()}
        weiterAus={!weiterOk}
        busy={c.busy}
      />
    </>
  );
}

function Ga4Wahl({
  google,
  streamId,
  onSetze,
}: {
  google: any;
  streamId: string | null;
  onSetze: (b: Record<string, string>) => Promise<void>;
}) {
  const [prop, setProp] = useState<string>(
    google.ga4.property ?? (google.ga4.kandidaten.length === 1 ? google.ga4.kandidaten[0].id : ""),
  );
  const kandidat = google.ga4.kandidaten.find((k: any) => k.id === prop);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {google.ga4.fest ? (
        <div style={{ fontSize: 14 }}>
          Property: <strong>{google.ga4.property}</strong>
        </div>
      ) : (
        <Feld label="Property" id="ga4p">
          <select id="ga4p" value={prop} onChange={(e) => setProp(e.target.value)} style={eingabe}>
            <option value="">Bitte wählen…</option>
            {google.ga4.kandidaten.map((k: any) => (
              <option key={k.id} value={k.id}>
                {k.name ? `${k.name} (${k.id})` : k.id}
              </option>
            ))}
          </select>
        </Feld>
      )}
      {kandidat && (
        <Feld label="Datenstream" id="ga4s">
          <select
            id="ga4s"
            value={streamId ?? ""}
            onChange={(e) =>
              e.target.value &&
              void onSetze({
                ...(google.ga4.fest ? {} : { ga4_property: prop }),
                ga4_stream_id: e.target.value,
              })
            }
            style={eingabe}
          >
            <option value="">Bitte wählen…</option>
            {kandidat.streams.map((s: any) => (
              <option
                key={s.id}
                value={s.id}
              >{`${s.name} · ${s.url ?? ""}${s.measurementId ? ` · ${s.measurementId}` : ""}`}</option>
            ))}
          </select>
        </Feld>
      )}
    </div>
  );
}

function WordPressKarte({ c }: { c: Ctx }) {
  const wp = c.project.wordpress ?? { status: "nicht_verbunden" };
  const [site, setSite] = useState<string>(wp.site_url || `https://${c.project.domain}`);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ersetzen, setErsetzen] = useState(false);
  const ok = wp.status === "verbunden";
  const felder = !ok || ersetzen;
  const hubOnly = c.project.publish_mode === "hub_only";
  const keyOk = /^ezr_[a-f0-9]{44}$/.test(key.trim());

  const verbinden = async () => {
    setBusy(true);
    setFehler(null);
    setTest(null);
    const r = await api(`/api/blog/projects/${c.project.id}/wp/connect`, "POST", {
      siteUrl: site.trim(),
      key: key.trim(),
    });
    setBusy(false);
    setTest(r.json?.test ?? null);
    if (!r.ok && !r.json?.test) setFehler(r.json?.error || "Verbindung fehlgeschlagen");
    if (r.json?.gespeichert) {
      setKey("");
      setErsetzen(false);
    }
    await c.neuLaden();
  };
  const erneutTesten = async () => {
    setBusy(true);
    setFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/wp/test`, "POST");
    setBusy(false);
    setTest(r.json?.test ?? null);
    if (!r.ok && !r.json?.test) setFehler(r.json?.error || "Test fehlgeschlagen");
    await c.neuLaden();
  };
  const modus = async (m: "wp_draft" | "hub_only") => {
    const r = await api(`/api/blog/projects/${c.project.id}`, "PATCH", { publish_mode: m });
    if (r.ok) c.setProject(r.json.project);
  };

  return (
    <Karte>
      <Kopf titel="WordPress" status={ok ? "verbunden" : hubOnly ? "optional" : "offen"}>
        {ok
          ? `${wp.site_url} · Plugin ${wp.plugin_version ?? ""} · Rechte: ${(wp.scopes ?? []).join(", ")}`
          : "Entwürfe landen direkt in deinem WordPress. Live geht nur, was du freigibst."}
      </Kopf>
      {!ok && !hubOnly && (
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            display: "grid",
            gap: 6,
            fontSize: 14,
            color: P.text,
          }}
        >
          <li>
            <a
              href="/downloads/ezyhub-connector.zip"
              download
              style={{ color: P.accent, fontWeight: 700 }}
            >
              Plugin «EzyHub Connector» herunterladen
            </a>{" "}
            und in WordPress unter Plugins › Installieren › Plugin hochladen installieren.
          </li>
          <li>Plugin aktivieren.</li>
          <li>
            Unter Einstellungen › EzyRank auf «Verbindungsschlüssel erzeugen» klicken und den
            Schlüssel hier einfügen.
          </li>
        </ol>
      )}
      {!hubOnly && (
        <div style={{ display: "grid", gap: 12 }}>
          {felder && (
            <>
              <Feld label="Website-Adresse (WordPress)" id="wpsite">
                <input
                  id="wpsite"
                  inputMode="url"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  style={eingabe}
                />
              </Feld>
              <Feld
                label="Verbindungsschlüssel"
                id="wpkey"
                hilfe="Beginnt mit ezr_. Wird nur verschlüsselt gespeichert."
              >
                <input
                  id="wpkey"
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="ezr_…"
                  style={{
                    ...eingabe,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                />
              </Feld>
            </>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {felder && (
              <Knopf
                onClick={() => void verbinden()}
                disabled={busy || !keyOk || !/^https:\/\//i.test(site.trim())}
              >
                {busy ? "Testet…" : "Verbindung testen"}
              </Knopf>
            )}
            {wp.status !== "nicht_verbunden" && !ersetzen && (
              <Knopf art="sekundaer" onClick={() => void erneutTesten()} disabled={busy}>
                {busy ? "Testet…" : "Erneut testen"}
              </Knopf>
            )}
            {ok && (
              <Knopf art="text" onClick={() => setErsetzen(!ersetzen)}>
                {ersetzen ? "Abbrechen" : "Neuen Schlüssel eintragen"}
              </Knopf>
            )}
          </div>
        </div>
      )}
      {test && <TestErgebnis t={test} />}
      {fehler && <Hinweis ton="fehler">{fehler}</Hinweis>}
      {!ok && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            minHeight: 44,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={hubOnly}
            onChange={(e) => void modus(e.target.checked ? "hub_only" : "wp_draft")}
            style={{ width: 20, height: 20, accentColor: P.accent }}
          />
          Ohne WordPress: Artikel nur in EzyHub erstellen
        </label>
      )}
    </Karte>
  );
}

const SCHRITT_LABEL: Record<string, string> = {
  health: "Plugin erreichbar",
  capabilities: "Rechte gelesen",
  test: "Testentwurf angelegt und gelöscht",
};

function TestErgebnis({ t }: { t: any }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 4,
          fontSize: 13.5,
        }}
      >
        {(t.schritte ?? []).map((s: any) => (
          <li key={s.schritt} style={{ color: s.ok ? P.green : P.red }}>
            {s.ok ? "✓" : "✗"} {SCHRITT_LABEL[s.schritt] ?? s.schritt}{" "}
            <span style={{ color: P.dim }}>({s.ms} ms)</span>
          </li>
        ))}
      </ul>
      {t.ok ? (
        <Hinweis ton="ok">
          Verbunden in {(t.dauer_ms / 1000).toFixed(1)} s. Plugin {t.plugin_version}.
        </Hinweis>
      ) : (
        <Hinweis ton="fehler">
          {t.hilfe || t.message || "Die Verbindung hat nicht geklappt."}
        </Hinweis>
      )}
    </div>
  );
}

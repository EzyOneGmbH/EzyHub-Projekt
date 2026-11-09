// Blog-Autopilot Onboarding Schritt 7 (Themenplan, KI-Audit) und Schritt 8
// (Start). Kein Artikel vor der Themenplan-Freigabe (Kap. 6A).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Fuss, Hinweis, Karte, Knopf, P, Titel, eingabe, type Ctx } from "@/ezy/BlogUi";

const KATEGORIE: Record<string, { label: string; farbe: string; hinter: string }> = {
  fast_vorne: { label: "Fast vorne", farbe: P.green, hinter: P.greenDim },
  neu: { label: "Neues Thema", farbe: P.accent, hinter: P.accentDim },
  abgedeckt: { label: "Schon abgedeckt", farbe: P.orange, hinter: P.orangeDim },
  aussortiert: { label: "Aussortiert", farbe: P.dim, hinter: "rgba(43,0,51,.05)" },
};
const REIHE = ["fast_vorne", "neu", "abgedeckt", "aussortiert"];
const zahl = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("de-CH"));

export function BlogSchrittThemenplan({ c }: { c: Ctx }) {
  const [daten, setDaten] = useState<any | null>(null);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [eigenes, setEigenes] = useState("");
  const [pruefe, setPruefe] = useState(false);
  const [busy, setBusy] = useState(false);
  const gestartet = useRef(false);
  const vorausgewaehlt = useRef(false);

  const lade = useCallback(async () => {
    const r = await api(`/api/blog/projects/${c.project.id}/opportunities`);
    if (!r.ok) return c.setFehler(r.json?.error || "Laden fehlgeschlagen");
    setDaten(r.json);
    return r.json;
  }, [c]);

  const starteAudit = useCallback(async () => {
    c.setFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/audit`, "POST", {
      trigger: "onboarding",
    });
    if (!r.ok) c.setFehler(r.json?.error || "Audit konnte nicht gestartet werden");
    await lade();
  }, [c, lade]);

  useEffect(() => {
    void lade().then((j) => {
      if (j && !j.audit && !gestartet.current) {
        gestartet.current = true;
        void starteAudit();
      }
    });
  }, [lade, starteAudit]);

  const laeuft = daten?.audit && ["queued", "running"].includes(daten.audit.status);
  useEffect(() => {
    if (!laeuft) return;
    const t = setInterval(() => void lade(), 3000);
    return () => clearInterval(t);
  }, [laeuft, lade]);

  // «neu» vorausgewählt (einmal, sobald Ergebnisse da sind)
  useEffect(() => {
    if (vorausgewaehlt.current || !daten?.opportunities?.length) return;
    vorausgewaehlt.current = true;
    setAuswahl(
      new Set(daten.opportunities.filter((o: any) => o.category === "neu").map((o: any) => o.id)),
    );
  }, [daten?.opportunities]);

  const opps: any[] = daten?.opportunities ?? [];
  const gruppen = useMemo(
    () =>
      REIHE.map((k) => ({ k, liste: opps.filter((o) => o.category === k) })).filter(
        (g) => g.liste.length,
      ),
    [opps],
  );
  const toggle = (id: string) => {
    const n = new Set(auswahl);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setAuswahl(n);
  };

  const pruefeEigenes = async () => {
    if (eigenes.trim().length < 2) return;
    setPruefe(true);
    c.setFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/opportunities/check`, "POST", {
      keyword: eigenes.trim(),
    });
    setPruefe(false);
    if (!r.ok) return c.setFehler(r.json?.error || "Prüfung fehlgeschlagen");
    setEigenes("");
    await lade();
    if (r.json.opportunity?.category !== "aussortiert")
      setAuswahl(new Set([...auswahl, r.json.opportunity.id]));
  };

  const freigeben = async () => {
    setBusy(true);
    c.setFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/topics/approve`, "POST", {
      opportunityIds: [...auswahl],
    });
    setBusy(false);
    if (!r.ok) return c.setFehler(r.json?.error || "Freigabe fehlgeschlagen");
    await c.weiter(7);
  };

  const quellen = daten?.ergebnisAudit?.sources;
  const quellText = [
    quellen?.gsc_status === "ok" ? "Search Console" : null,
    `Ahrefs (${String(c.project.market || "CH")})`,
    `${daten?.publizierteArtikel ?? 0} publizierte Artikel`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <Titel a="Dein Themenplan." b="Geprüft, bevor wir schreiben." />
      {daten === null ? (
        <div style={{ color: P.dim, fontSize: 14 }}>Lädt…</div>
      ) : laeuft || (!daten.ergebnisAudit && daten.audit?.status !== "failed") ? (
        <Karte>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>KI-Audit läuft</h2>
            <span style={{ fontSize: 13, color: P.muted }}>{daten.audit?.percent ?? 0}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: "rgba(43,0,51,.06)" }} aria-hidden>
            <div
              style={{
                height: 6,
                borderRadius: 99,
                width: `${Math.max(3, daten.audit?.percent ?? 0)}%`,
                background: P.grad,
                transition: "width .6s ease",
              }}
            />
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 6,
              fontSize: 13.5,
            }}
            aria-live="polite"
          >
            {(daten.audit?.events ?? []).map((e: any) => (
              <li key={e.key}>
                <span style={{ color: P.green }}>✓</span> <strong>{e.label}</strong>{" "}
                <span style={{ color: P.muted }}>{e.detail}</span>
              </li>
            ))}
          </ul>
          <Hinweis>
            Wir prüfen Search Console, Ahrefs und deine publizierten Artikel. Das dauert wenige
            Minuten.
          </Hinweis>
        </Karte>
      ) : (
        <>
          {daten.audit?.status === "failed" && (
            <Karte style={{ marginBottom: 16 }}>
              <Hinweis ton="fehler">
                Der KI-Audit ist fehlgeschlagen: {daten.audit.error || "unbekannter Grund"}
              </Hinweis>
              <div>
                <Knopf onClick={() => void starteAudit()}>Audit neu starten</Knopf>
              </div>
            </Karte>
          )}
          {daten.ergebnisAudit && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    padding: "6px 12px",
                    borderRadius: 99,
                    background: "#fff",
                    boxShadow: P.shadow,
                    fontSize: 13,
                  }}
                >
                  KI-Audit · {quellText}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <Kennzahl
                  wert={opps.filter((o) => o.category === "fast_vorne").length}
                  label="fast vorne"
                />
                <Kennzahl
                  wert={opps.filter((o) => o.category === "neu").length}
                  label="neue Themen"
                />
              </div>
              {gruppen.length === 0 && (
                <Hinweis>Keine Chancen gefunden. Ergänze eigene Themen unten.</Hinweis>
              )}
              {gruppen.map((g) => (
                <section key={g.k} style={{ marginBottom: 18 }}>
                  <h2
                    style={{
                      fontSize: 14,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      color: P.muted,
                      margin: "0 0 8px",
                    }}
                  >
                    {KATEGORIE[g.k].label} · {g.liste.length}
                  </h2>
                  <div style={{ display: "grid", gap: 10 }}>
                    {g.liste.map((o) => (
                      <ChanceKarte
                        key={o.id}
                        o={o}
                        gewaehlt={auswahl.has(o.id)}
                        onToggle={() => toggle(o.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <Karte>
                <h2 style={{ margin: 0, fontSize: 15 }}>+ Eigenes Thema prüfen lassen</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    aria-label="Eigenes Thema"
                    placeholder="z. B. brunnen bauen afrika"
                    value={eigenes}
                    onChange={(e) => setEigenes(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void pruefeEigenes()}
                    style={eingabe}
                  />
                  <Knopf art="sekundaer" onClick={() => void pruefeEigenes()} disabled={pruefe}>
                    {pruefe ? "Prüft…" : "Prüfen"}
                  </Knopf>
                </div>
              </Karte>
            </>
          )}
        </>
      )}
      {c.fehler && (
        <div style={{ marginTop: 12 }}>
          <Hinweis ton="fehler">{c.fehler}</Hinweis>
        </div>
      )}
      <Fuss
        zurueck={() => c.gehe(6)}
        weiter={() => void freigeben()}
        weiterText={`${auswahl.size} ${auswahl.size === 1 ? "Thema" : "Themen"} freigeben`}
        weiterAus={!!laeuft || auswahl.size === 0}
        busy={busy}
      />
    </>
  );
}

function Kennzahl({ wert, label }: { wert: number; label: string }) {
  return (
    <div
      style={{ background: "#fff", borderRadius: 16, boxShadow: P.shadow, padding: "14px 16px" }}
    >
      <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {wert}
      </div>
      <div style={{ fontSize: 13, color: P.muted }}>{label}</div>
    </div>
  );
}

function ChanceKarte({
  o,
  gewaehlt,
  onToggle,
}: {
  o: any;
  gewaehlt: boolean;
  onToggle: () => void;
}) {
  const k = KATEGORIE[o.category];
  const aus = o.category === "aussortiert";
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr",
        gap: 12,
        background: "#fff",
        borderRadius: 14,
        padding: 14,
        boxShadow: P.shadow,
        border: `1.5px solid ${gewaehlt ? P.accent : "transparent"}`,
        cursor: aus ? "default" : "pointer",
        opacity: aus ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={gewaehlt}
        disabled={aus}
        onChange={onToggle}
        style={{ width: 20, height: 20, marginTop: 2, accentColor: P.accent }}
      />
      <span style={{ display: "grid", gap: 6 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15, textDecoration: aus ? "line-through" : undefined }}>
            {o.keyword}
          </strong>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 99,
              color: k.farbe,
              background: k.hinter,
            }}
          >
            {k.label}
          </span>
          {o.cluster && <span style={{ fontSize: 12, color: P.dim }}>{o.cluster}</span>}
        </span>
        <span
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            fontSize: 12.5,
            color: P.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>Volumen {zahl(o.volume)}</span>
          <span>KD {zahl(o.difficulty)}</span>
          {o.avg_position != null && (
            <span>Position {Number(o.avg_position).toLocaleString("de-CH")}</span>
          )}
          {o.impressions != null && <span>{zahl(o.impressions)} Impressionen</span>}
          {o.parent_topic && <span>Hauptthema: {o.parent_topic}</span>}
        </span>
        <span style={{ fontSize: 13.5 }}>{o.reason}</span>
        {o.covered_by_url && (
          <a
            href={o.covered_by_url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12.5, color: P.accent, wordBreak: "break-all" }}
          >
            {o.covered_by_url}
          </a>
        )}
      </span>
    </label>
  );
}

// ── Schritt 8 · Start ─────────────────────────────────────────────────────

export function BlogSchrittStart({ c }: { c: Ctx }) {
  const [themen, setThemen] = useState<any[] | null>(null);
  const [google, setGoogle] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api(`/api/blog/projects/${c.project.id}/topics`).then((r) =>
      setThemen(r.json?.topics ?? []),
    );
    void api(`/api/blog/projects/${c.project.id}/google`).then((r) =>
      setGoogle(r.json?.google ?? null),
    );
  }, [c.project.id]);

  const erster = themen?.find((t) => t.scheduled_for);
  const zeit = String(c.project.publish_time || "09:00").slice(0, 5);
  const datum = erster
    ? new Date(`${erster.scheduled_for}T12:00:00`).toLocaleDateString("de-CH", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;

  const start = async () => {
    setBusy(true);
    c.setFehler(null);
    const r = await api(`/api/blog/projects/${c.project.id}/start`, "POST");
    setBusy(false);
    if (!r.ok) return c.setFehler(r.json?.error || "Start fehlgeschlagen");
    window.location.href = `/ezyrank?tab=blog`;
  };

  const wp = c.project.wordpress?.status === "verbunden";
  return (
    <>
      <Titel
        a="Alles bereit."
        b={datum ? `Dein erster Entwurf kommt am ${datum}, ${zeit} Uhr.` : "Dein Themenplan steht."}
      />
      <Karte>
        <Zeile label="Freigegebene Themen" wert={themen === null ? "…" : String(themen.length)} />
        <Zeile label="Erster Termin" wert={datum ? `${datum}, ${zeit} Uhr` : "–"} />
        <Zeile label="Kontingent" wert={`${c.project.articles_per_month ?? 4} Artikel pro Monat`} />
        <Zeile
          label="Veröffentlichen"
          wert={
            c.project.publish_mode === "hub_only"
              ? "Nur in EzyHub"
              : "Als Entwurf in WordPress, live nur nach Freigabe"
          }
        />
        <Zeile
          label="WordPress"
          wert={
            wp ? "Verbunden" : c.project.publish_mode === "hub_only" ? "Nicht nötig" : "Noch offen"
          }
          ok={wp}
        />
        <Zeile
          label="Search Console"
          wert={google?.gsc?.property ? "Verbunden" : "Noch offen"}
          ok={!!google?.gsc?.property}
        />
        <Zeile
          label="Google Analytics 4"
          wert={google?.ga4?.property && c.project.ga4_stream_id ? "Verbunden" : "Später verbinden"}
          ok={!!(google?.ga4?.property && c.project.ga4_stream_id)}
        />
      </Karte>
      <div style={{ marginTop: 16 }}>
        <Hinweis>
          Die Schreib-Pipeline mit Faktencheck folgt als Nächstes. Bis dahin plant der Autopilot
          deine Themen und prüft jeden Montag neue Chancen.
        </Hinweis>
      </div>
      {c.fehler && (
        <div style={{ marginTop: 12 }}>
          <Hinweis ton="fehler">{c.fehler}</Hinweis>
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 28,
          flexWrap: "wrap",
        }}
      >
        <Knopf art="text" onClick={() => c.gehe(7)}>
          ← Zurück
        </Knopf>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Knopf art="sekundaer" disabled>
            Ersten Artikel jetzt schreiben (bald)
          </Knopf>
          <Knopf onClick={() => void start()} disabled={busy}>
            {busy ? "Startet…" : c.project.status === "active" ? "Zum Blog" : "Autopilot starten"}
          </Knopf>
        </div>
      </div>
    </>
  );
}

function Zeile({ label, wert, ok }: { label: string; wert: string; ok?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 14,
        borderBottom: `1px solid ${P.border}`,
        paddingBottom: 10,
      }}
    >
      <span style={{ color: P.muted }}>{label}</span>
      <span
        style={{ fontWeight: 700, textAlign: "right", color: ok === false ? P.orange : P.text }}
      >
        {wert}
      </span>
    </div>
  );
}

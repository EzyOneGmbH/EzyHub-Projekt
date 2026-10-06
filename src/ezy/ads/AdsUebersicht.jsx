// EzyPerformance — Tab «Übersicht» (06.10.2026, Ablösung Data-Studio-Dashboard
// nach Mockup «Google Ads Report · Erweiterung»).
import { Suspense, lazy, useMemo, useState } from "react";
import {
  CheckCircle,
  Check,
  Coins,
  Eye,
  Info,
  MousePointerClick,
  Percent,
  Search,
  Tag,
  Target,
  Wallet,
} from "lucide-react";
import { KpiCard } from "../ui-kit";
import { C } from "../theme";
import {
  conversionZeilen,
  herkunft as baueHerkunft,
  istMarke,
  kennzahlen,
  markenBegriffe,
  topKampagnen,
  wichtigste,
  zielgruppe as baueZielgruppe,
} from "./adsReportModel";
import {
  Abschnitt,
  DeltaChip,
  Karte,
  Pille,
  Segmente,
  TabellenRahmen,
  chf,
  faktor,
  prozent,
  td,
  th,
  zahl,
} from "./adsUi";

const AdsKarte = lazy(() => import("./AdsKarte"));

// ── Hero ────────────────────────────────────────────────────────────────────
function Hero({ snap, k, top, tageLabel, aktion }) {
  const best = top[0];
  return (
    <Karte
      style={{
        background: `radial-gradient(120% 140% at 100% 0%, rgba(185,0,156,.10), transparent 55%), ${C.card}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            Was hat Google Ads gebracht?
          </span>
          <span style={{ fontSize: 11.5, color: C.textMuted, marginLeft: 8 }}>{tageLabel}</span>
        </div>
        {aktion}
      </div>
      <div
        className="ads-hero-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "18px 24px",
          alignItems: "end",
        }}
      >
        <div>
          <div className="ads-hero-zahl" style={heroZahl}>
            {chf(snap.totals.conversionValue)}
          </div>
          <div style={heroText}>
            Umsatz generiert aus {zahl(snap.totals.conversions)} Conversions
          </div>
        </div>
        <div className="ads-hero-mitte" style={{ textAlign: "center" }}>
          <div
            style={{
              ...heroZahl,
              fontSize: 32,
              background: C.grad,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {faktor(k.roas)}
          </div>
          <div style={heroText}>Return on Ad Spend (ROAS)</div>
        </div>
        <div className="ads-hero-rechts" style={{ textAlign: "right" }}>
          <div style={heroZahl}>{chf(snap.totals.cost)}</div>
          <div style={heroText}>Werbebudget eingesetzt für Anzeigen</div>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          border: `1px solid ${C.border}`,
          borderRadius: C.rCtl,
          background: "#fff",
          padding: "10px 14px",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: C.textMuted,
        }}
      >
        <b style={{ color: C.text }}>
          Jeder investierte Franken bringt CHF {k.roas.toFixed(2)} zurück.
        </b>{" "}
        {best &&
          `${best.name} liefert mit ${faktor(best.roas, 1)} ROAS ${Math.round(best.anteil)} % des Umsatzes.`}
      </div>
    </Karte>
  );
}
const heroZahl = {
  fontSize: 26,
  whiteSpace: "nowrap",
  fontWeight: 700,
  color: C.text,
  lineHeight: 1.1,
  letterSpacing: "-.5px",
  fontVariantNumeric: "tabular-nums",
};
const heroText = { fontSize: 12, color: C.textMuted, marginTop: 4 };

// ── Das Wichtigste auf einen Blick ──────────────────────────────────────────
function Wichtigste({ liste }) {
  if (!liste.length) return null;
  const stil = {
    gut: { bg: "rgba(15,157,108,.07)", fg: C.green, icon: <Check size={15} /> },
    warnung: { bg: "rgba(220,38,38,.06)", fg: C.red, icon: <b style={{ fontSize: 13 }}>!</b> },
    info: { bg: "rgba(119,0,140,.06)", fg: C.accent, icon: <Info size={15} /> },
  };
  return (
    <Karte>
      <Abschnitt titel="Das Wichtigste auf einen Blick" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        {liste.map((e, i) => {
          const s = stil[e.ton];
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                background: s.bg,
                borderRadius: C.rCtl,
                padding: "12px 14px",
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#fff",
                  color: s.fg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {s.icon}
              </span>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.textMuted }}>
                <b style={{ color: C.text, fontWeight: 600 }}>{e.titel}</b> {e.text}
              </div>
            </div>
          );
        })}
      </div>
    </Karte>
  );
}

// ── Kennzahlen (EzyRank-KpiCards) ──────────────────────────────────────────
const runde = (d) => (d == null ? undefined : Math.round(d * 10) / 10);

function Kennzahlen({ snap, k, vergleichLabel }) {
  const t = snap.totals;
  const p = snap.prev;
  const karten = [
    [
      CheckCircle,
      "Buchungen über Google Ads",
      zahl(k.buchungen),
      k.d.buchungen,
      zahl(k.buchungenPrev),
      C.accent,
    ],
    [Wallet, "Buchungswert", chf(k.wert), k.d.wert, chf(k.wertPrev), C.green],
    [
      Tag,
      "Ø Buchungswert",
      k.buchungen > 0 ? chf(k.avg) : "–",
      k.d.avg,
      k.avgPrev > 0 ? chf(k.avgPrev) : null,
      C.pink,
    ],
    [
      Target,
      `Alle Conversions (${zahl(k.buchungen)} Buchungen + ${zahl(k.soft)} Soft)`,
      zahl(k.alle),
      k.d.alle,
      zahl(k.allePrev),
      C.blue,
    ],
    [Eye, "Impressionen", zahl(t.impressions), k.d.impressions, zahl(p.impressions), C.cyan],
    [MousePointerClick, "Klicks", zahl(t.clicks), k.d.clicks, zahl(p.clicks), C.accent],
    [Percent, "Klickrate (CTR)", prozent(k.ctr, 2), k.d.ctr, prozent(k.ctrPrev, 2), C.orange],
    [Coins, "Ø CPC", chf(k.cpc, 2), k.d.cpc, chf(k.cpcPrev, 2), C.blue, true],
  ];
  return (
    <div>
      <Abschnitt
        titel="Kennzahlen"
        hinweis={`Veränderung zur ${vergleichLabel} · grün = besser, rot = schlechter`}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        {karten.map(([icon, label, wert, d, vorher, farbe, invert]) => (
          <KpiCard
            key={label}
            icon={icon}
            label={label}
            value={wert}
            color={farbe}
            change={runde(d)}
            invert={!!invert}
            compareValue={vorher ?? undefined}
            compareLabel={vergleichLabel}
          />
        ))}
      </div>
    </div>
  );
}

// ── Top-Kampagnen ───────────────────────────────────────────────────────────
function TopKampagnen({ top }) {
  const [alle, setAlle] = useState(false);
  if (!top.length) return null;
  const max = top[0].conversionValue || 1;
  const liste = alle ? top : top.slice(0, 5);
  return (
    <Karte>
      <Abschnitt titel="Top-Kampagnen nach Umsatz" />
      <div style={{ fontSize: 13, color: C.textMuted, margin: "-8px 0 18px" }}>
        Balken = generierter Umsatz · Kästchen = ROAS (grün ab 5×)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {liste.map((c, i) => {
          const gruen = c.roas >= 5;
          const rot = c.roas > 0 && c.roas < 1;
          return (
            <div key={c.name}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span
                  style={{
                    flex: "none",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: C.accentDim,
                    color: C.accent,
                    fontWeight: 700,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.textMuted }}>
                    Werbekosten {chf(c.cost)} · {Math.round(c.anteil)} % des Umsatzes
                  </div>
                </div>
                <span
                  style={{ fontSize: 14, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}
                >
                  {chf(c.conversionValue)}
                </span>
                <Pille
                  farbe={gruen ? C.green : rot ? C.red : C.textMuted}
                  hinter={gruen ? C.greenDim : rot ? C.redDim : C.segBg}
                >
                  {faktor(c.roas, 1)}
                </Pille>
              </div>
              <div
                style={{ height: 7, background: "#f3e9f5", borderRadius: 99, overflow: "hidden" }}
              >
                <div
                  style={{
                    width: `${Math.max(2, (c.conversionValue / max) * 100)}%`,
                    height: "100%",
                    background: C.grad,
                    borderRadius: 99,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {top.length > 5 && (
        <button type="button" onClick={() => setAlle((v) => !v)} style={linkBtn}>
          {alle ? "Nur Top 5 anzeigen" : `Alle ${top.length} Kampagnen mit Umsatz anzeigen`}
        </button>
      )}
    </Karte>
  );
}
const linkBtn = {
  marginTop: 16,
  border: "none",
  background: "none",
  padding: 0,
  color: C.accent,
  fontWeight: 600,
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
};

// ── Alle Conversions nach Art ───────────────────────────────────────────────
function ConversionsNachArt({ snap, k }) {
  const [filter, setFilter] = useState("alle");
  const zeilen = conversionZeilen(snap);
  if (!zeilen.length) return null;
  const sichtbar = zeilen.filter((z) => filter === "alle" || z.art === filter);
  const mitProfil = zeilen.some((z) => z.art === "profil");
  const zaehler = (label, wert, haupt) => (
    <div
      style={{
        background: haupt ? C.accentDim : C.segBg,
        borderRadius: 14,
        padding: "8px 14px",
        minWidth: 96,
      }}
    >
      <div style={{ fontSize: 12, color: C.textMuted }}>{label}</div>
      <div
        style={{
          fontSize: 21,
          fontWeight: 800,
          color: haupt ? C.accent : C.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {zahl(wert)}
      </div>
    </div>
  );
  return (
    <Karte>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Abschnitt titel="Alle Conversions nach Art" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Hauptziel = Buchung mit Umsatz · Soft Conversions = Anfragen und Kontakte ohne direkten
            Umsatz
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {zaehler("Hauptziele", k.buchungen, true)}
          {zaehler("Soft Conversions", k.soft, false)}
          {mitProfil && zaehler("Unternehmensprofil", k.profil, false)}
        </div>
      </div>
      <div style={{ margin: "18px 0 14px" }}>
        <Segmente
          werte={[
            ["alle", "Alle"],
            ["haupt", "Hauptziele"],
            ["soft", "Soft Conversions"],
            ...(mitProfil ? [["profil", "Unternehmensprofil"]] : []),
          ]}
          aktiv={filter}
          onChange={setFilter}
        />
      </div>
      <TabellenRahmen minWidth={760}>
        <thead>
          <tr>
            <th style={th(false)}>Conversion-Aktion</th>
            <th style={th(false)}>Art</th>
            <th style={th()}>Anzahl</th>
            <th style={th()}>Veränderung</th>
            <th style={th(false)}>Anteil</th>
            <th style={th()}>Wert</th>
            <th style={th()}>Kosten je Conv.</th>
          </tr>
        </thead>
        <tbody>
          {sichtbar.map((z) => (
            <tr key={z.name}>
              <td style={td(false)}>
                <div style={{ fontWeight: 600 }}>{z.name}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>{z.kategorie}</div>
              </td>
              <td style={td(false)}>
                {z.art === "haupt" ? (
                  <Pille farbe={C.accent} hinter={C.accentDim}>
                    Hauptziel
                  </Pille>
                ) : z.art === "profil" ? (
                  <Pille
                    farbe={C.blue}
                    hinter={C.blueDim}
                    title="Aktion im Google-Unternehmensprofil (Maps/Suche) — zählt nicht zu «Alle Conversions»"
                  >
                    Unternehmensprofil
                  </Pille>
                ) : (
                  <Pille>Soft Conversion</Pille>
                )}
              </td>
              <td style={td(true, { fontWeight: 800, fontSize: 13 })}>{zahl(z.anzahl)}</td>
              <td style={td()}>
                <DeltaChip d={z.delta} neu={z.neu} klein />
              </td>
              <td style={td(false, { minWidth: 170 })}>
                {z.anteil == null ? (
                  <span style={{ color: C.textFaint }}>–</span>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: "#f1e8f3",
                        borderRadius: 99,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(1.5, z.anteil)}%`,
                          height: "100%",
                          background: z.hauptziel ? C.accent : "#d6a6dc",
                          borderRadius: 99,
                        }}
                      />
                    </div>
                    <span
                      style={{ fontSize: 12.5, color: C.textMuted, width: 38, textAlign: "right" }}
                    >
                      {Math.round(z.anteil)} %
                    </span>
                  </div>
                )}
              </td>
              <td style={td()}>{z.hauptziel && z.wert > 0 ? chf(z.wert) : "–"}</td>
              <td style={td()}>{z.kostenJe != null ? chf(z.kostenJe, 2) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </TabellenRahmen>
      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 12 }}>
        Anzahl = alle Conversions der Aktion in Google Ads. Kosten je Conv. = gesamte Werbekosten
        geteilt durch die Anzahl dieser Aktion. Anteil ohne Unternehmensprofil-Aktionen.
        {zeilen.every((z) => z.hauptziel) &&
          " Für diesen Kunden sind keine Soft Conversions eingerichtet — der Bereich zeigt nur die Hauptziele."}
      </div>
    </Karte>
  );
}

// ── Woher kommen die Buchungen? ─────────────────────────────────────────────
function Herkunft({ h }) {
  if (!h) return null;
  const top3 = h.staedte.slice(0, 3);
  const max = top3[0]?.conversions || 1;
  return (
    <div>
      <Abschnitt
        titel="Woher kommen die Buchungen?"
        hinweis="Kreisgrösse = Anzahl Buchungen · Karte ziehen zum Verschieben, Doppelklick zum Hineinzoomen"
      />
      <div
        className="ads-herkunft"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <Suspense
          fallback={
            <div
              style={{
                background: "#f7f1f8",
                borderRadius: 18,
                minHeight: 280,
                border: `1px solid ${C.border}`,
              }}
            />
          }
        >
          <AdsKarte herkunft={h} />
        </Suspense>
        <Karte style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.darkPurple, marginBottom: 14 }}>
            Top 3 Städte
          </div>
          {top3.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textMuted }}>Keine Buchungen mit Ortsangabe.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: C.textMuted, fontSize: 12.5 }}>
                  <th style={{ textAlign: "left", fontWeight: 600, paddingBottom: 8 }}>Stadt</th>
                  <th style={{ textAlign: "right", fontWeight: 600, paddingBottom: 8 }}>Buch.</th>
                  <th style={{ textAlign: "right", fontWeight: 600, paddingBottom: 8 }}>Wert</th>
                </tr>
              </thead>
              <tbody>
                {top3.map((s) => (
                  <tr key={s.id}>
                    <td style={{ padding: "10px 0" }}>
                      <b>{s.name}</b>{" "}
                      <span style={{ color: C.textMuted, fontSize: 12.5 }}>{s.land}</span>
                      <div
                        style={{
                          height: 5,
                          background: "#f1e8f3",
                          borderRadius: 99,
                          marginTop: 7,
                          width: "88%",
                        }}
                      >
                        <div
                          style={{
                            width: `${(s.conversions / max) * 100}%`,
                            height: "100%",
                            background: C.grad,
                            borderRadius: 99,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 800, fontSize: 13 }}>
                      {zahl(s.conversions)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: C.textMuted,
                        whiteSpace: "nowrap",
                        paddingLeft: 8,
                      }}
                    >
                      {s.value > 0 ? chf(s.value) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div
            style={{
              marginTop: "auto",
              paddingTop: 14,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              fontSize: 13.5,
            }}
          >
            <span style={{ color: C.textMuted }}>
              Total aus {h.anzahlLaender} {h.anzahlLaender === 1 ? "Land" : "Ländern"}
            </span>
            <b style={{ whiteSpace: "nowrap" }}>
              {zahl(h.total)} · {chf(h.wert)}
            </b>
          </div>
        </Karte>
      </div>
    </div>
  );
}

// ── Wer bucht? ──────────────────────────────────────────────────────────────
function Balkenliste({ titel, daten, farben }) {
  if (!daten || daten.leer) {
    return (
      <Karte>
        <div style={kartenTitel}>{titel}</div>
        <div style={{ fontSize: 13, color: C.textMuted }}>Google liefert dafür keine Angaben.</div>
      </Karte>
    );
  }
  return (
    <Karte>
      <div style={kartenTitel}>{titel}</div>
      <div
        style={{
          display: "flex",
          height: 12,
          borderRadius: 99,
          overflow: "hidden",
          margin: "4px 0 16px",
        }}
      >
        {daten.gruppen.map((g, i) => (
          <div
            key={g.key}
            style={{ width: `${g.anteil}%`, background: farben[i % farben.length] }}
          />
        ))}
      </div>
      {daten.gruppen.map((g, i) => (
        <div
          key={g.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12.5,
            padding: "5px 0",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: farben[i % farben.length],
            }}
          />
          <span style={{ flex: 1, color: C.text }}>{g.label}</span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(g.anteil)} %</b>
        </div>
      ))}
      <Basis daten={daten} />
    </Karte>
  );
}
const kartenTitel = { fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 14 };
function Basis({ daten }) {
  const teile = [];
  if (daten.basis === "clicks") teile.push("Basis: Klicks (zu wenige Buchungen mit Angabe)");
  if (daten.unbekanntAnteil >= 1) teile.push(`${Math.round(daten.unbekanntAnteil)} % ohne Angabe`);
  return teile.length ? (
    <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 10 }}>{teile.join(" · ")}</div>
  ) : null;
}

function Alter({ daten }) {
  if (!daten || daten.leer) return <Balkenliste titel="Alter" daten={daten} farben={[]} />;
  const max = Math.max(1, ...daten.gruppen.map((g) => g.anteil));
  const top = [...daten.gruppen]
    .sort((a, b) => b.anteil - a.anteil)
    .slice(0, 2)
    .map((g) => g.key);
  return (
    <Karte>
      <div style={kartenTitel}>Alter</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${daten.gruppen.length}, 1fr)`,
          gap: 10,
          alignItems: "end",
          height: 132,
        }}
      >
        {daten.gruppen.map((g) => (
          <div
            key={g.key}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              height: "100%",
              justifyContent: "flex-end",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{Math.round(g.anteil)} %</span>
            <div
              style={{
                width: "100%",
                maxWidth: 64,
                height: `${Math.max(4, (g.anteil / max) * 92)}px`,
                borderRadius: 10,
                background: top.includes(g.key) ? C.grad : "#dba9e0",
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${daten.gruppen.length}, 1fr)`,
          gap: 10,
          marginTop: 8,
        }}
      >
        {daten.gruppen.map((g) => (
          <span key={g.key} style={{ textAlign: "center", fontSize: 12, color: C.textMuted }}>
            {g.label}
          </span>
        ))}
      </div>
      <Basis daten={daten} />
    </Karte>
  );
}

function WerBucht({ z }) {
  if (!z) return null;
  return (
    <div>
      <Abschnitt titel="Wer bucht?" hinweis="Anteil an allen Buchungen über Google Ads" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        <div style={{ gridColumn: "span 1" }}>
          <Alter daten={z.alter} />
        </div>
        <Balkenliste titel="Geschlecht" daten={z.geschlecht} farben={[C.accent, "#dba9e0"]} />
        <Balkenliste
          titel="Gerät"
          daten={z.geraet}
          farben={[C.darkPurple, C.accentLight, "#dba9e0", "#e9d3ec"]}
        />
      </div>
    </div>
  );
}

// ── Suchbegriffe ────────────────────────────────────────────────────────────
const SPALTEN = [
  ["term", "Suchbegriff", false],
  ["clicks", "Klicks", true],
  ["impressions", "Impressionen", true],
  ["ctr", "Klickrate", true],
  ["cpc", "Ø CPC", true],
  ["conversions", "Buchungen", true],
  ["cpb", "Kosten/Buchung", true],
  ["value", "Umsatz", true],
];

function Suchbegriffe({ terms, client }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "clicks", dir: -1 });
  const [anzahl, setAnzahl] = useState(25);
  const marken = useMemo(
    () => markenBegriffe(client?.name, client?.brandTerms || []),
    [client?.name, client?.brandTerms],
  );
  const zeilen = useMemo(
    () =>
      (terms || []).map((t) => ({
        ...t,
        ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null,
        cpc: t.clicks > 0 ? t.cost / t.clicks : null,
        cpb: t.conversions > 0 ? t.cost / t.conversions : null,
        marke: istMarke(t.term, marken),
      })),
    [terms, marken],
  );
  if (!terms) return null;
  const gefiltert = zeilen
    .filter((t) => !q.trim() || t.term.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  return (
    <Karte style={{ paddingBottom: 6 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Abschnitt
            titel="Mit welchen Suchbegriffen werden Sie gefunden?"
            style={{ marginBottom: 6 }}
          />
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Suchanfragen, bei denen Ihre Anzeigen erschienen · {gefiltert.length} von{" "}
            {zeilen.length} Suchbegriffen · Spaltentitel anklicken zum Sortieren
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 1 280px" }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Suchbegriff suchen</span>
          <span style={{ position: "relative", display: "block" }}>
            <Search
              size={14}
              color={C.textDim}
              style={{ position: "absolute", left: 12, top: 12, display: "inline-block" }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="z. B. lugano …"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px 10px 34px",
                border: `1px solid ${C.inputBorder}`,
                borderRadius: 12,
                fontSize: 13.5,
                fontFamily: "inherit",
              }}
            />
          </span>
        </label>
      </div>
      <TabellenRahmen minWidth={860}>
        <thead>
          <tr>
            {SPALTEN.map(([key, label, rechts]) => (
              <th
                key={key}
                onClick={() =>
                  setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "term" ? 1 : -1 }))
                }
                style={th(rechts, {
                  cursor: "pointer",
                  color: sort.key === key ? C.accent : C.textMuted,
                })}
              >
                {label}
                {sort.key === key ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gefiltert.slice(0, anzahl).map((t) => (
            <tr key={t.term}>
              <td style={td(false)}>
                {t.term}
                {t.marke && (
                  <span style={{ marginLeft: 8 }}>
                    <Pille
                      farbe={C.accent}
                      hinter={C.accentDim}
                      title="Suchbegriff enthält Ihren Markennamen"
                    >
                      Marke
                    </Pille>
                  </span>
                )}
              </td>
              <td style={td()}>{zahl(t.clicks)}</td>
              <td style={td()}>{zahl(t.impressions)}</td>
              <td style={td()}>{prozent(t.ctr)}</td>
              <td style={td()}>{t.cpc != null ? chf(t.cpc, 2) : "–"}</td>
              <td style={td(true, { fontWeight: 700 })}>{zahl(t.conversions)}</td>
              <td style={td()}>{t.cpb != null ? chf(t.cpb, 2) : "–"}</td>
              <td style={td()}>{t.value > 0 ? chf(t.value) : "–"}</td>
            </tr>
          ))}
          {gefiltert.length === 0 && (
            <tr>
              <td
                colSpan={SPALTEN.length}
                style={td(false, { color: C.textMuted, textAlign: "center" })}
              >
                Keine Suchbegriffe gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </TabellenRahmen>
      {gefiltert.length > anzahl && (
        <button
          type="button"
          onClick={() => setAnzahl((n) => n + 25)}
          style={{ ...linkBtn, margin: "14px 0 10px" }}
        >
          Weitere {Math.min(25, gefiltert.length - anzahl)} Suchbegriffe anzeigen
        </button>
      )}
    </Karte>
  );
}

// ── Glossar ─────────────────────────────────────────────────────────────────
const GLOSSAR = [
  [
    "ROAS",
    "Return on Ad Spend: Umsatz geteilt durch Werbekosten. 8× heisst: aus 1 Franken Werbung werden 8 Franken Umsatz.",
  ],
  [
    "Conversion",
    "Eine gemessene Handlung nach dem Anzeigenklick, z. B. eine Buchung, ein Anruf oder eine Anfrage.",
  ],
  ["Hauptziel", "Die wichtigste Conversion mit Umsatz — bei Hotels die abgeschlossene Buchung."],
  [
    "Soft Conversion",
    "Vorstufen und Kontakte ohne direkten Umsatz, z. B. Buchung gestartet, Anruf, Wegbeschreibung.",
  ],
  ["Impression", "Wie oft eine Anzeige eingeblendet wurde."],
  ["Klickrate (CTR)", "Anteil der Einblendungen, die angeklickt wurden."],
  ["Ø CPC", "Durchschnittliche Kosten pro Klick."],
  [
    "Impressionen oben / ganz oben",
    "Anteil der Einblendungen über den Suchergebnissen bzw. an allererster Stelle.",
  ],
];
function Glossar() {
  return (
    <details
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        padding: "12px 18px",
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700, color: C.darkPurple, fontSize: 13 }}>
        Begriffe erklärt (Glossar)
      </summary>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "10px 24px",
          margin: "14px 0 4px",
        }}
      >
        {GLOSSAR.map(([b, e]) => (
          <div key={b}>
            <dt style={{ fontWeight: 700, fontSize: 13.5, color: C.text }}>{b}</dt>
            <dd style={{ margin: "2px 0 0", fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
              {e}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default function AdsUebersicht({ snap, client, tageLabel, vergleichLabel, aktion }) {
  const k = kennzahlen(snap);
  const top = topKampagnen(snap);
  const h = baueHerkunft(snap);
  const z = baueZielgruppe(snap);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Hero snap={snap} k={k} top={top} tageLabel={tageLabel} aktion={aktion} />
      <Wichtigste liste={wichtigste(snap)} />
      <Kennzahlen snap={snap} k={k} vergleichLabel={vergleichLabel} />
      <TopKampagnen top={top} />
      <ConversionsNachArt snap={snap} k={k} />
      <Herkunft h={h} />
      <WerBucht z={z} />
      <Suchbegriffe terms={snap.report?.searchTerms} client={client} />
      <Glossar />
    </div>
  );
}

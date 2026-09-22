// First-Party GEO (22.09.2026, Volkan): Bereich «First-Party (GSC + GA4)» in
// EzyAI. Fuenf Karten aus /api/kpi/first-party-geo — KI-Referral-Traffic,
// Zitiert vs. organisch, Marken-Nachfrage, Wirkungsnachweis (DiD) und
// KI-Crawler. Nur Owner/Admin; ohne verbundene Daten (aktiv:false) ein
// Leerzustand mit Verweis auf Admin → Kunde → Google → First-Party-Daten.
// Stil/Tokens wie SiteHealthPanel (S aus ezyai.tsx, hier mit Defaults).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { useAuth } from "@/hooks/use-auth";
import { fmtCH, fmtPct } from "@/lib/format-ch";
import { addDays, heuteYmd } from "@/lib/date-range";
import { isoDay, type ResolvedRange } from "@/ezy/data/rangeStore";

// ── API-Vertrag (Server: src/routes/api/kpi.first-party-geo.ts) ─────────────
type Engine = {
  engine: string;
  sessions: number;
  engaged: number;
  keyEvents: number;
  anteilProzent: number;
};
type Tag = { date: string; sessions: number; engaged: number; keyEvents: number };
type Landingpage = { engine: string; landingPage: string; sessions: number; keyEvents: number };
type Referrals = {
  engines: Engine[];
  tage: Tag[];
  landingpages: Landingpage[];
  hinweis?: string;
};
type Seite = { page: string; impressions: number; clicks: number; pos?: number };
type Zitate = {
  standVom: string;
  zitiert: Seite[];
  organischNichtZitiert: Seite[];
  zitiertOhneSichtbarkeit: Seite[];
  zusammenfassung: {
    zitierteSeiten: number;
    davonMitOrganik: number;
    organischeSeitenOhneZitat: number;
  };
};
type BrandWoche = {
  wocheAb: string;
  brandImpressions: number;
  brandClicks: number;
  nonbrandImpressions: number;
  nonbrandClicks: number;
  brandAnteilProzent: number;
};
type Brand = { begriffe: string[]; wochen: BrandWoche[]; trendProzent: number | null };
type BotStatus = "erlaubt" | "gesperrt" | "unbestimmt";
type Bot = {
  name: string;
  betreiber: string;
  zweck: string;
  haeltSichAnRobots: boolean;
  status: BotStatus;
  regel: string;
  empfehlung: string;
};
type Crawler = { robotsUrl: string; geladen: boolean; bots: Bot[] };
type Block = "referrals" | "zitate" | "brand" | "crawler";
type Antwort = {
  ok: boolean;
  aktiv?: boolean;
  error?: string;
  range?: { from: string; to: string; days: number };
  referrals?: Referrals;
  zitate?: Zitate;
  brand?: Brand;
  crawler?: Crawler;
  fehler?: Partial<Record<Block, string>>;
};
type DidErgebnis = {
  behandelt: { seiten: number; praeClicks: number; postClicks: number };
  kontrolle: { seiten: number; quelle: string; ratioMittel: number; ratioSe: number };
  counterfactual: number;
  lift: number;
  liftLo: number;
  liftHi: number;
  verdikt: string;
  fenster: { prae: { from: string; to: string }; post: { from: string; to: string } };
};

const S_DEFAULT: Record<string, string> = {
  bg: "#FCFCFC",
  panel: "#ffffff",
  line: "rgba(43,0,51,.08)",
  txt: "#0D0D0D",
  mut: "#5d5563",
  app: "#77008C",
  appTint: "rgba(119,0,140,.10)",
};
const GRUEN = { bg: "rgba(22,163,74,.12)", fg: "#15803d" };
const ROT = { bg: "rgba(220,38,38,.12)", fg: "#b91c1c" };
const ORANGE = { bg: "rgba(234,88,12,.12)", fg: "#c2410c" };
const GRAU = { bg: "rgba(93,85,99,.12)", fg: "#5d5563" };

const API = "/api/kpi/first-party-geo";
const EIGENE_TAGE = [28, 90, 365] as const;

/** YYYY-MM-DD → DD.MM.YYYY (Anzeige); alles andere unveraendert. */
function fmtDatum(ymd: unknown): string {
  const s = String(ymd ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s || "–";
}

/** Vorzeichenbehaftete Prozentangabe («+12.3 %» / «-4.0 %»). */
function fmtSigned(x: unknown, stellen = 1): string {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "–";
  return `${n > 0 ? "+" : ""}${fmtPct(n, stellen)}`;
}

/** Verdikt-Werte aus src/lib/did.ts → deutsche Pille (Farbe + Text). */
function verdiktPille(v: unknown): { stil: { bg: string; fg: string }; text: string } {
  switch (String(v ?? "")) {
    case "likely_positive":
      return { stil: GRUEN, text: "wahrscheinlich positiv" };
    case "likely_negative":
      return { stil: ROT, text: "wahrscheinlich negativ" };
    case "insufficient_data":
      return { stil: ORANGE, text: "zu wenig Daten" };
    case "insufficient_control":
      return { stil: ORANGE, text: "keine Kontrollgruppe" };
    default:
      return { stil: GRAU, text: "unklar" };
  }
}

/** Vorzeichenbehaftete Klickzahl («+112» / «-40»), null → «–». */
function fmtSignedZahl(x: unknown): string {
  const n = typeof x === "number" ? x : Number(x);
  if (x == null || !Number.isFinite(n)) return "–";
  return `${n > 0 ? "+" : ""}${fmtCH(n)}`;
}

/** Lift relativ zum erwarteten Wert (Counterfactual) in Prozent, sonst null. */
function relativ(lift: unknown, basis: unknown): number | null {
  const l = Number(lift);
  const b = Number(basis);
  if (lift == null || !Number.isFinite(l) || !Number.isFinite(b) || b <= 0) return null;
  return (l / b) * 100;
}

function statusStil(s: BotStatus | string): { bg: string; fg: string } {
  if (s === "erlaubt") return GRUEN;
  if (s === "gesperrt") return ROT;
  return GRAU;
}

// ── Kleine Bausteine ────────────────────────────────────────────────────────
function Pille({ stil, children }: { stil: { bg: string; fg: string }; children: any }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10.5,
        fontWeight: 700,
        borderRadius: 99,
        padding: "2px 9px",
        background: stil.bg,
        color: stil.fg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Skeleton({ w = "100%", h = 12 }: { w?: string | number; h?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        background: "rgba(43,0,51,.06)",
        marginBottom: 8,
      }}
    />
  );
}

function Karte({
  S,
  titel,
  untertitel,
  fehler,
  leer,
  laden,
  children,
}: {
  S: Record<string, string>;
  titel: string;
  untertitel?: string;
  fehler?: string;
  leer?: boolean;
  laden?: boolean;
  children?: any;
}) {
  return (
    <section
      style={{
        background: S.panel,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>{titel}</div>
        {untertitel && (
          <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{untertitel}</div>
        )}
      </div>
      {laden ? (
        <div>
          <Skeleton w="45%" h={14} />
          <Skeleton />
          <Skeleton />
          <Skeleton w="70%" />
        </div>
      ) : fehler ? (
        <div style={{ fontSize: 12.5, color: ROT.fg }}>Fehler beim Laden: {fehler}</div>
      ) : leer ? (
        <div style={{ fontSize: 12.5, color: S.mut }}>Noch keine Daten für diesen Zeitraum.</div>
      ) : (
        children
      )}
    </section>
  );
}

function Kennzahl({
  S,
  label,
  wert,
  hinweis,
}: {
  S: Record<string, string>;
  label: string;
  wert: string;
  hinweis?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 140px",
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 10,
        background: S.bg,
        border: `1px solid ${S.line}`,
      }}
    >
      <div style={{ fontSize: 11, color: S.mut }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: S.txt, marginTop: 2 }}>{wert}</div>
      {hinweis && <div style={{ fontSize: 10.5, color: S.mut, marginTop: 2 }}>{hinweis}</div>}
    </div>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  padding: "6px 8px",
  whiteSpace: "nowrap",
};
const td: CSSProperties = { fontSize: 12, padding: "6px 8px", verticalAlign: "top" };
const tdNum: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

function Tabelle({ S, children }: { S: Record<string, string>; children: any }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: S.txt }}>{children}</table>
    </div>
  );
}

function Pfad({ S, url, max = 320 }: { S: Record<string, string>; url: string; max?: number }) {
  return (
    <span
      title={url}
      style={{
        display: "inline-block",
        maxWidth: max,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        color: S.txt,
      }}
    >
      {url}
    </span>
  );
}

/** Einfache SVG-Linie (Sessions je Tag), ohne Achsen — bewusst ohne recharts. */
function Sparkline({ S, punkte }: { S: Record<string, string>; punkte: number[] }) {
  const W = 600;
  const H = 48;
  const n = punkte.length;
  if (n < 2) return null;
  const max = Math.max(1, ...punkte);
  const pts = punkte
    .map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - 4 - (v / max) * (H - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block" }}
      role="img"
      aria-label="Tagesverlauf der KI-Referral-Sessions"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={S.app}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Wochenbalken Brand vs. Non-Brand (gestapelte Impressionen), reines SVG. */
function Wochenbalken({ S, wochen }: { S: Record<string, string>; wochen: BrandWoche[] }) {
  const n = wochen.length;
  if (!n) return null;
  const bw = 18;
  const gap = 6;
  const H = 96;
  const W = n * (bw + gap);
  const max = Math.max(1, ...wochen.map((w) => w.brandImpressions + w.nonbrandImpressions));
  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={W}
        height={H + 14}
        viewBox={`0 0 ${W} ${H + 14}`}
        role="img"
        aria-label="Brand- und Non-Brand-Impressionen je Woche"
        style={{ display: "block", minWidth: "100%" }}
      >
        {wochen.map((w, i) => {
          const x = i * (bw + gap);
          const hb = ((w.brandImpressions || 0) / max) * H;
          const hn = ((w.nonbrandImpressions || 0) / max) * H;
          return (
            <g key={w.wocheAb || i}>
              <title>
                {`Woche ab ${fmtDatum(w.wocheAb)}: Brand ${fmtCH(w.brandImpressions)} · Non-Brand ${fmtCH(w.nonbrandImpressions)} · Anteil ${fmtPct(w.brandAnteilProzent)}`}
              </title>
              <rect x={x} y={H - hn - hb} width={bw} height={hn} fill="rgba(43,0,51,.14)" />
              <rect x={x} y={H - hb} width={bw} height={hb} fill={S.app} />
              {(i === 0 || i === n - 1) && (
                <text x={x} y={H + 11} fontSize={9} fill={S.mut}>
                  {fmtDatum(w.wocheAb).slice(0, 5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Karten ──────────────────────────────────────────────────────────────────
function ReferralKarte({
  S,
  daten,
  fehler,
  laden,
}: {
  S: Record<string, string>;
  daten?: Referrals;
  fehler?: string;
  laden: boolean;
}) {
  const engines = daten?.engines || [];
  const gesamt = engines.reduce((a, e) => a + (e.sessions || 0), 0);
  const jeEngine = useMemo(() => {
    const m = new Map<string, Landingpage[]>();
    for (const lp of daten?.landingpages || []) {
      const l = m.get(lp.engine) || [];
      l.push(lp);
      m.set(lp.engine, l);
    }
    for (const l of m.values()) l.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    return m;
  }, [daten?.landingpages]);
  return (
    <Karte
      S={S}
      titel="KI-Referral-Traffic"
      untertitel="Sessions aus ChatGPT, Perplexity, Gemini & Co. (GA4, nach Referrer)"
      fehler={fehler}
      laden={laden}
      leer={!engines.length}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Kennzahl S={S} label="Sessions gesamt" wert={fmtCH(gesamt)} />
        <Kennzahl
          S={S}
          label="Engagiert"
          wert={fmtCH(engines.reduce((a, e) => a + (e.engaged || 0), 0))}
        />
        <Kennzahl
          S={S}
          label="Key Events"
          wert={fmtCH(engines.reduce((a, e) => a + (e.keyEvents || 0), 0))}
        />
      </div>
      {(daten?.tage?.length || 0) > 1 && (
        <div style={{ marginBottom: 12 }}>
          <Sparkline S={S} punkte={(daten?.tage || []).map((t) => t.sessions || 0)} />
          <div
            style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: S.mut }}
          >
            <span>{fmtDatum(daten?.tage?.[0]?.date)}</span>
            <span>{fmtDatum(daten?.tage?.[daten.tage.length - 1]?.date)}</span>
          </div>
        </div>
      )}
      <Tabelle S={S}>
        <thead>
          <tr style={{ color: S.mut, borderBottom: `1px solid ${S.line}` }}>
            <th style={th}>Engine</th>
            <th style={{ ...th, textAlign: "right" }}>Sessions</th>
            <th style={{ ...th, textAlign: "right" }}>Engagiert</th>
            <th style={{ ...th, textAlign: "right" }}>Key Events</th>
            <th style={{ ...th, textAlign: "right" }}>Anteil</th>
          </tr>
        </thead>
        <tbody>
          {engines.map((e) => (
            <tr key={e.engine} style={{ borderBottom: `1px solid ${S.line}` }}>
              <td style={{ ...td, fontWeight: 600 }}>{e.engine}</td>
              <td style={tdNum}>{fmtCH(e.sessions)}</td>
              <td style={tdNum}>{fmtCH(e.engaged)}</td>
              <td style={tdNum}>{fmtCH(e.keyEvents)}</td>
              <td style={tdNum}>{fmtPct(e.anteilProzent)}</td>
            </tr>
          ))}
        </tbody>
      </Tabelle>
      {jeEngine.size > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: S.mut, marginBottom: 6 }}>
            Top-Landingpages je Engine
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
              gap: 10,
            }}
          >
            {[...jeEngine.entries()].map(([engine, lps]) => (
              <div
                key={engine}
                style={{ border: `1px solid ${S.line}`, borderRadius: 10, padding: "8px 10px" }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: S.txt, marginBottom: 4 }}>
                  {engine}
                </div>
                {lps.slice(0, 5).map((lp) => (
                  <div
                    key={lp.landingPage}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 11.5,
                    }}
                  >
                    <Pfad S={S} url={lp.landingPage} max={200} />
                    <span style={{ color: S.mut, whiteSpace: "nowrap" }}>
                      {fmtCH(lp.sessions)} · {fmtCH(lp.keyEvents)} KE
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {daten?.hinweis && (
        <div style={{ fontSize: 11.5, color: S.mut, marginTop: 12 }}>{daten.hinweis}</div>
      )}
    </Karte>
  );
}

function SeitenListe({
  S,
  titel,
  empfehlung,
  seiten,
  mitPos,
}: {
  S: Record<string, string>;
  titel: string;
  empfehlung: string;
  seiten: Seite[];
  mitPos: boolean;
}) {
  return (
    <div
      style={{ border: `1px solid ${S.line}`, borderRadius: 10, padding: "10px 12px", minWidth: 0 }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>{titel}</div>
      <div style={{ fontSize: 11.5, color: S.mut, margin: "2px 0 8px" }}>{empfehlung}</div>
      {seiten.length ? (
        <Tabelle S={S}>
          <thead>
            <tr style={{ color: S.mut, borderBottom: `1px solid ${S.line}` }}>
              <th style={th}>Seite</th>
              <th style={{ ...th, textAlign: "right" }}>Impr.</th>
              <th style={{ ...th, textAlign: "right" }}>Klicks</th>
              {mitPos && <th style={{ ...th, textAlign: "right" }}>Pos.</th>}
            </tr>
          </thead>
          <tbody>
            {seiten.slice(0, 10).map((s) => (
              <tr key={s.page} style={{ borderBottom: `1px solid ${S.line}` }}>
                <td style={td}>
                  <Pfad S={S} url={s.page} max={260} />
                </td>
                <td style={tdNum}>{fmtCH(s.impressions)}</td>
                <td style={tdNum}>{fmtCH(s.clicks)}</td>
                {mitPos && <td style={tdNum}>{fmtCH(s.pos, 1)}</td>}
              </tr>
            ))}
          </tbody>
        </Tabelle>
      ) : (
        <div style={{ fontSize: 12, color: S.mut }}>Keine Seiten in dieser Gruppe.</div>
      )}
      {seiten.length > 10 && (
        <div style={{ fontSize: 10.5, color: S.mut, marginTop: 4 }}>
          +{seiten.length - 10} weitere
        </div>
      )}
    </div>
  );
}

function ZitateKarte({
  S,
  daten,
  fehler,
  laden,
}: {
  S: Record<string, string>;
  daten?: Zitate;
  fehler?: string;
  laden: boolean;
}) {
  const z = daten?.zusammenfassung;
  const leer =
    !daten ||
    (!daten.zitiert?.length &&
      !daten.organischNichtZitiert?.length &&
      !daten.zitiertOhneSichtbarkeit?.length);
  return (
    <Karte
      S={S}
      titel="Zitiert vs. organisch"
      untertitel={`Welche Seiten KI-Antworten zitieren — und wie sie bei Google stehen · Stand: ${fmtDatum(daten?.standVom)}`}
      fehler={fehler}
      laden={laden}
      leer={leer}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Kennzahl S={S} label="Von KI zitierte Seiten" wert={fmtCH(z?.zitierteSeiten)} />
        <Kennzahl
          S={S}
          label="davon mit organischer Sichtbarkeit"
          wert={fmtCH(z?.davonMitOrganik)}
        />
        <Kennzahl
          S={S}
          label="Organische Seiten ohne Zitat"
          wert={fmtCH(z?.organischeSeitenOhneZitat)}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 10,
        }}
      >
        <SeitenListe
          S={S}
          titel="Von KI zitiert, bei Google kaum sichtbar"
          empfehlung="Empfehlung: Snippet und Title schärfen, interne Verlinkung stärken — die Inhalte überzeugen KI-Engines bereits."
          seiten={daten?.zitiertOhneSichtbarkeit || []}
          mitPos={false}
        />
        <SeitenListe
          S={S}
          titel="Organisch stark, von KI nie zitiert"
          empfehlung="Empfehlung: Kernaussagen als klare, zitierfähige Absätze formulieren, Fakten mit Quellen belegen, Struktur (H2/FAQ) ergänzen."
          seiten={daten?.organischNichtZitiert || []}
          mitPos
        />
      </div>
    </Karte>
  );
}

function BrandKarte({
  S,
  daten,
  fehler,
  laden,
}: {
  S: Record<string, string>;
  daten?: Brand;
  fehler?: string;
  laden: boolean;
}) {
  const wochen = daten?.wochen || [];
  const letzte = wochen[wochen.length - 1];
  const summeBrand = wochen.reduce((a, w) => a + (w.brandImpressions || 0), 0);
  const summeNon = wochen.reduce((a, w) => a + (w.nonbrandImpressions || 0), 0);
  const anteilGesamt =
    summeBrand + summeNon > 0 ? (summeBrand / (summeBrand + summeNon)) * 100 : null;
  const trend = daten?.trendProzent;
  const trendStil = trend == null ? GRAU : trend > 0 ? GRUEN : trend < 0 ? ROT : GRAU;
  return (
    <Karte
      S={S}
      titel="Marken-Nachfrage"
      untertitel="Impressionen mit Markenbegriff vs. ohne (GSC, je Woche)"
      fehler={fehler}
      laden={laden}
      leer={!wochen.length}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
          alignItems: "stretch",
        }}
      >
        <Kennzahl S={S} label="Brand-Anteil (Zeitraum)" wert={fmtPct(anteilGesamt)} />
        <Kennzahl
          S={S}
          label="Brand-Anteil (letzte Woche)"
          wert={fmtPct(letzte?.brandAnteilProzent)}
          hinweis={letzte ? `Woche ab ${fmtDatum(letzte.wocheAb)}` : undefined}
        />
        <div
          style={{
            flex: "1 1 140px",
            padding: "10px 12px",
            borderRadius: 10,
            background: S.bg,
            border: `1px solid ${S.line}`,
          }}
        >
          <div style={{ fontSize: 11, color: S.mut }}>Trend Brand-Impressionen</div>
          <div style={{ marginTop: 4 }}>
            <Pille stil={trendStil}>{trend == null ? "zu wenig Daten" : fmtSigned(trend)}</Pille>
          </div>
          <div style={{ fontSize: 10.5, color: S.mut, marginTop: 2 }}>
            letzte 4 vs. vorherige 4 Wochen
          </div>
        </div>
      </div>
      <Wochenbalken S={S} wochen={wochen} />
      <div style={{ display: "flex", gap: 12, fontSize: 10.5, color: S.mut, marginTop: 4 }}>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: S.app,
              marginRight: 4,
            }}
          />
          Brand
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: "rgba(43,0,51,.14)",
              marginRight: 4,
            }}
          />
          Non-Brand
        </span>
      </div>
      {(daten?.begriffe?.length || 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 12 }}>
          {daten?.begriffe.map((b) => (
            <span
              key={b}
              style={{
                fontSize: 10.5,
                color: S.app,
                background: S.appTint,
                borderRadius: 99,
                padding: "2px 9px",
              }}
            >
              {b}
            </span>
          ))}
        </div>
      )}
    </Karte>
  );
}

const inputStil = (S: Record<string, string>): CSSProperties => ({
  padding: "7px 10px",
  borderRadius: 10,
  background: S.bg,
  color: S.txt,
  border: `1px solid ${S.line}`,
  fontSize: 12,
  fontFamily: "inherit",
});

function DidKarte({
  S,
  clientId,
  seitenAuswahl,
}: {
  S: Record<string, string>;
  clientId: string;
  seitenAuswahl: string[];
}) {
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(() => new Set());
  const [freitext, setFreitext] = useState("");
  const [changeDate, setChangeDate] = useState(() => addDays(heuteYmd(), -35));
  const [praeTage, setPraeTage] = useState(56);
  const [washoutTage, setWashoutTage] = useState(7);
  const [postTage, setPostTage] = useState(28);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState("");
  const [ergebnis, setErgebnis] = useState<DidErgebnis | null>(null);

  useEffect(() => {
    // Kundenwechsel: Auswahl und Ergebnis verwerfen.
    setGewaehlt(new Set());
    setErgebnis(null);
    setFehler("");
  }, [clientId]);

  const pages = useMemo(() => {
    const aus = new Set(gewaehlt);
    for (const z of freitext.split(/\s+/)) if (z.trim()) aus.add(z.trim());
    return [...aus];
  }, [gewaehlt, freitext]);

  const toggle = (p: string) =>
    setGewaehlt((alt) => {
      const n = new Set(alt);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const rechnen = async () => {
    if (!pages.length || !changeDate) return;
    setLaeuft(true);
    setFehler("");
    try {
      const r = await authedFetch(API, {
        method: "POST",
        body: JSON.stringify({
          client: clientId,
          action: "did",
          pages,
          changeDate,
          praeTage,
          washoutTage,
          postTage,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        did?: DidErgebnis;
      };
      if (!r.ok || !j.ok || !j.did) throw new Error(j.error || `HTTP ${r.status}`);
      setErgebnis(j.did);
    } catch (e: any) {
      setErgebnis(null);
      setFehler(String(e?.message || e));
    } finally {
      setLaeuft(false);
    }
  };

  const zahl = (v: number, set: (n: number) => void, label: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: S.mut }}>
      {label}
      <input
        type="number"
        min={1}
        max={365}
        value={v}
        onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        style={{ ...inputStil(S), width: 80 }}
      />
    </label>
  );

  return (
    <Karte
      S={S}
      titel="Wirkungsnachweis (Difference-in-Differences)"
      untertitel="Hat eine Änderung an bestimmten Seiten die Klicks messbar bewegt — über die allgemeine Entwicklung hinaus?"
    >
      <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 12 }}>
        Die geänderten Seiten werden vor und nach dem Änderungsdatum mit einer Kontrollgruppe
        vergleichbarer, unveränderter Seiten verglichen; der Lift ist die Abweichung vom erwarteten
        Verlauf.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: S.txt, marginBottom: 6 }}>
            Geänderte Seiten ({pages.length} gewählt)
          </div>
          {seitenAuswahl.length > 0 && (
            <div
              style={{
                maxHeight: 170,
                overflowY: "auto",
                border: `1px solid ${S.line}`,
                borderRadius: 10,
                padding: "6px 8px",
                marginBottom: 8,
              }}
            >
              {seitenAuswahl.map((p) => (
                <label
                  key={p}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    fontSize: 11.5,
                    padding: "2px 0",
                  }}
                >
                  <input type="checkbox" checked={gewaehlt.has(p)} onChange={() => toggle(p)} />
                  <Pfad S={S} url={p} max={300} />
                </label>
              ))}
            </div>
          )}
          <textarea
            value={freitext}
            onChange={(e) => setFreitext(e.target.value)}
            placeholder="Weitere URLs, eine je Zeile"
            rows={3}
            style={{ ...inputStil(S), width: "100%", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: S.mut }}
          >
            Änderungsdatum
            <input
              type="date"
              value={changeDate}
              onChange={(e) => setChangeDate(e.target.value)}
              style={{ ...inputStil(S), width: 160 }}
            />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {zahl(praeTage, setPraeTage, "Vorher (Tage)")}
            {zahl(washoutTage, setWashoutTage, "Washout (Tage)")}
            {zahl(postTage, setPostTage, "Nachher (Tage)")}
          </div>
          <div>
            <button
              onClick={rechnen}
              disabled={laeuft || !pages.length || !changeDate}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: "none",
                cursor: laeuft || !pages.length ? "default" : "pointer",
                background: S.app,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                opacity: laeuft || !pages.length || !changeDate ? 0.6 : 1,
              }}
            >
              {laeuft ? "Berechne…" : "Wirkung berechnen"}
            </button>
          </div>
          {fehler && <div style={{ fontSize: 12, color: ROT.fg }}>{fehler}</div>}
        </div>
      </div>
      {ergebnis && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${S.line}`, paddingTop: 12 }}>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 11.5, color: S.mut }}>Verdikt</span>
            <Pille stil={verdiktStil(ergebnis.verdikt)}>{ergebnis.verdikt || "unklar"}</Pille>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Kennzahl
              S={S}
              label="Lift (95 %-Konfidenzintervall)"
              wert={fmtSigned(ergebnis.lift)}
              hinweis={`${fmtSigned(ergebnis.liftLo)} bis ${fmtSigned(ergebnis.liftHi)}`}
            />
            <Kennzahl
              S={S}
              label="Klicks nachher (erwartet ohne Änderung)"
              wert={fmtCH(ergebnis.behandelt?.postClicks)}
              hinweis={`erwartet ${fmtCH(ergebnis.counterfactual)} · vorher ${fmtCH(ergebnis.behandelt?.praeClicks)}`}
            />
            <Kennzahl
              S={S}
              label="Kontrollgruppe"
              wert={`${fmtCH(ergebnis.kontrolle?.seiten)} Seiten`}
              hinweis={`Quelle: ${ergebnis.kontrolle?.quelle || "–"} · Ratio ${fmtCH(ergebnis.kontrolle?.ratioMittel, 2)} ± ${fmtCH(ergebnis.kontrolle?.ratioSe, 2)}`}
            />
          </div>
          <div style={{ fontSize: 11, color: S.mut, marginTop: 8 }}>
            Fenster: vorher {fmtDatum(ergebnis.fenster?.prae?.from)} –{" "}
            {fmtDatum(ergebnis.fenster?.prae?.to)} · nachher{" "}
            {fmtDatum(ergebnis.fenster?.post?.from)} – {fmtDatum(ergebnis.fenster?.post?.to)} ·{" "}
            {fmtCH(ergebnis.behandelt?.seiten)} behandelte Seiten
          </div>
        </div>
      )}
    </Karte>
  );
}

function CrawlerKarte({
  S,
  daten,
  fehler,
  laden,
}: {
  S: Record<string, string>;
  daten?: Crawler;
  fehler?: string;
  laden: boolean;
}) {
  const bots = daten?.bots || [];
  return (
    <Karte
      S={S}
      titel="KI-Crawler"
      untertitel={
        daten?.robotsUrl
          ? `${daten.robotsUrl}${daten.geladen ? "" : " · robots.txt konnte nicht geladen werden"}`
          : "Zugriff der KI-Bots laut robots.txt"
      }
      fehler={fehler}
      laden={laden}
      leer={!bots.length}
    >
      <Tabelle S={S}>
        <thead>
          <tr style={{ color: S.mut, borderBottom: `1px solid ${S.line}` }}>
            <th style={th}>Bot</th>
            <th style={th}>Betreiber</th>
            <th style={th}>Zweck</th>
            <th style={th}>Status</th>
            <th style={th}>Regel</th>
            <th style={th}>Empfehlung</th>
          </tr>
        </thead>
        <tbody>
          {bots.map((b) => (
            <tr key={b.name} style={{ borderBottom: `1px solid ${S.line}` }}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{b.name}</td>
              <td style={td}>{b.betreiber}</td>
              <td style={td}>{b.zweck}</td>
              <td style={td}>
                <Pille stil={statusStil(b.status)}>{b.status}</Pille>
                {!b.haeltSichAnRobots && (
                  <div style={{ fontSize: 10, color: ORANGE.fg, marginTop: 2 }}>
                    ignoriert robots.txt
                  </div>
                )}
              </td>
              <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                {b.regel || "–"}
              </td>
              <td style={{ ...td, color: S.mut }}>{b.empfehlung}</td>
            </tr>
          ))}
        </tbody>
      </Tabelle>
      <div style={{ fontSize: 11.5, color: S.mut, marginTop: 12 }}>
        Hinweis: Bytespider (ByteDance) ignoriert robots.txt — eine Sperre wirkt nur über Server-
        oder WAF-Regeln. Google-Extended betrifft ausschliesslich das Training von Gemini, nicht die
        Google-Suche oder AI Overviews.
      </div>
    </Karte>
  );
}

// ── Bereich ─────────────────────────────────────────────────────────────────
export default function FirstPartyGeo({
  clientId,
  client,
  range,
  S: SProp,
}: {
  clientId: string;
  client?: { id?: string; name?: string; metadata?: Record<string, any> } | null;
  /** Zeitraum aus dem EzyAI-Header; fehlt er, eigener Umschalter 28/90/365. */
  range?: ResolvedRange | null;
  S?: Record<string, string>;
}) {
  const { isOrgAdmin } = useAuth();
  const S = SProp || S_DEFAULT;
  const [eigeneTage, setEigeneTage] = useState<(typeof EIGENE_TAGE)[number]>(28);
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [laden, setLaden] = useState(true);
  const [fehler, setFehler] = useState("");

  const endKey = range ? isoDay(range.end) : addDays(heuteYmd(), -1);
  const startKey = range ? isoDay(range.start) : addDays(endKey, -(eigeneTage - 1));

  useEffect(() => {
    if (!isOrgAdmin || !clientId) return;
    let alive = true;
    setLaden(true);
    setFehler("");
    (async () => {
      try {
        const r = await authedFetch(
          `${API}?client=${encodeURIComponent(clientId)}&startDate=${startKey}&endDate=${endKey}`,
        );
        const j = (await r.json().catch(() => ({}))) as Antwort;
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (alive) setDaten(j);
      } catch (e: any) {
        if (alive) {
          setDaten(null);
          setFehler(String(e?.message || e));
        }
      } finally {
        if (alive) setLaden(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isOrgAdmin, clientId, startKey, endKey]);

  const seitenAuswahl = useMemo(() => {
    const z = daten?.zitate;
    const s = new Set<string>();
    for (const l of [z?.zitiert, z?.zitiertOhneSichtbarkeit, z?.organischNichtZitiert])
      for (const p of l || []) if (p?.page) s.add(p.page);
    return [...s];
  }, [daten?.zitate]);

  if (!isOrgAdmin) return null;

  const kopf = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: S.txt }}>First-Party (GSC + GA4)</div>
        <div style={{ fontSize: 12, color: S.mut }}>
          {client?.name ? `${client.name} · ` : ""}
          {fmtDatum(startKey)} – {fmtDatum(endKey)}
        </div>
      </div>
      {!range && (
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {EIGENE_TAGE.map((t) => (
            <button
              key={t}
              onClick={() => setEigeneTage(t)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: `1px solid ${eigeneTage === t ? S.app : S.line}`,
                background: eigeneTage === t ? S.appTint : "transparent",
                color: eigeneTage === t ? S.app : S.mut,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {t} Tage
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const karte: CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };

  if (!laden && fehler) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {kopf}
        <div style={{ ...karte, color: ROT.fg, fontSize: 13 }}>
          First-Party-Daten konnten nicht geladen werden: {fehler}
        </div>
      </div>
    );
  }

  if (!laden && daten && daten.aktiv === false) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {kopf}
        <div style={{ ...karte, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>📊</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: S.txt }}>
            Noch keine Daten verbunden
          </div>
          <div style={{ fontSize: 13, color: S.mut }}>
            Search Console und GA4 für diesen Kunden verbinden: Admin → Kunde → Google →
            First-Party-Daten.
          </div>
        </div>
      </div>
    );
  }

  const f = daten?.fehler || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {kopf}
      <ReferralKarte S={S} daten={daten?.referrals} fehler={f.referrals} laden={laden} />
      <ZitateKarte S={S} daten={daten?.zitate} fehler={f.zitate} laden={laden} />
      <BrandKarte S={S} daten={daten?.brand} fehler={f.brand} laden={laden} />
      <DidKarte S={S} clientId={clientId} seitenAuswahl={seitenAuswahl} />
      <CrawlerKarte S={S} daten={daten?.crawler} fehler={f.crawler} laden={laden} />
    </div>
  );
}

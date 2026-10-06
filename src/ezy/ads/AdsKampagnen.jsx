// EzyPerformance — Tab «Kampagnen» (06.10.2026): Kampagnentabelle, PMax-Asset-
// Gruppen, Tagesverlauf und Sichtbarkeit (ersetzt die Data-Studio-Seiten
// «Google Ads» und «PMax Kampagne»).
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpToLine, Coins, Crown, TrendingUp } from "lucide-react";
import { C } from "../theme";
import { KpiCard } from "../ui-kit";
import { pctDelta } from "./adsReportModel";
import {
  Abschnitt,
  DeltaChip,
  Karte,
  Pille,
  TabellenRahmen,
  chf,
  faktor,
  prozent,
  td,
  th,
  zahl,
} from "./adsUi";

const STATUS = {
  ENABLED: ["Aktiv", C.green, C.greenDim],
  PAUSED: ["Pausiert", C.textMuted, C.segBg],
  REMOVED: ["Entfernt", C.textDim, C.segBg],
};

const abgeleitet = (r) => ({
  ...r,
  ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
  cpa: r.conversions > 0 ? r.cost / r.conversions : null,
  roas: r.cost > 0 ? r.conversionValue / r.cost : null,
});

const SPALTEN = [
  ["name", "Name", false],
  ["status", "Status", false],
  ["impressions", "Impressionen", true],
  ["clicks", "Klicks", true],
  ["ctr", "CTR", true],
  ["conversions", "Conversions", true],
  ["cost", "Kosten", true],
  ["cpa", "Kosten/Conv.", true],
  ["roas", "ROAS", true],
  ["conversionValue", "Conv.-Wert", true],
];

function LeistungsTabelle({ zeilen, nameTitel, extraName }) {
  const [sort, setSort] = useState({ key: "impressions", dir: -1 });
  const [inaktive, setInaktive] = useState(false);
  const liste = useMemo(() => zeilen.map(abgeleitet), [zeilen]);
  const ohneLeistung = liste.filter((r) => !(r.impressions > 0 || r.cost > 0)).length;
  const sichtbar = liste
    .filter((r) => inaktive || r.impressions > 0 || r.cost > 0)
    .sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  const s = liste.reduce(
    (x, r) => ({
      impressions: x.impressions + r.impressions,
      clicks: x.clicks + r.clicks,
      conversions: x.conversions + r.conversions,
      cost: x.cost + r.cost,
      conversionValue: x.conversionValue + r.conversionValue,
    }),
    { impressions: 0, clicks: 0, conversions: 0, cost: 0, conversionValue: 0 },
  );
  const summe = abgeleitet(s);
  const zelle = (r, key, fett) => {
    const v = r[key];
    const stil = td(true, fett ? { fontWeight: 700 } : {});
    switch (key) {
      case "ctr":
        return (
          <td key={key} style={stil}>
            {prozent(v, 2)}
          </td>
        );
      case "cost":
      case "cpa":
        return (
          <td key={key} style={stil}>
            {v == null ? "–" : chf(v, 2)}
          </td>
        );
      case "conversionValue":
        return (
          <td key={key} style={stil}>
            {v > 0 ? chf(v) : "–"}
          </td>
        );
      case "roas":
        return (
          <td key={key} style={stil}>
            {v == null ? (
              "–"
            ) : (
              <Pille
                farbe={v >= 5 ? C.green : v < 1 && v > 0 ? C.red : C.text}
                hinter={v >= 5 ? C.greenDim : v < 1 && v > 0 ? C.redDim : "transparent"}
              >
                {faktor(v)}
              </Pille>
            )}
          </td>
        );
      default:
        return (
          <td key={key} style={stil}>
            {zahl(v)}
          </td>
        );
    }
  };
  return (
    <>
      <TabellenRahmen minWidth={980}>
        <thead>
          <tr>
            {SPALTEN.map(([key, label, rechts]) => (
              <th
                key={key}
                onClick={() =>
                  setSort((x) => ({ key, dir: x.key === key ? -x.dir : rechts ? -1 : 1 }))
                }
                style={th(rechts, {
                  cursor: "pointer",
                  color: sort.key === key ? C.accent : C.textMuted,
                })}
              >
                {key === "name" ? nameTitel : label}
                {sort.key === key ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sichtbar.map((r) => {
            const st = STATUS[r.status] || [r.status || "–", C.textMuted, C.segBg];
            return (
              <tr key={(r.campaign || "") + r.name}>
                <td style={td(false, { minWidth: 220 })}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  {extraName && r[extraName] && (
                    <div style={{ fontSize: 12, color: C.textMuted }}>{r[extraName]}</div>
                  )}
                </td>
                <td style={td(false)}>
                  <Pille farbe={st[1]} hinter={st[2]}>
                    {st[0]}
                  </Pille>
                </td>
                {SPALTEN.slice(2).map(([key]) => zelle(r, key))}
              </tr>
            );
          })}
          <tr style={{ background: "#fbf6fc" }}>
            <td style={td(false, { fontWeight: 800 })}>Gesamt</td>
            <td style={td(false)} />
            {SPALTEN.slice(2).map(([key]) => zelle(summe, key, true))}
          </tr>
        </tbody>
      </TabellenRahmen>
      {ohneLeistung > 0 && (
        <button
          type="button"
          onClick={() => setInaktive((v) => !v)}
          style={{
            margin: "14px 0 4px",
            border: "none",
            background: "none",
            padding: 0,
            color: C.accent,
            fontWeight: 600,
            fontSize: 13,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {inaktive
            ? "Einträge ohne Leistung ausblenden"
            : `${ohneLeistung} Einträge ohne Leistung im Zeitraum einblenden`}
        </button>
      )}
    </>
  );
}

function Sichtbarkeit({ snap }) {
  const is = snap.report?.impressionShare;
  const t = snap.totals;
  const p = snap.prev;
  const cpa = t.conversions > 0 ? t.cost / t.conversions : null;
  const cpaPrev = p.conversions > 0 ? p.cost / p.conversions : null;
  const roas = t.cost > 0 ? t.conversionValue / t.cost : null;
  const roasPrev = p.cost > 0 ? p.conversionValue / p.cost : null;
  const runde = (d) => (d == null ? undefined : Math.round(d * 10) / 10);
  const karten = [
    [
      ArrowUpToLine,
      "Impressionen oben (über den Suchergebnissen)",
      prozent(is?.top, 0),
      pctDelta(is?.top, is?.prevTop),
      is?.prevTop != null ? prozent(is.prevTop, 0) : null,
      C.accent,
    ],
    [
      Crown,
      "Impressionen ganz oben (1. Position)",
      prozent(is?.absTop, 0),
      pctDelta(is?.absTop, is?.prevAbsTop),
      is?.prevAbsTop != null ? prozent(is.prevAbsTop, 0) : null,
      C.blue,
    ],
    [
      Coins,
      "Kosten/Conversion",
      cpa == null ? "–" : chf(cpa, 2),
      pctDelta(cpa, cpaPrev),
      cpaPrev != null ? chf(cpaPrev, 2) : null,
      C.orange,
      true,
    ],
    [
      TrendingUp,
      "Conv.-Wert/Kosten (ROAS)",
      roas == null ? "–" : faktor(roas, 1),
      pctDelta(roas, roasPrev),
      roasPrev != null ? faktor(roasPrev, 1) : null,
      C.green,
    ],
  ];
  return (
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
          compareLabel="Vorperiode"
        />
      ))}
    </div>
  );
}

function Tagesverlauf({ series }) {
  const daten = (series || []).map((d) => ({
    tag: String(d.date || "").slice(8, 10) + "." + String(d.date || "").slice(5, 7) + ".",
    Impressionen: d.impressions,
    Klicks: d.clicks,
  }));
  if (!daten.length) return null;
  return (
    <Karte>
      <Abschnitt
        titel="Tägliche Entwicklung"
        hinweis="Impressionen (Balken) und Klicks (Linie) je Tag"
      />
      <div style={{ width: "100%", height: 230 }}>
        <ResponsiveContainer>
          <ComposedChart data={daten} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={C.hairline} vertical={false} />
            <XAxis
              dataKey="tag"
              tick={{ fontSize: 11, fill: C.textMuted }}
              tickLine={false}
              axisLine={false}
              minTickGap={18}
            />
            <YAxis
              yAxisId="i"
              tick={{ fontSize: 11, fill: C.textMuted }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => zahl(v)}
            />
            <YAxis
              yAxisId="k"
              orientation="right"
              tick={{ fontSize: 11, fill: C.textMuted }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v) => zahl(v)}
              contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12.5 }}
            />
            <Legend wrapperStyle={{ fontSize: 12.5 }} />
            <Bar yAxisId="i" dataKey="Impressionen" fill="#e3c2e9" radius={[4, 4, 0, 0]} />
            <Line yAxisId="k" dataKey="Klicks" stroke={C.accent} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Karte>
  );
}

export default function AdsKampagnen({ snap }) {
  const ag = snap.report?.assetGroups;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Sichtbarkeit snap={snap} />
      <Karte style={{ paddingBottom: 10 }}>
        <Abschnitt titel="Kampagnen" hinweis="Spaltentitel anklicken zum Sortieren" />
        <LeistungsTabelle zeilen={snap.campaigns} nameTitel="Kampagne" />
      </Karte>
      <Tagesverlauf series={snap.series} />
      {ag && ag.length > 0 && (
        <Karte style={{ paddingBottom: 10 }}>
          <Abschnitt
            titel="Performance Max: Asset-Gruppen"
            hinweis="Leistung je Asset-Gruppe der PMax-Kampagnen"
          />
          <LeistungsTabelle
            zeilen={ag.map((g) => ({ ...g, conversionValue: g.value }))}
            nameTitel="Asset-Gruppe"
            extraName="campaign"
          />
        </Karte>
      )}
    </div>
  );
}

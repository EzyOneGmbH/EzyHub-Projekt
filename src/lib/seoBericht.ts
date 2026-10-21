// SEO-Berichte aus Vorlagen (15.10.2026, Volkan Punkt 10). Rein deterministisch
// aus gespeicherten Messlaeufen (keine KI), Ausgabe Markdown fuer markdownToHtml
// (Ueberschriften + Listen, keine Tabellen). Fehlende Daten = Abschnitt entfaellt.
import { zaehleRankKacheln } from "./rankKacheln";
import { strikingDistance } from "./strikingDistance";

export const BERICHT_VORLAGEN = {
  monatsreport: "SEO-Monatsreport",
  rankings: "Ranking-Report",
  quickwins: "Quick-Wins-Report",
} as const;
export type BerichtVorlage = keyof typeof BERICHT_VORLAGEN;

export type BerichtDaten = {
  kunde: string;
  datum: string; // YYYY-MM-DD
  rank?: any; // rankings.result
  gscQ?: any; // gsc_queries.result
  gscSum?: any; // gsc_summary.result
  traf?: any; // ga4_traffic.result
  ahrefs?: any; // ahrefs.result
  conv?: any; // ga4_conversions.result
  clusters?: any; // keyword_clusters.result
};

// Tausender-Trenner einheitlich «’»: ICU auf Linux liefert «'», auf Windows «’».
const zahl = (n: unknown) =>
  Math.round(Number(n) || 0)
    .toLocaleString("de-CH")
    .replace(/'/g, "’");
const datumCH = (ymd: string) => {
  const [y, m, d] = String(ymd || "").split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
};

function kennzahlen(d: BerichtDaten): string[] {
  const z: string[] = [];
  const organic = (d.traf?.channels || []).find((c: any) =>
    /^organic search$/i.test(String(c?.channel || "")),
  )?.sessions;
  const ch = (d.traf?.countriesOrganic || []).find((c: any) =>
    /switzerland|schweiz|^ch$/i.test(String(c?.country || "")),
  )?.sessions;
  if (organic != null)
    z.push(
      `- **Organische Besuche (GA4):** ${zahl(organic)}${ch != null ? ` (davon ${zahl(ch)} aus der Schweiz)` : ""}`,
    );
  const m = d.gscSum?.metrics;
  if (m?.clicks != null)
    z.push(
      `- **Google-Suche:** ${zahl(m.clicks)} Klicks bei ${zahl(m.impressions)} Impressionen` +
        (m.position ? `, Ø Position ${Number(m.position).toFixed(1).replace(".", ",")}` : ""),
    );
  const vi = Number(d.ahrefs?.sistrix?.visibility_index);
  if (vi > 0)
    z.push(
      `- **Sichtbarkeitsindex (Sistrix ${String(d.ahrefs?.sistrix?.country || "ch").toUpperCase()}):** ${vi.toLocaleString("de-CH", { maximumFractionDigits: 4 })}`,
    );
  return z;
}

function rankingAbschnitt(d: BerichtDaten, bewegungen = 5): string[] {
  const kw = Array.isArray(d.rank?.keywords) ? d.rank.keywords : [];
  const k = zaehleRankKacheln(kw, d.gscQ?.topNonbrandQueries);
  if (!k) return [];
  const z = [`- **${zahl(k.top3)}** Suchbegriffe in den Top 3, **${zahl(k.top10)}** in den Top 10`];
  const mitDelta = kw.filter((x: any) => x.pos != null && x.posPrev7 != null);
  const besser = [...mitDelta]
    .filter((x: any) => x.pos < x.posPrev7)
    .sort((a: any, b: any) => b.posPrev7 - b.pos - (a.posPrev7 - a.pos))
    .slice(0, bewegungen);
  const schlechter = [...mitDelta]
    .filter((x: any) => x.pos > x.posPrev7)
    .sort((a: any, b: any) => b.pos - b.posPrev7 - (a.pos - a.posPrev7))
    .slice(0, bewegungen);
  if (besser.length) {
    z.push("", "### Grösste Verbesserungen (7 Tage)");
    for (const x of besser) z.push(`- ${x.kw}: Platz ${x.posPrev7} → **${x.pos}**`);
  }
  if (schlechter.length) {
    z.push("", "### Grösste Verluste (7 Tage)");
    for (const x of schlechter) z.push(`- ${x.kw}: Platz ${x.posPrev7} → **${x.pos}**`);
  }
  return z;
}

function conversionAbschnitt(d: BerichtDaten): string[] {
  const org = d.conv?.breakdownByChannel?.["Organic Search"];
  const kanal = (d.conv?.channels || []).find((c: any) =>
    /^organic search$/i.test(String(c?.channel || "")),
  );
  if (!org && !kanal) return [];
  const z: string[] = [];
  if (org) {
    const teile = [
      ["Anrufe", org.phone],
      ["Mail-Klicks", org.mail],
      ["Kontaktanfragen", org.contact],
      ["Routenplaner", org.maps],
    ]
      .filter(([, v]) => Number(v) > 0)
      .map(([l, v]) => `${zahl(v)} ${l}`);
    if (teile.length) z.push(`- **Anfragen aus der organischen Suche:** ${teile.join(", ")}`);
  }
  if (kanal?.conversions != null)
    z.push(
      `- **Conversions «Organic Search»:** ${zahl(kanal.conversions)}` +
        (Number(kanal.revenue) > 0 ? `, Umsatz CHF ${zahl(kanal.revenue)}` : ""),
    );
  return z;
}

function quickWins(d: BerichtDaten, limit: number): string[] {
  const getrackt = new Set<string>(
    (d.rank?.keywords || []).map((k: any) =>
      String(k?.kw || "")
        .trim()
        .toLowerCase(),
    ),
  );
  const sd = strikingDistance(d.gscQ?.topNonbrandQueries, getrackt, { limit });
  return sd.map(
    (s) =>
      `- **${s.query}** — Ø Platz ${String(s.position).replace(".", ",")}, ${zahl(s.impressions)} Impressionen` +
      (s.pageUrl ? `, Seite ${s.pageUrl}` : "") +
      ` → Potenzial +${zahl(s.potenzial)} Klicks`,
  );
}

export function buildSeoBericht(
  vorlage: BerichtVorlage,
  d: BerichtDaten,
): { title: string; markdown: string } {
  const title = `${BERICHT_VORLAGEN[vorlage]} – ${d.kunde} – ${datumCH(d.datum)}`;
  const md: string[] = [
    `# ${BERICHT_VORLAGEN[vorlage]}`,
    `${d.kunde} · Stand ${datumCH(d.datum)}`,
    "",
  ];
  const abschnitt = (titel: string, zeilen: string[], leer?: string) => {
    if (!zeilen.length && !leer) return;
    md.push(`## ${titel}`, ...(zeilen.length ? zeilen : [leer as string]), "");
  };
  if (vorlage === "monatsreport") {
    abschnitt("Kennzahlen", kennzahlen(d));
    abschnitt("Rankings", rankingAbschnitt(d));
    abschnitt("Anfragen & Buchungen", conversionAbschnitt(d));
    abschnitt("Nächste Chancen (Quick Wins)", quickWins(d, 8));
  } else if (vorlage === "rankings") {
    abschnitt("Überblick", rankingAbschnitt(d, 10));
    const kw = (Array.isArray(d.rank?.keywords) ? d.rank.keywords : [])
      .filter((x: any) => x.pos != null)
      .sort((a: any, b: any) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 30)
      .map(
        (x: any) =>
          `- ${x.kw}: Platz **${x.pos}**` +
          (x.posPrev28 != null && x.posPrev28 !== x.pos ? ` (vor 28 Tagen ${x.posPrev28})` : "") +
          (x.volume ? ` · ${zahl(x.volume)} Suchen/Monat` : ""),
      );
    abschnitt("Wichtigste Suchbegriffe (nach Suchvolumen)", kw);
  } else {
    abschnitt(
      "Striking Distance — Begriffe auf Platz 5–20",
      quickWins(d, 20),
      "Aktuell keine Begriffe auf Platz 5–20.",
    );
    const cl = Array.isArray(d.clusters?.clusters) ? d.clusters.clusters : [];
    abschnitt(
      "Mehrere Seiten konkurrieren (Kannibalisierung)",
      cl
        .filter((c: any) => c.kannibalisierung)
        .map((c: any) => `- **${c.name}**: ${(c.seiten || []).join(", ")}`),
    );
    abschnitt(
      "Themen ohne Top-20-Ranking (Lücken)",
      cl
        .filter((c: any) => c.luecke)
        .map((c: any) => `- **${c.name}**${c.hinweis ? ` — ${c.hinweis}` : ""}`),
    );
  }
  md.push("_Erstellt mit EzyHub (Ezy One)._");
  return { title, markdown: md.join("\n") };
}

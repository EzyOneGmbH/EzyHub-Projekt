// EzyBrain-Spiegel (20.11.2026): baut aus den EzyHub-Daten eines Kunden lesbare
// Markdown-Seiten für den Obsidian-Vault. Reine Funktionen ohne DB-Zugriff, damit
// sie testbar bleiben. Geladen werden die Daten in brain-export.server.ts.
//
// Bewusst NICHT gespiegelt: Zugangsdaten (OAuth, Ingest, WordPress), Property-IDs,
// Roh-Ereignisse der Attribution und Personendaten aus dem Conversion-Log. Der Vault
// synchronisiert auf alle Geräte, deshalb stehen dort nur Kennzahlen.

type Zeile = Record<string, any>;

export type BrainDaten = {
  client: { id: string; name: string; domain: string | null };
  /** Letzter erfolgreicher Lauf je audit_type: { result, finished_at }. */
  audits: Record<string, { result: Zeile; finished_at: string | null } | undefined>;
  rankDatum: string | null;
  rank: Zeile[];
  rankVorDatum: string | null;
  rankVor: Zeile[];
  opportunities: Zeile[];
  convEvents: Zeile[];
  convValues: Zeile[];
  convLabels: Zeile[];
  /** Nur die Datumswerte des Conversion-Logs, keine Personendaten. */
  convLogDaten: string[];
  aivReports: Zeile[];
  aivModels: Zeile[];
  aivSov: Zeile[];
  aivSources: Zeile[];
  aivCompetitors: Zeile[];
  /** Nur engine, sessions, conversions. */
  aivAttribution: Zeile[];
  blogTopics: Zeile[];
  blogArticles: Zeile[];
  contentItems: Zeile[];
  siteHealth: Zeile | null;
  facts: Zeile[];
};

export type BrainSeite = { key: string; titel: string; markdown: string };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Zahl mit Schweizer Tausendertrennung; `stellen` Nachkommastellen. */
export function zahl(v: unknown, stellen = 0): string {
  const n = num(v);
  if (n === null) return "–";
  const [ganz, rest] = Math.abs(n).toFixed(stellen).split(".");
  const mitTrenner = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (n < 0 ? "-" : "") + mitTrenner + (rest ? "." + rest : "");
}

const prozent = (v: unknown, stellen = 1): string => {
  const n = num(v);
  return n === null ? "–" : zahl(n * 100, stellen) + " %";
};

/** Text für eine Tabellenzelle: einzeilig, ohne Pipes und ohne Wiki-Link-Klammern. */
export function zelle(v: unknown, max = 140): string {
  if (v === null || v === undefined || v === "") return "–";
  const s = String(v)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\[\[/g, "[ [")
    .replace(/\]\]/g, "] ]")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const datum = (v: unknown): string => {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "–";
};

function tabelle(kopf: string[], zeilen: string[][]): string {
  if (!zeilen.length) return "";
  return [
    "| " + kopf.join(" | ") + " |",
    "| " + kopf.map(() => "---").join(" | ") + " |",
    ...zeilen.map((z) => "| " + z.join(" | ") + " |"),
  ].join("\n");
}

const zeitraum = (r: Zeile | undefined): string =>
  r?.range?.from && r?.range?.to ? `${datum(r.range.from)} bis ${datum(r.range.to)}` : "–";

const liste = (v: unknown): Zeile[] => (Array.isArray(v) ? (v as Zeile[]) : []);

// ── Keywords ────────────────────────────────────────────────────────────────
function seiteKeywords(d: BrainDaten): string[] {
  const t: string[] = [];
  if (d.rank.length) {
    const vor = new Map(d.rankVor.map((r) => [String(r.keyword), num(r.position)]));
    const sort = [...d.rank].sort(
      (a, b) =>
        (num(a.position) ?? 999) - (num(b.position) ?? 999) ||
        String(a.keyword).localeCompare(String(b.keyword)),
    );
    const mitPos = sort.filter((r) => num(r.position) !== null);
    const top = (n: number) => mitPos.filter((r) => (num(r.position) as number) <= n).length;
    t.push(
      `## Ranking-Tracking`,
      `Stand ${datum(d.rankDatum)}, ${zahl(d.rank.length)} Keywords. ` +
        `Top 3: ${top(3)}, Top 10: ${top(10)}, Top 30: ${top(30)}, ` +
        `ohne Platzierung: ${d.rank.length - mitPos.length}.` +
        (d.rankVorDatum ? ` Vergleich mit ${datum(d.rankVorDatum)}.` : ""),
      tabelle(
        ["Keyword", "Position", "Vorher", "Veränderung", "Suchvolumen", "Money", "URL"],
        sort.slice(0, 400).map((r) => {
          const p = num(r.position);
          const v = vor.get(String(r.keyword)) ?? null;
          const diff = p !== null && v !== null ? v - p : null;
          return [
            zelle(r.keyword, 80),
            p === null ? "–" : zahl(p, Number.isInteger(p) ? 0 : 1),
            v === null ? "–" : zahl(v, Number.isInteger(v) ? 0 : 1),
            diff === null || diff === 0 ? "–" : (diff > 0 ? "+" : "") + zahl(diff, 0),
            zahl(r.search_volume),
            r.is_money ? "ja" : "",
            zelle(r.url, 90),
          ];
        }),
      ),
    );
  }
  const q = d.audits.gsc_queries?.result;
  const top = liste(q?.topNonbrandQueries);
  if (q && top.length) {
    const b = q.buckets_nonbrand ?? {};
    t.push(
      `## Suchanfragen aus der Search Console (ohne Marke)`,
      `Zeitraum ${zeitraum(q)}. Marke: ${zahl(q.brand?.clicks)} Klicks aus ${zahl(q.brand?.queries)} Anfragen. ` +
        `Ohne Marke: ${zahl(q.nonbrand?.clicks)} Klicks aus ${zahl(q.nonbrand?.queries)} Anfragen.`,
      tabelle(
        ["Bereich", "Anfragen", "Klicks", "Impressionen"],
        (
          [
            ["Position 1–3", b.top3],
            ["Position 1–10", b.top10],
            ["Position 11–20", b.pos11to20],
            ["Position 21+", b.pos21plus],
          ] as [string, Zeile | undefined][]
        )
          .filter(([, x]) => x)
          .map(([n, x]) => [n, zahl(x?.queries), zahl(x?.clicks), zahl(x?.impressions)]),
      ),
      tabelle(
        ["Suchanfrage", "Klicks", "Impressionen", "Position", "Suchvolumen", "Seite"],
        top
          .slice(0, 150)
          .map((r) => [
            zelle(r.query, 80),
            zahl(r.clicks),
            zahl(r.impressions),
            zahl(r.position, 1),
            zahl(r.volume),
            zelle(r.pageUrl, 90),
          ]),
      ),
    );
  }
  if (d.opportunities.length) {
    t.push(
      `## Keyword-Chancen`,
      tabelle(
        ["Keyword", "Kategorie", "Entscheid", "Volumen", "Schwierigkeit", "Ø Position", "Cluster"],
        d.opportunities
          .slice(0, 200)
          .map((r) => [
            zelle(r.keyword, 80),
            zelle(r.category, 30),
            zelle(r.decision, 30),
            zahl(r.volume),
            zahl(r.difficulty),
            zahl(r.avg_position, 1),
            zelle(r.cluster, 40),
          ]),
      ),
    );
  }
  return t;
}

// ── Traffic ─────────────────────────────────────────────────────────────────
function seiteTraffic(d: BrainDaten): string[] {
  const t: string[] = [];
  const gsc = d.audits.gsc_summary?.result;
  if (gsc?.metrics) {
    const m = gsc.metrics;
    t.push(
      `## Google-Suche (Search Console)`,
      `Zeitraum ${zeitraum(gsc)}.`,
      tabelle(
        ["Klicks", "Impressionen", "CTR", "Ø Position"],
        [[zahl(m.clicks), zahl(m.impressions), prozent(m.ctr, 2), zahl(m.position, 1)]],
      ),
      tabelle(
        ["Top-Suchanfrage", "Klicks", "Impressionen", "CTR", "Position"],
        liste(gsc.topQueries)
          .slice(0, 50)
          .map((r) => [
            zelle(r.query, 80),
            zahl(r.clicks),
            zahl(r.impressions),
            prozent(r.ctr, 1),
            zahl(r.position, 1),
          ]),
      ),
    );
  }
  const ga = d.audits.ga4_summary?.result;
  if (ga?.metrics) {
    const m = ga.metrics;
    t.push(
      `## Website-Besuche (GA4)`,
      `Zeitraum ${zeitraum(ga)}.`,
      tabelle(
        ["Sitzungen", "Nutzer", "Neue Nutzer", "Seitenaufrufe", "Absprungrate", "Conversions"],
        [
          [
            zahl(m.sessions),
            zahl(m.totalUsers),
            zahl(m.newUsers),
            zahl(m.screenPageViews),
            prozent(m.bounceRate, 1),
            zahl(m.conversions),
          ],
        ],
      ),
    );
  }
  const tr = d.audits.ga4_traffic?.result;
  if (tr) {
    const kan = liste(tr.channels);
    if (kan.length)
      t.push(
        `## Kanäle (GA4)`,
        `Zeitraum ${zeitraum(tr)}.`,
        tabelle(
          ["Kanal", "Sitzungen", "Conversions", "Umsatz"],
          kan.map((r) => [
            zelle(r.channel, 40),
            zahl(r.sessions),
            zahl(r.conversions),
            zahl(r.revenue),
          ]),
        ),
      );
    const seiten = liste(tr.topPages);
    if (seiten.length)
      t.push(
        `## Meistbesuchte Seiten`,
        tabelle(
          ["Seite", "Aufrufe"],
          seiten.map((r) => [zelle(r.path, 100), zahl(r.views)]),
        ),
      );
    const ki = tr.aiReferral;
    if (ki && (num(ki.sessions) ?? 0) > 0)
      t.push(
        `## Besuche aus KI-Assistenten`,
        `${zahl(ki.sessions)} Sitzungen von ${zahl(ki.users)} Nutzern.` +
          (tr.googleVsAi
            ? ` Zum Vergleich Google: ${zahl(tr.googleVsAi.google)} Sitzungen von total ${zahl(tr.googleVsAi.total)}.`
            : ""),
        tabelle(
          ["Quelle", "Sitzungen", "Nutzer"],
          liste(ki.bySource).map((r) => [zelle(r.source, 40), zahl(r.sessions), zahl(r.users)]),
        ),
      );
    const land = liste(tr.countries);
    if (land.length)
      t.push(
        `## Länder`,
        tabelle(
          ["Land", "Sitzungen"],
          land.slice(0, 10).map((r) => [zelle(r.country, 40), zahl(r.sessions)]),
        ),
      );
  }
  const ah = d.audits.ahrefs?.result;
  if (ah) {
    const m = ah.metrics?.metrics ?? {};
    const bl = ah.backlinks_stats?.metrics ?? {};
    const z: string[][] = [];
    const dr = num(ah.domain_rating?.domain_rating?.domain_rating);
    if (dr !== null) z.push(["Domain Rating", zahl(dr)]);
    if (num(bl.live_refdomains) !== null) z.push(["Verweisende Domains", zahl(bl.live_refdomains)]);
    if (num(bl.live) !== null) z.push(["Backlinks", zahl(bl.live)]);
    if (num(m.org_keywords) !== null) z.push(["Organische Keywords", zahl(m.org_keywords)]);
    if (num(m.org_keywords_1_3) !== null) z.push(["Davon Position 1–3", zahl(m.org_keywords_1_3)]);
    if (num(m.org_traffic) !== null)
      z.push(["Geschätzter organischer Traffic", zahl(m.org_traffic)]);
    const si = num(ah.sistrix?.visibility_index);
    if (si !== null) z.push(["Sistrix-Sichtbarkeitsindex", zahl(si, 4)]);
    if (z.length)
      t.push(
        `## Autorität und Backlinks`,
        `Stand ${datum(ah.generated_at)}.`,
        tabelle(["Kennzahl", "Wert"], z),
      );
  }
  const ps = d.audits.pagespeed?.result?.metrics;
  if (ps && (num(ps.performanceScore) !== null || num(ps.lcp) !== null)) {
    t.push(
      `## Ladezeit (PageSpeed, ${zelle(ps.strategy ?? "mobile", 20)})`,
      tabelle(
        ["Performance", "LCP (ms)", "INP (ms)", "CLS"],
        [[zahl(ps.performanceScore), zahl(ps.lcp), zahl(ps.inp), zahl(ps.cls, 2)]],
      ),
    );
  }
  const ads = d.audits.google_ads?.result;
  if (ads?.totals && (num(ads.totals.impressions) ?? 0) > 0) {
    const x = ads.totals;
    t.push(
      `## Google Ads`,
      `Zeitraum ${zeitraum(ads)}.`,
      tabelle(
        ["Kosten", "Klicks", "Impressionen", "Conversions", "Conversion-Wert", "ROAS", "CPA"],
        [
          [
            zahl(x.cost, 2),
            zahl(x.clicks),
            zahl(x.impressions),
            zahl(x.conversions, 1),
            zahl(x.conversionValue, 2),
            zahl(ads.roas, 2),
            zahl(ads.cpa, 2),
          ],
        ],
      ),
      tabelle(
        ["Kampagne", "Status", "Kosten", "Klicks", "Conversions", "ROAS"],
        liste(ads.campaigns)
          .slice(0, 25)
          .map((r) => [
            zelle(r.name, 70),
            zelle(r.status, 12),
            zahl(r.cost, 2),
            zahl(r.clicks),
            zahl(r.conversions, 1),
            zahl(r.roas, 2),
          ]),
      ),
    );
  }
  return t;
}

// ── Conversions ─────────────────────────────────────────────────────────────
function seiteConversions(d: BrainDaten): string[] {
  const t: string[] = [];
  const c = d.audits.ga4_conversions?.result;
  if (c) {
    const br = c.breakdown ?? {};
    const kopf: string[][] = [];
    if (num(br.contact) !== null) kopf.push(["Kontakt", zahl(br.contact)]);
    if (num(br.phone) !== null) kopf.push(["Telefon", zahl(br.phone)]);
    if (num(br.mail) !== null) kopf.push(["E-Mail", zahl(br.mail)]);
    if (num(br.maps) !== null) kopf.push(["Karte/Route", zahl(br.maps)]);
    if (num(c.purchases) !== null) kopf.push(["Käufe", zahl(c.purchases)]);
    if (num(c.revenue) !== null) kopf.push(["Umsatz", zahl(c.revenue, 2)]);
    t.push(`## Conversions (GA4)`, `Zeitraum ${zeitraum(c)}.`);
    if (kopf.length) t.push(tabelle(["Art", "Anzahl"], kopf));
    const kan = liste(c.channels);
    if (kan.length)
      t.push(
        `### Nach Kanal`,
        tabelle(
          ["Kanal", "Sitzungen", "Conversions", "Umsatz"],
          kan.map((r) => [
            zelle(r.channel, 40),
            zahl(r.sessions),
            zahl(r.conversions),
            zahl(r.revenue, 2),
          ]),
        ),
      );
    const ev = liste(c.events);
    if (ev.length)
      t.push(
        `### Ereignisse`,
        tabelle(
          ["Ereignis", "Anzahl"],
          ev.slice(0, 40).map((r) => [zelle(r.eventName, 60), zahl(r.count)]),
        ),
      );
  }
  if (d.convEvents.length) {
    const wert = new Map(d.convValues.map((r) => [String(r.event_name), r]));
    const label = new Map(d.convLabels.map((r) => [String(r.event_name), r.label]));
    t.push(
      `## Als Conversion gezählte Ereignisse`,
      tabelle(
        ["Ereignis", "Bezeichnung", "Modus", "Wert"],
        d.convEvents.map((r) => {
          const w = wert.get(String(r.event_name));
          return [
            zelle(r.event_name, 60),
            zelle(label.get(String(r.event_name)), 60),
            zelle(r.modus, 20),
            w ? `${zahl(w.value, 2)} ${zelle(w.currency ?? "", 5)}`.trim() : "–",
          ];
        }),
      ),
    );
  }
  if (d.convLogDaten.length) {
    const proMonat = new Map<string, number>();
    for (const s of d.convLogDaten) {
      const k = String(s).slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(k)) proMonat.set(k, (proMonat.get(k) ?? 0) + 1);
    }
    t.push(
      `## Erfasste Anfragen (Conversion-Log)`,
      `Nur die Anzahl pro Monat. Namen und Kontaktdaten bleiben in EzyHub.`,
      tabelle(
        ["Monat", "Anfragen"],
        [...proMonat.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 24)
          .map(([k, n]) => [`${k.slice(5)}.${k.slice(0, 4)}`, zahl(n)]),
      ),
    );
  }
  const akt = liste(d.audits.google_ads?.result?.conversionActions);
  if (akt.length)
    t.push(
      `## Conversion-Aktionen in Google Ads`,
      tabelle(
        ["Aktion", "Anzahl", "Wert"],
        akt.map((r) => [zelle(r.name, 70), zahl(r.count, 1), zahl(r.value, 2)]),
      ),
    );
  return t;
}

// ── KI-Sichtbarkeit ─────────────────────────────────────────────────────────
function seiteKi(d: BrainDaten): string[] {
  const t: string[] = [];
  // Neuester Bericht je Markt (aivReports ist absteigend nach Datum sortiert).
  const jeMarkt = new Map<string, Zeile>();
  for (const r of d.aivReports) {
    const k = String(r.market ?? "");
    if (!jeMarkt.has(k)) jeMarkt.set(k, r);
  }
  const aktuell = [...jeMarkt.values()].slice(0, 6);
  if (aktuell.length) {
    t.push(
      `## Aktueller Stand`,
      tabelle(
        ["Markt", "Datum", "Score", "Veränderung", "Erwähnungen", "Zitate", "Zitierte Seiten"],
        aktuell.map((r) => [
          zelle(r.market || "Alle", 30),
          datum(r.snapshot_date),
          zahl(r.score),
          num(r.score_delta)
            ? ((num(r.score_delta) as number) > 0 ? "+" : "") + zahl(r.score_delta)
            : "–",
          zahl(r.mentions),
          zahl(r.citations),
          zahl(r.cited_pages),
        ]),
      ),
    );
    const ids = new Set(aktuell.map((r) => String(r.id)));
    const markt = new Map(aktuell.map((r) => [String(r.id), r.market || "Alle"]));
    const mod = d.aivModels.filter((r) => ids.has(String(r.report_id)));
    if (mod.length)
      t.push(
        `## KI-Systeme`,
        tabelle(
          ["Markt", "System", "Erwähnungen", "Anteil"],
          mod
            .sort((a, b) => (num(b.mentions) ?? 0) - (num(a.mentions) ?? 0))
            .slice(0, 40)
            .map((r) => [
              zelle(markt.get(String(r.report_id)), 30),
              zelle(r.model_name, 40),
              zahl(r.mentions),
              zahl(r.sov, 1),
            ]),
        ),
      );
    const sov = d.aivSov.filter((r) => ids.has(String(r.report_id)));
    if (sov.length)
      t.push(
        `## Anteil gegenüber Mitbewerbern`,
        tabelle(
          ["Markt", "Marke", "Erwähnungen", "Anteil"],
          sov
            .sort((a, b) => (num(b.mentions) ?? 0) - (num(a.mentions) ?? 0))
            .slice(0, 40)
            .map((r) => [
              zelle(markt.get(String(r.report_id)), 30),
              zelle(r.brand, 50) + (r.is_self ? " (Kunde)" : ""),
              zahl(r.mentions),
              zahl(r.share, 1),
            ]),
        ),
      );
    const src = d.aivSources.filter((r) => ids.has(String(r.report_id)));
    if (src.length)
      t.push(
        `## Meistzitierte Quellen`,
        tabelle(
          ["Markt", "Domain", "Erwähnungen", "Anteil"],
          src
            .sort((a, b) => (num(b.mentions) ?? 0) - (num(a.mentions) ?? 0))
            .slice(0, 30)
            .map((r) => [
              zelle(markt.get(String(r.report_id)), 30),
              zelle(r.domain, 60),
              zahl(r.mentions),
              zahl(r.share, 1),
            ]),
        ),
      );
    const att = d.aivAttribution.filter((r) => ids.has(String(r.report_id)));
    if (att.some((r) => (num(r.sessions) ?? 0) > 0))
      t.push(
        `## Besuche und Conversions aus KI-Systemen`,
        tabelle(
          ["Markt", "System", "Sitzungen", "Conversions"],
          att
            .filter((r) => (num(r.sessions) ?? 0) > 0)
            .map((r) => [
              zelle(markt.get(String(r.report_id)), 30),
              zelle(r.engine, 40),
              zahl(r.sessions),
              zahl(r.conversions),
            ]),
        ),
      );
    // Verlauf des ersten (neuesten) Markts.
    const hauptMarkt = String(aktuell[0].market ?? "");
    const verlauf = d.aivReports.filter((r) => String(r.market ?? "") === hauptMarkt).slice(0, 12);
    if (verlauf.length > 1)
      t.push(
        `## Verlauf (${zelle(hauptMarkt || "Alle", 30)})`,
        tabelle(
          ["Datum", "Score", "Erwähnungen", "Zitate"],
          verlauf.map((r) => [
            datum(r.snapshot_date),
            zahl(r.score),
            zahl(r.mentions),
            zahl(r.citations),
          ]),
        ),
      );
  }
  const mit = d.aivCompetitors.filter((r) => r.active !== false);
  if (mit.length)
    t.push(`## Beobachtete Mitbewerber`, mit.map((r) => `- ${zelle(r.name, 80)}`).join("\n"));
  return t;
}

// ── Content ─────────────────────────────────────────────────────────────────
function seiteContent(d: BrainDaten): string[] {
  const t: string[] = [];
  if (d.blogArticles.length)
    t.push(
      `## Blog-Artikel (Autopilot)`,
      tabelle(
        ["Titel", "Status", "Fokus-Keyword", "Wörter", "Veröffentlicht", "Link"],
        d.blogArticles.map((r) => [
          zelle(r.title, 80),
          zelle(r.status, 20),
          zelle(r.focus_keyword, 50),
          zahl(r.word_count),
          datum(r.published_at),
          zelle(r.wp_permalink, 100),
        ]),
      ),
    );
  if (d.blogTopics.length)
    t.push(
      `## Themenplan`,
      tabelle(
        ["Thema", "Keyword", "Cluster", "Typ", "Volumen", "Geplant", "Freigegeben"],
        d.blogTopics.map((r) => [
          zelle(r.title, 80),
          zelle(r.keyword, 50),
          zelle(r.cluster, 30),
          zelle(r.article_type, 20),
          zahl(r.volume),
          datum(r.scheduled_for),
          r.approved_at ? datum(r.approved_at) : "–",
        ]),
      ),
    );
  if (d.contentItems.length)
    t.push(
      `## Inhalte auf der Website`,
      tabelle(
        ["Titel", "Typ", "Keyword", "Volumen", "Veröffentlicht", "Index", "URL"],
        d.contentItems.map((r) => [
          zelle(r.title, 80),
          zelle(r.content_type, 12),
          zelle(r.primary_keyword, 50),
          zahl(r.keyword_volume),
          datum(r.published_at),
          zelle(r.index_verdict, 20),
          zelle(r.target_url, 100),
        ]),
      ),
    );
  const sc = d.siteHealth?.scores;
  if (sc && typeof sc === "object")
    t.push(
      `## Website-Check`,
      `Stand ${datum(d.siteHealth?.at)}, geprüft: ${zelle(d.siteHealth?.url, 100)}.`,
      tabelle(
        ["Gesamt", "Technik", "Inhalt", "AEO"],
        [[zahl(sc.overall), zahl(sc.technical), zahl(sc.content), zahl(sc.aeo)]],
      ),
    );
  if (d.facts.length)
    t.push(
      `## Kundenfakten`,
      tabelle(
        ["Fakt", "Wert", "Geprüft"],
        d.facts.map((r) => [zelle(r.label, 60), zelle(r.value, 400), datum(r.verified_at)]),
      ),
    );
  return t;
}

const BEREICHE: { key: string; titel: string; bau: (d: BrainDaten) => string[] }[] = [
  { key: "keywords", titel: "Keywords", bau: seiteKeywords },
  { key: "traffic", titel: "Traffic", bau: seiteTraffic },
  { key: "conversions", titel: "Conversions", bau: seiteConversions },
  { key: "ki-sichtbarkeit", titel: "KI-Sichtbarkeit", bau: seiteKi },
  { key: "content", titel: "Content", bau: seiteContent },
];

/** Baut die Markdown-Seiten eines Kunden. Bereiche ohne Daten entfallen. */
export function baueBrainSeiten(d: BrainDaten, stand: string): BrainSeite[] {
  const seiten: BrainSeite[] = [];
  for (const b of BEREICHE) {
    const teile = b.bau(d).filter((s) => s !== "");
    if (!teile.length) continue;
    const kopf = [
      "---",
      "type: daten",
      `bereich: ${b.key}`,
      `clientId: ${d.client.id}`,
      `stand: ${stand.slice(0, 10)}`,
      "quelle: EzyHub",
      "---",
      "",
      `# ${b.titel}: ${zelle(d.client.name, 120)}`,
      "",
      `> Automatisch aus EzyHub gespiegelt, Stand ${datum(stand)}. Änderungen an dieser Seite werden beim nächsten Abgleich überschrieben.`,
      "",
    ].join("\n");
    seiten.push({ key: b.key, titel: b.titel, markdown: kopf + teile.join("\n\n") + "\n" });
  }
  return seiten;
}

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const {
  bereinigeLinks,
  datumZuerich,
  entferneClaims,
  entferneSatz,
  EntwurfSchema,
  loeseClaims,
  modusFuer,
  normUrl,
  pruefeBehauptungen,
  schweiz,
  setzeCta,
  slugify,
  versionAb,
  waehleKategorie,
  zaehleCta,
  bereinigeHtml,
  entwurfPrompt,
} = await import("./blog-pipeline.server");

const CTA = {
  label: "Jetzt spenden",
  position: "end",
  text: "Jeder Beitrag fliesst in sauberes Trinkwasser.",
  url: "https://faithinhumanity.ch/spenden/",
};

describe("Faktencheck (Kap. 10 Pipeline)", () => {
  it("Text mit «45 Kommentare … 13 %» ohne Quelle → Claim offen", () => {
    const html =
      "<p>Der Beitrag erhielt 45 Kommentare.</p><p>Nur 13 % der Haushalte haben Zugang.</p>";
    const c = pruefeBehauptungen({ html, claims: [], quellen: [], eigen: "faithinhumanity.ch" });
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c.every((x) => x.status === "offen")).toBe(true);
    expect(c.some((x) => x.text.includes("13 %"))).toBe(true);
  });

  it("Reste rund um markierte Behauptungen sind kein eigener Satz (Fehlalarm «Overview 2026»)", () => {
    const q = "https://www.unocha.org/gho-2026";
    const html =
      "<h2>Wie gross ist der Bedarf 2026?</h2>" +
      `<p>Die UNO veröffentlicht jedes Jahr einen Hilfsaufruf. Laut dem <a href="${q}">Global Humanitarian Overview 2026 der UNO-Nothilfekoordination OCHA</a> ` +
      '<span data-claim="2">benötigen 239 Millionen Menschen humanitäre Hilfe.</span> ' +
      '<span data-claim="3">Der Gesamtaufruf beträgt 33 Milliarden US-Dollar.</span></p>' +
      '<p>Gleichzeitig fehlt das Geld: <span data-claim="4">Der Aufruf des Vorjahres war nur mit rund 12 Milliarden US-Dollar finanziert.</span> ' +
      'Afrika ist besonders betroffen. <span data-claim="5">An der Spitze steht 2026 der Sudan mit 33,7 Millionen Menschen in Not</span>, wie die OCHA-Übersicht «At a glance» zeigt.</p>';
    const c = pruefeBehauptungen({
      html,
      claims: [2, 3, 4, 5].map((n) => ({ n, typ: "statistik", quelle_url: q })),
      quellen: [q],
      eigen: "faithinhumanity.ch",
    });
    expect(c.map((x) => x.n)).toEqual([2, 3, 4, 5]);
    expect(c.every((x) => x.status === "belegt")).toBe(true);
  });

  it("unmarkierte Zahl neben einer markierten Behauptung bleibt offen, mit ganzem Satz", () => {
    const html =
      '<p>Im Dorf leben rund 2000 Kinder, <span data-claim="1">13 % davon ohne sauberes Wasser.</span></p>' +
      "<p>Absatz ohne Punkt am Ende</p><p>Der Verein wurde 2018 gegründet.</p>";
    const c = pruefeBehauptungen({
      html,
      claims: [{ n: 1, quelle_url: "https://faithinhumanity.ch/projekte/" }],
      quellen: [],
      eigen: "faithinhumanity.ch",
    });
    const ohne = c.filter((x) => x.n >= 1000).map((x) => x.text);
    expect(ohne).toEqual([
      "Im Dorf leben rund 2000 Kinder, 13 % davon ohne sauberes Wasser.",
      "Der Verein wurde 2018 gegründet.",
    ]);
    expect(c.find((x) => x.n === 1)?.status).toBe("belegt");
  });

  it("markierte Behauptung mit Recherche-Quelle ist belegt, ohne Quelle offen", () => {
    const html =
      '<p><span data-claim="1">2 Milliarden Menschen haben kein sicheres Trinkwasser.</span> ' +
      '<span data-claim="2">Ein Kiosk kostet 30 000 Franken.</span></p>';
    const c = pruefeBehauptungen({
      html,
      claims: [
        { n: 1, typ: "statistik", quelle_url: "https://www.who.int/news/item/x/" },
        { n: 2, typ: "preis", quelle_url: "https://erfunden.example/y" },
      ],
      quellen: ["https://who.int/news/item/x"],
      eigen: "faithinhumanity.ch",
    });
    expect(c.find((x) => x.n === 1)?.status).toBe("belegt");
    expect(c.find((x) => x.n === 2)?.status).toBe("offen");
  });

  it("Quelle von der eigenen Website gilt als Beleg", () => {
    const c = pruefeBehauptungen({
      html: '<p><span data-claim="1">Der Verein wurde 2018 gegründet.</span></p>',
      claims: [{ n: 1, typ: "zahl", quelle_url: "https://faithinhumanity.ch/ueber-uns/" }],
      quellen: [],
      eigen: "faithinhumanity.ch",
    });
    expect(c).toHaveLength(1);
    expect(c[0].status).toBe("belegt");
  });

  it("Markierungen: für WordPress aufgelöst, einzelne entfernbar", () => {
    const html = '<p><span data-claim="1">A 10 %.</span> <span data-claim="2">B 20 %.</span></p>';
    expect(loeseClaims(html)).toBe("<p>A 10 %. B 20 %.</p>");
    expect(entferneClaims(html, new Set([1]))).toBe('<p> <span data-claim="2">B 20 %.</span></p>');
  });

  it("unmarkierter Satz lässt sich entfernen", () => {
    const r = entferneSatz(
      "<p>Erster Satz. Es sind 450 Kinder.</p><p>Rest</p>",
      "Es sind 450 Kinder.",
    );
    expect(r.ok).toBe(true);
    expect(r.html).toBe("<p>Erster Satz.</p><p>Rest</p>");
  });
});

describe("CTA-Block", () => {
  it("ist in jedem Artikel genau einmal vorhanden", () => {
    const einmal = setzeCta("<p>Text</p>", CTA);
    expect(zaehleCta(einmal)).toBe(1);
    expect(zaehleCta(setzeCta(einmal, CTA))).toBe(1);
    expect(zaehleCta(setzeCta("<p>{{cta}}</p><p>x</p><p>{{cta}}</p>", CTA))).toBe(1);
    expect(setzeCta("<p>Text</p>", CTA)).toContain('href="https://faithinhumanity.ch/spenden/"');
  });

  it("Position mitte ersetzt den ersten Platzhalter", () => {
    const h = setzeCta("<p>a</p><p>{{cta}}</p><p>b</p>", { ...CTA, position: "mitte" });
    expect(zaehleCta(h)).toBe(1);
    expect(h.indexOf("ezyrank-cta")).toBeLessThan(h.indexOf("<p>b</p>"));
  });
});

describe("Anführungszeichen", () => {
  it("einfache Anführungszeichen werden vor Link- und Claim-Prüfung vereinheitlicht", () => {
    const html = bereinigeHtml(
      "<p><a href='https://www.solafrica.ch/x'>M</a> <span data-claim='1'>13 % ohne Wasser.</span></p>",
    );
    const r = bereinigeLinks(html, {
      eigen: "faithinhumanity.ch",
      gesperrt: ["solafrica.ch"],
      erreichbar: () => true,
    });
    expect(r.html).not.toContain("solafrica");
    const c = pruefeBehauptungen({
      html,
      claims: [{ n: 1, quelle_url: null }],
      quellen: [],
      eigen: "x.ch",
    });
    expect(c.find((x) => x.n === 1)?.status).toBe("offen");
    expect(bereinigeHtml("<p>Es ist's gut</p>")).toBe("<p>Es ist's gut</p>");
  });
});

describe("Links", () => {
  it("Mitbewerber und tote Links fallen weg, extern nofollow, intern bleibt", () => {
    const html =
      '<p><a href="https://faithinhumanity.ch/x/">intern</a> ' +
      '<a href="https://www.solafrica.ch/a">Mitbewerber</a> ' +
      '<a href="https://who.int/b" target="_blank">WHO</a> ' +
      '<a href="https://tot.example/c">tot</a></p>';
    const r = bereinigeLinks(html, {
      eigen: "faithinhumanity.ch",
      gesperrt: ["solafrica.ch"],
      erreichbar: (u) => !u.includes("tot.example"),
    });
    expect(r.html).toContain('<a href="https://faithinhumanity.ch/x/">intern</a>');
    expect(r.html).toContain('<a href="https://who.int/b" rel="nofollow noopener">WHO</a>');
    expect(r.html).not.toContain("solafrica");
    expect(r.html).not.toContain("tot.example");
    expect(r.html).toContain("Mitbewerber");
    expect(r.entfernt).toHaveLength(2);
  });
});

describe("Modus, Kategorie, Helfer", () => {
  const blog = ["https://faithinhumanity.ch/humanitaere-nothilfe/"];
  it("Refresh nur für Blogartikel, Projektseite → Vorschläge", () => {
    expect(modusFuer("neu", null, blog)).toBe("neu");
    expect(modusFuer("refresh", "https://www.faithinhumanity.ch/humanitaere-nothilfe", blog)).toBe(
      "refresh",
    );
    expect(
      modusFuer("refresh", "https://faithinhumanity.ch/projektes/trinkwasser-stationen/", blog),
    ).toBe("vorschlag");
  });

  it("nie Uncategorized, wenn andere passen", () => {
    const k = [
      { id: 1, name: "Uncategorized", slug: "uncategorized", count: 50 },
      { id: 7, name: "Trinkwasser", slug: "trinkwasser", count: 3 },
      { id: 9, name: "Nothilfe", slug: "nothilfe", count: 8 },
    ];
    expect(waehleKategorie([1], k)).toEqual([9]);
    expect(waehleKategorie([7], k)).toEqual([7]);
    expect(waehleKategorie([], k, [7])).toEqual([7]);
    expect(waehleKategorie([5], [{ id: 1, name: "Allgemein", slug: "allgemein" }])).toEqual([]);
  });

  it("Helfer", () => {
    expect(normUrl("https://www.X.ch/a/?q=1#b")).toBe("x.ch/a");
    expect(slugify("Trinkwasser für Ghana: Grösse & Maß")).toBe(
      "trinkwasser-fuer-ghana-groesse-mass",
    );
    expect(schweiz("Straße", "de-CH")).toBe("Strasse");
    expect(schweiz("Straße", "de-DE")).toBe("Straße");
    expect(versionAb("2.0.1", "2.0.1")).toBe(true);
    expect(versionAb("2.0.0", "2.0.1")).toBe(false);
    expect(versionAb("2.1", "2.0.1")).toBe(true);
    expect(datumZuerich(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
    expect(bereinigeHtml('<h1>T</h1><script>x</script><p onclick="y">a</p>')).toBe(
      "<h2>T</h2><p>a</p>",
    );
  });

  it("Entwurf-Schema ist tolerant", () => {
    const e = EntwurfSchema.parse({ title: "T", content_html: "<p>x</p>", claims: "kaputt" });
    expect(e.claims).toEqual([]);
    expect(e.featured_image_url).toBeNull();
  });

  it("Prompt enthält Regeln, Sperrliste und keinen eigenen CTA", () => {
    const p = entwurfPrompt(
      { domain: "faithinhumanity.ch", language: "de-CH", cta_blocks: [CTA], internal_links: 3 },
      {
        modus: "neu",
        keyword: "trinkwasser ghana",
        regeln: ["Keine Mitbewerber verlinken."],
        gesperrt: ["solafrica.ch"],
        fakten: [],
        auszuege: [],
        links: [],
        kategorien: [],
        bilder: [],
      },
      [],
    );
    expect(p).toContain("Keine Mitbewerber verlinken.");
    expect(p).toContain("solafrica.ch");
    expect(p).toContain("KEINEN eigenen Spendenaufruf");
    expect(p).toContain("nie «ß»");
  });
});

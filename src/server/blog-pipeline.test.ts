import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const {
  bereinigeLinks,
  ctaAktuell,
  datumZuerich,
  entferneClaims,
  entferneSatz,
  EntwurfSchema,
  linkStatus,
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
  NEUTRAL_REGELN,
  STIL_REGELN,
  TYP_HINWEIS,
  recherchePrompt,
  sprachRegel,
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

  it("kommt ohne <div> und ohne class auf <a> aus (Filter im WordPress-Plugin)", () => {
    const h = setzeCta("<p>Text</p>", CTA);
    expect(h).not.toContain("<div");
    expect(h).not.toMatch(/<a\b[^>]*\bclass=/);
    expect(h).toContain('<p class="ezyrank-cta ezyrank-cta-text">Jeder Beitrag');
    expect(h).toContain(
      '<p class="ezyrank-cta ezyrank-cta-button"><a href="https://faithinhumanity.ch/spenden/"><strong>Jetzt spenden</strong></a></p>',
    );
    expect(zaehleCta(setzeCta("<p>Text</p>", { ...CTA, text: "" }))).toBe(1);
    expect(zaehleCta(setzeCta("<p>Text</p>", { ...CTA, url: "" }))).toBe(1);
    expect(zaehleCta("<p>Text</p>")).toBe(0);
  });

  it("frühere <div>-Form wird ersetzt und für WordPress umgeschrieben", () => {
    const alt =
      '<p>Text</p>\n<div class="ezyrank-cta"><p>Jeder Beitrag.</p>' +
      '<p><a class="ezyrank-cta-button" href="https://faithinhumanity.ch/spenden/"><strong>Jetzt spenden</strong></a></p></div>';
    expect(zaehleCta(alt)).toBe(1);
    const neu = setzeCta(alt, CTA);
    expect(zaehleCta(neu)).toBe(1);
    expect(neu).not.toContain("<div");
    const um = ctaAktuell(alt);
    expect(um).toBe(
      '<p>Text</p>\n<p class="ezyrank-cta ezyrank-cta-text">Jeder Beitrag.</p>' +
        '<p class="ezyrank-cta ezyrank-cta-button"><a href="https://faithinhumanity.ch/spenden/"><strong>Jetzt spenden</strong></a></p>',
    );
    expect(ctaAktuell(um)).toBe(um);
    expect(zaehleCta(um)).toBe(1);
  });

  it("CTA-Text wird nicht als Behauptung geprüft", () => {
    const h = setzeCta("<p>Text ohne Zahl.</p>", { ...CTA, text: "Schon 20 Franken helfen." });
    expect(pruefeBehauptungen({ html: h, claims: [], quellen: [], eigen: "x.ch" })).toEqual([]);
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

  it("CTA-Link bleibt unangetastet", () => {
    const h = setzeCta('<p><a href="https://who.int/b">WHO</a></p>', {
      ...CTA,
      url: "https://spenden.example/x",
    });
    const r = bereinigeLinks(h, {
      eigen: "faithinhumanity.ch",
      gesperrt: [],
      erreichbar: () => false,
    });
    expect(r.html).toContain('<a href="https://spenden.example/x"><strong>');
    expect(r.entfernt).toEqual(["https://who.int/b"]);
    expect(zaehleCta(r.html)).toBe(1);
  });

  it("Link gilt nur bei klarem 404/410 als tot", async () => {
    const u = "https://www.unocha.org/x.pdf";
    const antwort = (...status: (number | null)[]) => {
      let i = 0;
      return (async () => {
        const s = status[Math.min(i++, status.length - 1)];
        if (s === null) throw new Error("timeout");
        return { status: s };
      }) as unknown as typeof fetch;
    };
    expect(await linkStatus(u, antwort(200))).toBe("ok");
    expect(await linkStatus(u, antwort(405, 200))).toBe("ok");
    expect(await linkStatus(u, antwort(404))).toBe("tot");
    expect(await linkStatus(u, antwort(null, 410))).toBe("tot");
    expect(await linkStatus(u, antwort(null))).toBe("unklar");
    expect(await linkStatus(u, antwort(403))).toBe("unklar");
    expect(await linkStatus(u, antwort(503))).toBe("unklar");
    expect(await linkStatus(u, antwort(404, null))).toBe("unklar");
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
    expect(p).toContain("Anrede (du/Sie)");
  });

  const BRIEF = {
    modus: "neu",
    keyword: "eau potable ghana",
    regeln: [],
    gesperrt: [],
    fakten: [],
    auszuege: [],
    links: [],
    kategorien: [],
    bilder: [],
  };

  it("fester Themenplan: Arbeitstitel, Zielgruppe, Zielfrage und zitierfähiges Element im Prompt", () => {
    const ohne = entwurfPrompt({ domain: "beispiel.ch", language: "de-CH" }, BRIEF, []);
    expect(ohne).not.toContain("Zielfrage:");
    expect(ohne).not.toContain("Arbeitstitel:");
    const mit = entwurfPrompt(
      { domain: "beispiel.ch", language: "de-CH" },
      {
        ...BRIEF,
        titel: "Barrierefrei tagen",
        zielgruppe: "Verbände",
        zielfrage: "Welches Tagungshotel bei Zug ist barrierefrei?",
        zitierbar: "Checkliste Barrierefreiheit",
      },
      [],
    );
    expect(mit).toContain("Arbeitstitel: «Barrierefrei tagen»");
    expect(mit).toContain("Zielgruppe dieses Artikels: Verbände.");
    expect(mit).toContain("«Welches Tagungshotel bei Zug ist barrierefrei?»");
    expect(mit).toContain("in den ersten drei Sätzen");
    expect(mit).toContain("Checkliste Barrierefreiheit");
    expect(mit).toContain("ohne Nennung des Auftraggebers");
    expect(mit).toContain("dessen Überschrift den Auftraggeber beim Namen nennt");
  });

  it("Stil: Fliesstext und kein KI-Ton für alle, keine Werbung ausser bei Seitenvorschlägen", () => {
    const neu = entwurfPrompt({ domain: "beispiel.ch", language: "de-CH" }, BRIEF, []);
    expect(neu).toContain("Stil (verbindlich):");
    for (const r of [...STIL_REGELN, ...NEUTRAL_REGELN]) expect(neu).toContain(`- ${r}`);
    const vorschlag = entwurfPrompt(
      { domain: "beispiel.ch", language: "de-CH" },
      { ...BRIEF, modus: "vorschlag", original_url: "https://beispiel.ch/x" },
      [],
    );
    expect(vorschlag).toContain(STIL_REGELN[0]);
    expect(vorschlag).not.toContain(NEUTRAL_REGELN[0]);
    expect([...STIL_REGELN, ...NEUTRAL_REGELN].join(" ")).not.toContain("ß");
  });

  it("Kundenabschnitt: gebündelt nach den Kriterien, keine Hintergrundstatistik", () => {
    const p = { domain: "beispiel.ch", language: "de-CH" };
    const text = entwurfPrompt(p, { ...BRIEF, zielfrage: "Passt das Haus für 50 Personen?" }, []);
    expect(text).toContain("gebündelt in genau einem Abschnitt, direkt nach dem allgemeinen Teil");
    expect(text).toContain("Sein erster Satz sagt, ob und unter welchen Bedingungen es passt.");
    expect(text).toContain("Keine Branchen-, Markt- oder Regionsstatistik");
    expect(text).toContain("Schreibe nie über die Recherche oder ihre Lücken");
  });

  it("Formhinweis je Artikeltyp: nur bei neuem Artikel mit bekanntem Typ", () => {
    const p = { domain: "beispiel.ch", language: "de-CH" };
    const mit = entwurfPrompt(p, { ...BRIEF, article_type: "anleitung" }, []);
    expect(mit).toContain(`Form für diesen Artikeltyp: ${TYP_HINWEIS.anleitung}`);
    expect(entwurfPrompt(p, BRIEF, [])).not.toContain("Form für diesen Artikeltyp");
    expect(entwurfPrompt(p, { ...BRIEF, article_type: "unbekannt" }, [])).not.toContain(
      "Form für diesen Artikeltyp",
    );
    expect(Object.values(TYP_HINWEIS).join(" ")).not.toContain("ß");
  });

  it("Französisch und Englisch: der ganze Artikel in der Zielsprache, kein Schweizer-ss-Hinweis", () => {
    const fr = entwurfPrompt({ domain: "exemple.ch", language: "fr-CH" }, BRIEF, []);
    expect(fr).toContain("auf Französisch (Schweiz): Titel, Überschriften");
    expect(fr).toContain("Bild-Alt-Text");
    expect(fr).toContain("Anrede (tu/vous)");
    expect(fr).not.toContain("nie «ß»");
    expect(fr).not.toContain("du/Sie");

    const en = entwurfPrompt({ domain: "example.com", language: "en" }, BRIEF, []);
    expect(en).toContain("auf Englisch: Titel");
    expect(en).toContain("Anführungszeichen “…”");

    const vorschlag = entwurfPrompt(
      { domain: "example.com", language: "en" },
      { ...BRIEF, modus: "vorschlag", original_url: "https://example.com/x" },
      [],
    );
    expect(vorschlag).not.toContain("Vorschläge: …");
    expect(recherchePrompt({ domain: "example.com", language: "en" }, BRIEF)).toContain(
      "Formuliere die Fakten auf Englisch",
    );
    expect(recherchePrompt({ domain: "beispiel.ch" }, BRIEF)).not.toContain(
      "Formuliere die Fakten",
    );
  });

  it("sprachRegel: Deutsch bleibt wie bisher, unbekannte Sprache wird benannt", () => {
    expect(sprachRegel(undefined)).toMatchObject({ code: "de-CH", fremd: false });
    expect(sprachRegel("de-DE").zeile).toBe("Sprache: de-DE");
    expect(sprachRegel("it-CH")).toMatchObject({
      name: "Italienisch (Schweiz)",
      mehr: "Scopri di più",
    });
    expect(sprachRegel("es").zeile).toContain("auf es:");
  });

  it("CTA ohne eigenen Button-Text spricht die Artikelsprache", () => {
    const cta = { url: "https://exemple.ch/don/" };
    expect(setzeCta("<p>Texte</p>", cta, "fr-CH")).toContain("En savoir plus");
    expect(setzeCta("<p>Text</p>", cta)).toContain("Mehr erfahren");
    expect(setzeCta("<p>Texte</p>", { ...cta, label: "Faire un don" }, "fr-CH")).toContain(
      "Faire un don",
    );
  });
});

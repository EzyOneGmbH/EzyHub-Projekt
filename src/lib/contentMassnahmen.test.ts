import { describe, expect, it } from "vitest";
import {
  ACTION_RECS,
  REC_PLAYBOOK,
  REC_TEXTE,
  baueAktionen,
  gateText,
  ohneEszett,
  prioritaet,
  recVonTyp,
  titelKlartext,
} from "./contentMassnahmen";
import { jsonAusText, luecken, normalisiereEmpfehlung } from "@/server/content-actions.server";

const zeile = (o: Record<string, unknown>) => ({
  id: "x",
  url: "https://h.ch/a",
  title: "A",
  primary_keyword: "kw",
  clicks_28: 3,
  peak_clicks_28: 9,
  position_28: 14.2,
  impr_28: 800,
  ...o,
});

describe("contentMassnahmen", () => {
  it("Texte wie im Modal", () => {
    expect(REC_TEXTE.push_expand.t).toBe("Striking Distance – ausbauen");
    expect(REC_PLAYBOOK.push_expand.schritte[0]).toMatch(/^Top 5 der SERP/);
    expect(ACTION_RECS).toHaveLength(8);
  });

  it("baut Massnahmen nur für handlungsbedürftige Artikel, nach Priorität", () => {
    const a = baueAktionen([
      zeile({ recommendation: "push_expand" }),
      zeile({ url: "https://h.ch/b", recommendation: "stable_hold" }),
      zeile({ url: "https://h.ch/c", recommendation: "not_indexed", impr_28: 0 }),
    ]);
    expect(a.map((x) => x.action_id)).toEqual([
      "not_indexed|https://h.ch/c",
      "striking_distance|https://h.ch/a",
    ]);
    expect(a[1]).toMatchObject({
      type: "striking_distance",
      label: "Striking Distance – ausbauen",
      clicks_28d: 3,
      clicks_peak: 9,
      position_avg: 14.2,
      impressions_28d: 800,
      done_when: REC_PLAYBOOK.push_expand.exit,
    });
    expect(baueAktionen([])).toEqual([]);
  });

  it("Priorität: Stufen überschneiden sich nicht", () => {
    const ni = prioritaet({ recommendation: "not_indexed", impr_28: 0 });
    const sd = prioritaet({ recommendation: "push_expand", impr_28: 1e9, peak_clicks_28: 1e9 });
    expect(ni).toBe(80);
    expect(sd).toBeLessThan(50);
    expect(prioritaet({ recommendation: "stable_hold" })).toBe(0);
  });

  it("Typ-Namen", () => {
    expect(recVonTyp("striking_distance")).toBe("push_expand");
    expect(recVonTyp("push_expand")).toBe("push_expand");
    expect(recVonTyp("quatsch")).toBeNull();
  });

  it("ß → ss rekursiv", () => {
    expect(ohneEszett({ a: ["Größe"], b: "Maß" })).toEqual({ a: ["Grösse"], b: "Mass" });
  });
});

describe("Empfehlung normalisieren", () => {
  it("liest JSON aus Code-Block und filtert interne Links", () => {
    const j = jsonAusText(
      '```json\n{"summary":"S.","title_variants":["a","b","c"],"meta_description":"M","internal_links":[{"from_url":"https://h.ch/stark/","anchor":"x"},{"from_url":"https://fremd.ch/","anchor":"y"}],"faq":[{"q":"Q","a":"A"}]}\n```',
    );
    const e = normalisiereEmpfehlung(
      j,
      [{ url: "https://h.ch/stark" }],
      [{ position: 1, url: "https://k.ch", title: "K", headings: ["H2: x"] }],
    );
    expect(e.internal_links).toEqual([
      { from_url: "https://h.ch/stark", from_title: "", anchor: "x" },
    ]);
    expect(e.serp_top5).toEqual([{ position: 1, url: "https://k.ch", title: "K" }]);
    expect(luecken(e)).toEqual([]);
    expect(luecken(normalisiereEmpfehlung({}, [], []))).toEqual([
      "summary",
      "title_variants",
      "meta_description",
    ]);
  });
});

describe("SERP-Hilfen", () => {
  it("gotoAufloesen ignoriert normale URLs", async () => {
    const { gotoAufloesen } = await import("@/server/content-actions.server");
    expect(await gotoAufloesen("https://www.ticino.ch/de/")).toBeNull();
  });
});

describe("Breadcrumb und FAQ-Dubletten", () => {
  it("urlAusBreadcrumb", async () => {
    const { urlAusBreadcrumb } = await import("@/server/content-actions.server");
    expect(urlAusBreadcrumb("https://www.ticino.ch › discover › themes › touring")).toBe(
      "https://www.ticino.ch/discover/themes/touring",
    );
    expect(urlAusBreadcrumb("https://www.ticino.ch › commons › details › Lago-Mag...")).toBe(
      "https://www.ticino.ch/",
    );
    expect(urlAusBreadcrumb("https://www.myswitzerland.com › ...")).toBe(
      "https://www.myswitzerland.com/",
    );
    expect(urlAusBreadcrumb(undefined)).toBeNull();
  });

  it("FAQ ohne Wiederholung einer neuen H2", () => {
    const e = normalisiereEmpfehlung(
      {
        sections_to_add: [{ h2: "Wann ist die beste Reisezeit?", answer_first: "x" }],
        faq: [
          { q: "Wann ist die beste Reisezeit?", a: "a" },
          { q: "Wie reise ich an?", a: "b" },
        ],
      },
      [],
      [],
    );
    expect(e.faq.map((f) => f.q)).toEqual(["Wie reise ich an?"]);
  });
});

describe("Content-Massnahmen Nachbesserung (01.11.2026)", () => {
  it("Modal-Texte ohne ß", () => {
    expect(JSON.stringify({ REC_TEXTE, REC_PLAYBOOK })).not.toContain("ß");
  });

  it("Keyword aus GSC (Klicks vor Impressionen), sonst aus Title/H1", async () => {
    const { hauptKeyword, keywordAusTitel } = await import("@/server/content-actions.server");
    expect(
      hauptKeyword(
        [
          { query: "a", clicks: 0, impressions: 90 },
          { query: "b", clicks: 2, impressions: 10 },
        ],
        [],
      ),
    ).toEqual({ keyword: "b", quelle: "gsc" });
    expect(hauptKeyword([], ["Pontresina Tourismus: Wo die Alpen noch Wildnis sind"])).toEqual({
      keyword: "pontresina tourismus",
      quelle: "titel",
    });
    expect(keywordAusTitel("Pontresina Wandern – die schönsten Wege")).toBe("pontresina wandern");
    expect(hauptKeyword([], ["", "  "])).toBeNull();
  });

  it("robots.txt: Googlebot-Gruppe, längste Regel, Wildcards", async () => {
    const { robotsErlaubt } = await import("@/server/content-diagnose.server");
    const r =
      "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /*?s=\n";
    expect(robotsErlaubt(r, "/pontresina/").erlaubt).toBe(true);
    expect(robotsErlaubt(r, "/wp-admin/x").erlaubt).toBe(false);
    expect(robotsErlaubt(r, "/wp-admin/admin-ajax.php").erlaubt).toBe(true);
    expect(robotsErlaubt(r, "/suche?s=x").erlaubt).toBe(false);
    const g = "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /privat/\n";
    expect(robotsErlaubt(g, "/blog/").erlaubt).toBe(true);
    expect(robotsErlaubt(g, "/privat/a").regel).toBe("Disallow: /privat/");
  });

  it("interne Links in HTML und Markdown erkennen (www/Slash/relativ egal)", async () => {
    const { verlinkt } = await import("@/server/content-diagnose.server");
    const ziel = "https://www.h.ch/pontresina/";
    expect(verlinkt('<a href="/pontresina">x</a>', ziel, "https://www.h.ch/")).toBe(true);
    expect(verlinkt('<a href="https://h.ch/pontresina/#top">x</a>', ziel, "https://h.ch/")).toBe(
      true,
    );
    expect(verlinkt("[Dorf](https://www.h.ch/pontresina/)", ziel, "https://www.h.ch/")).toBe(true);
    expect(verlinkt('<a href="/pontresina-wandern/">x</a>', ziel, "https://www.h.ch/")).toBe(false);
  });

  it("Diagnose-Links nur aus Kandidaten, Diagnose-Vollständigkeit", async () => {
    const { erlaubteLinks } = await import("@/server/content-actions.server");
    const l = erlaubteLinks(
      [
        { from_url: "https://h.ch/a/", anchor: "x" },
        { from_url: "https://h.ch/a", anchor: "y" },
        { from_url: "https://fremd.ch/", anchor: "z" },
      ],
      [{ url: "https://h.ch/a", title: "Seite A" }],
    );
    expect(l).toEqual([{ from_url: "https://h.ch/a", from_title: "Seite A", anchor: "x" }]);
    expect(
      luecken({ summary: "s", diagnosis: [], internal_links: [], article_fetched: true }),
    ).toEqual(["diagnosis"]);
  });
});

describe("textBegrenzt", () => {
  it("liest höchstens maxBytes", async () => {
    const { textBegrenzt } = await import("@/server/content-actions.server");
    expect((await textBegrenzt(new Response("x".repeat(500_000)), 100_000)).length).toBe(100_000);
    expect(await textBegrenzt(new Response("kurz"), 100)).toBe("kurz");
  });
});

describe("Diagnose: nicht prüfbare Punkte (09.11.2026)", () => {
  const url = "https://www.h.ch/pontresina/";
  const leer = {
    seite: {
      quelle: null,
      status: 0,
      location: "",
      xRobots: "",
      xRobotsGeprueft: false,
      metaRobots: null,
      noindex: null,
      canonical: null,
      title: "",
    },
    robots: { status: 0, gesperrt: true, text: "" },
    sitemap: { gefunden: null, geprueft: 0, abrufbar: false },
    links: [],
  } as const;

  it("alles gesperrt, kein GSC → ok: null statt true", async () => {
    const { baueChecks } = await import("@/server/content-diagnose.server");
    const c = baueChecks({
      url,
      roh: structuredClone(leer) as any,
      gsc: null,
      gscFehler: "Timeout (2 Versuche)",
      sitemapsGsc: { error: "HTTP 500" },
      linkQuellen: [{ url: "https://www.h.ch/", title: "", clicks: 5, verlinkt: null }],
    });
    expect(Object.fromEntries(c.map((x) => [x.check, x.ok]))).toEqual({
      "HTTP-Status": null,
      noindex: null,
      Canonical: null,
      "robots.txt": null,
      "In Sitemap enthalten": null,
      "Sitemap in GSC eingereicht": null,
      "GSC-URL-Prüfung": null,
      "Interne Links von indexierten Seiten": null,
    });
  });

  it("direkt abgerufen: echte true/false; DataForSEO ohne X-Robots → noindex null", async () => {
    const { baueChecks } = await import("@/server/content-diagnose.server");
    const direkt = {
      ...structuredClone(leer),
      seite: {
        quelle: "direkt",
        status: 200,
        location: "",
        xRobots: "",
        xRobotsGeprueft: true,
        metaRobots: "index, follow",
        noindex: null,
        canonical: url,
        title: "T",
      },
      robots: { status: 200, gesperrt: false, text: "User-agent: *\nDisallow: /wp-admin/\n" },
      sitemap: { gefunden: null, geprueft: 3, abrufbar: true },
    } as any;
    const basis = {
      url,
      gsc: null,
      gscFehler: "x",
      sitemapsGsc: { liste: [] },
      linkQuellen: [{ url: "https://www.h.ch/", title: "", clicks: 5, verlinkt: false }],
    };
    const ok = (r: any) =>
      Object.fromEntries(baueChecks({ ...basis, roh: r }).map((x) => [x.check, x.ok]));
    expect(ok(direkt)).toMatchObject({
      "HTTP-Status": true,
      noindex: true,
      Canonical: true,
      "robots.txt": true,
      "In Sitemap enthalten": false,
      "Sitemap in GSC eingereicht": false,
      "Interne Links von indexierten Seiten": false,
    });
    const dfs = {
      ...direkt,
      seite: {
        ...direkt.seite,
        quelle: "dataforseo",
        xRobotsGeprueft: false,
        metaRobots: null,
        noindex: false,
      },
    };
    expect(ok(dfs).noindex).toBeNull();
    expect(ok({ ...dfs, seite: { ...dfs.seite, noindex: true } }).noindex).toBe(false);
  });

  it("GSC-URL-Prüfung: einmal wiederholen bei Timeout, nicht bei 403", async () => {
    const { gscInspektion } = await import("@/server/content-diagnose.server");
    let n = 0;
    const r = await gscInspektion("t", "s", "u", { pauseMs: 0 }, async () =>
      ++n === 1 ? { error: "timeout", wiederholbar: true } : { res: { verdict: "PASS" } },
    );
    expect(n).toBe(2);
    expect(r).toEqual({ res: { verdict: "PASS" } });
    let m = 0;
    const r2 = await gscInspektion("t", "s", "u", { pauseMs: 0 }, async () => {
      m++;
      return { error: "HTTP 403", wiederholbar: false };
    });
    expect(m).toBe(1);
    expect(r2).toEqual({ error: "HTTP 403" });
  });
});

describe("erkenneSprache", () => {
  it("html lang zuerst, sonst Stoppwörter", async () => {
    const { erkenneSprache } = await import("@/lib/contentMassnahmen");
    expect(erkenneSprache("fr-CH", "egal")).toBe("fr");
    expect(erkenneSprache("de_DE", "")).toBe("de");
    expect(
      erkenneSprache(
        "",
        "Hôtel de luxe en Suisse : quand le temps devient le plus grand des luxes",
      ),
    ).toBe("fr");
    expect(
      erkenneSprache(
        "",
        "Beste Hotels am Lago Maggiore: Wo Schweizer Qualität auf das Lebensgefühl trifft",
      ),
    ).toBe("de");
    expect(
      erkenneSprache("", "Le migliori vacanze sul Lago Maggiore con la famiglia e il lago"),
    ).toBe("it");
    expect(erkenneSprache(null, "Pontresina")).toBeNull();
  });
});

describe("Lesbare Anzeige", () => {
  it("übersetzt die Alters-Codes", () => {
    expect(gateText("maturing")).toBe("Neu (unter 30 Tage)");
    expect(gateText("gate_90_plus")).toBe("Über 3 Monate online");
    expect(gateText(null)).toBe("—");
    expect(gateText("unbekannt")).toBe("unbekannt");
  });
  it("löst HTML-Entitäten in Titeln auf", () => {
    expect(titelKlartext("Nothilfe &#8211; Afrika &amp; Asien")).toBe("Nothilfe – Afrika & Asien");
    expect(titelKlartext("A&#x2019;s &hellip; &unbekannt;")).toBe("A’s … &unbekannt;");
    expect(titelKlartext(null)).toBe("");
  });
});

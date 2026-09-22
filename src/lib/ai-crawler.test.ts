// KI-Crawler-Referenz (22.09.2026): robots.txt-Parser (Gruppen, Kommentare,
// Mehrfach-User-agent), Bewertung je Bot (eigen/`*`/keine), Allow-schlaegt-
// Disallow, Teilpfade, und die Listen-Invarianten (Google-Extended, Bytespider).
import { describe, it, expect } from "vitest";
import { KI_CRAWLER, bewerteAlleCrawler, bewerteRobots, parseRobots } from "./ai-crawler";

const ROBOTS_TYPISCH = `
# Standard-WordPress
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /intern/
Disallow: /tmp/

User-agent: PerplexityBot
Allow: /

Sitemap: https://example.ch/sitemap.xml
`;

describe("parseRobots", () => {
  it("bildet Gruppen; mehrere User-agent-Zeilen teilen sich eine Gruppe", () => {
    const g = parseRobots(ROBOTS_TYPISCH);
    expect(g.map((x) => x.agents)).toEqual([
      ["*"],
      ["gptbot", "ccbot"],
      ["claudebot"],
      ["perplexitybot"],
    ]);
    expect(g[1].regeln).toEqual([{ typ: "disallow", pfad: "/" }]);
    expect(g[2].regeln).toHaveLength(2);
  });

  it("ignoriert Kommentare, Leerzeilen, unbekannte Direktiven und Regeln ohne Gruppe", () => {
    const g = parseRobots(
      "Disallow: /\n# nur Kommentar\nCrawl-delay: 5\nUser-agent: Foo # x\nDisallow: /a\n",
    );
    expect(g).toEqual([{ agents: ["foo"], regeln: [{ typ: "disallow", pfad: "/a" }] }]);
  });

  it("leeres robots.txt → keine Gruppen", () => {
    expect(parseRobots("")).toEqual([]);
    expect(parseRobots(undefined as unknown as string)).toEqual([]);
  });
});

describe("bewerteRobots", () => {
  it("eigene Gruppe mit Disallow: / → gesperrt (auch fuer den zweiten Agent der Gruppe)", () => {
    expect(bewerteRobots(ROBOTS_TYPISCH, "GPTBot")).toEqual({
      status: "gesperrt",
      regel: "Disallow: /",
      quelle: "eigen",
    });
    expect(bewerteRobots(ROBOTS_TYPISCH, "ccbot").status).toBe("gesperrt");
  });

  it("eigene Gruppe mit Teilpfaden → erlaubt mit Regeltext", () => {
    expect(bewerteRobots(ROBOTS_TYPISCH, "ClaudeBot")).toEqual({
      status: "erlaubt",
      regel: "Disallow: /intern/; Disallow: /tmp/",
      quelle: "eigen",
    });
  });

  it("eigene Gruppe mit Allow: / → erlaubt", () => {
    expect(bewerteRobots(ROBOTS_TYPISCH, "PerplexityBot")).toEqual({
      status: "erlaubt",
      regel: "Allow: /",
      quelle: "eigen",
    });
  });

  it("ohne eigene Gruppe gilt `*` — hier nur Teilpfad, also erlaubt", () => {
    expect(bewerteRobots(ROBOTS_TYPISCH, "OAI-SearchBot")).toEqual({
      status: "erlaubt",
      regel: "Disallow: /wp-admin/",
      quelle: "stern",
    });
  });

  it("`*` mit Disallow: / sperrt alle ohne eigene Gruppe; eigene Allow-Gruppe hebt das auf", () => {
    const r = "User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n";
    expect(bewerteRobots(r, "GPTBot")).toEqual({
      status: "gesperrt",
      regel: "Disallow: /",
      quelle: "stern",
    });
    expect(bewerteRobots(r, "OAI-SearchBot")).toEqual({
      status: "erlaubt",
      regel: "Allow: /",
      quelle: "eigen",
    });
  });

  it("Allow: / und Disallow: / in derselben Gruppe → Allow gewinnt (RFC 9309, gleich lang)", () => {
    const r = "User-agent: GPTBot\nDisallow: /\nAllow: /\n";
    expect(bewerteRobots(r, "GPTBot")).toMatchObject({ status: "erlaubt", regel: "Allow: /" });
  });

  it("leeres Disallow: → erlaubt; mehr als drei Teilpfade werden gekuerzt", () => {
    expect(bewerteRobots("User-agent: GPTBot\nDisallow:\n", "GPTBot")).toMatchObject({
      status: "erlaubt",
      regel: "Disallow: (leer)",
    });
    const viele = "User-agent: *\nDisallow: /a\nDisallow: /b\nDisallow: /c\nDisallow: /d\n";
    expect(bewerteRobots(viele, "GPTBot").regel).toBe(
      "Disallow: /a; Disallow: /b; Disallow: /c; …",
    );
  });

  it("keine passende Gruppe (auch kein `*`) oder leeres robots.txt → unbestimmt", () => {
    expect(bewerteRobots("User-agent: Googlebot\nDisallow: /x\n", "GPTBot")).toEqual({
      status: "unbestimmt",
      regel: null,
      quelle: "keine",
    });
    expect(bewerteRobots("", "GPTBot").status).toBe("unbestimmt");
  });

  it("zwei Gruppen fuer denselben Agent werden zusammengefuehrt", () => {
    const r = "User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /\n";
    expect(bewerteRobots(r, "GPTBot").status).toBe("gesperrt");
  });
});

describe("KI_CRAWLER — Referenzliste", () => {
  it("enthaelt die erwarteten Bots ohne Duplikate", () => {
    const namen = KI_CRAWLER.map((c) => c.name);
    expect(new Set(namen.map((n) => n.toLowerCase())).size).toBe(namen.length);
    for (const n of [
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "GoogleOther",
      "Applebot",
      "Applebot-Extended",
      "Amazonbot",
      "Meta-ExternalAgent",
      "Meta-ExternalFetcher",
      "Bytespider",
      "CCBot",
      "cohere-ai",
      "DuckAssistBot",
      "Diffbot",
    ])
      expect(namen).toContain(n);
  });

  it("Google-Extended ist Training-Opt-out ohne Suchsperre; Bytespider ignoriert robots.txt", () => {
    const ge = KI_CRAWLER.find((c) => c.name === "Google-Extended")!;
    expect(ge.zweck).toBe("training");
    expect(ge.empfehlung).toMatch(/KEINE Auswirkung/);
    const bs = KI_CRAWLER.find((c) => c.name === "Bytespider")!;
    expect(bs.haeltSichAnRobots).toBe(false);
    expect(bs.empfehlung).toMatch(/WAF|Firewall/);
  });

  it("Such-Crawler empfehlen Erlauben, Trainings-Crawler sind optional", () => {
    for (const c of KI_CRAWLER) {
      if (c.zweck === "suche") expect(c.empfehlung).toMatch(/^Erlauben/);
      if (c.zweck === "training" && c.haeltSichAnRobots) expect(c.empfehlung).toMatch(/optional/i);
    }
  });

  it("bewerteAlleCrawler liefert je Bot Status + Regel (case-insensitiv gegen robots.txt)", () => {
    const r = "User-agent: *\nAllow: /\n\nUser-agent: gptbot\nDisallow: /\n";
    const alle = bewerteAlleCrawler(r);
    expect(alle).toHaveLength(KI_CRAWLER.length);
    expect(alle.find((b) => b.name === "GPTBot")).toMatchObject({
      status: "gesperrt",
      quelle: "eigen",
    });
    expect(alle.find((b) => b.name === "ClaudeBot")).toMatchObject({
      status: "erlaubt",
      quelle: "stern",
    });
  });
});

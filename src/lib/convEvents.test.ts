import { describe, expect, it } from "vitest";
import {
  convBucketVon,
  isKaufEvent,
  isMuellEvent,
  kaufZaehler,
  kanaeleKaeufeBereinigt,
  breakdownJeKanal,
  generatedUmsatz,
  isFunnelEvent,
  organischerBreakdown,
} from "./convEvents";

describe("isFunnelEvent", () => {
  it("Funnel-Schritte sind keine Conversions", () => {
    expect(isFunnelEvent("begin_checkout")).toBe(true);
    expect(isFunnelEvent("add_to_cart")).toBe(true);
    expect(isFunnelEvent("view_item_list")).toBe(true);
  });
  it("Abschluesse und Leads bleiben", () => {
    expect(isFunnelEvent("purchase")).toBe(false);
    expect(isFunnelEvent("checkout_complete")).toBe(false);
    expect(isFunnelEvent("phone_click")).toBe(false);
    expect(isFunnelEvent(null)).toBe(false);
  });
});

describe("generatedUmsatz", () => {
  // Morosani 04.09.–01.10.2026 (gekuerzt)
  const kanaele = [
    { channel: "Direct", revenue: 4772 },
    { channel: "Paid Search", revenue: 21573 },
    { channel: "Organic Search", revenue: 10149.9 },
    { channel: "AI Assistant", revenue: 120 },
  ];
  it("EzyRank: nur Organic Search statt Gesamtumsatz", () => {
    expect(generatedUmsatz(kanaele, false, 45731)).toEqual({ umsatz: 10149.9, organisch: true });
  });
  it("EzyAI: Organic Search plus AI Assistant", () => {
    expect(generatedUmsatz(kanaele, true, 45731)).toEqual({ umsatz: 10269.9, organisch: true });
  });
  it("ohne Kanal-Split oder Kanal-Umsatz: Gesamtumsatz, als nicht organisch markiert", () => {
    expect(generatedUmsatz(null, false, 500)).toEqual({ umsatz: 500, organisch: false });
    expect(generatedUmsatz([{ channel: "Organic Search" }], false, 500)).toEqual({
      umsatz: 500,
      organisch: false,
    });
  });
  it("organischer Kanal ohne Umsatz = 0, nicht Gesamtumsatz", () => {
    expect(generatedUmsatz([{ channel: "Organic Search", revenue: 0 }], false, 900)).toEqual({
      umsatz: 0,
      organisch: true,
    });
  });
});

describe("Lead-Breakdown je Kanal", () => {
  const bucketOf = (n: string) =>
    /phone|tel/.test(n)
      ? "phone"
      : /mail/.test(n)
        ? "mail"
        : /form|contact/.test(n)
          ? "contact"
          : null;
  const jeKanal = breakdownJeKanal(
    [
      { eventName: "phone_click", channel: "Organic Search", count: 4 },
      { eventName: "phone_click", channel: "Paid Search", count: 9 },
      { eventName: "mail_click", channel: "Organic Search", count: 2 },
      { eventName: "contact_form", channel: "AI Assistant", count: 1 },
      { eventName: "begin_checkout", channel: "Organic Search", count: 50 },
      { eventName: "page_view", channel: "Organic Search", count: 999 },
    ],
    bucketOf,
  );
  it("gruppiert je Kanal, Funnel- und Nicht-Lead-Events zählen nicht", () => {
    expect(jeKanal["Organic Search"]).toEqual({ phone: 4, mail: 2, maps: 0, contact: 0 });
    expect(jeKanal["Paid Search"]).toEqual({ phone: 9, mail: 0, maps: 0, contact: 0 });
  });
  it("EzyRank: nur Organic Search, EzyAI: plus AI Assistant", () => {
    expect(organischerBreakdown(jeKanal, false)).toEqual({
      phone: 4,
      mail: 2,
      maps: 0,
      contact: 0,
    });
    expect(organischerBreakdown(jeKanal, true)).toEqual({ phone: 4, mail: 2, maps: 0, contact: 1 });
  });
  it("ohne Kanal-Aufteilung (alte Snapshots) null, leere Aufteilung = 0", () => {
    expect(organischerBreakdown(null, false)).toBeNull();
    expect(organischerBreakdown({}, false)).toEqual({ phone: 0, mail: 0, maps: 0, contact: 0 });
  });
});

describe("Käufe als Transaktionen", () => {
  it("purchase zählt Transaktionen, andere Events die Event-Zahl", () => {
    expect(kaufZaehler("purchase", 5, 2)).toBe(2);
    expect(kaufZaehler("purchase", 5, 0)).toBe(5); // ohne Buchungsnummer: Events behalten
    expect(kaufZaehler("purchase", 5, null)).toBe(5);
    expect(kaufZaehler("phone_click", 5, 0)).toBe(5);
    expect(kaufZaehler("order", 3, 1)).toBe(3);
  });
  it("Kanal-Conversions: doppelte Kauf-Events durch Transaktionen ersetzen", () => {
    const ch = [
      { channel: "Organic Search", conversions: 40, sessions: 1 },
      { channel: "Direct", conversions: 15, sessions: 1 },
      { channel: "Referral", conversions: 3, sessions: 1 },
    ];
    const r = kanaeleKaeufeBereinigt(ch, {
      "Organic Search": { keyEvents: 37, transactions: 11 },
      Direct: { keyEvents: 0, transactions: 4 }, // purchase kein Key Event -> unverändert
    });
    expect(r.map((c) => c.conversions)).toEqual([14, 15, 3]);
    expect(kanaeleKaeufeBereinigt(ch, null)).toBe(ch);
  });
});

describe("Zählregeln (Audit 02.10.2026)", () => {
  const b = convBucketVon;
  it("Telefon: echte Klicks ja, «Bestellen»/«Hotels» nein", () => {
    for (const n of [
      "phone_click",
      "contact_phone_click",
      "telefonnummer_klick",
      "ClickToCall",
      "pro_phone_click",
      "Kontakt_Telefon",
    ])
      expect(b(n)).toBe("phone");
    expect(b("Click_Gutschein_Bestellen")).toBeNull();
    expect(b("distributorStepHotels")).toBeNull();
    expect(b("hotel_select")).toBeNull();
  });
  it("Mail und Maps", () => {
    expect(b("mail_click")).toBe("mail");
    expect(b("Kontakt_Email")).toBe("mail");
    expect(b("mailto")).toBe("mail");
    expect(b("maps_click")).toBe("maps");
    expect(b("sitemap_view")).toBeNull();
  });
  it("Kontakt: echte Anfragen ja, Formular-Rauschen nein", () => {
    for (const n of [
      "contact_form",
      "generate_lead",
      "anfrage_kontaktformular",
      "offerte_anfrage",
      "booking_request_de",
      "seminar_request",
      "contact_request",
      "form_submitted",
      "Kontakt_Form_Submit",
    ])
      expect(b(n)).toBe("contact");
    for (const n of [
      "form_start",
      "form_aborted",
      "form_submit",
      "Engagement_Search_Query_Submit",
      "Kontakt_Newsletter_Signup",
      "newsletter_signup",
      "signup_click",
      "view_search_results",
    ])
      expect(b(n)).toBeNull();
  });
  it("Müll-Events zählen nie", () => {
    for (const n of [
      "gtm.dom",
      "G-14HEGP45HE",
      "Google_Analytics",
      "distributorStepRooms",
      "ga4_CalendarLoaded",
    ]) {
      expect(isMuellEvent(n)).toBe(true);
      expect(b(n)).toBeNull();
    }
    expect(isMuellEvent("purchase")).toBe(false);
  });
  it("Kauf: purchase/order ja, Ticket-«Kaufen»-Klick und Funnel nein", () => {
    expect(isKaufEvent("purchase")).toBe(true);
    expect(isKaufEvent("order")).toBe(true);
    expect(isKaufEvent("Click_Ski_und_Bergbahntickets_Kaufen")).toBe(false);
    expect(isKaufEvent("begin_checkout")).toBe(false);
    expect(isKaufEvent("G-14HEGP45HE")).toBe(false);
  });
});

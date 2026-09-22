// @vitest-environment jsdom
// First-Party GEO (22.09.2026): Render-Smoke des Bereichs in jsdom mit
// gemocktem Netz — Vollansicht mit allen fuenf Karten, Leerzustand bei
// aktiv:false, Fehlerzustand je Karte, DiD-Formular (POST) und das
// Admin-Gate (Nicht-Admins sehen nichts).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({ isOrgAdmin: true }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
  },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@ezyone.ch" },
    role: "owner",
    isOrgAdmin: auth.isOrgAdmin,
    organizationId: "org-1",
    loading: false,
  }),
}));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

const GET_ANTWORT = {
  ok: true,
  aktiv: true,
  range: { from: "2026-08-25", to: "2026-09-21", days: 28 },
  referrals: {
    engines: [
      { engine: "ChatGPT", sessions: 1234, engaged: 800, keyEvents: 12, anteilProzent: 61.7 },
      { engine: "Perplexity", sessions: 766, engaged: 500, keyEvents: 5, anteilProzent: 38.3 },
    ],
    tage: [
      { date: "2026-09-19", sessions: 40, engaged: 30, keyEvents: 1 },
      { date: "2026-09-20", sessions: 55, engaged: 41, keyEvents: 0 },
      { date: "2026-09-21", sessions: 61, engaged: 44, keyEvents: 2 },
    ],
    landingpages: [
      { engine: "ChatGPT", landingPage: "/ratgeber/spenden", sessions: 300, keyEvents: 4 },
      { engine: "Perplexity", landingPage: "/ueber-uns", sessions: 120, keyEvents: 1 },
    ],
    hinweis: "Referrer-Erkennung nach Hostname; App-Traffic ohne Referrer fehlt.",
  },
  zitate: {
    standVom: "2026-09-20",
    zitiert: [
      { page: "https://smoke.ch/ratgeber/spenden", impressions: 900, clicks: 50, pos: 4.2 },
    ],
    organischNichtZitiert: [
      { page: "https://smoke.ch/projekte", impressions: 5000, clicks: 400, pos: 2.1 },
    ],
    zitiertOhneSichtbarkeit: [{ page: "https://smoke.ch/faq", impressions: 30, clicks: 1 }],
    zusammenfassung: { zitierteSeiten: 2, davonMitOrganik: 1, organischeSeitenOhneZitat: 1 },
  },
  brand: {
    begriffe: ["smoke", "smoke ag"],
    wochen: [
      {
        wocheAb: "2026-08-24",
        brandImpressions: 1000,
        brandClicks: 200,
        nonbrandImpressions: 3000,
        nonbrandClicks: 300,
        brandAnteilProzent: 25,
      },
      {
        wocheAb: "2026-08-31",
        brandImpressions: 1200,
        brandClicks: 240,
        nonbrandImpressions: 2800,
        nonbrandClicks: 280,
        brandAnteilProzent: 30,
      },
    ],
    trendProzent: 12.5,
  },
  crawler: {
    robotsUrl: "https://smoke.ch/robots.txt",
    geladen: true,
    bots: [
      {
        name: "GPTBot",
        betreiber: "OpenAI",
        zweck: "Training",
        haeltSichAnRobots: true,
        status: "erlaubt",
        regel: "User-agent: *",
        empfehlung: "Erlaubt lassen.",
      },
      {
        name: "Bytespider",
        betreiber: "ByteDance",
        zweck: "Training",
        haeltSichAnRobots: false,
        status: "gesperrt",
        regel: "Disallow: /",
        empfehlung: "Serverseitig blockieren.",
      },
    ],
  },
};

const DID_ANTWORT = {
  ok: true,
  did: {
    behandelt: { seiten: 1, praeClicks: 400, postClicks: 520 },
    kontrolle: { seiten: 12, quelle: "gsc-pages", ratioMittel: 1.02, ratioSe: 0.05 },
    counterfactual: 408,
    lift: 112,
    liftLo: 60,
    liftHi: 164,
    verdikt: "likely_positive",
    fenster: {
      prae: { from: "2026-06-23", to: "2026-08-17" },
      post: { from: "2026-08-25", to: "2026-09-21" },
    },
  },
};

let getAntwort: any = GET_ANTWORT;
const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
  if (init?.method === "POST") return Response.json(DID_ANTWORT);
  return Response.json(getAntwort);
});
vi.stubGlobal("fetch", fetchMock);

const RANGE = {
  start: new Date(2026, 7, 25),
  end: new Date(2026, 8, 21),
  days: 28,
  preset: "28",
  label: "28 Tage",
};

async function mount(extra: Record<string, any> = {}) {
  const m = await import("@/ezy/ezyai/FirstPartyGeo");
  const Comp = m.default;
  return render(
    <Comp
      clientId={CLIENT_ID}
      client={{ id: CLIENT_ID, name: "Smoke AG" }}
      range={RANGE}
      {...extra}
    />,
  );
}

beforeEach(() => {
  auth.isOrgAdmin = true;
  getAntwort = GET_ANTWORT;
  fetchMock.mockClear();
});
afterEach(() => cleanup());

describe("FirstPartyGeo (Render-Smoke, gemocktes Netz)", () => {
  it("rendert alle fuenf Karten mit Daten und ruft die API mit Zeitraum auf", async () => {
    await mount();
    expect(await screen.findAllByText("ChatGPT")).toBeTruthy();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/kpi/first-party-geo?client=" + CLIENT_ID);
    expect(url).toContain("startDate=2026-08-25");
    expect(url).toContain("endDate=2026-09-21");

    expect(screen.getByText("KI-Referral-Traffic")).toBeTruthy();
    expect(screen.getByText("Zitiert vs. organisch")).toBeTruthy();
    expect(screen.getByText("Marken-Nachfrage")).toBeTruthy();
    expect(screen.getByText("Wirkungsnachweis (Difference-in-Differences)")).toBeTruthy();
    expect(screen.getByText("KI-Crawler")).toBeTruthy();

    // Schweizer Zahlenformat und Prozent.
    expect(screen.getByText("1'234")).toBeTruthy();
    expect(screen.getByText("61.7 %")).toBeTruthy();
    expect(screen.getByText("+12.5 %")).toBeTruthy();
    // Chips, Crawler-Status, Hinweis.
    expect(screen.getByText("smoke ag")).toBeTruthy();
    expect(screen.getByText("gesperrt")).toBeTruthy();
    expect(screen.getByText("ignoriert robots.txt")).toBeTruthy();
    expect(screen.getByText(/Stand: 20\.09\.2026/)).toBeTruthy();
  });

  it("DiD-Formular: Seite waehlen, berechnen, Verdikt und Lift anzeigen", async () => {
    await mount();
    await screen.findAllByText("ChatGPT");
    const btn = screen.getByRole("button", { name: "Wirkung berechnen" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText("wahrscheinlich positiv")).toBeTruthy();
    expect(screen.getByText("+112 (+27.5 %)")).toBeTruthy();
    expect(screen.getByText("+60 bis +164 Klicks")).toBeTruthy();
    expect(screen.getByText("12 Seiten")).toBeTruthy();

    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(post).toBeTruthy();
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body).toMatchObject({
      client: CLIENT_ID,
      action: "did",
      pages: ["https://smoke.ch/ratgeber/spenden"],
      praeTage: 56,
      washoutTage: 7,
      postTage: 28,
    });
    expect(body.changeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aktiv:false → Leerzustand mit Verweis auf die Verbindung", async () => {
    getAntwort = { ok: true, aktiv: false };
    await mount();
    expect(await screen.findByText("Noch keine Daten verbunden")).toBeTruthy();
    expect(screen.getByText(/Admin → Kunde → Google → First-Party-Daten/)).toBeTruthy();
    expect(screen.queryByText("KI-Referral-Traffic")).toBeNull();
  });

  it("Fehler je Block landet in der jeweiligen Karte, andere Karten bleiben", async () => {
    getAntwort = {
      ...GET_ANTWORT,
      brand: undefined,
      fehler: { brand: "GSC-Quota erschöpft" },
    };
    await mount();
    await screen.findAllByText("ChatGPT");
    expect(screen.getByText(/GSC-Quota erschöpft/)).toBeTruthy();
    expect(screen.getByText("KI-Crawler")).toBeTruthy();
  });

  it("ohne Range: eigener Umschalter 28/90/365 mit Default 28 Tage bis gestern", async () => {
    await mount({ range: undefined });
    await screen.findAllByText("ChatGPT");
    expect(screen.getByRole("button", { name: "90 Tage" })).toBeTruthy();
    const url = String(fetchMock.mock.calls[0][0]);
    const m = /startDate=(\d{4}-\d{2}-\d{2})&endDate=(\d{4}-\d{2}-\d{2})/.exec(url)!;
    const tage = (Date.parse(m[2]) - Date.parse(m[1])) / 864e5 + 1;
    expect(tage).toBe(28);
    fireEvent.click(screen.getByRole("button", { name: "90 Tage" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
  });

  it("Nicht-Admins sehen nichts und loesen keinen Aufruf aus", async () => {
    auth.isOrgAdmin = false;
    const { container } = await mount();
    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

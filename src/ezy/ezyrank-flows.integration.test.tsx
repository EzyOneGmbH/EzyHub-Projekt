// @vitest-environment jsdom
// EzyRank-Integrationstests (Regressionstest 2026-08-21): echte Komponenten
// (PublishFlow, ToolResult, ToolActions) + echte Normalisierung/Markdown-Pipeline,
// nur Netz (fetch/ezyFetch) und Supabase-Session sind gemockt. Abgedeckte Flows:
//   1. Tool-Ergebnis → Entwurf (verschachtelte Provider-Antwort → Speichern → Editor)
//   2. Entwurf → WordPress-Vorschau (gerendertes Markdown, XSS-sichere Links)
//   3. Entwurf → WordPress-Draft (Standard bleibt "draft")
//   4. Publish-Bestätigung (ohne Haken KEIN Publish-Request)
//   5. Fehlende WordPress-Verbindung (kein Senden möglich)
//   6. Fehlerhafte Provider-Antwort (verständlicher Fehler, kein Erfolg)
//   7. Verschachtelte Tool-Ergebnisse (lesbar + Rohdaten nur unter Details)
// Plus: useMeasurement meldet bei HTTP 200 + { ok:false } KEINEN Erfolg.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import WordPressPublishModal from "@/ezy/PublishFlow";
import ToolResultView from "@/ezy/ToolResult";
import ToolActions from "@/ezy/ToolActions";
import { normalizeToolResult } from "@/ezy/data/toolResult";
import { useMeasurement } from "@/ezy/data/useMeasurement";
import { ezyFetch } from "@/ezy/data/api";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      getUser: async () => ({ data: { user: { id: "u-test" } } }),
    },
  },
}));

vi.mock("@/ezy/data/api", () => ({ ezyFetch: vi.fn() }));

type MockRoute = { match: string; status?: number; body: unknown };

/** fetch-Mock: erste passende Route gewinnt; alle Aufrufe werden protokolliert. */
function installFetch(routes: MockRoute[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const r = routes.find((x) => u.includes(x.match));
    if (!r) throw new Error(`Unerwarteter fetch: ${u}`);
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const CONNECTED = {
  match: "/api/wordpress/connection",
  body: { connected: true, siteUrl: "https://kunde.ch" },
};

const publishCalls = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((c) => c.url.includes("/api/wordpress/publish"));

const publishBody = (calls: Array<{ url: string; init?: RequestInit }>) =>
  JSON.parse(String(publishCalls(calls)[0]?.init?.body ?? "null"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── 1. Tool-Ergebnis → Entwurf ──────────────────────────────────────────────
describe("Flow: Tool-Ergebnis → Entwurf", () => {
  const nested = {
    result: { choices: [{ message: { content: "## Analyse\n\n- Punkt eins" } }] },
  };

  it("normalisiert die verschachtelte Antwort und speichert sie als Entwurf", async () => {
    const text = normalizeToolResult(nested).text;
    expect(text).toContain("## Analyse");
    const onSaveDraft = vi.fn();
    render(
      <ToolActions
        text={text}
        raw={nested}
        notify={() => {}}
        onSaveDraft={onSaveDraft}
        draftState={{ saved: false, saving: false }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Als Entwurf speichern" }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("bietet nach dem Speichern das Weiterbearbeiten im Editor an", () => {
    const onOpenEditor = vi.fn();
    render(
      <ToolActions
        text={"## Analyse"}
        raw={nested}
        notify={() => {}}
        draftState={{ saved: true, saving: false }}
        onOpenEditor={onOpenEditor}
        onClose={() => {}}
      />,
    );
    // Speichern-Button verschwindet, Editor-Sprung erscheint.
    expect(screen.queryByRole("button", { name: "Als Entwurf speichern" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Im Editor weiterbearbeiten" }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Entwurf → WordPress-Vorschau ─────────────────────────────────────────
describe("Flow: Entwurf → WordPress-Vorschau", () => {
  it("rendert die Markdown-Vorschau und entschärft gefährliche Links", async () => {
    installFetch([CONNECTED]);
    const { container } = render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000001"
        defaultTitle="Mein Artikel"
        markdown={"# Titel\n\n[Klick](javascript:alert(1)) und <img src=x onerror=alert(1)>"}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText("https://kunde.ch");
    fireEvent.click(screen.getByRole("button", { name: /Vorschau/ }));
    const preview = container.querySelector(".ezy-md");
    expect(preview).toBeTruthy();
    const html = preview!.innerHTML;
    expect(html).toContain("<h1>Titel</h1>");
    // XSS: javascript:-Link wird "#", eingebettetes HTML bleibt escaped.
    expect(html).toContain('href="#"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });
});

// ── 3. Entwurf → WordPress-Draft (Standard bleibt Entwurf) ─────────────────
describe("Flow: Entwurf → WordPress-Draft", () => {
  it("sendet standardmässig status=draft und meldet 'Als Entwurf angelegt'", async () => {
    const calls = installFetch([
      CONNECTED,
      {
        match: "/api/wordpress/publish",
        body: { ok: true, post: { id: 7, link: "https://kunde.ch/?p=7" } },
      },
    ]);
    render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000002"
        defaultTitle="Draft-Test"
        markdown={"## Abschnitt\n\nText."}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText("https://kunde.ch");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await screen.findByText("Als Entwurf angelegt");
    const body = publishBody(calls);
    expect(body.status).toBe("draft");
    expect(body.title).toBe("Draft-Test");
    // Markdown wurde serverfertig in HTML gewandelt.
    expect(body.content).toContain("<h2>Abschnitt</h2>");
  });
});

// ── 4. Publish-Bestätigung ─────────────────────────────────────────────────
describe("Flow: Publish-Bestätigung", () => {
  it("veröffentlicht NIE ohne expliziten Bestätigungshaken", async () => {
    const calls = installFetch([
      CONNECTED,
      { match: "/api/wordpress/publish", body: { ok: true, post: { id: 8 } } },
    ]);
    const { container } = render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000003"
        defaultTitle="Publish-Test"
        markdown={"Text"}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText("https://kunde.ch");
    const statusSelect = container.querySelectorAll("select")[1] as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: "publish" } });
    const btn = screen.getByRole("button", { name: "Jetzt veröffentlichen" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(publishCalls(calls)).toHaveLength(0); // KEIN Request ohne Haken
    // Haken setzen → Button frei → Request geht mit status=publish raus.
    fireEvent.click(screen.getByRole("checkbox"));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(publishCalls(calls)).toHaveLength(1));
    expect(publishBody(calls).status).toBe("publish");
  });

  it("setzt den Haken beim Statuswechsel zurück", async () => {
    installFetch([CONNECTED]);
    const { container } = render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000004"
        defaultTitle="T"
        markdown={"Text"}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText("https://kunde.ch");
    const statusSelect = container.querySelectorAll("select")[1] as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: "publish" } });
    fireEvent.click(screen.getByRole("checkbox"));
    // Zurück auf Entwurf und wieder auf Publish: Haken muss neu gesetzt werden.
    fireEvent.change(statusSelect, { target: { value: "draft" } });
    fireEvent.change(statusSelect, { target: { value: "publish" } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Jetzt veröffentlichen" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ── 5. Fehlende WordPress-Verbindung ───────────────────────────────────────
describe("Flow: fehlende WordPress-Verbindung", () => {
  it("zeigt den nächsten Schritt und bietet keinen Senden-Button an", async () => {
    installFetch([{ match: "/api/wordpress/connection", body: { connected: false } }]);
    render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000005"
        defaultTitle="T"
        markdown={"Text"}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText(/noch keine WordPress-Seite verbunden/);
    expect(screen.getByText(/Onboarding \/ Verbindungen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Senden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Jetzt veröffentlichen" })).toBeNull();
  });
});

// ── 6. Fehlerhafte Provider-Antwort ────────────────────────────────────────
describe("Flow: fehlerhafte Provider-Antwort", () => {
  it("übersetzt den Fehler verständlich und meldet keinen Erfolg", async () => {
    installFetch([
      CONNECTED,
      { match: "/api/wordpress/publish", body: { ok: false, error: "401 unauthorized" } },
    ]);
    render(
      <WordPressPublishModal
        clientId="00000000-0000-4000-8000-000000000006"
        defaultTitle="Fehler-Test"
        markdown={"Text"}
        onClose={() => {}}
        notify={() => {}}
      />,
    );
    await screen.findByText("https://kunde.ch");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await screen.findByText(/Zugangsdaten abgelehnt/);
    expect(screen.queryByText("Als Entwurf angelegt")).toBeNull();
    // Formular bleibt offen für den nächsten Versuch.
    expect(screen.getByRole("button", { name: "Senden" })).toBeTruthy();
  });
});

// ── 7. Verschachtelte Tool-Ergebnisse ──────────────────────────────────────
describe("Flow: verschachtelte Tool-Ergebnisse", () => {
  it("rendert verschachtelte Provider-Antworten lesbar, Rohdaten nur unter Details", () => {
    const result = {
      ok: true,
      liveConnected: true,
      message: "Live-Lauf abgeschlossen",
      data: { result: { choices: [{ message: { content: "## Befund\n\n- Alles gut" } }] } },
    };
    const { container } = render(<ToolResultView result={result as never} />);
    const md = container.querySelector(".ezy-md");
    expect(md?.innerHTML).toContain("<h2>Befund</h2>");
    expect(md?.innerHTML).toContain("<li>Alles gut</li>");
    // Rohdaten NUR im zugeklappten Details-Block.
    expect(screen.getByText("Technische Details (Rohdaten)")).toBeTruthy();
    expect(container.querySelector("details pre")?.textContent).toContain("choices");
  });

  it("zeigt Fehlerläufe rot und ohne Markdown-Rendering", () => {
    const result = {
      ok: false,
      liveConnected: true,
      message: "Live-Lauf fehlgeschlagen",
      error: "PSI quota überschritten",
    };
    const { container } = render(<ToolResultView result={result as never} />);
    expect(screen.getByText("PSI quota überschritten")).toBeTruthy();
    expect(container.querySelector(".ezy-md")).toBeNull();
  });
});

// ── Regression: useMeasurement und ok:false bei HTTP 200 ───────────────────
describe("useMeasurement: keine verfrühte Erfolgsmeldung", () => {
  beforeEach(() => {
    vi.mocked(ezyFetch).mockReset();
  });

  const resp = (status: number, body: unknown) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

  it("HTTP 200 + ok:false gilt als Fehler (PSI-Regression)", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(200, { ok: false, error: "PSI down" }));
    const { result } = renderHook(() =>
      useMeasurement("10000000-0000-4000-8000-000000000001", "pagespeed", "/api/google/pagespeed"),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.start();
    });
    expect(ok).toBe(false);
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toBe("PSI down");
  });

  it("HTTP 200 + ok:true gilt als Erfolg", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(200, { ok: true, metrics: {} }));
    const { result } = renderHook(() =>
      useMeasurement("10000000-0000-4000-8000-000000000002", "pagespeed", "/api/google/pagespeed"),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.start();
    });
    expect(ok).toBe(true);
    expect(result.current.state.status).toBe("success");
  });

  it("Doppelstart löst nur EINEN Request aus", async () => {
    let release!: (v: Response) => void;
    vi.mocked(ezyFetch).mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const { result } = renderHook(() =>
      useMeasurement("10000000-0000-4000-8000-000000000003", "pagespeed", "/api/google/pagespeed"),
    );
    let p1!: Promise<boolean>, p2!: Promise<boolean>;
    act(() => {
      p1 = result.current.start();
      p2 = result.current.start();
    });
    await act(async () => {
      release(resp(200, { ok: true }));
      await Promise.all([p1, p2]);
    });
    expect(vi.mocked(ezyFetch)).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe("success");
  });
});

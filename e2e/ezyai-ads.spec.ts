// EzyAI ChatGPT-Ads — E2E-Ablauf (QS-Runde 13.09.2026):
//   Mock-Konto verbinden → Kampagnenaktionen (Pausieren, Budget, Bulk) →
//   Geo-Targeting → Zielgruppen (Zuweisung + Upload gehasht) → Conversion-Setup
//   (Pixel, Server-Key, Event, Live-Event-Check).
// Das gesamte Netz ist gemockt (Supabase REST + eigene /api-Routen); der Mock
// ist ZUSTANDSBEHAFTET, weil die UI nach jeder Aktion neu laedt. Assertions
// pruefen sowohl die UI als auch die tatsaechlich gesendeten Requests
// (inkl. Bearer + X-Ezy-Active-Org aus authedFetch).
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT = "0f891a24-08bf-4110-8168-51d7a41dbe36";

// Supabase-Session-Key haengt vom Projekt-Ref ab (VITE_SUPABASE_URL in .env*).
function supabaseRef(): string {
  for (const f of [".env.local", ".env.development", ".env"]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^VITE_SUPABASE_URL=\s*"?https?:\/\/([a-z0-9]+)\./m);
    if (m) return m[1];
  }
  return "glrgccmujzuwnhyvwxyi";
}

const MOCK_GEO = [
  { id: "geo_ch", name: "Schweiz", type: "country", country_code: "CH" },
  { id: "geo_zh", name: "Zürich", type: "region", country_code: "CH" },
  { id: "geo_lu", name: "Luzern", type: "region", country_code: "CH" },
];

type Mock = ReturnType<typeof neuerMock>;
function neuerMock() {
  const campaigns = [
    {
      openai_campaign_id: "cmp_mock_brand",
      name: "Brand Awareness CH",
      status: "active",
      bidding_type: "cpm",
      objective: "traffic",
      budget_daily_micros: 50_000_000,
      budget_lifetime_micros: null,
      start_time: null,
      end_time: null,
      synced_at: "2026-09-13T08:00:00Z",
      targeting_locations: [MOCK_GEO[0]],
      targeting: {
        locations: { include: [{ id: "geo_ch" }] },
        custom_audiences: { ids: [] },
        excluded_custom_audiences: { ids: [] },
        excluded_locations: { include: [] },
      },
      conversion_event_setting_ids: [],
    },
    {
      openai_campaign_id: "cmp_mock_leads",
      name: "Lead-Gen Beratung",
      status: "active",
      bidding_type: "conversions",
      objective: "traffic",
      budget_daily_micros: 80_000_000,
      budget_lifetime_micros: null,
      synced_at: null,
      targeting_locations: [],
      targeting: {},
      conversion_event_setting_ids: [],
    },
    {
      openai_campaign_id: "cmp_mock_promo",
      name: "Herbst-Promo",
      status: "paused",
      bidding_type: "cpc",
      objective: "traffic",
      budget_daily_micros: 30_000_000,
      budget_lifetime_micros: null,
      synced_at: null,
      targeting_locations: [],
      targeting: {},
      conversion_event_setting_ids: [],
    },
  ];
  const audiences = [
    {
      openai_audience_id: "caud_mock_1",
      name: "Bestandskunden 2026",
      description: null,
      status: "ready",
      identifier_type: "email_sha256",
      matched_user_count_range: "under_25k",
      identifier_count: 3,
      created_at: "2026-09-10T10:00:00Z",
      synced_at: null,
    },
  ];
  const state = {
    connected: false,
    campaigns,
    audiences,
    pixels: [] as Array<{ id: string; name: string; pixel_id: string }>,
    eventSettings: [] as any[],
    configuredPixelId: null as string | null,
    hasCapiKey: false,
    posts: [] as Array<{ action: string; body: any; headers: Record<string, string> }>,
  };
  const konto = () => ({
    id: "acc-db",
    openai_ad_account_id: "mock_0f891a24",
    name: "Faith in Humanity (Demo)",
    currency_code: "USD",
    status: "active",
    is_mock: true,
    last_synced_at: "2026-09-13T08:00:00Z",
    last_sync_error: null,
    meta: null,
  });
  const getAntwort = () =>
    !state.connected
      ? { ok: true, connected: false }
      : {
          ok: true,
          connected: true,
          range: { from: "2026-08-15", to: "2026-09-13", days: 30 },
          account: konto(),
          campaigns: state.campaigns,
          insights: [
            {
              scope_openai_id: "cmp_mock_brand",
              date: "2026-09-12",
              impressions: 4000,
              clicks: 80,
              spend: 36,
              conversions: null,
              attributed_sales: null,
              roas: null,
              cpa: null,
              post_click_cvr: null,
            },
          ],
          commands: [],
          audiences: state.audiences,
          ads: [],
          adGroups: [],
        };
  const post = (action: string, body: any) => {
    const c = (id: string) => state.campaigns.find((k) => k.openai_campaign_id === id);
    switch (action) {
      case "connect":
        state.connected = true;
        return {
          ok: true,
          account: { id: "mock_0f891a24", name: konto().name, currency: "USD" },
          sync: {},
        };
      case "sync":
        return { ok: true, sync: {} };
      case "command": {
        const k = c(body.targetId);
        if (!k) return { ok: false, error: "unbekannte Kampagne" };
        if (body.cmd === "pause") k.status = "paused";
        if (body.cmd === "activate") k.status = "active";
        if (body.cmd === "set_budget") k.budget_daily_micros = body.budgetDailyMicros;
        if (body.cmd === "set_targeting") {
          k.targeting_locations = (body.locations || []).map(
            (l: any) => MOCK_GEO.find((g) => g.id === (l.id ?? l)) ?? l,
          );
          k.targeting = { ...(k.targeting || {}), locations: { include: body.locations || [] } };
        }
        if (body.cmd === "set_audiences")
          k.targeting = {
            ...(k.targeting || {}),
            custom_audiences: { ids: body.includeIds || [] },
            excluded_custom_audiences: { ids: body.excludeIds || [] },
          };
        return { ok: true };
      }
      case "bulk":
        for (const id of body.targetIds || []) {
          const k = c(id);
          if (k) k.status = body.cmd === "pause" ? "paused" : "active";
        }
        return { ok: true, done: (body.targetIds || []).length, failed: [] };
      case "geo-search": {
        const q = String(body.q || "").toLowerCase();
        return { ok: true, locations: MOCK_GEO.filter((g) => g.name.toLowerCase().includes(q)) };
      }
      case "audience-create": {
        const a = {
          openai_audience_id: `caud_mock_${state.audiences.length + 1}`,
          name: body.name,
          description: body.description || null,
          status: "processing",
          identifier_type: body.identifierType,
          matched_user_count_range: null,
          identifier_count: (body.hashes || []).length,
          created_at: new Date().toISOString(),
          synced_at: null,
        };
        state.audiences.unshift(a);
        return { ok: true, audience: a };
      }
      case "conv-setup-get":
        return {
          ok: true,
          pixels: state.pixels,
          eventSettings: state.eventSettings,
          campaigns: state.campaigns.map((k) => ({
            id: k.openai_campaign_id,
            name: k.name,
            status: k.status,
            eventSettingIds: [],
          })),
          configuredPixelId: state.configuredPixelId,
          hasCapiKey: state.hasCapiKey,
          isMock: true,
        };
      case "conv-pixel-create": {
        const p = {
          id: `cpx_mock_${state.pixels.length + 1}`,
          name: body.name || "Website",
          pixel_id: "pix_0f891a24_1",
        };
        state.pixels.push(p);
        state.configuredPixelId = p.pixel_id;
        return { ok: true, pixel: { ...p, client_type: "web" } };
      }
      case "conv-pixel-adopt":
        state.configuredPixelId = body.pixelId;
        return { ok: true };
      case "conv-key-create":
        if (!state.pixels.length)
          return { ok: false, error: "Zuerst ein Pixel anlegen (Demo)", status: 409 };
        state.hasCapiKey = true;
        return { ok: true };
      case "conv-event-create": {
        const e = {
          id: `ces_mock_${state.eventSettings.length + 1}`,
          name: body.name,
          event_type: body.eventType,
          custom_event_name: body.customEventName || null,
          attribution_window_days: body.attributionWindowDays,
          source_ids: body.sourceIds || [],
          campaigns: [],
          archived: false,
        };
        state.eventSettings.push(e);
        return { ok: true, eventSetting: e };
      }
      case "conv-sample":
        return {
          ok: true,
          pixelId: state.configuredPixelId,
          events: [
            {
              event_type: "lead_created",
              custom_event_name: null,
              api_channel: "server_to_server",
              event_timestamp_ms: Date.now() - 60_000,
              received_at_ms: Date.now() - 50_000,
              action_source: "web",
            },
          ],
          mock: true,
        };
      default:
        return { ok: true };
    }
  };
  return { state, getAntwort, post };
}

async function installiereMocks(page: Page, mock: Mock) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const rest: Record<string, unknown[]> = {
    app_users: [{ organization_id: ORG, role: "owner" }],
    user_roles: [],
    profiles: [{ full_name: "E2E Tester" }],
    clients: [
      {
        id: CLIENT,
        organization_id: ORG,
        name: "Faith in Humanity",
        domain: "faithinhumanity.ch",
        status: "active",
        metadata: {},
        canonry_project: "faith",
      },
    ],
    client_integrations: [{ client_id: CLIENT, provider: "canonry", enabled: true }],
    client_app_access: [],
    app_notifications: [],
    organizations: [{ id: ORG, name: "Ezy One" }],
  };
  // Playwright prueft Routen in UMGEKEHRTER Registrierungsreihenfolge — der
  // Catch-all fuer /api muss deshalb ZUERST registriert werden.
  await page.route("**/api/**", (r) =>
    json(r, { ok: false, error: "e2e-mock: nicht gemockt" }, 404),
  );
  await page.route("**/auth/v1/**", (r) => json(r, {}));
  await page.route("**/rest/v1/**", (r) => {
    const tabelle = new URL(r.request().url()).pathname.split("/rest/v1/")[1]?.split("?")[0] || "";
    json(r, rest[tabelle] ?? []);
  });
  await page.route("**/api/admin/chatgpt-ads**", async (r) => {
    const req = r.request();
    const headers = req.headers();
    if (req.method() === "GET") return json(r, mock.getAntwort());
    const body = req.postDataJSON() ?? {};
    mock.state.posts.push({ action: body.action, body, headers });
    const antwort: any = mock.post(body.action, body);
    return json(r, antwort, antwort.status ?? 200);
  });
  await page.route("**/api/admin/openai-ads**", (r) =>
    r.request().method() === "GET"
      ? json(r, {
          ok: true,
          range: { from: "2026-08-15", to: "2026-09-13", days: 30 },
          configured: true,
          enabled: true,
          pixelId: mock.state.configuredPixelId,
          totals: {
            events: 0,
            sent: 0,
            failed: 0,
            withOppref: 0,
            leads: 0,
            orders: 0,
            revenueCents: 0,
            currency: "CHF",
          },
          byDay: {},
          events: [],
        })
      : json(r, { ok: true }),
  );
  await page.route("**/api/admin/ingest-credentials**", (r) =>
    json(r, { ok: true, credentials: [] }),
  );
  page.on("dialog", (d) => d.dismiss());
}

test.beforeEach(async ({ page, context }) => {
  const ref = supabaseRef();
  await context.addInitScript(
    ([key, session, org, client]) => {
      localStorage.clear();
      localStorage.setItem(key, session);
      localStorage.setItem("ezy.activeOrg.v1", org);
      localStorage.setItem("ezyai.mode.v1", "ads");
      localStorage.setItem("ezyai.clientId", client);
    },
    [
      `sb-${ref}-auth-token`,
      JSON.stringify({
        access_token: "e2e-jwt",
        refresh_token: "e2e-refresh",
        token_type: "bearer",
        expires_in: 86_400,
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        user: {
          id: USER,
          email: "e2e@ezyone.ch",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: { full_name: "E2E Tester" },
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
      ORG,
      CLIENT,
    ],
  );
  void page;
});

test("ChatGPT Ads: Mock-Konto → Kampagnen → Geo-Targeting → Zielgruppen → Conversion-Setup", async ({
  page,
}) => {
  const mock = neuerMock();
  await installiereMocks(page, mock);
  const posts = (action: string) => mock.state.posts.filter((p) => p.action === action);
  // Requests laufen asynchron nach dem Klick — vor jeder Body-Assertion auf den
  // Eingang warten (CI-Flake 14.09.: "Cannot read properties of undefined (reading 'body')").
  const warteAufPost = (action: string, mindestens = 1) =>
    expect.poll(() => posts(action).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(mindestens);
  const warteAufCmd = (cmd: string) =>
    expect
      .poll(() => posts("command").filter((p) => p.body?.cmd === cmd).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

  await page.goto("/ezyai");
  // Kunde waehlen (Ads-Panels rendern erst mit gewaehltem Kunden).
  await page.locator('select[aria-label="Kunde"]').selectOption(CLIENT);
  await page.getByRole("button", { name: "Kampagnen" }).first().click();

  // ── 1) Mock-Konto verbinden ────────────────────────────────────────────
  await expect(page.getByText("ChatGPT-Ads-Konto verbinden").first()).toBeVisible();
  await page.getByPlaceholder("API-Key aus ads.openai.com (oder: mock)").fill("mock");
  await page.getByRole("button", { name: "Verbinden" }).click();
  await warteAufPost("connect");
  expect(posts("connect")[0].body.apiKey).toBe("mock");
  // Multi-Org-Vertrag: jeder Admin-Aufruf traegt Bearer + aktive Org.
  expect(posts("connect")[0].headers["authorization"]).toBe("Bearer e2e-jwt");
  expect(posts("connect")[0].headers["x-ezy-active-org"]).toBe(ORG);
  await expect(page.getByText("DEMO").first()).toBeVisible();
  await expect(page.locator("tr", { hasText: "Brand Awareness CH" }).first()).toBeVisible();
  await expect(page.getByText("Kampagnen (3)")).toBeVisible();

  // ── 2) Kampagnenaktionen: Pausieren, Budget, Bulk ──────────────────────
  const zeileBrand = page.locator("tr", { hasText: "Brand Awareness CH" }).first();
  await zeileBrand.getByTitle("Pausieren").click();
  await warteAufCmd("pause");
  expect(posts("command").at(-1)?.body).toMatchObject({
    cmd: "pause",
    targetType: "campaign",
    targetId: "cmp_mock_brand",
  });
  await expect(zeileBrand.getByText("pausiert")).toBeVisible();

  await zeileBrand.getByTitle("Klicken zum Ändern").click();
  const budget = zeileBrand.getByRole("textbox"); // Zeile hat auch eine Checkbox
  await budget.fill("75");
  await zeileBrand.getByRole("button", { name: "OK" }).click();
  await warteAufCmd("set_budget");
  expect(posts("command").at(-1)?.body).toMatchObject({
    cmd: "set_budget",
    targetId: "cmp_mock_brand",
    budgetDailyMicros: 75_000_000,
  });

  const zeileLeads = page.locator("tr", { hasText: "Lead-Gen Beratung" }).first();
  const zeilePromo = page.locator("tr", { hasText: "Herbst-Promo" }).first();
  await zeileLeads.getByRole("checkbox").check();
  await zeilePromo.getByRole("checkbox").check();
  await expect(page.getByText("2 ausgewählt").first()).toBeVisible();
  await page.getByRole("button", { name: "Pausieren", exact: true }).click();
  await page.getByRole("button", { name: "Ja, ausführen" }).click();
  await warteAufPost("bulk");
  expect(posts("bulk")[0].body).toMatchObject({ cmd: "pause" });
  expect(posts("bulk")[0].body.targetIds.sort()).toEqual(["cmp_mock_leads", "cmp_mock_promo"]);
  await expect(zeileLeads.getByText("pausiert")).toBeVisible();

  // ── 3) Geo-Targeting ──────────────────────────────────────────────────
  await zeileLeads.getByTitle("Klicken, um Länder/Regionen festzulegen").click();
  await expect(page.getByText("Geo-Targeting").first()).toBeVisible();
  await page
    .getByPlaceholder("Land, Kanton oder Region suchen … (z.B. Schweiz, Zürich)")
    .fill("Zür");
  await expect.poll(() => posts("geo-search").length).toBeGreaterThan(0);
  await page.getByText("Zürich", { exact: false }).last().click();
  await page.getByRole("button", { name: "Targeting speichern" }).click();
  await warteAufCmd("set_targeting");
  const targeting = posts("command").findLast((p) => p.body.cmd === "set_targeting");
  expect(targeting?.body.targetId).toBe("cmp_mock_leads");
  expect(JSON.stringify(targeting?.body.locations)).toContain("geo_zh");
  await expect(zeileLeads.getByText(/1 Region|Zürich/)).toBeVisible();

  // ── 4) Zielgruppen: Zuweisung an Kampagne + Upload gehasht ─────────────
  await zeilePromo.getByTitle("Klicken, um Zielgruppen zuzuweisen").click();
  await expect(page.getByText("Bestandskunden 2026").first()).toBeVisible();
  const editorZeile = page.locator("tr", { hasText: "Bestandskunden 2026" }).last();
  await editorZeile.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Zuweisung speichern" }).click();
  await warteAufCmd("set_audiences");
  const zuweisung = posts("command").findLast((p) => p.body.cmd === "set_audiences");
  expect(zuweisung?.body).toMatchObject({ targetId: "cmp_mock_promo" });
  expect(zuweisung?.body.includeIds).toContain("caud_mock_1");

  await page.getByRole("button", { name: "Zielgruppen" }).first().click();
  await expect(page.getByText("Neue Zielgruppe").first()).toBeVisible();
  await page.getByPlaceholder("Name (z.B. Bestandskunden 2026)").fill("E2E Newsletter");
  await page.locator("textarea").first().fill("anna@example.ch\nberta@example.ch\nkeine-mail");
  await expect(page.getByText("2 gültige Adressen").first()).toBeVisible();
  await page.getByRole("button", { name: "Gehasht hochladen" }).click();
  await expect.poll(() => posts("audience-create").length).toBe(1);
  const upload = posts("audience-create")[0].body;
  expect(upload.identifierType).toBe("email_sha256");
  expect(upload.hashes).toHaveLength(2);
  for (const h of upload.hashes) expect(h).toMatch(/^[0-9a-f]{64}$/); // Browser-SHA-256, nie Klartext
  expect(JSON.stringify(upload)).not.toContain("example.ch");
  await expect(page.getByText("E2E Newsletter").first()).toBeVisible();

  // ── 5) Conversion-Setup: Pixel → Server-Key → Event → Live-Check ───────
  await page.getByRole("button", { name: "Conversions" }).first().click();
  await expect(page.getByText("Pixel & Conversion-Events (OpenAI-Konto)")).toBeVisible();
  await page.getByRole("button", { name: "Pixel anlegen" }).click();
  await expect.poll(() => posts("conv-pixel-create").length).toBe(1);
  await expect(page.getByText("pix_0f891a24_1").first()).toBeVisible();
  await page.getByRole("button", { name: "Key erzeugen & sicher speichern" }).click();
  await expect.poll(() => posts("conv-key-create").length).toBe(1);
  await expect(page.getByText(/✓ hinterlegt/).first()).toBeVisible();
  await page.getByRole("button", { name: "Conversion-Event anlegen" }).click();
  await page.getByPlaceholder("Name (z.B. Kontaktanfrage)").fill("Kontaktanfrage");
  await page.getByRole("button", { name: "Event anlegen", exact: true }).click();
  await expect.poll(() => posts("conv-event-create").length).toBe(1);
  expect(posts("conv-event-create")[0].body).toMatchObject({ name: "Kontaktanfrage" });
  expect(posts("conv-event-create")[0].body.sourceIds).toContain("cpx_mock_1");
  await expect(page.getByText("Conversion-Events (1)")).toBeVisible();
  await page.getByRole("button", { name: "Live-Events (OpenAI)" }).click();
  await expect(page.getByText(/Events kommen bei OpenAI an/).first()).toBeVisible();
  await warteAufPost("conv-sample");
  expect(posts("conv-sample")).toHaveLength(1);

  // Kein Aufruf ohne Org-Stempel, kein Klartext-Secret im Netz.
  for (const p of mock.state.posts) {
    expect(p.headers["x-ezy-active-org"]).toBe(ORG);
    expect(p.headers["authorization"]).toBe("Bearer e2e-jwt");
  }
});

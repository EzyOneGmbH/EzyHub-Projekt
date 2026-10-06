// Mobile-Regression (02.10.2026, Volkan: «Mobile Optimierung durchführen»).
// iPhone-Breite 390 px, Netz komplett gemockt (wie ezyai-ads.spec.ts). Prüft je
// Hauptseite: kein seitliches Scrollen der Seite und der Inhalt endet nicht
// hinter der fixen unteren Tab-Leiste (Fehler bis 02.10.: die 480-px-Regel
// überschrieb den unteren Abstand).
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT = "0f891a24-08bf-4110-8168-51d7a41dbe36";

function supabaseRef(): string {
  for (const f of [".env.local", ".env.development", ".env"]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^VITE_SUPABASE_URL=\s*"?https?:\/\/([a-z0-9]+)\./m);
    if (m) return m[1];
  }
  return "glrgccmujzuwnhyvwxyi";
}

async function mocks(page: Page, role: string) {
  const json = (r: Route, body: unknown, status = 200) =>
    r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const clients = [
    ["Faith in Humanity", "faithinhumanity.ch", CLIENT],
    ["Hotel Bären Langnau im Emmental", "hotelbaeren.com", "11111111-1111-4111-8111-111111111111"],
    ["Centralgarage Sursee AG", "centralgarage.ch", "22222222-2222-4222-8222-222222222222"],
  ].map(([name, domain, id]) => ({
    id,
    organization_id: ORG,
    name,
    domain,
    status: "active",
    metadata: { first_party_kpi: true },
    canonry_project: "x",
  }));
  const rest: Record<string, unknown[]> = {
    app_users: [{ organization_id: ORG, role }],
    profiles: [{ full_name: "Volkan Karagülle" }],
    clients,
    client_integrations: clients.flatMap((c) =>
      ["canonry", "perplexity", "google-ads", "gsc", "ga4"].map((p) => ({
        client_id: c.id,
        provider: p,
        enabled: true,
      })),
    ),
    client_app_access: [],
    organizations: [{ id: ORG, name: "Ezy One" }],
  };
  await page.route("**/api/**", (r) => json(r, { ok: true, items: [], rows: [], data: [] }));
  await page.route("**/auth/v1/**", (r) => json(r, {}));
  await page.route("**/rest/v1/**", (r) => {
    const t = new URL(r.request().url()).pathname.split("/rest/v1/")[1]?.split("?")[0] || "";
    if (t.startsWith("rpc/")) return json(r, []);
    json(r, rest[t] ?? []);
  });
  page.on("dialog", (d) => d.dismiss());
}

async function session(page: Page) {
  const ref = supabaseRef();
  await page.context().addInitScript(
    ([key, s, org, client]) => {
      localStorage.setItem(key, s);
      localStorage.setItem("ezy.activeOrg.v1", org);
      localStorage.setItem("ezyai.clientId", client);
    },
    [
      `sb-${ref}-auth-token`,
      JSON.stringify({
        access_token: "e2e-jwt",
        refresh_token: "e2e-refresh",
        token_type: "bearer",
        expires_in: 86400,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        user: {
          id: USER,
          email: "volkan@ezyone.ch",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
      ORG,
      CLIENT,
    ],
  );
}

const ZIELE: Array<[string, string, string, string | null]> = [
  ["owner", "Launcher", "/apps", null],
  ["owner", "EzyRank", "/ezyrank", ".mobile-tabbar"],
  ["owner", "EzyAI", "/ezyai", ".ezyai-tabbar"],
  ["owner", "EzyPerformance", "/ezyperformance", ".mobile-tabbar"],
  ["owner", "Admin", "/admin?app=admin", ".mobile-tabbar"],
  ["viewer", "Kundenportal", "/dashboard", ".mobile-tabbar"],
  ["anon", "Login", "/login", null],
];

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const [role, name, url, tabbar] of ZIELE) {
  test(`Mobile 390 px: ${name}`, async ({ page }) => {
    if (role !== "anon") {
      await mocks(page, role);
      await session(page);
    }
    await page.goto(url);
    if (tabbar) await expect(page.locator(tabbar)).toBeVisible();
    else await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const m = await page.evaluate((sel) => {
      const doc = document.documentElement;
      const bar = sel ? document.querySelector(sel) : null;
      const barH = bar ? bar.getBoundingClientRect().height : 0;
      // Abstand unter dem Inhalt: padding-bottom des scrollenden Inhaltsbereichs
      const inhalt = document.querySelector(".app-content, .ezyai-main") as HTMLElement | null;
      const pb = inhalt ? parseFloat(getComputedStyle(inhalt).paddingBottom) : 0;
      return { vw: window.innerWidth, scrollW: doc.scrollWidth, barH, pb, hatInhalt: !!inhalt };
    }, tabbar);
    expect(m.scrollW, "Seite scrollt seitlich").toBeLessThanOrEqual(m.vw + 1);
    // Sprachschalter im Header auf jeder Seite (Volkan 06.10.2026)
    await expect(
      page.locator('[aria-label="Sprache / Language / Langue"]:visible').first(),
    ).toBeVisible();
    if (tabbar && m.hatInhalt)
      expect(m.pb, "Inhalt endet hinter der Tab-Leiste").toBeGreaterThanOrEqual(m.barH);
  });
}

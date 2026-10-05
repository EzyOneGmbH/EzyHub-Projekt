// Sprach-Umschaltung (05.10.2026): Login-Seite wechselt per Schalter auf EN/FR,
// die Wahl überlebt das Neuladen, zurück auf DE zeigt wieder den Originaltext.
import { test, expect } from "@playwright/test";

test("Sprachschalter DE → EN → FR → DE auf der Login-Seite", async ({ page }) => {
  await page.route("**/auth/v1/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // Hydration abwarten

  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("radio", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("radio", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
});

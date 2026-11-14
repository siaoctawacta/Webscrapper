import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * Main journey in Sample data mode:
 * sign up (first user = admin) → paste a Google Maps link → results fill in → sort by category then
 * name → filter "No website" → select rows → save to a collection → bulk-tag → write a proposal →
 * export to Excel → download.
 */

const EMAIL = `owner-${Date.now()}@example.com`;
const PASSWORD = "a-very-long-password-123";
const MAPS_LINK =
  "https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z/data=!3m1!4b1!4m4!2m3!5m2!5m1!1s2026-10-27?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D";

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel(/name/i).first().fill("Ama Owner");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /create account|sign up/i }).click();
  await page.waitForURL(/\/search/);
}

test("search → sort → filter → save → tag → proposal → export", async ({ page }) => {
  await signUp(page);

  // Paste the Google Maps link the user shared.
  await page.getByLabel("Paste a Google Maps link").fill(MAPS_LINK);
  await expect(page.getByText(/Search for/)).toBeVisible();
  await expect(page.getByText("“hôtel”")).toBeVisible();
  await page.getByRole("radio", { name: "100" }).click();
  await page.getByRole("button", { name: /start search/i }).click();

  // Results page fills in and completes.
  await page.waitForURL(/\/searches\/[0-9a-f-]{36}/);
  await expect(page.getByText(/^Completed$/).first()).toBeVisible({ timeout: 90_000 });
  const table = page.getByRole("table");
  await expect(table.getByRole("row").nth(1)).toBeVisible();

  // Sort by category, then Shift+click business name for a secondary sort.
  await table.getByRole("columnheader", { name: /category/i }).getByRole("button").first().click();
  await table.getByRole("columnheader", { name: /business name/i }).getByRole("button").first().click({ modifiers: ["Shift"] });
  await expect(page).toHaveURL(/sort=category%3Aasc.*sort=business_name%3Aasc|sort=category:asc.*sort=business_name:asc/);

  // "No website" segment.
  await page.getByRole("tab", { name: /no website/i }).click();
  await expect(page).toHaveURL(/filter%5Bhas_website%5D=false|filter\[has_website\]=false/);
  await expect(table.getByRole("row").nth(1)).toBeVisible();

  // Select the first page and save to a new collection.
  await table.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /save to collection/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/new collection name/i).fill("Lomé hotels without website");
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/Saved \d+ leads? to “Lomé hotels without website”/)).toBeVisible();

  // Open the collection and bulk-tag everything.
  await page.goto("/collections");
  await page.getByRole("link", { name: /open lomé hotels without website/i }).click();
  await page.waitForURL(/\/collections\/[0-9a-f-]{36}/);
  const leadsTable = page.getByRole("table");
  await expect(leadsTable.getByRole("row").nth(1)).toBeVisible();
  await leadsTable.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /^tags$/i }).click();
  await page.getByRole("menuitem", { name: /add tags/i }).click();
  await page.getByRole("dialog").getByPlaceholder(/add a tag/i).fill("call this week");
  await page.getByRole("dialog").getByRole("button", { name: /^add$/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /apply/i }).click();
  await expect(page.getByText(/Tagged \d+ leads?/)).toBeVisible();
  await expect(leadsTable.getByText("call this week").first()).toBeVisible();

  // Write a proposal for the first lead.
  await leadsTable.getByRole("row").nth(1).getByRole("button", { name: /lead actions/i }).click();
  await page.getByRole("menuitem", { name: /write proposal/i }).click();
  const proposal = page.getByRole("dialog");
  await proposal.getByRole("button", { name: /generate|write/i }).first().click();
  await expect(proposal.getByRole("textbox").last()).not.toBeEmpty();
  await proposal.getByRole("button", { name: /mark as sent/i }).click();
  await expect(page.getByText(/sent|saved/i).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Export the collection to Excel and check the file.
  await page.getByRole("button", { name: /^export$/i }).first().click();
  const exportDialog = page.getByRole("dialog");
  await exportDialog.getByRole("button", { name: /all filtered rows/i }).click();
  const downloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: /export \d+ rows/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = await download.path();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK"); // XLSX is a zip
});

test("signed-out visitors are sent to sign-in and APIs refuse them", async ({ page, request }) => {
  await page.goto("/collections");
  await expect(page).toHaveURL(/\/sign-in/);
  const res = await request.get("/api/v1/search-jobs");
  expect(res.status()).toBe(401);
});

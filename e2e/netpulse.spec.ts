import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

let fixture: ReturnType<typeof createServer>;
let fixtureUrl = "";

test.beforeAll(async () => {
  fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("deterministic NetPulse fixture");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not start");
  fixtureUrl = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
});

test("creates a real local HTTP monitor and shows its measurement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add a monitor" })).toBeVisible();
  await page.getByLabel("Monitor name").fill("Playwright fixture");
  await page.getByLabel("HTTP URL").fill(fixtureUrl);
  await page.getByRole("button", { name: "Start monitoring" }).click();

  const card = page.locator(".card").filter({ hasText: "Playwright fixture" });
  await expect(card).toContainText("Up", { timeout: 10_000 });
  await expect(card).toContainText("latest response");
  await expect(card).toContainText("sampled availability");
});

test("pauses, resumes, and deletes a monitor with confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Monitor name").fill("Lifecycle fixture");
  await page.getByLabel("HTTP URL").fill(fixtureUrl);
  await page.getByRole("button", { name: "Start monitoring" }).click();

  const card = page.locator(".card").filter({ hasText: "Lifecycle fixture" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card).toContainText("Paused");
  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByRole("button", { name: "Pause" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
});

import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

let fixture: ReturnType<typeof createServer>;
let tlsFixture: ReturnType<typeof createHttpsServer>;
let fixtureUrl = "";
let tlsFixtureUrl = "";

const certificate = readFileSync("apps/api/test-fixtures/localhost-cert.pem");
const privateKey = readFileSync("apps/api/test-fixtures/localhost-key.pem");

test.beforeAll(async () => {
  fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("deterministic NetPulse fixture");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not start");
  fixtureUrl = `http://127.0.0.1:${address.port}/`;
  tlsFixture = createHttpsServer({ cert: certificate, key: privateKey }, (_request, response) => response.end("deterministic TLS fixture"));
  await new Promise<void>((resolve) => tlsFixture.listen(0, "127.0.0.1", resolve));
  const tlsAddress = tlsFixture.address();
  if (!tlsAddress || typeof tlsAddress === "string") throw new Error("TLS fixture did not start");
  tlsFixtureUrl = `https://127.0.0.1:${tlsAddress.port}/`;
});

test.afterAll(async () => {
  await Promise.all([fixture, tlsFixture].map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function deleteMonitor(page: Page, name: string) {
  const card = page.locator(".card").filter({ hasText: name });
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

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
  await deleteMonitor(page, "Playwright fixture");
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

test("runs a real local HTTP diagnostic and displays measured phases", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Monitor name").fill("Diagnostic HTTP fixture");
  await page.getByLabel("HTTP URL").fill(fixtureUrl);
  await page.getByRole("button", { name: "Start monitoring" }).click();
  await expect(page.locator(".card").filter({ hasText: "Diagnostic HTTP fixture" })).toBeVisible();

  await page.getByLabel("Diagnostic monitor").selectOption({ label: "Diagnostic HTTP fixture" });
  await page.getByRole("button", { name: "Inspect HTTP" }).click();
  const result = page.locator(".diagnostic-result");
  await expect(result).toContainText("HTTP · COMPLETED");
  await expect(result).toContainText("HTTP/1.1 200");
  await expect(result).toContainText("DNS");
  await expect(result).toContainText("first byte");
  await expect(result).toContainText(fixtureUrl);
  await deleteMonitor(page, "Diagnostic HTTP fixture");
});

test("displays TLS trust, hostname, validity, and timing results", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Monitor name").fill("Diagnostic TLS fixture");
  await page.getByLabel("HTTP URL").fill(tlsFixtureUrl);
  await page.getByRole("button", { name: "Start monitoring" }).click();
  await expect(page.locator(".card").filter({ hasText: "Diagnostic TLS fixture" })).toBeVisible();

  await page.getByLabel("Diagnostic monitor").selectOption({ label: "Diagnostic TLS fixture" });
  await page.getByRole("button", { name: "Inspect TLS" }).click();
  const result = page.locator(".diagnostic-result");
  await expect(result).toContainText("TLS · COMPLETED");
  await expect(result).toContainText("not trusted");
  await expect(result).toContainText("hostname matches");
  await expect(result).toContainText("certificate valid");
  await expect(result).toContainText("handshake");
  await deleteMonitor(page, "Diagnostic TLS fixture");
});

test("protects agent management and displays one-time enrollment", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agent management" })).toBeVisible();
  await expect(page.getByText("Loopback prototype · cross-device disabled")).toBeVisible();

  await page.getByLabel("Administrator token").fill("wrong-token");
  await page.getByRole("button", { name: "Load agents" }).click();
  await expect(page.getByRole("alert")).toContainText("valid administrator token");

  await page.getByLabel("Administrator token").fill("playwright-admin-token");
  await page.getByRole("button", { name: "Load agents" }).click();
  await page.getByRole("button", { name: "Create enrollment" }).click();
  const enrollment = page.locator(".enrollment-token");
  await expect(enrollment).toContainText("One-time enrollment token");
  await expect(enrollment.locator("code")).not.toBeEmpty();
  await expect(enrollment).toContainText("It will not be shown again");
});

test("renders deterministic analysis with explicit insufficient evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Network analysis" })).toBeVisible();
  await expect(page.getByText("Deterministic analysis · AI assistance disabled")).toBeVisible();

  await page.getByLabel("Monitor name").fill("Analysis browser fixture");
  await page.getByLabel("HTTP URL").fill(fixtureUrl);
  await page.getByRole("button", { name: "Start monitoring" }).click();
  await expect(page.locator(".card").filter({ hasText: "Analysis browser fixture" })).toContainText("Up");
  await page.getByRole("button", { name: "Refresh analysis" }).click();

  const analysis = page.locator("section.analysis");
  await expect(analysis).toContainText("insufficient data");
  await expect(analysis).toContainText("Insufficient measurement history");
  await expect(analysis).toContainText("All displayed conclusions come from deterministic rules and stored evidence");
  await expect(analysis).toContainText("1 local / 0 agent");
  await deleteMonitor(page, "Analysis browser fixture");
});

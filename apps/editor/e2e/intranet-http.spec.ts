import { expect, test } from "@playwright/test";
import { NETLIST_A } from "../src/features/auto-layout/auto-layout-fixture.test-support";
import { openEditor, showNetlistPanel } from "./editor-fixtures";

test.beforeEach(async ({ page, baseURL }) => {
  const url = new URL(baseURL!);
  test.skip(url.protocol !== "http:", "Requires an ordinary HTTP origin");
  // The same local server, via an IPv4-mapped address Chromium treats as
  // ordinary HTTP. Leave browser APIs untouched, including in Workers.
  if (["localhost", "127.0.0.1"].includes(url.hostname))
    url.hostname = "[::ffff:127.0.0.1]";
  await page.addInitScript(() => {
    localStorage.setItem("icm.editor-mode.v1", "draw");
    localStorage.setItem("icm.editor-mode-coach.v1", "seen");
  });
  await openEditor(page, url.href);
  expect(
    await page.evaluate(() => [isSecureContext, typeof crypto.subtle]),
  ).toEqual([false, "undefined"]);
});

test("imports a SPICE file and applies automatic layout over HTTP", async ({
  page,
}) => {
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(NETLIST_A),
  });
  await expect(page.getByTestId("status")).toContainText(
    /Imported 1 Document.*Auto Layout applied/u,
    { timeout: 20_000 },
  );
});

test("generates the rich SPICE netlist over HTTP", async ({ page }) => {
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption("spice+rnl");
  await expect(
    panel.getByRole("textbox", { name: "RNL netlist code" }),
  ).toContainText('* @RNL(type="header")');
});

test("rejects changed RNL package bytes over HTTP", async ({ page }) => {
  await page.route("**/*analog-canvas-extensions*.rnl*", (route) =>
    route.request().resourceType() === "fetch"
      ? route.fulfill({ body: "changed package" })
      : route.continue(),
  );
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption("spice+rnl");
  await expect(
    panel.getByText(/Canvas package SHA-256 mismatch/u),
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";
import { sessionUser, signIn } from "./account-fixtures.js";

/** Each element's left, right and top edge in the viewport. */
const edges = (elements: Element[]) =>
  elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top };
  });

test("keeps editor chrome typography from suppressing SVG italics", async ({
  page,
}) => {
  await page.goto("/editor");

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 220 } });

  const italicRun = page
    .getByTestId("schematic-canvas")
    .locator('[data-text-run="span"][style*="font-style:italic"]')
    .first();
  await expect(italicRun).toBeVisible();
  await expect(italicRun).toHaveCSS("font-style", "italic");
  expect(
    await italicRun.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("font-synthesis"),
    ),
  ).not.toBe("none");
});

test("reads the change log without leaving the canvas", async ({
  page,
  context,
}) => {
  await page.goto("/editor");
  const trigger = page.getByRole("button", { name: "Change Log" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Change Log" });
  await expect(dialog.getByText("Open the editor over LAN HTTP")).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/editor$/);
  expect(context.pages()).toHaveLength(1);
});

test("keeps Library Netlist and Project Code together on the left at full and half width", async ({
  page,
}) => {
  await page.goto("/editor");
  const toolbar = page.getByTestId("draw-toolbar");
  const panels = toolbar.getByRole("group", { name: "Panels", exact: true });
  await expect(panels).toBeVisible();
  expect(
    await panels
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-testid")),
      ),
  ).toEqual(["library-toggle", "netlist-panel-toggle", "project-code-toggle"]);
  for (const width of [1440, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await panels.getByRole("button").evaluateAll(edges);
    expect(bounds[0]!.left).toBeLessThan(24);
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index]!.top).toBe(bounds[0]!.top);
      expect(
        bounds[index]!.left - bounds[index - 1]!.right,
      ).toBeLessThanOrEqual(8);
      expect(bounds[index]!.left).toBeGreaterThanOrEqual(
        bounds[index - 1]!.right,
      );
    }
    expect(bounds.at(-1)!.right).toBeLessThan(width);
    const summary = page.getByTestId("annotation-menu").locator("summary");
    const textBox = await page.getByTestId("draw-tool-text").boundingBox();
    const annotationBox = await summary.boundingBox();
    expect(
      annotationBox!.x - (textBox!.x + textBox!.width),
    ).toBeLessThanOrEqual(4);
    await summary.click();
    const palette = page.getByRole("group", { name: "Annotation tools" });
    await expect(palette.getByRole("button")).toHaveCount(9);
    const paletteBox = await palette.boundingBox();
    expect(paletteBox!.x).toBeGreaterThanOrEqual(0);
    expect(paletteBox!.x + paletteBox!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await summary.click();
    await page.getByTestId("draw-tool-wire").click();
    await expect(palette).toBeHidden();
  }
});

test("compacts the editor header at half width without GitHub, credit or account controls", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await signIn(
    page,
    sessionUser({
      id: "owner-1",
      displayName: "A Very Long Display Name",
      email: "owner@example.com",
      isAdmin: true,
    }),
  );
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/editor");

  await expect(page.getByRole("heading", { name: "Auto Canvas" })).toBeHidden();
  await expect(page.locator(".editor-brand")).toHaveAttribute(
    "aria-label",
    "Auto Canvas",
  );
  await expect(page.getByTestId("header-gallery-link")).toHaveCount(0);
  await expect(page.getByTestId("header-arena-link")).toHaveCount(0);
  // Even signed in, the header offers no account control (T149).
  await expect(page.getByTestId("account-name")).toHaveCount(0);
  await expect(page.getByTestId("account-owner")).toHaveCount(0);

  // One width per editor-chrome.css band the original six covered.
  for (const width of [320, 390, 480, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // T150c: File and ⋯ moved to the right of the row, after Auto Layout.
    const rowControls = page.locator(
      ".app-chrome-main :is(.editor-brand, .app-history, .mode-switch, .project-menu, .command-menu)",
    );
    const rowBounds = (await rowControls.evaluateAll(edges)).filter(
      ({ right, left }) => right > left,
    );
    expect(rowBounds.length).toBeGreaterThanOrEqual(4);
    expect(rowBounds[0]!.left).toBeLessThan(24);
    for (let index = 1; index < rowBounds.length; index++) {
      expect(rowBounds[index]!.left).toBeGreaterThanOrEqual(
        rowBounds[index - 1]!.right,
      );
      expect(
        Math.abs(rowBounds[index]!.top - rowBounds[0]!.top),
      ).toBeLessThanOrEqual(8);
    }

    const actions = page.locator(".app-chrome-actions");
    await expect(actions).toBeVisible();
    const chromeMain = await page.locator(".app-chrome-main").boundingBox();
    expect(chromeMain?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      48,
    );
    const actionBounds = await actions
      .locator('[data-testid="open-agent"]')
      .evaluateAll(edges);
    expect(actionBounds).toHaveLength(1);
    for (let index = 1; index < actionBounds.length; index++) {
      expect(actionBounds[index]!.left).toBeGreaterThanOrEqual(
        actionBounds[index - 1]!.right,
      );
      expect(
        Math.abs(actionBounds[index]!.top - actionBounds[0]!.top),
      ).toBeLessThanOrEqual(4);
    }
    expect(actionBounds.at(-1)!.right).toBeLessThanOrEqual(width);
    await expect(actions.getByTestId("publish-gallery-button")).toHaveCount(0);
    await expect(actions.getByTestId("open-agent")).toBeVisible();
    // No GitHub, bug report, credit or account control at any width (T149).
    for (const removed of [
      '[data-testid="editor-repository-link"]',
      '[data-testid="editor-report-bug"]',
      ".tokenzhang-credit",
      ".account-menu, .account-signin, .account-menu-fallback",
    ])
      await expect(actions.locator(removed)).toHaveCount(0);
    await expect(actions).not.toContainText("Presented by");
    if (width <= 760) {
      await expect(
        actions.getByTestId("open-agent").locator(".app-action-label"),
      ).toBeHidden();
    }
  }
});

// A failed providers or session request no longer brings an account
// fallback into the header (T149).
test("shows no account fallback when auth providers are unavailable", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/editor");

  const actions = page.locator(".app-chrome-actions");
  await expect(actions.getByTestId("open-agent")).toBeVisible();
  await expect(page.locator(".account-menu-fallback")).toHaveCount(0);
  await expect(actions.locator(".account-signin")).toHaveCount(0);
});

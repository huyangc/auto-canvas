import { expect, test, type Page } from "@playwright/test";

import { NETLIST_A } from "../src/features/auto-layout/auto-layout-fixture.test-support";
import {
  AUTO_MODE_STORAGE,
  awaitEditorReady,
  exampleProject,
  expectStatus,
  exportedProject,
  openCellManager,
  openEditor,
  openMenu,
} from "./editor-fixtures";

// A first-time visitor: nothing stored, so the editor opens in Auto mode.
test.use({ storageState: AUTO_MODE_STORAGE });

const COACH_TEXT =
  "Prefer to draw the circuit yourself? Switch to Draw here for the device library and drawing tools.";

const storedMode = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem("icm.editor-mode.v1"));

async function expectAutoChrome(page: Page) {
  await expect(page.getByTestId("mode-auto")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("draw-toolbar")).toHaveCount(0);
  await expect(page.getByTestId("shapes-library-panel")).toHaveCount(0);
}

async function expectDrawChrome(page: Page) {
  await expect(page.getByTestId("mode-draw")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("draw-toolbar")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeVisible();
}

test("first open: Auto mode, the coach mark, and the import card", async ({
  page,
}) => {
  await openEditor(page);
  await expectAutoChrome(page);
  const coach = page.getByTestId("mode-coach");
  await expect(coach).toBeVisible();
  await expect(coach).toContainText(COACH_TEXT);
  await expect(page.getByTestId("mode-coach-dismiss")).toHaveText("Got it");
  // The bubble hangs under the switch.
  const switchBox = (await page.getByTestId("mode-switch").boundingBox())!;
  const coachBox = (await coach.boundingBox())!;
  expect(coachBox.y).toBeGreaterThanOrEqual(switchBox.y + switchBox.height);
  expect(coachBox.x).toBeLessThanOrEqual(switchBox.x + switchBox.width);
  const card = page.getByTestId("auto-empty-state");
  await expect(card).toBeVisible();
  for (const action of [
    "empty-choose-netlist",
    "empty-open-project",
    "empty-examples",
    "empty-draw",
  ])
    await expect(card.getByTestId(action)).toBeVisible();
  await expect(page.getByTestId("import-netlist-button")).toBeVisible();
  await expect(page.getByTestId("auto-layout-button")).toBeVisible();
  // Netlist and Properties start closed, reachable from the canvas corner.
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("netlist-panel-toggle")).toBeVisible();
  await expect(page.getByTestId("properties-panel-toggle")).toBeVisible();

  await page.getByTestId("mode-coach-dismiss").click();
  await expect(coach).toHaveCount(0);
  await page.reload();
  await awaitEditorReady(page);
  await expectAutoChrome(page);
  await expect(page.getByTestId("mode-coach")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toHaveCount(0);
});

test("the switch to Draw dismisses the coach and is remembered", async ({
  page,
}) => {
  await openEditor(page);
  const revision = await page.getByTestId("revision").textContent();
  await page.getByTestId("mode-draw").click();
  await expectDrawChrome(page);
  await expect(page.getByTestId("mode-coach")).toHaveCount(0);
  await expectStatus(page, "Draw mode");
  // Draw opens with the Netlist beside the canvas, as the page always did.
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toBeVisible();
  // Only the UI changed.
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  await expect(page.getByTestId("draw-tool-undo")).toBeDisabled();
  expect(await storedMode(page)).toBe("draw");
  await page.reload();
  await awaitEditorReady(page);
  await expectDrawChrome(page);
  await expect(page.getByTestId("mode-coach")).toHaveCount(0);

  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  await page.reload();
  await awaitEditorReady(page);
  await expectAutoChrome(page);
});

test("an Auto import keeps the canvas clear and lays the netlist out", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await page.getByTestId("import-netlist-file").setInputFiles({
    name: "circuit.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(NETLIST_A),
  });
  await expect(page.getByTestId("status")).toContainText(
    /Imported 1 Document.*Auto Layout applied/u,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("auto-empty-state")).toHaveCount(0);
  await expectAutoChrome(page);
  // No Import Review dock: Properties waits behind its button.
  await expect(page.locator(".selection-dock.open")).toHaveCount(0);
  const canvas = (await page.getByTestId("schematic-canvas").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(canvas.width).toBeGreaterThanOrEqual(viewport.width * 0.85);
  // The review is still there when Properties is opened.
  await page.getByTestId("properties-panel-toggle").click();
  await expect(page.locator(".selection-dock.open")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Import Review" }),
  ).toBeVisible();
});

test("the card opens a project file through the chooser", async ({ page }) => {
  await openEditor(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("empty-open-project").click();
  await (
    await chooser
  ).setFiles({
    name: "two-stage.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify(exampleProject("two-stage-op-amp.icproj.json")),
    ),
  });
  await expect(page.getByTestId("auto-empty-state")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).not.toHaveText("0");
  await expectAutoChrome(page);
});

test("the card opens an example and goes to Draw", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId("empty-example-two-stage-op-amp")).toHaveCount(
    0,
  );
  await page.getByTestId("empty-examples").click();
  await page.getByTestId("empty-example-two-stage-op-amp").click();
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await expect(page.getByTestId("auto-empty-state")).toHaveCount(0);
  await expectAutoChrome(page);
  // A newly opened circuit keeps Auto's clear canvas.
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toHaveCount(0);

  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("empty-draw").click();
  await expectDrawChrome(page);
  expect(await storedMode(page)).toBe("draw");
});

test("the top-bar Auto Layout shows its run and Cancel stops it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const before = await exportedProject(page);
  const button = page.getByTestId("auto-layout-button");
  await expect(button).toBeEnabled();
  await button.click();
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  await expect(cancel).toHaveAttribute("aria-label", "Cancel Auto Layout");
  await expect(button).toContainText("Auto Layout…");
  // The status bar keeps only a finished report.
  await expect(page.getByTestId("auto-layout-status")).toHaveCount(0);
  await cancel.click();
  await expectStatus(page, /cancel/iu);
  await expect(cancel).toHaveCount(0);
  await expect(button).toBeEnabled();
  expect(
    (await exportedProject(page)).documents.map(
      ({ revision: _, ...rest }: { revision: number }) => rest,
    ),
  ).toEqual(
    before.documents.map(
      ({ revision: _, ...rest }: { revision: number }) => rest,
    ),
  );
});

test("switching to Auto drops an armed wire and leaves the drawing alone", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  await page.locator("body").press("w");
  await expect(page.getByTestId("statusbar-tool")).toHaveText("Wire");
  const revision = await page.getByTestId("revision").textContent();
  const undoEnabled = await page.getByTestId("draw-tool-undo").isEnabled();
  await page.getByTestId("mode-auto").click();
  await expect(page.getByTestId("statusbar-tool")).toHaveCount(0);
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  expect(await page.getByTestId("draw-tool-undo").isEnabled()).toBe(
    undoEnabled,
  );
  await expectStatus(page, "Auto mode");
});

test("a drawing key in Auto brings up Draw for this session only", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await expect(page.getByTestId("mode-coach")).toBeVisible();
  await page.locator("body").press("w");
  await expectDrawChrome(page);
  await expect(page.getByTestId("draw-tool-wire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Wire/u);
  await expect(page.getByTestId("mode-coach")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("statusbar-tool")).toHaveCount(0);

  // Not chosen with the switch: the next open is Auto again.
  expect(await storedMode(page)).toBeNull();
  await page.reload();
  await awaitEditorReady(page);
  await expectAutoChrome(page);
  await expect(page.getByTestId("mode-coach")).toHaveCount(0);

  // Chosen with the switch: remembered.
  await page.getByTestId("mode-draw").click();
  await page.reload();
  await awaitEditorReady(page);
  await expectDrawChrome(page);
});

test("B, I and T in Auto bring up Draw and do their job", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.locator("body").press("b");
  await expectDrawChrome(page);
  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "true",
  );
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Library/u);

  await page.getByTestId("mode-auto").click();
  await page.locator("body").press("i");
  await expect(page.locator(".insert-component-dialog")).toBeVisible();
  await expect(page.getByTestId("mode-draw")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".insert-component-dialog")).toHaveCount(0);

  await page.getByTestId("mode-auto").click();
  await page.locator("body").press("t");
  await expect(page.getByTestId("mode-draw")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Text/u);
});

test("Insert component… from the menu in Auto brings up Draw", async ({
  page,
}) => {
  await openEditor(page);
  const edit = await openMenu(page, "Edit");
  await edit.getByRole("button", { name: "Insert component… (I)" }).click();
  await expect(page.locator(".insert-component-dialog")).toBeVisible();
  await expect(page.getByTestId("mode-draw")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Insert/u);
  expect(await storedMode(page)).toBeNull();
});

test("W on a Cell Manager button in Auto changes nothing", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const manager = await openCellManager(page);
  await expect(manager).toBeVisible();
  await manager.getByRole("button").first().focus();
  await page.keyboard.press("w");
  await expect(page.getByTestId("mode-auto")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("canvas edits in Auto stay in Auto: rotate, Undo and Delete", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const before = await exportedProject(page);
  const count = await page.getByTestId("instance-count").textContent();
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("r");
  await expect
    .poll(async () =>
      JSON.stringify((await exportedProject(page)).documents[0].instances),
    )
    .not.toBe(JSON.stringify(before.documents[0].instances));
  await page.locator("body").press("ControlOrMeta+z");
  await expect
    .poll(async () =>
      JSON.stringify((await exportedProject(page)).documents[0].instances),
    )
    .toBe(JSON.stringify(before.documents[0].instances));
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("Delete");
  await expect(page.getByTestId("instance-count")).not.toHaveText(count!);
  await expectAutoChrome(page);
});

test("the Auto top bar stays one row with its controls on screen", async ({
  page,
}) => {
  await openEditor(page);
  for (const width of [320, 390, 480, 720, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const main = (await page.locator(".app-chrome-main").boundingBox())!;
    expect(main.height).toBeLessThanOrEqual(48);
    for (const testId of [
      "draw-tool-undo",
      "mode-switch",
      "auto-layout-button",
      "project-menu",
    ]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box.x, `${testId} at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} at ${width}px`).toBeLessThanOrEqual(
        width,
      );
      expect(box.y + box.height).toBeLessThanOrEqual(main.y + main.height);
    }
    // Below 720 px Import netlist… is in File only.
    await expect(page.getByTestId("import-netlist-button")).toBeVisible({
      visible: width > 720,
    });
  }
});

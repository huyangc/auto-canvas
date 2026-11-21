import { expect, test, type Page } from "@playwright/test";

import {
  NETLIST_A,
  NETLIST_B,
  resistorChainNetlist,
} from "../src/features/auto-layout/auto-layout-fixture.test-support";
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
  // The Netlist takes the dock from the canvas corner, and Properties takes
  // it back.
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toBeVisible();
  await page.getByTestId("properties-panel-toggle").click();
  await expect(
    page.getByRole("complementary", { name: "Project tools" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("properties-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".selection-dock.open")).toBeVisible();
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

const projectTools = (page: Page) =>
  page.getByRole("complementary", { name: "Project tools" });

test("a new project tab in Auto opens on a clear canvas", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByRole("button", { name: "New project tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expectAutoChrome(page);
  await expect(projectTools(page)).toHaveCount(0);
  await expect(page.getByTestId("netlist-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a reload after a drawing key opens Auto without Draw's docks", async ({
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
  await page.locator("body").press("w");
  await expectDrawChrome(page);
  await expect(projectTools(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("statusbar-tool")).toHaveCount(0);
  // The window saves this tab as Draw shows it, Netlist open, and brings it
  // back on reload.
  await page.reload();
  await awaitEditorReady(page);
  await expect(page.getByRole("tab", { selected: true })).toContainText("cs");
  await expectAutoChrome(page);
  await expect(projectTools(page)).toHaveCount(0);
  await expect(page.locator(".selection-dock.open")).toHaveCount(0);
  await expect(page.getByTestId("netlist-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a Netlist opened in Auto stays with its tab", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByRole("button", { name: "New project tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(projectTools(page)).toHaveCount(0);
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(projectTools(page)).toBeVisible();
  await expect(page.getByTestId("netlist-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

/** Import a netlist with the top bar's own input and wait for its layout. */
async function autoImport(page: Page, netlist = NETLIST_A) {
  await page.getByTestId("import-netlist-file").setInputFiles({
    name: "circuit.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(netlist),
  });
  await expect(page.getByTestId("status")).toContainText(
    /Auto Layout (applied|left)/u,
    { timeout: 60_000 },
  );
}

const importReview = (page: Page) =>
  page.getByRole("region", { name: "Import Review" });

async function expectReviewWaiting(page: Page, waiting: boolean) {
  const button = page.getByTestId("properties-panel-toggle");
  if (waiting) {
    await expect(button).toHaveAttribute("data-review-pending", "true");
    await expect(button).toHaveAccessibleName(
      "Properties, import review waiting",
    );
  } else {
    await expect(button).not.toHaveAttribute("data-review-pending", "true");
    await expect(button).toHaveAccessibleName("Properties");
  }
}

test("an unseen Import Review survives the Netlist", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  await expectReviewWaiting(page, true);
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  await expectReviewWaiting(page, true);
  await page.getByTestId("properties-panel-toggle").click();
  await expect(importReview(page)).toBeVisible();
  await expectReviewWaiting(page, false);
});

test("an unseen Import Review shows for a selected part and Q", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  await expectReviewWaiting(page, true);
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("q");
  await expect(importReview(page)).toBeVisible();
  await expectReviewWaiting(page, false);
});

test("an unseen Import Review survives W into Draw", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  await expectReviewWaiting(page, true);
  await page.locator("body").press("w");
  await expectDrawChrome(page);
  await page.keyboard.press("Escape");
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("q");
  await expect(importReview(page)).toBeVisible();
});

test("the same netlist file imports again", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  // The input is cleared after each import, so choosing the same file again
  // is a change the browser reports.
  await expect(page.getByTestId("import-netlist-file")).toHaveValue("");
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("Delete");
  const instances = page
    .getByTestId("editor-test-telemetry")
    .getByTestId("instance-count");
  await expect(instances).toHaveText("0");
  await autoImport(page);
  await expect(instances).not.toHaveText("0");
});

test("switching to Auto drops a Net Label being placed", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 200, y: 200 } });
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("N1");
  await editor.press("Enter");
  await expect(page.getByTestId("net-label-placement-preview")).toBeVisible();
  const revision = await page.getByTestId("revision").textContent();
  await page.getByTestId("mode-auto").click();
  await expect(page.getByTestId("net-label-placement-preview")).toHaveCount(0);
  await expectStatus(page, "Auto mode");
  await canvas.click({ position: { x: 300, y: 300 } });
  await expect(page.getByTestId("revision")).toHaveText(revision!);
});

test("W inside an open File menu changes nothing", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const file = await openMenu(page, "File");
  await file.getByRole("button").first().focus();
  await page.keyboard.press("w");
  await expect(page.getByTestId("mode-auto")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("active-tool")).toHaveText("pointer");
});

test("a long running label keeps Cancel and Agent on screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const button = page.getByTestId("auto-layout-button");
  await button.click();
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  // Focus moves to Cancel when the button it was on goes disabled.
  await expect(cancel).toBeFocused();
  for (const width of [1024, 800]) {
    await page.setViewportSize({ width, height: 800 });
    // The longest label a run reports, as a double for the ticking text.
    await button
      .locator(".app-action-label")
      .evaluate(
        (label) =>
          (label.textContent =
            "Auto Layout… 123 s · Cell 2 of 3 · evaluation 120/240"),
      );
    for (const testId of ["auto-layout-cancel", "open-agent"]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box.x + box.width, `${testId} at ${width}px`).toBeLessThanOrEqual(
        width,
      );
      expect(box.width, `${testId} at ${width}px`).toBeGreaterThan(20);
    }
  }
  // At 760 px and below the label goes; a short elapsed time stays.
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.getByTestId("auto-layout-elapsed")).toBeVisible();
  await expect(page.getByTestId("auto-layout-elapsed")).toHaveText(/^\d+ s$/u);
  await cancel.click();
  await expect(cancel).toHaveCount(0);
});

test("Draw it yourself puts focus on the Draw switch", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("empty-draw").click();
  await expect(page.getByTestId("mode-draw")).toBeFocused();
});

test("each mode keeps its own Netlist across a round trip", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByTestId("mode-draw").click();
  // Draw's own start: its Netlist is open too, so close it there.
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toHaveCount(0);
  await page.getByTestId("mode-auto").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByTestId("mode-draw").click();
  await expect(projectTools(page)).toHaveCount(0);
});

test("a circuit opened in Auto starts Draw with its Netlist", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toHaveCount(0);
  await page.getByTestId("mode-auto").click();
  await page.getByTestId("empty-examples").click();
  await page.getByTestId("empty-example-two-stage-op-amp").click();
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await expect(projectTools(page)).toHaveCount(0);
  await page.getByTestId("mode-draw").click();
  await expect(projectTools(page)).toBeVisible();
});

test("L, P and Place Cell in Auto bring up Draw", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page, NETLIST_B);
  await page.locator("body").press("l");
  await expectDrawChrome(page);
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Net label/u);
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.getByTestId("mode-auto").click();
  await page.locator("body").press("p");
  await expectDrawChrome(page);
  await expect(page.getByTestId("status")).toHaveText(/^Draw mode: Cell pin/u);
  await page.keyboard.press("Escape");

  await page.getByTestId("mode-auto").click();
  const edit = await openMenu(page, "Edit");
  await edit
    .getByRole("button", { name: "Place Cell from this Project…" })
    .click();
  await expectDrawChrome(page);
  await expect(page.getByTestId("status")).toHaveText(
    /^Draw mode: Place Cell/u,
  );
  await page.keyboard.press("Escape");

  // The Cell Manager's Place does the same.
  await page.getByTestId("mode-auto").click();
  const manager = await openCellManager(page);
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasNotText: /top/u })
    .first()
    .click();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await expect(manager).toHaveCount(0);
  await expectDrawChrome(page);
  await expect(page.getByTestId("status")).toHaveText(
    /^Draw mode: Place Cell/u,
  );
});

test("a failed import in Auto shows its review", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByTestId("import-netlist-file").setInputFiles({
    name: "broken.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(".subckt broken\nX1 a b missing\n"),
  });
  await expect(importReview(page)).toBeVisible();
  await expect(projectTools(page)).toHaveCount(0);
});

const BROKEN_NETLIST = ".subckt broken\nX1 a b missing\n";

async function failedImport(page: Page, name = "broken.sp") {
  await page.getByTestId("import-netlist-file").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(BROKEN_NETLIST),
  });
}

test("an unapplied Project Code draft stays on screen across a switch", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("unapplied draft");
  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  await expect(code).toHaveText("unapplied draft");
  // Back in Draw it is still the same draft.
  await page.getByTestId("mode-draw").click();
  await expect(code).toHaveText("unapplied draft");
});

test("an unapplied Netlist code draft stays on screen across a switch", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toBeVisible();
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n* unapplied draft");
  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  await expect(code).toContainText("* unapplied draft");
});

test("a failed import keeps an unapplied code draft", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("netlist-panel-toggle").click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n* unapplied draft");
  await failedImport(page);
  await expect(page.getByTestId("status")).not.toContainText("Opened example");
  await expect(code).toContainText("* unapplied draft");
  // The review waits for Properties.
  await expectReviewWaiting(page, true);
});

test("Document settings close on the switch to Auto and hold nothing", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("draw-tool-document-style").click();
  await expect(page.getByTestId("document-settings-code-editor")).toBeVisible();
  await page.getByTestId("properties-resize-handle").waitFor();
  await page.getByTestId("mode-auto").click();
  await page.getByRole("button", { name: "New project tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId("status")).not.toContainText(
    "Can't switch project tabs yet",
  );
});

test("an unseen Import Review survives a project-tab switch", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  await expectReviewWaiting(page, true);
  await page.getByRole("button", { name: "New project tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expectReviewWaiting(page, false);
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectReviewWaiting(page, true);
  await page.getByTestId("properties-panel-toggle").click();
  await expect(importReview(page)).toBeVisible();
});

test("a review on screen replaced by another failed import is not waiting", async ({
  page,
}) => {
  await openEditor(page);
  await failedImport(page);
  await expect(importReview(page)).toContainText("broken.sp");
  await expectReviewWaiting(page, false);
  await failedImport(page, "broken2.sp");
  // The second report has landed before anything is checked.
  await expect(importReview(page)).toContainText("broken2.sp");
  await expectReviewWaiting(page, false);
});

test("a seen review is put away on the next close of Properties", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await autoImport(page);
  const toggle = page.getByTestId("properties-panel-toggle");
  await toggle.click();
  await expect(importReview(page)).toBeVisible();
  await toggle.click();
  await toggle.click();
  await expect(page.locator(".selection-dock.open")).toBeVisible();
  await expect(importReview(page)).toHaveCount(0);
});

test("a failed import in Draw shows its review", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("mode-draw").click();
  await failedImport(page);
  await expect(importReview(page)).toBeVisible();
});

test("closing Draw's Netlist does not open Properties left open in Auto", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("properties-panel-toggle").click();
  await expect(page.locator(".selection-dock.open")).toBeVisible();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByTestId("mode-draw").click();
  await expect(projectTools(page)).toBeVisible();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toHaveCount(0);
  await expect(page.locator(".selection-dock.open")).toHaveCount(0);
});

test("a running Auto Layout fits a phone-width top bar", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("auto-layout-button").click();
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const testId of [
      "auto-layout-elapsed",
      "auto-layout-cancel",
      "auto-layout-button",
    ]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box, `${testId} at ${width}px`).not.toBeNull();
      expect(box.x, `${testId} at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} at ${width}px`).toBeLessThanOrEqual(
        width,
      );
    }
  }
  await cancel.click();
  await expect(cancel).toHaveCount(0);
});

test("an existing canvas text being edited is committed by the click on the switch", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  const canvas = page.getByTestId("schematic-canvas");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  // Place a text note, then edit it.
  await canvas.hover({ position: { x: 200, y: 150 } });
  await page.keyboard.press("t");
  await editor.fill("first note");
  await page.keyboard.press("Enter");
  await canvas.click({ position: { x: 200, y: 150 } });
  await expectStatus(page, /^Added text/u);
  await page.keyboard.press("Escape");
  await canvas.dblclick({ position: { x: 205, y: 150 } });
  await expect(editor).toBeVisible();
  await editor.fill("edited note");
  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  const text = JSON.stringify((await exportedProject(page)).documents);
  expect(text).toContain("edited note");
  expect(text).not.toContain("first note");
});

test("switching to Auto cancels typed text an armed tool holds", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  const canvas = page.getByTestId("schematic-canvas");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const revision = await page.getByTestId("revision").textContent();
  const undo = page.getByTestId("draw-tool-undo");
  const undoEnabled = await undo.isEnabled();

  // An unplaced Text draft, as Escape would.
  await canvas.hover({ position: { x: 200, y: 150 } });
  await page.keyboard.press("t");
  await editor.fill("never placed");
  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  expect(await undo.isEnabled()).toBe(undoEnabled);

  // A Net Label name being typed after L.
  await page.getByTestId("mode-draw").click();
  await canvas.hover({ position: { x: 200, y: 150 } });
  await page.keyboard.press("l");
  await editor.fill("NEVERNAMED");
  await page.getByTestId("mode-auto").click();
  await expectAutoChrome(page);
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  expect(await undo.isEnabled()).toBe(undoEnabled);

  const text = JSON.stringify((await exportedProject(page)).documents);
  expect(text).not.toContain("never placed");
  expect(text).not.toContain("NEVERNAMED");
});

for (const width of [390, 720]) {
  test(`at ${width} px the canvas buttons stay reachable over an open dock`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page, "/editor?example=two-stage-op-amp");
    await expectStatus(page, "Opened example: Two-Stage Op Amp");
    const netlist = page.getByTestId("netlist-panel-toggle");
    const properties = page.getByTestId("properties-panel-toggle");
    await netlist.click();
    await expect(projectTools(page)).toBeVisible();
    // Real clicks: the buttons are on top, not under the dock.
    await netlist.click();
    await expect(projectTools(page)).toHaveCount(0);
    await netlist.click();
    await expect(projectTools(page)).toBeVisible();
    await properties.click();
    await expect(projectTools(page)).toHaveCount(0);
    await expect(page.locator(".selection-dock.open")).toBeVisible();
    // Properties' own controls are not under the buttons either.
    const buttons = (await page
      .locator(".canvas-panel-buttons")
      .boundingBox())!;
    const dock = page.locator(".selection-dock.open");
    const lastControl = dock
      .locator("button:visible, select:visible, input:visible")
      .last();
    const control = await lastControl.boundingBox();
    if (control)
      expect(control.y + control.height).toBeLessThanOrEqual(buttons.y);
    await properties.click();
    await expect(page.locator(".selection-dock.open")).toHaveCount(0);
    // Same check for the Netlist dock's last control.
    await netlist.click();
    const netlistControl = await projectTools(page)
      .locator("button:visible, select:visible")
      .last()
      .boundingBox();
    if (netlistControl)
      expect(netlistControl.y + netlistControl.height).toBeLessThanOrEqual(
        buttons.y,
      );
  });
}

test("the Netlist button closes any project dock kept open in Auto", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("unapplied draft");
  await page.getByTestId("mode-auto").click();
  await expect(code).toBeVisible();
  const toggle = page.getByTestId("netlist-panel-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAccessibleName("Project Code");
  await expect(toggle).toHaveAttribute("title", "Hide Project Code");
  await toggle.click();
  await expect(code).toHaveCount(0);
  await expect(projectTools(page)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAccessibleName("Netlist");
  // With nothing open it opens the Netlist.
  await toggle.click();
  await expect(page.getByLabel("Netlist code", { exact: true })).toBeVisible();
});

test("the card's example waits for an unapplied code draft", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("unapplied draft");
  await page.getByTestId("mode-auto").click();
  await page.getByTestId("empty-examples").click();
  await page.getByTestId("empty-example-two-stage-op-amp").click();
  await expectStatus(
    page,
    "Can't open a Project yet: a code panel holds a draft that is not applied",
  );
  await expect(code).toHaveText("unapplied draft");
  await expect(
    page.getByTestId("editor-test-telemetry").getByTestId("instance-count"),
  ).toHaveText("0");
});

test("a dock carried only for a draft is not remembered as the mode's own", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  // Auto's own choice: Properties.
  await page.getByTestId("properties-panel-toggle").click();
  await expect(page.locator(".selection-dock.open")).toBeVisible();
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("unapplied draft");
  // Carried into Auto and back while the draft is unapplied.
  await page.getByTestId("mode-auto").click();
  await expect(code).toBeVisible();
  await page.getByTestId("mode-draw").click();
  await expect(code).toBeVisible();
  // The draft goes; Auto then shows its own Properties again.
  await page.getByRole("button", { name: /Reload/ }).click();
  await expect(code).not.toHaveText("unapplied draft");
  await page.getByTestId("mode-auto").click();
  await expect(projectTools(page)).toHaveCount(0);
  await expect(page.locator(".selection-dock.open")).toBeVisible();
});

for (const width of [320, 390, 480, 720]) {
  test(`header menus open inside the viewport at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page, "/editor?example=two-stage-op-amp");
    await expectStatus(page, "Opened example: Two-Stage Op Amp");
    for (const mode of ["mode-auto", "mode-draw"]) {
      await page.getByTestId(mode).click();
      for (const menuId of ["project-menu", "edit-menu", "circuit-menu"]) {
        const menu = page.getByTestId(menuId);
        await menu.locator(":scope > summary").click();
        await expect(menu).toHaveAttribute("open", "");
        const popover = (await menu
          .locator(":scope > .command-popover, :scope > .project-menu-popover")
          .first()
          .boundingBox())!;
        expect(
          popover.x,
          `${menuId} at ${width}px (${mode})`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          popover.x + popover.width,
          `${menuId} at ${width}px (${mode})`,
        ).toBeLessThanOrEqual(width);
        if (menuId === "edit-menu") {
          const item = (await menu
            .getByRole("button", { name: /^Choose Selectable Objects/u })
            .boundingBox())!;
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.x + item.width).toBeLessThanOrEqual(width);
        }
        await page.keyboard.press("Escape");
        await expect(menu).not.toHaveAttribute("open", "");
      }
    }
  });
}

test("a dock carried for a draft is not saved with the tab as Auto's own", async ({
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
  await page.getByTestId("mode-draw").click();
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("unapplied draft");
  // Carried into Auto for the draft, which then goes.
  await page.getByTestId("mode-auto").click();
  await expect(code).toBeVisible();
  await page.getByRole("button", { name: /Reload/ }).click();
  await expect(code).not.toHaveText("unapplied draft");
  // The window saves Auto's own docks for this tab, not the carried one.
  await page.reload();
  await awaitEditorReady(page);
  await expect(page.getByRole("tab", { selected: true })).toContainText("cs");
  await expectAutoChrome(page);
  await expect(projectTools(page)).toHaveCount(0);
  await expect(page.locator(".selection-dock.open")).toHaveCount(0);
});

test("a Space after an import from the card does not cancel its layout", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("empty-choose-netlist").click();
  await (
    await chooser
  ).setFiles({
    name: "chain.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(resistorChainNetlist(60)),
  });
  // The card's button went with the card; the run's Cancel does not take
  // its focus.
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  await expect(cancel).not.toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("status")).toContainText(
    "Auto Layout applied to 2 of 2 Cells",
    { timeout: 60_000 },
  );
});

const boxesOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test("the Cells rail lists each Cell with its layout status", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  // One Cell: nothing to choose from, the canvas keeps the width.
  await expect(page.getByTestId("cells-rail")).toHaveCount(0);
  await autoImport(page, resistorChainNetlist(121));
  await expectStatus(
    page,
    "Auto Layout applied to 1 of 2 Cells; chain: more than 120 parts",
  );
  const project = await exportedProject(page);
  const chainId = project.documents.find(
    (d: { name: string }) => d.name === "chain",
  ).id;
  const rail = page.getByRole("navigation", { name: "Cell list" });
  await expect(rail).toHaveAttribute("data-testid", "cells-rail");
  const top = rail.getByTestId(`cells-rail-${project.topDocumentId}`);
  const chain = rail.getByTestId(`cells-rail-${chainId}`);
  await expect(rail.getByRole("button")).toHaveCount(2);
  await expect(rail.getByRole("button").first()).toHaveAttribute(
    "data-testid",
    `cells-rail-${project.topDocumentId}`,
  );
  await expect(top.locator(".cells-rail-status")).toHaveText("laid out");
  await expect(top).toHaveAttribute("aria-current", "true");
  await expect(chain.locator(".cells-rail-status")).toHaveText("not laid out");
  await expect(chain.locator(".cells-rail-reason")).toHaveText(
    "more than 120 parts",
  );
  await expect(chain).toHaveAttribute("title", /more than 120 parts/u);

  // Nothing on the canvas sits over the rail.
  const railBox = (await rail.boundingBox())!;
  expect(railBox.width).toBeLessThanOrEqual(200);
  for (const testId of [
    "mode-coach",
    "netlist-panel-toggle",
    "properties-panel-toggle",
  ]) {
    const box = (await page.getByTestId(testId).boundingBox())!;
    expect(boxesOverlap(box, railBox), testId).toBe(false);
  }

  // The reason outlives the report's Details.
  await page.getByTestId("auto-layout-details").click();
  const report = page.getByTestId("auto-layout-report");
  await expect(report).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
  await expect(page.getByTestId("auto-layout-status")).toHaveCount(0);
  await expect(chain.locator(".cells-rail-reason")).toHaveText(
    "more than 120 parts",
  );

  // A row opens its Cell.
  await chain.click();
  await expectStatus(page, "Opened Cell chain");
  await expect(chain).toHaveAttribute("aria-current", "true");
  await expect(top).not.toHaveAttribute("aria-current", "true");

  // An edit of the refused Cell makes its reason stale.
  const revisionOutput = page
    .getByTestId("editor-test-telemetry")
    .getByTestId("revision");
  const revision = await revisionOutput.textContent();
  await page.locator("body").press("ControlOrMeta+a");
  await page.locator("body").press("r");
  await expect(revisionOutput).not.toHaveText(revision!);
  await expect(chain.locator(".cells-rail-reason")).toHaveCount(0);
  await expect(chain.locator(".cells-rail-status")).toHaveText("as imported");
  await expectAutoChrome(page);

  // Draw keeps its Library and Cell selector; the rail is Auto's.
  await page.getByTestId("mode-draw").click();
  await expectDrawChrome(page);
  await expect(page.getByTestId("cells-rail")).toHaveCount(0);
  await expect(page.getByTestId("cell-navigation")).toBeVisible();
  await page.getByTestId("mode-auto").click();
  await expect(rail).toBeVisible();

  // At compact width Auto keeps the hierarchy row instead.
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.getByTestId("cells-rail")).toHaveCount(0);
  await expect(page.getByTestId("cell-navigation")).toBeVisible();
});

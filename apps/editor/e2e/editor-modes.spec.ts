import { expect, test, type Page } from "@playwright/test";

import {
  NETLIST_A,
  NETLIST_B,
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

async function failedImport(page: Page) {
  await page.getByTestId("import-netlist-file").setInputFiles({
    name: "broken.sp",
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
  await expect(importReview(page)).toBeVisible();
  await expectReviewWaiting(page, false);
  await failedImport(page);
  await expect(importReview(page)).toBeVisible();
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

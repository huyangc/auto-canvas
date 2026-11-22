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
  renameProject,
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
      "more-menu",
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

test("W inside an open File or ⋯ menu changes nothing", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  for (const name of ["File", "Edit"]) {
    const group = await openMenu(page, name);
    await group.getByRole("button").first().focus();
    await page.keyboard.press("w");
    await expect(page.getByTestId("mode-auto")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("active-tool")).toHaveText("pointer");
    await page.keyboard.press("Escape");
  }
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
      for (const menuId of ["project-menu", "more-menu"]) {
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
        expect(
          popover.y + popover.height,
          `${menuId} at ${width}px (${mode})`,
        ).toBeLessThanOrEqual(800);
        if (menuId === "more-menu") {
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

test("a tab switch ends a draft's carry-over, so the other tab keeps its docks", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  // Tab 2 opens its Netlist in Auto: its own dock.
  await page.getByRole("button", { name: "New project tab" }).click();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(projectTools(page)).toBeVisible();
  // Tab 1 carries a Netlist draft from Draw into Auto; the draft then goes
  // and the same dock stays on screen.
  await tabs.nth(0).click();
  await expect(projectTools(page)).toHaveCount(0);
  await page.getByTestId("mode-draw").click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n* unapplied draft");
  await page.getByTestId("mode-auto").click();
  await expect(code).toContainText("* unapplied draft");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(code).not.toContainText("* unapplied draft");
  // Tab 2 shows the same docks; leaving it again must save them as its own.
  await tabs.nth(1).click();
  await expect(projectTools(page)).toBeVisible();
  await tabs.nth(0).click();
  await expect(projectTools(page)).toHaveCount(0);
  await tabs.nth(1).click();
  await expect(projectTools(page)).toBeVisible();
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
  // A long Cell name is clipped in its row; the rail never scrolls sideways.
  // A double for the name, as the running-label test does.
  await chain
    .locator(".cells-rail-name")
    .evaluate(
      (name) =>
        (name.firstChild!.textContent =
          "folded_cascode_operational_transconductance1"),
    );
  expect(await rail.evaluate((nav) => nav.scrollWidth <= nav.clientWidth)).toBe(
    true,
  );
  await chain
    .locator(".cells-rail-name")
    .evaluate((name) => (name.firstChild!.textContent = "chain"));

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

// T150c: one ⋯ menu replaces Edit and Circuit, and the top bar names the
// project.

type Place =
  /** A header menu group, opened through `openMenu`; `submenu` first. */
  | {
      menu: "File" | "Edit" | "Hierarchy" | "Netlist" | "Layout";
      items: readonly string[];
      submenu?: "Import" | "Export";
      /** Labels rather than buttons (File → Import's file pickers). */
      labels?: boolean;
      enabled?: boolean;
    }
  /** Controls outside the menus, by test id or a "." class selector. */
  | { shown: readonly string[]; enabled?: boolean }
  /** Not in this mode. */
  | { absent: readonly string[] };

interface MenuTableRow {
  /** The row's Item column in decision 21 of tasks/T150-two-modes/plan.md. */
  item: string;
  auto: readonly Place[];
  draw: readonly Place[];
}

const both = (places: readonly Place[]) => ({ auto: places, draw: places });

const drawingTools = [
  "draw-tool-wire",
  "draw-tool-no-connect",
  "draw-tool-text",
  "annotation-menu",
  "draw-tool-document-style",
  "draw-tool-reset-labels",
];

// Decision 21's table, row by row, as the user reaches each item; an item
// missing from the page fails the walk. Not walked: Revert and Recover (only
// with a saved copy or recovery sessions), RNL… (a host that imports RNL),
// the desktop file commands, Cancel Auto Layout (only while a run plans; the
// running tests cover it), Open Shelf project in tab (Cloud sign-in) and the
// empty card (only with no Instance).
const MENU_TABLE: readonly MenuTableRow[] = [
  {
    item: "File commands",
    ...both([
      {
        menu: "File",
        items: ["Project Info", "New Project", "Save", "Check and Save"],
      },
      {
        menu: "File",
        submenu: "Import",
        labels: true,
        items: [
          "Project File…",
          "SPICE / SCS…",
          "Cadence SPICE (`!` globals)…",
        ],
      },
      {
        menu: "File",
        submenu: "Export",
        items: [
          "Export Project File…",
          "Export SVG",
          "Export PNG",
          "Export PDF",
          "Export Netlist",
        ],
      },
    ]),
  },
  {
    item: "SPICE / SCS… shortcut",
    auto: [{ shown: ["import-netlist-button"], enabled: true }],
    draw: [{ absent: ["import-netlist-button"] }],
  },
  ...[
    "Insert component… (I)",
    "User Components…",
    "Place Cell from this Project…",
    "Find in Circuit… (Ctrl+F)",
  ].map((name) => ({
    item: name,
    ...both([{ menu: "Edit", items: [name], enabled: true }]),
  })),
  {
    item: "Selection group",
    ...both([
      {
        menu: "Edit",
        items: [
          "Delete",
          "Copy selection as PNG",
          "Copy selection as SVG",
          "Rotate",
          "Mirror left/right (Shift+R)",
          "Mirror top/bottom (Ctrl+R)",
          "Align left",
          "Align horizontal center",
          "Align right",
          "Align top",
          "Align vertical center",
          "Align bottom",
        ],
      },
    ]),
  },
  {
    item: "Choose Selectable Objects…",
    ...both([
      {
        menu: "Edit",
        items: ["Choose Selectable Objects… (Ctrl+Shift+F)"],
        enabled: true,
      },
    ]),
  },
  {
    item: "Cell Manager…",
    ...both([{ menu: "Hierarchy", items: ["Cell Manager…"], enabled: true }]),
  },
  {
    item: "Netlist commands",
    ...both([
      {
        menu: "Netlist",
        items: [
          "Copy Netlist",
          "Netlist Settings…",
          "Edit Device Data…",
          "Review Netlist Issues…",
        ],
        enabled: true,
      },
    ]),
  },
  {
    item: "Auto Layout",
    ...both([
      { shown: ["auto-layout-button"], enabled: true },
      { menu: "Layout", items: ["Auto Layout"], enabled: true },
    ]),
  },
  {
    item: "Undo / Redo",
    ...both([{ shown: ["draw-tool-undo", "draw-tool-redo"] }]),
  },
  {
    item: "Library, Netlist, Project Code toggles",
    auto: [
      { shown: ["netlist-panel-toggle"], enabled: true },
      { absent: ["library-toggle", "project-code-toggle"] },
    ],
    draw: [
      {
        shown: [
          "library-toggle",
          "netlist-panel-toggle",
          "project-code-toggle",
        ],
        enabled: true,
      },
    ],
  },
  {
    item: "Drawing tools",
    auto: [{ absent: drawingTools }],
    draw: [{ shown: drawingTools }],
  },
  {
    item: "Properties dock",
    auto: [{ shown: ["properties-panel-toggle"], enabled: true }],
    draw: [
      { shown: [".selection-dock"] },
      { absent: ["properties-panel-toggle"] },
    ],
  },
  {
    item: "Cell navigation",
    auto: [{ shown: ["cells-rail"] }, { absent: ["cell-navigation"] }],
    draw: [{ shown: ["cell-navigation"] }, { absent: ["cells-rail"] }],
  },
  { item: "Agent", ...both([{ shown: ["open-agent"], enabled: true }]) },
  {
    item: "Status bar",
    ...both([
      {
        shown: [
          "status",
          "statusbar-grid-toggle",
          "statusbar-shortcut-hints",
          "statusbar-change-log",
        ],
      },
    ]),
  },
  { item: "Project tabs", ...both([{ shown: ["project-tabs"] }]) },
  {
    item: "Rename a project",
    ...both([
      { menu: "File", items: ["Project Info"], enabled: true },
      { shown: [".app-project-name"], enabled: true },
    ]),
  },
];

async function expectPlace(page: Page, place: Place, context: string) {
  if ("absent" in place) {
    for (const testId of place.absent)
      await expect(page.getByTestId(testId), context).toHaveCount(0);
    return;
  }
  if ("shown" in place) {
    for (const testId of place.shown) {
      const control = testId.startsWith(".")
        ? page.locator(testId)
        : page.getByTestId(testId);
      await expect(control, `${context}: ${testId}`).toBeVisible();
      if (place.enabled)
        await expect(control, `${context}: ${testId}`).toBeEnabled();
    }
    return;
  }
  const group = await openMenu(page, place.menu);
  await expect(
    page.getByTestId(place.menu === "File" ? "project-menu" : "more-menu"),
    context,
  ).toHaveAttribute("open", "");
  if (place.submenu) {
    const toggle = group.getByRole("button", {
      name: place.submenu,
      exact: true,
    });
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
  }
  for (const name of place.items) {
    const item = place.labels
      ? group.locator("label.file-import", { hasText: name })
      : group.getByRole("button", { name, exact: true });
    await expect(item, `${context}: ${name}`).toHaveCount(1);
    await item.scrollIntoViewIfNeeded();
    await expect(item, `${context}: ${name}`).toBeVisible();
    if (place.enabled) await expect(item, `${context}: ${name}`).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".command-menu[open]")).toHaveCount(0);
}

test("every row of the menu table is where it says, in Auto and in Draw", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openEditor(page);
  // Two Cells, so Place Cell and the rail show.
  await autoImport(page, NETLIST_B);
  for (const mode of ["auto", "draw"] as const) {
    await page.getByTestId(`mode-${mode}`).click();
    // A selection of several parts fills the Selection group.
    await page.locator("body").press("ControlOrMeta+a");
    for (const row of MENU_TABLE)
      for (const place of row[mode])
        await expectPlace(page, place, `${row.item} (${mode})`);
  }
});

test("a long ⋯ menu scrolls inside a short window", async ({ page }) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  for (const [width, height] of [
    [1280, 420],
    [390, 420],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const mode of ["mode-auto", "mode-draw"]) {
      await page.getByTestId(mode).click();
      // The Selection group with its six Align items makes the menu long.
      await page.locator("body").press("ControlOrMeta+a");
      const edit = await openMenu(page, "Edit");
      await expect(
        edit.getByRole("button", { name: "Align bottom" }),
      ).toHaveCount(1);
      const popover = page.locator(".more-menu-popover");
      const box = (await popover.boundingBox())!;
      const context = `${width}x${height} (${mode})`;
      expect(box.x, context).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, context).toBeLessThanOrEqual(width);
      expect(box.y + box.height, context).toBeLessThanOrEqual(height);
      expect(
        await popover.evaluate((el) => el.scrollHeight > el.clientHeight),
        context,
      ).toBe(true);
      // The last group is reached by scrolling the menu, not the page.
      const last = page.getByTestId("auto-layout-command");
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await page.keyboard.press("Escape");
    }
  }
});

test("the ⋯ menu works from the keyboard and closes like the other menus", async ({
  page,
}) => {
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const more = page.getByTestId("more-menu");
  const summary = more.locator(":scope > summary");
  await expect(summary).toHaveAccessibleName("More");
  await expect(summary).toHaveAttribute("title", /Edit, Hierarchy/u);
  // Keyboard: Enter opens it, Tab reaches its items, Escape closes it and
  // gives focus back to its button.
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(
    more.getByRole("button", { name: "Insert component… (I)" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  // An outside click closes it.
  await summary.click();
  await expect(more).toHaveAttribute("open", "");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 5, y: 5 } });
  await expect(more).not.toHaveAttribute("open", "");
  // Only one of File and ⋯ is open at a time.
  const file = page.getByTestId("project-menu");
  await summary.click();
  await file.locator(":scope > summary").click();
  await expect(file).toHaveAttribute("open", "");
  await expect(more).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(more).toHaveAttribute("open", "");
  await expect(file).not.toHaveAttribute("open", "");
  // A command closes it, as the old menus did.
  await more.getByRole("button", { name: "Cell Manager…" }).click();
  await expect(more).not.toHaveAttribute("open", "");
  await expect(
    page.getByRole("dialog", { name: /Cell Manager/u }),
  ).toBeVisible();
});

test("the top bar names the project on one row, in both modes", async ({
  page,
}) => {
  await openEditor(page);
  const name = page.locator(".app-project-name");
  await expect(name).toHaveText("New Circuit");
  const long = `${"Folded cascode operational transconductance amplifier ".repeat(2)}test`;
  await renameProject(page, long);
  await expect(name.locator(".app-project-name-text")).toHaveText(long);
  await expect(name).toHaveAttribute("title", new RegExp(`^${long}`, "u"));
  // Unsaved work shows File's dot beside the name too.
  await expect(name.locator(".project-unsaved-indicator")).toBeVisible();
  for (const mode of ["mode-auto", "mode-draw"]) {
    await page.getByTestId(mode).click();
    for (const width of [320, 390, 480, 720, 721, 760, 800, 900, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const context = `${width}px (${mode})`;
      const main = (await page.locator(".app-chrome-main").boundingBox())!;
      expect(main.height, context).toBeLessThanOrEqual(48);
      for (const testId of [
        "draw-tool-undo",
        "mode-switch",
        "auto-layout-button",
        "project-menu",
        "more-menu",
      ]) {
        const box = (await page.getByTestId(testId).boundingBox())!;
        expect(box.x, `${testId} at ${context}`).toBeGreaterThanOrEqual(0);
        expect(
          box.x + box.width,
          `${testId} at ${context}`,
        ).toBeLessThanOrEqual(width);
        expect(box.y, `${testId} at ${context}`).toBeGreaterThanOrEqual(main.y);
        expect(box.y + box.height).toBeLessThanOrEqual(main.y + main.height);
      }
      // The wireframe's order: Auto Layout, File, Agent, ⋯ (Agent goes only
      // on the narrowest windows).
      const right = await Promise.all(
        ["auto-layout-button", "project-menu", "open-agent", "more-menu"].map(
          async (testId) => (await page.getByTestId(testId).boundingBox())?.x,
        ),
      );
      const shown = right.filter((x): x is number => x !== undefined);
      expect(shown, context).toEqual([...shown].sort((a, b) => a - b));
      // Below 720 px the name goes; File → Project Info still has it.
      await expect(name, context).toBeVisible({ visible: width > 720 });
      if (width > 720) {
        const box = (await name.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(main.y + main.height);
        // A long name is cut with an ellipsis, never wrapped.
        expect(
          await name
            .locator(".app-project-name-text")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
          context,
        ).toBe(true);
      }
    }
  }
  // The name opens Project Info, where it is changed.
  await page.setViewportSize({ width: 1280, height: 800 });
  await name.click();
  await expect(
    page.getByRole("dialog", { name: "Project Info" }),
  ).toBeVisible();
});

const clipped = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => el.scrollWidth > el.clientWidth);

test("a long project name gives way before the top bar's controls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page, "/editor?example=two-stage-op-amp");
  await expectStatus(page, "Opened example: Two-Stage Op Amp");
  const name = page.locator(".app-project-name");
  const nameWidth = async () => (await name.boundingBox())!.width;
  // A short name is shown whole.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(name.locator(".app-project-name-text")).toHaveText(
    "New Circuit",
  );
  expect(
    await name
      .locator(".app-project-name-text")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
  const long = `${"Folded cascode operational transconductance amplifier ".repeat(2)}test`;
  await renameProject(page, long);
  await page.setViewportSize({ width: 1440, height: 800 });
  const cap = await nameWidth();
  for (const width of [761, 800, 860, 900, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    const context = `${width}px`;
    expect(await clipped(page, "auto-layout-button"), context).toBe(false);
    expect(await clipped(page, "import-netlist-button"), context).toBe(false);
    const actions = (await page.locator(".app-chrome-actions").boundingBox())!;
    const box = (await name.boundingBox())!;
    expect(box.x + box.width, context).toBeLessThanOrEqual(actions.x);
    if (width <= 900) expect(box.width, context).toBeLessThan(cap);
  }
  // With a run planning, its label gives way too; Cancel and ⋯ stay on
  // screen and nothing overlaps.
  const button = page.getByTestId("auto-layout-button");
  await button.click();
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  for (const width of [800, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await button
      .locator(".app-action-label")
      .evaluate(
        (label) =>
          (label.textContent =
            "Auto Layout… 123 s · Cell 2 of 3 · evaluation 120/240"),
      );
    const context = `${width}px, running`;
    const boxes = await Promise.all(
      [
        ".app-project-name",
        '[data-testid="mode-switch"]',
        '[data-testid="auto-layout-button"]',
        '[data-testid="auto-layout-cancel"]',
        '[data-testid="project-menu"]',
        '[data-testid="open-agent"]',
        '[data-testid="more-menu"]',
      ].map(async (selector) => ({
        selector,
        box: (await page.locator(selector).boundingBox())!,
      })),
    );
    for (const { selector, box } of boxes) {
      expect(box.x + box.width, `${selector} ${context}`).toBeLessThanOrEqual(
        width,
      );
      expect(box.width, `${selector} ${context}`).toBeGreaterThan(20);
    }
    for (let index = 1; index < boxes.length; index++)
      expect(
        boxes[index]!.box.x,
        `${boxes[index]!.selector} after ${boxes[index - 1]!.selector} ${context}`,
      ).toBeGreaterThanOrEqual(
        boxes[index - 1]!.box.x + boxes[index - 1]!.box.width - 0.5,
      );
  }
  await cancel.click();
  await expect(cancel).toHaveCount(0);
});

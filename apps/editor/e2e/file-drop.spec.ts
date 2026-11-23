import { writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type JSHandle,
  type Locator,
  type Page,
} from "@playwright/test";
import { serializeProject } from "@icm/project-protocol";

import {
  NETLIST_A,
  NETLIST_B,
  resistorChainNetlist,
} from "../src/features/auto-layout/auto-layout-fixture.test-support";
import {
  AUTO_MODE_STORAGE,
  exampleProject,
  exportedProject,
  openEditor,
  openProjectFile,
  showNetlistPanel,
} from "./editor-fixtures";

/** The last status of an import's Auto Layout run (never "planning"). */
const FINAL =
  /· (Auto Layout (applied|left|cancelled|failed|could)|Already laid out|The (drawing|Project) changed)/u;

const NO_ENTRY =
  "Select one unambiguous .cir, .sp, .spi, or .scs entry and its local include files; found 0";

const PROJECT_NAME = "two-stage.icproj.json";
const PROJECT_TEXT = serializeProject(
  exampleProject("two-stage-op-amp.icproj.json"),
);

interface DroppedFile {
  name: string;
  text: string;
}

/** A real DataTransfer in the page, holding the files a drop carries. */
function droppedFiles(page: Page, files: DroppedFile[]): Promise<JSHandle> {
  return page.evaluateHandle((files: DroppedFile[]) => {
    const transfer = new DataTransfer();
    for (const { name, text } of files)
      transfer.items.add(new File([text], name, { type: "text/plain" }));
    return transfer;
  }, files);
}

async function dragOver(target: Locator, data: JSHandle): Promise<void> {
  await target.dispatchEvent("dragenter", { dataTransfer: data });
  await target.dispatchEvent("dragover", { dataTransfer: data });
}

/** The drag a person makes: the file over the target, then released. */
async function dropFiles(
  page: Page,
  target: Locator,
  files: DroppedFile[],
): Promise<void> {
  const data = await droppedFiles(page, files);
  await dragOver(target, data);
  await target.dispatchEvent("drop", { dataTransfer: data });
}

const netlist = (text: string, name = "circuit.sp"): DroppedFile[] => [
  { name, text },
];

const revision = (page: Page) =>
  page.getByTestId("editor-test-telemetry").getByTestId("revision");

/** What a Project file's open must reproduce exactly: no layout may follow. */
const drawing = (project: any) =>
  project.documents.map((document: any) => ({
    id: document.id,
    revision: document.revision,
    routes: document.routes.length,
    instances: document.instances.map((instance: any) => ({
      symbolId: instance.symbolId,
      position: instance.placement.position,
    })),
  }));

test.describe("a file dropped onto the window in Auto", () => {
  test.use({ storageState: AUTO_MODE_STORAGE });

  test("a netlist dropped on the empty card is imported and laid out", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const card = page.getByTestId("auto-empty-state");
    await expect(card).toBeVisible();
    const overlay = page.getByTestId("file-drop-overlay");
    const url = page.url();

    const data = await droppedFiles(page, netlist(NETLIST_A));
    await dragOver(card, data);
    await expect(overlay).toBeVisible();
    await card.dispatchEvent("drop", { dataTransfer: data });
    await expect(overlay).toHaveCount(0);

    const status = page.getByTestId("status");
    await expect(status).toContainText(FINAL, { timeout: 60_000 });
    expect(await status.textContent()).toContain("Imported 1 Document");
    await expect(card).toHaveCount(0);
    const after = await exportedProject(page);
    const top = after.documents.find(
      (document: any) => document.id === after.topDocumentId,
    );
    expect(top.routes.length).toBeGreaterThan(0);
    // The browser displayed nothing: the editor is still the page.
    expect(page.url()).toBe(url);
  });

  test("the frame follows the file across elements", async ({ page }) => {
    await openEditor(page);
    const card = page.getByTestId("auto-empty-state");
    await expect(card).toBeVisible();
    const header = page.locator("header.app-chrome");
    const overlay = page.getByTestId("file-drop-overlay");

    const data = await droppedFiles(page, netlist(NETLIST_A));
    const headerElement = await header.elementHandle();
    const cardElement = await card.elementHandle();
    await card.dispatchEvent("dragenter", { dataTransfer: data });
    await header.dispatchEvent("dragenter", { dataTransfer: data });
    await expect(overlay).toBeVisible();
    // Still over the header, whatever the card saw: a move between elements
    // names its destination, unlike a leave of the window (relatedTarget
    // null, which clears the frame).
    await card.dispatchEvent("dragleave", {
      dataTransfer: data,
      relatedTarget: headerElement,
    });
    await expect(overlay).toBeVisible();
    await header.dispatchEvent("dragleave", {
      dataTransfer: data,
      relatedTarget: cardElement,
    });
    await expect(overlay).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(page.getByTestId("status")).not.toContainText("Imported");
  });

  test("a netlist dropped on the top bar imports", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const header = page.locator("header.app-chrome");
    await expect(header).toBeVisible();
    await dropFiles(page, header, netlist(NETLIST_A));
    await expect(page.getByTestId("status")).toContainText(FINAL, {
      timeout: 60_000,
    });
    await expect(page.getByTestId("status")).toContainText(
      "Imported 1 Document",
    );
    await expect(page.getByTestId("auto-empty-state")).toHaveCount(0);
  });

  test("an entry dropped with its local include reaches the importer", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const top = `* a top Cell with one subcircuit instance, from a local include
.include child.inc
X1 in out vdd child
R1 out 0 1k
`;
    const child = `* the child Cell
.subckt child in out vdd
M1 out in 0 0 nmos w=1u l=1u
R2 vdd out 10k
.ends child
.model nmos nmos
`;
    await dropFiles(page, page.getByTestId("auto-empty-state"), [
      { name: "top.sp", text: top },
      { name: "child.inc", text: child },
    ]);
    const status = page.getByTestId("status");
    await expect(status).toContainText(FINAL, { timeout: 60_000 });
    expect(await status.textContent()).toContain("Imported 2 Documents");
  });

  test("a Project file dropped on the window opens, with no layout after", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const card = page.getByTestId("auto-empty-state");
    await expect(card).toBeVisible();
    await dropFiles(page, card, [{ name: PROJECT_NAME, text: PROJECT_TEXT }]);
    await expect(page.getByTestId("status")).toContainText(
      `Opened ${PROJECT_NAME}`,
    );
    await expect(card).toHaveCount(0);
    await expect(
      page.getByTestId("editor-test-telemetry").getByTestId("instance-count"),
    ).not.toHaveText("0");
    const dropped = await exportedProject(page);

    // The same bytes through File → Import → Project File… draw identically:
    // the drop queued no Auto Layout behind the open.
    const second = await page.context().newPage();
    try {
      await openEditor(second);
      await openProjectFile(second, PROJECT_TEXT, PROJECT_NAME);
      await expect(second.getByTestId("status")).toContainText(
        `Opened ${PROJECT_NAME}`,
      );
      expect(drawing(await exportedProject(second))).toEqual(drawing(dropped));
    } finally {
      await second.close();
    }
  });

  test("a dropped Project file asks before replacing unsaved work", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openProjectFile(page, PROJECT_TEXT, PROJECT_NAME);
    await expect(page.getByTestId("status")).toContainText(
      `Opened ${PROJECT_NAME}`,
    );
    const opened = await revision(page).textContent();
    await page.locator("body").press("ControlOrMeta+a");
    await page.locator("body").press("r");
    await expect(revision(page)).not.toHaveText(opened!);
    const edited = await revision(page).textContent();
    const tabs = page
      .getByTestId("project-tabs")
      .getByRole("tab", { includeHidden: true });
    expect(await tabs.count()).toBe(1);

    const guard = page.getByRole("dialog", { name: "Unsaved changes" });
    await dropFiles(page, page.getByTestId("schematic-canvas"), [
      { name: PROJECT_NAME, text: PROJECT_TEXT },
    ]);
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Stay" }).click();
    await expect(guard).toBeHidden();
    await expect(revision(page)).toHaveText(edited!);

    await dropFiles(page, page.getByTestId("schematic-canvas"), [
      { name: PROJECT_NAME, text: PROJECT_TEXT },
    ]);
    await expect(guard).toBeVisible();
    await guard
      .getByRole("button", { name: "Continue without saving" })
      .click();
    await expect(page.getByTestId("status")).toContainText(
      `Opened ${PROJECT_NAME}`,
    );
    // The drop replaces the open tab's Project; it never opens a new tab.
    expect(await tabs.count()).toBe(1);
  });

  test("a malformed Project file is refused before the guard", async ({
    page,
  }) => {
    await openEditor(page);
    await openProjectFile(page, PROJECT_TEXT, PROJECT_NAME);
    await expect(page.getByTestId("status")).toContainText(
      `Opened ${PROJECT_NAME}`,
    );
    const before = await revision(page).textContent();
    await dropFiles(page, page.getByTestId("schematic-canvas"), [
      { name: "broken.json", text: "{ nope" },
    ]);
    await expect(page.getByTestId("status")).toContainText(
      "Project not opened — INVALID_JSON:",
    );
    await expect(revision(page)).toHaveText(before!);
    await expect(
      page.getByRole("dialog", { name: "Unsaved changes" }),
    ).toHaveCount(0);
  });

  test("two Project files together are refused", async ({ page }) => {
    await openEditor(page);
    const card = page.getByTestId("auto-empty-state");
    await expect(card).toBeVisible();
    await dropFiles(page, card, [
      { name: "one.icproj.json", text: "{}" },
      { name: "two.icproj.json", text: "{}" },
    ]);
    await expect(page.getByTestId("status")).toContainText(
      "Drop one Project file at a time",
    );
    await expect(card).toBeVisible();
  });

  test("a netlist dropped behind the unsaved-work guard waits its answer", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    const canvas = page.getByTestId("schematic-canvas");
    const status = page.getByTestId("status");
    await dropFiles(page, canvas, netlist(NETLIST_A));
    await expect(status).toContainText(FINAL, { timeout: 60_000 });

    // No export before the guard: exporting stamps the snapshot safe.
    const imported = await revision(page).textContent();
    await page.locator("body").press("ControlOrMeta+a");
    await page.locator("body").press("r");
    await expect(revision(page)).not.toHaveText(imported!);
    const rotated = await revision(page).textContent();

    const guard = page.getByRole("dialog", { name: "Unsaved changes" });
    await dropFiles(page, canvas, netlist(NETLIST_B));
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Stay" }).click();
    await expect(guard).toBeHidden();
    await expect(revision(page)).toHaveText(rotated!);

    await dropFiles(page, canvas, netlist(NETLIST_B));
    await expect(guard).toBeVisible();
    // Behind the modal a later drop changes nothing: the pending import stays.
    await dropFiles(page, canvas, netlist(resistorChainNetlist(3)));
    await expect(guard).toBeVisible();
    await guard
      .getByRole("button", { name: "Continue without saving" })
      .click();
    await expect(status).toContainText(FINAL, { timeout: 120_000 });

    const after = await exportedProject(page);
    const names = after.documents.map((document: any) => document.name);
    expect(names).toContain("stage");
    expect(names).not.toContain("chain");
  });

  test("Chromium's own drag pipeline delivers the file without navigating", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const path = testInfo.outputPath("circuit.sp");
    await writeFile(path, NETLIST_A, "utf8");
    const client = await page.context().newCDPSession(page);
    const box = await page.locator("header.app-chrome").boundingBox();
    if (!box) throw new Error("the top bar has no box");
    const at = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
    // The renderer's own response to a drag whose press began outside it.
    const data = { items: [], files: [path], dragOperationsMask: 1 };
    const url = page.url();

    await client.send("Input.dispatchDragEvent", {
      type: "dragEnter",
      ...at,
      data,
    });
    await client.send("Input.dispatchDragEvent", {
      type: "dragOver",
      ...at,
      data,
    });
    await expect(page.getByTestId("file-drop-overlay")).toBeVisible();
    await client.send("Input.dispatchDragEvent", { type: "drop", ...at, data });
    await expect(page.getByTestId("status")).toContainText(FINAL, {
      timeout: 60_000,
    });
    await expect(page.getByTestId("auto-empty-state")).toHaveCount(0);
    // The browser shows the editor, not the file it was handed.
    expect(page.url()).toBe(url);
    // Its dragCancel command delivers no event at all, so cancelling cannot
    // be covered here; a real Escape over the window is a manual check.
  });
});

test.describe("a file dropped onto the window in Draw", () => {
  test("a netlist dropped on the canvas imports and keeps Draw's chrome", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const toolbar = page.getByTestId("draw-toolbar");
    await expect(toolbar).toBeVisible();
    await dropFiles(
      page,
      page.getByTestId("schematic-canvas"),
      netlist(NETLIST_A),
    );
    const status = page.getByTestId("status");
    await expect(status).toContainText(FINAL, { timeout: 60_000 });
    expect(await status.textContent()).toContain("Imported 1 Document");
    await expect(status).toContainText("Auto Layout applied");
    await expect(toolbar).toBeVisible();
  });

  test("a netlist dropped on the code editor is imported, never inserted", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await importNetlistHere(page);
    const editor = page.getByLabel("Netlist code", { exact: true });
    await expect(editor).toBeVisible();
    // CodeMirror inserts a dropped file's text from a FileReader callback, so
    // count what the editor itself receives as well as the text.
    await editor.evaluate((element) => {
      (window as any).__fileDropDeliveries = 0;
      element.addEventListener("drop", () => {
        (window as any).__fileDropDeliveries += 1;
      });
    });
    const before = await editor.textContent();
    await dropFiles(page, editor, [{ name: "notes.txt", text: "* notes\n" }]);
    await expect(page.getByTestId("status")).toContainText(NO_ENTRY);
    expect(
      await page.evaluate(() => (window as any).__fileDropDeliveries as number),
    ).toBe(0);
    await page.waitForTimeout(300);
    expect(await editor.textContent()).toBe(before);
  });
});

/** A one-Cell schematic through the Netlist dock's file input, in Draw. */
async function importNetlistHere(page: Page): Promise<void> {
  await page.getByTestId("spice-files").setInputFiles({
    name: "circuit.sp",
    mimeType: "text/plain",
    buffer: Buffer.from(NETLIST_A),
  });
  await expect(page.getByTestId("status")).toContainText(FINAL, {
    timeout: 60_000,
  });
  await showNetlistPanel(page);
}

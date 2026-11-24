import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { serializeProject } from "@icm/project-protocol";
import type { CircuitProject } from "@icm/model";
import { expect, test, type Page } from "@playwright/test";

import {
  NETLIST_A,
  NETLIST_B,
  resistorChainNetlist,
} from "../src/features/auto-layout/auto-layout-fixture.test-support";
import {
  exportedProject,
  openEditor,
  showNetlistPanel,
  downloadBytes,
} from "./editor-fixtures";

/** The last status of an import's Auto Layout run (never "planning"). */
const FINAL =
  /· (Auto Layout (applied|left|cancelled|failed|could)|Already laid out|The (drawing|Project) changed)/u;

async function importNetlist(page: Page, text: string, name = "circuit.sp") {
  await page.getByTestId("spice-files").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  const status = page.getByTestId("status");
  await expect(status).toContainText(FINAL, { timeout: 60_000 });
  return (await status.textContent()) ?? "";
}

type Exported = {
  topDocumentId: string;
  documents: {
    id: string;
    name: string;
    revision: number;
    routes: unknown[];
    instances: { symbolId: string }[];
  }[];
};

const withoutRevision = (project: Exported) =>
  project.documents.map(({ revision: _, ...rest }) => rest);

const grounds = (document: Exported["documents"][number]) =>
  document.instances.filter((i) => i.symbolId === "ground").length;

test("a one-Cell netlist is laid out after import, in one Undo step", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const status = await importNetlist(page, NETLIST_A);
  expect(status).toMatch(/Imported 1 Document.*Auto Layout applied/u);

  const after: Exported = await exportedProject(page);
  const top = after.documents.find((d) => d.id === after.topDocumentId)!;
  expect(top.routes.length).toBeGreaterThan(0);
  expect(grounds(top)).toBeGreaterThan(0);

  const undo = page.getByTestId("draw-tool-undo");
  await undo.click();
  const shelf: Exported = await exportedProject(page);
  const undone = shelf.documents.find((d) => d.id === shelf.topDocumentId)!;
  expect(undone.routes).toEqual([]);
  expect(grounds(undone)).toBe(0);
  // The import itself is a replacement with no Undo.
  await expect(undo).toBeDisabled();

  await page.getByTestId("draw-tool-redo").click();
  expect(withoutRevision(await exportedProject(page))).toEqual(
    withoutRevision(after),
  );
});

test("a multi-subcircuit netlist is announced and every Cell laid out at once", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const status = await importNetlist(page, NETLIST_B);
  await expect(page.getByTestId("import-multi-cell-notice")).toBeVisible();
  await expect(page.getByTestId("import-multi-cell-notice")).toContainText(
    "This netlist has 2 subcircuits",
  );
  expect(status).toContain("Imported 2 Documents");
  expect(status).toContain("Auto Layout applied to 2 of 2 Cells — Details");

  const after: Exported = await exportedProject(page);
  expect(after.documents).toHaveLength(2);
  for (const document of after.documents)
    expect(document.routes.length).toBeGreaterThan(0);

  const undo = page.getByTestId("draw-tool-undo");
  await undo.click();
  for (const document of (await exportedProject(page))
    .documents as Exported["documents"])
    expect(document.routes).toEqual([]);
  await expect(undo).toBeDisabled();

  await page.getByTestId("draw-tool-redo").click();
  expect(withoutRevision(await exportedProject(page))).toEqual(
    withoutRevision(after),
  );
});

test("a Cell over the size limit keeps its shelf; the other is laid out", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const status = await importNetlist(page, resistorChainNetlist(121));
  expect(status).toContain(
    "Auto Layout applied to 1 of 2 Cells; chain: more than 120 parts — Details",
  );

  const project: Exported = await exportedProject(page);
  const chain = project.documents.find((d) => d.name === "chain")!;
  const top = project.documents.find((d) => d.id === project.topDocumentId)!;
  expect(chain.routes).toEqual([]);
  expect(top.routes.length).toBeGreaterThan(0);

  const chip = page.getByTestId("auto-layout-status");
  await expect(chip).toContainText("Auto Layout: 1 of 2 Cells");
  await chip.getByTestId("auto-layout-details").click();
  const report = page.getByTestId("auto-layout-report");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("auto-layout-report-notice")).toBeVisible();
  const section = report.getByRole("region", { name: "chain", exact: true });
  await expect(section).toContainText(
    "chain — left as imported: more than 120 parts",
  );
  await expect(section).toContainText("AUTO_LAYOUT_TOO_LARGE");
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
});

test("Draw updates the CLQC connection after a netlist edit and preserves placement", async ({
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  await openEditor(page);
  const text = readFileSync("netlists/paper3-clqc/clqc3.cdl", "utf8");
  await page.getByTestId("spice-files").setInputFiles({
    name: "clqc3.cdl",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(page.getByTestId("status")).toContainText(FINAL, {
    timeout: 360_000,
  });
  await expect(page.getByTestId("status")).toContainText("Auto Layout applied");
  const before: CircuitProject = await exportedProject(page);
  const svg = testInfo.outputPath("clqc3.svg");
  await writeFile(svg, await downloadBytes(page, "File", "Export SVG"));
  await testInfo.attach("CLQC schematic", { path: svg });
  await writeFile(
    testInfo.outputPath("clqc3.icproj.json"),
    serializeProject(before),
  );
  const cell = before.documents.find((d) => d.id === before.topDocumentId)!;
  await showNetlistPanel(page);
  await page.getByLabel("Netlist format").selectOption("spice");
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText(/Cm2\s+n_gma2\s+v3/i);
  const loggedEdit = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/api/usage/netlist.edit/ok") &&
      response.request().method() === "POST",
  );
  const original = await code.innerText();
  await code.fill(original.replace(/(Cm2\s+n_gma2\s+)v3/i, "$1vo"));
  expect((await loggedEdit).status()).toBe(204);
  // The debounce must apply even while the editor still has focus.
  await expect(page.getByTestId("copy-netlist-panel")).toBeEnabled();
  const after: CircuitProject = await exportedProject(page);
  const changed = after.documents.find((d) => d.id === cell.id)!;
  expect(changed.instances.map((i) => [i.id, i.placement])).toEqual(
    cell.instances.map((i) => [i.id, i.placement]),
  );
  expect(changed.routes).not.toEqual(cell.routes);
  await page.getByTestId("draw-tool-undo").click();
  await expect(code).toContainText(/Cm2\s+n_gma2\s+v3/i);
  await page.getByTestId("draw-tool-redo").click();
  await expect(code).toContainText(/Cm2\s+n_gma2\s+vo/i);
});

test("chooses a drawing symbol for an undeclared MOS model", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByTestId("spice-files").setInputFiles({
    name: "unknown.cdl",
    mimeType: "text/plain",
    buffer: Buffer.from(
      ".subckt amp d g s b\nM1 d g s b mystery w=1u l=1u\n.ends amp\n",
    ),
  });
  const dialog = page.getByRole("dialog", { name: /symbol.*mystery/i });
  await dialog.getByRole("button", { name: "PMOS" }).click();
  await expect(page.getByTestId("status")).toContainText(FINAL, {
    timeout: 60_000,
  });
  const project: CircuitProject = await exportedProject(page);
  const mos = project.documents
    .flatMap((d) => d.instances)
    .find((i) => i.reference === "M1");
  expect(mos).toMatchObject({
    symbolId: "pmos",
    netlist: { binding: { name: "mystery" } },
  });
});

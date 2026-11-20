import { expect, test } from "@playwright/test";

import { refusedFrameProject } from "../src/features/auto-layout/auto-layout-fixture.test-support";
import {
  expectStatus,
  exportedProject,
  openEditor,
  openMenu,
  openProject,
} from "./editor-fixtures";

/** Each Document without its revision: Undo restores content, not revision. */
function documentsWithoutRevision(project: {
  documents: { revision: number }[];
}) {
  return project.documents.map(({ revision: _, ...rest }) => rest);
}

async function runAutoLayout(page: import("@playwright/test").Page) {
  const layout = await openMenu(page, "Layout");
  const command = layout.getByTestId("auto-layout-command");
  await expect(command).toBeEnabled();
  await command.click();
}

// The real Worker path: plan off the main thread, apply as one transaction,
// and one Undo restores the drawing exactly.
test("Auto Layout applies a plan in one Undo step", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, "/editor?example=two-stage-op-amp");
  const before = await exportedProject(page);

  await runAutoLayout(page);
  await expectStatus(page, /^Auto Layout applied \(revision \d+\)/);
  await expect(page.getByTestId("auto-layout-cancel")).toHaveCount(0);

  const after = await exportedProject(page);
  expect(documentsWithoutRevision(after)).not.toEqual(
    documentsWithoutRevision(before),
  );

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await exportedProject(page);
  expect(documentsWithoutRevision(undone)).toEqual(
    documentsWithoutRevision(before),
  );
});

// A refusal leaves the drawing alone and names the planner's diagnostic.
test("Auto Layout shows a refusal and its Details", async ({ page }) => {
  test.setTimeout(120_000);
  await openProject(page, refusedFrameProject(), "framed-block.icproj.json");
  const before = await exportedProject(page);

  await runAutoLayout(page);
  await expectStatus(page, /^Auto Layout left the drawing unchanged: /);
  const chip = page.getByTestId("auto-layout-status");
  await expect(chip).toContainText("Auto Layout: refused");
  await chip.getByTestId("auto-layout-details").click();
  const report = page.getByTestId("auto-layout-report");
  await expect(report).toBeVisible();
  await expect(report).toContainText(
    "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
  );
  await report.getByTestId("auto-layout-report-close").click();
  await expect(report).toHaveCount(0);

  expect(documentsWithoutRevision(await exportedProject(page))).toEqual(
    documentsWithoutRevision(before),
  );
});

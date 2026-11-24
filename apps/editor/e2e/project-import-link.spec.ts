import { expect, test } from "@playwright/test";
import {
  exampleProject,
  exportedProject,
  expectStatus,
  openMenu,
  openEditor,
  openProject,
  renameProject,
} from "./editor-fixtures.js";

test("a link opens an independent editable snapshot beside the recipient's work", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openProject(page, exampleProject("two-stage-op-amp.icproj.json"));
  await renameProject(page, "放大器 v1");
  const original = await exportedProject(page);
  const menu = await openMenu(page, "File");
  await menu.getByRole("button", { name: "Export", exact: true }).click();
  await menu.getByRole("button", { name: "Copy project import link" }).click();
  await expectStatus(page, "Project import link copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await renameProject(page, "Sender v2");

  const recipient = await browser.newContext({ baseURL: baseURL! });
  try {
    const other = await recipient.newPage();
    await openEditor(other);
    await renameProject(other, "Recipient sketch");
    await other.goto(link);
    await expect(
      other.getByRole("tab", { name: /放大器 v1/, selected: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("tab", { name: /Recipient sketch/ }),
    ).toBeVisible();
    await expect(other).toHaveURL(new URL("editor", baseURL!).href);
    const imported = await exportedProject(other);
    expect(imported.id).not.toBe(original.id);
    expect(imported.documents).toEqual(original.documents);
    await renameProject(other, "Recipient v2");
    await other.reload();
    await expect(
      other.getByRole("tab", { name: /Recipient v2/, selected: true }),
    ).toBeVisible();
    await expect(other.getByRole("tab")).toHaveCount(2);
    expect((await exportedProject(page)).name).toBe("Sender v2");
  } finally {
    await recipient.close();
  }
});

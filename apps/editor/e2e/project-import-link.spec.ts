import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import {
  exampleProject,
  exportedProject,
  expectStatus,
  openMenu,
  openProjectInfo,
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

test("a link can be retried after missing recovery, a broken fragment and a blocked tab switch", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("icm.restore-after-refresh.v1", "true"),
  );
  await openEditor(page, "/editor?import=1#invalid");
  await expectStatus(page, "Project link could not be imported");
  const dialog = await openProjectInfo(page);
  const project = exampleProject("two-stage-op-amp.icproj.json");
  project.name = "Retried import";
  const fragment = gzipSync(JSON.stringify(project)).toString("base64url");
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, fragment);
  await expectStatus(page, /Project Info/i);
  expect(new URL(page.url()).hash.slice(1)).toBe(fragment);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: /Retried import/, selected: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/editor$/);
});

function importUrl(name: string) {
  const project = exampleProject("two-stage-op-amp.icproj.json");
  project.name = name;
  return (
    "/editor?import=1#" +
    gzipSync(JSON.stringify(project)).toString("base64url")
  );
}

for (const failure of ["open", "write"] as const) {
  test(`an import keeps its link if workspace storage fails to ${failure}`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      const dbName = "analog-canvas-workspaces";
      if (failure === "open") {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (name, version) {
          if (name === dbName)
            throw new DOMException("Workspace unavailable", "SecurityError");
          return open.call(this, name, version);
        };
      } else {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.transaction.db.name === dbName) {
            this.transaction.abort();
          }
          return put.call(this, value, key);
        };
      }
    }, failure);
    const url = importUrl("In-memory drawing");
    await openEditor(page, url);
    await expect(
      page.getByRole("tab", { name: /In-memory drawing/, selected: true }),
    ).toBeVisible();
    await expectStatus(page, /export.*project.*link|link.*export/i);
    expect(new URL(page.url()).hash).toBe(new URL(url, page.url()).hash);
    expect((await exportedProject(page)).name).toBe("In-memory drawing");
  });
}

test("changing the fragment during file staging never opens the obsolete project", async ({
  page,
}) => {
  await openEditor(page, "/editor?import=1#invalid");
  await expectStatus(page, "Project link could not be imported");
  await renameProject(page, "Recipient sketch");
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === "Shared project.icproj.json") {
        File.prototype.text = text;
        window.location.hash = "invalid-new-request";
      }
      return text.call(this);
    };
  });
  await page.goto(importUrl("Obsolete import"));
  await expectStatus(page, "Project link could not be imported");
  await expect(page).toHaveURL(/#invalid-new-request$/);
  expect((await exportedProject(page)).name).toBe("Recipient sketch");
  await expect(page.getByRole("tab", { name: /Obsolete import/ })).toHaveCount(
    0,
  );
});

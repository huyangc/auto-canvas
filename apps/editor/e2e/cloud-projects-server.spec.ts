import { expect, test } from "@playwright/test";
import { renameProject } from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";

test("local identity saves, reopens from the shelf and lists the earlier revision", async ({
  page,
  browser,
}) => {
  const name = `Server circuit ${Date.now()}`;
  let projectId: string | undefined;
  try {
    await page.goto("/editor?new=1");
    await placeComponent(page, "resistor", { x: 320, y: 200 });
    await renameProject(page, name);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/projects") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("ControlOrMeta+s");
    const created = await saved;
    expect(created.status()).toBe(201);
    projectId = (await created.json()).project.id;
    await expect(page.getByTestId("status")).toHaveText(
      `Saved ${name} to Cloud`,
    );
    await page.reload();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();

    // A fresh browser has no recovery copy: opening must read PostgreSQL.
    const fresh = await browser.newPage();
    try {
      await fresh.goto(new URL("/editor?new=1", page.url()).href);
      await fresh
        .getByLabel("Open Shelf project in tab", { exact: true })
        .click();
      const opened = fresh.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/projects/${projectId}` &&
          response.request().method() === "GET",
      );
      await fresh
        .locator(".project-tabs-shelf")
        .getByRole("button", { name, exact: true })
        .click();
      expect((await opened).status()).toBe(200);
      await expect(fresh.getByTestId("hit-R1")).toBeVisible();
      await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
      await renameProject(fresh, name + " updated");
      const updated = fresh.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/projects/${projectId}`) &&
          response.request().method() === "PUT",
      );
      await fresh.keyboard.press("ControlOrMeta+s");
      expect((await updated).status()).toBe(200);
      await expect(fresh.getByTestId("status")).toHaveText(
        `Saved ${name} updated to Cloud`,
      );
      await fresh
        .getByLabel("Open Shelf project in tab", { exact: true })
        .click();
      await fresh
        .getByRole("button", { name: "Browse Cloud Projects…" })
        .click();
      await fresh.getByTestId(`shelf-actions-${projectId}`).click();
      await fresh
        .getByRole("menuitem", { name: "Version history", exact: true })
        .click();
      await expect(fresh.getByTestId("version-1")).toContainText(
        `v1 · ${name}`,
      );
      await expect(
        fresh.getByTestId("version-1").getByRole("img"),
      ).toBeVisible();
    } finally {
      await fresh.close();
    }
  } finally {
    if (projectId) await page.request.delete(`/api/projects/${projectId}`);
  }
});

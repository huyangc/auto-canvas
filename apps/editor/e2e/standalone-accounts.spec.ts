import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  openMenu,
  projectTabAction,
  renameProject,
} from "./editor-fixtures.js";

import { placeComponent } from "./manual-editor-fixtures.js";

test("accounts reopen their saved drawing in another browser and isolate local drafts", async ({
  page,
  browser,
}) => {
  const suffix = randomInt(100_000_000).toString().padStart(8, "0");
  const alice = "A" + suffix;
  const bob = "B" + suffix;
  const name = "Saved " + suffix;
  const draft = "Draft " + suffix;

  async function enter(tab: Page, username: string, register: boolean) {
    if (register)
      await tab.getByRole("button", { name: "Create an account" }).click();
    await tab.getByLabel("Username").fill(username);
    await tab.getByLabel("Password").fill("test-password");
    await tab
      .getByRole("button", {
        name: register ? "Register" : "Sign in",
        exact: true,
      })
      .click();
    await expect(tab.getByTestId("schematic-canvas")).toBeVisible();
  }
  async function signOut(tab: Page) {
    const menu = await openMenu(tab, "File");
    await menu.getByRole("button", { name: /Sign out/ }).click();
    await expect(tab.getByRole("heading", { name: "Sign in" })).toBeVisible();
  }
  await page.goto("/editor");
  await enter(page, alice, true);
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await renameProject(page, name);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("status")).toHaveText(`Saved ${name} to Cloud`);
  await renameProject(page, draft);
  const sibling = await page.context().newPage();
  await sibling.goto(page.url());
  await expect(sibling.getByTestId("schematic-canvas")).toBeVisible();
  await signOut(page);
  await expect(sibling.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await sibling.close();
  await enter(page, bob, true);
  await expect(page.locator(".app-project-name-text")).toHaveText(
    "New Circuit",
  );
  const shelf = await projectTabAction(page, "Open Shelf project in tab");
  await expect(shelf.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await signOut(page);
  await enter(page, alice, false);
  await expect(page.locator(".app-project-name-text")).toHaveText(draft);

  const fresh = await browser.newPage();
  try {
    await fresh.goto(new URL("/editor", page.url()).href);
    await enter(fresh, alice.toLowerCase(), false);
    await (
      await projectTabAction(fresh, "Open Shelf project in tab")
    )
      .getByRole("button", { name, exact: true })
      .click();
    await expect(fresh.locator(".app-project-name-text")).toHaveText(name);
    await expect(fresh.getByTestId("hit-R1")).toBeVisible();
  } finally {
    await fresh.close();
  }
});

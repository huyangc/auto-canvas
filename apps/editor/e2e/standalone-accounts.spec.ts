import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { projectTabAction, renameProject } from "./editor-fixtures.js";

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
    // The top bar's account menu, not File: it shows who is signed in.
    await tab.getByTestId("account-name").click();
    await tab.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(tab.getByRole("heading", { name: "Sign in" })).toBeVisible();
  }
  await page.goto("/editor");
  await enter(page, alice, true);
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await renameProject(page, name);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByTestId("status")).toHaveText(`Saved ${name} to Cloud`);
  async function failStorage(tab: Page) {
    await tab.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<typeof put>
      ) {
        if (this.name === "windows")
          throw new DOMException("Quota", "QuotaExceededError");
        return put.apply(this, args);
      };
      window.addEventListener(
        "test-restore-idb",
        () => {
          IDBObjectStore.prototype.put = put;
        },
        { once: true },
      );
    });
  }
  await failStorage(page);
  await renameProject(page, draft);
  const warning = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await page.getByTestId("account-name").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  expect(await warning).toMatch(/Sign out paused/);
  await expect(page.locator(".app-project-name-text")).toHaveText(draft);
  expect(
    (await (await page.request.get("/api/session")).json()).user.displayName,
  ).toBe(alice.toLowerCase());
  await page.evaluate(() =>
    window.dispatchEvent(new Event("test-restore-idb")),
  );
  await page.keyboard.press("Escape");
  const sibling = await page.context().newPage();
  await sibling.goto(page.url());
  await expect(sibling.getByTestId("schematic-canvas")).toBeVisible();
  await failStorage(sibling);
  const siblingDraft = "Sibling " + suffix;
  await renameProject(sibling, siblingDraft);
  await signOut(page);
  await expect(
    sibling.getByRole("heading", { name: "Workspace locked" }),
  ).toBeVisible();
  await expect(sibling.getByTestId("schematic-canvas")).toBeHidden();
  await enter(page, bob, true);
  await sibling.getByRole("button", { name: "Check sign-in" }).click();
  await expect(
    sibling.getByRole("heading", { name: "Workspace locked" }),
  ).toBeVisible();
  await expect(page.locator(".app-project-name-text")).toHaveText(
    "New Circuit",
  );
  const shelf = await projectTabAction(page, "Open Cloud Project…");
  await expect(shelf.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await signOut(page);
  await enter(page, alice, false);
  await expect(sibling.locator(".app-project-name-text")).toBeVisible();
  await expect(sibling.locator(".app-project-name-text")).toHaveText(
    siblingDraft,
  );
  await sibling.evaluate(() =>
    window.dispatchEvent(new Event("test-restore-idb")),
  );
  await sibling.close();
  await expect(page.locator(".app-project-name-text")).toHaveText(draft);

  const fresh = await browser.newPage();
  try {
    await fresh.goto(new URL("/editor", page.url()).href);
    await enter(fresh, alice.toLowerCase(), false);
    await (
      await projectTabAction(fresh, "Open Cloud Project…")
    )
      .getByRole("button", { name, exact: true })
      .click();
    await expect(fresh.locator(".app-project-name-text")).toHaveText(name);
    await expect(fresh.getByTestId("hit-R1")).toBeVisible();
    await (
      await projectTabAction(fresh, "Open Cloud Project…")
    )
      .getByRole("button", { name: "Browse Cloud Projects…" })
      .click();
    await expect(
      fresh.getByRole("img", { name: "Preview of " + name }),
    ).toHaveAttribute("src", /^blob:/);
  } finally {
    await fresh.close();
  }
});

import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  placeComponentAt,
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
    // The top bar's account menu, not File: it shows who is signed in.
    await tab.getByTestId("account-name").click();
    await tab.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(tab.getByRole("heading", { name: "Sign in" })).toBeVisible();
  }
  await page.goto("/editor");
  await enter(page, alice, true);
  // The account's Cloud Projects are in the user menu, not File; File
  // keeps Save and Check and Save.
  await page.getByTestId("project-menu-toggle").click();
  const file = page
    .getByTestId("project-menu")
    .getByRole("group", { name: "File", exact: true });
  await expect(file.getByTestId("save-cloud-project")).toBeVisible();
  await expect(file.getByTestId("check-and-save")).toBeVisible();
  await expect(
    file.getByRole("button", { name: "Open Cloud Project…" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("project-menu")).not.toHaveAttribute(
    "open",
    "",
  );
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
  await expect(page.locator(".app-project-name-text")).toHaveText("Untitled");
  const dialog = await projectTabAction(page, "Open Cloud Project…");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name, exact: true })).toHaveCount(
    0,
  );
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
    const freshDialog = await projectTabAction(fresh, "Open Cloud Project…");
    await expect(freshDialog).toBeVisible();
    await freshDialog.getByRole("button", { name, exact: true }).click();
    await expect(fresh.locator(".app-project-name-text")).toHaveText(name);
    await expect(fresh.getByTestId("hit-R1")).toBeVisible();
    await projectTabAction(fresh, "Open Cloud Project…");
    await expect(
      fresh.getByRole("img", { name: "Preview of " + name }),
    ).toHaveAttribute("src", /^blob:/);
  } finally {
    await fresh.close();
  }
});

// A running Auto Layout needs the phone-width row for its elapsed time and
// Cancel; the account menu yields for the run instead of pushing that
// control over the row's start (codex review of PR 127).
test("a running Auto Layout clears the account menu from a phone-width row", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const suffix = randomInt(100_000_000).toString().padStart(8, "0");
  await page.goto("/editor?example=two-stage-op-amp");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill("M" + suffix);
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByTestId("account-name")).toBeVisible();
  await page.getByTestId("auto-layout-button").click();
  const cancel = page.getByTestId("auto-layout-cancel");
  await expect(cancel).toBeVisible();
  await expect(page.getByTestId("header-account-menu")).toBeHidden();
  const box = (await cancel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);

  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByTestId("account-name")).toBeVisible();
});

// Just above 760 px every action label is back. In Auto, Import netlist… once
// squeezed the pill below its mark and caret and pushed the row past the
// window (codex review of PR 127); the pill keeps its size in both modes.
test("the account pill keeps its mark and caret on the row from 721 to 1041 px", async ({
  page,
}) => {
  const suffix = randomInt(100_000_000).toString().padStart(8, "0");
  await page.goto("/editor?example=two-stage-op-amp");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill("W" + suffix);
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await renameProject(page, "A long project name for the header " + suffix);
  await expect(page.getByTestId("open-agent")).toBeVisible();

  const widths = [721, 761, 765, 770, 780, 800, 901, 1041];
  for (const mode of ["auto", "draw"] as const) {
    // Name the mode outright: an example or a remembered choice may open
    // either one.
    await page.getByTestId(`mode-${mode}`).click();
    await expect(page.getByTestId("import-netlist-button")).toHaveCount(
      mode === "auto" ? 1 : 0,
    );
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      const at = `${mode} at ${width}px`;
      const row = await page.locator(".app-chrome-main").evaluate((main) => ({
        scroll: main.scrollWidth,
        client: main.clientWidth,
      }));
      expect
        .soft(row.scroll, `row overflow, ${at}`)
        .toBeLessThanOrEqual(row.client);
      const pill = await page
        .getByTestId("account-name")
        .evaluate((summary) => {
          const box = summary.getBoundingClientRect();
          return {
            right: box.right,
            scroll: summary.scrollWidth,
            client: summary.clientWidth,
          };
        });
      // The name ellipsizes inside its own label; the mark and caret do not,
      // so a pill narrower than them overflows itself.
      expect
        .soft(pill.scroll, `pill clipped, ${at}`)
        .toBeLessThanOrEqual(pill.client);
      expect
        .soft(pill.right, `pill off the row, ${at}`)
        .toBeLessThanOrEqual(width);
    }
  }
});

test.describe("Auto-save to Cloud in the account menu", () => {
  const origin = new URL(
    process.env.ICM_E2E_BASE_URL ??
      `http://127.0.0.1:${process.env.ICM_E2E_PORT ?? "4173"}`,
  ).origin;
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            { name: "icm.editor-mode.v1", value: "draw" },
            { name: "icm.editor-mode-coach.v1", value: "seen" },
            { name: "icm.cloud-auto-save.v1", value: "on" },
          ],
        },
      ],
    },
  });

  test("turns auto-save off and on, keeps the choice, and uploads nothing a reload restored", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = randomInt(100_000_000).toString().padStart(8, "0");
    const puts: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        /^\/api\/projects\/[^/]+$/u.test(new URL(request.url()).pathname)
      )
        puts.push(request.postData() ?? "");
    });
    await page.goto("/editor");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Username").fill("S" + suffix);
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();
    await placeComponent(page, "resistor", { x: 320, y: 200 });
    const name = "Auto " + suffix;
    await renameProject(page, name);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("status")).toHaveText(
      `Saved ${name} to Cloud`,
    );
    const chip = page.getByTestId("cloud-save-state");
    await expect(chip).toHaveText("Saved");

    const toggle = page.getByTestId("cloud-auto-save-toggle");
    async function setAutoSave(on: boolean) {
      const menu = page.getByTestId("header-account-menu");
      if ((await menu.getAttribute("open")) === null)
        await page.getByTestId("account-name").click();
      // The menu reads identity, My Cloud Projects, Auto-save, Sign out.
      expect(
        await menu.evaluate((root) =>
          [
            ...root.querySelectorAll(
              ".header-account-popover > div > .export-submenu > button, .header-account-popover > button",
            ),
          ].map((row) => row.getAttribute("data-testid") ?? row.textContent),
        ),
      ).toEqual([
        expect.stringContaining("My Cloud Projects"),
        "cloud-auto-save-toggle",
        "sign-out",
      ]);
      if ((await toggle.getAttribute("aria-pressed")) !== String(on))
        await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", String(on));
      await expect(toggle).toContainText(on ? "On" : "Off");
      // Toggling keeps the menu open; Escape closes it.
      await expect(menu).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
    }

    // Off: an edit stays local.
    await setAutoSave(false);
    await placeComponentAt(page, "resistor", { x: 420, y: 320 });
    await expect(chip).toHaveText("Auto-save off");
    await page.waitForTimeout(6000);
    expect(puts).toHaveLength(0);
    // On again: the edit made while it was off saves with no new edit.
    await setAutoSave(true);
    await expect.poll(() => puts.length, { timeout: 8000 }).toBe(1);
    await expect(chip).toHaveText("Saved");

    // An edit made while off and restored by a reload uploads nothing...
    await setAutoSave(false);
    await placeComponentAt(page, "resistor", { x: 520, y: 320 });
    await page.reload();
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await setAutoSave(true);
    await page.waitForTimeout(6000);
    expect(puts).toHaveLength(1);
    // ...until the next edit.
    await placeComponentAt(page, "resistor", { x: 620, y: 320 });
    await expect.poll(() => puts.length, { timeout: 8000 }).toBe(2);

    await page.reload();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

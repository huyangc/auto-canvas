import { expect, test } from "@playwright/test";
import { clickCommand, awaitEditorReady } from "./editor-fixtures.js";
import { newComponentDefinition } from "../src/features/user-components/component-definition-edit.js";

test("authors, publishes and reloads a PostgreSQL component before placing its capture", async ({
  page,
  browser,
}) => {
  const name = `Server component ${Date.now()}`;
  let id: string | undefined;
  let revision: number | undefined;
  try {
    await page.goto("/editor?new=1");
    await awaitEditorReady(page);
    await clickCommand(page, "Edit", "User Components…");
    const library = page.getByRole("dialog", {
      name: "User Components",
      exact: true,
    });
    await library
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    await page
      .getByLabel("Definition type", { exact: true })
      .selectOption("json");
    const definition = newComponentDefinition();
    definition.symbol.name = name;
    await page
      .getByRole("textbox", { name: "Component definition code", exact: true })
      .fill(JSON.stringify(definition, null, 2));
    const editor = page.getByRole("dialog", {
      name: "Edit Component Definition",
      exact: true,
    });
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.startsWith("/api/components/"),
    );
    await editor
      .getByRole("button", { name: /^(Publish|Update my component)$/ })
      .click();
    const published = await publishing;
    expect(published.status()).toBe(200);
    const { entry } = await published.json();
    id = entry.id;
    revision = entry.revision;
    expect(entry.authorId).toBe("local");
    await page.reload();
    await awaitEditorReady(page);
    // A fresh browser context cannot reuse the authoring draft or library cache.
    const fresh = await browser.newPage();
    try {
      await fresh.goto(new URL("/editor?new=1", page.url()).href);
      await awaitEditorReady(fresh);
      await clickCommand(fresh, "Edit", "User Components…");
      const dialog = fresh.getByRole("dialog", {
        name: "User Components",
        exact: true,
      });
      await dialog.getByRole("tab", { name: "Library", exact: true }).click();
      await dialog
        .getByRole("button", { name: `Place ${name}`, exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await fresh
        .getByTestId("schematic-canvas")
        .click({ position: { x: 350, y: 300 } });
      await expect(fresh.getByTestId("active-instance-count")).toHaveText("1");
      await fresh.keyboard.press("Escape");
    } finally {
      await fresh.close();
    }
  } finally {
    if (id)
      await page.request.patch(`/api/components/${id}`, {
        data: { revision, action: "delete" },
      });
  }
});

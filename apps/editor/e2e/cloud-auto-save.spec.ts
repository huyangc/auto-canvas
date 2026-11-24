// Cloud auto-save of the active tab's bound Project (T176): it saves about
// 3 s after editing stops, through the same save path as Ctrl+S, and waits
// while a gesture, dialog or other operation is in progress. The suite seeds
// auto-save off (playwright.config.ts); these cases turn it on.
import { expect, test, type Page, type Request } from "@playwright/test";

import {
  clickDrawTool,
  clickNetlistWorkflowCommand,
  openProjectInfo,
  placeComponentAt,
  projectTabAction,
  renameProject,
  renameShelfProject,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";

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

test.describe.configure({ timeout: 90_000 });

interface CloudWrite {
  method: string;
  path: string;
  ifMatch: string | undefined;
  body: string;
}

/** Every Cloud Project create (POST) and update (PUT) the page sends. */
function recordCloudWrites(page: Page) {
  const writes: CloudWrite[] = [];
  const note = (request: Request) => {
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const create = method === "POST" && path === "/api/projects";
    const update = method === "PUT" && /^\/api\/projects\/[^/]+$/u.test(path);
    if (!create && !update) return;
    writes.push({
      method,
      path,
      ifMatch: request.headers()["if-match"],
      body: request.postData() ?? "",
    });
  };
  page.on("request", note);
  return {
    puts: () => writes.filter((write) => write.method === "PUT"),
    posts: () => writes.filter((write) => write.method === "POST"),
  };
}

/** How many Instances a written Project's top Cell holds. */
function instanceCount(write: CloudWrite): number {
  const project = JSON.parse(JSON.parse(write.body).projectText);
  return project.documents[0].instances.length;
}

/** A new drawing with one resistor, saved to Cloud with Ctrl+S. */
async function bindNewProject(page: Page, name: string): Promise<string> {
  await page.goto("/editor?new=1");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await renameProject(page, name);
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/projects" &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("ControlOrMeta+s");
  const response = await created;
  expect(response.status()).toBe(201);
  await expect(page.getByTestId("status")).toHaveText(`Saved ${name} to Cloud`);
  await expect(page.getByTestId("cloud-save-state")).toHaveText("Saved");
  return (await response.json()).project.id;
}

/** One live edit: a resistor placed at this x. */
async function edit(page: Page, x: number): Promise<void> {
  await placeComponentAt(page, "resistor", { x, y: 320 });
}

const chip = (page: Page) => page.getByTestId("cloud-save-state");

async function cleanUp(page: Page, ids: (string | undefined)[]) {
  for (const id of ids)
    if (id) await page.request.delete(`/api/projects/${id}`).catch(() => {});
}

test("a drawing edit saves itself once, about 3 s after it, and writes no status line", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto draw ${Date.now()}`);
    expect(writes.posts()).toHaveLength(1);
    await edit(page, 420);
    await expect(chip(page)).toHaveText("Unsaved");
    await page.waitForTimeout(1000);
    expect(writes.puts()).toHaveLength(0);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    expect(writes.puts()[0]!.ifMatch).toBe("revision-1");
    await expect(chip(page)).toHaveText("Saved");
    await expect(page.getByTestId("status")).not.toHaveText(/^Sav(ing|ed) /u);
    await page.waitForTimeout(4000);
    expect(writes.puts()).toHaveLength(1);
    const stored = await page.request.get(`/api/projects/${id}`);
    expect((await stored.json()).project.revision).toBe(2);
  } finally {
    await cleanUp(page, [id]);
  }
});

test("a rename in Auto mode saves itself", async ({ page }) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    const name = `Auto rename ${Date.now()}`;
    id = await bindNewProject(page, name);
    await page.getByTestId("mode-auto").click();
    await renameProject(page, `${name} renamed`);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    expect(JSON.parse(writes.puts()[0]!.body).name).toBe(`${name} renamed`);
    await expect(chip(page)).toHaveText("Saved");
  } finally {
    await cleanUp(page, [id]);
  }
});

test("an unbound drawing never saves itself and shows no chip", async ({
  page,
}) => {
  const writes = recordCloudWrites(page);
  await page.goto("/editor?new=1");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await edit(page, 420);
  await page.waitForTimeout(6000);
  expect(writes.posts()).toHaveLength(0);
  expect(writes.puts()).toHaveLength(0);
  await expect(chip(page)).toHaveCount(0);
});

test("a wire being drawn holds the save until Escape ends it", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto wire ${Date.now()}`);
    await edit(page, 420);
    await clickDrawTool(page, "wire");
    await page.getByTestId("terminal-R1-1").click();
    await page.waitForTimeout(5000);
    expect(writes.puts()).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
  } finally {
    await cleanUp(page, [id]);
  }
});

test("an open Project Info dialog holds the save until it closes", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto dialog ${Date.now()}`);
    await edit(page, 420);
    const dialog = await openProjectInfo(page);
    await page.waitForTimeout(5000);
    expect(writes.puts()).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
  } finally {
    await cleanUp(page, [id]);
  }
});

test("a revision changed elsewhere pauses auto-save, even after a reload", async ({
  page,
  browser,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    const name = `Auto conflict ${Date.now()}`;
    id = await bindNewProject(page, name);
    // Another browser renames it on the Shelf: the Cloud is at revision 2.
    const other = await browser.newPage();
    try {
      await other.goto(new URL("/editor?new=1", page.url()).href);
      await renameShelfProject(other, name, `${name} elsewhere`);
    } finally {
      await other.close();
    }
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/api/projects/${id}`,
    );
    await edit(page, 420);
    expect((await conflict).status()).toBe(409);
    await expect(chip(page)).toHaveText("Auto-save paused");
    await edit(page, 520);
    await page.waitForTimeout(6000);
    expect(writes.puts()).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();
    await expect(chip(page)).toHaveText("Auto-save paused");
    await edit(page, 620);
    await page.waitForTimeout(6000);
    expect(writes.puts()).toHaveLength(1);
  } finally {
    await cleanUp(page, [id]);
  }
});

test("offline holds auto-save until the browser is back online", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto offline ${Date.now()}`);
    await page.context().setOffline(true);
    await edit(page, 420);
    await expect(chip(page)).toHaveText("Cloud offline", { timeout: 10_000 });
    expect(writes.puts()).toHaveLength(1);
    await edit(page, 520);
    await page.waitForTimeout(6000);
    expect(writes.puts()).toHaveLength(1);
    await page.context().setOffline(false);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(2);
    await expect(chip(page)).toHaveText("Saved");
  } finally {
    await page.context().setOffline(false);
    await cleanUp(page, [id]);
  }
});

test("a reload uploads nothing until the next edit", async ({ page }) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto reload ${Date.now()}`);
    await edit(page, 420);
    await page.reload();
    await expect(page.getByTestId("schematic-canvas")).toBeVisible();
    await expect(page.getByTestId("active-instance-count")).toHaveText("2");
    await expect(chip(page)).toHaveText("Unsaved");
    await page.waitForTimeout(6000);
    expect(writes.puts()).toHaveLength(0);
    await edit(page, 520);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    expect(instanceCount(writes.puts()[0]!)).toBe(3);
  } finally {
    await cleanUp(page, [id]);
  }
});

test("only the active tab saves itself; a tab left unsaved saves when it is back", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto tabs ${Date.now()}`);
    await projectTabAction(page, "New project tab");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await page.getByRole("tab").first().click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await edit(page, 420);
    await page.getByRole("tab").nth(1).click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("0");
    await page.waitForTimeout(6000);
    expect(writes.puts()).toHaveLength(0);
    await expect(
      page.getByRole("tab").first().getByLabel("Unsaved"),
    ).toBeVisible();
    await page.getByRole("tab").first().click();
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    await expect(chip(page)).toHaveText("Saved");
    await expect(
      page.getByRole("tab").first().getByLabel("Unsaved"),
    ).toHaveCount(0);
  } finally {
    await cleanUp(page, [id]);
  }
});

/** Holds the first PUT to this Project until `release` is called. */
async function holdFirstPut(page: Page, id: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  await page.route(`**/api/projects/${id}`, async (route) => {
    if (route.request().method() === "PUT" && puts++ === 0) await gate;
    await route.continue();
  });
  return release;
}

test("Ctrl+S during an automatic save waits, then saves the newer edit", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto manual ${Date.now()}`);
    const release = await holdFirstPut(page, id);
    await edit(page, 420);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    await expect(chip(page)).toHaveText("Saving…");
    await edit(page, 520);
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForTimeout(500);
    expect(writes.puts()).toHaveLength(1);
    release();
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(2);
    expect(writes.puts()[1]!.ifMatch).toBe("revision-2");
    expect(instanceCount(writes.puts()[1]!)).toBe(3);
    await expect(chip(page)).toHaveText("Saved");
  } finally {
    await cleanUp(page, [id]);
  }
});

test("Check and Save stays available during an automatic save and saves the newer edit", async ({
  page,
}) => {
  let id: string | undefined;
  try {
    const writes = recordCloudWrites(page);
    id = await bindNewProject(page, `Auto check ${Date.now()}`);
    const release = await holdFirstPut(page, id);
    await edit(page, 420);
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(1);
    await edit(page, 520);
    await page.getByTestId("project-menu-toggle").click();
    await expect(page.getByTestId("check-and-save")).toBeEnabled();
    await page.keyboard.press("Escape");
    await clickNetlistWorkflowCommand(page, "check-and-save");
    await expect(page.getByTestId("statusbar-issues")).toHaveAttribute(
      "data-check-status",
      "current",
    );
    release();
    await expect.poll(() => writes.puts().length, { timeout: 8000 }).toBe(2);
    expect(instanceCount(writes.puts()[1]!)).toBe(3);
    await expect(chip(page)).toHaveText("Saved");
  } finally {
    await cleanUp(page, [id]);
  }
});

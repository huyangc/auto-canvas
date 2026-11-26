import { trace } from "./notebook-storage-fixtures.js";
// The back/forward cache, in the notebook-bfcache project
// (playwright.config.ts): a browser launched without Playwright's
// --disable-back-forward-cache, so Back can restore a page as it was.
import { expect, test, type Page } from "@playwright/test";
import { openUserComponents, renameProject } from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";
import {
  expectBearers,
  expectNoForeignOrigin,
  newUser,
  nextAuthMe,
  nextLoad,
  notebookSuite,
  openNotebookEditor,
  readPageShows,
  recordRequests,
  requestsWithBearer,
  signIn,
  TOKEN_KEY,
  writeTokenFrom,
} from "./notebook-fixtures.js";

// No service worker (T162c); no trace (notebook-fixtures.ts, notebookSuite).
test.use({ serviceWorkers: "block", trace: "off" });
notebookSuite();

const RESTORED_KEY = "__notebookE2eRestored";

function readRestored(page: Page): Promise<unknown> {
  return page.evaluate(
    (key) =>
      JSON.parse(
        window.__nb.read(window.__nb.session, key) ?? "null",
      ) as unknown,
    RESTORED_KEY,
  );
}

test("N6c control: a plain page is restored from the back/forward cache", async ({
  page,
}) => {
  await page.goto("/a");
  await page.goto("/b");
  await page.goBack({ waitUntil: "commit" });
  await expect
    .poll(async () => (await readPageShows(page)).at(-1))
    .toEqual({ path: "/a", persisted: true, navigation: "navigate" });
});

test("N6c sign-out then Back: the restored editor is cleared at pageshow", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const name = `Alice cached ${Math.random().toString(16).slice(2, 10)}`;
  await signIn(page, alice);
  await openNotebookEditor(page, "/canvas/editor?new=1");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await renameProject(page, name);
  await expect(page.getByText(name).first()).toBeVisible();
  // Passive, registered after mount (after the gate's own listener): what
  // the restored document shows once the gate has handled its pageshow.
  await page.evaluate(
    ([key, aliceName]) => {
      window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        window.__nb.write(
          window.__nb.session,
          key,
          JSON.stringify({
            screen:
              document
                .querySelector("[data-testid^='notebook-']")
                ?.getAttribute("data-testid") ?? null,
            canvases: document.querySelectorAll(
              "[data-testid='schematic-canvas']",
            ).length,
            aliceName: document.body.innerText.includes(aliceName),
          }),
        );
      });
    },
    [RESTORED_KEY, name] as const,
  );
  await page.goto("/");
  const removed = await recorder.mark("signed out");
  await writeTokenFrom(page, null);
  expect(
    await page.evaluate(
      (key) => window.__nb.read(window.__nb.local, key),
      TOKEN_KEY,
    ),
  ).toBeNull();
  const loaded = nextLoad(page);
  await page.goBack({ waitUntil: "commit" });
  await loaded;
  await expect(page.getByTestId("notebook-signed-out")).toBeVisible();
  const shows = await readPageShows(page);
  const restoredAt = shows.findIndex(
    (show) => show.path === "/canvas/editor" && show.persisted,
  );
  test.info().annotations.push({
    type: "N6c pageshow record",
    description: JSON.stringify(shows),
  });
  // A real restore of the editor, then the reload it started.
  expect(restoredAt).toBeGreaterThanOrEqual(0);
  expect(shows.slice(restoredAt)).toEqual([
    { path: "/canvas/editor", persisted: true, navigation: "navigate" },
    { path: "/canvas/editor", persisted: false, navigation: "reload" },
  ]);
  expect(await readRestored(page)).toEqual({
    screen: "notebook-account-changed",
    canvases: 0,
    aliceName: false,
  });
  await expect(page.getByText(name)).toHaveCount(0);
  expect(await requestsWithBearer(recorder, removed, alice)).toEqual([]);
  await expectBearers(recorder, { from: removed, source: page, user: null });
  expectNoForeignOrigin(recorder.records);
});

for (const [title, changed] of [
  ["R6 a persisted editor rechecks a changed session while concealed", true],
  [
    "R6 a persisted editor reveals its working modal for the same session",
    false,
  ],
] as const)
  test(title, async ({ page }) => {
    const alice = newUser("alice"),
      bob = newUser("bob");
    await signIn(page, alice);
    await openNotebookEditor(page);
    await placeComponent(page, "resistor", { x: 320, y: 200 });
    await expect(page.getByTestId("revision")).toHaveText("1");
    await openUserComponents(page);
    await page
      .getByRole("button", { name: "Create Component…", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Edit Component Definition",
    });
    const field = modal.getByLabel("Definition type");
    await field.selectOption("json");
    await field.focus();
    await expect(field).toBeFocused();
    const doc = await page.evaluate(() => {
      window.__nb.observeRestore();
      return window.__nb.doc;
    });
    await page.goto("/");
    if (changed) await writeTokenFrom(page, bob);
    const identified = changed ? nextAuthMe(page, bob) : null;
    await page.goBack({ waitUntil: "commit" });
    if (identified) expect((await identified).status()).toBe(200);
    await page.getByTestId("schematic-canvas").waitFor();
    await expect
      .poll(async () =>
        (await trace(page)).some(
          (e) => e.doc === doc && e.op === "late-pageshow",
        ),
      )
      .toBe(true);
    const events = (await trace(page)).filter((e) => e.doc === doc);
    const hidden = events.find((e) => e.op === "late-pagehide")!;
    expect(hidden).toMatchObject({ concealed: true, canvas: true });
    const token = events.find(
      (e) => e.seq > hidden.seq && e.op === "getItem" && e.name === TOKEN_KEY,
    )!;
    expect(token).toMatchObject({ concealed: true });
    const restored = events.find((e) => e.op === "late-pageshow")!;
    expect(events).toContainEqual(
      expect.objectContaining({
        op: "pageshow",
        name: "true",
        path: "/canvas/editor",
      }),
    );
    expect(restored.seq).toBeGreaterThan(token.seq);
    expect(restored).toMatchObject({
      concealed: false,
      changed,
      canvas: !changed,
    });
    const reload = events.find(
      (e) => e.op === "mark" && e.name === "auto-canvas:notebook-reload",
    );
    if (changed) {
      expect(restored.outside).toBe(0);
      expect(reload!.seq).toBeGreaterThan(restored.seq);
    } else {
      expect(reload).toBeUndefined();
      expect(await page.evaluate(() => window.__nb.doc)).toBe(doc);
      await expect(field).toHaveValue("json");
      const box = await field.boundingBox();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
      await field.press("c");
      await expect(field).toHaveValue("circuit");
    }
  });

import { newComponentDefinition } from "../src/features/user-components/component-definition-edit.js";
import {
  prefix,
  seedDraw,
  rawRecords,
  trace,
  documentTrace,
  checkNamespace,
  type StorageEventRecord,
} from "./notebook-storage-fixtures.js";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
  type Route,
} from "@playwright/test";
import {
  clickCommand,
  downloadBytes,
  openProjectFile,
  openUserComponents,
  chooseComponent,
  projectTabAction,
  renameProject,
  showNetlistPanel,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";
import {
  createProjectAs,
  expectBearers,
  expectNoApiRequest,
  expectNoForeignOrigin,
  fixture,
  newUser,
  nextAuthMe,
  nextLoad,
  notebookSuite,
  openNotebookEditor,
  openShelfWall,
  openVersionHistory,
  origin,
  projectNamesOf,
  readProbe,
  readPageShows,
  readSingleUserRecovery,
  recordDialogs,
  recordRequests,
  RECOVERY_DATABASE,
  requestsWithBearer,
  seedSingleUserRecovery,
  signIn,
  TOKEN_KEY,
  updateProjectAs,
  threeResistorProject,
  WORKING_COPY_KEY,
  WORKSPACE_DATABASE,
  writeTokenFrom,
  type Mark,
  type NotebookUser,
  type RequestRecord,
  type RequestRecorder,
  type SingleUserRecovery,
} from "./notebook-fixtures.js";

// No service worker (T162c); no trace (notebook-fixtures.ts, notebookSuite).
test.use({ serviceWorkers: "block", trace: "off" });
notebookSuite();

const EDITOR_MODULE =
  /\/canvas\/assets\/(?:App|web-editor-services)-[^/]*\.js$/u;
const isApi = (url: string) => new URL(url).pathname.startsWith("/canvas/api/");

function editorModules(records: RequestRecord[]): string[] {
  return records
    .map((record) => record.url)
    .filter((url) => EDITOR_MODULE.test(url));
}

/** The probe of the editor document once it opened both databases. */
async function expectEditorStorage(
  page: Page,
  user: NotebookUser,
): Promise<void> {
  await expect
    .poll(async () => {
      const probe = await readProbe(page);
      return {
        token: probe.some(
          (entry) =>
            entry.op === "getItem" &&
            entry.area === "local" &&
            entry.key === TOKEN_KEY,
        ),
        workingCopy: probe.some(
          (entry) =>
            entry.op === "getItem" &&
            entry.area === "session" &&
            entry.key === prefix(user) + WORKING_COPY_KEY,
        ),
        databases: [
          ...new Set(
            probe
              .filter((entry) => entry.op === "idb.open")
              .map((entry) => entry.key),
          ),
        ].sort(),
      };
    })
    .toEqual({
      token: true,
      workingCopy: true,
      databases: [RECOVERY_DATABASE, WORKSPACE_DATABASE]
        .map((n) => prefix(user) + n)
        .sort(),
    });
}

for (const [title, stored] of [
  [
    "N1a no token key: signed-out page, no API request, no editor module or storage",
    null,
  ],
  [
    "N1b a malformed token: signed-out page, no API request, no editor module or storage",
    "bad token",
  ],
] as const)
  test(title, async ({ page, context }) => {
    const recorder = recordRequests(context);
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => {
        if (value === null) window.__nb.remove(window.__nb.local, key);
        else window.__nb.write(window.__nb.local, key, value);
      },
      [TOKEN_KEY, stored] as const,
    );
    const start = await recorder.mark("no session");
    await page.goto("/canvas/editor");
    const signedOut = page.getByTestId("notebook-signed-out");
    await expect(signedOut).toBeVisible();
    await expect(signedOut.getByRole("link")).toHaveAttribute("href", "/");
    await page.waitForLoadState("networkidle");
    const end = await recorder.mark("control");

    const records = recorder.between(start, end);
    expect(records.filter((record) => isApi(record.url))).toEqual([]);
    expect(
      (await fixture.log(start.seq + 1, end.seq)).filter((entry) =>
        entry.path.startsWith("/canvas/api/"),
      ),
    ).toEqual([]);
    expect(editorModules(records)).toEqual([]);
    expect(await readProbe(page)).toEqual([
      { op: "getItem", area: "local", key: TOKEN_KEY },
    ]);
    expect(await page.evaluate(() => window.__nb.list())).toEqual([]);
    await expectBearers(recorder, {
      from: start,
      to: end,
      source: page,
      user: null,
    });

    // Positive control: the same wrappers see a mounted editor's storage.
    const user = newUser("n1");
    await signIn(page, user);
    const mounted = await recorder.mark("mounted");
    await openNotebookEditor(page);
    await expectEditorStorage(page, user);
    expect(editorModules(recorder.between(mounted)).length).toBeGreaterThan(0);
    await expectBearers(recorder, { from: mounted, source: page, user });
    expectNoForeignOrigin(recorder.records);
  });

/** A route on `auth/me` that counts its hits and the bearers they carried. */
async function routeAuthMe(
  page: Page,
  answer: (route: Route) => Promise<void>,
): Promise<{ bearers: (string | undefined)[] }> {
  const hits = { bearers: [] as (string | undefined)[] };
  await page.route("**/canvas/api/auth/me", async (route) => {
    hits.bearers.push(route.request().headers().authorization);
    await answer(route);
  });
  return hits;
}

/**
 * Opens the editor with a fault in place and checks the document that failed:
 * the error page with Retry, no editor module, no IndexedDB open, and in both
 * storage areas no read but the token's. Then the seed is unchanged.
 */
async function expectIdentificationFailure(
  page: Page,
  recorder: RequestRecorder,
  user: NotebookUser,
  seed: SingleUserRecovery,
  delivered: (from: Mark) => Promise<void>,
): Promise<void> {
  const from = await recorder.mark("fault");
  await page.goto("/canvas/editor");
  const error = page.getByTestId("notebook-error");
  await expect(error).toBeVisible();
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(error).toContainText(
    "The canvas could not confirm your silicon-notebook session right now.",
  );
  await delivered(from);
  const probe = await readProbe(page);
  expect(probe.filter((entry) => entry.area === "idb")).toEqual([]);
  expect(
    probe.filter((entry) => entry.op === "getItem" && entry.key !== TOKEN_KEY),
  ).toEqual([]);
  expect(
    probe.filter((entry) => entry.op === "getItem").length,
  ).toBeGreaterThan(0);
  expect(editorModules(recorder.between(from))).toEqual([]);
  await expectBearers(recorder, { from, source: page, user });
  expect(
    await page.evaluate(async () =>
      (await window.__nb.list()).map((db) => db.name),
    ),
  ).toEqual([RECOVERY_DATABASE]);
  expect(await readSingleUserRecovery(page)).toEqual(seed);
}

/** A fresh user signed in on `/` of a tab holding a single-user draft. */
async function seededSession(page: Page, context: BrowserContext) {
  const recorder = recordRequests(context);
  const user = newUser("n2");
  await page.goto("/");
  const seed = await seedSingleUserRecovery(page);
  expect(seed.records).toHaveLength(1);
  expect(seed.workingCopy).not.toBeNull();
  await writeTokenFrom(page, user);
  return { recorder, user, seed };
}

function routeHit(
  hits: { bearers: (string | undefined)[] },
  user: NotebookUser,
) {
  return async () => {
    expect(hits.bearers.length).toBeGreaterThanOrEqual(1);
    expect(new Set(hits.bearers)).toEqual(new Set([user.bearer]));
  };
}

test("N2a notebook unreachable: error page with Retry, no single-user storage", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  const hits = await routeAuthMe(page, (route) =>
    route.abort("connectionrefused"),
  );
  await expectIdentificationFailure(
    page,
    recorder,
    user,
    seed,
    routeHit(hits, user),
  );
  expectNoForeignOrigin(recorder.records);
});

test("N2b notebook answers 5xx: error page with Retry, no single-user storage", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  await fixture.notebook("error");
  await expectIdentificationFailure(
    page,
    recorder,
    user,
    seed,
    async (from) => {
      const entries = (await fixture.log(from.seq + 1)).filter(
        (entry) =>
          entry.method === "GET" && entry.path === "/canvas/api/auth/me",
      );
      expect(entries.length).toBeGreaterThanOrEqual(1);
      for (const entry of entries) {
        expect(entry.authorization).toBe(user.bearer);
        expect(entry.status).toBe(503);
      }
    },
  );
  expectNoForeignOrigin(recorder.records);
});

test("N2c auth/me answers 500: error page with Retry, no single-user storage", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  const hits = await routeAuthMe(page, (route) =>
    route.fulfill({ status: 500, json: { error: "internal" } }),
  );
  await expectIdentificationFailure(
    page,
    recorder,
    user,
    seed,
    routeHit(hits, user),
  );
  expectNoForeignOrigin(recorder.records);
});

test("N2d auth/me answers malformed JSON or no user: error page with Retry", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  for (const body of ["{", '{"user":{}}']) {
    const hits = await routeAuthMe(page, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body }),
    );
    await expectIdentificationFailure(
      page,
      recorder,
      user,
      seed,
      routeHit(hits, user),
    );
    await page.unrouteAll();
  }
  expectNoForeignOrigin(recorder.records);
});

test("N2e auth/me answers a standalone user: error page with Retry", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  const hits = await routeAuthMe(page, (route) =>
    route.fulfill({
      json: {
        user: {
          id: "local",
          displayName: "Local user",
          email: null,
          provider: "local",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await expectIdentificationFailure(
    page,
    recorder,
    user,
    seed,
    routeHit(hits, user),
  );
  expectNoForeignOrigin(recorder.records);
});

test("N2f Retry after the fault is gone mounts the editor", async ({
  page,
  context,
}) => {
  const { recorder, user, seed } = await seededSession(page, context);
  const hits = await routeAuthMe(page, (route) =>
    route.fulfill({ status: 500, json: { error: "internal" } }),
  );
  await expectIdentificationFailure(
    page,
    recorder,
    user,
    seed,
    routeHit(hits, user),
  );
  await page.unrouteAll();
  const retried = await recorder.mark("retry");
  const identified = nextAuthMe(page, user);
  await page.getByRole("button", { name: "Retry" }).click();
  expect((await identified).status()).toBe(200);
  await page.getByTestId("schematic-canvas").waitFor();
  // Positive control: the mounted editor reads what the failure did not.
  await expectEditorStorage(page, user);
  await expectBearers(recorder, { from: retried, source: page, user });
  expectNoForeignOrigin(recorder.records);
});

test("N2g a token notebook rejects shows the signed-out page", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  await page.goto("/");
  await page.evaluate(
    (key) => window.__nb.write(window.__nb.local, key, "zz-unknown"),
    TOKEN_KEY,
  );
  const from = await recorder.mark("unknown token");
  await page.goto("/canvas/editor");
  await expect(page.getByTestId("notebook-signed-out")).toBeVisible();
  await expect(page.getByTestId("notebook-error")).toHaveCount(0);
  const entries = (await fixture.log(from.seq + 1)).filter(
    (entry) => entry.path === "/canvas/api/auth/me",
  );
  expect(entries.map((entry) => [entry.authorization, entry.status])).toEqual([
    ["Bearer zz-unknown", 401],
  ]);
  expect(editorModules(recorder.between(from))).toEqual([]);
  expect(
    (await readProbe(page)).filter((entry) => entry.key !== TOKEN_KEY),
  ).toEqual([]);
  expectNoForeignOrigin(recorder.records);
});

const hex = () => Math.random().toString(16).slice(2, 10);

/** Saves with the shortcut; resolves with the POST or PUT it sends. */
async function save(page: Page, method: "POST" | "PUT"): Promise<Response> {
  const saved = page.waitForResponse(
    (response) =>
      /^\/canvas\/api\/projects(?:\/[^/]+)?$/u.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === method,
  );
  await page.keyboard.press("ControlOrMeta+s");
  return saved;
}

/** Alice's mounted editor with a named, dirty drawing (not saved). */
async function namedDirtyDrawing(page: Page, name: string): Promise<void> {
  await openNotebookEditor(page, "/canvas/editor?new=1");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await renameProject(page, name);
  await expect(page.getByText(name).first()).toBeVisible();
}

/**
 * Three resistors: the editor prompts before leaving only a drawing of at
 * least three objects (document/project-content.ts); fewer are throwaways.
 */
async function placeMeaningfulDrawing(page: Page): Promise<void> {
  for (const [x, y] of [
    [320, 200],
    [420, 260],
    [520, 200],
  ] as const)
    await placeComponent(page, "resistor", { x, y });
}

/** Every distinct preview URL these records fetched. */
function previewUrls(records: RequestRecord[]): string[] {
  return [
    ...new Set(
      records
        .map((record) => record.url)
        .filter((url) => /\/preview\.svg(?:\?|$)/u.test(url)),
    ),
  ];
}

/** `blob:` images on the page (Shelf tiles, version rows). */
function blobImages(page: Page) {
  return page.locator('img[src^="blob:"]');
}

test("N3 an account switch in another tab reloads into the new account without the old previews", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const bob = newUser("bob");
  const name = `Alice circuit ${hex()}`;
  await signIn(page, alice);
  const alicePhase = await recorder.mark("alice");
  await namedDirtyDrawing(page, name);
  const created = await save(page, "POST");
  expect(created.status()).toBe(201);
  const aliceId = ((await created.json()) as { project: { id: string } })
    .project.id;
  await placeComponent(page, "resistor", { x: 420, y: 260 });
  expect((await save(page, "PUT")).status()).toBe(200);
  await openShelfWall(page);
  const tileImage = page.getByTestId(`shelf-tile-${aliceId}`).locator("img");
  await expect(tileImage).toHaveAttribute("src", /^blob:/u);
  await openVersionHistory(page, aliceId);
  await expect(page.getByTestId("version-1").locator("img")).toHaveAttribute(
    "src",
    /^blob:/u,
  );
  const alicePreviews = previewUrls(recorder.between(alicePhase));
  expect(alicePreviews.length).toBeGreaterThanOrEqual(2);
  const other = await context.newPage();
  await other.goto("/");

  const loaded = nextLoad(page);
  const identified = nextAuthMe(page, bob);
  const reloaded = recorder.markAtNavigation(page, "bob");
  const switched = await recorder.mark("switch");
  await writeTokenFrom(other, bob);
  await loaded;
  expect((await identified).status()).toBe(200);
  const bobPhase = await reloaded;
  await page.getByTestId("schematic-canvas").waitFor();
  const wall = await openShelfWall(page);
  await expect(wall.getByTestId("shelf-empty")).toBeVisible();
  await expect(page.getByTestId(`shelf-actions-${aliceId}`)).toHaveCount(0);
  await expect(blobImages(page)).toHaveCount(0);
  const end = await recorder.mark("end");

  const later = recorder.between(switched, end).map((record) => record.url);
  const laterLog = (await fixture.log(switched.seq + 1, end.seq)).map(
    (entry) => `${origin}${entry.path}`,
  );
  for (const url of alicePreviews) {
    expect(later).not.toContain(url);
    expect(laterLog).not.toContain(url);
  }
  expect(await requestsWithBearer(recorder, switched, alice)).toEqual([]);
  expect(await projectNamesOf(bob)).toEqual([]);
  await expectNoApiRequest(recorder, { from: switched, to: bobPhase, page });
  await expectBearers(recorder, {
    from: bobPhase,
    to: end,
    source: page,
    user: bob,
  });
  await expectBearers(recorder, {
    from: alicePhase,
    to: switched,
    source: page,
    user: alice,
  });
  expectNoForeignOrigin(recorder.records);
});

/**
 * B opens the editor as Bob: his own, empty Shelf, none of these names in
 * it. Only the Shelf is checked: until T163 Bob's editor may restore an
 * unsaved tab of Alice's from the browser storage they share.
 */
async function expectBobsOwnEditor(
  b: Page,
  bob: NotebookUser,
  names: string[],
): Promise<void> {
  const identified = nextAuthMe(b, bob);
  await openNotebookEditor(b);
  expect((await identified).status()).toBe(200);
  const wall = await openShelfWall(b);
  await expect(wall.getByTestId("shelf-empty")).toBeVisible();
  for (const name of names)
    await expect(wall.getByText(name, { exact: true })).toHaveCount(0);
}

test("N4a a save issued before the switch stays the old account's", async ({
  page: a,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const bob = newUser("bob");
  const name = `Alice in flight ${hex()}`;
  await signIn(a, alice);
  const b = await context.newPage();
  await b.goto("/");
  const alicePhase = await recorder.mark("alice");
  await namedDirtyDrawing(a, name);
  await fixture.hold({ method: "POST", pathPattern: "^/canvas/api/projects$" });
  await a.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      recorder.records
        .filter(
          (record) =>
            record.page === a &&
            record.method === "POST" &&
            new URL(record.url).pathname === "/canvas/api/projects",
        )
        .map((record) => record.authorization),
    )
    .toEqual([alice.bearer]);
  await expect
    .poll(async () =>
      (await fixture.held()).map((held) => [
        held.method,
        held.path,
        held.complete,
      ]),
    )
    .toEqual([["POST", "/canvas/api/projects", true]]);
  const held = await fixture.held();
  expect(held[0]!.bodyBytes).toBeGreaterThan(0);

  const failed: string[] = [];
  a.on("requestfailed", (request) => {
    if (request.method() === "POST") failed.push(request.url());
  });
  const loaded = nextLoad(a);
  const identified = nextAuthMe(a, bob);
  const reloaded = recorder.markAtNavigation(a, "bob");
  const switched = await recorder.mark("switch");
  await writeTokenFrom(b, bob);
  await loaded;
  expect((await identified).status()).toBe(200);
  const bobPhase = await reloaded;
  await a.getByTestId("schematic-canvas").waitFor();
  expect((await fixture.release()).map((item) => item.status)).toEqual([201]);
  expect(await projectNamesOf(alice)).toContain(name);
  expect(await projectNamesOf(bob)).not.toContain(name);
  test.info().annotations.push({
    type: "N4a requestfailed (diagnostic)",
    description: failed.length ? failed.join(", ") : "none recorded",
  });
  const end = await recorder.mark("end");
  await expectBearers(recorder, {
    from: alicePhase,
    to: switched,
    source: a,
    user: alice,
  });
  await expectNoApiRequest(recorder, {
    from: switched,
    to: bobPhase,
    page: a,
  });
  await expectBearers(recorder, {
    from: bobPhase,
    to: end,
    source: a,
    user: bob,
  });
  await expectBearers(recorder, {
    from: alicePhase,
    to: end,
    source: b,
    user: null,
    log: false,
  });

  const bobsOwn = await recorder.mark("b as bob");
  await expectBobsOwnEditor(b, bob, [name]);
  await expectBearers(recorder, { from: bobsOwn, source: b, user: bob });
  expectNoForeignOrigin(recorder.records);
});

test("N4b a save in the pre-event interval carries the mounted account's bearer", async ({
  page: a,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const bob = newUser("bob");
  const name = `Alice interval ${hex()}`;
  await signIn(a, alice);
  const alicePhase = await recorder.mark("alice");
  await namedDirtyDrawing(a, name);
  // The other tab's write, before its event arrives: write through the saved
  // native handle on this tab so no storage event fires yet (never touching
  // the editor's namespaced localStorage).
  await writeTokenFrom(a, bob);
  await expect(a.getByTestId("schematic-canvas")).toBeVisible();
  await expect(a.getByTestId("notebook-account-changed")).toHaveCount(0);

  const loaded = nextLoad(a);
  const identified = nextAuthMe(a, bob);
  const reloaded = recorder.markAtNavigation(a, "bob");
  const saving = await recorder.mark("save");
  const saved = await save(a, "POST");
  expect(saved.request().headers().authorization).toBe(alice.bearer);
  const status = saved.status();
  test.info().annotations.push({
    type: "N4b save status",
    description: String(status),
  });
  if (status === 201) {
    expect(await projectNamesOf(alice)).toContain(name);
    expect(await projectNamesOf(bob)).not.toContain(name);
    await a.evaluate(() => {
      setTimeout(() => window.dispatchEvent(new Event("focus")), 0);
    });
  } else {
    expect(status).toBe(401);
    expect(await projectNamesOf(alice)).not.toContain(name);
    expect(await projectNamesOf(bob)).not.toContain(name);
  }
  await loaded;
  expect((await identified).status()).toBe(200);
  const bobPhase = await reloaded;
  await a.getByTestId("schematic-canvas").waitFor();
  const end = await recorder.mark("end");
  await expectBearers(recorder, {
    from: alicePhase,
    to: bobPhase,
    source: a,
    user: alice,
  });
  await expectBearers(recorder, {
    from: bobPhase,
    to: end,
    source: a,
    user: bob,
  });
  expect(
    recorder
      .between(saving, bobPhase)
      .filter((record) => record.authorization === bob.bearer),
  ).toEqual([]);

  const b = await context.newPage();
  const bobsOwn = await recorder.mark("b as bob");
  await expectBobsOwnEditor(b, bob, [name]);
  await expectBearers(recorder, {
    from: bobsOwn,
    source: b,
    user: bob,
    log: [bob],
  });
  expectNoForeignOrigin(recorder.records);
});

test("N4c a 401 on a mounted document reloads the page", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  await signIn(page, alice);
  const alicePhase = await recorder.mark("alice");
  await openNotebookEditor(page);
  const bearers: (string | undefined)[] = [];
  await page.route(
    "**/canvas/api/projects",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      bearers.push(route.request().headers().authorization);
      await route.fulfill({ status: 401, json: { error: "unauthorized" } });
    },
    { times: 1 },
  );
  const loaded = nextLoad(page);
  const identified = nextAuthMe(page, alice);
  const reloaded = recorder.markAtNavigation(page, "reloaded");
  // Opening the Shelf asks for the Project list: the 401 ends the page.
  await projectTabAction(page, "Open Cloud Project…");
  await loaded;
  expect(bearers).toEqual([alice.bearer]);
  expect((await identified).status()).toBe(200);
  const second = await reloaded;
  await page.getByTestId("schematic-canvas").waitFor();
  const end = await recorder.mark("end");
  await expectBearers(recorder, {
    from: alicePhase,
    to: end,
    source: page,
    user: alice,
  });
  expect(recorder.between(second, end).length).toBeGreaterThan(0);
  expectNoForeignOrigin(recorder.records);
});

test("N5a unsaved work: the switch reloads without a beforeunload prompt", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const bob = newUser("bob");
  await signIn(page, alice);
  const other = await context.newPage();
  await other.goto("/");
  await openNotebookEditor(page, "/canvas/editor?new=1");
  await placeMeaningfulDrawing(page);
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 600, y: 400 } });
  const dialogs = recordDialogs(page);
  // Calibration: this unsaved drawing does prompt before a plain reload.
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  await expect.poll(() => dialogs.types).toEqual(["beforeunload"]);
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();

  const loaded = nextLoad(page);
  const identified = nextAuthMe(page, bob);
  const reloaded = recorder.markAtNavigation(page, "bob");
  const switched = await recorder.mark("switch");
  const before = dialogs.types.length;
  await writeTokenFrom(other, bob);
  await loaded;
  expect(dialogs.types.slice(before)).toEqual([]);
  expect((await identified).status()).toBe(200);
  const bobPhase = await reloaded;
  await page.getByTestId("schematic-canvas").waitFor();
  expect(dialogs.types.slice(before)).toEqual([]);
  const end = await recorder.mark("end");
  await expectNoApiRequest(recorder, { from: switched, to: bobPhase, page });
  await expectBearers(recorder, {
    from: bobPhase,
    to: end,
    source: page,
    user: bob,
  });
  expectNoForeignOrigin(recorder.records);
});

test("N5b the old document is cleared at the storage event and sends nothing", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const bob = newUser("bob");
  const name = `Alice unsaved ${hex()}`;
  await signIn(page, alice);
  const other = await context.newPage();
  await other.goto("/");
  await namedDirtyDrawing(page, name);
  // Enough to arm the editor's own leave prompt as well (N5a).
  await placeComponent(page, "resistor", { x: 420, y: 260 });
  await placeComponent(page, "resistor", { x: 520, y: 200 });
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 600, y: 400 } });
  // Registered after mount, so after the gate's own storage listener.
  await page.evaluate(
    ([key, aliceName]) => {
      const facts = () => ({
        screen:
          document
            .querySelector("[data-testid^='notebook-']")
            ?.getAttribute("data-testid") ?? null,
        canvases: document.querySelectorAll("[data-testid='schematic-canvas']")
          .length,
        aliceName: document.body.innerText.includes(aliceName),
        rootChildren: document.getElementById("root")!.children.length,
      });
      const record = window as unknown as Record<string, unknown>;
      window.addEventListener("storage", (event) => {
        if (event.key === key) record.__atStorage = facts();
      });
      window.addEventListener("beforeunload", (event) => {
        record.__atReload = facts();
        event.preventDefault();
      });
    },
    [TOKEN_KEY, name] as const,
  );
  const dialogs = recordDialogs(page);
  const switched = await recorder.mark("switch");
  await writeTokenFrom(other, bob);
  await expect.poll(() => dialogs.types).toEqual(["beforeunload"]);
  const cleared = {
    screen: "notebook-account-changed",
    canvases: 0,
    aliceName: false,
    rootChildren: 1,
  };
  const at = await page.evaluate(() => {
    const record = window as unknown as Record<string, unknown>;
    return { storage: record.__atStorage, reload: record.__atReload };
  });
  expect(at).toEqual({ storage: cleared, reload: cleared });
  const attempts = await page.evaluate(async () => {
    const outcome = async (request: Promise<unknown>) => {
      try {
        await request;
        return "sent";
      } catch (error) {
        return (error as Error).message;
      }
    };
    return [
      await outcome(fetch("/canvas/api/projects")),
      await outcome(
        fetch("/canvas/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "after the switch", projectText: "{}" }),
        }),
      ),
    ];
  });
  expect(attempts).toEqual([
    "The canvas session has ended",
    "The canvas session has ended",
  ]);
  await page.keyboard.press("ControlOrMeta+s");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByTestId("notebook-account-changed")).toBeVisible();
  const end = await recorder.mark("end");
  expect(
    recorder
      .between(switched, end)
      .map((record) => `${record.method} ${record.url}`),
  ).toEqual([]);
  expect(
    (await fixture.log(switched.seq + 1, end.seq))
      .filter((entry) => entry.marker === null)
      .map((entry) => `${entry.method} ${entry.path}`),
  ).toEqual([]);
  expect(await projectNamesOf(alice)).toEqual([]);
  expect(await projectNamesOf(bob)).toEqual([]);
  expectNoForeignOrigin(recorder.records);
});

test("N6a sign-out then Back shows the signed-out page", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const name = `Alice back ${hex()}`;
  await signIn(page, alice);
  await namedDirtyDrawing(page, name);
  await page.goto("/");
  const removed = await recorder.mark("signed out");
  await writeTokenFrom(page, null);
  await page.goBack();
  await expect(page.getByTestId("notebook-signed-out")).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  const shows = await readPageShows(page);
  expect(shows.at(-1)).toMatchObject({
    path: "/canvas/editor",
    persisted: false,
  });
  expect(shows.filter((show) => show.persisted)).toEqual([]);
  expect(await requestsWithBearer(recorder, removed, alice)).toEqual([]);
  await expectBearers(recorder, { from: removed, source: page, user: null });
  expectNoForeignOrigin(recorder.records);
});

test("N6b sign-out in another page reloads into the signed-out page", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const name = `Alice elsewhere ${hex()}`;
  await signIn(page, alice);
  const other = await context.newPage();
  await other.goto("/");
  await namedDirtyDrawing(page, name);
  const loaded = nextLoad(page);
  const removed = await recorder.mark("signed out");
  await writeTokenFrom(other, null);
  await loaded;
  await expect(page.getByTestId("notebook-signed-out")).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  expect(await requestsWithBearer(recorder, removed, alice)).toEqual([]);
  await expectBearers(recorder, { from: removed, source: page, user: null });
  expectNoForeignOrigin(recorder.records);
});

/** Copies the netlist in this format (rnl-interchange.spec.ts's steps). */
async function copyNetlist(page: Page, mode: "spice+rnl"): Promise<string> {
  await page.evaluate(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "__copied", {
      value: copied,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => void copied.push(text),
        write: async (items: ClipboardItem[]) => {
          for (const item of items)
            copied.push(await (await item.getType("text/plain")).text());
        },
      },
    });
  });
  const panel = await showNetlistPanel(page);
  await panel.getByLabel("Netlist format").selectOption(mode);
  await expect(
    panel.getByRole("textbox", { name: "RNL netlist code", exact: true }),
  ).toBeVisible();
  await panel.getByTestId("copy-netlist-panel").click();
  const read = () =>
    page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? "",
    );
  await expect.poll(read).not.toBe("");
  return read();
}

test("N8 bundled packages, the RNL Viewer and the RNL Worker carry no bearer", async ({
  page,
  context,
}) => {
  const viewerUrl = "https://rich-netlist.github.io/rnl/viewer/";
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const trapped: string[] = [];
  await context.route(
    "https://rich-netlist.github.io/rnl-packages/**",
    async (route) => {
      trapped.push(route.request().url());
      await route.abort();
    },
  );
  await context.route(`${viewerUrl}**`, async (route) => {
    if (route.request().url().endsWith("viewer-api.json"))
      await route.fulfill({
        json: { rnl: 1, features: ["requestId", "packages", "opener"] },
        headers: { "access-control-allow-origin": "*" },
      });
    else
      await route.fulfill({
        contentType: "text/html",
        body: `<title>RNL Viewer</title><script>
        const params=new URLSearchParams(location.search), token=params.get('token'), origin=params.get('origin');
        addEventListener('message', event=>{
          if(event.source!==opener || event.origin!==origin || event.data?.token!==token || event.data?.rnl!==1) return;
          opener.postMessage({rnl:1,token,type:'loaded',requestId:event.data.requestId},origin);
        });
        opener.postMessage({rnl:1,token,type:'ready',features:['requestId','packages','opener']},origin);
      </script>`,
      });
  });
  await signIn(page, alice);
  const alicePhase = await recorder.mark("alice");
  await openNotebookEditor(page, "/canvas/editor?example=two-stage-op-amp");
  const text = await copyNetlist(page, "spice+rnl");
  expect(text).toContain('@RNL(type="header")');
  const link = page.getByRole("link", { name: /^Open RNL Viewer/u });
  await expect(link).toBeEnabled();
  const popup = page.waitForEvent("popup");
  await link.click();
  const viewer = await popup;
  await viewer.waitForLoadState("domcontentloaded");
  await expect(link).toBeEnabled();
  const end = await recorder.mark("end");
  const records = recorder.between(alicePhase, end);

  const hits = (pattern: RegExp) =>
    records.filter((record) => pattern.test(record.url));
  const describe = (pattern: RegExp) =>
    hits(pattern).map((record) => ({
      source:
        record.source === "page"
          ? record.page === page
            ? "page"
            : record.page === viewer
              ? "popup"
              : "other page"
          : record.source,
      authorization: record.authorization ?? null,
    }));
  const packages = describe(
    /\/canvas\/assets\/analog-canvas-extensions-[^/]*\.rnl(?:\?|$)/u,
  );
  const viewerApi = describe(/\/rnl\/viewer\/viewer-api\.json(?:\?|$)/u);
  const viewerPage = records
    .filter(
      (record) =>
        record.url.startsWith(viewerUrl) &&
        record.request.isNavigationRequest(),
    )
    .map((record) => ({
      source:
        record.source === "page"
          ? record.page === viewer
            ? "popup"
            : "other page"
          : record.source,
      authorization: record.authorization ?? null,
    }));
  const wasm = describe(/\/canvas\/assets\/rnl_runtime_wasm-[^/]*\.wasm$/u);
  test.info().annotations.push({
    type: "N8 hits",
    description: JSON.stringify({
      packages,
      viewerApi,
      viewerPage,
      wasm,
      trapped,
    }),
  });
  expect(packages.length).toBeGreaterThanOrEqual(1);
  expect(packages).toEqual(
    packages.map(() => ({ source: "page", authorization: null })),
  );
  const packageLog = (await fixture.log(alicePhase.seq + 1, end.seq)).filter(
    (entry) => /\/canvas\/assets\/analog-canvas-extensions-/u.test(entry.path),
  );
  expect(packageLog.length).toBeGreaterThanOrEqual(1);
  expect(packageLog.map((entry) => entry.authorization)).toEqual(
    packageLog.map(() => null),
  );
  expect(viewerApi.length).toBeGreaterThanOrEqual(1);
  expect(viewerApi).toEqual(
    viewerApi.map(() => ({ source: "page", authorization: null })),
  );
  expect(viewerPage.length).toBeGreaterThanOrEqual(1);
  for (const hit of viewerPage) {
    expect(["frameless", "popup"]).toContain(hit.source);
    expect(hit.authorization).toBeNull();
  }
  expect(wasm.length).toBeGreaterThanOrEqual(1);
  for (const hit of wasm) expect(hit.authorization).toBeNull();
  expect(trapped).toEqual([]);
  for (const source of ["page", "service-worker", "frameless"] as const)
    await expectBearers(recorder, {
      from: alicePhase,
      to: end,
      source: source === "page" ? page : source,
      user: alice,
      log: source === "page",
    });
  await expectBearers(recorder, {
    from: alicePhase,
    to: end,
    source: viewer,
    user: null,
    log: false,
  });
  expectNoForeignOrigin(records, [viewerUrl]);
});

test("N10a the entry chunk fails: reload page, then the editor", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  await signIn(page, alice);
  const from = await recorder.mark("alice");
  const entry = "**/canvas/assets/notebook-*.js";
  await page.route(entry, (route) => route.abort());
  await page.goto("/canvas/editor");
  const error = page.getByTestId("notebook-error");
  await expect(error).toContainText(
    "The canvas could not be loaded. Reload the page to try again.",
  );
  await expect(error.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await page.unroute(entry);
  await error.getByRole("button", { name: "Reload" }).click();
  await page.getByTestId("schematic-canvas").waitFor();
  await expectBearers(recorder, { from, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

test("N10b the editor modules fail: reload page without Retry, then the editor", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  await signIn(page, alice);
  const from = await recorder.mark("alice");
  const modules = "**/canvas/assets/App-*.js";
  await page.route(modules, (route) => route.abort());
  await page.goto("/canvas/editor");
  const error = page.getByTestId("notebook-error");
  await expect(error).toContainText(
    "The canvas could not start. Reload the page to try again.",
  );
  await expect(error.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(error.getByRole("button", { name: "Reload" })).toBeVisible();
  await page.unroute(modules);
  await error.getByRole("button", { name: "Reload" }).click();
  await page.getByTestId("schematic-canvas").waitFor();
  await expectBearers(recorder, { from, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

/** Preview requests (browser records) for this Project's current preview. */
function currentPreviewRequests(
  records: RequestRecord[],
  projectId: string,
): RequestRecord[] {
  return records.filter(
    (record) =>
      new URL(record.url).pathname ===
      `/canvas/api/projects/${encodeURIComponent(projectId)}/preview.svg`,
  );
}

test("N10c lazy Shelf previews load as they scroll into view", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const ids: string[] = [];
  for (let index = 0; index < 60; index += 1)
    ids.push(await createProjectAs(alice, `Lazy ${index + 1}`));
  await signIn(page, alice);
  const from = await recorder.mark("alice");
  await openNotebookEditor(page);
  const wall = await openShelfWall(page);
  await expect(wall.getByTestId("shelf-wall")).toBeVisible();
  // Every tile in view shows its preview (and at least one is in view).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document.querySelector(".cloud-shelf-dialog")!;
        const view = dialog.getBoundingClientRect();
        const top = Math.max(view.top, 0);
        const bottom = Math.min(view.bottom, window.innerHeight);
        const inView = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-testid^='shelf-tile-']",
          ),
        ].filter((tile) => {
          const box = tile.getBoundingClientRect();
          return box.bottom > top && box.top < bottom;
        });
        return {
          inView: inView.length > 0,
          unloaded: inView.filter(
            (tile) => !tile.querySelector("img")?.src.startsWith("blob:"),
          ).length,
        };
      }),
    )
    .toEqual({ inView: true, unloaded: 0 });
  const allPreviews = () =>
    recorder
      .between(from)
      .filter((record) =>
        /^\/canvas\/api\/projects\/[^/]+\/preview\.svg$/u.test(
          new URL(record.url).pathname,
        ),
      );
  const initial = allPreviews().length;
  const lastTile = wall.locator("[data-testid^='shelf-tile-']").last();
  const lastId = (await lastTile.getAttribute("data-testid"))!.slice(
    "shelf-tile-".length,
  );
  expect(ids).toContain(lastId);
  expect(currentPreviewRequests(recorder.between(from), lastId)).toEqual([]);
  const requested = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname ===
      `/canvas/api/projects/${encodeURIComponent(lastId)}/preview.svg`,
  );
  await lastTile.scrollIntoViewIfNeeded();
  expect((await requested).headers().authorization).toBe(alice.bearer);
  await expect(lastTile.locator("img")).toHaveAttribute("src", /^blob:/u);
  const final = allPreviews().length;
  test.info().annotations.push({
    type: "N10c preview requests",
    description: JSON.stringify({ projects: ids.length, initial, final }),
  });
  expect(initial).toBeLessThan(ids.length);
  await expectBearers(recorder, { from, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

/** A Project with three versions (each update keeps the one before). */
async function projectWithThreeVersions(
  user: NotebookUser,
  name: string,
): Promise<{ id: string; versionPaths: string[] }> {
  const id = await createProjectAs(user, name);
  let revision = 1;
  for (const step of [2, 3, 4])
    revision = await updateProjectAs(user, id, revision, `${name} r${step}`);
  expect(revision).toBe(4);
  return {
    id,
    versionPaths: [3, 2, 1].map(
      (n) =>
        `/canvas/api/projects/${id}/versions/${encodeURIComponent(`${id}:${n}`)}/preview.svg`,
    ),
  };
}

test("N10d version history placeholders hold the layout until previews load", async ({
  page,
  context,
}) => {
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const { id, versionPaths } = await projectWithThreeVersions(
    alice,
    `History ${hex()}`,
  );
  await signIn(page, alice);
  const from = await recorder.mark("alice");
  await openNotebookEditor(page);
  await openShelfWall(page);
  await fixture.hold({
    method: "GET",
    pathPattern: "/versions/.+/preview\\.svg$",
  });
  await openVersionHistory(page, id);
  await expect
    .poll(async () => (await fixture.held()).map((held) => held.path).sort())
    .toEqual([...versionPaths].sort());
  const rows = [1, 2, 3].map((n) => page.getByTestId(`version-${n}`));
  const lefts: number[] = [];
  for (const row of rows) {
    const first = row.locator(":scope > *").first();
    expect(await first.evaluate((element) => element.tagName)).toBe("IMG");
    expect(await first.getAttribute("src")).toBeNull();
    const box = (await first.boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    lefts.push((await row.locator(".version-copy").boundingBox())!.x);
  }
  expect((await fixture.release()).map((item) => item.status)).toEqual([
    200, 200, 200,
  ]);
  for (const row of rows)
    await expect
      .poll(() =>
        row.locator(":scope > img").evaluate((image: HTMLImageElement) => ({
          blob: image.src.startsWith("blob:"),
          decoded: image.complete && image.naturalWidth > 0,
        })),
      )
      .toEqual({ blob: true, decoded: true });
  for (const [index, row] of rows.entries())
    expect((await row.locator(".version-copy").boundingBox())!.x).toBe(
      lefts[index],
    );
  await expectBearers(recorder, { from, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

test("N10e previews that do not decode fall back to placeholders", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const errors: { src: string; target: string | null }[] = [];
    Object.defineProperty(window, "__imageErrors", { value: errors });
    window.addEventListener(
      "error",
      (event) => {
        const target = event.target;
        if (target instanceof HTMLImageElement)
          errors.push({
            src: target.src,
            target:
              target
                .closest(
                  "[data-testid^='shelf-tile-'],[data-testid^='version-']",
                )
                ?.getAttribute("data-testid") ?? null,
          });
      },
      true,
    );
  });
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const { id, versionPaths } = await projectWithThreeVersions(
    alice,
    `Undecodable ${hex()}`,
  );
  const hits = new Map<string, number>();
  const notAnImage = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: "not an image",
    });
  };
  await page.route("**/canvas/api/projects/*/preview.svg?*", notAnImage);
  await page.route(
    "**/canvas/api/projects/*/versions/*/preview.svg",
    notAnImage,
  );
  await signIn(page, alice);
  const from = await recorder.mark("alice");
  await openNotebookEditor(page);
  const errorsFor = (target: string) =>
    page.evaluate(
      (name) =>
        (
          window as unknown as {
            __imageErrors: { src: string; target: string | null }[];
          }
        ).__imageErrors.filter(
          (error) => error.target === name && error.src.startsWith("blob:"),
        ).length,
      target,
    );
  const currentPath = `/canvas/api/projects/${id}/preview.svg`;
  const tileResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === currentPath,
  );
  await openShelfWall(page);
  expect((await tileResponse).status()).toBe(200);
  await expect.poll(() => errorsFor(`shelf-tile-${id}`)).toBeGreaterThan(0);
  await expect(
    page.getByTestId(`shelf-tile-${id}`).locator(".shelf-tile-preview-missing"),
  ).toBeVisible();
  const rowResponses = versionPaths.map((path) =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === path,
    ),
  );
  await openVersionHistory(page, id);
  for (const response of rowResponses)
    expect((await response).status()).toBe(200);
  for (const n of [1, 2, 3]) {
    await expect.poll(() => errorsFor(`version-${n}`)).toBeGreaterThan(0);
    const image = page.getByTestId(`version-${n}`).locator(":scope > img");
    await expect(image).not.toHaveAttribute("src", /./u);
  }
  expect(hits.get(currentPath)).toBeGreaterThanOrEqual(1);
  for (const path of versionPaths)
    expect(hits.get(path)).toBeGreaterThanOrEqual(1);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>("img[src]")]
        .filter((image) => !(image.complete && image.naturalWidth > 0))
        .map((image) => image.src),
    ),
  ).toEqual([]);
  await expectBearers(recorder, { from, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

interface ObserverProbe {
  observers: {
    root: string | null;
    rows: number;
    called: boolean;
    disconnected: boolean;
  }[];
  fetches: Promise<void>[];
}

test("N10f measurement: version list observer root and requests before scrolling", async ({
  page,
  context,
}) => {
  // Records each IntersectionObserver (its root, how many version rows it
  // observes, whether its first callback ran or it was disconnected) and
  // each version preview fetch the page starts. The gate's fetch wraps the
  // page's fetch as it finds it, so this wrapper sees the scoped fetch's
  // requests too.
  await context.addInitScript(() => {
    const probe: ObserverProbe = { observers: [], fetches: [] };
    Object.defineProperty(window, "__observerProbe", { value: probe });
    const Native = window.IntersectionObserver;
    const entries = new WeakMap<
      IntersectionObserver,
      ObserverProbe["observers"][number]
    >();
    window.IntersectionObserver = class extends Native {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        const entry = {
          root:
            options?.root instanceof Element ? options.root.className : null,
          rows: 0,
          called: false,
          disconnected: false,
        };
        super((changes, observer) => {
          entry.called = true;
          callback(changes, observer);
        }, options);
        entries.set(this, entry);
        probe.observers.push(entry);
      }
      override observe(target: Element): void {
        if (target.closest(".version-row")) entries.get(this)!.rows += 1;
        super.observe(target);
      }
      override disconnect(): void {
        entries.get(this)!.disconnected = true;
        super.disconnect();
      }
    };
    const nativeFetch = window.fetch;
    window.fetch = function (
      this: unknown,
      ...args: Parameters<typeof fetch>
    ): Promise<globalThis.Response> {
      const [input] = args;
      const url = input instanceof Request ? input.url : String(input);
      const started = nativeFetch.apply(this, args);
      if (/\/versions\/[^/]+\/preview\.svg/u.test(url))
        probe.fetches.push(
          started.then(
            () => {},
            () => {},
          ),
        );
      return started;
    };
  });
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  const { id } = await projectWithThreeVersions(alice, `Measured ${hex()}`);
  await signIn(page, alice);
  const measurements: unknown[] = [];
  for (const height of [200, 420]) {
    const viewport = await recorder.mark(`1280x${height} open`);
    await page.setViewportSize({ width: 1280, height });
    await openNotebookEditor(page);
    await openShelfWall(page);
    const from = await recorder.mark(`1280x${height}`);
    await openVersionHistory(page, id);
    // The rows, each with its placeholder or image: however many previews
    // load before scrolling (an accepted limit today, PR 114), this waits
    // only for the observers' first evaluation, not for any preview.
    for (const n of [1, 2, 3])
      await expect(
        page.getByTestId(`version-${n}`).locator(":scope > img"),
      ).toBeAttached();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    // Every row is accounted for (observed, or its preview already asked
    // for) and every observer of a row has had its first callback.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const probe = (
            window as unknown as { __observerProbe: ObserverProbe }
          ).__observerProbe;
          const rowObservers = probe.observers.filter(
            (observer) => observer.rows > 0,
          );
          const observed = rowObservers.reduce(
            (sum, observer) => sum + observer.rows,
            0,
          );
          const placeholders = document.querySelectorAll(
            ".version-row > img:not([src])",
          ).length;
          return (
            (placeholders === 0 || observed + probe.fetches.length >= 3) &&
            rowObservers.every(
              (observer) => observer.called || observer.disconnected,
            )
          );
        }),
      )
      .toBe(true);
    // The fetches those first callbacks started have finished.
    const started = await page.evaluate(async () => {
      const probe = (window as unknown as { __observerProbe: ObserverProbe })
        .__observerProbe;
      await Promise.all(probe.fetches);
      return probe.fetches.length;
    });
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector)!;
        return {
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      };
      return {
        list: box(".version-list"),
        dialog: box(".version-history-dialog"),
        rows: [1, 2, 3].map((n) => {
          const rect = document
            .querySelector(`[data-testid='version-${n}']`)!
            .getBoundingClientRect();
          return {
            n,
            top: Math.round(rect.top),
            height: Math.round(rect.height),
          };
        }),
        rowObserverRoots: (
          window as unknown as { __observerProbe: ObserverProbe }
        ).__observerProbe.observers
          .filter((observer) => observer.rows > 0)
          .map((observer) => observer.root),
        allObserverRoots: (
          window as unknown as { __observerProbe: ObserverProbe }
        ).__observerProbe.observers.map((observer) => observer.root),
      };
    });
    const requested = recorder
      .between(from)
      .filter((record) => /\/versions\/[^/]+\/preview\.svg$/u.test(record.url))
      .map((record) => decodeURIComponent(record.url.split("/versions/")[1]!));
    // A measurement: the count is recorded, not required.
    expect(requested.length).toBeGreaterThanOrEqual(0);
    expect(requested.length).toBeLessThanOrEqual(3);
    // Whatever was requested carried exactly Alice's bearer (browser and
    // wire), as did everything else this viewport's phase sent.
    const end = await recorder.mark(`1280x${height} end`);
    await expectBearers(recorder, {
      from: viewport,
      to: end,
      source: page,
      user: alice,
    });
    measurements.push({
      viewport: `1280x${height}`,
      ...layout,
      fetchesStartedInPage: started,
      requested,
    });
  }
  test.info().annotations.push({
    type: "N10f measurements",
    description: JSON.stringify(measurements),
  });
  expectNoForeignOrigin(recorder.records);
});

type RecoveryCopy = {
  workingCopyId: string;
  projectName: string;
  generation: string;
  unsavedAtSnapshot: boolean;
  documentRevisions: Record<string, number>;
  topDocumentId: string;
  projectText: string;
};

const copies = (page: Page, user: NotebookUser) =>
  rawRecords<RecoveryCopy>(
    page,
    prefix(user) + RECOVERY_DATABASE,
    "browser-recovery-v2",
  );

async function expectMountedNamespace(page: Page, user: NotebookUser) {
  const p = prefix(user);
  await expect
    .poll(() => documentTrace(page))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "mark",
          name: "auto-canvas:notebook-commit",
        }),
        expect.objectContaining({
          op: "getItem",
          area: "local",
          name: p + "icm.editor-mode.v1",
        }),
        expect.objectContaining({
          op: "getItem",
          area: "session",
          name: p + WORKING_COPY_KEY,
        }),
        expect.objectContaining({ op: "open", name: p + RECOVERY_DATABASE }),
        expect.objectContaining({
          op: "transaction",
          name: p + WORKSPACE_DATABASE,
        }),
        expect.objectContaining({
          op: "request",
          name: expect.stringContaining(p + "analog-canvas-window:"),
        }),
      ]),
    );
  checkNamespace(await documentTrace(page), user);
}

async function drawCopy(
  page: Page,
  user: NotebookUser,
  name: string = user.id,
) {
  await renameProject(page, name);
  await placeMeaningfulDrawing(page);
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect
    .poll(async () =>
      (await copies(page, user)).some(
        (r) =>
          r.projectName === name &&
          r.generation === "latest" &&
          r.unsavedAtSnapshot &&
          r.documentRevisions[r.topDocumentId] === 3,
      ),
    )
    .toBe(true);
}

async function closedDrawing(writer: Page, user: NotebookUser) {
  await seedDraw(writer, user);
  await writeTokenFrom(writer, user);
  const tab = await writer.context().newPage();
  await openNotebookEditor(tab);
  await drawCopy(tab, user);
  await expectMountedNamespace(tab, user);
  await tab.close({ runBeforeUnload: false });
}

async function recover(page: Page) {
  await clickCommand(page, "File", "Recover Unsaved Work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function switchUser(editor: Page, writer: Page, user: NotebookUser) {
  const response = nextAuthMe(editor, user);
  await writeTokenFrom(writer, user);
  expect((await response).status()).toBe(200);
  await editor.getByTestId("schematic-canvas").waitFor();
}

for (const [title, own] of [
  ["S1a Bob reads his Draw preference", true],
  ["S1b Bob ignores legacy and Alice Draw preferences", false],
] as const)
  test(title, async ({ page }) => {
    const bob = newUser("bob");
    await page.goto("/");
    await page.evaluate(() =>
      window.__nb.remove(window.__nb.local, "icm.editor-mode.v1"),
    );
    if (own) await seedDraw(page, bob);
    else {
      await seedDraw(page, newUser("alice"));
      await page.evaluate(() =>
        window.__nb.write(window.__nb.local, "icm.editor-mode.v1", "draw"),
      );
    }
    await writeTokenFrom(page, bob);
    await openNotebookEditor(page);
    await expect(
      page.getByTestId(own ? "mode-draw" : "mode-auto"),
    ).toHaveAttribute("aria-pressed", "true");
    const events = await documentTrace(page);
    await expectMountedNamespace(page, bob);
    expect(events).toContainEqual(
      expect.objectContaining({
        op: "getItem",
        area: "local",
        name: prefix(bob) + "icm.editor-mode.v1",
      }),
    );
  });

test("S1c discarding Bob's copy preserves Alice and legacy recovery", async ({
  page,
  context,
}) => {
  const alice = newUser("alice"),
    bob = newUser("bob");
  await page.goto("/");
  const legacy = await seedSingleUserRecovery(page);
  const legacyText = (JSON.parse(legacy.records[0]!) as RecoveryCopy)
    .projectText;
  await page.evaluate(
    (text) => window.__nb.write(window.__nb.local, "icm.recovery.v1", text),
    legacyText,
  );
  await closedDrawing(page, alice);
  const original = await copies(page, alice);
  expect(original.length).toBeGreaterThan(0);
  await closedDrawing(page, bob);
  const editor = await context.newPage();
  await openNotebookEditor(editor);
  const dialog = await recover(editor);
  await dialog
    .getByRole("button", { name: "Delete recovery copy of " + bob.id })
    .click();
  await expect
    .poll(async () =>
      (await copies(editor, bob)).filter((r) => r.projectName === bob.id),
    )
    .toEqual([]);
  expect(await copies(editor, alice)).toEqual(original);
  expect(await readSingleUserRecovery(page)).toEqual(legacy);
  expect(
    await editor.evaluate(() =>
      window.__nb.read(window.__nb.local, "icm.recovery.v1"),
    ),
  ).toBe(legacyText);
  await expectMountedNamespace(editor, bob);
  const events = await documentTrace(editor);
  for (const signature of [
    { op: "getItem", area: "local", name: prefix(bob) + "icm.recovery.v1" },
    { op: "getItem", area: "session", name: prefix(bob) + WORKING_COPY_KEY },
    { op: "delete", name: prefix(bob) + RECOVERY_DATABASE },
    { op: "transaction", name: prefix(bob) + WORKSPACE_DATABASE },
  ])
    expect(events).toContainEqual(expect.objectContaining(signature));
});

test("S1 control rejects an unprefixed write on the recorded path", async ({
  page,
}) => {
  const bob = newUser("bob");
  await signIn(page, bob);
  await openNotebookEditor(page);
  const before = await documentTrace(page);
  checkNamespace(before, bob);
  expect(before).toContainEqual(
    expect.objectContaining({
      op: "getItem",
      name: prefix(bob) + "icm.editor-mode.v1",
    }),
  );
  await page.evaluate(() =>
    Storage.prototype.setItem.call(window.__nb.local, "icm.control", "bad"),
  );
  const control = await documentTrace(page);
  expect(() => checkNamespace(control, bob)).toThrow(
    "setItem outside namespace: icm.control",
  );
});

function holdLock(page: Page, name: string) {
  return page.evaluate(
    (lock) =>
      new Promise<void>((acquired) => {
        const raw = window.__nb;
        void Reflect.apply(raw.request, raw.locks, [
          lock,
          () => {
            acquired();
            return new Promise<void>(() => {});
          },
        ]);
      }),
    name,
  );
}

for (const [title, owner] of [
  ["L1a Alice's held workspace lock suppresses reopening", "alice"],
  ["L1b Bob's held workspace lock permits reopening", "bob"],
  ["L1c a legacy workspace lock permits reopening", "legacy"],
] as const)
  test(title, async ({ page, context }) => {
    const alice = newUser("alice"),
      bob = newUser("bob");
    await signIn(page, alice);
    await seedSingleUserRecovery(page);
    const fallbackName = `unlocked-${hex()}`;
    if (owner === "alice") {
      // An older unlocked workspace gives L1a an observable reopen decision so
      // suppression of the newer locked w-test cannot pass before the IDB read
      // and React render settle.
      const fallback = await context.newPage();
      await fallback.goto("/");
      await fallback.evaluate(
        (p) =>
          window.__nb.write(
            window.__nb.session,
            p + "icm.workspace-window.v1",
            "w-fallback",
          ),
        prefix(alice),
      );
      await openNotebookEditor(fallback);
      await drawCopy(fallback, alice, fallbackName);
      await expect
        .poll(() =>
          rawRecords(fallback, prefix(alice) + WORKSPACE_DATABASE, "windows"),
        )
        .toContainEqual(
          expect.objectContaining({
            windowId: "w-fallback",
            tabs: expect.arrayContaining([
              expect.objectContaining({
                session: expect.objectContaining({ dirty: true }),
              }),
            ]),
          }),
        );
      await fallback.close({ runBeforeUnload: false });
    }
    const old = await context.newPage();
    await old.goto("/");
    await old.evaluate(
      (p) =>
        window.__nb.write(
          window.__nb.session,
          p + "icm.workspace-window.v1",
          "w-test",
        ),
      prefix(alice),
    );
    await openNotebookEditor(old);
    await drawCopy(old, alice);
    await expect
      .poll(() =>
        rawRecords(old, prefix(alice) + WORKSPACE_DATABASE, "windows"),
      )
      .toContainEqual(
        expect.objectContaining({
          windowId: "w-test",
          tabs: expect.arrayContaining([
            expect.objectContaining({
              session: expect.objectContaining({ dirty: true }),
            }),
          ]),
        }),
      );
    await old.close({ runBeforeUnload: false });
    const logical = "analog-canvas-window:w-test";
    await holdLock(
      page,
      (owner === "alice" ? prefix(alice) : owner === "bob" ? prefix(bob) : "") +
        logical,
    );
    const editor = await context.newPage();
    await openNotebookEditor(editor);
    await expect
      .poll(() => documentTrace(editor))
      .toContainEqual(expect.objectContaining({ op: "query" }));
    const events = await documentTrace(editor);
    checkNamespace(events, alice);
    const windowKey = prefix(alice) + "icm.workspace-window.v1";
    const id = await editor.evaluate(
      (key) => window.__nb.read(window.__nb.session, key),
      windowKey,
    );
    expect(id).toBeTruthy();
    expect(events).toContainEqual(
      expect.objectContaining({
        op: "request",
        name: prefix(alice) + "analog-canvas-window:" + id,
      }),
    );
    const names = await editor.evaluate(async () =>
      (await navigator.locks.query()).held?.map((l) => l.name).sort(),
    );
    expect(names).toEqual(
      [
        ...(owner === "alice" ? [logical] : []),
        "analog-canvas-window:" + id,
      ].sort(),
    );
    const banner = editor.getByTestId("workspace-reopen-banner");
    if (owner === "alice") {
      // Wait for the reopen decision to render the older unlocked workspace,
      // then verify the newer locked w-test was excluded.
      await expect(banner).toContainText(fallbackName);
      await expect(banner).not.toContainText(alice.id);
    } else await expect(banner).toContainText(alice.id);
    // The facade returns logical database names; the raw origin also has
    // the single-user recovery database seeded in the helper tab.
    const physical = await editor.evaluate(() => window.__nb.list());
    expect(physical.map((db) => db.name)).toContain(RECOVERY_DATABASE);
    const visible = await editor.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name).sort(),
    );
    expect(visible).toEqual(
      physical
        .flatMap((db) =>
          db.name?.startsWith(prefix(alice))
            ? [db.name.slice(prefix(alice).length)]
            : [],
        )
        .sort(),
    );
    // Exercise the nameless Storage operations after taking all product
    // observations. Put a foreign and a legacy control in this tab itself.
    const enumeration = await editor.evaluate(
      ([own, foreign]) => {
        const raw = window.__nb;
        const area = raw.session;
        raw.write(area, foreign + "sentinel", "foreign");
        raw.write(area, "sentinel", "legacy");
        const physicalKeys = () =>
          Array.from(
            { length: Reflect.apply(raw.length, area, []) as number },
            (_, i) => Reflect.apply(raw.key, area, [i]) as string,
          );
        const expected = physicalKeys()
          .filter((k) => k.startsWith(own))
          .map((k) => k.slice(own.length))
          .sort();
        const actual = Array.from({ length: sessionStorage.length }, (_, i) =>
          sessionStorage.key(i),
        ).sort();
        sessionStorage.clear();
        return {
          expected,
          actual,
          remaining: physicalKeys().filter((k) => k.startsWith(own)),
          foreign: raw.read(area, foreign + "sentinel"),
          legacy: raw.read(area, "sentinel"),
        };
      },
      [prefix(alice), prefix(bob)] as const,
    );
    expect(enumeration.expected).toContain("icm.workspace-window.v1");
    expect(enumeration.actual).toEqual(enumeration.expected);
    expect(enumeration).toMatchObject({
      remaining: [],
      foreign: "foreign",
      legacy: "legacy",
    });
  });

test("R1 Alice restores revision three after tab loss", async ({
  page,
  context,
}) => {
  const alice = newUser("alice");
  await page.goto("/");
  await closedDrawing(page, alice);
  const editor = await context.newPage();
  await openNotebookEditor(editor);
  const dialog = await recover(editor);
  await dialog
    .getByRole("button", { name: "Restore " + alice.id, exact: true })
    .click();
  await expect(editor.getByTestId("revision")).toHaveText("3");
});

test("R1-Bob manual recovery lists only Bob's drawing", async ({
  page,
  context,
}) => {
  const alice = newUser("alice"),
    bob = newUser("bob");
  await page.goto("/");
  await closedDrawing(page, alice);
  await closedDrawing(page, bob);
  const editor = await context.newPage();
  await openNotebookEditor(editor);
  const dialog = await recover(editor);
  await expect(dialog.getByText(bob.id, { exact: true })).toBeVisible();
  await expect(dialog.getByText(alice.id, { exact: true })).toHaveCount(0);
});

test("R2 the same tab offers startup recovery only to its original user", async ({
  page,
  context,
}) => {
  const alice = newUser("alice"),
    bob = newUser("bob");
  const writer = await context.newPage();
  await writer.goto("/");
  await closedDrawing(writer, bob);
  await signIn(page, alice);
  await openNotebookEditor(page);
  await drawCopy(page, alice);
  await switchUser(page, writer, bob);
  await openNotebookEditor(page, "/canvas/editor?recovery=meaningful");
  const dialog = await recover(page);
  await expect(dialog.getByText(bob.id, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const banner = page.getByTestId("startup-recovery-banner");
  await expect(banner).toHaveCount(0);
  await switchUser(page, writer, alice);
  await expect(banner).toContainText(alice.id);
  await banner.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("revision")).toHaveText("3");
});

function committedPut(
  events: StorageEventRecord[],
  name: string,
  revision: number,
) {
  return events.some(
    (put) =>
      put.op === "put" &&
      put.name === name &&
      put.revision === revision &&
      events.some(
        (end) =>
          end.op === "complete" &&
          end.doc === put.doc &&
          end.txId === put.txId &&
          end.seq > put.seq,
      ),
  );
}

// Keep the transaction in a separate, non-editor document. It survives the
// deadline reload and cannot itself contribute a put or completion to the trace.
async function holdWorkspace(writer: Page, user: NotebookUser) {
  const handle = await writer.evaluateHandle(
    async (name) => {
      const raw = window.__nb;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = raw.openDB(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = raw.tx(db, "windows", "readwrite");
      const store = tx.objectStore("windows");
      let held = true;
      await new Promise<void>((resolve, reject) => {
        function next() {
          const req = Reflect.apply(raw.get, store, ["hold"]);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            resolve();
            if (held) next();
          };
        }
        next();
      });
      return () => {
        held = false;
        db.close();
      };
    },
    prefix(user) + WORKSPACE_DATABASE,
  );
  return () => handle.evaluate((release) => release());
}

for (const [title, deadline] of [
  ["R3 an account change drains Alice's pending revision before reload", false],
  ["R3 deadline reloads while Alice's workspace transaction is held", true],
] as const)
  test(title, async ({ page, context }) => {
    const alice = newUser("alice"),
      bob = newUser("bob");
    const writer = await context.newPage();
    await writer.goto("/");
    // A different route in this very window leaves Bob a discoverable copy
    // without creating a closed Bob window that should legitimately be offered.
    await signIn(page, bob);
    await openNotebookEditor(page, "/canvas/editor?recovery=bob");
    await drawCopy(page, bob);
    await signIn(page, alice);
    await openNotebookEditor(page);
    // A clean three-part project makes the first edit arm the leave prompt.
    await openProjectFile(page, threeResistorProject(alice.id));
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
    await placeComponent(page, "resistor", { x: 325, y: 220 });
    await expect(page.getByTestId("revision")).toHaveText("1");
    const workspace = prefix(alice) + WORKSPACE_DATABASE,
      recovery = prefix(alice) + RECOVERY_DATABASE;
    await expect
      .poll(async () => {
        const events = await documentTrace(page);
        return [workspace, recovery].every((db) => committedPut(events, db, 1));
      })
      .toBe(true);
    const dialogs = recordDialogs(page);
    await page.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    });
    await expect.poll(() => dialogs.types).toEqual(["beforeunload"]);
    const release = await holdWorkspace(writer, alice);
    await page.bringToFront();
    await chooseComponent(page, "resistor");
    const doc = await page.evaluate(() => window.__nb.doc);
    const navigations: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        navigations.push(request.url());
    });
    await page.evaluate(() => {
      document.addEventListener(
        "pointerdown",
        () => performance.mark("edit-two"),
        { capture: true, once: true },
      );
    });
    const identified = nextAuthMe(page, bob);
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 455, y: 260 } });
    await writeTokenFrom(writer, bob);
    await expect(page.getByTestId("notebook-account-changed")).toBeVisible();
    await expect(page.getByTestId("schematic-canvas")).toHaveCount(0);
    expect(navigations).toEqual([]);
    if (deadline) await new Promise((resolve) => setTimeout(resolve, 5000));
    await release();
    expect((await identified).status()).toBe(200);
    await page.getByTestId("schematic-canvas").waitFor();
    const events = (await trace(page)).filter((e) => e.doc === doc);
    checkNamespace(events, alice);
    const edit = events.find((e) => e.name === "edit-two")!;
    const switched = events.find(
      (e) => e.op === "storage" && e.name === TOKEN_KEY && e.seq > edit.seq,
    )!;
    const reload = events.find(
      (e) => e.name === "auto-canvas:notebook-reload",
    )!;
    expect(switched.time - edit.time).toBeLessThan(400);
    expect(
      events.filter(
        (e) =>
          e.seq >= edit.seq &&
          e.seq < switched.seq &&
          ((e.op === "visibilitychange" && e.name === "hidden") ||
            (e.op === "put" && e.name === recovery && e.revision === 2)),
      ),
    ).toEqual([]);
    const drain = events.filter((e) => e.seq < reload.seq);
    expect(committedPut(drain, recovery, 2)).toBe(true);
    expect(committedPut(drain, workspace, 2)).toBe(!deadline);
    expect(dialogs.types).toEqual(["beforeunload"]);
    if (deadline) {
      expect(reload.time - switched.time).toBeGreaterThanOrEqual(2950);
      expect(reload.time - switched.time).toBeLessThan(5000);
      return;
    }
    await expect(page.getByTestId("active-instance-count")).toHaveText("0");
    const dialog = await recover(page);
    await expect(
      dialog.getByText(bob.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog.getByText(alice.id, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("workspace-reopen-banner")).toHaveCount(0);
    await page.close();
    await writeTokenFrom(writer, alice);
    const fresh = await context.newPage();
    await openNotebookEditor(fresh);
    const aliceDialog = await recover(fresh);
    await expect(
      aliceDialog
        .getByTestId("recovery-session-card")
        .filter({ hasText: alice.id })
        .locator("dd")
        .first(),
    ).toContainText("revision 2");
    await fresh.keyboard.press("Escape");
    await fresh
      .getByTestId("workspace-reopen-banner")
      .getByRole("button", { name: "Reopen tabs" })
      .click();
    await expect(fresh.getByTestId("revision")).toHaveText("2");
  });

test("R4 Bob can publish a component with an interrupted Alice publication", async ({
  page,
  context,
}) => {
  const alice = newUser("alice"),
    bob = newUser("bob");
  await signIn(page, alice);
  const writer = await context.newPage();
  await writer.goto("/");
  await openNotebookEditor(page);
  await openUserComponents(page);
  const library = page.getByRole("dialog", {
    name: "User Components",
    exact: true,
  });
  await library.getByRole("button", { name: "Create Component…" }).click();
  const editor = page.getByRole("dialog", {
    name: "Edit Component Definition",
    exact: true,
  });
  await editor
    .getByLabel("Definition type", { exact: true })
    .selectOption("json");
  const definition = newComponentDefinition();
  definition.symbol.name = alice.id;
  await editor
    .getByRole("textbox", { name: "Component definition code" })
    .fill(JSON.stringify(definition, null, 2));
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  const publish = editor.getByRole("button", {
    name: /^(Publish|Update my component)$/u,
  });
  const pattern = "**/canvas/api/components/*";
  await page.route(pattern, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  const failed = page.waitForEvent("requestfailed", {
    predicate: (r) =>
      r.method() === "PUT" && r.url().includes("/api/components/"),
  });
  await publish.click();
  const request = await failed;
  const componentId = new URL(request.url()).pathname.split("/").at(-1)!;
  const journal = () =>
    rawRecords(
      page,
      prefix(alice) + "analog-canvas-component-publication",
      "operations",
    );
  await expectMountedNamespace(page, alice);
  const pending = await journal();
  expect(pending).toEqual([
    expect.objectContaining({
      pending: true,
      componentId,
      accountId: alice.id,
    }),
  ]);
  await editor.getByLabel("Close component editor").click();
  const leave = editor.getByRole("button", {
    name: "Discard changes",
    exact: true,
  });
  if (await leave.isVisible()) await leave.click();
  await expect(editor).toBeHidden();
  if (await library.isVisible())
    await library.getByRole("button", { name: "Close", exact: true }).click();
  const file = await downloadBytes(page, "File", "Export Project File…");
  await page.unroute(pattern);
  await switchUser(page, writer, bob);
  await openProjectFile(page, file);
  await openUserComponents(page);
  await library.getByRole("tab", { name: "My shelf", exact: true }).click();
  await library
    .getByRole("tab", { name: "Project drafts", exact: true })
    .click();
  await library
    .locator(".component-draft-name")
    .filter({ hasText: alice.id })
    .click();
  const published = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url() === request.url(),
  );
  await publish.click();
  const response = await published;
  expect(response.request().headers().authorization).toBe(bob.bearer);
  expect(response.status()).toBe(200);
  await expect(
    page.getByText(
      /Resolve the original publication with its original account/u,
    ),
  ).toHaveCount(0);
  const publishedEvents = await documentTrace(page);
  checkNamespace(publishedEvents, bob);
  expect(publishedEvents).toContainEqual(
    expect.objectContaining({
      op: "put",
      name: prefix(bob) + "analog-canvas-component-publication",
      store: "operations",
    }),
  );
  expect(await journal()).toEqual(pending);
});

test("R5 Bob ignores Alice's recent cloud project in the same tab", async ({
  page,
  context,
}) => {
  const alice = newUser("alice"),
    bob = newUser("bob");
  const writer = await context.newPage();
  await writer.goto("/");
  await closedDrawing(writer, bob);
  await signIn(page, alice);
  const id = await createProjectAs(alice, alice.id);
  await openNotebookEditor(page);
  const shelf = await projectTabAction(page, "Open Cloud Project…");
  await shelf.getByRole("button", { name: alice.id, exact: true }).click();
  const key = "analog-canvas.recent-cloud-project.v1";
  const binding = () =>
    page.evaluate(
      (k) => window.__nb.read(window.__nb.session, k),
      prefix(alice) + key,
    );
  await expect.poll(binding).toBe(id);
  expect(new URL(page.url()).search).toBe("");
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  const listing = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/canvas/api/projects" &&
      r.request().method() === "GET" &&
      r.request().headers().authorization === bob.bearer,
  );
  await switchUser(page, writer, bob);
  await openShelfWall(page);
  expect((await listing).status()).toBe(200);
  await page.keyboard.press("Escape");
  const dialog = await recover(page);
  await expect(dialog.getByText(bob.id, { exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  const events = await documentTrace(page);
  checkNamespace(events, bob);
  expect(events).toContainEqual(
    expect.objectContaining({
      op: "getItem",
      name: prefix(bob) + key,
      area: "session",
    }),
  );
  expect(urls.filter((url) => url.includes(id))).toEqual([]);
  expect(await binding()).toBe(id);
});

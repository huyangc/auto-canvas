// The notebook build's service worker, the HTTP cache and offline
// navigation (T162c, N7 and N9). The service worker runs here
// (`serviceWorkers: "allow"`), and no case of this file routes any request:
// a route on a context turns off its HTTP cache, which N7 needs.
import { createHash } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type Page,
  type Response,
} from "@playwright/test";
import {
  cacheStorageUrls,
  createProjectAs,
  expectBearers,
  expectNoApiRequest,
  expectNoForeignOrigin,
  fixture,
  instrumentStorage,
  newUser,
  nextAuthMe,
  nextLoad,
  notebookSuite,
  openNotebookEditor,
  openShelfWall,
  openVersionHistory,
  origin,
  readProbe,
  readSingleUserRecovery,
  recordRequests,
  seedSingleUserRecovery,
  signIn,
  TOKEN_KEY,
  updateProjectAs,
  writeTokenFrom,
  type LogEntry,
  type Mark,
  type ProbeEntry,
  type RequestRecorder,
} from "./notebook-fixtures.js";

// No trace: the trace recorder fetches previews again (notebookSuite).
test.use({ serviceWorkers: "allow", trace: "off" });
notebookSuite();

const SEED_MARKER = "SINGLE-USER-SEED";
/** What a standalone server answers for a current preview (projects.ts). */
const STANDALONE_PREVIEW_CACHE = "private, max-age=31536000, immutable";
const scope = `${origin}/canvas/`;
const workerScript = `${origin}/canvas/sw.js`;

const hex = () => Math.random().toString(16).slice(2, 10);
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function seedSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="4" y="24">${SEED_MARKER} ${label}</text></svg>`;
}

/** The registration for `/canvas/` and the page's controller. */
function workerState(
  page: Page,
): Promise<{ scope: string | null; controller: string | null }> {
  return page.evaluate(async () => ({
    scope:
      (await navigator.serviceWorker.getRegistration("/canvas/"))?.scope ??
      null,
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
  }));
}

/**
 * Opens the editor, waits for the service worker to be active and reloads,
 * so the document is controlled from then on (the worker never claims
 * clients). Returns the window of installation and the controlled reload.
 */
async function controlEditor(
  page: Page,
  recorder: RequestRecorder,
): Promise<{ from: Mark; to: Mark }> {
  const from = await recorder.mark("install");
  await openNotebookEditor(page);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.ready).scope,
    ),
  ).toBe(scope);
  await page.reload();
  await page.getByTestId("schematic-canvas").waitFor();
  expect(await workerState(page)).toEqual({
    scope,
    controller: workerScript,
  });
  const to = await recorder.mark("controlled");
  return { from, to };
}

/** Cache Storage holds nothing under the canvas API. */
async function expectNoApiInCacheStorage(page: Page): Promise<string[]> {
  const urls = await cacheStorageUrls(page);
  expect(
    urls.filter((url) => new URL(url).pathname.startsWith("/canvas/api")),
  ).toEqual([]);
  return urls;
}

/**
 * Alice's preview URLs exactly as the editor requests them, read from the
 * fixture log while a throwaway context opens her Shelf and history.
 */
async function discoverPreviewUrls(
  browser: Browser,
  alice: ReturnType<typeof newUser>,
  projectId: string,
): Promise<{ current: string; history: string }> {
  const discovery = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
    storageState: {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            { name: "icm.editor-mode.v1", value: "draw" },
            { name: "icm.editor-mode-coach.v1", value: "seen" },
          ],
        },
      ],
    },
  });
  try {
    const page = await discovery.newPage();
    const from = await fixture.seq();
    await signIn(page, alice);
    await openNotebookEditor(page);
    await openShelfWall(page);
    await expect(
      page.getByTestId(`shelf-tile-${projectId}`).locator("img"),
    ).toHaveAttribute("src", /^blob:/u);
    await openVersionHistory(page, projectId);
    await expect(page.getByTestId("version-1").locator("img")).toHaveAttribute(
      "src",
      /^blob:/u,
    );
    const log = await fixture.log(from + 1);
    const current = log.find((entry) =>
      entry.path.startsWith(
        `/canvas/api/projects/${encodeURIComponent(projectId)}/preview.svg?`,
      ),
    );
    const history = log.find(
      (entry) =>
        entry.path.startsWith(
          `/canvas/api/projects/${encodeURIComponent(projectId)}/versions/`,
        ) && /\/preview\.svg$/u.test(entry.path),
    );
    expect(current, "the current preview request").toBeDefined();
    expect(history, "the history preview request").toBeDefined();
    return {
      current: `${origin}${current!.path}`,
      history: `${origin}${history!.path}`,
    };
  } finally {
    await discovery.close();
  }
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

function logFor(entries: LogEntry[], url: string): LogEntry[] {
  return entries.filter((entry) => entry.path === pathOf(url));
}

test("N7 previews never come from the HTTP cache or the service worker, and Bob never sees Alice's previews", async ({
  page,
  context,
  browser,
}) => {
  // D: a Project with a current preview and one version, and the exact
  // URLs the editor asks for.
  const alice = newUser("alice");
  const bob = newUser("bob");
  const projectId = await createProjectAs(alice, `Alice cached ${hex()}`);
  expect(await updateProjectAs(alice, projectId, 1, `Alice cached r2`)).toBe(2);
  const urls = await discoverPreviewUrls(browser, alice, projectId);
  expect(new URL(urls.current).searchParams.get("v")).toBe("2");

  // S: what a single-user canvas could have left at the same URLs. A
  // reference to the native fetch, saved before any page script; nothing
  // is replaced.
  await context.addInitScript(() => {
    Object.defineProperty(window, "__nativeFetch", {
      value: window.fetch.bind(window),
    });
  });
  const recorder = recordRequests(context);
  const responses: Response[] = [];
  context.on("response", (response) => {
    if (/\/preview\.svg(?:\?|$)/u.test(response.url()))
      responses.push(response);
  });
  await signIn(page, alice);
  const seedFrom = await recorder.mark("seed");
  const seeded = {
    current: seedSvg("current"),
    // Synthetic: no real server sends an immutable history preview.
    history: seedSvg("history (synthetic)"),
  };
  for (const key of ["current", "history"] as const)
    await fixture.seed({
      url: urls[key],
      body: seeded[key],
      contentType: "image/svg+xml",
      cacheControl: STANDALONE_PREVIEW_CACHE,
    });
  expect(
    await page.evaluate(
      (sources) =>
        Promise.all(
          sources.map(
            (source) =>
              new Promise<number>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image.naturalWidth);
                image.onerror = () => reject(new Error(`seed ${source}`));
                image.src = source;
              }),
          ),
        ),
      [urls.current, urls.history],
    ),
  ).toEqual([120, 120]);
  for (const key of ["current", "history"] as const)
    await fixture.unseed(urls[key]);
  const seedTo = await recorder.mark("seeded");
  const seedLog = await fixture.log(seedFrom.seq + 1, seedTo.seq);
  for (const key of ["current", "history"] as const)
    expect(
      logFor(seedLog, urls[key]).map((entry) => [entry.seeded, entry.status]),
    ).toEqual([[true, 200]]);
  const exempt = [
    { from: seedFrom, to: seedTo, url: urls.current },
    { from: seedFrom, to: seedTo, url: urls.history },
  ];

  // C: a controlled editor document. The native fetch with the product's
  // settings except the cache mode takes the seed from the HTTP cache.
  const install = await controlEditor(page, recorder);
  const controlFrom = await recorder.mark("control");
  const control = await page.evaluate(
    async ({ sources, bearer, marker }) => {
      const native = (window as unknown as { __nativeFetch: typeof fetch })
        .__nativeFetch;
      const results: { status: number; seed: boolean }[] = [];
      for (const source of sources) {
        const response = await native(source, {
          headers: { Authorization: bearer },
          credentials: "omit",
          redirect: "error",
        });
        results.push({
          status: response.status,
          seed: (await response.text()).includes(marker),
        });
      }
      return results;
    },
    {
      sources: [urls.current, urls.history],
      bearer: alice.bearer,
      marker: SEED_MARKER,
    },
  );
  const controlTo = await recorder.mark("control end");
  const controlLog = await fixture.log(controlFrom.seq + 1, controlTo.seq);
  const controlHits = {
    current: logFor(controlLog, urls.current).length,
    history: logFor(controlLog, urls.history).length,
  };
  const reused = control[0]!.seed;
  test.info().annotations.push({
    type: "N7 control",
    description: JSON.stringify({
      path: reused ? "http-cache reuse" : "no-store fallback",
      current: control[0],
      historySynthetic: control[1],
      wireHits: controlHits,
    }),
  });
  let cacheModes: string[] | null = null;
  if (reused) {
    // The entry is there and a default-cache request takes it from the
    // cache: nothing for that URL reached the wire.
    expect(control[0]).toEqual({ status: 200, seed: true });
    expect(controlHits.current).toBe(0);
  } else {
    // This Chrome did not reuse the entry: record instead the cache mode
    // of the Request the scoped fetch hands to its native fetch (an init
    // script's wrapper, installed before the page's scripts, is that
    // native fetch).
    await context.addInitScript(() => {
      const modes: string[] = [];
      Object.defineProperty(window, "__previewCacheModes", { value: modes });
      const original = window.fetch;
      window.fetch = function (
        this: typeof globalThis,
        input: RequestInfo | URL,
        init?: RequestInit,
      ) {
        if (
          input instanceof Request &&
          /\/preview\.svg(?:\?|$)/u.test(input.url)
        )
          modes.push(input.cache);
        return original.call(this, input, init);
      } as typeof fetch;
    });
    await page.reload();
    await page.getByTestId("schematic-canvas").waitFor();
    expect(await workerState(page)).toEqual({
      scope,
      controller: workerScript,
    });
  }

  // A: the product's Shelf and Version history, with a new boundary.
  const aliceFrom = await recorder.mark("alice");
  const alicePreviews = responses.length;
  await openShelfWall(page);
  const tileImage = page.getByTestId(`shelf-tile-${projectId}`).locator("img");
  await expect(tileImage).toHaveAttribute("src", /^blob:/u);
  await openVersionHistory(page, projectId);
  const versionImage = page.getByTestId("version-1").locator(":scope > img");
  await expect(versionImage).toHaveAttribute("src", /^blob:/u);
  const aliceTo = await recorder.mark("alice end");
  if (!reused) {
    cacheModes = await page.evaluate(
      () =>
        (window as unknown as { __previewCacheModes: string[] })
          .__previewCacheModes,
    );
    expect(cacheModes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(cacheModes)).toEqual(new Set(["no-store"]));
  }
  const aliceLog = await fixture.log(aliceFrom.seq + 1, aliceTo.seq);
  // Measured first, asserted after: the report needs every value. The bytes
  // the browser was sent are the fixture's measurement on the wire;
  // Playwright's `response.body()` is recorded too, as a diagnostic only:
  // for these no-store fetches it was observed to contain the seed marker
  // while the response headers, the wire and the shown image were the
  // server's. Why it does so was not established (it may read the HTTP
  // cache's entry for the URL), so it is not used as the measured response.
  const measured: Record<
    string,
    {
      wire: LogEntry[];
      responses: {
        status: number;
        fromServiceWorker: boolean;
        authorization: string | undefined;
        cacheControl: string | null;
        playwrightBodyIsSeed: boolean;
      }[];
      shown: { blob: boolean; decoded: boolean; sha256: string; seed: boolean };
    }
  > = {};
  for (const [key, image] of [
    ["current", tileImage],
    ["history", versionImage],
  ] as const) {
    const url = urls[key];
    const browserResponses = responses
      .slice(alicePreviews)
      .filter((response) => response.url() === url);
    const bodies = await Promise.all(
      browserResponses.map(async (response) =>
        (await response.body()).toString("utf8"),
      ),
    );
    const shown = await image.evaluate(async (element: HTMLImageElement) => {
      const native = (window as unknown as { __nativeFetch: typeof fetch })
        .__nativeFetch;
      const bytes = new Uint8Array(
        await (await native(element.src)).arrayBuffer(),
      );
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        blob: element.src.startsWith("blob:"),
        decoded: element.complete && element.naturalWidth > 0,
        base64: btoa(binary),
      };
    });
    const shownBytes = Buffer.from(shown.base64, "base64");
    measured[key] = {
      wire: logFor(aliceLog, url),
      responses: browserResponses.map((response, index) => ({
        status: response.status(),
        fromServiceWorker: response.fromServiceWorker(),
        authorization: response.request().headers().authorization,
        cacheControl: response.headers()["cache-control"] ?? null,
        playwrightBodyIsSeed: bodies[index]!.includes(SEED_MARKER),
      })),
      shown: {
        blob: shown.blob,
        decoded: shown.decoded,
        sha256: sha256(shownBytes),
        seed: shownBytes.toString("utf8").includes(SEED_MARKER),
      },
    };
  }
  test.info().annotations.push({
    type: "N7 measured",
    description: JSON.stringify({
      cacheModes,
      seedSha256: {
        current: sha256(Buffer.from(seeded.current)),
        history: sha256(Buffer.from(seeded.history)),
      },
      measured: Object.fromEntries(
        Object.entries(measured).map(([key, value]) => [
          key,
          {
            wire: value.wire.map((entry) => ({
              seq: entry.seq,
              status: entry.status,
              seeded: entry.seeded,
              bearer: entry.authorization === alice.bearer,
              bytes: entry.responseBytes,
              sha256: entry.responseSha256,
            })),
            responses: value.responses.map((response) => ({
              ...response,
              authorization: response.authorization === alice.bearer,
            })),
            shown: value.shown,
          },
        ]),
      ),
    }),
  });
  for (const key of ["current", "history"] as const) {
    const { wire, responses: seen, shown } = measured[key]!;
    expect(wire.length, `${key}: on the wire`).toBeGreaterThanOrEqual(1);
    for (const entry of wire) {
      expect(entry.authorization).toBe(alice.bearer);
      expect(entry.status).toBe(200);
      expect(entry.seeded).toBe(false);
    }
    expect(seen.length, `${key}: a response`).toBeGreaterThanOrEqual(1);
    for (const response of seen) {
      expect(response.fromServiceWorker).toBe(false);
      expect(response.authorization).toBe(alice.bearer);
    }
    expect(shown.blob).toBe(true);
    expect(shown.decoded).toBe(true);
    expect(shown.seed, `${key}: the shown image is the seed`).toBe(false);
    // The shown image is exactly the server's answer on the wire.
    expect(shown.sha256, `${key}: the shown image`).toBe(
      wire.at(-1)!.responseSha256,
    );
    expect(shown.sha256).not.toBe(sha256(Buffer.from(seeded[key])));
  }
  const aliceCache = await expectNoApiInCacheStorage(page);

  // The bearer rule for the page and the worker (the seed's own requests
  // exempt), and the worker's asset requests where they must occur.
  for (const source of [page, "service-worker"] as const)
    await expectBearers(recorder, {
      from: seedFrom,
      to: aliceTo,
      source,
      user: alice,
      exempt,
    });
  const workerRequests = recorder
    .between(install.from, install.to)
    .filter((record) => record.source === "service-worker");
  const workerAssets = workerRequests.filter(
    (record) => !new URL(record.url).pathname.startsWith("/canvas/api"),
  );
  expect(workerAssets.length).toBeGreaterThanOrEqual(1);
  expect(
    workerRequests.filter((record) => record.authorization !== undefined),
  ).toEqual([]);
  await expectBearers(recorder, {
    from: install.from,
    to: install.to,
    source: "service-worker",
    user: alice,
  });
  const aliceWorker = recorder
    .between(aliceFrom, aliceTo)
    .filter((record) => record.source === "service-worker");
  test.info().annotations.push({
    type: "N7 worker requests",
    description: JSON.stringify({
      installAndReload: workerRequests.length,
      installAndReloadAssets: workerAssets.length,
      shelfPhase: aliceWorker.length,
      authorizations: [
        ...new Set(workerRequests.map((record) => record.authorization)),
      ],
      cacheStorage: aliceCache.map((url) => new URL(url).pathname),
    }),
  });

  // B: Bob signs in from another page; the editor reloads into his account.
  const other = await context.newPage();
  await other.goto("/");
  const loaded = nextLoad(page);
  const identified = nextAuthMe(page, bob);
  const reloaded = recorder.markAtNavigation(page, "bob");
  const bobFrom = await recorder.mark("switch");
  await writeTokenFrom(other, bob);
  await loaded;
  expect((await identified).status()).toBe(200);
  const bobPhase = await reloaded;
  await page.getByTestId("schematic-canvas").waitFor();
  const wall = await openShelfWall(page);
  await expect(wall.getByTestId("shelf-empty")).toBeVisible();
  await expect(page.getByTestId(`shelf-actions-${projectId}`)).toHaveCount(0);
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  await expect(page.locator(".version-history-dialog")).toHaveCount(0);
  const bobTo = await recorder.mark("bob end");
  const bobUrls = recorder.between(bobFrom, bobTo).map((record) => record.url);
  const bobLog = await fixture.log(bobFrom.seq + 1, bobTo.seq);
  for (const url of [urls.current, urls.history]) {
    expect(bobUrls).not.toContain(url);
    expect(logFor(bobLog, url)).toEqual([]);
  }
  await expectNoApiInCacheStorage(page);
  for (const source of [page, "service-worker"] as const)
    await expectBearers(recorder, {
      from: bobPhase,
      to: bobTo,
      source,
      user: bob,
    });
  await expectNoApiRequest(recorder, { from: bobFrom, to: bobPhase, page });
  expect(
    bobLog.filter(
      (entry) =>
        entry.marker !== "spec" &&
        entry.path.startsWith("/canvas/api/") &&
        entry.authorization === alice.bearer,
    ),
  ).toEqual([]);
  expectNoForeignOrigin(recorder.records);
});

/** The probe of a gate screen: only the token read, nothing else. */
function expectGateOnlyProbe(probe: ProbeEntry[]): void {
  expect(probe.filter((entry) => entry.area === "idb")).toEqual([]);
  expect(
    probe.filter(
      (entry) =>
        entry.area === "session" ||
        (entry.op === "getItem" && entry.key !== TOKEN_KEY),
    ),
  ).toEqual([]);
  expect(probe.filter((entry) => entry.op === "getItem")).not.toEqual([]);
}

/** Navigations of the editor's path that reached the wire in this window. */
async function editorNavigations(from: Mark, to: Mark): Promise<LogEntry[]> {
  return (await fixture.log(from.seq + 1, to.seq)).filter(
    (entry) =>
      entry.method === "GET" &&
      new URL(entry.path, origin).pathname === "/canvas/editor",
  );
}

test("N9 offline: the cached shell stops at the gate and opens no editor storage", async ({
  page,
  context,
}) => {
  await instrumentStorage(context);
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  await signIn(page, alice);
  const start = await recorder.mark("alice");
  const install = await controlEditor(page, recorder);
  // The filter the offline windows use does see online navigations.
  expect(
    (await editorNavigations(install.from, install.to)).length,
  ).toBeGreaterThanOrEqual(1);
  expect(
    await page.evaluate(async () => Boolean(await caches.match("/canvas/"))),
  ).toBe(true);
  await page.goto("/");
  const seed = await seedSingleUserRecovery(page);
  expect(seed.records.length).toBeGreaterThanOrEqual(1);
  expect(seed.workingCopy).not.toBeNull();
  const observed: Record<string, unknown> = {};
  try {
    // (a) A token: the cached shell, then the gate's error page.
    await context.setOffline(true);
    const offlineA = await recorder.mark("offline, token");
    const withToken = await page.goto("/canvas/editor");
    expect(withToken).not.toBeNull();
    expect(withToken!.ok()).toBe(true);
    expect(withToken!.fromServiceWorker()).toBe(true);
    await expect(page.getByTestId("notebook-error")).toBeVisible();
    // Snapshot before any helper opens IndexedDB in this document.
    const probeA = await readProbe(page);
    expect(await workerState(page)).toEqual({
      scope,
      controller: workerScript,
    });
    expectGateOnlyProbe(probeA);
    const onlineA = await recorder.mark("online");
    await context.setOffline(false);
    expect(await readSingleUserRecovery(page)).toEqual(seed);
    observed.token = {
      status: withToken!.status(),
      fromServiceWorker: withToken!.fromServiceWorker(),
      probe: probeA,
    };

    // (b) No token: the cached shell, then the signed-out page.
    await page.goto("/");
    await writeTokenFrom(page, null);
    await context.setOffline(true);
    const offlineB = await recorder.mark("offline, no token");
    const withoutToken = await page.goto("/canvas/editor");
    expect(withoutToken).not.toBeNull();
    expect(withoutToken!.ok()).toBe(true);
    expect(withoutToken!.fromServiceWorker()).toBe(true);
    await expect(page.getByTestId("notebook-signed-out")).toBeVisible();
    const probeB = await readProbe(page);
    expectGateOnlyProbe(probeB);
    observed.noToken = {
      status: withoutToken!.status(),
      fromServiceWorker: withoutToken!.fromServiceWorker(),
      probe: probeB,
    };

    // (c) `/canvas` is outside the worker's scope: no shell offline.
    let failure = "";
    await page.goto("/canvas").then(
      () => {
        failure = "loaded";
      },
      (error: Error) => {
        failure = error.message;
      },
    );
    expect(failure).toContain("net::ERR_INTERNET_DISCONNECTED");
    await expect(page.locator("[data-testid^='notebook-']")).toHaveCount(0);
    await expect(page.getByTestId("schematic-canvas")).toHaveCount(0);
    const onlineB = await recorder.mark("online again");
    await context.setOffline(false);
    await page.goto("/");
    expect(
      await page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/canvas")) ===
          undefined,
      ),
    ).toBe(true);
    observed.canvasWithoutSlash = failure.split("\n")[0];

    expect(await editorNavigations(offlineA, onlineA)).toEqual([]);
    expect(await editorNavigations(offlineB, onlineB)).toEqual([]);
    observed.offlineLog = {
      token: await fixture.log(offlineA.seq + 1, onlineA.seq),
      noToken: await fixture.log(offlineB.seq + 1, onlineB.seq),
    };
  } finally {
    await context.setOffline(false);
    test.info().annotations.push({
      type: "N9 observed",
      description: JSON.stringify(observed),
    });
  }
  for (const source of [page, "service-worker"] as const)
    await expectBearers(recorder, { from: start, source, user: alice });
  expectNoForeignOrigin(recorder.records);
});

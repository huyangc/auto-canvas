// Helpers of the notebook browser tests (notebook-auth.spec.ts,
// notebook-bfcache.spec.ts): the fixture's control client, notebook users,
// storage and request recorders, and the bearer rule every case checks.
// The run is selected by AUTO_CANVAS_E2E_NOTEBOOK=1 (playwright.config.ts);
// scripts/notebook-e2e-fixture.mjs is the stub notebook, the canvas server
// in notebook mode and the rewriting proxy in front of them.
import { randomBytes } from "node:crypto";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { projectTabAction } from "./editor-fixtures.js";

export const TOKEN_KEY = "silicon_notebook_token";
export const WORKING_COPY_KEY = "icm.working-copy.v1";
export const RECOVERY_DATABASE = "analog-canvas-recovery";
export const WORKSPACE_DATABASE = "analog-canvas-workspaces";
const RECOVERY_STORE = "browser-recovery-v2";
/** The API's two public probes: never carry a bearer, never need one. */
const PUBLIC_PATHS = new Set([
  "/canvas/api/health",
  "/canvas/api/integration/ready.json",
]);
const SPEC_MARKER = { "x-notebook-e2e": "spec" };

export const origin = `http://127.0.0.1:${process.env.ICM_E2E_PORT ?? "4173"}`;

/**
 * Registers the notebook run's per-file hooks: one worker (the cases share
 * the fixture's request log) and a fresh log for each case. Each spec file
 * also sets `serviceWorkers: "block"` (T162c covers the service worker) and
 * `trace: "off"`: Playwright's trace recorder fetches the resources it
 * snapshots again, outside the page and without its headers, so with tracing
 * on the fixture log holds requests no page sent (observed: each preview
 * fetched a second time without Authorization, answered 401).
 */
export function notebookSuite(): void {
  test.beforeAll(() => {
    expect(test.info().config.workers).toBe(1);
  });
  test.beforeEach(async () => {
    await fixture.reset();
  });
}

// ---- The fixture's control endpoints. ----

export interface LogEntry {
  seq: number;
  method: string;
  path: string;
  authorization: string | null;
  marker: string | null;
  status: number | null;
  held: boolean;
}

export interface HeldRequest {
  seq: number;
  method: string;
  path: string;
  bodyBytes: number;
  complete: true;
}

async function control<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${origin}/__fixture/${path}`, {
    method,
    headers: { ...SPEC_MARKER, "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `fixture ${path}: ${response.status} ${await response.text()}`,
    );
  return (await response.json()) as T;
}

export const fixture = {
  async seq(): Promise<number> {
    return (await control<{ seq: number }>("GET", "seq")).seq;
  },
  /** Entries with `from <= seq <= to`. */
  log(from = 0, to?: number): Promise<LogEntry[]> {
    const query = new URLSearchParams({ from: String(from) });
    if (to !== undefined) query.set("to", String(to));
    return control("GET", `log?${query}`);
  },
  async reset(): Promise<void> {
    await control("POST", "reset");
  },
  /** Holds matching requests (pathname, a regular expression) at the proxy. */
  async hold(rule: { method: string; pathPattern: string }): Promise<void> {
    await control("POST", "hold", rule);
  },
  held(): Promise<HeldRequest[]> {
    return control("GET", "held");
  },
  release(): Promise<{ seq: number; status: number }[]> {
    return control("POST", "release");
  },
  async notebook(mode: "up" | "error"): Promise<void> {
    await control("POST", "notebook", { mode });
  },
};

// ---- Users and the API as they see it. ----

export interface NotebookUser {
  id: string;
  token: string;
  bearer: string;
}

/** A user nobody used before: the server caches a token for 60 s. */
export function newUser(label: string): NotebookUser {
  const id = `${label}-${randomBytes(4).toString("hex")}`;
  const token = `nb.${id}`;
  return { id, token, bearer: `Bearer ${token}` };
}

/** The canvas API as this user, from the spec itself (marked in the log). */
export function apiAs(
  user: NotebookUser,
  path: string,
  init: RequestInit = {},
): Promise<globalThis.Response> {
  return fetch(`${origin}/canvas/api/${path}`, {
    ...init,
    headers: {
      ...SPEC_MARKER,
      authorization: user.bearer,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export async function projectNamesOf(user: NotebookUser): Promise<string[]> {
  const response = await apiAs(user, "projects");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { projects: { name: string }[] };
  return body.projects.map((project) => project.name);
}

/** A Project text with three resistors, so its preview is not empty. */
export function threeResistorProject(name: string): string {
  const project = createEmptyProject(
    `nb-${randomBytes(4).toString("hex")}`,
    name,
  );
  for (const [index, x] of [100, 200, 300].entries())
    project.documents[0]!.instances.push({
      id: `R${index + 1}`,
      symbolId: "resistor",
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
    });
  return serializeProject(project);
}

/** Creates a Project through the API; returns its id. */
export async function createProjectAs(
  user: NotebookUser,
  name: string,
): Promise<string> {
  const response = await apiAs(user, "projects", {
    method: "POST",
    body: JSON.stringify({ name, projectText: threeResistorProject(name) }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

/** Saves a new revision through the API (each update keeps a version). */
export async function updateProjectAs(
  user: NotebookUser,
  id: string,
  revision: number,
  name: string,
): Promise<number> {
  const response = await apiAs(user, `projects/${id}`, {
    method: "PUT",
    headers: { "if-match": `revision-${revision}` },
    body: JSON.stringify({ name, projectText: threeResistorProject(name) }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { project: { revision: number } }).project
    .revision;
}

// ---- The browser session. ----

/** Writes (or with null removes) the token from a page on this origin. */
export async function writeTokenFrom(
  page: Page,
  user: NotebookUser | null,
): Promise<void> {
  await page.evaluate(
    ([key, token]) => {
      if (token === null) localStorage.removeItem(key);
      else localStorage.setItem(key, token);
    },
    [TOKEN_KEY, user?.token ?? null] as const,
  );
}

/** Opens silicon-notebook's `/` in this page and signs in (or out). */
export async function signIn(
  page: Page,
  user: NotebookUser | null,
): Promise<void> {
  await page.goto("/");
  await writeTokenFrom(page, user);
}

/** Opens the editor and waits until it takes input. */
export async function openNotebookEditor(
  page: Page,
  path = "/canvas/editor",
): Promise<void> {
  await page.goto(path);
  await page.getByTestId("schematic-canvas").waitFor();
}

/** Resolves with the next `auth/me` response that carries this bearer. */
export function nextAuthMe(page: Page, user: NotebookUser): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/canvas/api/auth/me" &&
      response.request().headers().authorization === user.bearer,
  );
}

/** Opens the Shelf wall (Browse Cloud Projects…) and returns its dialog. */
export async function openShelfWall(page: Page): Promise<Locator> {
  const shelf = await projectTabAction(page, "Open Shelf project in tab");
  await shelf.getByRole("button", { name: "Browse Cloud Projects…" }).click();
  const dialog = page.getByRole("dialog", { name: "Cloud Projects" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openVersionHistory(
  page: Page,
  projectId: string,
): Promise<void> {
  await page.getByTestId(`shelf-actions-${projectId}`).click();
  await page
    .getByRole("menuitem", { name: "Version history", exact: true })
    .click();
}

/** The source attribute of an image, or null without one. */
export function imageSource(image: Locator): Promise<string | null> {
  return image.getAttribute("src");
}

// ---- Storage. ----

export interface ProbeEntry {
  op: string;
  area: "local" | "session" | "idb" | "other";
  key: string | null;
}

/**
 * Records every IndexedDB open/delete and Storage getItem/setItem/
 * removeItem/clear of each document of this context in
 * `window.__notebookProbe` (the wrappers change no behaviour).
 */
export async function instrumentStorage(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const probe: { op: string; area: string; key: string | null }[] = [];
    Object.defineProperty(window, "__notebookProbe", {
      value: probe,
      configurable: true,
    });
    const areaOf = (storage: Storage) => {
      try {
        if (storage === window.localStorage) return "local";
        if (storage === window.sessionStorage) return "session";
      } catch {
        // Storage that cannot be reached is no area.
      }
      return "other";
    };
    const storage = Storage.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const op of ["getItem", "setItem", "removeItem", "clear"]) {
      const original = storage[op]!;
      storage[op] = function (this: Storage, ...args: unknown[]) {
        probe.push({
          op,
          area: areaOf(this),
          key: op === "clear" ? null : String(args[0]),
        });
        return original.apply(this, args);
      };
    }
    const factory = IDBFactory.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const op of ["open", "deleteDatabase"]) {
      const original = factory[op]!;
      factory[op] = function (this: IDBFactory, ...args: unknown[]) {
        probe.push({ op: `idb.${op}`, area: "idb", key: String(args[0]) });
        return original.apply(this, args);
      };
    }
  });
}

export function readProbe(page: Page): Promise<ProbeEntry[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __notebookProbe?: ProbeEntry[] })
        .__notebookProbe ?? [],
  );
}

export interface SingleUserRecovery {
  records: string[];
  workingCopy: string | null;
}

/**
 * Seeds what a single-user editor left in this tab: a recovery record in
 * IndexedDB (the database and store document/browser-recovery-store.ts
 * opens, version 1, out-of-line keys) and the tab's working-copy id in
 * sessionStorage. Run on `/` of the tab that then opens the editor.
 */
export async function seedSingleUserRecovery(
  page: Page,
): Promise<SingleUserRecovery> {
  const workingCopyId = `seed-${randomBytes(4).toString("hex")}`;
  const projectText = serializeProject(
    createEmptyProject(`seed-${workingCopyId}`, "Single-user draft"),
  );
  const record = {
    format: "analog-canvas-browser-recovery-v2",
    recordId: `${workingCopyId}-1`,
    workingCopyId,
    generation: "latest",
    projectId: `seed-${workingCopyId}`,
    projectName: "Single-user draft",
    projectSchemaVersion: 1,
    topDocumentId: "doc",
    documentRevisions: {},
    source: "new",
    updatedAt: new Date().toISOString(),
    byteLength: Buffer.byteLength(projectText, "utf8"),
    projectText,
    unsavedAtSnapshot: true,
  };
  await page.evaluate(
    async ({ database, store, key, value, sessionKey, workingCopy }) => {
      sessionStorage.setItem(sessionKey, workingCopy);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(database, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(store, "readwrite");
          transaction.objectStore(store).put(value, key);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      database: RECOVERY_DATABASE,
      store: RECOVERY_STORE,
      key: `${workingCopyId}#latest`,
      value: record,
      sessionKey: WORKING_COPY_KEY,
      workingCopy: workingCopyId,
    },
  );
  return readSingleUserRecovery(page);
}

export function readSingleUserRecovery(
  page: Page,
): Promise<SingleUserRecovery> {
  return page.evaluate(
    async ({ database, store, sessionKey }) => {
      const records = await new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as unknown[]).map((value) => JSON.stringify(value)),
            );
          };
          all.onerror = () => reject(all.error);
        };
      });
      return { records, workingCopy: sessionStorage.getItem(sessionKey) };
    },
    {
      database: RECOVERY_DATABASE,
      store: RECOVERY_STORE,
      sessionKey: WORKING_COPY_KEY,
    },
  );
}

// ---- Requests and the bearer rule. ----

export type RequestSource = "page" | "service-worker" | "frameless";

export interface RequestRecord {
  url: string;
  method: string;
  authorization: string | undefined;
  phase: string;
  source: RequestSource;
  page: Page | null;
  request: Request;
}

export interface Mark {
  label: string;
  /** Browser records before the mark. */
  index: number;
  /** The fixture log's last sequence number at the mark. */
  seq: number;
}

export interface RequestRecorder {
  records: RequestRecord[];
  /** Starts a phase; requests from now on carry its label. */
  mark(label: string): Promise<Mark>;
  /**
   * Starts a phase at this page's next main-frame navigation request (a
   * reload the page starts itself), so the new document's requests are the
   * new phase's; the log position is that navigation's entry.
   */
  markAtNavigation(page: Page, label: string): Promise<Mark>;
  between(from: Mark, to?: Mark): RequestRecord[];
}

/**
 * Records every request of this context: pages, popups and workers, also
 * those a route fulfils or aborts. A request's page comes from its frame
 * when it has one; a service worker's and an early frameless navigation's
 * (a popup's first request) do not.
 */
export function recordRequests(context: BrowserContext): RequestRecorder {
  const records: RequestRecord[] = [];
  let phase = "start";
  let lastSeq = 0;
  const navigationWaiters: {
    page: Page;
    label: string;
    resolve: (index: number, url: string) => void;
  }[] = [];
  context.on("request", (request) => {
    let source: RequestSource = "page";
    let page: Page | null = null;
    if (request.serviceWorker()) source = "service-worker";
    else
      try {
        page = request.frame().page();
      } catch {
        source = "frameless";
      }
    if (page && request.isNavigationRequest()) {
      const at = navigationWaiters.findIndex(
        (waiter) =>
          waiter.page === page && request.frame() === page.mainFrame(),
      );
      if (at >= 0) {
        const [waiter] = navigationWaiters.splice(at, 1);
        phase = waiter!.label;
        waiter!.resolve(records.length, request.url());
      }
    }
    records.push({
      url: request.url(),
      method: request.method(),
      authorization: request.headers().authorization,
      phase,
      source,
      page,
      request,
    });
  });
  return {
    records,
    async mark(label) {
      phase = label;
      const index = records.length;
      lastSeq = await fixture.seq();
      return { label, index, seq: lastSeq };
    },
    async markAtNavigation(page, label) {
      // Registered before the first await: armed when this is called.
      const navigation = new Promise<{ index: number; url: string }>(
        (resolve) =>
          navigationWaiters.push({
            page,
            label,
            resolve: (index, url) => resolve({ index, url }),
          }),
      );
      const after = lastSeq;
      const { index, url } = await navigation;
      const path = new URL(url).pathname + new URL(url).search;
      let entry: LogEntry | undefined;
      await expect
        .poll(async () => {
          entry = (await fixture.log(after + 1)).find(
            (item) =>
              item.marker === null &&
              item.method === "GET" &&
              item.path === path,
          );
          return entry !== undefined;
        })
        .toBe(true);
      lastSeq = entry!.seq - 1;
      return { label, index, seq: entry!.seq - 1 };
    },
    between(from, to) {
      return records.slice(from.index, to?.index);
    },
  };
}

/** The bearer an API path must carry: the user's, none for everything else. */
function expectedAuthorization(
  url: string,
  bearer: string | null,
): string | null {
  const parsed = new URL(url, origin);
  return parsed.origin === origin &&
    parsed.pathname.startsWith("/canvas/api/") &&
    !PUBLIC_PATHS.has(parsed.pathname)
    ? bearer
    : null;
}

/**
 * The bearer rule, for one phase and source: every browser request under
 * `/canvas/api/` other than the public probes carries exactly this user's
 * bearer (none for null), every other request none. The fixture log of the
 * same window (the spec's own requests excluded) obeys it too, or with
 * `log` an array, any of those bearers (several tabs share the log).
 */
export async function expectBearers(
  recorder: RequestRecorder,
  {
    from,
    to,
    source,
    user,
    log = true,
  }: {
    from: Mark;
    to?: Mark;
    source: Page | RequestSource;
    user: NotebookUser | null;
    log?: boolean | (NotebookUser | null)[];
  },
): Promise<void> {
  const bearer = user?.bearer ?? null;
  const records = recorder
    .between(from, to)
    .filter((record) =>
      typeof source === "string"
        ? record.source === source
        : record.page === source,
    );
  const wrong = records
    .filter(
      (record) =>
        (record.authorization ?? null) !==
        expectedAuthorization(record.url, bearer),
    )
    .map(
      (record) =>
        `${record.method} ${record.url} [${record.phase}] ${record.authorization ?? "no authorization"}`,
    );
  expect(
    wrong,
    `browser requests breaking the bearer rule for ${bearer}`,
  ).toEqual([]);
  if (log === false) return;
  const allowed = (log === true ? [user] : log).map(
    (item) => item?.bearer ?? null,
  );
  const entries = (await fixture.log(from.seq + 1, to?.seq)).filter(
    (entry) => entry.marker !== "spec",
  );
  const wrongLog = entries
    .filter((entry) => {
      const isApi = expectedAuthorization(entry.path, "api") === "api";
      return isApi
        ? !allowed.includes(entry.authorization)
        : entry.authorization !== null;
    })
    .map(
      (entry) =>
        `#${entry.seq} ${entry.method} ${entry.path} ${entry.authorization ?? "no authorization"}`,
    );
  expect(
    wrongLog,
    `log entries breaking the bearer rule for ${allowed}`,
  ).toEqual([]);
}

/** No request leaves this origin except to the declared prefixes. */
export function expectNoForeignOrigin(
  records: RequestRecord[],
  allowed: string[] = [],
): void {
  const foreign = records
    .map((record) => record.url)
    .filter((url) => /^(?:https?|wss?):/u.test(url))
    .filter(
      (url) =>
        new URL(url).origin !== origin &&
        !allowed.some((prefix) => url.startsWith(prefix)),
    );
  expect(foreign, "requests to a foreign origin").toEqual([]);
}

/** Requests (browser records and log entries) carrying this user's bearer. */
export async function requestsWithBearer(
  recorder: RequestRecorder,
  from: Mark,
  user: NotebookUser,
): Promise<string[]> {
  const browser = recorder
    .between(from)
    .filter((record) => record.authorization === user.bearer)
    .map((record) => `browser ${record.method} ${record.url}`);
  const log = (await fixture.log(from.seq + 1))
    .filter(
      (entry) => entry.marker !== "spec" && entry.authorization === user.bearer,
    )
    .map((entry) => `log ${entry.method} ${entry.path}`);
  return [...browser, ...log];
}

/** Records dialogs; dismisses each (a beforeunload stays on the page). */
export function recordDialogs(page: Page): { types: string[] } {
  const seen = { types: [] as string[] };
  page.on("dialog", (dialog) => {
    seen.types.push(dialog.type());
    void dialog.dismiss().catch(() => {});
  });
  return seen;
}

/** The next full load of this page (a reload or a navigation). */
export function nextLoad(page: Page): Promise<void> {
  return new Promise((resolve) => page.once("load", () => resolve()));
}

export interface PageShow {
  path: string;
  persisted: boolean;
  navigation: string | null;
}

const PAGE_SHOWS_KEY = "__notebookE2ePageShows";

/**
 * Records every `pageshow` of this context's documents (path, `persisted`,
 * the navigation type) into the tab's sessionStorage, where it survives the
 * reloads and history moves a case makes.
 */
export async function recordPageShows(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    window.addEventListener("pageshow", (event) => {
      const entry = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const shows = JSON.parse(
        sessionStorage.getItem(key) ?? "[]",
      ) as unknown[];
      shows.push({
        path: location.pathname,
        persisted: event.persisted,
        navigation: entry?.type ?? null,
      });
      sessionStorage.setItem(key, JSON.stringify(shows));
    });
  }, PAGE_SHOWS_KEY);
}

export function readPageShows(page: Page): Promise<PageShow[]> {
  return page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? "[]") as PageShow[],
    PAGE_SHOWS_KEY,
  );
}

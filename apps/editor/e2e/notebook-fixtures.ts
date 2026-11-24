// Helpers of the notebook browser tests (notebook-auth.spec.ts,
// notebook-bfcache.spec.ts, notebook-worker.spec.ts,
// notebook-evidence.spec.ts): the fixture's control client, notebook users,
// storage and request recorders, and the bearer rule every case checks.
// The run is selected by AUTO_CANVAS_E2E_NOTEBOOK=1 (playwright.config.ts);
// scripts/notebook-e2e-fixture.mjs is the stub notebook, the canvas server
// in notebook mode and the rewriting proxy in front of them, and the
// standalone sibling (the standard build in single-user mode) beside them.
import { randomBytes } from "node:crypto";
import { createEmptyProject } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
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

import {
  documentTrace,
  instrumentStorage,
  rawRecords,
  seedDraw,
} from "./notebook-storage-fixtures.js";

export const TOKEN_KEY = "silicon_notebook_token";
export const WORKING_COPY_KEY = "icm.working-copy.v1";
export const RECOVERY_DATABASE = "analog-canvas-recovery";
export const WORKSPACE_DATABASE = "analog-canvas-workspaces";
/** The Project name of `seedSingleUserRecovery`'s draft. */
export const SINGLE_USER_DRAFT = "Single-user draft";
const RECOVERY_STORE = "browser-recovery-v2";
/** The API's two public probes: never carry a bearer, never need one. */
const PUBLIC_PATHS = new Set([
  "/canvas/api/health",
  "/canvas/api/integration/ready.json",
]);
const SPEC_MARKER = { "x-notebook-e2e": "spec" };

// The notebook run refuses a non-canonical port (playwright.config.ts), so
// this spells the origin exactly as Playwright and the browser do.
export const origin = `http://127.0.0.1:${process.env.ICM_E2E_PORT ?? "4173"}`;
/** The fixture's standalone sibling: the standard build, single-user mode. */
export const siblingOrigin = `http://127.0.0.1:${process.env.AUTO_CANVAS_E2E_API_PORT ?? "4311"}`;

/**
 * Registers the notebook run's per-file hooks: one worker (the cases share
 * the fixture's request log) and a fresh log for each case. Each spec file
 * also sets `serviceWorkers: "block"` (notebook-worker.spec.ts, which covers
 * the service worker, sets "allow") and
 * `trace: "off"`: Playwright's trace recorder fetches the resources it
 * snapshots again, outside the page and without its headers, so with tracing
 * on the fixture log holds requests no page sent (observed: each preview
 * fetched a second time without Authorization, answered 401).
 */
export function notebookSuite(): void {
  test.beforeAll(() => {
    expect(test.info().config.workers).toBe(1);
  });
  test.beforeEach(async ({ context }) => {
    await instrumentStorage(context);
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
  /** Answered by the proxy itself from a seed (`fixture.seed`). */
  seeded: boolean;
  /** The body the browser was sent, measured as relayed (null until done). */
  responseBytes: number | null;
  responseSha256: string | null;
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
  /**
   * From now on the proxy answers exactly this path and query itself, with
   * this body and these headers (logged `seeded`), until unseed or reset.
   */
  async seed(seed: {
    url: string;
    body: string;
    contentType: string;
    cacheControl: string;
  }): Promise<void> {
    await control("POST", "seed", seed);
  },
  async unseed(url: string): Promise<void> {
    await control("POST", "unseed", { url });
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
function apiAs(
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
      if (token === null) window.__nb.remove(window.__nb.local, key);
      else window.__nb.write(window.__nb.local, key, token);
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
  if (user) await seedDraw(page, user);
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
  const shelf = await projectTabAction(page, "Open Cloud Project…");
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

// ---- Storage. ----

export interface ProbeEntry {
  op: string;
  area: "local" | "session" | "idb" | "other";
  key: string | null;
}

export async function readProbe(page: Page): Promise<ProbeEntry[]> {
  const events = await documentTrace(page);
  expect(
    events.filter(
      (e) =>
        e.phase === "before" &&
        (e.op === "locked" ||
          e.op === "open" ||
          (e.op === "getter" &&
            ["sessionStorage", "indexedDB", "locks"].includes(e.name))),
    ),
  ).toEqual([]);
  return events.flatMap((e): ProbeEntry[] => {
    if (["open", "deleteDatabase"].includes(e.op))
      return [{ op: "idb." + e.op, area: "idb", key: e.name }];
    if (e.area && ["getItem", "setItem", "removeItem", "clear"].includes(e.op))
      return [
        { op: e.op, area: e.area, key: e.op === "clear" ? null : e.name },
      ];
    return [];
  });
}

export interface SingleUserRecovery {
  records: string[];
  workingCopy: string | null;
}

/**
 * Seeds what a single-user editor left in this tab: a recovery record in
 * IndexedDB (the database and store document/browser-recovery-store.ts
 * opens, version 1, out-of-line keys) and the tab's working-copy id in
 * sessionStorage. Run on a page of the origin, in the tab that then opens
 * the editor. The record is the one the editor itself writes
 * (`recoveryRecordOf` in document/recovery-coordinator.ts, rebuilt here from
 * the packages, since that module's imports are not safe to load in
 * Playwright): the current Project File version, the Project's own top
 * document and revisions, and three resistors, so the standard editor
 * offers it (N11d is the control that its reader accepts this seed).
 */
export async function seedSingleUserRecovery(
  page: Page,
): Promise<SingleUserRecovery> {
  const workingCopyId = `seed-${randomBytes(4).toString("hex")}`;
  const project = parseProject(threeResistorProject(SINGLE_USER_DRAFT));
  const projectText = serializeProject(project);
  const documentRevisions: Record<string, number> = {};
  for (const document of project.documents)
    documentRevisions[document.id] = document.revision;
  const record = {
    format: "analog-canvas-browser-recovery-v2",
    recordId: `${workingCopyId}-1`,
    workingCopyId,
    generation: "latest",
    projectId: project.id,
    projectName: project.name,
    projectSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    topDocumentId: project.topDocumentId,
    documentRevisions,
    structureRevision: project.structureRevision,
    source: "new",
    updatedAt: new Date().toISOString(),
    byteLength: Buffer.byteLength(projectText, "utf8"),
    projectText,
    unsavedAtSnapshot: true,
  };
  await page.evaluate(
    async ({ database, store, key, value, sessionKey, workingCopy }) => {
      window.__nb.write(window.__nb.session, sessionKey, workingCopy);
      await new Promise<void>((resolve, reject) => {
        const request = window.__nb.openDB(database, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = window.__nb.tx(db, store, "readwrite");
          Reflect.apply(window.__nb.put, transaction.objectStore(store), [
            value,
            key,
          ]);
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

export async function readSingleUserRecovery(
  page: Page,
): Promise<SingleUserRecovery> {
  const records = await rawRecords<unknown>(
    page,
    RECOVERY_DATABASE,
    RECOVERY_STORE,
  );
  const workingCopy = await page.evaluate(
    (key) => window.__nb.read(window.__nb.session, key),
    WORKING_COPY_KEY,
  );
  return {
    records: records.map((value) => JSON.stringify(value)),
    workingCopy,
  };
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
  /** The origin this recorder's pages use: the proxy's, or the sibling's. */
  origin: string;
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
 * (a popup's first request) do not. With `origin` the sibling's, the
 * context is a standalone one: `expectStandaloneRequests` checks it.
 */
export function recordRequests(
  context: BrowserContext,
  options: { origin?: string } = {},
): RequestRecorder {
  const records: RequestRecord[] = [];
  let phase = "start";
  let lastSeq = 0;
  const navigationWaiters: {
    page: Page;
    label: string;
    resolve: (index: number, url: string, after: number) => void;
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
        waiter!.resolve(records.length, request.url(), lastSeq);
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
    origin: options.origin ?? origin,
    async mark(label) {
      phase = label;
      const index = records.length;
      lastSeq = await fixture.seq();
      return { label, index, seq: lastSeq };
    },
    async markAtNavigation(page, label) {
      // Registered before the first await: armed when this is called.
      // `after` is the last mark's log position when the navigation fires,
      // not when this is called: an earlier navigation to the same path
      // must not be taken for this one.
      const navigation = new Promise<{
        index: number;
        url: string;
        after: number;
      }>((resolve) =>
        navigationWaiters.push({
          page,
          label,
          resolve: (index, url, after) => resolve({ index, url, after }),
        }),
      );
      const { index, url, after } = await navigation;
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

/** A window and a URL `expectBearers` leaves out (a seed's own requests). */
export interface Exemption {
  from: Mark;
  to: Mark;
  /** The full URL (browser records) whose path and query the log shows. */
  url: string;
}

/**
 * The bearer rule, for one phase and source: every browser request under
 * `/canvas/api/` other than the public probes carries exactly this user's
 * bearer (none for null), every other request none. The fixture log of the
 * same window (the spec's own requests excluded) obeys it too, or with
 * `log` an array, any of those bearers (several tabs share the log).
 * Requests for an exempted URL inside its window are not checked.
 */
export async function expectBearers(
  recorder: RequestRecorder,
  {
    from,
    to,
    source,
    user,
    log = true,
    exempt = [],
  }: {
    from: Mark;
    to?: Mark;
    source: Page | RequestSource;
    user: NotebookUser | null;
    log?: boolean | (NotebookUser | null)[];
    exempt?: Exemption[];
  },
): Promise<void> {
  const bearer = user?.bearer ?? null;
  const exemptRecord = (record: RequestRecord) => {
    const index = recorder.records.indexOf(record);
    return exempt.some(
      (item) =>
        record.url === item.url &&
        index >= item.from.index &&
        index < item.to.index,
    );
  };
  const exemptEntry = (entry: LogEntry) =>
    exempt.some((item) => {
      const url = new URL(item.url, origin);
      return (
        entry.path === url.pathname + url.search &&
        entry.seq > item.from.seq &&
        entry.seq <= item.to.seq
      );
    });
  const records = recorder
    .between(from, to)
    .filter((record) =>
      typeof source === "string"
        ? record.source === source
        : record.page === source,
    )
    .filter((record) => !exemptRecord(record));
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
    (entry) => entry.marker !== "spec" && !exemptEntry(entry),
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

/**
 * The standalone rule, for a recorder of the sibling's origin: no request
 * of that context carries any `authorization`, and none goes to the
 * notebook proxy's origin.
 */
export function expectStandaloneRequests(recorder: RequestRecorder): void {
  expect(recorder.origin, "a standalone recorder").not.toBe(origin);
  expect(recorder.records.length, "standalone requests").toBeGreaterThan(0);
  expect(
    recorder.records
      .filter((record) => record.authorization !== undefined)
      .map((record) => `${record.method} ${record.url}`),
    "standalone requests carrying authorization",
  ).toEqual([]);
  expect(
    recorder.records
      .map((record) => record.url)
      .filter((url) => /^(?:https?|wss?):/u.test(url))
      .filter((url) => new URL(url).origin === origin),
    "standalone requests to the notebook proxy",
  ).toEqual([]);
}

/** Every URL in this page's Cache Storage, per cache. */
export function cacheStorageUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
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

/**
 * The interval between a switch and the new document's navigation: the old
 * document sends no API request at all, with any bearer or none. Neither the
 * page nor the worker records one, and none reaches the proxy (the spec's
 * own requests excluded).
 */
export async function expectNoApiRequest(
  recorder: RequestRecorder,
  { from, to, page }: { from: Mark; to: Mark; page: Page },
): Promise<void> {
  expect(to.seq, "a transition's end after its start").toBeGreaterThanOrEqual(
    from.seq,
  );
  const isApi = (url: string) => {
    const parsed = new URL(url, origin);
    return (
      parsed.origin === origin && parsed.pathname.startsWith("/canvas/api")
    );
  };
  expect(
    recorder
      .between(from, to)
      .filter(
        (record) =>
          isApi(record.url) &&
          (record.page === page || record.source !== "page"),
      )
      .map(
        (record) =>
          `${record.method} ${record.url} ${record.authorization ?? "no authorization"}`,
      ),
    "API requests of the old document during the transition",
  ).toEqual([]);
  expect(
    (await fixture.log(from.seq + 1, to.seq))
      .filter((entry) => entry.marker !== "spec" && isApi(entry.path))
      .map(
        (entry) =>
          `#${entry.seq} ${entry.method} ${entry.path} ${entry.authorization ?? "no authorization"}`,
      ),
    "API requests on the wire during the transition",
  ).toEqual([]);
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

export function readPageShows(page: Page): Promise<PageShow[]> {
  return page.evaluate(() =>
    window.__nb
      .trace()
      .filter((e) => e.op === "pageshow")
      .map((e) => ({
        path: e.path!,
        persisted: e.name === "true",
        navigation: e.navigation ?? null,
      })),
  );
}

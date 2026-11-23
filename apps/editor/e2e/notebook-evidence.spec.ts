// Evidence beside the notebook run (T162c, N11): the standard build keeps
// its single-user recovery prompt with the API unreachable (against the
// fixture's standalone sibling), and the notebook build keeps the Agent off
// even with a saved Agent session and `?agent=pair`.
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { expectRecovered, placeResistors } from "./editor-fixtures.js";
import {
  expectBearers,
  expectNoForeignOrigin,
  expectStandaloneRequests,
  fixture,
  instrumentStorage,
  newUser,
  notebookSuite,
  readProbe,
  readSingleUserRecovery,
  recordRequests,
  seedSingleUserRecovery,
  siblingOrigin,
  SINGLE_USER_DRAFT,
  TOKEN_KEY,
  WORKING_COPY_KEY,
  writeTokenFrom,
} from "./notebook-fixtures.js";

// No service worker and no trace, as in the other notebook files.
test.use({ serviceWorkers: "block", trace: "off" });
notebookSuite();

const AGENT_SESSION_KEY = "icm.agent-session-recovery.v1";
const AGENT_RUNTIME = /\/(?:agent-runtime|connect-agent-panel)-[^/]*\.js$/u;

/** A context of the sibling's origin: the standard editor, Draw mode. */
function siblingContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: siblingOrigin,
    serviceWorkers: "block",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: siblingOrigin,
          localStorage: [
            { name: "icm.editor-mode.v1", value: "draw" },
            { name: "icm.editor-mode-coach.v1", value: "seen" },
          ],
        },
      ],
    },
  });
}

test("N11d seed control: the standard editor's recovery reader accepts the single-user seed", async ({
  browser,
}) => {
  // The seed the notebook cases (N2, N9) plant is what a single-user editor
  // leaves; here the standard build itself reads it back.
  const context = await siblingContext(browser);
  try {
    const recorder = recordRequests(context, { origin: siblingOrigin });
    const page = await context.newPage();
    // A same-origin document that is not the editor, to seed from.
    await page.goto("/manifest.webmanifest");
    const seed = await seedSingleUserRecovery(page);
    expect(seed.records).toHaveLength(1);
    const seeded = JSON.parse(seed.records[0]!) as { workingCopyId: string };
    await page.goto("/editor?recovery=seed");
    await page.getByTestId("schematic-canvas").waitFor();
    // The standard editor offers the seeded draft at startup (the tab's
    // pointer names it, but no saved window workspace does) and restores
    // its three resistors: its reader took the record as a valid,
    // meaningful copy.
    const banner = page.getByTestId("startup-recovery-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(SINGLE_USER_DRAFT);
    await banner.getByRole("button", { name: "Restore" }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByText("Restored recovery revision 0")).toBeVisible();
    // The live netlist lists the seed's three resistors.
    const netlist = page.getByRole("region", {
      name: "Live netlist",
      exact: true,
    });
    for (const name of ["R1", "R2", "R3"])
      await expect(netlist).toContainText(`${name} `);
    const records = (await readSingleUserRecovery(page)).records.map(
      (text) => JSON.parse(text) as { workingCopyId: string },
    );
    test.info().annotations.push({
      type: "N11d seed accepted",
      description: JSON.stringify({
        how: "offered, restored",
        seededWorkingCopy: seeded.workingCopyId,
        recordsAfter: records.map((record) => record.workingCopyId),
      }),
    });
    expectStandaloneRequests(recorder);
  } finally {
    await context.close();
  }
});

test("N11b the standard build keeps its recovery prompt with the API unreachable", async ({
  browser,
}) => {
  // The standard editor in single-user mode, on its own origin.
  const context = await browser.newContext({
    baseURL: siblingOrigin,
    serviceWorkers: "block",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: siblingOrigin,
          localStorage: [
            { name: "icm.editor-mode.v1", value: "draw" },
            { name: "icm.editor-mode-coach.v1", value: "seen" },
          ],
        },
      ],
    },
  });
  try {
    const recorder = recordRequests(context, { origin: siblingOrigin });
    const page = await context.newPage();
    await page.goto("/editor");
    // Three objects reach the startup banner's threshold.
    await placeResistors(page, [360, 470, 580], 330);
    await expect(page.getByTestId("revision")).toHaveText("3");
    await expectRecovered(page, '"revision": 3');

    // The API is unreachable from here on.
    const aborted: string[] = [];
    await page.route("**/api/**", async (route) => {
      aborted.push(new URL(route.request().url()).pathname);
      await route.abort();
    });
    await page.goto("/editor?recovery=meaningful");
    const banner = page.getByTestId("startup-recovery-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("New Circuit");
    await expect(banner.getByRole("button", { name: "Restore" })).toBeVisible();
    expect(aborted.length).toBeGreaterThanOrEqual(1);
    test.info().annotations.push({
      type: "N11b aborted API requests",
      description: JSON.stringify(aborted),
    });
    expectStandaloneRequests(recorder);
  } finally {
    await context.close();
  }
});

test("N11c the notebook build keeps the Agent off with a saved Agent session and ?agent=pair", async ({
  page,
  context,
}) => {
  await instrumentStorage(context);
  const recorder = recordRequests(context);
  const alice = newUser("alice");
  await page.goto("/");
  // A record the standard editor would resume (hasAgentSessionRecovery in
  // agent/session-recovery-presence.ts), in the tab that opens the editor.
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
    AGENT_SESSION_KEY,
    JSON.stringify({
      version: 1,
      sessionId: "agent-session-seed",
      editorSecret: "editor-secret-seed",
      projectId: "project-seed",
      projectSessionId: "project-session-seed",
      scopes: ["read"],
      expiresAt: Date.now() + 3_600_000,
    }),
  ] as const);
  await writeTokenFrom(page, alice);
  const from = await recorder.mark("alice");
  await page.goto("/canvas/editor?agent=pair");
  await page.getByTestId("schematic-canvas").waitFor();
  // Positive controls: the mounted editor read the token and the tab's
  // working copy through the instrumented storage.
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
            entry.key === WORKING_COPY_KEY,
        ),
      };
    })
    .toEqual({ token: true, workingCopy: true });
  await page.waitForLoadState("networkidle");
  const end = await recorder.mark("end");

  const probe = await readProbe(page);
  expect(
    probe.filter(
      (entry) => entry.op === "getItem" && entry.key === AGENT_SESSION_KEY,
    ),
  ).toEqual([]);
  const urls = recorder.between(from, end).map((record) => record.url);
  // The recorder sees the editor's chunks: the Agent's static part loads.
  expect(
    urls.filter((url) => /\/workspace-agent-[^/]*\.js$/u.test(url)).length,
  ).toBeGreaterThanOrEqual(1);
  expect(urls.filter((url) => AGENT_RUNTIME.test(url))).toEqual([]);
  expect(
    urls.filter((url) => new URL(url).pathname.startsWith("/canvas/api/agent")),
  ).toEqual([]);
  expect(
    (await fixture.log(from.seq + 1, end.seq)).filter(
      (entry) =>
        entry.path.startsWith("/canvas/api/agent") ||
        AGENT_RUNTIME.test(new URL(entry.path, siblingOrigin).pathname),
    ),
  ).toEqual([]);
  await expect(page.getByTestId("open-agent")).toHaveCount(0);
  test.info().annotations.push({
    type: "N11c agent chunks requested",
    description: JSON.stringify(
      urls
        .filter((url) => /agent/u.test(new URL(url).pathname))
        .map((url) => new URL(url).pathname),
    ),
  });
  await expectBearers(recorder, { from, to: end, source: page, user: alice });
  expectNoForeignOrigin(recorder.records);
});

import { defineConfig, devices } from "@playwright/test";

// Keep Playwright's readiness probe on loopback even when the development
// machine exports a system HTTP proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");

const accountsTest = process.env.AUTO_CANVAS_E2E_ACCOUNTS === "1";
const prefixTest = process.env.AUTO_CANVAS_E2E_BASE_PATH === "1";
// The notebook build behind a stand-in for silicon-notebook
// (scripts/notebook-e2e-fixture.mjs): its own run, never part of the others.
const notebookTest = process.env.AUTO_CANVAS_E2E_NOTEBOOK === "1";
if (prefixTest && notebookTest)
  throw new Error(
    "AUTO_CANVAS_E2E_BASE_PATH and AUTO_CANVAS_E2E_NOTEBOOK cannot both be set",
  );
const e2ePort = Number(process.env.ICM_E2E_PORT ?? "4173");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
// Parallel task worktrees each use their own ports and test database
// (docs/workflow.md#并行任务).
const apiPort = Number(process.env.AUTO_CANVAS_E2E_API_PORT ?? "4311");
const apiUrl = `http://127.0.0.1:${apiPort}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (notebookTest) checkNotebookEnvironment();
// A running editor to test instead of starting one: a live check of the
// deployed site (editor-only cases: anything a case does reaches that
// server), or one server shared by several runs.
const externalBaseUrl = process.env.ICM_E2E_BASE_URL?.replace(/\/+$/u, "");
// The server serves the editor built for tests (scripts/build-e2e-editor.mjs,
// about a second, rebuilt at every start): a page loads a few chunks instead
// of hundreds of modules the dev server compiles on first request. Measured
// 2026-10-01 with 4 workers: about 20% less time per spec file, and no more
// cold first loads timing out. ICM_E2E_SERVER=dev serves the source instead.
const serveSource = process.env.ICM_E2E_SERVER === "dev";
const editorServer = serveSource
  ? `pnpm --filter @icm/editor exec vite --host 127.0.0.1 --port ${e2ePort}`
  : "node scripts/build-e2e-editor.mjs && " +
    `pnpm --filter @icm/editor exec vite preview --outDir dist-e2e --host 127.0.0.1 --port ${e2ePort} --strictPort`;

const launchOptions = chromiumExecutablePath
  ? { executablePath: chromiumExecutablePath }
  : undefined;

/**
 * The notebook run's refusals: a developer's own servers run on this
 * machine, so the run starts nothing that could reach them, and it never
 * runs against another editor or a non-test database.
 */
function checkNotebookEnvironment(): void {
  const refuse = (message: string) => {
    throw new Error(`AUTO_CANVAS_E2E_NOTEBOOK=1: ${message}`);
  };
  for (const name of [
    "ICM_E2E_BASE_URL",
    "ICM_E2E_SERVER",
    "AUTO_CANVAS_E2E_ACCOUNTS",
  ])
    if (process.env[name] !== undefined) refuse(`${name} must not be set`);
  for (const name of [
    "VITE_AUTO_CANVAS_AUTH",
    "AUTO_CANVAS_AUTH",
    "AUTO_CANVAS_BASE_PATH",
  ])
    if (name in process.env) refuse(`${name} must not be set`);
  const reserved = new Set([3000, 8000, 4310]);
  for (const [name, port] of [
    ["ICM_E2E_PORT", e2ePort],
    ["AUTO_CANVAS_E2E_API_PORT", apiPort],
  ] as const)
    // Canonical decimal only, as the fixture requires: the helpers and the
    // fixture spell the port as the variable does, the browser as a number.
    if (
      (process.env[name] !== undefined &&
        !/^[1-9]\d*$/u.test(process.env[name])) ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    )
      refuse(
        `${name} must be an integer from 1024 to 65535, without leading zeros`,
      );
    else if (reserved.has(port))
      refuse(`${name} is reserved for the developer's servers`);
  if (e2ePort === apiPort)
    refuse("ICM_E2E_PORT and AUTO_CANVAS_E2E_API_PORT must differ");
  const database = process.env.AUTO_CANVAS_TEST_DATABASE_URL;
  let databaseUrl: URL | null = null;
  try {
    databaseUrl = database ? new URL(database) : null;
  } catch {
    databaseUrl = null;
  }
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(
      databaseUrl?.pathname.replace(/^\//u, "") ?? "",
    );
  } catch {
    databaseName = "";
  }
  if (
    !databaseUrl ||
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.searchParams.has("dbname") ||
    !/^auto_canvas_test(?:_\d+)?$/u.test(databaseName)
  )
    refuse(
      "AUTO_CANVAS_TEST_DATABASE_URL must name auto_canvas_test or auto_canvas_test_<digits>",
    );
  // Nothing in the notebook run uses it today; set, it closes the editor dev
  // proxies' default (the developer's port 4310) for any Vite server a
  // worker might start.
  const api = process.env.AUTO_CANVAS_API_URL;
  const apiMatch = /^http:\/\/127\.0\.0\.1:(\d+)$/u.exec(api ?? "");
  const apiUrlPort = apiMatch ? Number(apiMatch[1]) : NaN;
  if (
    !apiMatch ||
    apiUrlPort < 1 ||
    apiUrlPort > 65535 ||
    reserved.has(apiUrlPort)
  )
    refuse(
      "AUTO_CANVAS_API_URL must be an http://127.0.0.1:<port> origin outside 3000, 8000 and 4310",
    );
}

// Needs `pnpm build` and `pnpm build:notebook-editor` first.
const notebookWebServer = [
  {
    command: "node scripts/notebook-e2e-fixture.mjs",
    env: {
      ICM_E2E_PORT: String(e2ePort),
      AUTO_CANVAS_E2E_API_PORT: String(apiPort),
      AUTO_CANVAS_TEST_DATABASE_URL: process.env.AUTO_CANVAS_TEST_DATABASE_URL!,
    },
    url: `${e2eBaseUrl}/canvas/api/health`,
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 30_000 },
    reuseExistingServer: false,
    timeout: 120_000,
    // The fixture prints the schema and the processes it made.
    stdout: "pipe" as const,
  },
];

export default defineConfig({
  testDir: "apps/editor/e2e",
  ...(notebookTest
    ? {
        projects: [
          {
            name: "notebook",
            testMatch: "**/notebook-*.spec.ts",
            testIgnore: "**/notebook-bfcache.spec.ts",
          },
          {
            // Playwright launches Chromium without the back/forward cache;
            // this project's own browser keeps it.
            name: "notebook-bfcache",
            testMatch: "**/notebook-bfcache.spec.ts",
            use: {
              launchOptions: {
                ...launchOptions,
                ignoreDefaultArgs: ["--disable-back-forward-cache"],
              },
            },
          },
        ],
      }
    : prefixTest
      ? { testMatch: "**/base-path.spec.ts" }
      : accountsTest
        ? { testMatch: "**/standalone-accounts.spec.ts" }
        : {
            testIgnore: [
              "**/base-path.spec.ts",
              "**/standalone-accounts.spec.ts",
              "**/notebook-*.spec.ts",
            ],
          }),
  // Each scenario owns an isolated browser context. Test-level parallelism
  // lets CI shards balance cases instead of assigning the entire suite to one
  // shard based on the three large spec files. The notebook run shares one
  // fixture's request log, so it runs one test at a time.
  fullyParallel: !notebookTest,
  // A local run shares the machine it runs on, so it takes one worker unless
  // `--workers` asks for more. CI passes its own count per shard.
  workers: notebookTest ? 1 : process.env.CI ? undefined : 1,
  // The per-test budget catches a hung test, not a slow machine. The longest
  // editor flows take 10-14 s alone and two to three times that while other
  // workers load the same machine, which failed them at the old 30 s default.
  // Speed itself is measured by performance.spec.ts.
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Keep attempt timings in the local browser test report.
  reporter: [
    ["line"],
    ["json", { outputFile: "test-results/e2e-report.json" }],
  ],
  use: {
    baseURL: externalBaseUrl ?? e2eBaseUrl,
    // The suite opens the editor in Draw mode, where the drawing tools it
    // drives live, with the first-open coach mark already seen. Playwright
    // copies this into every context a test creates too. The Auto-mode spec
    // (editor-modes.spec.ts) starts from empty storage instead.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(externalBaseUrl ?? e2eBaseUrl).origin,
          localStorage: [
            { name: "icm.editor-mode.v1", value: "draw" },
            { name: "icm.editor-mode-coach.v1", value: "seen" },
          ],
        },
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(launchOptions
      ? { launchOptions }
      : process.env.CI
        ? {}
        : { channel: "chrome" }),
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: prefixTest
          ? [
              {
                command: "pnpm build && node scripts/base-path-proxy.mjs",
                env: {
                  AUTO_CANVAS_BASE_PATH: "/canvas",
                  VITE_ICM_AGENT_UI: "enabled",
                },
                url: `${e2eBaseUrl}/canvas/api/health`,
                gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
                reuseExistingServer: false,
                timeout: 180_000,
              },
            ]
          : [
              {
                command:
                  "pnpm --filter @icm/server... build && node apps/server/dist/cli.js",
                env: {
                  AUTO_CANVAS_AUTH: accountsTest ? "accounts" : "local",
                  DATABASE_URL:
                    process.env.AUTO_CANVAS_TEST_DATABASE_URL ??
                    "postgresql:///auto_canvas_test",
                  PORT: String(apiPort),
                },
                url: `${apiUrl}/api/health`,
                reuseExistingServer: false,
                timeout: 120_000,
              },
              {
                command: editorServer,
                env: { AUTO_CANVAS_API_URL: apiUrl },
                url: e2eBaseUrl,
                reuseExistingServer:
                  !process.env.CI && process.env.ICM_E2E_ISOLATED !== "1",
                // The test build runs first: about a second here, longer on a
                // cold CI runner.
                timeout: 120_000,
              },
            ],
      }),
  // The notebook run refuses ICM_E2E_BASE_URL, so it always starts its own.
  ...(notebookTest ? { webServer: notebookWebServer } : {}),
});

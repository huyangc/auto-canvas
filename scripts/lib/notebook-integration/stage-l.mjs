// Stage L: the entry link. A disposable silicon-notebook clone is built with
// the canvas's UI package (`SILICON_NOTEBOOK_UI_PLUGINS`), silicon-notebook's
// own plugin guards run on the synced package, and a browser proves that a
// signed-in user sees 打开电路画布 in an opened notebook's side panel and that
// its click opens the canvas editor at /canvas as that same user. A rebuild
// without the variable removes the entry.
//
// The set-up, the launch, the managed service's checks, the stop and the
// cleanup are stage M's (managed-clone.mjs). The browser is Chrome (the
// system channel) driven by `@playwright/test`'s chromium, headless, with a
// fresh profile inside the sandbox for each use; every request it makes to
// anything but the clone's web port is aborted and fails the stage, and a
// proxy that only records (a listener of the run) catches whatever would
// leave 127.0.0.1 outside the page's own requests. The browser is closed in
// the cleanup too, and only a process this run started and recorded (by its
// profile on the command line) is ever signalled.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import {
  checkManagedService,
  hex,
  identityOf,
  integration,
  launchClone,
  managedState,
  parsed,
  probing,
  register,
  repo,
  request,
  resetRuntime,
  runManagedStage,
  setUp,
  sleep,
  stopAll,
  buildWithTarget,
} from "./managed-clone.mjs";
import { groupOf, removeNext } from "./notebook-clone.mjs";
import { waitFor } from "./sandbox.mjs";
import { tail } from "./steps.mjs";

/** The canvas's UI package, as silicon-notebook's sync script gets it. */
const UI_PACKAGE = path.join(integration, "ui/auto-canvas");
const UI_MANIFEST = path.join(UI_PACKAGE, "ui-plugin.json");
/** silicon-notebook's token key (frontend/app/auth-session.ts). */
const TOKEN_KEY = "silicon_notebook_token";
const ENTRY_NAME = "打开电路画布";
/** The empty registry the sync script writes without a package. */
const EMPTY_REGISTRY =
  "export const LOCAL_WORKSPACE_UI_CONTRIBUTIONS: readonly WorkspaceUiContribution[] = [];";
/**
 * The browser bundle's API base, baked in at build time: silicon-notebook's
 * documented same-origin deployment (`/api` through the frontend's rewrite).
 * Without it the bundle keeps its default, the developer's backend on port
 * 8000, and the page would ask that port (the network guard aborts it).
 */
const SAME_ORIGIN_API = { NEXT_PUBLIC_API_BASE_URL: "/api" };

/** Why stage L cannot run from this checkout (besides stage M's builds). */
export function stageLPrerequisites() {
  const problems = [];
  for (const file of [
    UI_MANIFEST,
    path.join(UI_PACKAGE, "workspace-plugin.tsx"),
  ])
    if (!fs.existsSync(file))
      problems.push(
        `stage L needs the UI package file ${path.relative(repo, file)}`,
      );
  try {
    createRequire(path.join(repo, "package.json")).resolve("@playwright/test");
  } catch {
    problems.push(
      "stage L needs @playwright/test (a root dev dependency); run pnpm install",
    );
  }
  return problems;
}

export async function stageL(context) {
  await runManagedStage(context, stageLBody);
}

async function stageLBody({ sandbox, report, secrets, notebook, options }) {
  const m = managedState({
    sandbox,
    report,
    secrets,
    notebook,
    options,
    stage: "L",
  });
  const browsers = browserSessions(m);
  // The browser goes first in the cleanup, before the clone is stopped.
  m.cleanupSteps.push((ms) => browsers.closeOpen(ms));
  sandbox.beforeDispose(m.cleanup);
  // The notebook's own data lives outside `.local` (which every launch starts
  // fresh), so the rollback's launch finds the same user and notebook.
  const notebookData = path.join(sandbox.root, "notebook-data");
  const contribution = JSON.parse(fs.readFileSync(UI_MANIFEST, "utf8"))
    .contributions[0];
  try {
    sandbox.makeDir(path.join(notebookData, "storage"), { recursive: true });
    if (
      !(await setUp(m, {
        buildEnv: {
          ...SAME_ORIGIN_API,
          SILICON_NOTEBOOK_UI_PLUGINS: UI_PACKAGE,
        },
        what: "both targets and the UI package",
        notebookEnv: [
          [
            "DATABASE_URL",
            `sqlite:///${path.join(notebookData, "silicon_notebook.db")}`,
          ],
          ["SILICON_NOTEBOOK_STORAGE_DIR", path.join(notebookData, "storage")],
        ],
      }))
    )
      return;
    if (!syncedPackage(m, contribution)) return;
    await notebookGuards(m);
    m.say(`     guards done after ${m.elapsed()}`);
    const signedIn = await entryRun(m, browsers, contribution);
    if (!signedIn) return;
    m.say(`     entry run done after ${m.elapsed()}`);
    if (!(await rollbackBuild(m))) return;
    await rollbackRun(m, browsers, contribution, signedIn);
    m.say(`     rollback done after ${m.elapsed()}`);
  } finally {
    await m.cleanup();
    m.say(`     stage L took ${m.elapsed()}`);
  }
}

// ---- L1: the synced package --------------------------------------------------

/** A file the sync wrote into the clone, read without following a link. */
const cloneText = (m, relative) =>
  m.sandbox.readFile(path.join(m.nb, relative), "utf8");

/** The contribution rows of the clone's frontend contract, or undefined. */
function contractRows(m) {
  try {
    return JSON.parse(
      cloneText(m, "frontend/.local/ui-extension-contract.json"),
    ).contributions;
  } catch {
    return undefined;
  }
}

const isRow = (contribution) => (row) =>
  row?.plugin_id === contribution.plugin_id &&
  row.version === contribution.version &&
  row.contribution_id === contribution.id &&
  row.slot === contribution.slot &&
  row.capability === contribution.capability;

/**
 * L1 after the build with the package: the clone holds the copy (the entry
 * byte for byte, a `.ui-plugin-origin` marker naming the package), the
 * generated registry imports it, and the frontend contract holds its row.
 */
function syncedPackage(m, contribution) {
  const { report } = m;
  const copy = "frontend/features/ext-auto-canvas";
  const entry = cloneText(m, `${copy}/workspace-plugin.tsx`);
  const marker = cloneText(m, `${copy}/.ui-plugin-origin`);
  const ok = report.check(
    "L1 the sync copied the package: <clone>/frontend/features/ext-auto-canvas/workspace-plugin.tsx is the package's entry, its .ui-plugin-origin names the package",
    entry ===
      fs.readFileSync(path.join(UI_PACKAGE, "workspace-plugin.tsx"), "utf8") &&
      marker?.split("\n")[0] === UI_PACKAGE,
    `entry ${entry === undefined ? "missing" : "differs"}, marker ${JSON.stringify(marker?.split("\n")[0])}`,
  );
  const registry =
    cloneText(m, "frontend/features/extension-sdk/registry.local.ts") ?? "";
  report.check(
    "L1 the generated registry.local.ts imports AutoCanvasEntry from ../ext-auto-canvas/workspace-plugin.tsx",
    /import \{ AutoCanvasEntry as \w+ \} from "\.\.\/ext-auto-canvas\/workspace-plugin\.tsx";/u.test(
      registry,
    ),
    tail(registry, 6),
  );
  const rows = contractRows(m);
  report.check(
    "L1 frontend/.local/ui-extension-contract.json holds the package's row (plugin_id, version, contribution_id, slot, capability)",
    rows?.filter(isRow(contribution)).length === 1,
    `rows ${JSON.stringify(rows?.filter((row) => row?.plugin_id === contribution.plugin_id))}`,
  );
  return ok;
}

// ---- L2: silicon-notebook's own guards on the synced package -----------------

/**
 * silicon-notebook's guard commands for a plugin, in the clone, each one
 * check: the node test lane, the UI vocabulary guard, the type check (its
 * pretypecheck re-syncs with the variable set), the CLI's extensions check
 * and the deployment parity script against the clone's contract, the last two
 * with the stage's managed TOML.
 */
async function notebookGuards(m) {
  const { sandbox, report, nb } = m;
  const python = m.options.python;
  const pluginSrc = path.join(integration, "plugin/src");
  m.writeToml("managed");
  const base = {
    SILICON_NOTEBOOK_UI_PLUGINS: UI_PACKAGE,
    EXTENSIONS_CONFIG: m.tomlFile,
    PYTHON_BIN: python,
  };
  const guards = [
    [
      "npm run test:node",
      "test-node",
      "npm",
      ["run", "test:node"],
      m.frontend,
      {},
    ],
    [
      "scripts/check_ui_vocabulary.py",
      "vocabulary",
      python,
      [path.join(nb, "scripts/check_ui_vocabulary.py")],
      nb,
      { PYTHONPATH: path.join(nb, "backend") },
    ],
    [
      "npm run typecheck",
      "typecheck",
      "npm",
      ["run", "typecheck"],
      m.frontend,
      {},
    ],
    [
      "scripts/cli.sh extensions check",
      "extensions-check",
      "bash",
      [path.join(nb, "scripts/cli.sh"), "extensions", "check"],
      nb,
      { PYTHONPATH: pluginSrc },
    ],
    [
      "scripts/check_deployment_extension_parity.py --frontend-contract frontend/.local/ui-extension-contract.json",
      "parity",
      python,
      [
        path.join(nb, "scripts/check_deployment_extension_parity.py"),
        "--frontend-contract",
        path.join(m.frontend, ".local/ui-extension-contract.json"),
      ],
      nb,
      { PYTHONPATH: `${path.join(nb, "backend")}:${pluginSrc}` },
    ],
  ];
  for (const [name, slug, command, args, cwd, extra] of guards) {
    m.refuseUnsafeClone(
      `L2 ${name}: the clone is safe to run it in`,
      [m.frontend],
      "built",
      { modules: true },
    );
    const result = await sandbox.run(command, args, {
      cwd,
      name: `l2-${slug}`,
      env: sandbox.env({ ...base, ...extra }, { envFile: false }),
      timeoutMs: 900_000,
    });
    // node --test's own summary lines, e.g. "ℹ pass 3279".
    const counts = (result.output.match(/^\S+ (?:pass|fail) \d+$/gmu) ?? [])
      .map((line) => line.replace(/^\S+ /u, ""))
      .join(", ");
    report.check(
      `L2 silicon-notebook's ${name} passes in the clone${counts ? ` (${counts})` : ""}`,
      result.status === 0 && !result.timedOut,
      () =>
        `${result.timedOut ? "timed out" : `exit ${result.status}`}\n${tail(result.output, 30)}`,
    );
  }
}

// ---- The browser ---------------------------------------------------------------

/** `ps -A`: [{ pid, ppid, command }] of every process, or undefined. */
function processTable() {
  try {
    return execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line))
      .filter(Boolean)
      .map(([, pid, ppid, command]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        command,
      }));
  } catch {
    return undefined;
  }
}

/** The processes whose command line names `profile` (undefined: unreadable). */
const profileProcesses = (profile) =>
  processTable()?.filter((entry) => entry.command.includes(profile));

/**
 * A listener of the run that browsers use as their proxy: Chrome sends it
 * whatever would leave 127.0.0.1 (127.0.0.1 itself bypasses the proxy), and
 * it only records the attempt and closes the connection.
 */
async function tripwire(m) {
  const port = await m.sandbox.freePort();
  const attempts = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("data", (chunk) => {
      const line = chunk.toString("latin1").split("\r\n")[0] ?? "";
      // "CONNECT host:port HTTP/1.1" or "GET http://host/… HTTP/1.1": only
      // the host is kept.
      const target = line.split(" ")[1] ?? "";
      attempts.push(target.replace(/^[a-z]+:\/\//iu, "").split("/")[0]);
      socket.destroy();
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    attempts,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

let chromiumModule;
const chromium = () =>
  (chromiumModule ??= createRequire(path.join(repo, "package.json"))(
    "@playwright/test",
  ).chromium);

/**
 * The stage's browsers: each `open(label)` launches Chrome with a fresh
 * profile `<sandbox>/browser-<n>` and records its process (this script's
 * child whose command line names the profile) before anything else happens.
 * `close(session, ms)` closes it within `ms`, then ends a recorded process
 * that is still the one recorded (its group, which it leads, by SIGKILL), and
 * reports whether any process of the profile is left. `closeOpen(ms)` does
 * that for the one still open, for the cleanup.
 */
function browserSessions(m) {
  const { sandbox, report } = m;
  let count = 0;
  let open;
  const close = async (session, ms, label) => {
    if (!session || session.closed) return;
    session.closed = true;
    if (open === session) open = undefined;
    await Promise.race([
      session.context?.close().catch(() => undefined),
      sleep(Math.max(0, ms)),
    ]);
    await session.proxy?.close();
    const { recorded } = session;
    if (recorded && identityOf(recorded.pid) === recorded.identity) {
      try {
        process.kill(
          groupOf(recorded.pid) === recorded.pid ? -recorded.pid : recorded.pid,
          "SIGKILL",
        );
      } catch {
        // gone meanwhile
      }
    }
    const gone = await waitFor(
      () => profileProcesses(session.profile)?.length === 0,
      5000,
      200,
    );
    report.check(
      `${label} the browser is closed: no process of its profile ${sandbox.label(session.profile)} is left`,
      gone,
      () =>
        `still running: ${(profileProcesses(session.profile) ?? []).map((entry) => entry.pid).join(", ") || "(the process table could not be read)"}`,
    );
  };
  return {
    async open(label) {
      count += 1;
      const profile = path.join(sandbox.root, `browser-${count}`);
      sandbox.makeDir(profile);
      const session = { profile, blocked: [], lost: [], closed: false };
      open = session;
      session.proxy = await tripwire(m);
      const launching = chromium().launchPersistentContext(profile, {
        channel: "chrome",
        headless: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        timeout: 60_000,
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
        proxy: {
          server: `http://127.0.0.1:${session.proxy.port}`,
          bypass: "127.0.0.1",
        },
        env: {
          PATH: process.env.PATH ?? "",
          HOME: path.join(sandbox.root, "home"),
          TMPDIR: path.join(sandbox.root, "t"),
        },
      });
      // Recorded as soon as it exists, while the launch is still connecting.
      void waitFor(
        () => {
          const child = processTable()?.find(
            (entry) =>
              entry.ppid === process.pid &&
              entry.command.includes(`--user-data-dir=${profile}`),
          );
          if (child && !session.recorded) {
            const identity = identityOf(child.pid);
            if (identity?.includes(profile))
              session.recorded = { pid: child.pid, identity };
          }
          return (
            Boolean(session.recorded) ||
            session.closed ||
            Boolean(session.launchError)
          );
        },
        60_000,
        100,
      );
      session.context = await launching.catch((error) => {
        session.launchError = String(error?.message ?? error).split("\n")[0];
        return undefined;
      });
      await waitFor(() => session.recorded || session.launchError, 5000, 50);
      if (
        !report.check(
          `${label} Chrome (headless, the system channel) runs with a fresh profile in the sandbox, its process recorded`,
          session.context && session.recorded,
          () =>
            session.launchError ||
            "no child process with the profile on its command line was found",
        )
      ) {
        await close(session, 10_000, label);
        return undefined;
      }
      // The interrupt check waits for this line.
      report.note(
        `${label} the browser is open (pid ${session.recorded?.pid}, profile ${sandbox.label(profile)})`,
      );
      return session;
    },
    close,
    closeOpen: (ms) => close(open, Math.min(ms, 10_000), "cleanup:"),
  };
}

/**
 * The page's network for one session: every request to anything but the
 * clone's web origin is aborted and recorded; a request to it is sent only
 * while the web, api and canvas listeners are the recorded pids (the gate
 * every request of the stage goes through). WebSockets are refused and
 * recorded. Every request to `/canvas/api/` is kept with whether it carried
 * `Authorization: Bearer <token>` (compared, never printed).
 */
async function guardNetwork(m, session, { up, canvasPid, token }) {
  const { context } = session;
  const origin = `http://127.0.0.1:${m.webPort}`;
  const held = () =>
    [
      [m.webPort, up.frontendPid],
      [m.apiPort, up.backendPid],
      [m.canvasPort, canvasPid],
    ].every(
      ([port, pid]) => m.sandbox.listenerState(port, pid).state === "owned",
    );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      session.blocked.push(`${url.protocol}//${url.host}`);
      return route.abort("blockedbyclient");
    }
    if (!held()) {
      session.lost.push(url.pathname);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await context.routeWebSocket(
    () => true,
    (ws) => {
      const url = new URL(ws.url());
      session.blocked.push(`websocket ${url.protocol}//${url.host}`);
      void ws.close();
    },
  );
  session.canvasApi = [];
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin === origin && url.pathname.startsWith("/canvas/api/"))
      session.canvasApi.push(
        req
          .allHeaders()
          .then((headers) => headers.authorization === `Bearer ${token}`)
          .catch(() => false),
      );
  });
  session.console = [];
  context.on("console", (message) =>
    session.console.push(`${message.type()}: ${message.text()}`),
  );
  await context.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // the page reports a missing session itself
      }
    },
    { key: TOKEN_KEY, value: token },
  );
}

/**
 * The session's network verdicts. A page request to anything but the clone's
 * web origin fails the stage. The browser's own background connections
 * (Chrome's update and account services) went to the run's recording proxy,
 * which refuses them and forwards nothing; they are listed, not failed.
 */
function networkChecks(m, session, label) {
  const { report } = m;
  report.check(
    `${label} the page requested nothing but the clone's web origin (any other request aborted and recorded)`,
    session.blocked.length === 0,
    () => `aborted: ${[...new Set(session.blocked)].join(", ")}`,
  );
  report.info(
    `${label} the browser's own connections outside 127.0.0.1, refused by the run's recording proxy (nothing forwarded): ${[...new Set(session.proxy.attempts)].join(", ") || "none"}`,
  );
  report.check(
    `${label} every request to the web origin was sent while the web, api and canvas listeners were the recorded ones`,
    session.lost.length === 0,
    () =>
      `aborted with a changed listener: ${session.lost.slice(0, 5).join(", ")}`,
  );
}

/** The `GET /api/system/extensions` row of the contribution, or a problem. */
async function extensionsRow(response, contribution) {
  let body;
  try {
    body = await response.json();
  } catch {
    return { problem: `status ${response.status()}, not JSON` };
  }
  const rows = (body?.extensions ?? []).filter(
    (row) =>
      row?.plugin_id === contribution.plugin_id &&
      row.version === contribution.version &&
      row.contribution_id === contribution.id,
  );
  if (response.status() !== 200 || body?.api_version !== "1")
    return {
      problem: `status ${response.status()}, api_version ${body?.api_version}`,
    };
  if (rows.length !== 1) return { problem: `${rows.length} matching rows` };
  return {
    row: rows[0],
    problem:
      rows[0].available === true
        ? ""
        : `available ${rows[0].available} (${rows[0].unavailable_reason})`,
  };
}

/** Saves the page's screenshot into the sandbox; returns the path. */
async function keepScreenshot(m, page, name) {
  try {
    const file = path.join(m.sandbox.root, `${name}.png`);
    m.sandbox.writeFile(file, await page.screenshot({ timeout: 10_000 }));
    return file;
  } catch (error) {
    return `(no screenshot: ${error.message})`;
  }
}

/** The session's console, kept in the sandbox only (redacted). */
function keepConsole(m, session, name) {
  try {
    m.sandbox.writeFile(
      path.join(m.sandbox.root, `${name}-console.log`),
      m.report.clean(session.console.join("\n")),
    );
  } catch {
    // the console is a diagnostic only
  }
}

/** Runs `step`; an exception (a Playwright timeout) is its failure, named. */
async function attempt(step) {
  try {
    return { value: await step(), error: "" };
  } catch (error) {
    return { error: String(error?.message ?? error).split("\n")[0] };
  }
}

// ---- L3–L5: the launch, the entry, the canvas, the stop ---------------------

async function entryRun(m, browsers, contribution) {
  const { report } = m;
  const run = await launchClone(m, "L3", "managed");
  let stopInfo = { launch: run.launch };
  let session;
  try {
    if (!run.up) return false;
    const { service, ok } = await checkManagedService(m, run, "L3");
    stopInfo = service.stopInfo;
    if (!ok) return false;
    const user = await probing(m, "L3", async () => {
      const a = await register(m, run.up.getProxied, "a");
      if (
        !report.check(
          "L3 user A registers through web",
          a.status === 200 && a.token && a.id,
          `status ${a.status}`,
        )
      )
        return false;
      const name = `L notebook ${hex(3)}`;
      const created = await request(run.up.getProxied, "/api/notebooks", {
        method: "POST",
        token: a.token,
        json: { name },
      });
      const notebookId = parsed(created)?.id;
      if (
        !report.check(
          "L3 A creates a notebook through POST /api/notebooks -> 200 with its id",
          created.status === 200 &&
            typeof notebookId === "string" &&
            notebookId,
          `status ${created.status}, body ${tail(report.clean(created.body), 3)}`,
        )
      )
        return false;
      return { ...a, notebookId };
    });
    if (!user) return false;
    session = await browsers.open("L4");
    if (!session) return false;
    const verdict = await entryInBrowser(m, session, {
      up: run.up,
      canvasPid: service.canvasPid,
      user,
      contribution,
    });
    await browsers.close(session, 10_000, "L4");
    networkChecks(m, session, "L4");
    if (verdict.failed) {
      keepConsole(m, session, "l4");
      for (const file of verdict.screenshots)
        report.info(
          `L4 screenshot (in the sandbox; kept with --keep): ${file}`,
        );
    }
    return user;
  } finally {
    if (session) await browsers.close(session, 10_000, "L4");
    run.stopWatch?.();
    await stopAll(m, "L5", stopInfo);
  }
}

/**
 * L4 in the browser, signed in as A: the notebook's side panel shows the
 * entry, `/api/system/extensions` (observed) holds its row available; the
 * click navigates to /canvas, the editor mounts, and a request to
 * `/canvas/api/…` carried A's token.
 */
async function entryInBrowser(
  m,
  session,
  { up, canvasPid, user, contribution },
) {
  const { report } = m;
  await guardNetwork(m, session, { up, canvasPid, token: user.token });
  const page = session.context.pages()[0] ?? (await session.context.newPage());
  page.setDefaultTimeout(60_000);
  let failed = false;
  const check = (name, condition, detail) => {
    if (!report.check(name, condition, detail)) failed = true;
  };
  // Written into the sandbox only when a check of this run fails.
  const kept = async (panelImage) => {
    const files = [];
    if (panelImage) files.push(writeImage(m, "l4-side-panel", panelImage));
    files.push(await keepScreenshot(m, page, "l4-canvas"));
    return files;
  };
  const extensions = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/system/extensions",
      { timeout: 60_000 },
    )
    .catch(() => undefined);
  const opened = await attempt(async () => {
    await page.goto(
      `http://127.0.0.1:${m.webPort}/#notebook=${user.notebookId}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await page
      .getByRole("button", { name: ENTRY_NAME, exact: true })
      .waitFor({ state: "visible" });
  });
  check(
    `L4 the opened notebook's side panel shows the button ${ENTRY_NAME}`,
    !opened.error,
    opened.error,
  );
  const panelImage = await page
    .screenshot({ timeout: 10_000 })
    .catch(() => undefined);
  const seen = await extensions;
  const row = seen
    ? await extensionsRow(seen, contribution)
    : { problem: "no response observed" };
  check(
    "L4 GET /api/system/extensions (observed in the page) holds the entry's row, available",
    !row.problem,
    row.problem,
  );
  if (opened.error)
    return { failed: true, screenshots: await kept(panelImage) };
  // A new user's first notebook shows the Sources panel's one-time hint
  // (给阅读多留一点空间) over the tool row, where the entry is: dismissed as
  // the user would, with its own 知道了.
  const hint = page.getByRole("button", { name: "知道了", exact: true });
  const dismissed = await hint
    .waitFor({ state: "visible", timeout: 5000 })
    .then(
      () => hint.click().then(() => true),
      () => false,
    )
    .catch(() => false);
  report.info(
    `L4 the Sources panel's first-visit hint ${dismissed ? "was shown and dismissed (知道了)" : "was not shown"}`,
  );
  const clicked = await attempt(async () => {
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/canvas" || url.pathname.startsWith("/canvas/"),
        { waitUntil: "commit" },
      ),
      page.getByRole("button", { name: ENTRY_NAME, exact: true }).click(),
    ]);
    return new URL(page.url()).pathname;
  });
  check(
    `L4 the click navigates to /canvas${clicked.value ? ` (path ${clicked.value})` : ""}`,
    !clicked.error &&
      ["/canvas", "/canvas/", "/canvas/editor"].includes(clicked.value),
    clicked.error || `path ${clicked.value}`,
  );
  const mounted = await attempt(() =>
    page
      .locator('[data-testid="schematic-canvas"]')
      .waitFor({ state: "visible" }),
  );
  check(
    'L4 the canvas editor mounts ([data-testid="schematic-canvas"])',
    !mounted.error,
    mounted.error,
  );
  const bearers = await Promise.all(session.canvasApi);
  check(
    `L4 a request to /canvas/api/… carried A's notebook token as its bearer (${bearers.filter(Boolean).length} of ${bearers.length} requests)`,
    bearers.some(Boolean),
    `${bearers.length} request(s) to /canvas/api/, none with A's token`,
  );
  if (failed) return { failed, screenshots: await kept(panelImage) };
  return { failed, screenshots: [] };
}

/** Writes a screenshot taken earlier into the sandbox; returns the path. */
function writeImage(m, name, image) {
  try {
    const file = path.join(m.sandbox.root, `${name}.png`);
    m.sandbox.writeFile(file, image);
    return file;
  } catch (error) {
    return `(no screenshot: ${error.message})`;
  }
}

// ---- L6–L8: the rollback -------------------------------------------------------

/**
 * L6: the rebuild without `SILICON_NOTEBOOK_UI_PLUGINS` (both targets kept):
 * the sync removes the copy and writes the empty registry, and the contract
 * loses the row.
 */
async function rollbackBuild(m) {
  const { sandbox, report } = m;
  resetRuntime(m);
  removeNext(sandbox, m.frontend);
  if (
    !(await buildWithTarget(m, {
      label: "L6",
      name: "l6-build",
      extra: SAME_ORIGIN_API,
      what: "both targets, without the UI package,",
    }))
  )
    return false;
  const copyGone =
    sandbox
      .listDir(path.join(m.frontend, "features"))
      .filter((entry) => entry.name.startsWith("ext-")).length === 0;
  const registry =
    cloneText(m, "frontend/features/extension-sdk/registry.local.ts") ?? "";
  report.check(
    "L6 the sync removed frontend/features/ext-auto-canvas and wrote the empty registry.local.ts",
    copyGone && registry.includes(EMPTY_REGISTRY) && !registry.includes("ext-"),
    `copy gone ${copyGone}; registry ${tail(registry, 4)}`,
  );
  const rows = contractRows(m);
  report.check(
    "L6 the frontend contract no longer holds a row of auto_canvas.integration",
    Array.isArray(rows) &&
      !rows.some((row) => row?.plugin_id === "auto_canvas.integration"),
    `rows ${JSON.stringify(rows)}`,
  );
  return true;
}

/**
 * L7: the same notebook as A after the rollback: the Sources panel's 添加来源
 * shows and 打开电路画布 does not (absent for 3 s after the panel); the
 * backend's row is unchanged (only the UI package went). L8 stops.
 */
async function rollbackRun(m, browsers, contribution, user) {
  const { report } = m;
  const run = await launchClone(m, "L7", "managed");
  let stopInfo = { launch: run.launch };
  let session;
  try {
    if (!run.up) return false;
    const { service, ok } = await checkManagedService(m, run, "L7");
    stopInfo = service.stopInfo;
    if (!ok) return false;
    const me = await probing(m, "L7", () =>
      request(run.up.getProxied, "/api/me", { token: user.token }),
    );
    if (
      !report.check(
        "L7 A's session and notebook survived the relaunch (/api/me with A's token -> 200 with A's id)",
        me && me.status === 200 && parsed(me)?.id === user.id,
        `status ${me?.status}`,
      )
    )
      return false;
    session = await browsers.open("L7");
    if (!session) return false;
    await guardNetwork(m, session, {
      up: run.up,
      canvasPid: service.canvasPid,
      token: user.token,
    });
    const page =
      session.context.pages()[0] ?? (await session.context.newPage());
    page.setDefaultTimeout(60_000);
    const extensions = page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/system/extensions",
        { timeout: 60_000 },
      )
      .catch(() => undefined);
    const panel = await attempt(async () => {
      await page.goto(
        `http://127.0.0.1:${m.webPort}/#notebook=${user.notebookId}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      await page
        .locator("button.add-source-button", { hasText: "添加来源" })
        .waitFor({ state: "visible" });
    });
    let failed = !report.check(
      "L7 the same notebook opens as A: the Sources panel's 添加来源 shows",
      !panel.error,
      panel.error,
    );
    const seen = await extensions;
    const row = seen
      ? await extensionsRow(seen, contribution)
      : { problem: "no response observed" };
    report.check(
      "L7 GET /api/system/extensions still holds the entry's row, available (only the UI package was removed)",
      !row.problem,
      row.problem,
    );
    if (!panel.error) {
      let shown = 0;
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        shown = Math.max(
          shown,
          await page
            .getByRole("button", { name: ENTRY_NAME, exact: true })
            .count(),
        );
        await sleep(250);
      }
      if (
        !report.check(
          `L7 ${ENTRY_NAME} is absent for 3 s after the panel showed`,
          shown === 0,
          `${shown} button(s) named ${ENTRY_NAME}`,
        )
      )
        failed = true;
    }
    if (failed)
      report.info(
        `L7 screenshot (in the sandbox; kept with --keep): ${await keepScreenshot(m, page, "l7-side-panel")}`,
      );
    await browsers.close(session, 10_000, "L7");
    networkChecks(m, session, "L7");
    if (failed) keepConsole(m, session, "l7");
    return true;
  } finally {
    if (session) await browsers.close(session, 10_000, "L7");
    run.stopWatch?.();
    await stopAll(m, "L8", stopInfo);
  }
}

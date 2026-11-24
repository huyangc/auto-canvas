// Stage M: a managed start of this checkout's canvas inside a disposable
// silicon-notebook clone. The clone is built with the `/canvas` rewrite and
// configured with the auto-canvas plugin; silicon-notebook's own launcher
// (`npm run start`, scripts/prod.sh) starts the canvas as a companion
// service. Two notebook users get separate, authenticated canvases through
// the notebook's origin; sign-out and stop are observed; then the external
// mode with a misrouted upstream, and the partial and full rollbacks.
//
// Everything silicon-notebook runs is the clone in the sandbox. The canvas is
// this checkout (its builds must exist). The companion processes leave the
// launcher's process group by design (`start_new_session`): they are stopped
// through the clone's `scripts/extension_services.py stop` and, as a last
// resort, by the pids this run recorded — never by port or by name, and never
// through silicon-notebook's `npm run stop`, which kills by port.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  awaitLaunch,
  cloneGuards,
  cloneRevision,
  commandOf,
  copyModules,
  groupOf,
  makeBuild,
  makeLocal,
  pidAlive,
  Refused,
  refuseUnsafeStart,
  removeNext,
  sha256,
  stopLaunch,
} from "./notebook-clone.mjs";
import { waitFor } from "./sandbox.mjs";
import {
  guardLoaded,
  ownershipGate,
  OwnershipLost,
  StageAborted,
  tail,
  tripleGate,
} from "./steps.mjs";
import {
  expectDestinations,
  expectRewrites,
  readManifest,
  todaysRules,
} from "./transport.mjs";

const repo = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const integration = path.join(repo, "integrations/silicon-notebook");
const SERVICE_KEY = "auto_canvas.integration/canvas";
const READY = "/@notebook/canvas/api/integration/ready.json";

// A value the canvas's `.env` grammar accepts unquoted
// (apps/server/src/guarded-database.ts): no whitespace and no shell syntax.
const ENV_VALUE = /^[^\s$`\\"';&|<>(){}*?[\]~#!]+$/u;

/** The builds the canvas needs, and a repository path the `.env` can name. */
const BUILDS = [
  ["apps/server/dist/cli.js", "pnpm build"],
  ["apps/editor/dist/index.html", "pnpm build"],
  ["apps/editor/dist-notebook/index.html", "pnpm build:notebook-editor"],
];

/**
 * Why stage M cannot run from this checkout, before anything is allocated
 * (the entry script exits 2 with these): a missing build, or a repository
 * path the notebook's `.env` cannot hold as a literal value.
 */
export function stageMPrerequisites() {
  const problems = [];
  for (const [file, command] of BUILDS)
    if (!fs.existsSync(path.join(repo, file)))
      problems.push(`stage M needs ${file}; run ${command} first`);
  const plugin = path.join(integration, "plugin/src");
  if (!ENV_VALUE.test(plugin) || /["\\]/u.test(repo))
    problems.push(
      "stage M needs a repository path without whitespace, quotes, backslashes or shell syntax (silicon-notebook's .env names it unquoted)",
    );
  return problems;
}

/** A reporter whose every line is passed through `clean` first. */
function redacting(report, secrets) {
  const clean = (text) => {
    let out = String(text);
    for (const secret of secrets)
      if (secret) out = out.split(secret).join("<redacted>");
    return out;
  };
  return {
    ok: (name) => report.ok(clean(name)),
    fail: (name, detail) => report.fail(clean(name), clean(detail)),
    check(name, condition, detail) {
      if (condition) this.ok(name);
      else this.fail(name, typeof detail === "function" ? detail() : detail);
      return Boolean(condition);
    },
    note: (line) => report.note(clean(line)),
    info: (line) => report.info(clean(line)),
    summary: (stage) => report.summary(stage),
    clean,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const digits = (count) =>
  Array.from({ length: count }, () => crypto.randomInt(10)).join("");
const parsed = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return undefined;
  }
};

/** One `ps -o <field>=…` reading of a pid, or undefined when it is gone. */
function psOf(fields, pid) {
  try {
    return execFileSync(
      "ps",
      [...fields.flatMap((field) => ["-o", `${field}=`]), "-p", String(pid)],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
      },
    ).trim();
  } catch {
    return undefined;
  }
}

/** `ps -o lstart= -o command=`: a pid's identity, or undefined when it is gone. */
const identityOf = (pid) => psOf(["lstart", "command"], pid);

/** The managed canvas's command line, as serve.sh starts it. */
const CANVAS_COMMAND =
  /(?:^|[\s/])apps\/server\/dist\/cli\.js --require-canvas-database$/u;
/** How many parents the descent check reads before it gives up. */
const ANCESTRY_LIMIT = 16;

/**
 * Why `pid` is not the canvas of the service worker `workerPid`, or "": it
 * must descend from the worker (its parent chain, read with `ps -o ppid=`,
 * reaches the worker within ANCESTRY_LIMIT steps), be in the worker's process
 * group, and run `… apps/server/dist/cli.js --require-canvas-database`.
 */
function canvasOwnershipProblem(pid, workerPid) {
  if (!(workerPid > 0)) return "has no recorded service worker to descend from";
  let at = pid;
  let descends = false;
  for (let step = 0; step < ANCESTRY_LIMIT && !descends; step += 1) {
    const parent = Number(psOf(["ppid"], at));
    if (!(parent > 1)) break;
    descends = parent === workerPid;
    at = parent;
  }
  if (!descends)
    return `is not a descendant of the service worker ${workerPid}`;
  const group = groupOf(pid);
  const workerGroup = groupOf(workerPid);
  if (!(group > 0) || group !== workerGroup)
    return `is in process group ${group}, not the service worker's (${workerGroup})`;
  const command = psOf(["command"], pid) ?? "";
  if (!CANVAS_COMMAND.test(command))
    return `runs ${JSON.stringify(command)}, not node apps/server/dist/cli.js --require-canvas-database`;
  return "";
}

/**
 * The listener of the canvas port, verified as the canvas of the service
 * worker before anything records it: `record(name, pid, identity)` is called
 * only for a listener that passes `canvasOwnershipProblem` and kept its
 * identity while it was checked. Anything else is never recorded (so never
 * signalled); `problem` names it. Returns `{ canvasPid, listeners, problem }`,
 * `canvasPid` 0 unless recorded.
 */
export function managedCanvas({ sandbox, canvasPort, workerPid, record }) {
  const listeners = sandbox.listenerPids(canvasPort);
  if (listeners.length !== 1)
    return {
      canvasPid: 0,
      listeners,
      problem: `the canvas port ${canvasPort} has ${listeners.length ? `listeners ${listeners.join(", ")}` : "no listener"}`,
    };
  const [pid] = listeners;
  const identity = identityOf(pid);
  const problem =
    identity === undefined
      ? "is gone"
      : canvasOwnershipProblem(pid, workerPid) ||
        (identityOf(pid) === identity ? "" : "changed while it was checked");
  if (problem)
    return {
      canvasPid: 0,
      listeners,
      problem: `listener ${pid} of the canvas port ${problem}: not recorded, never signalled`,
    };
  record("canvas", pid, identity);
  return { canvasPid: pid, listeners, problem: "" };
}

/** A probe of a process group (signal 0 sends nothing). */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * A one-shot command as a direct child of this script, bounded: at the limit
 * it is killed by its own pid (this script's child). Unlike `sandbox.run` it
 * also works while the sandbox is closing, so the cleanup after an interrupt
 * can still ask the clone to stop its companion services.
 */
function runBounded(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ status: -1, output: error.message, timedOut });
      return;
    }
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ status: -1, output: `${output}${error.message}`, timedOut });
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, output, timedOut });
    });
  });
}

/** Builds a three-resistor Project text with the canvas's own packages. */
async function projectTextBuilder() {
  const serverRequire = createRequire(
    path.join(repo, "apps/server/package.json"),
  );
  const load = (name) =>
    import(pathToFileURL(serverRequire.resolve(name)).href);
  const { createEmptyProject } = await load("@icm/model");
  const { serializeProject } = await load("@icm/project-protocol");
  return (name) => {
    const project = createEmptyProject(`m-${hex(4)}`, name);
    for (const [index, x] of [100, 200, 300].entries())
      project.documents[0].instances.push({
        id: `R${index + 1}`,
        symbolId: "resistor",
        placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
      });
    return serializeProject(project);
  };
}

/** The extensions TOML variants, derived from the shipped examples. */
function tomlVariants({ apiPort, canvasPort, envFile, logFile }) {
  const string = (value) => JSON.stringify(value);
  const derive = (file, replacements) => {
    let text = fs.readFileSync(path.join(integration, file), "utf8");
    for (const [from, to] of replacements) {
      if (text.split(from).length !== 2)
        throw new Error(`${file} no longer holds ${from} exactly once`);
      text = text.replace(from, to);
    }
    const settings = text
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    // The example's defaults (the owner's ports, /opt paths) must all be gone.
    if (
      /:4310\b|:8000\b|"4310"|"\/opt\/auto-canvas"|"\/opt\/silicon-notebook/u.test(
        settings,
      )
    )
      throw new Error(`${file}: a default value is left after the changes`);
    return text;
  };
  const healthcheck = `http://127.0.0.1:${canvasPort}/@notebook/canvas/api/integration/ready.json`;
  return {
    managed: derive("extensions.example.toml", [
      ['cwd = "/opt/auto-canvas"', `cwd = ${string(repo)}`],
      [
        'healthcheck_url = "http://127.0.0.1:4310/@notebook/canvas/api/integration/ready.json"',
        `healthcheck_url = ${string(healthcheck)}\nshutdown_timeout_seconds = 2`,
      ],
      [
        'AUTO_CANVAS_NOTEBOOK_API = "http://127.0.0.1:8000"',
        `AUTO_CANVAS_NOTEBOOK_API = ${string(`http://127.0.0.1:${apiPort}`)}`,
      ],
      [
        'AUTO_CANVAS_NOTEBOOK_ENV_FILE = "/opt/silicon-notebook/.env"',
        `AUTO_CANVAS_NOTEBOOK_ENV_FILE = ${string(envFile)}`,
      ],
      [
        'AUTO_CANVAS_PORT = "4310"',
        `AUTO_CANVAS_PORT = ${string(String(canvasPort))}\n` +
          `AUTO_CANVAS_LOG_FILE = ${string(logFile)}\n` +
          `AUTO_CANVAS_NODE = ${string(process.execPath)}`,
      ],
    ]),
    external: derive("extensions.external.example.toml", [
      [
        'healthcheck_url = "http://127.0.0.1:4310/@notebook/canvas/api/integration/ready.json"',
        `healthcheck_url = ${string(healthcheck)}`,
      ],
    ]),
    // The plugin entry removed: EXTENSIONS_CONFIG names a file without a table.
    none: "# The auto-canvas plugin entry is removed (stage M rollback).\n",
  };
}

export async function stageM(context) {
  // Every token, password and database URL the stage makes or reads is added
  // here as soon as it exists; no line the stage prints holds one.
  const secrets = [];
  const report = redacting(context.report, secrets);
  try {
    await stageMBody({ ...context, report, secrets });
  } catch (error) {
    // A refused file operation (PathRefused) is caught by the entry script,
    // which reports it once and ends the run with exit status 2.
    if (!(error instanceof Refused)) throw error;
    context.refused = true;
  }
}

// ---- The stage -------------------------------------------------------------
//
// One context object `m` carries what the phases share: the sandbox and the
// report, the stage's own bookkeeping for the cleanup, and, once the set-up
// has run, the ports, the database URLs, the build and the probes' helpers.
// Each phase returns false when the stage must stop there (its failure is
// already reported); a phase's own probes that fail do not stop the stage.

async function stageMBody({ sandbox, report, secrets, notebook, options }) {
  const m = stageState({ sandbox, report, secrets, notebook, options });
  sandbox.beforeDispose(m.cleanup);
  try {
    if (!(await setUp(m))) return;
    if (!(await managedRun(m))) return;
    m.say(`     managed run done after ${m.elapsed()}`);
    if (!(await externalRun(m))) return;
    m.say(`     external run done after ${m.elapsed()}`);
    await rolledBack(m, "M-a", withoutTheEntry);
    m.say(
      `     partial rollback (plugin entry removed) done after ${m.elapsed()}`,
    );
    if (!(await secondBuild(m))) return;
    if (!(await targetlessRun(m))) return;
    m.say(`     partial rollback (target removed) done after ${m.elapsed()}`);
    await rolledBack(m, "M-full", withoutBoth);
    m.say(`     full rollback done after ${m.elapsed()}`);
  } finally {
    await m.cleanup();
    m.say(`     stage M took ${m.elapsed()}`);
  }
}

/**
 * The databases a run creates, in step with its shutdown. `create(client,
 * name)` issues `CREATE DATABASE` only before the shutdown began (after it, it
 * throws StageAborted and sends nothing) and records the name once the create
 * succeeded, also when that is after the shutdown began. `shutdown(cancel)`
 * marks the shutdown at once and resolves when every create in flight has
 * settled: it waits `settleMs`, asks `cancel(backendPids)` to cancel the
 * creates still running, and waits `settleMs` again. It resolves to
 * `{ created, unsettled }`: every name to drop, and the names whose create
 * had still not settled.
 */
export function databaseLedger({ settleMs = 10_000 } = {}) {
  const created = [];
  const pending = new Map(); // promise -> { name, backendPid }
  let shutdown;
  const settledWithin = (ms) =>
    pending.size === 0
      ? Promise.resolve()
      : Promise.race([Promise.allSettled([...pending.keys()]), sleep(ms)]);
  return {
    created,
    async create(client, name) {
      if (shutdown)
        throw new StageAborted(
          `the shutdown has begun: database ${name} is not created`,
        );
      const attempt = client.query(`CREATE DATABASE ${name}`).then(() => {
        created.push(name);
      });
      pending.set(attempt, { name, backendPid: client.processID });
      try {
        await attempt;
      } finally {
        pending.delete(attempt);
      }
    },
    shutdown(cancel = async () => undefined) {
      shutdown ??= (async () => {
        await settledWithin(settleMs);
        if (pending.size) {
          try {
            await cancel(
              [...pending.values()].map((entry) => entry.backendPid),
            );
          } catch {
            // the second wait decides
          }
          await settledWithin(settleMs);
        }
        return {
          created: [...created],
          unsettled: [...pending.values()].map((entry) => entry.name),
        };
      })();
      return shutdown;
    },
  };
}

/** The stage's bookkeeping, its database access and its cleanup. */
function stageState({ sandbox, report, secrets, notebook, options }) {
  const started = Date.now();
  const nb = path.join(sandbox.root, "nb");
  const m = {
    sandbox,
    report,
    secrets,
    notebook,
    options,
    nb,
    frontend: path.join(nb, "frontend"),
    envFile: path.join(nb, ".env"),
    say: (line) => console.log(report.clean(line)),
    elapsed: () => `${Math.round((Date.now() - started) / 1000)} s`,
    databases: databaseLedger(), // the databases this run created
    groups: [], // process groups this stage started (launchers, canvases)
    companions: new Map(), // pid -> { name, pid, identity }
    launched: false,
    adminUrl:
      process.env.AUTO_CANVAS_TEST_DATABASE_URL ??
      "postgresql:///auto_canvas_test",
  };
  secrets.push(m.adminUrl);
  m.recordCompanion = (name, pid, identity = identityOf(pid)) => {
    if (!(pid > 0) || m.companions.has(pid)) return;
    m.companions.set(pid, { name, pid, identity });
  };
  const pg = createRequire(path.join(repo, "apps/server/package.json"))("pg");
  m.withClient = async (connectionString, work) => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  };
  // The clone's own stop command, bounded; it also works while the sandbox
  // is closing (after an interrupt).
  m.extensionStop = async (label) => {
    const result = await runBounded(
      options.python,
      [path.join(nb, "scripts/extension_services.py"), "stop"],
      {
        cwd: nb,
        env: sandbox.env({ PYTHON_BIN: options.python }, { envFile: false }),
        timeoutMs: 40_000,
      },
    );
    return report.check(
      `${label} extension_services.py stop ends the companion services`,
      result.status === 0 && !result.timedOut,
      () =>
        `${result.timedOut ? "timed out after 40 s" : `exit ${result.status ?? result.signal}`}\n${tail(result.output, 8)}`,
    );
  };
  // The cleanup: once, in this order, each step bounded and reported; it runs
  // from the stage's finally and, after an interrupt, from the sandbox's
  // disposal before any group is stopped or the root removed.
  let cleaning;
  m.cleanup = () => (cleaning ??= cleanUp(m));
  return m;
}

/** A recorded companion that is still the process this run recorded. */
const stillRecorded = (entry) =>
  entry.identity !== undefined && identityOf(entry.pid) === entry.identity;

async function cleanUp(m) {
  const { sandbox, report } = m;
  // First, synchronously: no CREATE DATABASE starts from here on (the drop
  // at the end waits for those in flight).
  const withAdmin = (work) => m.withClient(m.adminUrl, work);
  void m.databases.shutdown(cancelCreates(withAdmin));
  if (m.launched && fs.existsSync(path.join(m.nb, "scripts")))
    await m.extensionStop("cleanup:");
  for (const pgid of m.groups)
    if (!(await sandbox.stopGroup(pgid)))
      report.fail(
        "cleanup: the stage's process groups are stopped",
        `process group ${pgid} still present`,
      );
  // By pid only, and only a process with the start time and command line this
  // run recorded for it.
  const alive = [...m.companions.values()].filter(stillRecorded);
  const signal = (name) => {
    for (const entry of alive)
      if (stillRecorded(entry))
        try {
          process.kill(entry.pid, name);
        } catch {
          // gone meanwhile
        }
  };
  signal("SIGTERM");
  await waitFor(() => !alive.some(stillRecorded), 5000, 100);
  signal("SIGKILL");
  const left = [...m.companions.values()].filter(stillRecorded);
  report.check(
    `cleanup: no recorded companion process is alive (${m.companions.size} recorded, ${alive.length} signalled by pid)`,
    left.length === 0,
    () => left.map((entry) => `${entry.name} ${entry.pid}`).join(", "),
  );
  await dropDatabases({
    databases: m.databases,
    withAdmin,
    report,
  });
}

/** The ledger's way to cancel the creates still running: by backend pid. */
const cancelCreates = (withAdmin) => async (pids) => {
  const backends = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
  if (backends.length)
    await withAdmin((client) =>
      client.query(
        "SELECT pg_catalog.pg_cancel_backend(pid) FROM unnest($1::int[]) AS pid",
        [backends],
      ),
    );
};

/**
 * The database part of the cleanup: the ledger's shutdown (no new create;
 * every create in flight settled, a straggler cancelled through `withAdmin`),
 * then every database a create recorded is dropped `WITH (FORCE)`, a create
 * that succeeded after the shutdown began included, and the result reported.
 */
export async function dropDatabases({ databases, withAdmin, report }) {
  const { created, unsettled } = await databases.shutdown(
    cancelCreates(withAdmin),
  );
  if (unsettled.length)
    report.fail(
      "cleanup: every CREATE DATABASE in flight settled before the drop",
      `still running after its cancellation: ${unsettled.join(", ")} (it may be left behind)`,
    );
  if (!created.length) return;
  let remaining;
  try {
    remaining = await withAdmin(async (client) => {
      for (const name of created)
        await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      const rows = await client.query(
        "SELECT datname FROM pg_catalog.pg_database WHERE datname = ANY ($1::text[])",
        [created],
      );
      return rows.rows.map((row) => row.datname);
    });
  } catch (error) {
    remaining = [`(the drop failed: ${error.message})`];
  }
  report.check(
    `cleanup: the stage's databases are dropped (${created.join(", ")})`,
    remaining.length === 0,
    () => `still present: ${remaining.join(", ")}`,
  );
}

// ---- M0 and M1: the clone, the databases, the files, the first build --------

async function setUp(m) {
  const { sandbox, report, secrets, nb } = m;
  const revision = await cloneRevision({
    sandbox,
    report,
    notebook: m.notebook,
    nb,
    ref: m.options.ref,
  });
  if (!revision) return false;
  const { git, candidate } = revision;
  const written = [];
  const { refuseUnsafeClone } = cloneGuards({ sandbox, report, nb, written });
  m.refuseUnsafeClone = refuseUnsafeClone;
  refuseUnsafeStart({ nb, refuseUnsafeClone, report });
  if (
    !(await copyModules({
      sandbox,
      report,
      notebook: m.notebook,
      nb,
      git,
      candidate,
    }))
  )
    return false;

  // Ports, never 3000, 8000 or 4310 (freePort refuses them).
  m.apiPort = await sandbox.freePort();
  m.webPort = await sandbox.freePort();
  m.canvasPort = await sandbox.freePort();
  m.api = `http://127.0.0.1:${m.apiPort}`;
  m.canvasOrigin = `http://127.0.0.1:${m.canvasPort}`;
  report.info(
    `ports: api ${m.apiPort}, web ${m.webPort}, canvas ${m.canvasPort}`,
  );

  // Databases: the canvas's, and the standalone canvas's of M-ext. Each name
  // is recorded only once it was created.
  const base = `auto_canvas_it_m_${hex(6)}`;
  const names = { canvas: base, standalone: `${base}_s` };
  let role;
  let pgPort;
  await m.withClient(m.adminUrl, async (client) => {
    // SHOW port: inet_server_port() is null over the lane's Unix socket.
    const who = await client.query(
      "SELECT current_user AS role, pg_catalog.current_setting('port') AS port",
    );
    role = who.rows[0].role;
    pgPort = who.rows[0].port;
    for (const name of [names.canvas, names.standalone])
      await m.databases.create(client, name);
  });
  const urlOf = (name) =>
    `postgresql://${encodeURIComponent(role)}@127.0.0.1:${pgPort}/${name}`;
  m.canvasUrl = urlOf(names.canvas);
  m.standaloneUrl = urlOf(names.standalone);
  secrets.push(m.canvasUrl, m.standaloneUrl);
  for (const [kind, name, url] of [
    ["canvas", names.canvas, m.canvasUrl],
    ["standalone canvas", names.standalone, m.standaloneUrl],
  ]) {
    const seen = await m.withClient(url, (client) =>
      client.query("SELECT pg_catalog.current_database() AS name"),
    );
    if (
      !report.check(
        `M0 the guarded URL of the ${kind} database reaches ${name}`,
        seen.rows[0]?.name === name,
        `current_database() is ${seen.rows[0]?.name}`,
      )
    )
      return false;
  }

  // The stage's own files: <clone>/.env (recorded with its hash, so the
  // clone refusals accept exactly it) and the extensions TOML.
  const tomlFile = path.join(sandbox.root, "extensions.toml");
  const adminPassword = hex(16);
  secrets.push(adminPassword);
  const envValues = [
    ["DATABASE_URL", "sqlite:///.local/silicon_notebook.db"],
    ["AUTO_CANVAS_DATABASE_URL", m.canvasUrl],
    ["PYTHONPATH", path.join(integration, "plugin/src")],
    ["EXTENSIONS_CONFIG", tomlFile],
    ["SILICON_NOTEBOOK_ADMIN_PASSWORD", adminPassword],
  ];
  const unfit = envValues.filter(([, value]) => !ENV_VALUE.test(value));
  if (unfit.length) {
    report.fail(
      "M0 the stage's .env holds literal values only",
      `${unfit.map(([key]) => key).join(", ")} would need quoting (nothing launched)`,
    );
    throw new Refused();
  }
  const envText = envValues.map(([key, value]) => `${key}=${value}\n`).join("");
  sandbox.writeFile(m.envFile, envText, 0o600);
  written.push({ relative: ".env", sha256: sha256(envText) });
  const toml = tomlVariants({
    apiPort: m.apiPort,
    canvasPort: m.canvasPort,
    envFile: m.envFile,
    logFile: path.join(sandbox.root, "canvas.log"),
  });
  m.writeToml = (kind) => sandbox.writeFile(tomlFile, toml[kind]);
  report.ok(
    "M0 the stage wrote <clone>/.env (literal lines, recorded hash) and the extensions TOML from the shipped examples",
  );

  // init-db.sh, under the sandbox, with the env-file key left out.
  const init = await sandbox.run(
    path.join(integration, "init-db.sh"),
    ["--notebook-root", nb],
    {
      cwd: sandbox.root,
      name: "m0-init-db",
      env: sandbox.env(
        {
          AUTO_CANVAS_DATABASE_URL: m.canvasUrl,
          AUTO_CANVAS_NODE: process.execPath,
        },
        { envFile: false },
      ),
      timeoutMs: 120_000,
    },
  );
  if (
    !report.check(
      "M0 init-db.sh --notebook-root <clone> exits 0 and says the database is initialised",
      init.status === 0 && init.output.includes("initialised"),
      () => `exit ${init.status}\n${tail(init.output, 10)}`,
    )
  )
    return false;
  const shipped = fs
    .readdirSync(path.join(repo, "apps/server/dist/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const ledger = await m.withClient(m.canvasUrl, (client) =>
    client.query("SELECT name FROM schema_migrations ORDER BY name"),
  );
  const applied = ledger.rows.map((row) => row.name);
  report.check(
    `M0 the canvas database holds the ${shipped.length}-name ledger of the shipped migrations`,
    shipped.length > 0 && JSON.stringify(applied) === JSON.stringify(shipped),
    `ledger ${JSON.stringify(applied)}, shipped ${JSON.stringify(shipped)}`,
  );

  // M1: the build with both targets.
  m.build = makeBuild({ sandbox, report, nb, refuseUnsafeClone });
  const built = await m.build(
    { BACKEND_PROXY_TARGET: m.api, CANVAS_PROXY_TARGET: m.canvasOrigin },
    "m1-build",
    { envFile: false },
  );
  if (
    !report.check(
      "M1 build with both targets exits 0",
      built.status === 0,
      () => tail(built.output),
    )
  )
    return false;
  const manifest = readManifest(m.frontend, sandbox.readFile);
  const rules = expectRewrites(
    report,
    "M1 the build holds the four rules",
    manifest,
    [
      ...todaysRules(m.api),
      {
        source: "/canvas",
        destination: `${m.canvasOrigin}/@notebook/canvas/`,
      },
      {
        sourceMatches: (source) =>
          source.startsWith("/canvas/:path(") && source.endsWith(")*"),
        destination: `${m.canvasOrigin}/@notebook/canvas/:path*`,
      },
    ],
  );
  const destinations = expectDestinations(
    report,
    "M1 every rewrite destination is the run's api or canvas port",
    manifest,
    [m.api, m.canvasOrigin],
  );
  if (!rules || !destinations) return false;

  m.makeProject = await projectTextBuilder();
  m.editorIndex = fs.readFileSync(
    path.join(repo, "apps/editor/dist-notebook/index.html"),
    "utf8",
  );
  return true;
}

// ---- Helpers of the runs ---------------------------------------------------

/** silicon-notebook's extension state of the current launch, or null. */
function readState(m) {
  const file = path.join(m.nb, ".local/run/extensions/state.json");
  try {
    return JSON.parse(m.sandbox.readFile(file, "utf8") ?? "null");
  } catch {
    return null;
  }
}

const canvasLogTail = (m) =>
  tail(
    m.sandbox.readFile(path.join(m.sandbox.root, "canvas.log"), "utf8") ?? "",
    10,
  );

const vacant = (m, port) => m.sandbox.listenerPids(port).length === 0;

/**
 * `.local` and the release manifest a launch writes are runtime state:
 * removed (validated) only while nothing of the clone runs — every stop ends
 * the stage unless the clone's processes are all gone — so each launch and
 * the second build start fresh.
 */
function resetRuntime(m) {
  m.sandbox.removePath(path.join(m.nb, ".local"));
  m.sandbox.removePath(path.join(m.nb, "release-manifest.json"));
}

/**
 * One launch of the clone (`npm run start`, scripts/prod.sh) with a TOML
 * variant: with `.env` present (no ALLOW_NO_ENV_FILE) and the env-file key
 * left out. Returns `{ launch, up, mark, launchedAt }`; `up` is undefined
 * after a reported failure.
 */
async function launchClone(m, label, kind) {
  const { sandbox, report, nb } = m;
  m.writeToml(kind);
  resetRuntime(m);
  makeLocal(sandbox, nb);
  m.refuseUnsafeClone(
    `${label} <clone>/.local is safe before the launch`,
    [nb, m.frontend, path.join(nb, ".local")],
    "launch",
    { modules: true },
  );
  const mark = sandbox.guardMark();
  const launchedAt = Date.now();
  const launcher = sandbox.start("npm", ["run", "start"], {
    cwd: nb,
    name: `${label.toLowerCase()}-launcher`,
    env: sandbox.env(
      {
        SKIP_INSTALL: "1",
        SKIP_BUILD: "1",
        PYTHON_BIN: m.options.python,
        PORT: String(m.apiPort),
        FRONTEND_PORT: String(m.webPort),
        BACKEND_PROXY_TARGET: m.api,
        COLUMNS: "1000",
      },
      { envFile: false },
    ),
  });
  m.launched = true;
  m.groups.push(launcher.pgid);
  const launch = { launcher, services: [] };
  const up = await awaitLaunch({
    sandbox,
    report,
    label,
    nb,
    launch,
    apiPort: m.apiPort,
    webPort: m.webPort,
  });
  return { launch, up, mark, launchedAt };
}

/**
 * The managed service of a launch: waits (within 90 s of the launch) for
 * silicon-notebook's state to say ready, and records the supervisor, the
 * worker and the canvas listener as companions.
 */
async function managedService(m, run) {
  let state;
  let readyAfter;
  await waitFor(
    () => {
      state = readState(m);
      if (state?.state === "ready") {
        readyAfter ??= Date.now() - run.launchedAt;
        return true;
      }
      return Date.now() - run.launchedAt > 90_000;
    },
    Math.max(0, 90_000 - (Date.now() - run.launchedAt)),
    250,
  );
  const service = state?.services?.[SERVICE_KEY];
  const supervisorPid = Number(state?.pid);
  const workerPid = Number(service?.pid);
  m.recordCompanion("supervisor", supervisorPid);
  m.recordCompanion("worker", workerPid);
  // The listener is recorded (and so may be signalled by the cleanup) only
  // once it is proven to be the worker's canvas.
  const { canvasPid, listeners, problem } = managedCanvas({
    sandbox: m.sandbox,
    canvasPort: m.canvasPort,
    workerPid,
    record: m.recordCompanion,
  });
  const canvasGroup = canvasPid > 0 ? groupOf(canvasPid) : -1;
  return {
    state,
    service,
    readyAfter,
    supervisorPid,
    workerPid,
    listeners,
    canvasPid,
    canvasProblem: problem,
    canvasGroup,
    stopInfo: {
      launch: run.launch,
      canvasPids: [supervisorPid, workerPid, canvasPid],
      canvasGroup,
    },
  };
}

/**
 * The end of a launch: the launcher's group as A6 stops it, then the clone's
 * own stop command; within 10 s after it every recorded companion, the
 * canvas's group and the three ports are gone. Anything left ends the stage.
 */
async function stopAll(m, label, { launch, canvasPids = [], canvasGroup }) {
  const { sandbox, report } = m;
  const launchStopped = await stopLaunch({ sandbox, report, label, launch });
  await m.extensionStop(label);
  const watched = canvasPids.filter((pid) => pid > 0);
  const ports = [m.apiPort, m.webPort, m.canvasPort];
  const done = () =>
    watched.every((pid) => !pidAlive(pid)) &&
    (!(canvasGroup > 0) || !groupAlive(canvasGroup)) &&
    ports.every((port) => vacant(m, port));
  const ended = await waitFor(done, 10_000, 200);
  report.check(
    `${label} within 10 s the recorded companions${canvasGroup > 0 ? ", the canvas's group" : ""} and the api, web and canvas listeners are gone`,
    ended,
    () =>
      `alive: ${watched.filter(pidAlive).join(", ") || "none"}; group ${canvasGroup} alive ${canvasGroup > 0 && groupAlive(canvasGroup)}; listeners ${ports.map((port) => `${port}: [${sandbox.listenerPids(port)}]`).join(", ")}`,
  );
  if (!launchStopped || !ended)
    throw new StageAborted(`${label}: the clone did not stop completely`);
}

/**
 * A gated request with an optional bearer, JSON body and headers, within
 * `deadlineMs` (30 s by default; the gate's listener checks count against it).
 * A failure after the gate passed is reported as a string status; a changed
 * listener throws OwnershipLost.
 */
async function request(
  gate,
  rawPath,
  { method = "GET", token, json, headers, deadlineMs = 30_000 } = {},
) {
  const init = { headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  try {
    return await gate(rawPath, method, deadlineMs, init);
  } catch (error) {
    if (error instanceof OwnershipLost) throw error;
    return { status: `error ${error.message}`, headers: {}, body: "" };
  }
}

/**
 * Polls `probe(leftMs)` from `since` until it answers 401, every `intervalMs`,
 * and never past `limitMs` after `since`: each probe gets only the time left
 * as its deadline, no probe starts once it is used up, and a 401 that arrives
 * after the limit does not count. Resolves to `{ after, last, late }`:
 * `after` the ms from `since` to the first 401 within the limit (undefined if
 * none), `late` the ms of a 401 that came after it.
 */
export async function firstRefusal({
  since,
  limitMs,
  intervalMs,
  probe,
  now = Date.now,
}) {
  let last;
  for (;;) {
    const left = limitMs - (now() - since);
    if (left <= 0) return { after: undefined, last };
    last = await probe(left);
    const after = now() - since;
    if (last?.status === 401)
      return after <= limitMs
        ? { after, last }
        : { after: undefined, late: after, last };
    const wait = Math.min(intervalMs, limitMs - after);
    if (wait <= 0) return { after: undefined, last };
    await sleep(wait);
  }
}

/** Registers a notebook user `<letter><8 digits>` through the frontend. */
async function register(m, getProxied, letter) {
  const username = `${letter}${digits(8)}`;
  const password = hex(12);
  m.secrets.push(password);
  const res = await request(getProxied, "/api/auth/register", {
    method: "POST",
    json: { username, password },
  });
  const body = parsed(res);
  if (body?.token) m.secrets.push(body.token);
  return { status: res.status, token: body?.token, id: body?.user?.id };
}

/**
 * Runs a run's probes; a listener that changed stops them there: the failure
 * is reported and nothing more is sent.
 */
async function probing(m, label, probes) {
  try {
    return await probes();
  } catch (error) {
    if (!(error instanceof OwnershipLost)) throw error;
    m.report.fail(
      `${label} the listeners were the recorded ones before every probe`,
      error.message,
    );
    return false;
  }
}

/** The gate for requests through `/canvas` to a given canvas pid (or none). */
const throughCanvas = (m, up, canvasPid) =>
  tripleGate(m.sandbox, {
    webPort: m.webPort,
    webPid: up.frontendPid,
    apiPort: m.apiPort,
    apiPid: up.backendPid,
    canvasPort: m.canvasPort,
    canvasPid,
  });

// ---- M2–M9: the managed run --------------------------------------------------

async function managedRun(m) {
  const { sandbox, report } = m;
  const run = await launchClone(m, "M2", "managed");
  let stopInfo = { launch: run.launch };
  try {
    if (!run.up) return false;
    const service = await managedService(m, run);
    stopInfo = service.stopInfo;
    const { supervisorPid, workerPid, canvasPid, canvasGroup } = service;
    if (
      !report.check(
        `M2 within 90 s of the launch silicon-notebook's state reports the canvas service ready${service.readyAfter === undefined ? "" : ` (seen after ${(service.readyAfter / 1000).toFixed(1)} s)`}; supervisor and worker pids recorded`,
        service.readyAfter !== undefined &&
          service.service?.state === "ready" &&
          supervisorPid > 0 &&
          workerPid > 0,
        () => `state ${JSON.stringify(service.state)}\n${canvasLogTail(m)}`,
      )
    )
      return false;
    const command = canvasPid > 0 ? (commandOf(canvasPid) ?? "") : "";
    if (
      !report.check(
        "M2 the canvas port is held by node apps/server/dist/cli.js --require-canvas-database, a descendant of the service worker in its process group (verified before it is recorded)",
        canvasPid > 0 && !service.canvasProblem,
        () =>
          `${service.canvasProblem}; listeners [${service.listeners}], command ${JSON.stringify(command)}\n${canvasLogTail(m)}`,
      )
    )
      return false;
    guardLoaded(
      sandbox,
      report,
      `M2 the offline guard was loaded in the canvas (pid ${canvasPid})`,
      run.mark,
      (entry) => entry.pid === canvasPid,
    );
    report.check(
      "M2 the canvas runs outside the launcher's process group, in its worker's",
      canvasGroup === workerPid && canvasGroup !== run.launch.launcher.pgid,
      `canvas group ${canvasGroup}, worker ${workerPid}, launcher group ${run.launch.launcher.pgid}`,
    );
    // The interrupt check waits for this line.
    report.note(
      `M2 the managed canvas is ready (supervisor pid ${supervisorPid}, worker pid ${workerPid}, canvas pid ${canvasPid}, group ${canvasGroup}) after ${m.elapsed()}`,
    );
    await probing(m, "M3–M8", () =>
      signedInUsers(m, {
        getCanvas: throughCanvas(m, run.up, canvasPid),
        getProxied: run.up.getProxied,
      }),
    );
    return true;
  } finally {
    await stopAll(m, "M9", stopInfo);
  }
}

/** M3–M8: readiness, the signed-out answers, two users, a sign-out. */
async function signedInUsers(m, { getCanvas, getProxied }) {
  const { report } = m;
  // M3 ready through the notebook's origin.
  const ready = await request(getCanvas, "/canvas/api/integration/ready.json");
  report.check(
    'M3 GET /canvas/api/integration/ready.json through web -> 200 {"ok":true,"mode":"notebook"}',
    ready.status === 200 &&
      JSON.stringify(parsed(ready)) === '{"ok":true,"mode":"notebook"}',
    `status ${ready.status}, body ${tail(ready.body, 3)}`,
  );
  // M4 signed out.
  const anonymous = await request(getCanvas, "/canvas/api/projects");
  report.check(
    "M4 GET /canvas/api/projects without a bearer -> 401",
    anonymous.status === 401,
    `status ${anonymous.status}`,
  );
  const page = await request(getCanvas, "/canvas");
  report.check(
    "M4 GET /canvas -> 200 with the notebook editor's index.html",
    page.status === 200 && page.body === m.editorIndex,
    `status ${page.status}, ${page.body.length} bytes (index.html ${m.editorIndex.length})`,
  );
  // M5 two users.
  const a = await register(m, getProxied, "a");
  const b = await register(m, getProxied, "b");
  for (const [name, user] of [
    ["A", a],
    ["B", b],
  ]) {
    if (
      !report.check(
        `M5 user ${name} registers through web`,
        user.status === 200 && user.token && user.id,
        `status ${user.status}`,
      )
    )
      return false;
    const me = await request(getProxied, "/api/me", { token: user.token });
    report.check(
      `M5 /api/me with ${name}'s token -> 200 with ${name}'s id`,
      me.status === 200 && parsed(me)?.id === user.id,
      `status ${me.status}`,
    );
  }
  // M6 A's project: imports, saves, reopens (API level).
  const projects = "/canvas/api/projects";
  const nameA = `M6 project ${hex(3)}`;
  const createdA = await request(getCanvas, projects, {
    method: "POST",
    token: a.token,
    json: { name: nameA, projectText: m.makeProject(nameA) },
  });
  const projectA = parsed(createdA)?.project;
  if (
    !report.check(
      "M6 A creates a project through /canvas -> 201",
      createdA.status === 201 && projectA?.id && projectA.revision > 0,
      `status ${createdA.status}, body ${tail(createdA.body, 3)}`,
    )
  )
    return false;
  const projectOfA = `${projects}/${projectA.id}`;
  const readA = await request(getCanvas, projectOfA, { token: a.token });
  report.check(
    "M6 A reads it back -> 200, same name",
    readA.status === 200 && parsed(readA)?.project?.name === nameA,
    `status ${readA.status}`,
  );
  const renamed = `${nameA} saved`;
  const saved = await request(getCanvas, projectOfA, {
    method: "PUT",
    token: a.token,
    headers: { "if-match": `revision-${projectA.revision}` },
    json: { name: renamed, projectText: m.makeProject(renamed) },
  });
  report.check(
    "M6 A saves a new revision with If-Match -> 200",
    saved.status === 200 &&
      parsed(saved)?.project?.revision === projectA.revision + 1,
    `status ${saved.status}, body ${tail(saved.body, 3)}`,
  );
  const reopened = await request(getCanvas, projectOfA, { token: a.token });
  const reopenedProject = parsed(reopened)?.project;
  report.check(
    "M6 A reopens it -> the new revision and name",
    reopened.status === 200 &&
      reopenedProject?.revision === projectA.revision + 1 &&
      reopenedProject?.name === renamed &&
      typeof reopenedProject?.projectText === "string",
    `status ${reopened.status}, revision ${reopenedProject?.revision}`,
  );
  // M7 separation.
  const idsOf = (res) =>
    (parsed(res)?.projects ?? []).map((project) => project.id);
  const foreign = await request(getCanvas, projectOfA, { token: b.token });
  report.check(
    "M7 B reading A's project -> 404",
    foreign.status === 404,
    `status ${foreign.status}`,
  );
  const listB = await request(getCanvas, projects, { token: b.token });
  report.check(
    "M7 B's list does not hold A's project",
    listB.status === 200 && !idsOf(listB).includes(projectA.id),
    `status ${listB.status}, ${idsOf(listB).length} project(s)`,
  );
  const nameB = `M7 project ${hex(3)}`;
  const createdB = await request(getCanvas, projects, {
    method: "POST",
    token: b.token,
    json: { name: nameB, projectText: m.makeProject(nameB) },
  });
  const projectB = parsed(createdB)?.project;
  report.check(
    "M7 B creates its own project -> 201",
    createdB.status === 201 && projectB?.id,
    `status ${createdB.status}`,
  );
  const listA = await request(getCanvas, projects, { token: a.token });
  report.check(
    "M7 A's list holds A's project and not B's",
    listA.status === 200 &&
      idsOf(listA).includes(projectA.id) &&
      !idsOf(listA).includes(projectB?.id),
    `status ${listA.status}, ${idsOf(listA).length} project(s)`,
  );
  // M8 sign-out: the canvas trusts a validated token for 60 s. The 75 s are
  // measured from the moment the sign-out's response arrived.
  const logout = await request(getProxied, "/api/auth/logout", {
    method: "POST",
    token: a.token,
  });
  const signedOut = Date.now();
  report.check(
    "M8 A signs out through web -> 204",
    logout.status === 204,
    `status ${logout.status}`,
  );
  const meAfter = await request(getProxied, "/api/me", { token: a.token });
  report.check(
    "M8 /api/me with A's token after the sign-out -> 401",
    meAfter.status === 401,
    `status ${meAfter.status}`,
  );
  const refusal =
    logout.status === 204
      ? await firstRefusal({
          since: signedOut,
          limitMs: 75_000,
          intervalMs: 5000,
          probe: (left) =>
            request(getCanvas, projects, {
              token: a.token,
              deadlineMs: Math.min(30_000, left),
            }),
        })
      : { after: undefined };
  report.check(
    `M8 /canvas/api/projects with A's token -> 401 within 75 s of the sign-out's 204${refusal.after === undefined ? "" : ` (first 401 after ${(refusal.after / 1000).toFixed(1)} s)`}`,
    refusal.after !== undefined,
    () =>
      logout.status !== 204
        ? "the sign-out did not succeed, so nothing was polled"
        : refusal.late !== undefined
          ? `the first 401 came ${(refusal.late / 1000).toFixed(1)} s after the sign-out, past 75 s`
          : `no 401 within 75 s; last status ${refusal.last?.status}`,
  );
  const stillB = await request(getCanvas, projects, { token: b.token });
  report.check(
    "M8 B's token still -> 200 afterwards",
    stillB.status === 200,
    `status ${stillB.status}`,
  );
  return true;
}

// ---- M-ext: external mode, then a misrouted upstream -------------------------

/** Waits until `handle` listens on the canvas port; "" or the problem. */
async function canvasListening(m, handle) {
  await handle.ready;
  let foreign = [];
  const settled = await waitFor(
    () => {
      if (handle.exited) return true;
      const state = m.sandbox.listenerState(m.canvasPort, handle.pid);
      if (state.state === "foreign") foreign = state.pids;
      return state.state !== "none";
    },
    60_000,
    200,
  );
  if (handle.exited) return "it exited";
  if (foreign.length)
    return `port ${m.canvasPort} is held by ${foreign.join(", ")}`;
  return settled ? "" : "it did not listen within 60 s";
}

async function externalRun(m) {
  const { sandbox, report } = m;
  const externalLog = path.join(sandbox.root, "canvas-external.log");
  // The canvas the operator would start: the same serve.sh with the managed
  // service's variables.
  const serve = sandbox.start(path.join(integration, "serve.sh"), [], {
    cwd: sandbox.root,
    name: "mext-serve",
    env: sandbox.env(
      {
        AUTO_CANVAS_DATABASE_URL: m.canvasUrl,
        AUTO_CANVAS_NOTEBOOK_API: m.api,
        AUTO_CANVAS_NOTEBOOK_ENV_FILE: m.envFile,
        AUTO_CANVAS_PORT: String(m.canvasPort),
        AUTO_CANVAS_LOG_FILE: externalLog,
        AUTO_CANVAS_NODE: process.execPath,
      },
      { envFile: false },
    ),
  });
  m.groups.push(serve.pgid);
  const serveProblem = await canvasListening(m, serve);
  if (
    !report.check(
      "M-ext the stage's serve.sh listens on the canvas port",
      !serveProblem,
      () =>
        `${serveProblem}\n${tail(sandbox.readFile(externalLog, "utf8") ?? "", 8)}`,
    )
  ) {
    await sandbox.stopGroup(serve.pgid);
    return false;
  }
  const run = await launchClone(m, "M-ext", "external");
  let standalone;
  let supervisorPid = 0;
  try {
    if (!run.up) return false;
    const state = readState(m);
    supervisorPid = Number(state?.pid);
    m.recordCompanion("supervisor", supervisorPid);
    const service = state?.services?.[SERVICE_KEY];
    report.check(
      "M-ext silicon-notebook reports the external service ready, without a worker of its own",
      state?.state === "ready" &&
        service?.state === "ready" &&
        service.pid === null,
      `state ${JSON.stringify(state)}`,
    );
    const user = await probing(m, "M-ext", async () => {
      const fresh = await register(m, run.up.getProxied, "c");
      if (
        !report.check(
          "M-ext a fresh user registers",
          fresh.status === 200 && fresh.token,
          `status ${fresh.status}`,
        )
      )
        return false;
      const list = await request(
        throughCanvas(m, run.up, serve.pid),
        "/canvas/api/projects",
        { token: fresh.token },
      );
      report.check(
        "M-ext /canvas/api/projects with that user's token -> 200",
        list.status === 200,
        `status ${list.status}`,
      );
      return fresh;
    });
    if (!user) return false;

    // The misrouted upstream: a standalone canvas on the canvas port.
    const serveStopped = await sandbox.stopGroup(serve.pgid);
    if (
      !report.check(
        "M-ext the stage's canvas is stopped and the canvas port is vacant",
        serveStopped && vacant(m, m.canvasPort),
        `stopped ${serveStopped}, listeners [${sandbox.listenerPids(m.canvasPort)}]`,
      )
    )
      return false;
    const standaloneUser = `Standalone ${hex(4)}`;
    standalone = sandbox.start(
      process.execPath,
      [path.join(repo, "apps/server/dist/cli.js")],
      {
        cwd: sandbox.root,
        name: "mext-standalone",
        env: sandbox.env(
          {
            DATABASE_URL: m.standaloneUrl,
            PORT: String(m.canvasPort),
            HOST: "127.0.0.1",
            AUTO_CANVAS_AUTH: "local",
            AUTO_CANVAS_USER_NAME: standaloneUser,
            EDITOR_ROOT: path.join(repo, "apps/editor/dist"),
          },
          { envFile: false },
        ),
      },
    );
    m.groups.push(standalone.pgid);
    const standaloneProblem = await canvasListening(m, standalone);
    if (
      !report.check(
        "M-ext a standalone canvas listens on the canvas port instead",
        !standaloneProblem,
        () =>
          `${standaloneProblem}\n${tail(sandbox.readFile(standalone.logFile, "utf8") ?? "", 8)}`,
      )
    )
      return false;
    await probing(m, "M-ext misrouted", () =>
      misroutedUpstream(m, {
        run,
        standalone,
        standaloneUser,
        token: user.token,
      }),
    );
    return true;
  } finally {
    if (standalone) await sandbox.stopGroup(standalone.pgid);
    await sandbox.stopGroup(serve.pgid);
    await stopAll(m, "M-ext", {
      launch: run.launch,
      canvasPids: [supervisorPid],
    });
  }
}

/**
 * Through the notebook, with the user's token and without, nothing of the
 * standalone canvas on the canvas port may come back: no 200 with JSON, no
 * body naming its seeded project or its user.
 */
async function misroutedUpstream(
  m,
  { run, standalone, standaloneUser, token },
) {
  const { sandbox, report } = m;
  const seededName = `Seeded ${hex(4)}`;
  const seeded = await request(
    ownershipGate(sandbox, m.canvasPort, standalone.pid),
    "/api/projects",
    {
      method: "POST",
      headers: { origin: m.canvasOrigin },
      json: { name: seededName, projectText: m.makeProject(seededName) },
    },
  );
  const seededId = parsed(seeded)?.project?.id;
  if (
    !report.check(
      "M-ext the standalone canvas holds one project seeded through its own API",
      seeded.status === 201 && seededId,
      `status ${seeded.status}, body ${tail(seeded.body, 3)}`,
    )
  )
    return false;
  const misrouted = throughCanvas(m, run.up, standalone.pid);
  const answers = [];
  for (const bearer of [token, undefined])
    for (const rawPath of [
      "/canvas",
      "/canvas/api/projects",
      "/canvas/api/auth/me",
      "/canvas/../api/projects",
      "/canvas/%2e%2e/api/projects",
    ]) {
      const res = await request(misrouted, rawPath, { token: bearer });
      answers.push({
        rawPath,
        token: Boolean(bearer),
        status: res.status,
        json: /json/u.test(String(res.headers["content-type"] ?? "")),
        leaked: [seededId, seededName, standaloneUser].filter((text) =>
          res.body.includes(text),
        ),
      });
    }
  const bad = misroutingProblems(answers);
  report.check(
    "M-ext through the notebook, every request with or without a token gets an HTTP answer, none 200 with JSON, none showing the standalone canvas's project or user",
    bad.length === 0,
    bad.join("; "),
  );
  report.info(
    `M-ext answers: ${answers.map((answer) => `${answer.token ? "token" : "none"} ${answer.rawPath} ${answer.status}${answer.json ? " json" : ""}`).join("; ")}`,
  );
  return true;
}

/**
 * The misrouting verdict of M-ext's probes `{ rawPath, token, status, json,
 * leaked }`: one line per probe that fails, naming it. A probe passes only
 * with an HTTP answer (a numeric status; a timeout or a socket error is a
 * failure, never "safe"), and that answer is neither 200 with JSON nor a body
 * holding any of the standalone canvas's names.
 */
export function misroutingProblems(answers) {
  const problems = [];
  for (const answer of answers) {
    const probe = `${answer.token ? "with the token" : "without a token"} GET ${answer.rawPath}`;
    if (typeof answer.status !== "number")
      problems.push(`${probe}: no HTTP answer (${answer.status})`);
    else if (answer.status === 200 && answer.json)
      problems.push(`${probe}: 200 with JSON`);
    else if (answer.leaked.length)
      problems.push(
        `${probe}: the body shows ${answer.leaked.length} of the standalone canvas's names`,
      );
  }
  return problems;
}

// ---- M-a, build 2, M-b, M-full: the rollbacks ----------------------------------

/**
 * A launch without the plugin entry: no companion service, and every request
 * through `/canvas` is sent only while the canvas port has no listener.
 */
async function rolledBack(m, label, expectations) {
  const { sandbox, report } = m;
  const run = await launchClone(m, label, "none");
  try {
    if (!run.up) return false;
    const state = readState(m);
    report.check(
      `${label} no companion service: no canvas listener and no running extension session`,
      vacant(m, m.canvasPort) &&
        (state === null || !Object.keys(state.services ?? {}).length),
      `listeners [${sandbox.listenerPids(m.canvasPort)}], state ${JSON.stringify(state)}`,
    );
    return await probing(m, label, () =>
      expectations(m, {
        toVacantCanvas: throughCanvas(m, run.up, null),
        getProxied: run.up.getProxied,
        getWeb: run.up.getWeb,
      }),
    );
  } finally {
    await stopAll(m, label, { launch: run.launch });
  }
}

/** M-a: the build still has the target, nothing serves it. */
async function withoutTheEntry(m, { toVacantCanvas, getProxied }) {
  for (const rawPath of ["/canvas", "/canvas/api/projects"]) {
    const res = await request(toVacantCanvas, rawPath);
    m.report.check(
      `M-a GET ${rawPath} -> 500 (the rule points at a vacant port)`,
      res.status === 500,
      `status ${res.status}`,
    );
  }
  const health = await request(getProxied, "/api/health");
  m.report.check(
    "M-a GET /api/health without a session -> 401 (the notebook itself works)",
    health.status === 401,
    `status ${health.status}`,
  );
  return true;
}

/** M-full: neither the entry nor the target. */
async function withoutBoth(m, { toVacantCanvas, getWeb }) {
  const canvas = await request(toVacantCanvas, "/canvas");
  m.report.check(
    "M-full GET /canvas -> 404",
    canvas.status === 404,
    `status ${canvas.status}`,
  );
  const home = await request(getWeb, "/");
  m.report.check(
    "M-full GET / -> 200",
    home.status === 200,
    `status ${home.status}`,
  );
  return true;
}

/** Build 2: without CANVAS_PROXY_TARGET, today's two rules only. */
async function secondBuild(m) {
  const { sandbox, report } = m;
  resetRuntime(m);
  removeNext(sandbox, m.frontend);
  const rebuilt = await m.build({ BACKEND_PROXY_TARGET: m.api }, "m-build-2", {
    envFile: false,
  });
  if (
    !report.check(
      "M build 2 without CANVAS_PROXY_TARGET exits 0",
      rebuilt.status === 0,
      () => tail(rebuilt.output),
    )
  )
    return false;
  const manifest = readManifest(m.frontend, sandbox.readFile);
  const rules = expectRewrites(
    report,
    "M build 2 holds today's two rules only",
    manifest,
    todaysRules(m.api),
  );
  const destinations = expectDestinations(
    report,
    "M build 2 every rewrite destination is the run's api port",
    manifest,
    [m.api],
  );
  return rules && destinations;
}

/** M-b: the plugin kept, the build without the target. */
async function targetlessRun(m) {
  const { sandbox, report } = m;
  const run = await launchClone(m, "M-b", "managed");
  let stopInfo = { launch: run.launch };
  try {
    if (!run.up) return false;
    const service = await managedService(m, run);
    stopInfo = service.stopInfo;
    const { canvasPid } = service;
    if (
      !report.check(
        "M-b silicon-notebook starts the canvas (state ready, the canvas port held by the service worker's verified canvas)",
        service.readyAfter !== undefined &&
          canvasPid > 0 &&
          !service.canvasProblem,
        () =>
          `${service.canvasProblem}; state ${JSON.stringify(service.state)}, listeners [${service.listeners}]`,
      )
    )
      return false;
    await probing(m, "M-b", async () => {
      const direct = await request(
        ownershipGate(sandbox, m.canvasPort, canvasPid),
        READY,
      );
      report.check(
        "M-b the canvas's ready probe on its own port -> 200",
        direct.status === 200,
        `status ${direct.status}`,
      );
      const through = await request(
        throughCanvas(m, run.up, canvasPid),
        "/canvas",
      );
      report.check(
        "M-b GET /canvas through web -> 404 (the canvas runs, unreachable)",
        through.status === 404,
        `status ${through.status}`,
      );
      return true;
    });
    return true;
  } finally {
    await stopAll(m, "M-b", stopInfo);
  }
}

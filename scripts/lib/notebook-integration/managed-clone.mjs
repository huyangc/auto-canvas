// The managed start of this checkout's canvas inside a disposable
// silicon-notebook clone, as stages M and L share it: the set-up (the clone,
// the databases, the clone's `.env`, the extensions TOML, `init-db.sh`, the
// first build), one launch of the clone with its managed canvas observed and
// verified, the probes' gates, the stop, and the cleanup.
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
  sha256,
  stopLaunch,
} from "./notebook-clone.mjs";
import { waitFor } from "./sandbox.mjs";
import {
  guardLoaded,
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

export const repo = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
export const integration = path.join(repo, "integrations/silicon-notebook");
export const SERVICE_KEY = "auto_canvas.integration/canvas";

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
 * Why a managed stage (M or L) cannot run from this checkout, before
 * anything is allocated (the entry script exits 2 with these): a missing
 * build, or a repository path the notebook's `.env` cannot hold as a literal
 * value.
 */
export function managedPrerequisites(stage) {
  const problems = [];
  for (const [file, command] of BUILDS)
    if (!fs.existsSync(path.join(repo, file)))
      problems.push(`stage ${stage} needs ${file}; run ${command} first`);
  const plugin = path.join(integration, "plugin/src");
  if (!ENV_VALUE.test(plugin) || /["\\]/u.test(repo))
    problems.push(
      `stage ${stage} needs a repository path without whitespace, quotes, backslashes or shell syntax (silicon-notebook's .env names it unquoted)`,
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

/**
 * A managed stage's entry: the stage's body gets a redacting reporter and the
 * list every token, password and database URL is added to as soon as it
 * exists, so no line the stage prints holds one. A refusal the body reported
 * (`Refused`) ends the run with exit status 2.
 */
export async function runManagedStage(context, body) {
  const secrets = [];
  const report = redacting(context.report, secrets);
  try {
    await body({ ...context, report, secrets });
  } catch (error) {
    // A refused file operation (PathRefused) is caught by the entry script,
    // which reports it once and ends the run with exit status 2.
    if (!(error instanceof Refused)) throw error;
    context.refused = true;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const digits = (count) =>
  Array.from({ length: count }, () => crypto.randomInt(10)).join("");
export const parsed = (res) => {
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
export const identityOf = (pid) => psOf(["lstart", "command"], pid);

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

/** `text` as a literal inside a regular expression. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The command lines silicon-notebook gives its companion processes, for a
 * clone at `nb` (scripts/extension_services.py and
 * scripts/extension_service_runtime.py at b5850d6): the supervisor is
 * `<python> <nb>/scripts/extension_services.py _supervise --state-dir
 * <nb>/.local/run/extensions`, a service worker `<python>
 * <nb>/scripts/extension_service_worker.py <supervisor pid>`, started by the
 * supervisor. Both script paths are absolute (the scripts resolve their own).
 */
function companionCommands(nb) {
  const scripts = path.join(nb, "scripts");
  const supervisor = new RegExp(
    `^\\S.* ${literally(path.join(scripts, "extension_services.py"))} _supervise --state-dir ${literally(path.join(nb, ".local/run/extensions"))}$`,
    "u",
  );
  const worker = (supervisorPid) =>
    new RegExp(
      `^\\S.* ${literally(path.join(scripts, "extension_service_worker.py"))} ${supervisorPid}$`,
      "u",
    );
  return { supervisor, worker };
}

/**
 * The supervisor and the service worker that silicon-notebook's state names,
 * verified before anything records them (a pid in state.json may have been
 * reused since the process it named exited): the supervisor only when its
 * command line is this clone's `extension_services.py _supervise`, the worker
 * only when its parent is that verified supervisor and its command line is
 * this clone's `extension_service_worker.py <supervisor pid>`; each must keep
 * its `ps` identity while it is checked. `record(name, pid, identity)` is
 * called for each verified one; anything else is never recorded (so never
 * signalled) and named in `problems`. Without `workerPid` (the external
 * mode) only the supervisor is checked. Returns `{ supervisorPid, workerPid,
 * problems, commands }`, a pid 0 unless recorded.
 */
export function managedCompanions({ nb, supervisorPid, workerPid, record }) {
  const expected = companionCommands(nb);
  const problems = [];
  const commands = {};
  const verify = (name, pid, problemOf) => {
    if (!(pid > 0)) {
      problems.push(`silicon-notebook's state names no ${name} pid`);
      return 0;
    }
    const identity = identityOf(pid);
    if (identity === undefined) {
      problems.push(`${name} ${pid} is gone: not recorded`);
      return 0;
    }
    const command = psOf(["command"], pid) ?? "";
    commands[name] = command;
    const problem =
      problemOf(pid, command) ||
      (identityOf(pid) === identity ? "" : "changed while it was checked");
    if (problem) {
      problems.push(`${name} ${pid} ${problem}: not recorded, never signalled`);
      return 0;
    }
    record(name, pid, identity);
    return pid;
  };
  const supervisor = verify("supervisor", supervisorPid, (_pid, command) =>
    expected.supervisor.test(command)
      ? ""
      : `runs ${JSON.stringify(command)}, not this clone's extension_services.py _supervise`,
  );
  if (workerPid === undefined)
    return { supervisorPid: supervisor, workerPid: 0, problems, commands };
  if (!(supervisor > 0)) {
    problems.push(
      `worker ${workerPid} is not checked without a verified supervisor: not recorded, never signalled`,
    );
    return { supervisorPid: 0, workerPid: 0, problems, commands };
  }
  const worker = verify("worker", workerPid, (pid, command) => {
    const parent = Number(psOf(["ppid"], pid));
    if (parent !== supervisor)
      return `is a child of ${parent}, not of the supervisor ${supervisor}`;
    return expected.worker(supervisor).test(command)
      ? ""
      : `runs ${JSON.stringify(command)}, not this clone's extension_service_worker.py ${supervisor}`;
  });
  return { supervisorPid: supervisor, workerPid: worker, problems, commands };
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
 * it is killed by its own pid (this script's child) and the result settles
 * at once. Unlike `sandbox.run` it also works while the sandbox is closing,
 * so the cleanup after an interrupt can still ask the clone to stop its
 * companion services.
 *
 * The result never waits on the output pipes past the limit (T165 follow-up
 * 6): a grandchild that inherited stdout or stderr keeps them open after the
 * command itself has exited or been killed. After the command exits its
 * remaining output is read for at most `drainMs` (and never past the limit);
 * then the pipes are let go.
 */
function runBounded(command, args, { cwd, env, timeoutMs, drainMs = 500 }) {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    let child;
    let drain;
    const deadline = Date.now() + timeoutMs;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({ ...result, output, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child?.kill("SIGKILL");
      } catch {
        // gone meanwhile
      }
      settle({ status: null, signal: "SIGKILL" });
    }, timeoutMs);
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      output = error.message;
      settle({ status: -1 });
      return;
    }
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", (error) => {
      output += error.message;
      settle({ status: -1 });
    });
    child.once("exit", (status, signal) => {
      child.once("close", () => settle({ status, signal }));
      drain = setTimeout(
        () => settle({ status, signal }),
        Math.max(0, Math.min(drainMs, deadline - Date.now())),
      );
    });
  });
}

/**
 * The clone's own `scripts/extension_services.py stop`, bounded, run only
 * after the sandbox's own checks passed immediately before it: the clone,
 * its `scripts` directory and the script are real entries (never a symlink)
 * inside the sandbox. A link there would make Python resolve the script's
 * root, and so the companions it stops, in another checkout. The
 * interpreter gets the absolute path inside the clone, with the clone as its
 * working directory. A refused check runs nothing and is reported as a
 * failure; the caller goes on with the rest of its cleanup. Resolves true
 * when the stop ran and ended with exit status 0.
 */
export async function runExtensionStop({
  sandbox,
  report,
  nb,
  python,
  label,
  timeoutMs = 40_000,
}) {
  const name = `${label} extension_services.py stop ends the companion services`;
  const scripts = path.join(nb, "scripts");
  const script = path.join(scripts, "extension_services.py");
  try {
    sandbox.assertRealDir(nb);
    sandbox.assertRealDir(scripts);
    sandbox.assertRealFile(script);
  } catch (error) {
    // PathRefused names the entry; any other error (the root gone) is a
    // refusal too: nothing is run on an unchecked path.
    report.fail(name, `not run: ${error.message}`);
    return false;
  }
  const result = await runBounded(python, [script, "stop"], {
    cwd: nb,
    env: sandbox.env({ PYTHON_BIN: python }, { envFile: false }),
    timeoutMs,
  });
  return report.check(
    name,
    result.status === 0 && !result.timedOut,
    () =>
      `${result.timedOut ? `timed out after ${(timeoutMs / 1000).toFixed(1)} s` : `exit ${result.status ?? result.signal}`}\n${tail(result.output, 8)}`,
  );
}

/**
 * Builds a Project text of `count` resistors (three by default) with the
 * canvas's own packages.
 */
async function projectTextBuilder() {
  const serverRequire = createRequire(
    path.join(repo, "apps/server/package.json"),
  );
  const load = (name) =>
    import(pathToFileURL(serverRequire.resolve(name)).href);
  const { createEmptyProject } = await load("@icm/model");
  const { serializeProject } = await load("@icm/project-protocol");
  return (name, count = 3) => {
    const project = createEmptyProject(`m-${hex(4)}`, name);
    for (let index = 0; index < count; index += 1)
      project.documents[0].instances.push({
        id: `R${index + 1}`,
        symbolId: "resistor",
        placement: {
          position: { x: 100 * (index + 1), y: 100 },
          rotation: 0,
          mirror: "none",
        },
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

// ---- The shared state ---------------------------------------------------------
//
// One context object `m` carries what a managed stage's phases share: the
// sandbox and the report, the stage's own bookkeeping for the cleanup, and,
// once the set-up has run, the ports, the database URLs, the build and the
// probes' helpers. Each phase returns false when the stage must stop there
// (its failure is already reported); a phase's own probes that fail do not
// stop the stage.

/**
 * The databases a run creates, in step with its shutdown. `create(client,
 * name)` issues `CREATE DATABASE` only before the shutdown began (after it, it
 * throws StageAborted and sends nothing) and records the name once the create
 * succeeded, also when that is after the shutdown began. A create that
 * failed without PostgreSQL's own refusal (an `ERROR` with its SQLSTATE: a
 * duplicate name, a cancellation) — its connection broke before the answer
 * arrived — has an unknown outcome: the name is kept in `unknown` for the
 * cleanup to reconcile (T165 follow-up 5); a refused name is never kept.
 * `shutdown(cancel)` marks the shutdown at once and resolves when every
 * create in flight has settled: it waits `settleMs`, asks
 * `cancel(backendPids)` to cancel the creates still running, and waits
 * `settleMs` again. It resolves to `{ created, unknown, unsettled }`: every
 * name to drop, the names whose outcome is unknown, and the names whose
 * create had still not settled.
 */
export function databaseLedger({ settleMs = 10_000 } = {}) {
  const created = [];
  const unknown = [];
  const pending = new Map(); // promise -> { name, backendPid }
  let shutdown;
  const settledWithin = (ms) =>
    pending.size === 0
      ? Promise.resolve()
      : Promise.race([Promise.allSettled([...pending.keys()]), sleep(ms)]);
  return {
    created,
    unknown,
    async create(client, name) {
      if (shutdown)
        throw new StageAborted(
          `the shutdown has begun: database ${name} is not created`,
        );
      const attempt = client.query(`CREATE DATABASE ${name}`).then(
        () => {
          created.push(name);
        },
        (error) => {
          if (!refusedByPostgres(error)) unknown.push(name);
          throw error;
        },
      );
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
          unknown: [...unknown],
          unsettled: [...pending.values()].map((entry) => entry.name),
        };
      })();
      return shutdown;
    },
  };
}

/**
 * PostgreSQL answered the statement with its own refusal: an `ERROR` with a
 * SQLSTATE (pg's DatabaseError). The statement then did not take effect. A
 * broken connection (no answer at all) and a `FATAL` (the backend ended,
 * possibly after the commit) leave the outcome unknown.
 */
const refusedByPostgres = (error) =>
  error?.severity === "ERROR" && /^[0-9A-Z]{5}$/u.test(String(error?.code));

/**
 * The stage's bookkeeping, its database access and its cleanup. `stage` is
 * the stage's letter; a stage pushes its own first cleanup steps onto
 * `m.cleanupSteps` (stage L's browser), each called with the time it may
 * take.
 */
export function managedState({
  sandbox,
  report,
  secrets,
  notebook,
  options,
  stage,
}) {
  const started = Date.now();
  const nb = path.join(sandbox.root, "nb");
  const m = {
    sandbox,
    report,
    secrets,
    notebook,
    options,
    stage,
    nb,
    frontend: path.join(nb, "frontend"),
    envFile: path.join(nb, ".env"),
    say: (line) => console.log(report.clean(line)),
    elapsed: () => `${Math.round((Date.now() - started) / 1000)} s`,
    databases: databaseLedger(), // the databases this run created
    groups: [], // process groups this stage started (launchers, canvases)
    companions: new Map(), // pid -> { name, pid, identity }
    launched: false,
    cleanupSteps: [], // (msLeft) => Promise, run first in the cleanup
    adminUrl:
      process.env.AUTO_CANVAS_TEST_DATABASE_URL ??
      "postgresql:///auto_canvas_test",
  };
  secrets.push(m.adminUrl);
  // The cleanup's PostgreSQL access: every step bounded (adminSession).
  m.admin = adminSession({ open: openAdmin(m.adminUrl) });
  m.recordCompanion = (name, pid, identity = identityOf(pid)) => {
    if (!(pid > 0) || m.companions.has(pid)) return;
    m.companions.set(pid, { name, pid, identity });
  };
  m.withClient = withClient;
  // The clone's own stop command, checked and bounded; it also works while
  // the sandbox is closing (after an interrupt).
  m.extensionStop = (label, timeoutMs) =>
    runExtensionStop({
      sandbox,
      report,
      nb,
      python: options.python,
      label,
      timeoutMs,
    });
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

// ---- PostgreSQL ----------------------------------------------------------------

/** One step of the stage's PostgreSQL access: a connection or a statement. */
const PG_STEP_MS = 10_000;

let pgModule;
/**
 * A pg client, from the canvas server's dependencies (loaded on first use).
 * Its `error` event — a connection that broke after it was established, with
 * or without a query in flight — is taken (T165 follow-up 1): an `error`
 * event without a listener would end the process before the stage's cleanup
 * runs. The query in flight rejects as well (that is the set-up's or the
 * cleanup's error path); the client is marked `broken` so the cleanup's
 * session opens another connection instead of reusing it.
 */
function pgClient(config) {
  pgModule ??= createRequire(path.join(repo, "apps/server/package.json"))("pg");
  const client = new pgModule.Client(config);
  client.on("error", (error) => {
    client.broken ??= error;
  });
  return client;
}

/** Ends a client without waiting on a server that does not answer. */
async function closeClient(client) {
  await Promise.race([client.end().catch(() => undefined), sleep(1000)]);
  client.connection?.stream?.destroy?.();
}

/**
 * A connection for the set-up's queries: the connection attempt and every
 * statement (statement_timeout, on the server) are bounded by `timeoutMs`.
 * No client-side query deadline: a CREATE DATABASE whose answer is still on
 * its way must not be given up as failed (the ledger awaits it, and cancels
 * it in the cleanup). A connection that breaks rejects the query in flight,
 * and so `work`.
 */
export async function withClient(
  connectionString,
  work,
  { timeoutMs = PG_STEP_MS } = {},
) {
  const client = pgClient({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
  });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await closeClient(client);
  }
}

/** Opens a cleanup connection on `url` within `ms`. */
export const openAdmin = (url) => async (ms) => {
  const client = pgClient({
    connectionString: url,
    connectionTimeoutMillis: ms,
    statement_timeout: PG_STEP_MS,
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    void closeClient(client);
    throw error;
  }
};

/**
 * The cleanup's PostgreSQL access, bounded so that the cleanup ends well
 * within the entry script's 60 s hard stop after an interrupt: one admin
 * connection, opened by `open(ms)` on first use and reused. Each use gets at
 * most `stepMs` for the connection attempt and at most `stepMs` for its query
 * (client side; the connection also carries statement_timeout), and all uses
 * together at most `budgetMs` from the first, and never past the time set
 * with `limitTo(at)` (the cleanup's own deadline). A connection attempt that
 * failed is not repeated: later uses fail at once with its reason. A
 * connection whose query timed out, or that broke (its `error` event), is
 * closed; the next use opens another. `query(sql, params)` rejects with the
 * reason; `close()` ends the session.
 */
export function adminSession({
  open,
  budgetMs = 25_000,
  stepMs = PG_STEP_MS,
  now = Date.now,
}) {
  let deadline;
  let ceiling = Infinity;
  let client;
  let unreachable;
  const timeLeft = () => {
    deadline ??= now() + budgetMs;
    return Math.min(stepMs, deadline - now(), ceiling - now());
  };
  const usedUp = () =>
    new Error(
      ceiling - now() <= 0
        ? "not attempted: the cleanup's time for the databases is used up"
        : `not attempted: the database cleanup's ${budgetMs / 1000} s are used up`,
    );
  const discard = () => {
    const stale = client;
    client = undefined;
    if (stale) void closeClient(stale);
  };
  return {
    limitTo(at) {
      ceiling = Math.min(ceiling, at);
    },
    async query(sql, params) {
      if (unreachable) throw unreachable;
      if (client?.broken) discard();
      let ms = timeLeft();
      if (ms <= 0) throw usedUp();
      if (!client) {
        try {
          client = await open(ms);
        } catch (error) {
          unreachable = new Error(
            `no connection to PostgreSQL within ${(ms / 1000).toFixed(1)} s: ${error.message}`,
          );
          throw unreachable;
        }
        ms = timeLeft();
        if (ms <= 0) throw usedUp();
      }
      try {
        return await client.query({
          text: sql,
          values: params,
          query_timeout: ms,
        });
      } catch (error) {
        if (/timeout/iu.test(error.message)) {
          discard();
          throw new Error(
            `no answer within ${(ms / 1000).toFixed(1)} s: ${error.message}`,
          );
        }
        if (client?.broken) discard();
        throw error;
      }
    },
    async close() {
      const open = client;
      client = undefined;
      if (open) await closeClient(open);
    },
  };
}

// ---- The cleanup ---------------------------------------------------------------

/**
 * The cleanup's one deadline (T165 follow-up 2), well inside the entry
 * script's 60 s hard stop after an interrupt: everything ends `totalMs` after
 * the cleanup began, the last `removalMs` left for the sandbox's own
 * disposal (its groups and the root's removal). Before those, `databaseMs`
 * are reserved for the database part (the drops and the report of what
 * remains); the process part (the stage's own first steps, the extension
 * stop, the process groups, the recorded pids) gets what comes before that,
 * the extension stop at most what is left of it after `processMs` for the
 * groups and pids.
 */
const CLEANUP_BUDGET = {
  totalMs: 50_000,
  removalMs: 5_000,
  databaseMs: 20_000,
  processMs: 8_000,
};

/** The extension stop's own bound outside the cleanup. */
const EXTENSION_STOP_MS = 40_000;

/**
 * The cleanup: once, in this order, each step bounded and reported, all of it
 * within one deadline (`m.cleanupBudget`, CLEANUP_BUDGET by default). Every
 * step runs whatever the one before it reported; a step whose share of the
 * time is used up says so. `m` holds the sandbox and the report, the clone
 * (`nb`, `launched`), the stage's own first steps (`cleanupSteps`), the
 * stage's process groups, the recorded companions, the database ledger,
 * `extensionStop(label, timeoutMs)` and the cleanup's PostgreSQL session
 * (`admin`).
 */
export async function cleanUp(m) {
  const { sandbox, report, admin } = m;
  const budget = { ...CLEANUP_BUDGET, ...m.cleanupBudget };
  const begun = Date.now();
  const end = begun + budget.totalMs;
  const processesEnd = end - budget.removalMs - budget.databaseMs;
  const processLeft = () => processesEnd - Date.now();
  admin.limitTo?.(end - budget.removalMs);
  // First, synchronously: no CREATE DATABASE starts from here on (the drop
  // at the end waits for those in flight).
  void m.databases.shutdown(cancelCreates(admin));
  for (const step of m.cleanupSteps ?? [])
    try {
      await step(Math.max(0, processLeft() - budget.processMs));
    } catch (error) {
      report.fail("cleanup: a stage step", error?.message ?? String(error));
    }
  // The stop is checked before it runs (runExtensionStop); a refusal is
  // reported and the cleanup goes on.
  if (m.launched) {
    const stopMs = Math.min(
      EXTENSION_STOP_MS,
      processLeft() - budget.processMs,
    );
    if (stopMs > 0) await m.extensionStop("cleanup:", stopMs);
    else
      report.fail(
        "cleanup: extension_services.py stop ends the companion services",
        "not run: the cleanup's time before the database reserve is used up",
      );
  }
  for (const pgid of m.groups) {
    const left = processLeft();
    const stopped =
      left > 0
        ? await Promise.race([
            sandbox.stopGroup(pgid),
            sleep(left).then(() => "out of time"),
          ])
        : "out of time";
    if (stopped !== true)
      report.fail(
        "cleanup: the stage's process groups are stopped",
        stopped === "out of time"
          ? `process group ${pgid}: the cleanup's time before the database reserve ran out (the sandbox's disposal retries it)`
          : `process group ${pgid} still present`,
      );
  }
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
  await waitFor(
    () => !alive.some(stillRecorded),
    Math.max(0, Math.min(5000, processLeft())),
    100,
  );
  signal("SIGKILL");
  const left = [...m.companions.values()].filter(stillRecorded);
  report.check(
    `cleanup: no recorded companion process is alive (${m.companions.size} recorded, ${alive.length} signalled by pid)`,
    left.length === 0,
    () => left.map((entry) => `${entry.name} ${entry.pid}`).join(", "),
  );
  await dropDatabases({ databases: m.databases, admin, report });
}

/** The ledger's way to cancel the creates still running: by backend pid. */
const cancelCreates = (admin) => async (pids) => {
  const backends = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
  if (backends.length)
    await admin.query(
      "SELECT pg_catalog.pg_cancel_backend(pid) FROM unnest($1::int[]) AS pid",
      [backends],
    );
};

/**
 * The database part of the cleanup: the ledger's shutdown (no new create;
 * every create in flight settled, a straggler cancelled through `admin`),
 * then every database a create recorded is dropped `WITH (FORCE)`, a create
 * that succeeded after the shutdown began included. A create whose outcome is
 * unknown (its answer was lost) is reconciled first: its name — this run's
 * own, never one PostgreSQL refused — is dropped when it exists. Each drop
 * is attempted on its own: one that fails or times out is reported, naming
 * its database, and the next is still sent. Afterwards the names still
 * present are read and reported. `admin` is the cleanup's session
 * (`adminSession`), closed here.
 */
export async function dropDatabases({ databases, admin, report }) {
  try {
    const { created, unknown, unsettled } = await databases.shutdown(
      cancelCreates(admin),
    );
    if (unsettled.length)
      report.fail(
        "cleanup: every CREATE DATABASE in flight settled before the drop",
        `still running after its cancellation: ${unsettled.join(", ")} (it may be left behind)`,
      );
    const lost = unknown.filter((name) => !created.includes(name));
    let found = [];
    if (lost.length) {
      try {
        const rows = await admin.query(
          "SELECT datname FROM pg_catalog.pg_database WHERE datname = ANY ($1::text[])",
          [lost],
        );
        found = rows.rows.map((row) => row.datname);
        report.ok(
          `cleanup: the CREATE DATABASE whose answer was lost is reconciled (${lost.join(", ")}: ${found.length ? `${found.join(", ")} exists, dropped below` : "none exists"})`,
        );
      } catch (error) {
        report.fail(
          `cleanup: the CREATE DATABASE whose answer was lost is reconciled (${lost.join(", ")})`,
          `whether it exists could not be read: ${error.message} (it may be left behind)`,
        );
      }
    }
    const dropping = [...created, ...found];
    if (!dropping.length) return;
    for (const name of dropping)
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } catch (error) {
        report.fail(
          `cleanup: database ${name} is dropped`,
          `the drop failed: ${error.message}`,
        );
      }
    let remaining;
    try {
      const rows = await admin.query(
        "SELECT datname FROM pg_catalog.pg_database WHERE datname = ANY ($1::text[])",
        [dropping],
      );
      remaining = rows.rows.map((row) => row.datname);
    } catch (error) {
      remaining = [`(which remain could not be read: ${error.message})`];
    }
    report.check(
      `cleanup: the stage's databases are dropped (${dropping.join(", ")})`,
      remaining.length === 0,
      () => `still present: ${remaining.join(", ")}`,
    );
  } finally {
    await admin.close?.();
  }
}

// ---- Set-up: the clone, the databases, the files, the first build -----------

/**
 * The set-up (stage M's M0 and M1): the clone at `--ref` with its refusals
 * and modules, three ports, the databases (`names`, keyed by kind: `canvas`
 * always, `standalone` for stage M), the clone's `.env` and the extensions
 * TOML, `init-db.sh`, and the first build with both rewrite targets and the
 * `buildEnv` given. `notebookEnv` ([key, value] pairs) replaces the
 * `.env`'s notebook database line when given (stage L keeps the notebook's
 * data outside `.local`, so a relaunch finds the same users and notebooks).
 * Returns false after a reported failure.
 */
export async function setUp(
  m,
  { buildEnv = {}, buildLabel, notebookEnv, what },
) {
  const { sandbox, report, secrets, nb, stage } = m;
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

  // Databases: the canvas's, and (stage M) the standalone canvas's of M-ext.
  // Each name is recorded only once it was created.
  const base = `auto_canvas_it_${stage.toLowerCase()}_${hex(6)}`;
  const names = { canvas: base };
  if (stage === "M") names.standalone = `${base}_s`;
  let role;
  let pgPort;
  await m.withClient(m.adminUrl, async (client) => {
    // SHOW port: inet_server_port() is null over the lane's Unix socket.
    const who = await client.query(
      "SELECT current_user AS role, pg_catalog.current_setting('port') AS port",
    );
    role = who.rows[0].role;
    pgPort = who.rows[0].port;
    for (const name of Object.values(names))
      await m.databases.create(client, name);
  });
  const urlOf = (name) =>
    `postgresql://${encodeURIComponent(role)}@127.0.0.1:${pgPort}/${name}`;
  m.canvasUrl = urlOf(names.canvas);
  secrets.push(m.canvasUrl);
  const databases = [["canvas", names.canvas, m.canvasUrl]];
  if (names.standalone) {
    m.standaloneUrl = urlOf(names.standalone);
    secrets.push(m.standaloneUrl);
    databases.push(["standalone canvas", names.standalone, m.standaloneUrl]);
  }
  for (const [kind, name, url] of databases) {
    const seen = await m.withClient(url, (client) =>
      client.query("SELECT pg_catalog.current_database() AS name"),
    );
    if (
      !report.check(
        `${stage}0 the guarded URL of the ${kind} database reaches ${name}`,
        seen.rows[0]?.name === name,
        `current_database() is ${seen.rows[0]?.name}`,
      )
    )
      return false;
  }

  // The stage's own files: <clone>/.env (recorded with its hash, so the
  // clone refusals accept exactly it) and the extensions TOML.
  const tomlFile = path.join(sandbox.root, "extensions.toml");
  m.tomlFile = tomlFile;
  const adminPassword = hex(16);
  secrets.push(adminPassword);
  const envValues = [
    ...(notebookEnv ?? [
      ["DATABASE_URL", "sqlite:///.local/silicon_notebook.db"],
    ]),
    ["AUTO_CANVAS_DATABASE_URL", m.canvasUrl],
    ["PYTHONPATH", path.join(integration, "plugin/src")],
    ["EXTENSIONS_CONFIG", tomlFile],
    ["SILICON_NOTEBOOK_ADMIN_PASSWORD", adminPassword],
  ];
  const unfit = envValues.filter(([, value]) => !ENV_VALUE.test(value));
  if (unfit.length) {
    report.fail(
      `${stage}0 the stage's .env holds literal values only`,
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
    `${stage}0 the stage wrote <clone>/.env (literal lines, recorded hash) and the extensions TOML from the shipped examples`,
  );

  // init-db.sh, under the sandbox, with the env-file key left out.
  const init = await sandbox.run(
    path.join(integration, "init-db.sh"),
    ["--notebook-root", nb],
    {
      cwd: sandbox.root,
      name: `${stage.toLowerCase()}0-init-db`,
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
      `${stage}0 init-db.sh --notebook-root <clone> exits 0 and says the database is initialised`,
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
    `${stage}0 the canvas database holds the ${shipped.length}-name ledger of the shipped migrations`,
    shipped.length > 0 && JSON.stringify(applied) === JSON.stringify(shipped),
    `ledger ${JSON.stringify(applied)}, shipped ${JSON.stringify(shipped)}`,
  );

  // The first build, with both targets.
  m.build = makeBuild({ sandbox, report, nb, refuseUnsafeClone });
  if (
    !(await buildWithTarget(m, {
      label: `${stage}1`,
      name: buildLabel ?? `${stage.toLowerCase()}1-build`,
      extra: buildEnv,
      what,
    }))
  )
    return false;

  m.makeProject = await projectTextBuilder();
  m.editorIndex = fs.readFileSync(
    path.join(repo, "apps/editor/dist-notebook/index.html"),
    "utf8",
  );
  return true;
}

/**
 * A build of the clone with `BACKEND_PROXY_TARGET` and `CANVAS_PROXY_TARGET`
 * (plus `extra`), checked: it exits 0, holds the four rules, and every
 * rewrite destination is the run's api or canvas port. Returns false after a
 * reported failure.
 */
export async function buildWithTarget(m, { label, name, extra = {}, what }) {
  const { sandbox, report } = m;
  const built = await m.build(
    {
      BACKEND_PROXY_TARGET: m.api,
      CANVAS_PROXY_TARGET: m.canvasOrigin,
      ...extra,
    },
    name,
    { envFile: false },
  );
  if (
    !report.check(
      `${label} build with ${what ?? "both targets"} exits 0`,
      built.status === 0,
      () => tail(built.output),
    )
  )
    return false;
  const manifest = readManifest(m.frontend, sandbox.readFile);
  const rules = expectRewrites(
    report,
    `${label} the build holds the four rules`,
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
    `${label} every rewrite destination is the run's api or canvas port`,
    manifest,
    [m.api, m.canvasOrigin],
  );
  return rules && destinations;
}

// ---- Helpers of the runs ---------------------------------------------------

/** silicon-notebook's extension state of the current launch, or null. */
export function readState(m) {
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

export const vacant = (m, port) => m.sandbox.listenerPids(port).length === 0;

/** silicon-notebook's state says the canvas service is ready. */
const serviceReady = (state) =>
  state?.state === "ready" && state?.services?.[SERVICE_KEY]?.state === "ready";

/**
 * Observes `read()` every `intervalMs` from now until `isReady` holds or
 * `limitMs` after `since` have passed, whichever comes first. `result`
 * resolves to `{ readyAfter, state, problem }`: `readyAfter` the ms from
 * `since` to the first ready observation within the limit (undefined if
 * none), `state` the last one read, `problem` "" or why it failed. `stop()`
 * ends the observation early (its result then has a problem).
 */
function readinessWatch({
  read,
  since,
  limitMs = 90_000,
  intervalMs = 250,
  isReady = serviceReady,
  now = Date.now,
}) {
  let stopped = false;
  let state = null;
  const result = (async () => {
    for (;;) {
      if (stopped)
        return {
          readyAfter: undefined,
          state,
          problem: "the observation was stopped before the service was ready",
        };
      if (now() - since > limitMs) break;
      state = read();
      const at = now() - since;
      if (at > limitMs) break;
      if (isReady(state)) return { readyAfter: at, state, problem: "" };
      await sleep(Math.max(1, Math.min(intervalMs, limitMs - at)));
    }
    return {
      readyAfter: undefined,
      state,
      problem: `not ready within ${limitMs / 1000} s of the launch`,
    };
  })();
  return {
    result,
    stop: () => {
      stopped = true;
    },
  };
}

/**
 * A launch whose readiness deadline runs from the launch itself: the
 * observation (`readinessWatch` from `since`) starts before `launch()` is
 * awaited and runs in parallel with it, so a slow launch wait cannot move or
 * stretch the deadline. Resolves to `{ up, readiness }` once `launch()` has:
 * `readiness` is the watch's result promise; without `up` the watch is
 * stopped.
 */
export async function observedLaunch({ launch, ...watch }) {
  const watcher = readinessWatch(watch);
  let up;
  try {
    up = await launch();
  } finally {
    if (!up) watcher.stop();
  }
  return { up, readiness: watcher.result, stopWatch: watcher.stop };
}

/**
 * `.local` and the release manifest a launch writes are runtime state:
 * removed (validated) only while nothing of the clone runs — every stop ends
 * the stage unless the clone's processes are all gone — so each launch and
 * the second build start fresh.
 */
export function resetRuntime(m) {
  m.sandbox.removePath(path.join(m.nb, ".local"));
  m.sandbox.removePath(path.join(m.nb, "release-manifest.json"));
}

/**
 * One launch of the clone (`npm run start`, scripts/prod.sh) with a TOML
 * variant: with `.env` present (no ALLOW_NO_ENV_FILE) and the env-file key
 * left out. Returns `{ launch, up, mark, launchedAt }`; `up` is undefined
 * after a reported failure.
 */
export async function launchClone(m, label, kind) {
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
  const awaitUp = () =>
    awaitLaunch({
      sandbox,
      report,
      label,
      nb,
      launch,
      apiPort: m.apiPort,
      webPort: m.webPort,
    });
  if (kind !== "managed") {
    const up = await awaitUp();
    return { launch, up, mark, launchedAt };
  }
  // The managed service's 90 s run from the launch: its state is observed
  // from now on, while the launcher's own readiness is awaited.
  const { up, readiness, stopWatch } = await observedLaunch({
    launch: awaitUp,
    read: () => readState(m),
    since: launchedAt,
    limitMs: 90_000,
  });
  return { launch, up, mark, launchedAt, readiness, stopWatch };
}

/**
 * The managed service of a launch: the first ready state silicon-notebook
 * reported within 90 s of the launch (observed since the launch), and the
 * supervisor, the worker and the canvas listener it names, each verified
 * before it is recorded as a companion.
 */
export async function managedService(m, run) {
  const { readyAfter, state, problem: readyProblem } = await run.readiness;
  const service = state?.services?.[SERVICE_KEY];
  // Only processes proven to be this clone's supervisor and its worker are
  // recorded (and so may be signalled by the cleanup).
  const companions = managedCompanions({
    nb: m.nb,
    supervisorPid: Number(state?.pid),
    workerPid: Number(service?.pid),
    record: m.recordCompanion,
  });
  const { supervisorPid, workerPid } = companions;
  // The listener is recorded only once it is proven to be the worker's
  // canvas.
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
    readyProblem,
    supervisorPid,
    workerPid,
    companionProblems: companions.problems,
    companionCommands: companions.commands,
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
 * The managed service's checks (stage M's M2): within 90 s of the launch the
 * state says the canvas service is ready; its supervisor and worker are this
 * clone's; the canvas port's listener is the worker's canvas, with the
 * offline guard loaded, outside the launcher's group. Returns `{ service, ok }`:
 * `service` (with its `stopInfo`) once known, `ok` false after a reported
 * failure that ends the run there.
 */
export async function checkManagedService(m, run, label) {
  const { sandbox, report } = m;
  const service = await managedService(m, run);
  const { supervisorPid, workerPid, canvasPid, canvasGroup } = service;
  const failed = { service, ok: false };
  if (
    !report.check(
      `${label} within 90 s of the launch silicon-notebook's state reports the canvas service ready${service.readyAfter === undefined ? "" : ` (first seen ${(service.readyAfter / 1000).toFixed(1)} s after the launch)`}`,
      service.readyAfter !== undefined && !service.readyProblem,
      () =>
        `${service.readyProblem}; state ${JSON.stringify(service.state)}\n${canvasLogTail(m)}`,
    )
  )
    return failed;
  if (
    !report.check(
      `${label} the state's supervisor and worker are this clone's extension_services.py _supervise and its extension_service_worker.py child (verified before they are recorded)`,
      supervisorPid > 0 &&
        workerPid > 0 &&
        service.companionProblems.length === 0,
      () => service.companionProblems.join("; "),
    )
  )
    return failed;
  report.info(
    `${label} supervisor command: ${service.companionCommands.supervisor}; worker command: ${service.companionCommands.worker}`,
  );
  const command = canvasPid > 0 ? (commandOf(canvasPid) ?? "") : "";
  if (
    !report.check(
      `${label} the canvas port is held by node apps/server/dist/cli.js --require-canvas-database, a descendant of the service worker in its process group (verified before it is recorded)`,
      canvasPid > 0 && !service.canvasProblem,
      () =>
        `${service.canvasProblem}; listeners [${service.listeners}], command ${JSON.stringify(command)}\n${canvasLogTail(m)}`,
    )
  )
    return failed;
  guardLoaded(
    sandbox,
    report,
    `${label} the offline guard was loaded in the canvas (pid ${canvasPid})`,
    run.mark,
    (entry) => entry.pid === canvasPid,
  );
  report.check(
    `${label} the canvas runs outside the launcher's process group, in its worker's`,
    canvasGroup === workerPid && canvasGroup !== run.launch.launcher.pgid,
    `canvas group ${canvasGroup}, worker ${workerPid}, launcher group ${run.launch.launcher.pgid}`,
  );
  // The interrupt check waits for this line.
  report.note(
    `${label} the managed canvas is ready (supervisor pid ${supervisorPid}, worker pid ${workerPid}, canvas pid ${canvasPid}, group ${canvasGroup}) after ${m.elapsed()}`,
  );
  return { service, ok: true };
}

/**
 * The end of a launch: the launcher's group as A6 stops it, then the clone's
 * own stop command; within 10 s after it every recorded companion, the
 * canvas's group and the three ports are gone. Anything left ends the stage.
 */
export async function stopAll(
  m,
  label,
  { launch, canvasPids = [], canvasGroup },
) {
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
export async function request(
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

/** Registers a notebook user `<letter><8 digits>` through the frontend. */
export async function register(m, getProxied, letter) {
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
export async function probing(m, label, probes) {
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
export const throughCanvas = (m, up, canvasPid) =>
  tripleGate(m.sandbox, {
    webPort: m.webPort,
    webPid: up.frontendPid,
    apiPort: m.apiPort,
    apiPid: up.backendPid,
    canvasPort: m.canvasPort,
    canvasPid,
  });

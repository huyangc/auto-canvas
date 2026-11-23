#!/usr/bin/env node
// Standalone build evidence (T162c: C-4 and C-1(d)), for a disposable
// checkout after `pnpm build` and `pnpm build:notebook-editor`: starts, as
// its own child, what the launcher runs (`node apps/server/dist/cli.js` with
// EDITOR_ROOT=apps/editor/dist, scripts/start.sh and scripts/lib/launcher.sh)
// on a throwaway schema, checks that the standard output is intact and
// servable (C-4), and with --run runs a command against that server (C-1(d):
// the Agent browser cases). It owns everything it starts and stops all of it
// on every exit path; it never signals a process it did not start and never
// runs scripts/stop.sh. scripts/standalone-build-evidence-check.mjs checks
// its refusals and its cleanup.
//
//   node scripts/standalone-build-evidence.mjs --port <n> --database <url> [--run "<command>"]
//
// Prints `resource schema=`, `resource pid=` (the server), `resource
// run-pgid=` and `resource run-process=` (each process of the run's group,
// below a recorded one, or carrying the run's marker, as it is seen),
// `resource marker=`, `C-4 ok: <n> references` and `cleanup ok`.
//
// The run's children are identified by three rules: the run's process group,
// descent from a recorded process, and a per-run marker (a UUID variable set
// only in the run's environment). The marker covers a child that left the
// group and lost its parent between two scans (Playwright starts its browser
// in a session of its own). Limit: `ps` prints no environment for Apple's
// own binaries (verified on macOS 27: `ps eww` shows that of node and of
// Chromium, none of `/bin/sh` or `/bin/sleep`), so a system binary that also
// left the group and lost its parent is found by neither rule; `resource
// marker=` says whether the marker reaches our processes at all here. A
// marker read that fails is retried; if it still cannot be read while the
// marker is active, cleanup reports `cleanup incomplete: …` and exits
// non-zero rather than claiming the run left nothing behind. The process
// table is read the same way at shutdown; when it cannot be read at all, the
// run's own group is still stopped from the leader this script spawned, and
// the descendants only that table could have found are reported as
// unverified.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const PREFIX = "standalone-build-evidence";
/**
 * The parser `pg` itself uses, reached through apps/server (the package that
 * depends on it; the root does not): the database checked below is the one
 * the driver connects to, which is not always the WHATWG pathname.
 */
const parseConnectionString = createRequire(
  createRequire(join(root, "apps/server/package.json")).resolve("pg"),
)("pg-connection-string").parse;
/**
 * Parameters that redirect the connection or rename its database, so the URL
 * no longer names one database on the server it appears to.
 */
const DATABASE_PARAMETERS = [
  "host",
  "port",
  "socket",
  "db",
  "dbname",
  "database",
];
/** Ports the developer's own servers use; never bound or contacted. */
const RESERVED_PORTS = new Set([3000, 8000, 4310]);
/** Variables the server gets from this script only. */
const SERVER_OWN = new Set(["EDITOR_ROOT", "DATABASE_URL", "PORT", "HOST"]);
const READY_TIMEOUT_MS = 30_000;
const KILL_AFTER_MS = 10_000;
/** The script's own database work: statement, query and cleanup waits. */
const DB_TIMEOUT_MS = 10_000;
const TRACK_INTERVAL_MS = 200;
const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
/** The per-run marker, set only in the environment of the run's children. */
const RUN_MARKER = "STANDALONE_EVIDENCE_RUN_MARKER";
/** A marker read that fails is retried at once, so a transient `ps` recovers. */
const MARKER_SCAN_ATTEMPTS = 3;
const MARKER_SCAN_RETRY_MS = 100;
/**
 * The shutdown's process-table reads: retried the same way, so a read that
 * fails transiently is not taken for an inspection that cannot be made.
 */
const TABLE_SCAN_ATTEMPTS = 3;
const TABLE_SCAN_RETRY_MS = 100;

function refuse(message) {
  console.error(`${PREFIX} refused: ${message}`);
  process.exit(2);
}

// ---- Arguments and refusals: nothing is allocated before all pass. ----
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  const value = args[index + 1];
  if (!["--port", "--database", "--run"].includes(name) || value === undefined)
    refuse(
      'usage: --port <n> --database <url> [--run "<command>"] (unknown or incomplete argument)',
    );
  if (name in options) refuse(`${name} given twice`);
  options[name] = value;
}

const envFiles = [];
if (existsSync(join(root, ".env"))) envFiles.push(".env");
const editorDirectory = join(root, "apps/editor");
if (existsSync(editorDirectory))
  for (const name of readdirSync(editorDirectory))
    if (name.startsWith(".env")) envFiles.push(`apps/editor/${name}`);
if (envFiles.length)
  refuse(
    `${envFiles.join(", ")} present: the evidence checkout has no .env files (Vite and the launcher read them)`,
  );

const portText = options["--port"];
if (portText === undefined) refuse("--port is required");
if (!/^[1-9]\d*$/u.test(portText))
  refuse("--port must be an integer from 1024 to 65535, without leading zeros");
const port = Number(portText);
if (port < 1024 || port > 65535)
  refuse("--port must be an integer from 1024 to 65535");
if (RESERVED_PORTS.has(port))
  refuse("--port is reserved for the developer's servers (3000, 8000, 4310)");

const databaseText = options["--database"];
if (databaseText === undefined) refuse("--database is required");
let databaseUrl;
try {
  databaseUrl = new URL(databaseText);
} catch {
  refuse("--database is not a URL");
}
// pg-connection-string also reads socket: URLs and a db or dbname
// parameter; only a plain postgres URL names its database in the path.
if (
  databaseUrl.protocol !== "postgres:" &&
  databaseUrl.protocol !== "postgresql:"
)
  refuse("--database must be a postgres: or postgresql: URL");
// The name the driver resolves, not the WHATWG pathname: a slash-less path
// drops its first character (pg-connection-string), and an encoded socket
// host next to a host parameter prepends the host to the path.
let databaseName = null;
try {
  databaseName = parseConnectionString(databaseText).database ?? null;
} catch {
  refuse("--database is not a connection string the driver reads");
}
if (!/^auto_canvas_test(?:_\d+)?$/u.test(databaseName ?? ""))
  refuse(
    `--database resolves the database ${JSON.stringify(databaseName)}: it must name auto_canvas_test or auto_canvas_test_<digits>`,
  );
for (const parameter of DATABASE_PARAMETERS)
  if (databaseUrl.searchParams.has(parameter))
    refuse(
      "--database must not have a host, port, socket, db, dbname or database parameter",
    );

const editorRoot = resolve(
  root,
  process.env.STANDALONE_EVIDENCE_EDITOR_ROOT ?? "apps/editor/dist",
);
if (!existsSync(join(editorRoot, "index.html")))
  refuse("apps/editor/dist/index.html is missing: run pnpm build");
if (!existsSync(join(root, "apps/editor/dist-notebook/index.html")))
  refuse(
    "apps/editor/dist-notebook/index.html is missing: run pnpm build:notebook-editor",
  );

async function portIsFree(number) {
  const probe = createServer();
  try {
    probe.listen(number, "127.0.0.1");
    await once(probe, "listening");
    return true;
  } catch {
    return false;
  } finally {
    if (probe.listening) await new Promise((done) => probe.close(done));
  }
}
if (!(await portIsFree(port))) refuse(`--port ${port} is already in use`);

// ---- Resources and the one cleanup every exit path takes. ----
let pool = null;
let schema = null;
/** Settles once the schema's CREATE has finished (or failed). */
let schemaCreated = Promise.resolve();
let server = null;
let run = null;
/** The marker probe child, stopped by cleanup like everything else. */
let probe = null;
/** pid -> start time of every process seen as one of the run's. */
const runProcesses = new Map();
let trackTimer = null;
let closing = null;

class Aborted extends Error {}

/** Every live process: pid, parent, group and start time. */
function processTable() {
  // Test-only (scripts/standalone-build-evidence-check.mjs): with
  // STANDALONE_EVIDENCE_PROCESS_TABLE=fail no table can be read, to show
  // that the run's group is still stopped without one.
  if (process.env.STANDALONE_EVIDENCE_PROCESS_TABLE === "fail")
    return Promise.reject(
      new Error(
        "the process table read was refused (STANDALONE_EVIDENCE_PROCESS_TABLE)",
      ),
    );
  return new Promise((done, fail) => {
    execFile(
      "ps",
      ["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        // Without a table nothing could be told apart: never guess.
        if (error) return fail(error);
        const table = new Map();
        for (const line of stdout.split("\n")) {
          const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/u.exec(
            line,
          );
          // A zombie has ended; only its parent's wait is missing.
          if (match && !match[4].startsWith("Z"))
            table.set(Number(match[1]), {
              ppid: Number(match[2]),
              pgid: Number(match[3]),
              started: match[5],
            });
        }
        done(table);
      },
    );
  });
}

/**
 * Test-only (scripts/standalone-build-evidence-check.mjs): with
 * STANDALONE_EVIDENCE_MARKER_SCAN=fail the run's own marker reads fail (the
 * startup probe reads a token of its own, so the marker still looks active),
 * to show what cleanup reports when it cannot check them.
 */
function markerScanRefused(marker) {
  return (
    process.env.STANDALONE_EVIDENCE_MARKER_SCAN === "fail" &&
    run !== null &&
    marker === run.marker
  );
}

/**
 * The pids whose environment carries exactly this marker (a UUID minted for
 * one run), from `ps eww`. An empty set where `ps` hides the environment
 * (see the module comment); the group and parent rules still apply there.
 */
function markedPids(marker) {
  if (markerScanRefused(marker))
    return Promise.reject(
      new Error(
        "the marker scan was refused (STANDALONE_EVIDENCE_MARKER_SCAN)",
      ),
    );
  const token = `${RUN_MARKER}=${marker}`;
  return new Promise((done, fail) => {
    execFile(
      "ps",
      ["eww", "-A", "-o", "pid=,command="],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        // Without this scan the other rules still hold: never fail on it.
        if (error) return fail(error);
        const pids = new Set();
        for (const line of stdout.split("\n")) {
          // The pid is the first field, the environment follows the command
          // line; the marker must be a value of its own, not a substring of
          // another variable or of an argument.
          if (!line.split(/\s+/u).includes(token)) continue;
          const pid = /^\s*(\d+)\s/u.exec(line)?.[1];
          if (pid !== undefined) pids.add(Number(pid));
        }
        done(pids);
      },
    );
  });
}

/** Whether `ps` shows our own children's environment here (the marker rule). */
async function markerVisible(marker) {
  const token = `${marker}-probe`;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], {
    env: { ...process.env, [RUN_MARKER]: token },
    stdio: "ignore",
  });
  probe = child;
  try {
    if (child.pid === undefined) return false;
    const deadline = Date.now() + 2_000;
    for (;;) {
      // A failed read here is a not-yet-visible probe, never a crash.
      if ((await markedPids(token).catch(() => new Set())).has(child.pid))
        return true;
      if (child.exitCode !== null || child.signalCode !== null) return false;
      if (Date.now() > deadline) return false;
      await new Promise((resume) => setTimeout(resume, 100));
    }
  } finally {
    child.kill("SIGKILL");
    if (probe === child) probe = null;
  }
}

/**
 * Records every live process of the run's group, every descendant of a
 * recorded one (Playwright starts its browser in another group) and every
 * process whose environment carries the run's marker. A process is recorded
 * with its start time, so a reused pid is never mistaken for it. One scan at
 * a time; a caller during a scan gets that scan.
 */
let tracking = null;
function trackRun() {
  if (!run) return Promise.resolve(new Map());
  tracking ??= scanRun().finally(() => {
    tracking = null;
  });
  return tracking;
}

async function scanRun() {
  const table = await processTable();
  // The marker rule: a child that left the run's group and lost its parent
  // between two scans still carries this run's marker. A failed read is not
  // "no marked process": it is retried at once (a transient `ps` failure),
  // and one that stays unreadable while the marker is active leaves the
  // unread state on the run, where cleanup reports it.
  let marked = new Set();
  for (let attempt = 1; ; attempt += 1) {
    try {
      marked = await markedPids(run.marker);
      run.markerUnread = false;
      break;
    } catch {
      if (attempt < MARKER_SCAN_ATTEMPTS) {
        await new Promise((resume) => setTimeout(resume, MARKER_SCAN_RETRY_MS));
        continue;
      }
      // Only an active marker loses anything here: an inert one reaches
      // nothing, which the startup's own line says.
      run.markerUnread = run.markerActive === true;
      break;
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, info] of table) {
      if (runProcesses.has(pid) && runProcesses.get(pid) === info.started)
        continue;
      const parent = table.get(info.ppid);
      const ours =
        info.pgid === run.pgid ||
        pid === run.pgid ||
        marked.has(pid) ||
        (parent !== undefined &&
          runProcesses.get(info.ppid) === parent.started);
      if (ours) {
        runProcesses.set(pid, info.started);
        console.log(`${PREFIX} resource run-process=${pid}`);
        grew = true;
      }
    }
  }
  return table;
}

/** Recorded run processes that are still the same processes. */
async function liveRunProcesses() {
  const table = await trackRun();
  return [...runProcesses]
    .filter(([pid, started]) => table.get(pid)?.started === started)
    .map(([pid]) => ({ pid, pgid: table.get(pid).pgid }));
}

/** Whether the leader this script spawned for the run has not been reaped. */
function runLeaderAlive() {
  return (
    run !== null && run.child.exitCode === null && run.child.signalCode === null
  );
}

/**
 * Signals the run's own process group (its id is the pid of the leader this
 * script spawned), and nothing outside it. Only while that leader lives: then
 * the group cannot have emptied, so its id cannot have been reused by a
 * process of someone else. False when the leader is already gone.
 */
function signalRunGroup(signal) {
  if (!runLeaderAlive()) return false;
  try {
    process.kill(-run.pgid, signal);
  } catch {
    // The group emptied in the meantime.
  }
  return true;
}

/**
 * The live processes of the run at shutdown, with the retries a transient
 * `ps` failure needs; a read that still fails rejects, and the caller reports
 * what it could not verify.
 */
async function shutdownScan() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await liveRunProcesses();
    } catch (error) {
      if (attempt >= TABLE_SCAN_ATTEMPTS) throw error;
      await new Promise((resume) => setTimeout(resume, TABLE_SCAN_RETRY_MS));
    }
  }
}

/**
 * Stops every process of the run. Returns what could not be cleaned, a phrase
 * for the `cleanup incomplete` line, or null when nothing is left.
 *
 * The run's group is this script's own child, so it is stopped from that
 * leader even when the process table cannot be read: only the descendants
 * that rule alone would have found are then unverified, and that is said
 * rather than assumed clean.
 */
async function stopRun() {
  if (!run) return null;
  clearInterval(trackTimer);
  /** The run's live processes, or null when the table could not be read. */
  const scan = () => shutdownScan().catch(() => null);
  const signalAll = async (signal) => {
    const live = await scan();
    if (live === null) return null;
    // The group as a whole too (a process forked since the last scan), but
    // only while a recorded member of it lives: a group id is never reused
    // before its last member is gone.
    if (live.some((item) => item.pgid === run.pgid)) signalRunGroup(signal);
    for (const { pid } of live)
      try {
        process.kill(pid, signal);
      } catch {
        // Gone in the meantime.
      }
    return live;
  };
  if ((await signalAll("SIGTERM")) === null) return stopRunUninspected();
  const deadline = Date.now() + KILL_AFTER_MS;
  let live = await scan();
  while (live !== null && live.length && Date.now() < deadline) {
    await new Promise((resume) => setTimeout(resume, 100));
    live = await scan();
  }
  if (live === null) return stopRunUninspected();
  if (live.length && (await signalAll("SIGKILL")) === null)
    return stopRunUninspected();
  const killed = Date.now() + KILL_AFTER_MS;
  for (;;) {
    const now = await scan();
    if (now === null) return stopRunUninspected();
    if (!now.length) return null;
    if (Date.now() > killed)
      throw new Error(
        `run processes survived SIGKILL: ${now.map((item) => item.pid).join(" ")}`,
      );
    await new Promise((resume) => setTimeout(resume, 100));
  }
}

/**
 * Shutdown when the process table cannot be read: the run's own group is
 * still signalled from the leader this script spawned (SIGTERM, SIGKILL after
 * the same deadline), and the descendants the table would have found are
 * reported as unverified.
 */
async function stopRunUninspected() {
  console.error(
    `${PREFIX} could not read the process table at shutdown: stopping the run's own group only`,
  );
  // The listener is attached before each signal, so an exit cannot be missed.
  const leaderExit = () =>
    runLeaderAlive()
      ? settlesWithin(once(run.child, "exit"), KILL_AFTER_MS)
      : Promise.resolve(true);
  const exited = leaderExit();
  signalRunGroup("SIGTERM");
  if (!(await exited)) {
    const killed = leaderExit();
    signalRunGroup("SIGKILL");
    await killed;
  }
  if (runLeaderAlive())
    return `run processes (the group leader ${run.child.pid} survived SIGKILL; the process table could not be read)`;
  return "run processes (the process table could not be read: the run's descendants could not be verified)";
}

async function stopServer() {
  const child = server?.child;
  // A spawn that failed has no process to stop (and may never emit exit).
  if (!child || child.pid === undefined) return true;
  if (child.exitCode !== null || child.signalCode !== null) return true;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
  const ended = await settlesWithin(exited, KILL_AFTER_MS + 5_000);
  clearTimeout(timer);
  return ended;
}

/** Settles with true once `promise` settles, false after `ms`. */
function settlesWithin(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(
      () => true,
      () => true,
    ),
    new Promise((done) => {
      timer = setTimeout(() => done(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function cleanup(reason, code) {
  if (closing) return closing;
  closing = (async () => {
    /** What could not be cleaned, each named in the final line. */
    const incomplete = [];
    try {
      const runIncomplete = await stopRun();
      if (runIncomplete !== null) incomplete.push(runIncomplete);
    } catch (error) {
      console.error(`${PREFIX} could not stop the run: ${error.message}`);
      incomplete.push("run processes");
    }
    // An active marker that could not be read at the last scan leaves any
    // descendant that left both the group and its parent unaccounted for:
    // that is not a clean run, whatever the other rules found.
    if (run?.markerUnread)
      incomplete.push("run processes (the run's marker could not be read)");
    if (!(await stopServer())) incomplete.push(`server ${server.child.pid}`);
    // The probe of the marker rule (a child of this script, never of the
    // run) lives two seconds at most; a signal during it stops it here.
    if (probe !== null) {
      probe.kill("SIGKILL");
      probe = null;
    }
    // A CREATE still running past this is cancelled by the pool's
    // statement timeout; the schema is looked up after the drop.
    await settlesWithin(schemaCreated, DB_TIMEOUT_MS);
    if (pool && schema) {
      let error = null;
      const dropped = await settlesWithin(
        pool
          .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
          .catch((failure) => {
            error = failure;
          }),
        DB_TIMEOUT_MS,
      );
      let gone = false;
      if (dropped && !error)
        await settlesWithin(
          pool
            .query("select 1 from pg_namespace where nspname = $1", [schema])
            .then(
              (result) => {
                gone = result.rowCount === 0;
              },
              () => {},
            ),
          DB_TIMEOUT_MS,
        );
      if (!dropped) console.error(`${PREFIX} DROP SCHEMA did not finish`);
      if (error) console.error(`${PREFIX} DROP SCHEMA: ${error.message}`);
      if (!gone) incomplete.push(`schema ${schema}`);
    }
    if (pool) await settlesWithin(pool.end(), 2_000);
    console.log(`${PREFIX} stopped (${reason})`);
    if (incomplete.length) {
      console.log(`${PREFIX} cleanup incomplete: ${incomplete.join(", ")}`);
      process.exit(code || 1);
    }
    console.log(`${PREFIX} cleanup ok`);
    process.exit(code);
  })();
  return closing;
}

for (const signal of Object.keys(SIGNAL_CODES))
  process.on(
    signal,
    () => void cleanup(`signal ${signal}`, SIGNAL_CODES[signal]),
  );
process.on("uncaughtException", (error) => {
  console.error(error);
  void cleanup("uncaught exception", 1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  void cleanup("unhandled rejection", 1);
});

function goOn() {
  if (closing) throw new Aborted("shutdown began");
}

// ---- The server, as the launcher starts it. ----
function startServer(databaseHref) {
  const env = {};
  for (const [name, value] of Object.entries(process.env))
    if (!name.startsWith("AUTO_CANVAS_") && !SERVER_OWN.has(name))
      env[name] = value;
  // Test-only (the check): STANDALONE_EVIDENCE_NODE names another
  // executable, so a spawn that fails before a process exists can be made.
  const executable = process.env.STANDALONE_EVIDENCE_NODE ?? process.execPath;
  const child = spawn(executable, ["apps/server/dist/cli.js"], {
    cwd: root,
    env: {
      ...env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: databaseHref,
      EDITOR_ROOT: editorRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server = { child, listening: false };
  if (child.pid !== undefined)
    console.log(`${PREFIX} resource pid=${child.pid}`);
  let output = "";
  child.once(
    "exit",
    (exitCode, signal) =>
      void cleanup(
        `server exited (${signal ?? exitCode})${server.listening ? "" : `: ${output.slice(-2000)}`}`,
        1,
      ),
  );
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server readiness timed out")),
      READY_TIMEOUT_MS,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    const collect = (data) => {
      if (output.length < 64_000) output += data;
      if (
        !server.listening &&
        new RegExp(`listening on .*:${port}\\b`, "u").test(output)
      ) {
        server.listening = true;
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });
}

async function health(origin) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    goOn();
    try {
      const response = await fetch(`${origin}/api/health`);
      const body = await response.json();
      if (response.ok && body?.ok === true) return;
    } catch {
      // Not answering yet.
    }
    if (Date.now() > deadline)
      throw new Error("GET /api/health never answered");
    await new Promise((resume) => setTimeout(resume, 200));
  }
}

// ---- C-4: the standard output is intact and servable. ----
/** The HTML spec's JavaScript MIME types (what a module is run as). */
const JAVASCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/**
 * The content types a reference may be served with, by its use; null where
 * the use does not fix one (a preload of a font, an image, ...). The server
 * sends `nosniff`, so a script served as text/css or a stylesheet served as
 * JavaScript does not run at all: each reference's type must match its use.
 */
function expectedTypes({ kind, as }) {
  if (kind === "stylesheet" || (kind === "preload" && as === "style"))
    return { types: ["text/css"], expected: "text/css" };
  if (
    kind === "script" ||
    kind === "modulepreload" ||
    (kind === "preload" && as === "script")
  )
    return {
      types: [...JAVASCRIPT_TYPES],
      expected: "a JavaScript MIME type",
    };
  return null;
}

/**
 * The document's effective base URL: its first `<base href>`, resolved
 * against the document's own URL, or the document's URL. The browser resolves
 * every reference against this, not against the raw attribute. A base the
 * browser cannot parse is ignored, as the browser ignores it; the document
 * is still reported.
 */
function baseUrlOf(document, documentUrl) {
  const base = document.querySelector("base[href]");
  const href = base === null ? null : base.getAttribute("href");
  if (href === null) return { url: new URL(documentUrl) };
  try {
    return { url: new URL(href, documentUrl) };
  } catch {
    return {
      url: new URL(documentUrl),
      problem: `<base href="${href}"> is not a URL`,
    };
  }
}

async function checkStandardOutput(origin) {
  const { JSDOM } = await import("jsdom");
  const page = await fetch(`${origin}/`);
  if (page.status !== 200) throw new Error(`GET / answered ${page.status}`);
  const document = new JSDOM(await page.text()).window.document;
  const serverOrigin = new URL(origin).origin;
  const base = baseUrlOf(document, `${origin}/`);
  const references = [];
  for (const script of document.querySelectorAll("script[src]"))
    references.push({ kind: "script", value: script.getAttribute("src") });
  for (const link of document.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u);
    const value = link.getAttribute("href");
    if (rel.includes("stylesheet"))
      references.push({ kind: "stylesheet", value });
    else if (rel.includes("modulepreload"))
      references.push({ kind: "modulepreload", value });
    else if (rel.includes("preload"))
      references.push({
        kind: "preload",
        as: (link.getAttribute("as") ?? "").toLowerCase(),
        value,
      });
  }
  const problems = base.problem === undefined ? [] : [base.problem];
  for (const reference of references) {
    const { kind, value } = reference;
    if (typeof value !== "string" || value === "") {
      problems.push(`${kind} ${value}: no URL`);
      continue;
    }
    // The attribute itself is root-relative under /assets/, as the build
    // writes it: `assets/main.js` resolves under /assets/ when fetched from
    // `/` but is not the reference the output makes, and an absolute URL
    // hard-coded to this verification server's origin only works here.
    if (!value.startsWith("/assets/")) {
      problems.push(
        `${kind} ${value}: not a root-relative path under /assets/`,
      );
      continue;
    }
    // The URL the browser loads, not the attribute: a `<base href>` or a
    // dot segment can point it at another origin, or outside /assets/.
    let target;
    try {
      target = new URL(value, base.url);
    } catch {
      problems.push(`${kind} ${value}: not a URL`);
      continue;
    }
    if (target.origin !== serverOrigin) {
      problems.push(
        `${kind} ${value}: resolves to ${target.href}, not the server's origin`,
      );
      continue;
    }
    if (
      !target.pathname.startsWith("/assets/") ||
      target.pathname.length <= "/assets/".length
    ) {
      problems.push(
        `${kind} ${value}: resolves to ${target.pathname}, not a path under /assets/`,
      );
      continue;
    }
    const response = await fetch(target);
    await response.arrayBuffer();
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const expected = expectedTypes(reference);
    if (response.status !== 200)
      problems.push(`${kind} ${value}: status ${response.status}`);
    else if (type === "") problems.push(`${kind} ${value}: no content type`);
    else if (expected && !expected.types.includes(type))
      problems.push(
        `${kind} ${value}: content type ${type}, ${expected.expected} is required`,
      );
  }
  if (!references.some((item) => item.kind === "script"))
    problems.push("no script");
  if (!references.some((item) => item.kind === "stylesheet"))
    problems.push("no stylesheet");
  if (problems.length) throw new Error(`C-4 failed:\n${problems.join("\n")}`);
  console.log(`${PREFIX} C-4 ok: ${references.length} references`);
}

// ---- --run: a command against the owned server, in its own group. ----
async function startRun(command, origin) {
  const marker = randomUUID();
  // Whether this machine's `ps` shows a child's environment: without it the
  // marker rule reaches nothing (the group and parent rules still hold).
  const visible = await markerVisible(`${marker}-probe`);
  console.log(`${PREFIX} resource marker=${visible ? "active" : "inert"}`);
  if (!visible)
    console.log(
      `${PREFIX} ps showed no environment of another process here: the run's processes are found by its group and by their parents only`,
    );
  goOn();
  const child = spawn("sh", ["-c", command], {
    cwd: root,
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      ICM_E2E_BASE_URL: origin,
      AUTO_CANVAS_API_URL: origin,
      ICM_E2E_ISOLATED: "1",
      // Only the run's children inherit the marker: not the script, not the
      // server, not the check that started it.
      [RUN_MARKER]: marker,
    },
  });
  // A spawn that failed has no process group to track or stop.
  if (child.pid === undefined)
    return new Promise((done, fail) => child.once("error", fail));
  run = { child, pgid: child.pid, marker, markerActive: visible };
  console.log(`${PREFIX} resource run-pgid=${child.pid}`);
  // A failed scan in between is retried by the next one; cleanup's own
  // scans fail loudly.
  const scan = () => void trackRun().catch(() => {});
  scan();
  trackTimer = setInterval(scan, TRACK_INTERVAL_MS);
  return new Promise((done, fail) => {
    child.once("error", fail);
    child.once("exit", (exitCode, signal) =>
      done(exitCode ?? 128 + (SIGNAL_NUMBERS[signal] ?? 0)),
    );
  });
}
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

try {
  const { createDb } = await import("../apps/server/dist/db.js");
  goOn();
  // The script's own connection only (the server gets its own URL): a
  // stalled statement is cancelled by the server and abandoned by the
  // client after DB_TIMEOUT_MS.
  const adminUrl = new URL(databaseUrl);
  adminUrl.searchParams.set("statement_timeout", String(DB_TIMEOUT_MS));
  adminUrl.searchParams.set("query_timeout", String(DB_TIMEOUT_MS));
  pool = createDb(adminUrl.href);
  // Read by the pool at each connect; `createDb` takes only a URL, and the
  // URL's connect_timeout is not honoured by this driver.
  pool.options.connectionTimeoutMillis = DB_TIMEOUT_MS;
  pool.on("error", () => {});
  const name = `standalone_evidence_${randomUUID().replaceAll("-", "")}`;
  // Tracked and printed before the CREATE is sent; cleanup waits for it.
  schema = name;
  console.log(`${PREFIX} resource schema=${name}`);
  const created = pool.query(`CREATE SCHEMA ${name}`);
  schemaCreated = created.then(
    () => {},
    () => {},
  );
  await created;
  goOn();
  const serverUrl = new URL(databaseUrl);
  serverUrl.searchParams.set("options", `-c search_path=${name}`);
  const origin = `http://127.0.0.1:${port}`;
  await startServer(serverUrl.href);
  goOn();
  await health(origin);
  goOn();
  console.log(`${PREFIX} ready ${origin}`);
  await checkStandardOutput(origin);
  goOn();
  const command = options["--run"];
  const code = command === undefined ? 0 : await startRun(command, origin);
  goOn();
  if (command !== undefined) console.log(`${PREFIX} run exited ${code}`);
  await cleanup(command === undefined ? "done" : `run exited ${code}`, code);
} catch (error) {
  if (!(error instanceof Aborted)) {
    console.error(`${PREFIX} failed: ${error?.message ?? error}`);
    await cleanup("error", 1);
  }
}

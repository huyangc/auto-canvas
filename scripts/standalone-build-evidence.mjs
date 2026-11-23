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
// run-pgid=` and `resource run-process=` (each process of the run's group
// or below it, as it is seen), `C-4 ok: <n> references` and `cleanup ok`.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const PREFIX = "standalone-build-evidence";
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
if (
  databaseUrl.searchParams.has("dbname") ||
  databaseUrl.searchParams.has("db")
)
  refuse("--database must not have a dbname or db parameter");
// pg-connection-string drops the path's first character as the slash: a
// slash-less `postgresql:auto_canvas_test` would select `uto_canvas_test`.
if (!databaseUrl.pathname.startsWith("/"))
  refuse("--database must name auto_canvas_test or auto_canvas_test_<digits>");
let databaseName;
try {
  databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
} catch {
  refuse("--database has an unreadable database name");
}
if (!/^auto_canvas_test(?:_\d+)?$/u.test(databaseName))
  refuse("--database must name auto_canvas_test or auto_canvas_test_<digits>");

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
/** pid -> start time of every process seen in the run's group or below. */
const runProcesses = new Map();
let trackTimer = null;
let closing = null;

class Aborted extends Error {}

/** Every live process: pid, parent, group and start time. */
function processTable() {
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
 * Records every live process of the run's group and every descendant of a
 * recorded one (Playwright starts its browser in another group). A process
 * is recorded with its start time, so a reused pid is never mistaken for it.
 * One scan at a time; a caller during a scan gets that scan.
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

async function stopRun() {
  if (!run) return;
  clearInterval(trackTimer);
  const signalAll = async (signal) => {
    const live = await liveRunProcesses();
    // The group as a whole too (a process forked since the last scan), but
    // only while a recorded member of it lives: a group id is never reused
    // before its last member is gone.
    if (live.some((item) => item.pgid === run.pgid))
      try {
        process.kill(-run.pgid, signal);
      } catch {
        // The group emptied in the meantime.
      }
    for (const { pid } of live)
      try {
        process.kill(pid, signal);
      } catch {
        // Gone in the meantime.
      }
  };
  await signalAll("SIGTERM");
  const deadline = Date.now() + KILL_AFTER_MS;
  while ((await liveRunProcesses()).length && Date.now() < deadline)
    await new Promise((resume) => setTimeout(resume, 100));
  if ((await liveRunProcesses()).length) await signalAll("SIGKILL");
  const killed = Date.now() + KILL_AFTER_MS;
  for (;;) {
    const live = await liveRunProcesses();
    if (!live.length) return;
    if (Date.now() > killed)
      throw new Error(
        `run processes survived SIGKILL: ${live.map((item) => item.pid).join(" ")}`,
      );
    await new Promise((resume) => setTimeout(resume, 100));
  }
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
      await stopRun();
    } catch (error) {
      console.error(`${PREFIX} could not stop the run: ${error.message}`);
      incomplete.push("run processes");
    }
    if (!(await stopServer())) incomplete.push(`server ${server.child.pid}`);
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
async function checkStandardOutput(origin) {
  const { JSDOM } = await import("jsdom");
  const page = await fetch(`${origin}/`);
  if (page.status !== 200) throw new Error(`GET / answered ${page.status}`);
  const document = new JSDOM(await page.text()).window.document;
  const references = [];
  for (const script of document.querySelectorAll("script[src]"))
    references.push({ kind: "script", value: script.getAttribute("src") });
  for (const link of document.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u);
    if (
      rel.some((token) =>
        ["stylesheet", "modulepreload", "preload"].includes(token),
      )
    )
      references.push({
        kind: rel.includes("stylesheet") ? "stylesheet" : "preload",
        value: link.getAttribute("href"),
      });
  }
  const problems = [];
  for (const { kind, value } of references) {
    if (
      typeof value !== "string" ||
      !value.startsWith("/assets/") ||
      value.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(value)
    ) {
      problems.push(`${kind} ${value}: not a root-relative /assets/ path`);
      continue;
    }
    const response = await fetch(`${origin}${value}`);
    await response.arrayBuffer();
    const type = response.headers.get("content-type") ?? "";
    if (response.status !== 200)
      problems.push(`${kind} ${value}: status ${response.status}`);
    else if (!/javascript|text\/css/iu.test(type))
      problems.push(`${kind} ${value}: content type ${type}`);
  }
  if (!references.some((item) => item.kind === "script"))
    problems.push("no script");
  if (!references.some((item) => item.kind === "stylesheet"))
    problems.push("no stylesheet");
  if (problems.length) throw new Error(`C-4 failed:\n${problems.join("\n")}`);
  console.log(`${PREFIX} C-4 ok: ${references.length} references`);
}

// ---- --run: a command against the owned server, in its own group. ----
function startRun(command, origin) {
  const child = spawn("sh", ["-c", command], {
    cwd: root,
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      ICM_E2E_BASE_URL: origin,
      AUTO_CANVAS_API_URL: origin,
      ICM_E2E_ISOLATED: "1",
    },
  });
  // A spawn that failed has no process group to track or stop.
  if (child.pid === undefined)
    return new Promise((done, fail) => child.once("error", fail));
  run = { child, pgid: child.pid };
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

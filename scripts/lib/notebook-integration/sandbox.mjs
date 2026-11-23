// The safety machinery of the notebook integration check: a private temporary
// root, an allow-listed child environment, the offline guard, process groups
// and listener ownership. Nothing here ever touches the notebook checkout.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const OWNER_PORTS = new Set([3000, 8000, 4310]);

/** Raised for a refusal that maps to exit status 2. */
export class UsageError extends Error {}

/** Raised by start() once disposal has begun: nothing new may be spawned. */
class SandboxClosing extends Error {
  constructor(name) {
    super(`not starting ${name}: the sandbox is being disposed`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

// The preload: every Node child of the check loads it through NODE_OPTIONS
// (and, for npm lifecycle scripts, through npm_config_node_options, which
// outranks any .npmrc of the revision under test). Its first act is the
// positive marker: one JSON line per process that loaded it, so a step can
// prove that the process doing the work was guarded instead of inferring it
// from an empty offline log.
const OFFLINE_GUARD = String.raw`"use strict";
const net = require("net");
const fs = require("fs");
try {
  if (process.env.NB_CHECK_GUARD_LOADED)
    fs.appendFileSync(process.env.NB_CHECK_GUARD_LOADED, JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv }) + "\n");
} catch {}
const original = net.Socket.prototype.connect;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);
// The first argument is classified exactly as Node's net.js normalizeArgs and
// Socket.prototype.connect do (read from Node 26.7.0): an array carrying the
// internal normalizedArgs symbol is already normalised ([options, cb]); any
// other object (arrays included) is the options; a string s is a pipe path
// only when isPipeName(s), i.e. toNumber(s) === false with
// toNumber(x) = (x = Number(x)) >= 0 ? x : false, so " 80 ", "0x50", "1e2"
// and "" are ports; everything else is a port, with the host from a string
// second argument.
function isNormalized(value) {
  return Array.isArray(value) && Object.getOwnPropertySymbols(value).some((symbol) => symbol.description === "normalizedArgs");
}
function isPipeName(value) {
  return typeof value === "string" && !(Number(value) >= 0);
}
function optionsOf(args) {
  const first = args[0];
  if (isNormalized(first)) return { options: first[0], wrapped: first };
  if (first !== null && typeof first === "object") return { options: first };
  if (isPipeName(first)) return { options: { path: first } };
  return { options: { port: first, host: args.length > 1 && typeof args[1] === "string" ? args[1] : undefined } };
}
net.Socket.prototype.connect = function guardedConnect(...args) {
  const { options, wrapped } = optionsOf(args);
  // A Unix socket only when path is a non-empty string: the default http and
  // https agents pass path: null for an ordinary TCP connection.
  if (!options || (typeof options.path === "string" && options.path !== ""))
    return original.apply(this, args);
  const host = options.host === undefined || options.host === null ? "localhost" : String(options.host);
  if (host.toLowerCase() === "localhost") {
    const rewritten = { ...options, host: "127.0.0.1" };
    delete rewritten.family;
    if (wrapped) {
      wrapped[0] = rewritten;
      return original.apply(this, args);
    }
    const callback = args.find((value) => typeof value === "function");
    return callback ? original.call(this, rewritten, callback) : original.call(this, rewritten);
  }
  if (LOOPBACK.has(host)) return original.apply(this, args);
  try {
    fs.appendFileSync(process.env.NB_CHECK_OFFLINE_LOG, host + " " + String(options.port).trim() + "\n");
  } catch {}
  const error = new Error("offline guard refused " + host + ":" + options.port);
  error.code = "ENETUNREACH";
  process.nextTick(() => this.destroy(error));
  return this;
};
`;

// Every long-running child is started through this supervisor, which leads
// the process group and stays alive in it until the sandbox releases it (it
// ignores SIGTERM; only a release or SIGKILL ends it). The group id is the
// supervisor's pid, and while the supervisor has not exited it is an unreaped
// child of this script, so that number cannot belong to anyone else: the
// group is signalled only while that holds. The command's own status, signal
// or spawn error arrive over the IPC channel.
const SUPERVISOR = String.raw`"use strict";
const { spawn } = require("child_process");
const send = (message) => { try { process.send(message); } catch {} };
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {});
let child;
// The command and its environment arrive in the first message, not on the
// command line: a command line is readable by every local user (ps), and
// the environment may hold a secret made for this run.
process.on("message", (message) => {
  if (message === "release") process.exit(0);
  if (child || !message || !Array.isArray(message.spec)) return;
  const [command, args, cwd, env] = message.spec;
  try {
    child = spawn(command, args, { cwd, env, stdio: "inherit" });
  } catch (error) {
    send({ error: error.message });
    return;
  }
  child.once("spawn", () => send({ pid: child.pid }));
  child.once("error", (error) => send({ error: error.message }));
  child.once("exit", (status, signal) => send({ status, signal }));
});
process.on("disconnect", () => process.exit(0));
`;

function sameDirectory(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Throws UsageError when the temporary parent is, or lies inside, the checkout. */
function resolveTemporaryParent(notebook) {
  let notebookStat;
  try {
    notebookStat = fs.statSync(notebook);
  } catch (error) {
    throw new UsageError(`--notebook ${notebook}: ${error.message}`);
  }
  if (!notebookStat.isDirectory())
    throw new UsageError(`--notebook ${notebook} is not a directory`);
  const parent = fs.realpathSync(os.tmpdir());
  for (let dir = parent; ;) {
    if (sameDirectory(fs.statSync(dir), notebookStat))
      throw new UsageError(
        `the temporary directory ${parent} is inside the notebook checkout; ` +
          "unset or change TMPDIR",
      );
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return parent;
}

export function createSandbox(notebook, { keep }) {
  const parent = resolveTemporaryParent(notebook);
  const root = fs.mkdtempSync(path.join(parent, "nb-check-"));
  const home = path.join(root, "home");
  const tmp = path.join(root, "t");
  const npmCache = path.join(root, "npm-cache");
  const logs = path.join(root, "logs");
  for (const dir of [home, tmp, npmCache, logs]) fs.mkdirSync(dir);
  const marker = path.join(root, "marker");
  fs.writeFileSync(marker, String(Date.now()));
  const guardPath = path.join(root, "offline-guard.cjs");
  fs.writeFileSync(guardPath, OFFLINE_GUARD);
  const offlineLog = path.join(root, "offline.log");
  const guardLoadedLog = path.join(root, "guard-loaded.log");

  // Owned groups: pgid -> the handle of the supervisor that leads it.
  const groups = new Map();
  // Every group signal this run sent (signal 0 probes excluded), for the
  // self-check that a group which has exited is never signalled.
  const signalsSent = [];
  const usedPorts = new Set();
  let counter = 0;
  let closing = false;

  function removeRoot() {
    // Identity check: only ever remove the directory this run created.
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith("nb-check-") ||
      fs.realpathSync(root) !== root
    )
      throw new Error(`refusing to remove ${root}`);
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (/\s/.test(root)) {
    removeRoot();
    throw new UsageError(`temporary root ${root} contains whitespace`);
  }

  /**
   * Throws unless `target` lies inside the sandbox root and every existing
   * component from the root down to it is a real directory (lstat: never a
   * symlink, never a file), with the deepest existing one resolving inside the
   * root. Call it before writing to, removing or handing out a path under the
   * root, so a symlink planted there (for example a tracked one in the clone)
   * can never redirect a write outside.
   */
  function assertInsideSandbox(target) {
    const fail = (why) => {
      throw new Error(`${target}: ${why}`);
    };
    const realRoot = fs.realpathSync(root);
    const rel = path.relative(root, path.resolve(target));
    if (rel.startsWith("..") || path.isAbsolute(rel))
      fail(`not under the sandbox root ${root}`);
    let current = root;
    for (const part of ["", ...rel.split(path.sep).filter(Boolean)]) {
      current = path.join(current, part);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") break;
        fail(`${current}: ${error.message}`);
      }
      if (stat.isSymbolicLink()) fail(`${current} is a symlink`);
      if (!stat.isDirectory()) fail(`${current} is not a directory`);
      const within = path.relative(realRoot, fs.realpathSync(current));
      if (within.startsWith("..") || path.isAbsolute(within))
        fail(`${current} resolves outside the sandbox root`);
    }
  }

  function env(extra = {}) {
    const nodeOptions = `--require ${guardPath} --dns-result-order=ipv4first`;
    const base = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: tmp,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_IGNORE_INCORRECT_LOCKFILE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      NODE_OPTIONS: nodeOptions,
      // npm replaces NODE_OPTIONS for lifecycle scripts with its node-options
      // setting when one is configured, and a .npmrc of the revision (at the
      // clone's root, in frontend/, or under a nested package) may configure
      // it. Environment configuration outranks every .npmrc file, so the
      // guarded value is also npm's node-options; and the script shell is
      // pinned, so a revision's script-shell cannot run a wrapper that drops
      // NODE_OPTIONS. What config cannot close (a script that clears
      // NODE_OPTIONS itself, or passes --node-options on an inner npm command
      // line) is caught by the positive marker each step checks.
      npm_config_node_options: nodeOptions,
      npm_config_script_shell: "/bin/sh",
      NB_CHECK_OFFLINE_LOG: offlineLog,
      NB_CHECK_GUARD_LOADED: guardLoadedLog,
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
      npm_config_cache: npmCache,
      SILICON_NOTEBOOK_ENV_FILE: "",
      MODEL_SERVICES_CONFIG: "",
    };
    for (const name of ["LANG", "LC_ALL"])
      if (process.env[name] !== undefined) base[name] = process.env[name];
    return { ...base, ...extra };
  }

  /** The current end of the marker log; pass it to guardedSince later. */
  function guardMark() {
    try {
      return fs.statSync(guardLoadedLog).size;
    } catch {
      return 0;
    }
  }

  /** The processes that loaded the guard since `mark`: { pid, ppid, argv }. */
  function guardedSince(mark, log = guardLoadedLog) {
    let text;
    try {
      const buffer = fs.readFileSync(log);
      text = buffer.subarray(mark).toString("utf8");
    } catch {
      return [];
    }
    const entries = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // a torn line cannot prove anything
      }
    }
    return entries;
  }

  // macOS answers EPERM, not ESRCH, while a group holds only exited members
  // that their parent has not reaped yet. That is "not gone yet": keep waiting
  // rather than treat it as an error, and never as proof of absence. A probe
  // (signal 0) affects no process, so it is safe on any group id.
  function groupAlive(pgid) {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
      throw error;
    }
  }

  /** Members of a group other than its supervisor (one ps call). */
  function membersBesidesLeader(pgid) {
    try {
      const out = execFileSync("ps", ["-A", "-o", "pid=,pgid="], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 16 * 1024 * 1024,
      });
      return out
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([pid, group]) => group === pgid && pid !== pgid)
        .map(([pid]) => pid);
    } catch {
      return undefined; // unknown: never read as "none left"
    }
  }

  /** Throws once disposal has begun, so a stage cannot go on to a new step. */
  function ensureOpen(name) {
    if (closing) throw new SandboxClosing(name);
  }

  /**
   * Spawn a command under a supervisor that leads its own group; stdout and
   * stderr go to a log file. `handle.pgid` is the group, `handle.pid` the
   * command's own pid once `handle.ready` resolves, `handle.done` resolves
   * when the command has exited (`status`, `signal`, `error`).
   */
  function start(command, args, { cwd, env: childEnv, name }) {
    ensureOpen(name);
    const logFile = path.join(
      logs,
      `${String(++counter).padStart(2, "0")}-${name}.log`,
    );
    const fd = fs.openSync(logFile, "w");
    const child = spawn(process.execPath, ["-e", SUPERVISOR], {
      cwd,
      env: { PATH: process.env.PATH ?? "" },
      detached: true,
      stdio: ["ignore", fd, fd, "ipc"],
    });
    fs.closeSync(fd);
    const handle = {
      child,
      pgid: child.pid,
      pid: undefined,
      logFile,
      exited: false,
      leaderExited: child.pid === undefined,
    };
    if (child.pid !== undefined) groups.set(child.pid, handle);
    let markReady;
    handle.ready = new Promise((resolve) => (markReady = resolve));
    let markDone;
    handle.done = new Promise((resolve) => (markDone = resolve));
    const finish = (fields) => {
      if (handle.exited) return;
      Object.assign(handle, fields, { exited: true });
      markReady();
      markDone();
    };
    child.on("message", (message) => {
      if (message?.pid) {
        handle.pid = message.pid;
        markReady();
      } else if (message?.error) finish({ error: new Error(message.error) });
      else if (message && "status" in message)
        finish({ status: message.status, signal: message.signal });
    });
    child.once("error", (error) => {
      handle.leaderExited = true;
      finish({ error });
    });
    // Synchronous: from here on the group id is no longer provably ours, so
    // it is never signalled again; it is dropped as soon as it is empty.
    child.once("exit", (status, signal) => {
      handle.leaderExited = true;
      if (handle.pgid !== undefined && !groupAlive(handle.pgid))
        groups.delete(handle.pgid);
      finish({
        error: new Error(
          `the supervisor exited (${signal ?? status}) before the command reported`,
        ),
      });
    });
    // The command line holds no part of the command's environment.
    if (child.pid !== undefined)
      child.send({ spec: [command, args, cwd, childEnv ?? env()] }, (error) => {
        if (error) finish({ error });
      });
    return handle;
  }

  // One shutdown per group id: a later caller awaits the shutdown in progress.
  const stopping = new Map();

  /** Absent (ESRCH) retires the id at once. */
  function observeGone(pgid) {
    if (groupAlive(pgid)) return false;
    groups.delete(pgid);
    return true;
  }

  /**
   * Stop an owned group. While its supervisor is alive: SIGTERM to the group
   * (the supervisor ignores it) if anything else is in it, SIGKILL after 5 s,
   * then release the supervisor. Once the supervisor has exited the group is
   * never signalled again, only probed until it is gone. A group still
   * present after the final wait stays recorded and the result is false.
   */
  function stopGroup(pgid) {
    if (stopping.has(pgid)) return stopping.get(pgid);
    const handle = groups.get(pgid);
    if (!handle) return Promise.resolve(true);
    // The identity check: the supervisor (pid == pgid) has not exited, so
    // the group is the one this run created.
    const signalGroup = (signal) => {
      if (handle.leaderExited || !groups.has(pgid)) return;
      signalsSent.push({ pgid, signal });
      try {
        process.kill(-pgid, signal);
      } catch (error) {
        // EPERM: nothing left that can take a signal (see groupAlive).
        if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
      }
    };
    const othersGone = () => membersBesidesLeader(pgid)?.length === 0;
    const shutdown = (async () => {
      try {
        if (!handle.leaderExited) {
          if (!othersGone()) {
            signalGroup("SIGTERM");
            if (!(await waitFor(othersGone, 5000, 100))) signalGroup("SIGKILL");
          }
          if (!handle.leaderExited) {
            try {
              handle.child.send("release");
            } catch {
              // channel already closed: the kill below ends it
            }
            if (!(await waitFor(() => handle.leaderExited, 5000, 50)))
              signalGroup("SIGKILL");
          }
        }
        await waitFor(() => observeGone(pgid), 5000, 50);
        return !groups.has(pgid) || observeGone(pgid);
      } finally {
        stopping.delete(pgid);
      }
    })();
    stopping.set(pgid, shutdown);
    return shutdown;
  }

  async function run(
    command,
    args,
    { cwd, env: childEnv, name, timeoutMs = 900_000 },
  ) {
    const handle = start(command, args, { cwd, env: childEnv, name });
    let timedOut = false;
    // The normal path below awaits the same shutdown if this one is running.
    const timer = setTimeout(() => {
      timedOut = true;
      void stopGroup(handle.pgid).catch(() => {});
    }, timeoutMs);
    await handle.done;
    clearTimeout(timer);
    const gone = handle.pgid === undefined || (await stopGroup(handle.pgid));
    const output = fs.readFileSync(handle.logFile, "utf8");
    return {
      status: handle.error ? -1 : (handle.status ?? -1),
      signal: handle.signal,
      // The sandbox ended the command: its status says nothing about it.
      timedOut,
      output: handle.error ? `${handle.error.message}\n${output}` : output,
      gone,
      pgid: handle.pgid,
      pid: handle.pid,
    };
  }

  async function freePort() {
    for (;;) {
      const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const { port: assigned } = server.address();
          server.close(() => resolve(assigned));
        });
      });
      if (OWNER_PORTS.has(port) || usedPorts.has(port)) continue;
      usedPorts.add(port);
      return port;
    }
  }

  function listenerPids(port) {
    try {
      const out = execFileSync(
        "lsof",
        ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
        {
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return [
        ...new Set(
          out
            .split("\n")
            .filter((line) => line.startsWith("p"))
            .map((line) => Number(line.slice(1))),
        ),
      ];
    } catch {
      return [];
    }
  }

  /** The local addresses listening on a port, as lsof names them. */
  function listenerAddresses(port) {
    try {
      const out = execFileSync(
        "lsof",
        ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"],
        {
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return [
        ...new Set(
          out
            .split("\n")
            .filter((line) => line.startsWith("n"))
            .map((line) => line.slice(1)),
        ),
      ];
    } catch {
      return [];
    }
  }

  const listenerIs = (port, pid) => listenerState(port, pid).state === "owned";

  /** "none" (no listener), "owned" (exactly the expected pid) or "foreign". */
  function listenerState(port, pid) {
    const pids = listenerPids(port);
    if (pids.length === 0) return { state: "none", pids };
    if (pids.length === 1 && pids[0] === pid) return { state: "owned", pids };
    return { state: "foreign", pids };
  }

  /**
   * Stops every owned group; resolves to the ids still present afterwards.
   * Closing is marked before the snapshot, so no group can start after it.
   */
  let disposal;
  function dispose() {
    closing = true;
    disposal ??= (async () => {
      await Promise.all([...groups.keys()].map((pgid) => stopGroup(pgid)));
      const left = [...groups.keys()];
      if (!keep) removeRoot();
      return left;
    })();
    return disposal;
  }

  process.on("exit", () => {
    // Only groups whose supervisor is still alive are provably this run's.
    for (const [pgid, handle] of groups) {
      if (handle.leaderExited) continue;
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    if (!keep && fs.existsSync(root)) {
      try {
        removeRoot();
      } catch {
        // leave it for the owner to see
      }
    }
  });

  return {
    root,
    marker,
    offlineLog,
    guardLoadedLog,
    env,
    guardMark,
    guardedSince,
    ensureOpen,
    assertInsideSandbox,
    start,
    run,
    stopGroup,
    ownsGroup: (pgid) => groups.has(pgid),
    signalsSent: () => [...signalsSent],
    freePort,
    listenerPids,
    listenerIs,
    listenerState,
    listenerAddresses,
    dispose,
    randomToken: () => crypto.randomBytes(8).toString("hex"),
  };
}

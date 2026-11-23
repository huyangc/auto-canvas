// The safety machinery of the notebook integration check: a private temporary
// root, an allow-listed child environment, the offline guard, process groups
// and listener ownership. Nothing here ever touches the notebook checkout.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const OWNER_PORTS = new Set([3000, 8000, 4310]);

// The bound for a supervisor's answer to "stop" (see the protocol); a busy
// machine may take seconds to boot a Node process.
const STOP_ACK_MS = 10_000;

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
// the process group. The group id is the supervisor's pid, and while the
// supervisor has not exited it is an unreaped child of this script, so that
// number cannot belong to anyone else: the group is signalled only while
// that holds.
//
// The start / stop / release protocol (R7-1). Messages travel over one IPC
// channel, in order in each direction.
//
//   script -> supervisor   { spec }    once, queued by start(): the command,
//                                      its arguments, cwd and environment
//                                      (never on a command line: ps shows
//                                      those), and, for stage S only, test
//                                      delays of the launch and of the stop
//                                      acknowledgement.
//   script -> supervisor   "stop"      once, first step of every shutdown.
//   script -> supervisor   "release"   only after the stop acknowledgement
//                                      and after the group held nothing but
//                                      the supervisor.
//   supervisor -> script   { pid } | { error } | { status, signal }
//                                      the command's spawn, spawn error, end.
//   supervisor -> script   { stopAck, cancelled, running }
//                                      the answer to "stop". Before sending
//                                      it the supervisor has set `stopped`,
//                                      so from then on it starts nothing:
//                                      either the command was already
//                                      spawned (running tells whether it is
//                                      still alive) or a pending launch was
//                                      cancelled.
//   supervisor -> script   { releaseRefused }
//                                      "release" while the command is alive.
//
// Supervisor states: booting (its code has not run yet; messages wait in the
// channel) -> idle (no spec yet) -> pending (spec received, delayed launch) ->
// launched (spawned or spawn failed) ; any of idle, pending, launched ->
// stopped on "stop". It ignores SIGTERM/SIGINT/SIGHUP and exits only on
// "release" with no live command, on SIGKILL, or when the channel to the
// script closes, in which case it first SIGKILLs its own group (the script
// is gone and nobody else may clean up a group it does not own).
//
// Shutdown (stopGroup), while the supervisor is this script's live child:
// send "stop" and wait for the acknowledgement (bounded). Only after it is
// the group's membership meaningful, because nothing new can start in it.
// Then SIGTERM the group if anything besides the supervisor is in it,
// SIGKILL after 5 s, then "release". No acknowledgement within the bound, or
// a refused or unanswered release: SIGKILL to the group (still provably
// ours). Once the supervisor has exited, the group is never signalled again.
const SUPERVISOR = String.raw`"use strict";
const { spawn } = require("child_process");
const send = (message) => { try { process.send(message); } catch {} };
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {});
let child;
let running = false;
let stopped = false;
let pending;
let ackDelayMs = 0;
function launch(spec) {
  pending = undefined;
  if (stopped || child) return;
  const [command, args, cwd, env] = spec;
  try {
    child = spawn(command, args, { cwd, env, stdio: "inherit" });
  } catch (error) {
    send({ error: error.message });
    return;
  }
  running = child.pid !== undefined;
  if (running) send({ pid: child.pid });
  child.once("error", (error) => { running = false; send({ error: error.message }); });
  child.once("exit", (status, signal) => { running = false; send({ status, signal }); });
}
process.on("message", (message) => {
  if (message === "stop") {
    stopped = true;
    const cancelled = pending !== undefined;
    if (cancelled) clearTimeout(pending);
    pending = undefined;
    const ack = { stopAck: true, cancelled, running };
    if (ackDelayMs > 0) setTimeout(send, ackDelayMs, ack);
    else send(ack);
  } else if (message === "release") {
    if (running) send({ releaseRefused: true });
    else process.exit(0);
  } else if (message && Array.isArray(message.spec)) {
    if (stopped || child || pending) return;
    ackDelayMs = message.ackDelayMs > 0 ? message.ackDelayMs : 0;
    if (message.delayMs > 0) pending = setTimeout(launch, message.delayMs, message.spec);
    else launch(message.spec);
  }
});
process.on("disconnect", () => {
  try { process.kill(0, "SIGKILL"); } catch {}
  process.exit(1);
});
`;

function sameDirectory(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * The field lines of an lsof -F run (R7-5). lsof exits 1 with no output when
 * nothing matches: that is an empty list. A check that could not run (lsof
 * missing, killed, another status, status 1 with a diagnostic) throws with
 * it, so a healthy server is never read as "not listening". Status 0 is a
 * result even if lsof warned on stderr.
 */
export function lsofLines(result, what, field) {
  const stderr = (result.stderr ?? "").trim();
  if (result.error)
    throw new Error(`${what} could not run: ${result.error.message}`);
  if (result.status === 1 && !(result.stdout ?? "").trim() && !stderr)
    return [];
  if (result.status !== 0)
    throw new Error(
      `${what} failed (${result.status ?? result.signal}): ${stderr || "(no stderr)"}`,
    );
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith(field))
    .map((line) => line.slice(1));
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
  function start(command, args, { cwd, env: childEnv, name, testHooks = {} }) {
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
      stopAckMs: testHooks.stopAckMs ?? STOP_ACK_MS,
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
    // Replies to the shutdown's "stop" and "release" (see the protocol).
    const replies = [];
    handle.reply = (kind) =>
      new Promise((resolve) => replies.push({ kind, resolve }));
    const answer = (kind, value) => {
      for (const waiter of replies.filter((entry) => entry.kind === kind)) {
        replies.splice(replies.indexOf(waiter), 1);
        waiter.resolve(value);
      }
    };
    child.on("message", (message) => {
      if (message?.stopAck) {
        handle.stopAck = message;
        if (message.cancelled)
          finish({ error: new Error("the launch was cancelled by a stop") });
        answer("stopAck", message);
      } else if (message?.releaseRefused) answer("release", "refused");
      else if (message?.pid) {
        handle.pid = message.pid;
        markReady();
      } else if (message?.error) finish({ error: new Error(message.error) });
      else if (message && "status" in message)
        finish({ status: message.status, signal: message.signal });
    });
    child.on("error", (error) => {
      // Only a supervisor that never started is gone; other errors (a
      // failed send) leave it this script's live child: the bounded waits
      // of the shutdown deal with a channel that stopped working.
      if (child.pid !== undefined) return;
      handle.leaderExited = true;
      finish({ error });
      answer("stopAck", undefined);
      answer("release", "exited");
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
      answer("stopAck", undefined);
      answer("release", "exited");
    });
    // The command line holds no part of the command's environment.
    if (child.pid !== undefined)
      child.send(
        {
          spec: [command, args, cwd, childEnv ?? env()],
          delayMs: testHooks.launchDelayMs ?? 0,
          ackDelayMs: testHooks.ackDelayMs ?? 0,
        },
        (error) => {
          if (error) finish({ error });
        },
      );
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
    // A reply, or undefined when the bound passes first.
    const within = (promise, ms) =>
      Promise.race([promise, sleep(ms).then(() => undefined)]);
    const shutdown = (async () => {
      try {
        if (!handle.leaderExited) {
          // 1. Synchronise with the launch: after the acknowledgement the
          //    supervisor starts nothing, so the membership read below is
          //    final. A supervisor that does not answer (still booting on a
          //    busy machine, or stuck) is killed with its group while it is
          //    still this script's live child.
          let ack;
          try {
            handle.child.send("stop", () => {});
            ack = await within(handle.reply("stopAck"), handle.stopAckMs);
          } catch {
            ack = undefined; // channel closed: the supervisor is exiting
          }
          if (!ack) signalGroup("SIGKILL");
          else {
            // 2. Anything besides the supervisor is the command or its
            //    descendants: SIGTERM, then SIGKILL.
            if (!othersGone()) {
              signalGroup("SIGTERM");
              if (!(await waitFor(othersGone, 5000, 100)))
                signalGroup("SIGKILL");
            }
            // 3. Release. The supervisor refuses while its command lives;
            //    a refusal or no answer ends it with SIGKILL to the group.
            if (!handle.leaderExited) {
              let released;
              try {
                handle.child.send("release", () => {});
                released = await within(
                  Promise.race([
                    handle.reply("release"),
                    waitFor(() => handle.leaderExited, 5000, 50).then((gone) =>
                      gone ? "exited" : undefined,
                    ),
                  ]),
                  5000,
                );
              } catch {
                released = undefined;
              }
              if (released !== "exited") signalGroup("SIGKILL");
            }
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
    const result = spawnSync(
      "lsof",
      ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return [
      ...new Set(lsofLines(result, `lsof for port ${port}`, "p").map(Number)),
    ];
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
    // The synchronous path cannot wait for a stop acknowledgement, and needs
    // none: SIGKILL to a group whose supervisor is still this script's live
    // child is safe (the number is ours) and total (the supervisor dies with
    // it, so a launch still queued in its channel can never run). A group
    // whose supervisor has exited is not ours to signal; it was already
    // stopped, or reported as still present. If this script dies without
    // running this handler (SIGKILL), each supervisor sees its channel close
    // and SIGKILLs its own group.
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

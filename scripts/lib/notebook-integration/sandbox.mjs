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

/**
 * The script's own file operation would act outside the sandbox (or through
 * a symlink): refused before anything is removed or written; exit status 2.
 */
export class PathRefused extends UsageError {}

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

/**
 * `waitFor` for a loop whose check is a slow probe (R9-3). The check gets the
 * time left, so the probe it sends can be capped at it, and the deadline is
 * tested again after the check, so a success that arrives after the deadline
 * is not accepted. A probe that ignores the remaining time still cannot push
 * the loop past its limit.
 */
export async function waitForWithin(check, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const value = await check(remaining);
    if (Date.now() >= deadline) return false;
    if (value) return value;
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
// The log files live under the sandbox root, which processes of the revision
// under test can write to: a link planted at one of them would make this
// append write outside (R8-1). O_NOFOLLOW makes the open fail instead; the
// append is then skipped and the missing entry FAILs the step that reads it.
function append(path, text) {
  let fd;
  try {
    fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o644);
    fs.writeSync(fd, text);
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
try {
  if (process.env.NB_CHECK_GUARD_LOADED)
    append(process.env.NB_CHECK_GUARD_LOADED, JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv }) + "\n");
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
    append(process.env.NB_CHECK_OFFLINE_LOG, host + " " + String(options.port).trim() + "\n");
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

  // ---- The script's own file operations (R8-1) ---------------------------
  //
  // Every removal, directory creation, file write, log-file open, tree copy
  // and read the script itself performs under the sandbox root goes through
  // one of the helpers below, which validate and act in one call:
  //   - the path lies under the root;
  //   - every ancestor from the root down is a real directory (lstat: never a
  //     symlink, never a file) whose real path is inside the root's;
  //   - the target itself is not a symlink either; a removal refuses one
  //     instead of unlinking it, so a redirected write path is never quietly
  //     replaced;
  //   - writes and reads open the target with O_NOFOLLOW, so a link created
  //     between the check and the open fails the open instead of being
  //     followed.
  // A violation throws PathRefused (exit status 2 for the run, the path named
  // relative to the clone or the sandbox) before anything is removed or
  // written. Paths under the root can be changed by code of the revision that
  // ran (a build, a server, the launcher), so nothing here trusts a check made
  // earlier. Remaining window: a check followed by the operation is not
  // atomic against a process that is still running; see the T160 section of
  // docs/testing/README.md for which operations can run while one is.
  const realRoot = fs.realpathSync(root);
  const inside = (base, target) => {
    const rel = path.relative(base, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  const clone = path.join(root, "nb");
  function label(target) {
    const resolved = path.resolve(target);
    if (resolved === clone) return "<clone>";
    if (inside(clone, resolved)) return path.relative(clone, resolved);
    if (inside(root, resolved))
      return `<sandbox>/${path.relative(root, resolved)}`;
    return resolved;
  }
  function refuse(target, why) {
    throw new PathRefused(
      `refused: ${label(target)} ${why} (nothing removed or written)`,
    );
  }

  /**
   * The validation shared by every helper. Returns `{ stat }` (lstat of the
   * target, or undefined when it does not exist) or `{ missing }` (the first
   * ancestor that does not exist; nothing below it exists either).
   */
  function checkChain(target) {
    const resolved = path.resolve(target);
    if (resolved === root || !inside(root, resolved))
      refuse(target, "is not inside the sandbox root");
    const rootStat = fs.lstatSync(root);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      fs.realpathSync(root) !== realRoot
    )
      refuse(root, "is no longer the sandbox root this run created");
    const parts = path.relative(root, resolved).split(path.sep);
    let current = root;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") return { missing: current };
        refuse(current, `cannot be checked: ${error.code ?? error.message}`);
      }
      if (stat.isSymbolicLink()) refuse(current, "is a symlink");
      if (!stat.isDirectory()) refuse(current, "is not a directory");
      if (!inside(realRoot, fs.realpathSync(current)))
        refuse(current, "resolves outside the sandbox root");
    }
    try {
      return { stat: fs.lstatSync(resolved) };
    } catch (error) {
      if (error.code === "ENOENT") return { stat: undefined };
      refuse(target, `cannot be checked: ${error.code ?? error.message}`);
    }
  }

  /** Remove a file or a tree; absent is fine, a symlink target is refused. */
  function removePath(target) {
    const { missing, stat } = checkChain(target);
    if (missing || !stat) return;
    if (stat.isSymbolicLink()) refuse(target, "is a symlink");
    fs.rmSync(target, { recursive: true, force: true });
  }

  /** Create a directory (and, with `recursive`, its missing ancestors). */
  function makeDir(target, { recursive = false } = {}) {
    const resolved = path.resolve(target);
    const { missing, stat } = checkChain(resolved);
    if (missing) {
      if (!recursive) refuse(missing, "does not exist");
      makeDir(path.dirname(resolved), { recursive: true });
      return makeDir(resolved);
    }
    if (stat) {
      if (stat.isSymbolicLink()) refuse(resolved, "is a symlink");
      if (!stat.isDirectory())
        refuse(resolved, "exists and is not a directory");
      return;
    }
    fs.mkdirSync(resolved);
  }

  const { O_WRONLY, O_RDONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants;

  /** Open a regular file for writing (created or truncated); returns an fd. */
  function openForWrite(target, mode = 0o644) {
    const { missing, stat } = checkChain(target);
    if (missing) refuse(missing, "does not exist");
    if (stat?.isSymbolicLink()) refuse(target, "is a symlink");
    if (stat && !stat.isFile()) refuse(target, "is not a regular file");
    try {
      return fs.openSync(
        target,
        O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW,
        mode,
      );
    } catch (error) {
      if (error.code === "ELOOP") refuse(target, "became a symlink");
      throw error;
    }
  }

  function writeFile(target, content, mode) {
    const fd = openForWrite(target, mode);
    try {
      fs.writeFileSync(fd, content);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Read a regular file; undefined when it does not exist. A link is refused
   * (a revision could point a log at a file outside and have it printed).
   */
  function readFile(target, encoding) {
    const { missing, stat } = checkChain(target);
    if (missing || !stat) return undefined;
    if (stat.isSymbolicLink()) refuse(target, "is a symlink");
    if (!stat.isFile()) refuse(target, "is not a regular file");
    let fd;
    try {
      fd = fs.openSync(target, O_RDONLY | O_NOFOLLOW);
    } catch (error) {
      if (error.code === "ELOOP") refuse(target, "became a symlink");
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
    try {
      return fs.readFileSync(fd, encoding);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** The entries of a real directory inside the root; [] when absent. */
  function listDir(target) {
    const { missing, stat } = checkChain(target);
    if (missing || !stat) return [];
    if (stat.isSymbolicLink()) refuse(target, "is a symlink");
    if (!stat.isDirectory()) refuse(target, "is not a directory");
    return fs.readdirSync(target, { withFileTypes: true });
  }

  /** `target` is an existing real directory inside the root (or the root). */
  function assertRealDir(target) {
    if (path.resolve(target) === root) return;
    const { missing, stat } = checkChain(target);
    if (missing) refuse(missing, "does not exist");
    if (!stat) refuse(target, "does not exist");
    if (stat.isSymbolicLink()) refuse(target, "is a symlink");
    if (!stat.isDirectory()) refuse(target, "is not a directory");
  }

  /**
   * Copy a tree to `to` (replacing it) with the given command; `to` is
   * removed through removePath and must then be absent under a real parent.
   */
  function copyTree(to, run) {
    removePath(to);
    const { missing, stat } = checkChain(to);
    if (missing) refuse(missing, "does not exist");
    if (stat) refuse(to, "still exists after its removal");
    run();
  }
  /**
   * The allow-listed child environment, with `extra` on top. By default it
   * sets SILICON_NOTEBOOK_ENV_FILE to "" (silicon-notebook then reads no
   * dotenv file); `{ envFile: false }` leaves the key out altogether, so the
   * notebook reads `<root>/.env` and a canvas launcher, which refuses the key
   * even when empty, can start (stage M).
   */
  function env(extra = {}, { envFile = true } = {}) {
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
    const merged = { ...base, ...extra };
    if (!envFile) delete merged.SILICON_NOTEBOOK_ENV_FILE;
    return merged;
  }

  /** The current end of the marker log; pass it to guardedSince later. */
  function guardMark() {
    // A validated read: a revision's process could have replaced the marker
    // with a link, and a link is refused rather than followed.
    return readFile(guardLoadedLog)?.length ?? 0;
  }

  /** The processes that loaded the guard since `mark`: { pid, ppid, argv }. */
  function guardedSince(mark, log = guardLoadedLog) {
    // A revision's processes write this file: read it without following a
    // link (a refusal propagates; it is not "no entries").
    const buffer = readFile(log);
    if (buffer === undefined) return [];
    const text = buffer.subarray(mark).toString("utf8");
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
    // A command started in a swapped directory would act wherever the link
    // points: its working directory gets the same check as a write.
    if (cwd !== undefined) assertRealDir(cwd);
    const logFile = path.join(
      logs,
      `${String(++counter).padStart(2, "0")}-${name}.log`,
    );
    const fd = openForWrite(logFile);
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
    const output = readFile(handle.logFile, "utf8") ?? "";
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

  /**
   * The pids listening on a port. `timeoutMs` bounds the lsof run itself
   * (R11-3): a caller with a deadline hands it the time it has left, so a
   * stalled enumeration is a failure within the deadline instead of an
   * unbounded block.
   */
  function listenerPids(port, { timeoutMs } = {}) {
    const result = spawnSync(
      "lsof",
      ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0
          ? { timeout: Math.max(1, Math.ceil(timeoutMs)) }
          : {}),
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

  /**
   * "none" (no listener), "owned" (exactly the expected pid) or "foreign".
   * `options.timeoutMs` bounds the lsof enumeration (R11-3).
   */
  function listenerState(port, pid, options) {
    const pids = listenerPids(port, options);
    if (pids.length === 0) return { state: "none", pids };
    if (pids.length === 1 && pids[0] === pid) return { state: "owned", pids };
    return { state: "foreign", pids };
  }

  /**
   * Stops every owned group; resolves to the ids still present afterwards.
   * Closing is marked before the snapshot, so no group can start after it.
   * The cleanups a stage registered (`beforeDispose`) run first, after
   * closing is marked and before any group is stopped or the root removed:
   * a stage whose processes leave the owned groups (stage M's companion
   * services) stops them there, also after an interrupt.
   */
  let disposal;
  const cleanups = [];
  function dispose() {
    closing = true;
    disposal ??= (async () => {
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          console.log(`FAIL a stage cleanup: ${error?.message ?? error}`);
        }
      }
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
    removePath,
    makeDir,
    openForWrite,
    writeFile,
    readFile,
    listDir,
    assertRealDir,
    copyTree,
    label,
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
    beforeDispose: (cleanup) => cleanups.push(cleanup),
    randomToken: () => crypto.randomBytes(8).toString("hex"),
  };
}

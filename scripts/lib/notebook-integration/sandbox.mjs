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

// The preload: every Node child of the check loads it through NODE_OPTIONS.
const OFFLINE_GUARD = String.raw`"use strict";
const net = require("net");
const fs = require("fs");
const original = net.Socket.prototype.connect;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);
function optionsOf(args) {
  const first = args[0];
  if (Array.isArray(first)) return { options: first[0], wrapped: first };
  if (first !== null && typeof first === "object") return { options: first };
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { options: { port: Number(first), host: typeof args[1] === "string" ? args[1] : undefined } };
  }
  return { options: { path: first } };
}
net.Socket.prototype.connect = function guardedConnect(...args) {
  const { options, wrapped } = optionsOf(args);
  if (!options || options.path !== undefined) return original.apply(this, args);
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
    fs.appendFileSync(process.env.NB_CHECK_OFFLINE_LOG, host + " " + options.port + "\n");
  } catch {}
  const error = new Error("offline guard refused " + host + ":" + options.port);
  error.code = "ENETUNREACH";
  process.nextTick(() => this.destroy(error));
  return this;
};
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

  const groups = new Set();
  const usedPorts = new Set();
  let counter = 0;

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

  function env(extra = {}) {
    const base = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: tmp,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_IGNORE_INCORRECT_LOCKFILE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      NODE_OPTIONS: `--require ${guardPath} --dns-result-order=ipv4first`,
      NB_CHECK_OFFLINE_LOG: offlineLog,
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

  // macOS answers EPERM, not ESRCH, while a group holds only exited members
  // that their parent has not reaped yet. That is "not gone yet": keep waiting
  // rather than treat it as an error, and never as proof of absence.
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

  /** Spawn a process that leads its own group; stdout and stderr go to a log file. */
  function start(command, args, { cwd, env: childEnv, name }) {
    const logFile = path.join(
      logs,
      `${String(++counter).padStart(2, "0")}-${name}.log`,
    );
    const fd = fs.openSync(logFile, "w");
    const child = spawn(command, args, {
      cwd,
      env: childEnv ?? env(),
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    fs.closeSync(fd);
    const handle = { child, pgid: child.pid, logFile, exited: false };
    if (child.pid !== undefined) groups.add(child.pid);
    handle.done = new Promise((resolve) => {
      child.once("error", (error) => {
        handle.exited = true;
        handle.error = error;
        resolve();
      });
      child.once("exit", (status, signal) => {
        handle.exited = true;
        handle.status = status;
        handle.signal = signal;
        resolve();
      });
    });
    return handle;
  }

  /** Stop an owned group: SIGTERM, SIGKILL after 5 s, verify, then forget it. */
  async function stopGroup(pgid) {
    if (!groups.has(pgid)) return true;
    const signalGroup = (signal) => {
      try {
        process.kill(-pgid, signal);
      } catch (error) {
        // EPERM: nothing left in the group that can take a signal (see
        // groupAlive); the wait below decides whether it is really gone.
        if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
      }
    };
    signalGroup("SIGTERM");
    if (!(await waitFor(() => !groupAlive(pgid), 5000, 50))) {
      signalGroup("SIGKILL");
      await waitFor(() => !groupAlive(pgid), 5000, 50);
    }
    const gone = !groupAlive(pgid);
    groups.delete(pgid);
    return gone;
  }

  async function run(
    command,
    args,
    { cwd, env: childEnv, name, timeoutMs = 900_000 },
  ) {
    const handle = start(command, args, { cwd, env: childEnv, name });
    const timer = setTimeout(() => void stopGroup(handle.pgid), timeoutMs);
    await handle.done;
    clearTimeout(timer);
    const gone =
      handle.child.pid === undefined || (await stopGroup(handle.pgid));
    const output = fs.readFileSync(handle.logFile, "utf8");
    return {
      status: handle.error ? -1 : (handle.status ?? -1),
      signal: handle.signal,
      output: handle.error ? `${handle.error.message}\n${output}` : output,
      gone,
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

  const listenerIs = (port, pid) => {
    const pids = listenerPids(port);
    return pids.length === 1 && pids[0] === pid;
  };

  let disposal;
  function dispose() {
    disposal ??= (async () => {
      await Promise.all([...groups].map((pgid) => stopGroup(pgid)));
      if (!keep) removeRoot();
    })();
    return disposal;
  }

  process.on("exit", () => {
    for (const pgid of groups) {
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
    env,
    start,
    run,
    stopGroup,
    groupAlive,
    freePort,
    listenerPids,
    listenerIs,
    dispose,
    randomToken: () => crypto.randomBytes(8).toString("hex"),
  };
}

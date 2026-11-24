// The steps stages A and M share on a private clone of a silicon-notebook
// revision: the clone and its revision, the refusals about what the clone
// holds, the private modules copy, the guarded `next build`, and the launch of
// `npm run start` (scripts/prod.sh) with its readiness and its shutdown. Each
// step reports under the names stage A has always used; stage M passes its
// own label where a step's name carries one.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { cloneTreeProblems } from "./clone-safety.mjs";
import { modulesInClone, prepareModules } from "./modules.mjs";
import { waitFor, waitForWithin } from "./sandbox.mjs";
import {
  abnormalEnd,
  awaitOwnership,
  checkStopped,
  guardLoaded,
  nextCommand,
  ownershipGate,
  OwnershipLost,
  proxiedGate,
  tail,
} from "./steps.mjs";

// Dotenv files a launch or build of the clone would read by fixed name:
// scripts/prod.sh sources <clone>/.env (ALLOW_NO_ENV_FILE only allows it to
// be absent), and Next loads these from frontend/ at build and start. Any of
// them, as a file or a symlink (lstat: a dangling one counts), would override
// the allow-listed environment, so its presence refuses the step — unless it
// is a file the stage wrote itself and it still holds exactly what was
// written (stage M's own <clone>/.env).
const DOTENV_FILES = [
  ".env",
  ...[
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.test.local",
  ].map((name) => `frontend/${name}`),
];

/** Thrown after a refusal has been reported: the stage stops there. */
export class Refused extends Error {}

/** The SHA-256 (hex) of a string or buffer. */
export const sha256 = (content) =>
  crypto.createHash("sha256").update(content).digest("hex");

/**
 * The script's own removal of the build output before a build. Validated in
 * the same call (R8-1): a `frontend` that a server of the revision swapped
 * for a link is refused, never followed.
 */
export const removeNext = (sandbox, frontend) =>
  sandbox.removePath(path.join(frontend, ".next"));

/** The script's own creation of `<clone>/.local` when the revision has none. */
export const makeLocal = (sandbox, nb) =>
  sandbox.makeDir(path.join(nb, ".local"));

/** Reads of files a build or the launcher wrote, never through a link. */
function launchLogTail(sandbox, nb, launcherLog) {
  const logs = path.join(nb, ".local/logs");
  const parts = [tail(sandbox.readFile(launcherLog, "utf8") ?? "", 15)];
  for (const entry of sandbox.listDir(logs))
    if (entry.isFile())
      parts.push(
        `--- ${entry.name}\n${tail(sandbox.readFile(path.join(logs, entry.name), "utf8") ?? "", 15)}`,
      );
  return parts.join("\n");
}

/**
 * Clone the notebook repository into `nb`, resolve `ref` (and `base`, when
 * given) to commits there and check the candidate out. Returns
 * `{ git, candidate, base }`, or undefined after a reported failure.
 */
export async function cloneRevision({
  sandbox,
  report,
  notebook,
  nb,
  ref,
  base,
}) {
  const git = (args, cwd = nb) =>
    execFileSync("git", args, {
      cwd,
      env: sandbox.env(),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });

  // Clone and resolve the revisions to commits.
  const cloned = await sandbox.run(
    "git",
    ["clone", "--quiet", "--no-hardlinks", notebook, nb],
    {
      cwd: sandbox.root,
      name: "clone",
    },
  );
  checkStopped(
    report,
    "clone of the notebook repository",
    cloned.pgid,
    cloned.gone,
  );
  if (
    !report.check("clone of the notebook repository", cloned.status === 0, () =>
      tail(cloned.output),
    )
  )
    return undefined;
  const resolve = (name) => {
    for (const spelling of [name, `origin/${name}`]) {
      try {
        return git([
          "rev-parse",
          "--verify",
          "--quiet",
          `${spelling}^{commit}`,
        ]).trim();
      } catch {
        // try the next spelling
      }
    }
    return undefined;
  };
  const candidate = resolve(ref);
  const resolvedBase = base === undefined ? undefined : resolve(base);
  const resolved =
    base === undefined
      ? report.check(
          "--ref resolves to a commit",
          candidate,
          `ref ${candidate}`,
        )
      : report.check(
          "--ref and --base resolve to commits",
          candidate && resolvedBase,
          `ref ${candidate}, base ${resolvedBase}`,
        );
  if (!resolved) return undefined;
  console.log(`     candidate ${candidate} (${ref})`);
  if (base !== undefined)
    console.log(`     base      ${resolvedBase} (${base})`);
  // The checkout writes inside the clone: its directory must still be a real
  // directory inside the sandbox (R8-1).
  sandbox.assertRealDir(nb);
  git(["checkout", "--quiet", "--detach", candidate]);
  return { git, candidate, base: resolvedBase };
}

/**
 * The refusals about what the clone holds. `written` lists the files the
 * stage wrote into the clone itself, as `{ relative, sha256 }` (a stage
 * appends to it after each write): such a dotenv file is accepted only while
 * it is a regular file, not a symlink, holding exactly what was written; any
 * other dotenv file still refuses.
 */
export function cloneGuards({ sandbox, report, nb, written = [] }) {
  const frontend = path.join(nb, "frontend");
  const ownDotenvProblem = (relative) => {
    const own = written.find((entry) => entry.relative === relative);
    if (!own) return `${relative}`;
    const file = path.join(nb, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink())
      return `${relative} (written by the stage, now a symlink)`;
    if (!stat.isFile())
      return `${relative} (written by the stage, now not a regular file)`;
    let content;
    try {
      content = sandbox.readFile(file);
    } catch (error) {
      return `${relative} (written by the stage, not readable: ${error.message})`;
    }
    if (content === undefined || sha256(content) !== own.sha256)
      return `${relative} (written by the stage, its content changed)`;
    return undefined;
  };
  const cloneProblems = (paths, phase, { modules = false } = {}) => {
    const problems = [];
    for (const target of paths) {
      try {
        sandbox.assertInsideSandbox(target);
      } catch (error) {
        problems.push(error.message);
      }
    }
    const dotenv = DOTENV_FILES.filter((relative) => {
      try {
        fs.lstatSync(path.join(nb, relative));
        return true;
      } catch (error) {
        // ENOTDIR: an ancestor is not a directory; that ancestor is the
        // refusal (reported by the path checks), not a dotenv file.
        return error.code !== "ENOENT" && error.code !== "ENOTDIR";
      }
    })
      .map(ownDotenvProblem)
      .filter(Boolean);
    if (dotenv.length)
      problems.push(`dotenv file(s) in the clone: ${dotenv.join(", ")}`);
    if (phase) problems.push(...cloneTreeProblems(nb, phase));
    // R6-3: the walk skips frontend/node_modules, so the copied modules are
    // rechecked on their own around every build and before the launch.
    if (modules)
      problems.push(
        ...modulesInClone(sandbox, path.join(frontend, "node_modules")),
      );
    return problems;
  };
  // A refusal names the offending paths relative to the clone, happens before
  // the next process starts and ends the run with exit status 2.
  const refuseUnsafeClone = (name, paths, phase, extra) => {
    sandbox.ensureOpen(name);
    const problems = cloneProblems(paths, phase, extra);
    if (problems.length) {
      report.fail(name, `${problems.join("; ")} (nothing built or launched)`);
      throw new Refused();
    }
  };
  return { cloneProblems, refuseUnsafeClone };
}

/**
 * The clone's own paths, refused before any copy, build or launch: a tracked
 * symlink at any path the stage writes to, or a dotenv file.
 */
export function refuseUnsafeStart({ nb, refuseUnsafeClone, report }) {
  const frontend = path.join(nb, "frontend");
  const clonePaths = [
    nb,
    frontend,
    path.join(nb, ".local"),
    path.join(frontend, ".next"),
    path.join(frontend, "node_modules"),
  ];
  refuseUnsafeClone(
    "the clone's paths are real directories inside the sandbox, without dotenv files",
    clonePaths,
    "start",
  );
  report.ok(
    "the clone's paths are real directories inside the sandbox, without dotenv files",
  );
}

/**
 * The source checkout's installed frontend modules, copied into the clone
 * when they match the revision. Returns false after a reported failure.
 */
export async function copyModules({
  sandbox,
  report,
  notebook,
  nb,
  git,
  candidate,
}) {
  const frontend = path.join(nb, "frontend");
  const lockAtCandidate = git([
    "show",
    `${candidate}:frontend/package-lock.json`,
  ]);
  const lockInSource = fs.readFileSync(
    path.join(notebook, "frontend/package-lock.json"),
    "utf8",
  );
  if (
    !report.check(
      "installed modules match the revision under test",
      lockAtCandidate === lockInSource,
      "frontend/package-lock.json differs between the candidate and the source checkout",
    )
  )
    return false;
  const modules = path.join(frontend, "node_modules");
  const preflight = await prepareModules(
    sandbox,
    path.join(notebook, "frontend/node_modules"),
    modules,
  );
  if (preflight.problems.length) {
    report.fail(
      "private modules preflight",
      preflight.problems.slice(0, 10).join("; "),
    );
    return false;
  }
  report.ok(
    `private modules preflight (next ${preflight.version}; native SWC ${preflight.loaded.join(", ")})`,
  );
  return true;
}

/**
 * `npm run build` in the clone's frontend, with the clone checked before and
 * after and the guard's positive marker required of `next build`.
 */
export function makeBuild({ sandbox, report, nb, refuseUnsafeClone }) {
  const frontend = path.join(nb, "frontend");
  return async (extra, name, envOptions) => {
    refuseUnsafeClone(
      `${name}: the clone is safe to build in`,
      [frontend],
      "built",
      { modules: true },
    );
    const mark = sandbox.guardMark();
    const result = await sandbox.run("npm", ["run", "build"], {
      cwd: frontend,
      env: sandbox.env(extra, envOptions),
      name,
    });
    checkStopped(report, `${name}`, result.pgid, result.gone);
    // After an interrupt the sandbox is gone: nothing below means anything.
    sandbox.ensureOpen(`${name}: checks after the build`);
    // R6-1: the process that did the build must have loaded the guard.
    guardLoaded(
      sandbox,
      report,
      `${name}: the offline guard was loaded in next build`,
      mark,
      nextCommand("build"),
    );
    // The generated files the build wrote must still be what they should be,
    // and the modules must still be the private copy.
    refuseUnsafeClone(
      `${name}: the build left regular files inside the clone`,
      [frontend],
      "built",
      { modules: true },
    );
    return result;
  };
}

const psField = (field, pid) => {
  try {
    return execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    }).trim();
  } catch {
    return undefined;
  }
};

/** The process group of a pid, or -1 when it cannot be read. */
export const groupOf = (pid) => {
  const value = psField("pgid", pid);
  return value === undefined ? -1 : Number(value);
};

/** The command line of a pid, or undefined when it is gone. */
export const commandOf = (pid) => psField("command", pid);

export const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * Wait for `npm run start` (started by the caller as `launch.launcher`) to
 * exit 0 and print both PIDs, check that both services are in its process
 * group, that each owns its port and that `/api/ready` answers ready through
 * the frontend. The reported services are recorded in `launch.services` as
 * soon as they are known, for `stopLaunch`. Returns the gates and helpers the
 * caller's probes use, or undefined after a reported failure.
 */
export async function awaitLaunch({
  sandbox,
  report,
  label,
  nb,
  launch,
  apiPort,
  webPort,
}) {
  const { launcher } = launch;
  const logTail = () => launchLogTail(sandbox, nb, launcher.logFile);
  if (!(await waitFor(() => launcher.exited, 120_000)))
    return void report.fail(
      `${label} launcher finished`,
      `still running after 120 s\n${logTail()}`,
    );
  const output = sandbox.readFile(launcher.logFile, "utf8") ?? "";
  const backendPid = Number(/backend\s+:.*\(PID (\d+)/.exec(output)?.[1]);
  const frontendPid = Number(/frontend\s+:.*\(PID (\d+)/.exec(output)?.[1]);
  // Whatever was reported is checked after the shutdown, even if the
  // launcher then failed.
  launch.services = [
    ["backend", backendPid],
    ["frontend", frontendPid],
  ].filter(([, pid]) => pid > 0);
  // R8-3: a launcher that printed its PIDs and then failed is a failure of
  // its own, before any readiness is looked at.
  const launcherEnd = abnormalEnd({
    status: launcher.error ? -1 : launcher.status,
    signal: launcher.signal,
  });
  if (
    !report.check(
      `${label} the launcher exited 0`,
      !launcherEnd && launcher.status === 0 && !launcher.error,
      () =>
        `${launcherEnd || launcher.error?.message || `exit ${launcher.status}`}\n${logTail()}`,
    )
  )
    return undefined;
  if (
    !report.check(
      `${label} launcher printed both PIDs`,
      backendPid > 0 && frontendPid > 0,
      logTail(),
    )
  )
    return undefined;
  const outside = [backendPid, frontendPid].filter(
    (pid) => groupOf(pid) !== launcher.pgid,
  );
  if (outside.length) {
    for (const pid of outside)
      report.info(`out-of-group pid ${pid}: ${commandOf(pid) ?? "(gone)"}`);
    report.fail(
      label,
      `service(s) ${outside.join(", ")} are not in the launcher's process group`,
    );
    return undefined;
  }
  report.ok(`${label} both services are in the owned process group`);

  // Ownership has three states per port: no listener yet, the expected
  // pid, or another pid, which fails at once (and is never signalled).
  const ownership = () => ({
    api: sandbox.listenerState(apiPort, backendPid),
    web: sandbox.listenerState(webPort, frontendPid),
  });
  const bothOwned = ({ api, web }) =>
    api.state === "owned" && web.state === "owned";
  const describeOwnership = ({ api, web }) =>
    `api ${apiPort}: ${api.state} [${api.pids}] (want ${backendPid}); ` +
    `web ${webPort}: ${web.state} [${web.pids}] (want ${frontendPid})`;
  const waited = await awaitOwnership(sandbox, {
    apiPort,
    webPort,
    backendPid,
    frontendPid,
  });
  let seen = waited.seen;
  if (
    !report.check(
      `${label} each port is owned by the service the launcher started`,
      waited.ok,
      () =>
        `${waited.reason || "timeout"}: ${describeOwnership(seen)}\n${logTail()}`,
    )
  )
    return undefined;
  // Every request to a port this run claims goes through an ownership gate
  // (R8-2); the gate asks again immediately before each request, so a port
  // that changes hands stops the probes instead of reaching a replacement.
  // Requests the frontend forwards to the backend (`/api/...`) go through
  // the proxied gate, which requires both listeners (R9-2): the backend's
  // port can change hands without the frontend noticing.
  const getWeb = ownershipGate(sandbox, webPort, frontendPid);
  const getApi = ownershipGate(sandbox, apiPort, backendPid);
  const getProxied = proxiedGate(sandbox, {
    webPort,
    webPid: frontendPid,
    apiPort,
    apiPid: backendPid,
  });
  // A request that fails after the gate passed (the server died between the
  // two) is reported as its status, not as a stack trace; a lost port still
  // stops the probes. The deadline caps the request itself (R9-3).
  const send = async (get, rawPath, deadlineMs, method, init) => {
    try {
      return await get(rawPath, method, deadlineMs, init);
    } catch (error) {
      if (error instanceof OwnershipLost) throw error;
      return { status: `error ${error.message}`, headers: {}, body: "" };
    }
  };
  // The services are up once the anonymous readiness probe says so. Each
  // probe is capped at the time the loop has left, and the loop's deadline
  // holds after it (R9-3), so a stalled frontend cannot stretch the 120 s
  // limit or have a late success accepted. The request is sent only while
  // both ports are still owned: another pid, or a port that lost its
  // listener, fails at once.
  let dead = "";
  let lost = "";
  // Unlike pidAlive, EPERM counts as gone here, as it always has for this
  // wait: the launcher's own children never answer it.
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const ready = await waitForWithin(
    async (remaining) => {
      if (!alive(backendPid) || !alive(frontendPid)) {
        dead = `pid ${alive(backendPid) ? frontendPid : backendPid} died`;
        return true;
      }
      try {
        const res = await send(
          getProxied,
          "/api/ready",
          Math.min(remaining, 30_000),
        );
        return res.status === 200 && JSON.parse(res.body).ready === true;
      } catch (error) {
        if (error instanceof OwnershipLost) {
          lost = error.message;
          return true;
        }
        return false;
      }
    },
    120_000,
    1000,
  );
  if (!ready || dead || lost)
    return void report.fail(
      `${label} /api/ready reports ready through the frontend`,
      `${dead || lost || "timeout"}\n${logTail()}`,
    );
  seen = ownership();
  if (!bothOwned(seen))
    return void report.fail(
      `${label} ports still owned after the readiness answer`,
      describeOwnership(seen),
    );
  return {
    backendPid,
    frontendPid,
    getWeb,
    getApi,
    getProxied,
    send,
    ownership,
    bothOwned,
    describeOwnership,
    logTail,
  };
}

/**
 * Stop the launcher's process group and check that the services it reported
 * are gone. Returns true when both hold.
 */
export async function stopLaunch({ sandbox, report, label, launch }) {
  const { launcher, services } = launch;
  const gone = await sandbox.stopGroup(launcher.pgid);
  report.check(
    `${label} the owned process group is stopped`,
    gone,
    `process group ${launcher.pgid} still present`,
  );
  // R7-3: a service that moved to another group would survive the group's
  // shutdown. Both recorded pids must be gone; a survivor is reported for
  // the owner to inspect and never signalled (it is no longer provably
  // this run's).
  let survivors = [];
  if (services.length) {
    survivors = await survivingPids(services);
    report.check(
      `${label} both service PIDs are gone after the shutdown`,
      survivors.length === 0,
      () => survivors.map(describeSurvivor).join("; "),
    );
  }
  return gone && survivors.length === 0;
}

/** The [name, pid] pairs still alive after a 5 s grace period. */
export async function survivingPids(services) {
  const alive = ([, pid]) => pidAlive(pid);
  await waitFor(() => !services.some(alive), 5000, 100);
  return services.filter(alive);
}

function describeSurvivor([name, pid]) {
  let command;
  try {
    command = execFileSync("ps", ["-o", "pgid=,command=", "-p", String(pid)], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    }).trim();
  } catch {
    command = "(gone by now)";
  }
  return `${name} pid ${pid} still alive, not signalled: ${command}`;
}

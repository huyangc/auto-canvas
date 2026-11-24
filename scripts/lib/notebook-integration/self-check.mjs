// Stage S: self-checks of the script's own refusals, on throwaway material only
// (a throwaway local git repository cloned inside the sandbox, never the
// notebook checkout). Each negative control also proves that the file outside
// the clone is byte-identical afterwards.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloneTreeProblems } from "./clone-safety.mjs";
import {
  modulesInClone,
  prepareModules,
  preflightModules,
} from "./modules.mjs";
import {
  PathRefused,
  UsageError,
  lsofLines,
  waitFor,
  waitForWithin,
} from "./sandbox.mjs";
import { dependencyManifests } from "./stage-a.mjs";
import {
  adminSession,
  cleanUp,
  databaseLedger,
  dropDatabases,
  identityOf,
  integration,
  managedCanvas,
  managedCompanions,
  observedLaunch,
  openAdmin,
  runExtensionStop,
} from "./managed-clone.mjs";
import {
  firstRefusal,
  listProblem,
  misroutedAnswer,
  misroutingProblems,
  projectList,
  reopenedProblem,
} from "./stage-m.mjs";
import {
  cloneGuards,
  makeLocal,
  removeNext,
  sha256,
  survivingPids,
} from "./notebook-clone.mjs";
import {
  TOKEN_KEY,
  browserSessions,
  forwardingProxy,
  guardNetwork,
  networkChecks,
} from "./stage-l.mjs";
import {
  removeAppNext,
  singleRuleControl,
  upstreamDownProbe,
  writeApp,
} from "./stage-t.mjs";
import { rawRequest, startStub, transportAssertions } from "./transport.mjs";
import {
  abnormalEnd,
  awaitOwnership,
  checkStopped,
  guardLoaded,
  ownershipGate,
  OwnershipLost,
  proxiedGate,
  StageAborted,
  startNext,
  stopServer,
  tail,
  tripleGate,
  writePackage,
} from "./steps.mjs";

/** Build a throwaway repository, commit it, and clone it. Returns the clone. */
async function makeClone(sandbox, name, { files = {}, links = {} }) {
  const base = path.join(sandbox.root, "self-check", name);
  const repo = path.join(base, "repo");
  const clone = path.join(base, "clone");
  sandbox.makeDir(repo, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(repo, relative);
    sandbox.makeDir(path.dirname(file), { recursive: true });
    sandbox.writeFile(file, content);
  }
  for (const [relative, target] of Object.entries(links)) {
    const link = path.join(repo, relative);
    sandbox.makeDir(path.dirname(link), { recursive: true });
    // A link is what the scenario plants: created directly, since a helper
    // that validates write paths refuses to make one.
    fs.symlinkSync(target, link);
  }
  const git = (args, cwd) =>
    sandbox.run(
      "git",
      ["-c", "user.name=check", "-c", "user.email=c@c", ...args],
      {
        cwd,
        name: `self-${name}-git`,
        timeoutMs: 60_000,
      },
    );
  for (const [args, cwd] of [
    [["init", "--quiet"], repo],
    [["add", "-A"], repo],
    [["commit", "--quiet", "-m", "x"], repo],
    [["clone", "--quiet", "--no-hardlinks", repo, clone], base],
  ]) {
    const result = await git(args, cwd);
    if (result.status !== 0) throw new Error(result.output);
  }
  return clone;
}

export async function stageS({ sandbox, report }) {
  const outside = path.join(sandbox.root, "self-check", "outside");
  sandbox.makeDir(outside, { recursive: true });
  const outsideFile = path.join(outside, "target.txt");
  const outsideBytes = Buffer.from("outside the clone\n");
  sandbox.writeFile(outsideFile, outsideBytes);
  sandbox.makeDir(path.join(outside, "dir"));

  const scenarios = [
    {
      name: "next-env-outside",
      links: { "frontend/next-env.d.ts": outsideFile },
      phase: "start",
      refused: "frontend/next-env.d.ts",
    },
    {
      name: "backend-log-outside",
      files: { ".local/logs/x": "" },
      links: { ".local/logs/backend.log": outsideFile },
      phase: "start",
      refused: ".local/logs/backend.log",
    },
    {
      name: "symlinked-local",
      links: { ".local": path.join(outside, "dir") },
      phase: "start",
      refused: ".local",
    },
    {
      name: "inside-link-allowed",
      files: { "README.md": "x\n", "frontend/a.txt": "x\n" },
      links: { "docs-link": "README.md", "frontend/b.txt": "a.txt" },
      phase: "start",
      refused: undefined,
    },
    {
      name: "inside-link-on-write-path",
      files: { "frontend/other.d.ts": "x\n" },
      links: { "frontend/next-env.d.ts": "other.d.ts" },
      phase: "start",
      refused: "frontend/next-env.d.ts is a symlink on a path the run writes",
    },
    {
      name: "directory-above-a-write-path-is-a-link",
      files: { "real-frontend/a.txt": "x\n" },
      links: { frontend: "real-frontend" },
      phase: "start",
      refused: "frontend is a symlink on a path the run writes",
    },
    {
      name: "dangling-link",
      links: { "docs-link": "missing-target" },
      phase: "start",
      refused: "docs-link is a dangling symlink",
    },
    {
      name: "tracked-release-manifest",
      files: { "release-manifest.json": "{}\n" },
      phase: "start",
      refused: "release-manifest.json exists",
    },
    {
      name: "tracked-local",
      files: { ".local/keep": "" },
      phase: "start",
      refused: ".local exists",
    },
    {
      name: "launch-fresh-local",
      files: { "frontend/package.json": "{}\n" },
      before: (clone, box) => {
        box.makeDir(path.join(clone, "frontend/.next"), { recursive: true });
        box.makeDir(path.join(clone, ".local"));
      },
      phase: "launch",
      refused: undefined,
    },
    {
      name: "launch-local-not-empty",
      files: { "frontend/package.json": "{}\n" },
      before: (clone, box) => {
        box.makeDir(path.join(clone, ".local"));
        box.writeFile(path.join(clone, ".local/x"), "");
      },
      phase: "launch",
      refused: ".local is not empty",
    },
    {
      name: "built-generated-file-redirected",
      files: { "frontend/next-env.d.ts": "x\n" },
      before: (clone, box) => {
        box.makeDir(path.join(clone, "frontend/.next"), { recursive: true });
        box.removePath(path.join(clone, "frontend/next-env.d.ts"));
        fs.symlinkSync(outsideFile, path.join(clone, "frontend/next-env.d.ts"));
      },
      phase: "built",
      refused: "frontend/next-env.d.ts is a symlink resolving outside",
    },
    {
      name: "built-next-is-a-link",
      files: { "frontend/a": "x\n" },
      before: (clone) =>
        fs.symlinkSync(
          path.join(outside, "dir"),
          path.join(clone, "frontend/.next"),
        ),
      phase: "built",
      refused: "frontend/.next is a symlink resolving outside",
    },
    // R8-4: a `frontend` that is not a directory is a refusal naming it, not
    // an ENOTDIR stack trace.
    {
      name: "frontend-is-a-regular-file",
      files: { frontend: "not a directory\n" },
      phase: "start",
      refused: "frontend is not a directory",
    },
    {
      name: "frontend-is-a-link-to-a-file",
      files: { "real.txt": "x\n" },
      links: { frontend: "real.txt" },
      phase: "start",
      refused: "frontend is a symlink on a path the run writes",
    },
    // T165: the UI plugin sync's outputs are write paths too: a link there,
    // even one inside the clone, is refused.
    {
      name: "sync-output-is-a-link",
      files: { "frontend/features/extension-sdk/other.ts": "x\n" },
      links: {
        "frontend/features/extension-sdk/registry.local.ts": "other.ts",
      },
      phase: "start",
      refused:
        "frontend/features/extension-sdk/registry.local.ts is a symlink on a path the run writes",
    },
  ];
  for (const scenario of scenarios) {
    const clone = await makeClone(sandbox, scenario.name, scenario);
    scenario.before?.(clone, sandbox);
    const problems = cloneTreeProblems(clone, scenario.phase);
    const verdict =
      scenario.refused === undefined
        ? problems.length === 0
        : problems.some((problem) => problem.includes(scenario.refused));
    const untouched = sandbox.readFile(outsideFile).equals(outsideBytes);
    report.check(
      `S ${scenario.name}: ${scenario.refused === undefined ? "accepted" : `refused (${scenario.refused})`}`,
      verdict && untouched,
      `problems ${JSON.stringify(problems)}; outside file untouched: ${untouched}`,
    );
  }

  // R5-2: a launcher-reported service that exits before binding must end the
  // ownership wait at once, not after 120 s.
  const apiPort = await sandbox.freePort();
  const webPort = await sandbox.freePort();
  const dying = sandbox.start(process.execPath, ["-e", "process.exit(0)"], {
    cwd: sandbox.root,
    name: "self-dying-service",
  });
  // The environment of a supervised command may hold a secret made for the
  // run; it must not be readable on a command line (ps).
  const secret = `secret-${sandbox.randomToken()}`;
  const waiting = sandbox.start(
    process.execPath,
    ["-e", "setTimeout(()=>{},60000)"],
    {
      cwd: sandbox.root,
      name: "self-waiting-service",
      env: { ...sandbox.env(), NB_CHECK_SELF_SECRET: secret },
    },
  );
  try {
    await Promise.all([dying.ready, waiting.ready]);
    const commandLines = execFileSync(
      "ps",
      ["-o", "command=", "-p", `${waiting.pgid},${waiting.pid}`],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    );
    const inherited = execFileSync(
      "ps",
      ["eww", "-o", "command=", "-p", String(waiting.pid)],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    );
    report.check(
      "S a supervised command's environment is not on any command line",
      commandLines.trim().split("\n").length === 2 &&
        !commandLines.includes(secret) &&
        inherited.includes(secret),
      `command lines hold the secret: ${commandLines.includes(secret)}; the command itself received it: ${inherited.includes(secret)}`,
    );
    await dying.done;
    const started = Date.now();
    const result = await awaitOwnership(sandbox, {
      apiPort,
      webPort,
      backendPid: dying.pid,
      frontendPid: waiting.pid,
    });
    const seconds = (Date.now() - started) / 1000;
    report.check(
      "S a service that exits before binding ends the ownership wait at once",
      !result.ok && /exited before binding/.test(result.reason) && seconds < 10,
      `ok ${result.ok}, reason ${JSON.stringify(result.reason)}, ${seconds}s`,
    );
  } finally {
    // A live group is signalled (the positive half of the R6-2 control).
    const before = sandbox.signalsSent().length;
    const gone = await sandbox.stopGroup(waiting.pgid);
    const sent = sandbox
      .signalsSent()
      .slice(before)
      .filter((entry) => entry.pgid === waiting.pgid);
    report.check(
      "S a live owned group is signalled and stopped",
      gone && sent.some((entry) => entry.signal === "SIGTERM"),
      `gone ${gone}, signals ${JSON.stringify(sent)}`,
    );
    await sandbox.stopGroup(dying.pgid);
  }

  await exitedGroupControl(sandbox, report);
  await stopRaceControls(sandbox, report);
  await npmGuardDetectionControls(sandbox, report);
  modulesRecheckControls(sandbox, report);
  await abnormalEndControl(sandbox, report);
  await ownershipBeforeProbeControl(sandbox, report);
  await ownershipGateControls(sandbox, report);
  await movedServiceControl(sandbox, report);
  await shutdownAbortControl(sandbox, report);
  dependencyManifestControl(report);
  lsofFailureControl(sandbox, report);
  ownOperationControls(sandbox, report);
  await proxiedProbeControl(sandbox, report);
  await readinessDeadlineControl(report);
  await frontendNotADirectoryControl(sandbox, report);
  await rewriteDestinationControl(sandbox, report);
  await swcPreflightControls(sandbox, report);
  await listenerBudgetControl(sandbox, report);
  await startupDeadlineControl(sandbox, report);
  await preflightCwdControl(sandbox, report);
  await upstreamVacancyControl(sandbox, report);
  await stageMSharedControls(sandbox, report);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * R7-1: a stop requested while a launch may still be in flight. The command
 * writes a marker file 300 ms after it starts; after every stop no process of
 * it may be alive and the marker must be absent. Three orders: a stop right
 * after start() (repeated, so both the "spawned first" and "stop first" paths
 * are hit), a stop while the launch is held back by the supervisor's test
 * delay (must be cancelled: nothing ever runs), and a stop after the command
 * has started (must be signalled).
 */
async function stopRaceControls(sandbox, report) {
  const dir = path.join(sandbox.root, "self-check", "stop-race");
  sandbox.makeDir(dir, { recursive: true });
  const code =
    'setTimeout(()=>require("fs").writeFileSync(process.env.NB_CHECK_RACE_MARKER,"ran"),300);' +
    "setTimeout(()=>{},5000)";
  const variants = [
    { name: "a stop right after start()", rounds: 12 },
    {
      name: "a stop while the launch is pending",
      rounds: 3,
      launchDelayMs: 500,
      expect: "cancelled",
    },
    {
      name: "a stop after the command started",
      rounds: 3,
      afterReady: true,
      expect: "signalled",
    },
  ];
  for (const variant of variants) {
    const slug = variant.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const runs = [];
    for (let round = 0; round < variant.rounds; round += 1) {
      const marker = path.join(dir, `${slug}-${round}`);
      const handle = sandbox.start(process.execPath, ["-e", code], {
        cwd: dir,
        name: `self-race-${slug}`,
        env: sandbox.env({ NB_CHECK_RACE_MARKER: marker }),
        testHooks: { launchDelayMs: variant.launchDelayMs },
      });
      if (variant.afterReady) await handle.ready;
      const before = sandbox.signalsSent().length;
      const gone = await sandbox.stopGroup(handle.pgid);
      const signalled = sandbox
        .signalsSent()
        .slice(before)
        .some((entry) => entry.pgid === handle.pgid);
      runs.push({ handle, marker, gone, signalled });
    }
    // Longer than the command's 300 ms delay (and the 500 ms launch delay).
    await sleep(1000);
    const outcomes = {};
    const problems = [];
    for (const [round, run] of runs.entries()) {
      const outcome = run.handle.stopAck?.cancelled
        ? "cancelled"
        : run.signalled
          ? "signalled"
          : run.handle.pid === undefined
            ? "never spawned"
            : "spawned, not signalled";
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      const ran = fs.existsSync(run.marker);
      const alive = run.handle.pid !== undefined && pidAlive(run.handle.pid);
      if (
        !run.gone ||
        ran ||
        alive ||
        (variant.expect && outcome !== variant.expect)
      )
        problems.push(
          `round ${round}: ${outcome}, group gone ${run.gone}, side effect ${ran}, command alive ${alive}`,
        );
    }
    report.info(`${variant.name}: ${JSON.stringify(outcomes)}`);
    report.check(
      `S ${variant.name} (${variant.rounds}x) leaves no command running and no side effect`,
      problems.length === 0,
      () => problems.join("; "),
    );
  }

  // A supervisor that does not acknowledge the stop within the bound (here
  // its acknowledgement is held back 3 s against a 300 ms bound) is killed
  // with its group while it is still this script's live child.
  const marker = path.join(dir, "unanswered");
  const handle = sandbox.start(process.execPath, ["-e", code], {
    cwd: dir,
    name: "self-race-unanswered",
    env: sandbox.env({ NB_CHECK_RACE_MARKER: marker }),
    testHooks: { ackDelayMs: 3000, stopAckMs: 300 },
  });
  await handle.ready;
  const before = sandbox.signalsSent().length;
  const gone = await sandbox.stopGroup(handle.pgid);
  const sent = sandbox
    .signalsSent()
    .slice(before)
    .filter((entry) => entry.pgid === handle.pgid);
  await sleep(500);
  const ran = fs.existsSync(marker);
  const alive = pidAlive(handle.pid);
  report.check(
    "S a supervisor that does not acknowledge a stop is killed with its group",
    gone &&
      !ran &&
      !alive &&
      sent.length === 1 &&
      sent[0].signal === "SIGKILL" &&
      handle.stopAck === undefined,
    `gone ${gone}, signals ${JSON.stringify(sent)}, side effect ${ran}, command alive ${alive}`,
  );

  // The supervisor never leaves a live command behind: a "release" while the
  // command runs is refused and the supervisor stays (the group stays ours).
  const held = sandbox.start(
    process.execPath,
    ["-e", "setTimeout(()=>{},20000)"],
    {
      cwd: dir,
      name: "self-release-refused",
    },
  );
  await held.ready;
  const reply = held.reply("release");
  held.child.send("release", () => {});
  const answer = await Promise.race([reply, sleep(5000).then(() => "none")]);
  await sleep(200);
  const stayed = !held.leaderExited && pidAlive(held.pid);
  const stopped = await sandbox.stopGroup(held.pgid);
  report.check(
    "S a release while the command runs is refused and the supervisor stays",
    answer === "refused" && stayed && stopped && !pidAlive(held.pid),
    `answer ${answer}, supervisor and command stayed ${stayed}, then stopped ${stopped}`,
  );
}

/**
 * R7-2: the transport table asks for ownership before every probe and stops
 * at the first foreign listener, before sending anything to it.
 */
async function ownershipBeforeProbeControl(sandbox, report) {
  const port = await sandbox.freePort();
  const stub = await startStub(port);
  const failures = [];
  const quiet = {
    ok() {},
    fail: (name, detail) => failures.push(`${name}: ${detail}`),
    check(name, condition, detail) {
      if (!condition)
        this.fail(name, typeof detail === "function" ? detail() : detail);
      return Boolean(condition);
    },
  };
  let asked = 0;
  try {
    await transportAssertions({
      nextPort: port,
      stub,
      report: quiet,
      owner: () => {
        asked += 1;
        return { state: "foreign", pids: [2] };
      },
    });
  } finally {
    await stub.close();
  }
  report.check(
    "S the transport table stops at the first probe after the listener changed",
    asked === 1 &&
      stub.records.length === 0 &&
      failures.length === 1 &&
      /before every probe.*foreign.*after 0 probes/.test(failures[0]),
    () =>
      `asked ${asked}, upstream ${stub.records.length}, failures ${JSON.stringify(failures)}`,
  );
}

/**
 * R7-3: a service that left the owned group survives its shutdown; the A6
 * check reports it (and never signals it). The control's own grandchild,
 * detached into its own group, plays that service; it is ended afterwards
 * by its recorded pid.
 */
async function movedServiceControl(sandbox, report) {
  const pidFile = path.join(sandbox.root, "self-check", "moved-service.pid");
  const code =
    'const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},20000)"],{detached:true,stdio:"ignore"});' +
    'require("fs").writeFileSync(process.env.NB_CHECK_PID_FILE,String(c.pid));c.unref();setTimeout(()=>{},20000)';
  const handle = sandbox.start(process.execPath, ["-e", code], {
    cwd: sandbox.root,
    name: "self-moved-service",
    env: sandbox.env({ NB_CHECK_PID_FILE: pidFile }),
  });
  await waitFor(() => fs.existsSync(pidFile), 10_000, 50);
  const moved = Number(fs.readFileSync(pidFile, "utf8"));
  const gone = await sandbox.stopGroup(handle.pgid);
  const survivors = await survivingPids([
    ["moved", moved],
    ["command", handle.pid],
  ]);
  report.check(
    "S a service moved out of the owned group is reported after the shutdown",
    gone &&
      survivors.length === 1 &&
      survivors[0][1] === moved &&
      pidAlive(moved),
    `group gone ${gone}, survivors ${JSON.stringify(survivors)}`,
  );
  // This run started it and recorded its pid: end it.
  try {
    process.kill(moved, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * R9-1: a step whose process group survived its shutdown ends the stage. A
 * group that outlives its shutdown cannot be built for a control: SIGKILL is
 * neither catchable nor ignorable, and a process that left the group is never
 * signalled with it — so the survival is injected into the function the
 * stages call, with a real live group standing for the one still there. The
 * statement after the step must not run; the shape the stages had before
 * (record the failure, continue) runs it, which is what the finding names.
 */
async function shutdownAbortControl(sandbox, report) {
  const live = sandbox.start(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { cwd: sandbox.root, name: "self-shutdown-abort" },
  );
  await live.ready;
  const groupPresent = () => {
    try {
      process.kill(-live.pgid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  };
  const wasPresent = groupPresent();
  // The step, and whether the statement after it ran.
  const ranAfter = (step) => {
    let ran = false;
    try {
      step();
      ran = true;
    } catch {
      // the step ends the stage
    }
    return ran;
  };
  const { failures, report: quiet } = quietReporter();
  let thrown;
  const currentRanAfter = ranAfter(() => {
    try {
      checkStopped(quiet, "the step's shutdown", live.pgid, false);
    } catch (error) {
      thrown = error;
      throw error;
    }
  });
  const { failures: oldFailures, report: oldQuiet } = quietReporter();
  const recordOnly = (report, step, pgid, gone) => {
    if (!gone) report.fail(step, `process group ${pgid} still present`);
    return gone;
  };
  const oldRanAfter = ranAfter(() =>
    recordOnly(oldQuiet, "the step's shutdown", live.pgid, false),
  );
  const gone = await sandbox.stopGroup(live.pgid);
  report.check(
    "S R9-1: a step whose group survived its shutdown stops the stage",
    wasPresent &&
      failures.length === 1 &&
      oldFailures.length === 1 &&
      oldRanAfter &&
      !currentRanAfter &&
      thrown instanceof StageAborted &&
      /still present/.test(thrown.message) &&
      gone,
    `live group ${wasPresent}; the FAIL ${JSON.stringify(failures)}; the next statement ran ${currentRanAfter} (the record-only shape's did ${oldRanAfter}); error ${thrown?.name ?? "none"}; group stopped afterwards ${gone}`,
  );
}

/** R7-4: A1 protects the exact manifests, not any package.json. */
function dependencyManifestControl(report) {
  const changed = [
    "frontend/tests/fixtures/example/package.json",
    "docs/package.json",
    "frontend/package.json",
    "package-lock.json",
    "backend/requirements-dev.txt",
    "backend/sub/requirements.txt",
  ];
  const found = dependencyManifests(changed);
  const expected = [
    "frontend/package.json",
    "package-lock.json",
    "backend/requirements-dev.txt",
  ];
  report.check(
    "S A1 matches the exact manifests and not a fixture's package.json",
    JSON.stringify(found) === JSON.stringify(expected),
    `found ${JSON.stringify(found)}`,
  );
}

/**
 * R7-5: an lsof run that cannot run or fails is an error with its
 * diagnostic, never an empty listener list; "no match" stays empty.
 */
function lsofFailureControl(sandbox, report) {
  const throws = (result) => {
    try {
      lsofLines(result, "lsof", "p");
      return false;
    } catch {
      return true;
    }
  };
  const missing = spawnSync("nb-check-no-such-lsof", [], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  const cases = [
    ["lsof missing", throws(missing)],
    [
      "status 1 with a diagnostic",
      throws({ status: 1, stdout: "", stderr: "lsof: bad option" }),
    ],
    [
      "killed",
      throws({ status: null, signal: "SIGKILL", stdout: "", stderr: "" }),
    ],
    ["no match is empty", !throws({ status: 1, stdout: "", stderr: "" })],
    [
      "a real unused port",
      (() => {
        try {
          return sandbox.listenerPids(1).length === 0;
        } catch {
          return false;
        }
      })(),
    ],
  ];
  report.check(
    "S a failing lsof is an error, an unused port an empty list",
    cases.every(([, ok]) => ok),
    () =>
      cases
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
        .join(", "),
  );
}

/**
 * R6-2: a group whose members have all exited (here the command and its
 * supervisor, ended by their own recorded pids) is never signalled again:
 * its number may already belong to someone else. Cleanup must send it
 * nothing and drop it.
 */
async function exitedGroupControl(sandbox, report) {
  const handle = sandbox.start(
    process.execPath,
    ["-e", "setTimeout(()=>{},60000)"],
    { cwd: sandbox.root, name: "self-exited-group" },
  );
  await handle.ready;
  process.kill(handle.pid, "SIGKILL");
  await handle.done;
  process.kill(handle.pgid, "SIGKILL");
  await waitFor(() => handle.leaderExited, 10_000, 50);
  const before = sandbox.signalsSent().length;
  const gone = await sandbox.stopGroup(handle.pgid);
  const sent = sandbox
    .signalsSent()
    .slice(before)
    .filter((entry) => entry.pgid === handle.pgid);
  report.check(
    "S a group that has fully exited is sent nothing and dropped",
    gone && sent.length === 0 && !sandbox.ownsGroup(handle.pgid),
    `gone ${gone}, signals ${JSON.stringify(sent)}, still owned ${sandbox.ownsGroup(handle.pgid)}`,
  );
}

/**
 * R6-1, the detection half: what npm configuration cannot close (a script
 * that clears NODE_OPTIONS itself, or an inner npm given --node-options on
 * its command line, which outranks the environment) must be caught by the
 * marker check the stages run after each command. The probe here connects
 * nowhere; it only has to be absent from the marker.
 */
async function npmGuardDetectionControls(sandbox, report) {
  const cases = [
    {
      name: "a lifecycle script that clears NODE_OPTIONS",
      files: {
        "package.json": `${JSON.stringify({ name: "c", private: true, scripts: { probe: "NODE_OPTIONS= node unguarded.cjs" } })}\n`,
        "unguarded.cjs": "process.exit(0);\n",
      },
    },
    {
      name: "an inner npm given --node-options",
      files: {
        "package.json": `${JSON.stringify({
          name: "c",
          private: true,
          scripts: {
            probe:
              "npm run --silent inner --node-options=--dns-result-order=ipv4first",
            inner: "node unguarded.cjs",
          },
        })}\n`,
        "unguarded.cjs": "process.exit(0);\n",
      },
    },
  ];
  for (const scenario of cases) {
    const slug = `detect-${scenario.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const dir = writePackage(sandbox, slug, scenario.files);
    const mark = sandbox.guardMark();
    const result = await sandbox.run("npm", ["run", "--silent", "probe"], {
      cwd: dir,
      name: `self-${slug}`,
      timeoutMs: 60_000,
    });
    // The same check the stages run, on a throwaway reporter.
    const probe = { check: (name, condition) => Boolean(condition) };
    const detected = !guardLoaded(
      sandbox,
      probe,
      "unguarded",
      mark,
      (entry) =>
        typeof entry.argv?.[1] === "string" &&
        path.basename(entry.argv[1]) === "unguarded.cjs",
    );
    // npm itself did load the guard: a marker that only asked "was the
    // guard loaded at all during the command" would have passed.
    const npmGuarded = sandbox.guardedSince(mark).length > 0;
    report.check(
      `S the marker check detects ${scenario.name}`,
      result.status === 0 && detected && npmGuarded,
      () =>
        `exit ${result.status}, detected ${detected}, npm guarded ${npmGuarded}\n${tail(result.output, 5)}`,
    );
  }
}

/**
 * R6-3: the recheck stage A runs on frontend/node_modules after every build
 * and before the launch, on throwaway trees inside the sandbox.
 */
function modulesRecheckControls(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "modules");
  const outside = path.join(base, "outside");
  sandbox.makeDir(path.join(outside, "pkg"), { recursive: true });
  const outsideFile = path.join(outside, "pkg", "index.js");
  sandbox.writeFile(outsideFile, "shared\n");
  const scenarios = [
    {
      name: "replaced by a link to a shared tree",
      setup: (modules) => fs.symlinkSync(outside, modules),
      refused: "is a symlink",
    },
    {
      name: "a package linked out of the copy",
      setup: (modules) => {
        sandbox.makeDir(modules, { recursive: true });
        fs.symlinkSync(path.join(outside, "pkg"), path.join(modules, "pkg"));
      },
      refused: "resolves outside the copy",
    },
    {
      name: "internal links only",
      setup: (modules) => {
        sandbox.makeDir(path.join(modules, "real"), { recursive: true });
        sandbox.makeDir(path.join(modules, ".bin"));
        fs.symlinkSync("../real", path.join(modules, ".bin", "real"));
      },
      refused: undefined,
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const frontend = path.join(base, `clone-${index}`, "frontend");
    sandbox.makeDir(frontend, { recursive: true });
    const modules = path.join(frontend, "node_modules");
    scenario.setup(modules);
    const problems = modulesInClone(sandbox, modules);
    const verdict =
      scenario.refused === undefined
        ? problems.length === 0
        : problems.some((problem) => problem.includes(scenario.refused));
    report.check(
      `S node_modules after a build, ${scenario.name}: ${scenario.refused === undefined ? "accepted" : "refused"}`,
      verdict && sandbox.readFile(outsideFile, "utf8") === "shared\n",
      `problems ${JSON.stringify(problems)}`,
    );
  }
}

/**
 * R6-4: a build that prints the variable and then hangs until the sandbox
 * stops it is not a rejection: the A5 rule must see the abnormal end.
 */
async function abnormalEndControl(sandbox, report) {
  const result = await sandbox.run(
    process.execPath,
    [
      "-e",
      'console.log("CANVAS_PROXY_TARGET is printed, then the build hangs");setInterval(()=>{},1000)',
    ],
    { cwd: sandbox.root, name: "self-hanging-build", timeoutMs: 3000 },
  );
  const reason = abnormalEnd(result);
  const normal = abnormalEnd({ status: 1, signal: null, timedOut: false });
  report.check(
    "S a build stopped at its timeout is not counted as a rejection",
    result.timedOut && /timeout/.test(reason) && normal === "" && result.gone,
    `timedOut ${result.timedOut}, status ${result.status}, signal ${result.signal}, reason ${JSON.stringify(reason)}, normal exit 1 -> ${JSON.stringify(normal)}`,
  );
}

// ---- R8-1: the script's own file operations -------------------------------

/** Run `fn`, expecting the refusal class that ends the run with exit 2. */
function refusal(fn) {
  try {
    const value = fn();
    return { value };
  } catch (error) {
    return { error };
  }
}

/**
 * R8-1: every removal, write, copy and read the script itself performs inside
 * a clone is validated and acted in one call. Each control reproduces a
 * simulated run in which the revision's code replaced the directory above a
 * write path with a symlink (here: to a directory outside the sandbox that
 * holds sentinels), then calls the same operation the stage calls. The
 * operation must be refused with the exit-2 refusal class, the path named,
 * and every sentinel outside must survive.
 */
function ownOperationControls(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "r8-1");
  // A directory outside the sandbox root: the throwaway target a control's
  // symlink points at. It is this run's own temporary directory.
  const outside = fs.mkdtempSync(
    path.join(path.dirname(sandbox.root), "nb-check-outside-"),
  );
  const sentinel = (relative) => {
    const file = path.join(outside, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "keep\n");
    return file;
  };
  const intact = (relative) => {
    try {
      return fs.readFileSync(path.join(outside, relative), "utf8") === "keep\n";
    } catch {
      return false;
    }
  };
  const link = (target, at) => {
    sandbox.makeDir(path.dirname(at), { recursive: true });
    fs.symlinkSync(target, at);
  };
  const controls = [
    {
      name: "the .next removal when frontend was swapped for a link",
      run: () => {
        const clone = path.join(base, "next/clone");
        sandbox.makeDir(path.join(clone, "frontend/.next"), {
          recursive: true,
        });
        sandbox.writeFile(path.join(clone, "frontend/.next/victim"), "v\n");
        sandbox.removePath(path.join(clone, "frontend"));
        link(outside, path.join(clone, "frontend"));
        sentinel(".next/sentinel");
        return refusal(() => removeNext(sandbox, path.join(clone, "frontend")));
      },
      survives: () => intact(".next/sentinel"),
    },
    {
      name: "the .local creation when the clone was swapped for a link",
      run: () => {
        const parent = path.join(base, "local");
        sandbox.makeDir(path.join(parent, "clone"), { recursive: true });
        sandbox.removePath(path.join(parent, "clone"));
        link(outside, path.join(parent, "clone"));
        return refusal(() => makeLocal(sandbox, path.join(parent, "clone")));
      },
      survives: () => !fs.existsSync(path.join(outside, ".local")),
    },
    {
      name: "the stage T app files when app was swapped for a link",
      run: () => {
        const app = path.join(base, "app/app");
        // The target is outside the sandbox root: made directly, since the
        // helpers exist to refuse exactly this path.
        fs.mkdirSync(path.join(outside, "app"), { recursive: true });
        fs.writeFileSync(
          path.join(outside, "app/next.config.mjs"),
          "outside\n",
        );
        link(outside, app);
        return refusal(() =>
          writeApp(sandbox, app, { config: "", marker: "m" }),
        );
      },
      survives: () =>
        fs.readFileSync(path.join(outside, "app/next.config.mjs"), "utf8") ===
          "outside\n" && !fs.existsSync(path.join(outside, "app/pages")),
    },
    {
      name: "the stage T .next removal when app was swapped for a link",
      run: () => {
        const app = path.join(base, "app2/app");
        sentinel("app2/.next/sentinel");
        link(outside, app);
        return refusal(() => removeAppNext(sandbox, app));
      },
      survives: () => intact("app2/.next/sentinel"),
    },
    {
      name: "a file write whose parent is a symlink",
      run: () => {
        const at = path.join(base, "write/target.txt");
        link(outside, path.join(base, "write"));
        return refusal(() => sandbox.writeFile(at, "x\n"));
      },
      survives: () => !fs.existsSync(path.join(outside, "target.txt")),
    },
    {
      name: "a log-file open whose parent is a symlink",
      run: () => {
        link(outside, path.join(base, "logs"));
        return refusal(() =>
          sandbox.openForWrite(path.join(base, "logs", "x.log")),
        );
      },
      survives: () => !fs.existsSync(path.join(outside, "x.log")),
    },
    {
      name: "a read of a symlink",
      run: () => {
        sentinel("read/target");
        link(path.join(outside, "read/target"), path.join(base, "read-link"));
        return refusal(() => sandbox.readFile(path.join(base, "read-link")));
      },
      survives: () => intact("read/target"),
    },
    {
      name: "a directory listing of a symlink",
      run: () => {
        link(outside, path.join(base, "list-link"));
        return refusal(() => sandbox.listDir(path.join(base, "list-link")));
      },
      survives: () => exists(outside),
    },
    {
      name: "a command started in a swapped working directory",
      run: () => {
        link(outside, path.join(base, "cwd-link"));
        const result = refusal(() =>
          sandbox.start(process.execPath, ["-e", "0"], {
            cwd: path.join(base, "cwd-link"),
            name: "self-r8-1-cwd",
          }),
        );
        if (result.value) sandbox.stopGroup(result.value.pgid).catch(() => {});
        return result;
      },
      survives: () => !fs.existsSync(path.join(outside, "ran")),
    },
    {
      name: "a tree copy whose destination parent is a symlink",
      run: () => {
        link(outside, path.join(base, "copy"));
        return refusal(() =>
          sandbox.copyTree(path.join(base, "copy/tree"), () => {
            throw new Error("the copy must not run");
          }),
        );
      },
      survives: () => !fs.existsSync(path.join(outside, "tree")),
    },
    {
      name: "a control package written through a symlinked directory",
      run: () => {
        sandbox.makeDir(path.join(sandbox.root, "controls"), {
          recursive: true,
        });
        link(outside, path.join(sandbox.root, "controls", "r8-1-link"));
        return refusal(() =>
          writePackage(sandbox, "r8-1-link", { "package.json": "{}\n" }),
        );
      },
      survives: () => !fs.existsSync(path.join(outside, "package.json")),
    },
  ];
  // The symlinks each control points at are made inside its run, so the
  // control is self-contained.
  try {
    sandbox.makeDir(base, { recursive: true });
    for (const control of controls) {
      const result = control.run();
      const survived = control.survives();
      const refused =
        result.error instanceof PathRefused &&
        result.error instanceof UsageError;
      report.check(
        `S R8-1: ${control.name} is refused and nothing outside changes`,
        refused && survived,
        `${result.error ? result.error.message : "was not refused"}; outside unchanged ${survived}`,
      );
    }
  } finally {
    // Only ever remove the directory this control created, even when a control
    // threw before its own cleanup.
    if (
      path.dirname(outside) === path.dirname(sandbox.root) &&
      path.basename(outside).startsWith("nb-check-outside-")
    )
      fs.rmSync(outside, { recursive: true, force: true });
  }
}

const exists = (target) => {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
};

// ---- R8-2: one ownership gate for every request ---------------------------

const quietReporter = () => {
  const failures = [];
  return {
    failures,
    report: {
      ok() {},
      note() {},
      info() {},
      fail(name, detail) {
        failures.push(`${name}: ${detail}`);
      },
      check(name, condition, detail) {
        if (!condition)
          this.fail(name, typeof detail === "function" ? detail() : detail);
        return Boolean(condition);
      },
      summary() {
        return failures.length;
      },
    },
  };
};

/** A reporter that keeps its ok and fail lines (`name: detail`). */
const recordingReporter = () => {
  const lines = { ok: [], fail: [] };
  return {
    lines,
    report: {
      ok: (name) => lines.ok.push(name),
      fail: (name, detail) => lines.fail.push(`${name}: ${detail}`),
      note() {},
      info() {},
      check(name, condition, detail) {
        if (condition) this.ok(name);
        else this.fail(name, typeof detail === "function" ? detail() : detail);
        return Boolean(condition);
      },
    },
  };
};

/**
 * R8-2: the one gate refuses before a request is sent to a port this run no
 * longer owns (or never owned), so the single-rule control and the stage-A
 * probes stop at the first mismatch; a request to the port while it is owned
 * still goes through.
 */
async function ownershipGateControls(sandbox, report) {
  const port = await sandbox.freePort();
  const stub = await startStub(port);
  const { failures, report: quiet } = quietReporter();
  const foreign = process.pid + 1;
  try {
    let thrown;
    const before = stub.records.length;
    try {
      await ownershipGate(sandbox, port, foreign)("/api/health");
    } catch (error) {
      thrown = error;
    }
    const refusedBeforeSending =
      thrown instanceof OwnershipLost &&
      stub.records.length === before &&
      /foreign/.test(thrown.message);
    const stopped = await singleRuleControl({
      get: ownershipGate(sandbox, port, foreign),
      stub,
      report: quiet,
      prefix: "",
    });
    const stoppedAtFirst =
      stopped === false &&
      failures.length === 1 &&
      /foreign/.test(failures[0]) &&
      stub.records.length === before;
    const owned = await ownershipGate(
      sandbox,
      port,
      process.pid,
    )("/@notebook/canvas/x");
    report.check(
      "S R8-2: every request is gated on ownership and stops at the first mismatch",
      refusedBeforeSending && stoppedAtFirst && owned.status === 200,
      `refused before sending ${refusedBeforeSending}; control stopped at the first mismatch ${stoppedAtFirst} (${JSON.stringify(failures)}); a request while owned answered ${owned.status}; upstream records ${stub.records.length}`,
    );
  } finally {
    await stub.close();
  }
}

// ---- R9-2: a proxied request needs both listeners ------------------------

/**
 * R9-2: a request to the frontend that Next forwards to the backend is sent
 * only while both listeners are owned. The frontend is stood in by a stub
 * this process listens on (so its port is owned by the control's pid) and the
 * backend by a free port with no listener, then by a stub whose listener is
 * not the pid the control expects. The request must reach the stand-in
 * frontend in neither case; the previous shape (the frontend's port only)
 * sends it while the backend's port is held by someone else.
 */
async function proxiedProbeControl(sandbox, report) {
  const webPort = await sandbox.freePort();
  const apiPort = await sandbox.freePort();
  const web = await startStub(webPort);
  const attempt = async (gate) => {
    try {
      return { res: await gate("/api/health") };
    } catch (error) {
      return { error };
    }
  };
  let api;
  try {
    // The backend's port has no listener at all.
    const down = await attempt(
      proxiedGate(sandbox, {
        webPort,
        webPid: process.pid,
        apiPort,
        apiPid: process.pid,
      }),
    );
    const sentWhileDown = web.records.length;
    // The backend's port is held by a process that is not the expected one.
    api = await startStub(apiPort);
    const foreignGate = proxiedGate(sandbox, {
      webPort,
      webPid: process.pid,
      apiPort,
      apiPid: process.pid + 1,
    });
    const foreign = await attempt(foreignGate);
    const sentWhileForeign = web.records.length;
    // The previous shape asked only about the frontend's port, and sends.
    const oldShape = await attempt(
      ownershipGate(sandbox, webPort, process.pid),
    );
    const sentByTheOldShape = web.records.length - sentWhileForeign;
    // Both owned: the request goes through.
    const owned = await attempt(
      proxiedGate(sandbox, {
        webPort,
        webPid: process.pid,
        apiPort,
        apiPid: process.pid,
      }),
    );
    const sentWhenOwned = web.records.length - sentWhileForeign;
    report.check(
      "S R9-2: a request the frontend forwards is sent only while both ports are owned",
      down.error instanceof OwnershipLost &&
        /api .* is none/.test(down.error.message) &&
        sentWhileDown === 0 &&
        foreign.error instanceof OwnershipLost &&
        /api .* is foreign/.test(foreign.error.message) &&
        sentWhileForeign === 0 &&
        !oldShape.error &&
        sentByTheOldShape === 1 &&
        !owned.error &&
        owned.res.status === 404 &&
        sentWhenOwned === 2,
      `backend port down: ${down.error?.message ?? "sent"} (${sentWhileDown} reached the frontend); foreign backend: ${foreign.error?.message ?? "sent"} (${sentWhileForeign}); the frontend-only gate sent ${sentByTheOldShape}; both owned: ${owned.error?.message ?? `status ${owned.res.status}`} (${sentWhenOwned} reached the frontend)`,
    );
  } finally {
    await api?.close();
    await web.close();
  }
}

/**
 * R9-3: the readiness loop's deadline holds. A probe that answers after the
 * deadline is not accepted (the previous `waitFor` accepted it, ~as late as
 * the probe took), and each probe is handed the time left, so a probe that
 * ignores it still cannot stretch the limit.
 */
async function readinessDeadlineControl(report) {
  const started = Date.now();
  // The stage's shape: the probe is capped at the time left, plus a margin
  // that crosses the deadline.
  let remainingSeen;
  const capped = await waitForWithin(
    async (remaining) => {
      remainingSeen = remaining;
      await sleep(Math.min(remaining, 300) + 25);
      return true;
    },
    100,
    10,
  );
  const cappedMs = Date.now() - started;
  // A stalled probe that ignores the remaining time.
  const stalledStart = Date.now();
  const stalled = await waitForWithin(
    async () => {
      await sleep(300);
      return true;
    },
    100,
    10,
  );
  const stalledMs = Date.now() - stalledStart;
  // The previous loop, with the same stalled probe: the false success.
  const oldStart = Date.now();
  const oldAccepted = await waitFor(
    async () => {
      await sleep(300);
      return true;
    },
    100,
    10,
  );
  const oldMs = Date.now() - oldStart;
  // A prompt success is still accepted.
  const prompt = await waitForWithin(async () => true, 1000, 10);
  report.check(
    "S R9-3: a readiness probe that answers after the deadline is not accepted",
    capped === false &&
      remainingSeen > 0 &&
      remainingSeen <= 100 &&
      cappedMs < 800 &&
      stalled === false &&
      stalledMs < 1500 &&
      oldAccepted === true &&
      oldMs >= 300 &&
      prompt === true,
    `capped probe: ${capped} after ${cappedMs} ms with ${remainingSeen} ms left; stalled probe: ${stalled} after ${stalledMs} ms; the previous loop accepted ${oldAccepted} after ${oldMs} ms; a prompt success ${prompt}`,
  );
}

// ---- R8-4: frontend is not a directory -----------------------------------

/** The entry script, resolved from this module's location. */
const entryScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../notebook-integration-check.mjs",
);

/**
 * R8-4: a revision whose `frontend` is a regular file must end with the
 * documented refusal (exit 2, naming the ancestor), not an ENOTDIR stack
 * trace. Runs the real entry script on a throwaway repository, so the exit
 * status and the output are the stage's own.
 */
async function frontendNotADirectoryControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "r8-4");
  const repo = path.join(base, "repo");
  sandbox.makeDir(repo, { recursive: true });
  sandbox.writeFile(path.join(repo, "README.md"), "x\n");
  sandbox.writeFile(path.join(repo, "frontend"), "not a directory\n");
  for (const args of [
    ["init", "--quiet"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "x"],
  ]) {
    const result = spawnSync(
      "git",
      ["-c", "user.name=check", "-c", "user.email=c@c", ...args],
      { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    );
    if (result.status !== 0) {
      report.fail(
        "S R8-4: frontend as a regular file is refused",
        `git ${args[0]} failed: ${result.stderr}`,
      );
      return;
    }
  }
  const env = { PATH: process.env.PATH ?? "" };
  for (const name of ["LANG", "LC_ALL", "TMPDIR", "HOME"])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  const run = spawnSync(
    process.execPath,
    [
      entryScript,
      "--stage",
      "A",
      "--notebook",
      repo,
      "--ref",
      "HEAD",
      "--base",
      "HEAD",
      "--python",
      "/usr/bin/true",
    ],
    { cwd: repo, encoding: "utf8", env, timeout: 300_000 },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  report.check(
    "S R8-4: frontend as a regular file is refused (exit 2, naming it, no trace)",
    run.status === 2 &&
      /frontend is not a directory/.test(output) &&
      !/unexpected error/.test(output) &&
      !/\n\s+at /.test(output),
    `exit ${run.status}${run.signal ? ` (${run.signal})` : ""}; ${output
      .split("\n")
      .filter((line) => /frontend|unexpected error|^\s+at /.test(line))
      .slice(0, 6)
      .join(" | ")}`,
  );
}

// ---- R11-1: a build whose destinations are not this run's ----------------

/**
 * R11-1: a stand-in revision whose build writes a manifest that still points
 * at the developer's backend default (127.0.0.1:8000, never one of this run's
 * ports) must fail before any server of that build is started or probed. The
 * fake notebook's `next` records every `start` and every request in a marker
 * outside its own temporary root; the real entry script runs the whole of
 * stage A on it, so the failure is the stage's own.
 *
 * The installed modules are untracked: `git clone` yields a clone without
 * `frontend/node_modules` (which stage A requires to start absent), while the
 * copy is taken from the source directory exactly as it is from a real
 * checkout. They are created after the commit, so nothing of them is tracked.
 */
async function rewriteDestinationControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "r11-1");
  const repo = path.join(base, "repo");
  const marker = path.join(base, "next-ran.log");
  sandbox.makeDir(repo, { recursive: true });
  const fakeNext = `"use strict";
const fs = require("fs");
const http = require("http");
const MARK = ${JSON.stringify(marker)};
const note = (line) => { try { fs.appendFileSync(MARK, line + "\\n"); } catch {} };
const args = process.argv.slice(2);
if (args[0] === "build") {
  const dir = process.cwd();
  fs.mkdirSync(dir + "/.next", { recursive: true });
  fs.writeFileSync(dir + "/.next/routes-manifest.json", JSON.stringify({ rewrites: { beforeFiles: [], afterFiles: [
    { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
    { source: "/mcp", destination: "http://127.0.0.1:8000/mcp/" }
  ], fallback: [] } }));
  process.exit(0);
}
if (args[0] === "start") {
  const port = Number(args[args.indexOf("-p") + 1]);
  const server = http.createServer((req, res) => {
    note("request " + req.method + " " + req.url);
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<main>fake</main>");
    } else {
      res.writeHead(404);
      res.end("no");
    }
  });
  server.listen(port, "127.0.0.1", () => note("start " + port));
  return;
}
process.exit(2);
`;
  const tracked = {
    "package.json": `${JSON.stringify({
      name: "fake-notebook-root",
      private: true,
      scripts: { start: 'node -e "process.exit(9)"' },
    })}\n`,
    "frontend/package.json": `${JSON.stringify({
      name: "fake-notebook-frontend",
      private: true,
      scripts: { build: "node node_modules/next/dist/bin/next build" },
    })}\n`,
    "frontend/package-lock.json": '{"lockfileVersion":3}\n',
  };
  for (const [relative, content] of Object.entries(tracked)) {
    const file = path.join(repo, relative);
    sandbox.makeDir(path.dirname(file), { recursive: true });
    sandbox.writeFile(file, content);
  }
  for (const args of [
    ["init", "--quiet"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "x"],
  ]) {
    const result = spawnSync(
      "git",
      ["-c", "user.name=check", "-c", "user.email=c@c", ...args],
      { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    );
    if (result.status !== 0) {
      report.fail(
        "S R11-1: a build pointing at the developer's backend is never started",
        `git ${args[0]} failed: ${result.stderr}`,
      );
      return;
    }
  }
  // Untracked, created after the commit: the clone has no node_modules, and
  // stage A copies these from the source the way it copies a real install.
  const modules = path.join(repo, "frontend", "node_modules");
  const moduleFiles = {
    "next/package.json": '{"name":"next","version":"15.5.18"}\n',
    "next/dist/bin/next": fakeNext,
    "typescript/lib/typescript.js": "",
    "@types/react/index.d.ts": "",
    "@types/node/index.d.ts": "",
    "@next/swc-fake/package.json":
      '{"name":"@next/swc-fake","main":"index.js"}\n',
    "@next/swc-fake/index.js": "module.exports = {};\n",
  };
  for (const [relative, content] of Object.entries(moduleFiles)) {
    const file = path.join(modules, relative);
    sandbox.makeDir(path.dirname(file), { recursive: true });
    sandbox.writeFile(file, content);
  }

  const env = { PATH: process.env.PATH ?? "" };
  for (const name of ["LANG", "LC_ALL", "TMPDIR", "HOME"])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  const run = spawnSync(
    process.execPath,
    [
      entryScript,
      "--stage",
      "A",
      "--notebook",
      repo,
      "--ref",
      "HEAD",
      "--base",
      "HEAD",
      "--python",
      "/usr/bin/true",
    ],
    { cwd: repo, encoding: "utf8", env, timeout: 300_000 },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const records = exists(marker)
    ? fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const decisive = [
    /A2 default rewrites are exactly today's two: .*127\.0\.0\.1:8000/,
    /A4 every rewrite destination of the build it starts is this run's: .*127\.0\.0\.1:8000/,
    /A6 every rewrite destination is the temporary backend: .*127\.0\.0\.1:8000/,
  ].map((pattern) => pattern.test(output));
  report.check(
    "S R11-1: a build whose manifest points at the developer's backend is never started or probed",
    run.status === 1 &&
      records.length === 0 &&
      decisive.every(Boolean) &&
      !/A2 next start owns its port/.test(output) &&
      !/A4 next start owns its port/.test(output) &&
      !/A6 the launcher/.test(output),
    `exit ${run.status}; start/request records: ${records.length ? JSON.stringify(records.slice(0, 6)) : "none"}; destination failures A2/A4/A6: ${JSON.stringify(decisive)}`,
  );
}

// ---- R11-2: the native SWC preflight is a supervised, bounded child ------

/**
 * R11-2: the native SWC preflight runs through the supervisor with a finite
 * timeout. A binding that stalls is a problem of the preflight at the timeout
 * (never a hang), its group is the one this run stopped (a SIGTERM to the
 * group, not the unbounded synchronous child the old code left to the script's
 * exit), and the process is gone afterwards; a binding that loads is accepted.
 */
async function swcPreflightControls(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "swc-preflight");
  const make = (name, binding) => {
    const modules = path.join(base, name);
    const files = {
      "next/package.json": '{"name":"next","version":"15.5.18"}\n',
      "typescript/lib/typescript.js": "",
      "@types/react/index.d.ts": "",
      "@types/node/index.d.ts": "",
      "@next/swc-fake/package.json":
        '{"name":"@next/swc-fake","main":"index.js"}\n',
      "@next/swc-fake/index.js": binding,
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(modules, relative);
      sandbox.makeDir(path.dirname(file), { recursive: true });
      sandbox.writeFile(file, content);
    }
    return modules;
  };
  const ok = await preflightModules(
    sandbox,
    make("ok", "module.exports = {};\n"),
    { timeoutMs: 60_000 },
  );
  report.check(
    "S the native SWC preflight accepts a binding that loads",
    ok.problems.length === 0 &&
      ok.version === "15.5.18" &&
      ok.loaded.includes("swc-fake"),
    `problems ${JSON.stringify(ok.problems)}, version ${ok.version}, loaded ${JSON.stringify(ok.loaded)}`,
  );

  const stalling = make("stall", "setInterval(() => {}, 1000);\n");
  const mark = sandbox.guardMark();
  const before = sandbox.signalsSent().length;
  const started = Date.now();
  const stalled = await preflightModules(sandbox, stalling, {
    timeoutMs: 1500,
  });
  const elapsed = Date.now() - started;
  const entry = sandbox
    .guardedSince(mark)
    .find((item) => Array.isArray(item.argv) && item.argv[1] === stalling);
  const signalled = sandbox
    .signalsSent()
    .slice(before)
    .filter((signal) => entry && signal.pgid === entry.ppid);
  if (entry) await waitFor(() => !pidAlive(entry.pid), 3000, 50);
  report.check(
    "S a stalled native SWC preflight ends at its timeout as a supervised group",
    stalled.problems.some((problem) =>
      /did not finish within 1500 ms/.test(problem),
    ) &&
      elapsed < 6000 &&
      entry !== undefined &&
      !pidAlive(entry.pid) &&
      signalled.length > 0,
    `problems ${JSON.stringify(stalled.problems)} after ${elapsed} ms; guarded pid ${entry?.pid ?? "none"} alive ${entry ? pidAlive(entry.pid) : "?"}; group ${entry?.ppid ?? "?"} signals ${JSON.stringify(signalled)}`,
  );
}

// ---- R11-3: one deadline for listener checks and the request -------------

/**
 * R11-3: the listener enumeration is bounded and the HTTP request shares one
 * deadline with it. A stand-in `lsof` that would sleep 5 s is cut off at the
 * budget handed to `listenerPids` (the old code had no bound), and a gate
 * whose budget the listener checks have used up sends nothing — the request
 * never starts without time left before it.
 */
async function listenerBudgetControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "r11-3");
  const bin = path.join(base, "bin");
  sandbox.makeDir(bin, { recursive: true });
  sandbox.writeFile(
    path.join(bin, "lsof"),
    "#!/bin/sh\nexec /bin/sleep 5\n",
    0o755,
  );
  const port = await sandbox.freePort();
  const savedPath = process.env.PATH;
  let bounded = null;
  let elapsed = 0;
  try {
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
    const started = Date.now();
    try {
      sandbox.listenerPids(port, { timeoutMs: 300 });
    } catch (error) {
      bounded = error;
    }
    elapsed = Date.now() - started;
  } finally {
    process.env.PATH = savedPath;
  }

  // A gate whose budget is used up before the first listener check throws
  // without sending and without claiming the port was lost.
  const exhausted = refusal(() =>
    ownershipGate(sandbox, port, process.pid)("/x", undefined, 0),
  ).error;
  const exhaustedProxied = refusal(() =>
    proxiedGate(sandbox, {
      webPort: port,
      webPid: process.pid,
      apiPort: port,
      apiPid: process.pid,
    })("/api/ready", undefined, 0),
  ).error;
  report.check(
    "S R11-3: the listener enumeration shares the probe deadline",
    bounded !== null &&
      /lsof/.test(bounded.message) &&
      elapsed < 3000 &&
      exhausted instanceof Error &&
      !(exhausted instanceof OwnershipLost) &&
      /whole 0 ms budget/.test(exhausted.message) &&
      exhaustedProxied instanceof Error &&
      !(exhaustedProxied instanceof OwnershipLost) &&
      /whole 0 ms budget/.test(exhaustedProxied.message),
    `bounded lsof: ${bounded?.message ?? "not bounded"} after ${elapsed} ms (the stand-in sleeps 5 s); gate with a 0 ms budget: ${exhausted?.message ?? "sent"}; proxied gate: ${exhaustedProxied?.message ?? "sent"}`,
  );
}

// ---- R19-2: the startup listener checks share the wait's deadline --------

/**
 * R19-2: `startNext`'s listener enumerations are bounded by the time their
 * wait has left, and the readiness request is issued only with what remains
 * after the enumeration. A stand-in `lsof` that sleeps 5 s is cut off at the
 * 1.2 s the control gives the wait: `startNext` reports the listener check as
 * its failure within a few seconds instead of blocking, and no request is
 * sent to the server it started. That the server would have logged one is
 * shown directly afterwards.
 */
async function startupDeadlineControl(sandbox, report) {
  // The real lsof, resolved before the stand-in goes on PATH (the stand-in
  // must not find itself).
  let realLsof = "";
  try {
    realLsof = execFileSync("sh", ["-c", "command -v lsof"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    }).trim();
  } catch {
    realLsof = "";
  }
  if (!realLsof) {
    report.fail(
      "S R19-2: a slow listener check in startNext ends at the wait's deadline and sends nothing",
      "no lsof to stand in for",
    );
    return;
  }
  const base = path.join(sandbox.root, "self-check", "r19-2");
  const app = path.join(base, "app");
  const bin = path.join(base, "bin");
  const requests = path.join(base, "requests.log");
  sandbox.makeDir(bin, { recursive: true });
  // A slow but correct enumeration: after 5 s it answers as the real lsof
  // would, so the deadline is the only thing between it and a request.
  sandbox.writeFile(
    path.join(bin, "lsof"),
    `#!/bin/sh\n/bin/sleep 5\nexec ${realLsof} "$@"\n`,
    0o755,
  );
  sandbox.writeFile(requests, "");
  const fakeNext = `"use strict";
const fs = require("fs");
const http = require("http");
const args = process.argv.slice(2);
if (args[0] !== "start") process.exit(2);
const port = Number(args[args.indexOf("-p") + 1]);
const server = http.createServer((req, res) => {
  fs.appendFileSync(${JSON.stringify(requests)}, req.url + "\\n");
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<main>fake</main>");
});
server.listen(port, "127.0.0.1");
`;
  const binDir = path.join(app, "node_modules/next/dist/bin");
  sandbox.makeDir(binDir, { recursive: true });
  sandbox.writeFile(path.join(binDir, "next"), fakeNext);
  const port = await sandbox.freePort();
  const savedPath = process.env.PATH;
  let result;
  let elapsed = 0;
  try {
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
    const started = Date.now();
    result = await startNext(sandbox, {
      dir: app,
      port,
      env: sandbox.env(),
      name: "self-r19-start",
      timeoutMs: 1200,
    });
    elapsed = Date.now() - started;
  } finally {
    process.env.PATH = savedPath;
  }
  const sentDuringCheck = (sandbox.readFile(requests, "utf8") ?? "").trim();
  // The server is still up: a direct request now reaches it and is logged,
  // so the empty log above is a fact about the check, not about a server
  // that never ran.
  let reachable = false;
  try {
    reachable = await waitFor(
      () => sandbox.listenerState(port, result.handle.pid).state !== "none",
      5000,
      50,
    );
    await rawRequest(port, "/direct");
    reachable =
      reachable &&
      (sandbox.readFile(requests, "utf8") ?? "").trim() === "/direct";
  } catch {
    reachable = false;
  }
  report.check(
    "S R19-2: a slow listener check in startNext ends at the wait's deadline and sends nothing",
    typeof result.error === "string" &&
      new RegExp(
        `the listener check for port ${port} did not finish within the 1200 ms`,
      ).test(result.error) &&
      elapsed < 4000 &&
      sentDuringCheck === "" &&
      reachable,
    `error ${JSON.stringify(result.error?.split("\n")[0])} after ${elapsed} ms (the stand-in lsof sleeps 5 s); requests the fake server saw during the check: ${JSON.stringify(sentDuringCheck)}; a direct request afterwards is logged: ${reachable}`,
  );
  await stopServer(sandbox, report, "S R19-2 fake next start", result.handle);
}

// ---- R19-3: the SWC preflight runs inside the sandbox ---------------------

/**
 * R19-3: the native SWC preflight's child runs with the sandbox root as its
 * working directory. A binding that writes `./<name>` lands inside the
 * throwaway root; nothing appears beside the caller's working directory (the
 * previous code inherited it).
 */
async function preflightCwdControl(sandbox, report) {
  const modules = path.join(
    sandbox.root,
    "self-check",
    "r19-3",
    "node_modules",
  );
  const name = `escaped-${sandbox.randomToken()}.txt`;
  const files = {
    "next/package.json": '{"name":"next","version":"15.5.18"}\n',
    "typescript/lib/typescript.js": "",
    "@types/react/index.d.ts": "",
    "@types/node/index.d.ts": "",
    "@next/swc-fake/package.json":
      '{"name":"@next/swc-fake","main":"index.js"}\n',
    "@next/swc-fake/index.js":
      `require("fs").writeFileSync(${JSON.stringify(`./${name}`)}, "written by the binding");\n` +
      "module.exports = {};\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(modules, relative);
    sandbox.makeDir(path.dirname(file), { recursive: true });
    sandbox.writeFile(file, content);
  }
  const inside = path.join(sandbox.root, name);
  const nearCaller = path.join(process.cwd(), name);
  const result = await preflightModules(sandbox, modules, {
    timeoutMs: 60_000,
  });
  const written = sandbox.readFile(inside, "utf8");
  report.check(
    "S R19-3: a binding's relative write lands inside the sandbox, not beside the caller's cwd",
    result.problems.length === 0 &&
      written === "written by the binding" &&
      !exists(nearCaller),
    `problems ${JSON.stringify(result.problems)}; ${inside} ${written === undefined ? "does not exist" : "holds the binding's file"}; beside the caller's cwd (${process.cwd()}): ${exists(nearCaller)}`,
  );
}

// ---- R19-4: the upstream port is vacant before the probe ------------------

/**
 * R19-4: after the stub closes, the upstream-down probe requires the freed
 * port to have no listener. A stand-in that took the port makes the probe
 * fail without a request; with the port vacant the request is sent and its
 * 500 is accepted (the previous code sent it in both cases).
 */
async function upstreamVacancyControl(sandbox, report) {
  const frontPort = await sandbox.freePort();
  const upstreamPort = await sandbox.freePort();
  const requests = [];
  const front = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(500);
    res.end("upstream down");
  });
  await new Promise((resolve, reject) => {
    front.once("error", reject);
    front.listen(frontPort, "127.0.0.1", resolve);
  });
  const { failures, report: quiet } = quietReporter();
  const intruder = createServer((req, res) => {
    res.writeHead(500);
    res.end("took the port");
  });
  await new Promise((resolve) =>
    intruder.listen(upstreamPort, "127.0.0.1", resolve),
  );
  let taken;
  try {
    taken = await upstreamDownProbe({
      sandbox,
      report: quiet,
      prefix: "",
      get: ownershipGate(sandbox, frontPort, process.pid),
      stubPort: upstreamPort,
    });
  } finally {
    await new Promise((resolve) => intruder.close(resolve));
  }
  const sentWhileTaken = requests.length;
  const vacant = await upstreamDownProbe({
    sandbox,
    report: quiet,
    prefix: "",
    get: ownershipGate(sandbox, frontPort, process.pid),
    stubPort: upstreamPort,
  });
  report.check(
    "S R19-4: the upstream-down probe is sent only while the freed upstream port is vacant",
    taken === false &&
      failures.length === 1 &&
      /vacant after the stub closed/.test(failures[0]) &&
      /took the port/.test(failures[0]) &&
      sentWhileTaken === 0 &&
      vacant === true &&
      requests.length === 1 &&
      requests[0] === "/canvas",
    `stand-in on the freed port: returned ${taken}, ${JSON.stringify(failures)}, ${sentWhileTaken} request(s) reached the frontend; vacant: returned ${vacant}, requests ${JSON.stringify(requests)}`,
  );
  await new Promise((resolve) => front.close(resolve));
}

// ---- T164b: the pieces stage M adds to the shared machinery ----------------

/** The shared pieces stage M uses, each against throwaway material. */
async function stageMSharedControls(sandbox, report) {
  envFileOptionControl(sandbox, report);
  await ownDotenvControl(sandbox, report);
  await requestInitControl(sandbox, report);
  await tripleGateControl(sandbox, report);
  await canvasOwnershipControl(sandbox, report);
  await databaseShutdownControl(report);
  misroutingVerdictControl(report);
  await signOutDeadlineControl(report);
  await extensionStopControl(sandbox, report);
  await companionOwnershipControl(sandbox, report);
  await unresponsivePostgresControl(sandbox, report);
  await dropEachControl(report);
  await readinessFromLaunchControl(report);
  projectListControl(report);
  await t165FollowUpControls(sandbox, report);
  await t165BrowserControls(sandbox, report);
  await t165Round4Controls(sandbox, report);
}

/** `sandbox.env(…, { envFile: false })` leaves the key out; the default keeps it. */
function envFileOptionControl(sandbox, report) {
  const plain = sandbox.env({ X_CHECK: "1" });
  const without = sandbox.env({ X_CHECK: "1" }, { envFile: false });
  const explicit = sandbox.env({ X_CHECK: "1" }, { envFile: true });
  report.check(
    "S T164b: sandbox.env leaves SILICON_NOTEBOOK_ENV_FILE out only with { envFile: false }",
    plain.SILICON_NOTEBOOK_ENV_FILE === "" &&
      explicit.SILICON_NOTEBOOK_ENV_FILE === "" &&
      !("SILICON_NOTEBOOK_ENV_FILE" in without) &&
      without.X_CHECK === "1" &&
      without.NODE_OPTIONS === plain.NODE_OPTIONS,
    `default ${JSON.stringify(plain.SILICON_NOTEBOOK_ENV_FILE)}, explicit ${JSON.stringify(explicit.SILICON_NOTEBOOK_ENV_FILE)}, without the file: key present ${"SILICON_NOTEBOOK_ENV_FILE" in without}`,
  );
}

/**
 * The stage's own `<clone>/.env` is accepted while it is the regular file the
 * stage wrote, with that hash; a byte changed, a symlink in its place (to an
 * identical file inside the clone) and another dotenv file each refuse.
 */
async function ownDotenvControl(sandbox, report) {
  const clone = await makeClone(sandbox, "own-dotenv", {
    files: { "README.md": "x\n", "frontend/a.txt": "x\n" },
  });
  const text = "DATABASE_URL=sqlite:///.local/x.db\nSOME_KEY=value\n";
  const envFile = path.join(clone, ".env");
  const written = [];
  const { cloneProblems } = cloneGuards({
    sandbox,
    report: quietReporter().report,
    nb: clone,
    written,
  });
  const dotenvProblems = () =>
    cloneProblems([clone]).filter((problem) => problem.includes("dotenv"));
  sandbox.writeFile(envFile, text, 0o600);
  const unrecorded = dotenvProblems();
  written.push({ relative: ".env", sha256: sha256(text) });
  const recorded = dotenvProblems();
  sandbox.writeFile(envFile, text.replace("value", "valuf"), 0o600);
  const changed = dotenvProblems();
  sandbox.removePath(envFile);
  sandbox.writeFile(path.join(clone, "env-copy"), text);
  // The scenario plants the link directly (the validated writer refuses one).
  fs.symlinkSync("env-copy", envFile);
  const linked = dotenvProblems();
  fs.unlinkSync(envFile);
  sandbox.writeFile(envFile, text, 0o600);
  const restored = dotenvProblems();
  sandbox.writeFile(path.join(clone, "frontend/.env.local"), "X=1\n");
  const other = dotenvProblems();
  report.check(
    "S T164b: the stage's own .env is accepted with its recorded hash, and nothing else is",
    unrecorded.length === 1 &&
      recorded.length === 0 &&
      changed.length === 1 &&
      /content changed/.test(changed[0]) &&
      linked.length === 1 &&
      /now a symlink/.test(linked[0]) &&
      restored.length === 0 &&
      other.length === 1 &&
      other[0] === "dotenv file(s) in the clone: frontend/.env.local",
    JSON.stringify({ unrecorded, recorded, changed, linked, restored, other }),
  );
}

/** `rawRequest` with headers and a body: everything arrives as sent. */
async function requestInitControl(sandbox, report) {
  const port = await sandbox.freePort();
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end('{"answer":"ü"}');
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  try {
    const body = JSON.stringify({ name: "Grüße", n: 3 });
    const res = await rawRequest(port, "/x/y?z=1", "PUT", 10_000, {
      headers: {
        "content-type": "application/json",
        authorization: "Bearer t164b-control",
        "if-match": "revision-1",
      },
      body,
    });
    const bare = await rawRequest(port, "/bare", "GET", 10_000);
    const [sent, plain] = seen;
    report.check(
      "S T164b: rawRequest sends its method, headers and body (with content-length) as given",
      res.status === 201 &&
        res.body === '{"answer":"ü"}' &&
        sent?.method === "PUT" &&
        sent.url === "/x/y?z=1" &&
        sent.headers["content-type"] === "application/json" &&
        sent.headers.authorization === "Bearer t164b-control" &&
        sent.headers["if-match"] === "revision-1" &&
        sent.headers["content-length"] === String(Buffer.byteLength(body)) &&
        Buffer.byteLength(body) !== body.length &&
        sent.body === body &&
        bare.status === 201 &&
        plain?.method === "GET" &&
        plain.body === "" &&
        plain.headers["content-length"] === undefined &&
        plain.headers.authorization === undefined,
      `answer ${res.status} ${JSON.stringify(res.body)}; received ${JSON.stringify(seen)}`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * `tripleGate` sends nothing when any one of the three listeners is not the
 * recorded pid (or, with `canvasPid: null`, when the canvas port has a
 * listener); with all three as recorded the request goes through.
 */
async function tripleGateControl(sandbox, report) {
  const webPort = await sandbox.freePort();
  const apiPort = await sandbox.freePort();
  const canvasPort = await sandbox.freePort();
  const vacantPort = await sandbox.freePort();
  const web = await startStub(webPort);
  const api = await startStub(apiPort);
  const canvas = await startStub(canvasPort);
  const mine = process.pid;
  const other = process.pid + 1;
  const attempt = async (pids, canvasAt = canvasPort) => {
    const before = web.records.length;
    try {
      const res = await tripleGate(sandbox, {
        webPort,
        apiPort,
        canvasPort: canvasAt,
        webPid: pids[0],
        apiPid: pids[1],
        canvasPid: pids[2],
      })("/canvas/api/projects", "POST", 10_000, {
        headers: { authorization: "Bearer t164b" },
        body: "{}",
      });
      return { sent: web.records.length - before, status: res.status };
    } catch (error) {
      return {
        sent: web.records.length - before,
        lost: error instanceof OwnershipLost,
        message: error.message,
      };
    }
  };
  try {
    const refused = [
      await attempt([other, mine, mine]),
      await attempt([mine, other, mine]),
      await attempt([mine, mine, other]),
      await attempt([mine, mine, null]),
    ];
    const owned = await attempt([mine, mine, mine]);
    const vacant = await attempt([mine, mine, null], vacantPort);
    report.check(
      "S T164b: tripleGate sends nothing unless web, api and canvas are each the recorded listener",
      refused.every((result) => result.lost && result.sent === 0) &&
        /web \d+ is foreign/.test(refused[0].message) &&
        /api \d+ is foreign/.test(refused[1].message) &&
        /canvas \d+ is foreign/.test(refused[2].message) &&
        /canvas \d+ is foreign .*want no listener/.test(refused[3].message) &&
        owned.sent === 1 &&
        owned.status === 404 &&
        vacant.sent === 1 &&
        vacant.status === 404,
      JSON.stringify({ refused, owned, vacant }),
    );
  } finally {
    await canvas.close();
    await api.close();
    await web.close();
  }
}

// ---- PR 140 review round 1: stage M's ownership, shutdown and verdicts -----

/**
 * A listener on the canvas port is recorded as the managed canvas only when
 * it descends from the recorded service worker, shares its process group and
 * runs `… apps/server/dist/cli.js --require-canvas-database`. Four throwaway
 * set-ups, each on a port of its own: a sleeping "worker" with a listener
 * started separately (the right command line, not a descendant), a worker
 * whose child is that listener (recorded), a worker whose child left its
 * group, and a worker whose child runs another script. The listeners exit
 * by themselves once their parent is gone.
 */
async function canvasOwnershipControl(sandbox, report) {
  const dir = path.join(sandbox.root, "self-check", "canvas-owner");
  const cli = path.join(dir, "apps/server/dist/cli.js");
  const other = path.join(dir, "other.js");
  sandbox.makeDir(path.dirname(cli), { recursive: true });
  const listenerCode =
    "const parent = process.ppid;" +
    'require("http").createServer((q, s) => s.end("x")).listen(Number(process.env.STUB_PORT), "127.0.0.1");' +
    "setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 100);\n";
  sandbox.writeFile(cli, listenerCode);
  sandbox.writeFile(other, listenerCode);
  const workerCode = (detached) =>
    'const { spawn } = require("child_process");' +
    `const child = spawn(process.execPath, [process.env.STUB_SCRIPT, "--require-canvas-database"], { stdio: "inherit", detached: ${detached} });` +
    'require("fs").writeFileSync(process.env.STUB_PID_FILE, String(child.pid));' +
    "setInterval(() => {}, 1e9);";
  const handles = [];
  const childPids = [];
  const startOne = async (name, args, extra) => {
    const handle = sandbox.start(process.execPath, args, {
      cwd: dir,
      name: `canvas-owner-${name}`,
      env: sandbox.env(extra),
    });
    handles.push(handle);
    await handle.ready;
    return handle;
  };
  const attempt = async (name, setUp) => {
    const port = await sandbox.freePort();
    const pidFile = path.join(dir, `${name}.pid`);
    const workerPid = await setUp({ port, pidFile });
    const listening = await waitFor(
      () => sandbox.listenerPids(port).length === 1,
      10_000,
      100,
    );
    const child = Number(sandbox.readFile(pidFile, "utf8") ?? 0);
    if (child > 0) childPids.push(child);
    const recorded = [];
    const result = managedCanvas({
      sandbox,
      canvasPort: port,
      workerPid,
      record: (...entry) => recorded.push(entry),
    });
    return { name, listening, workerPid, child, recorded, ...result };
  };
  const results = [];
  try {
    results.push(
      await attempt("separate", async ({ port }) => {
        const sleeper = await startOne("sleeper", [
          "-e",
          "setInterval(() => {}, 1e9)",
        ]);
        await startOne("separate", [cli, "--require-canvas-database"], {
          STUB_PORT: String(port),
        });
        return sleeper.pid;
      }),
    );
    for (const [name, detached, script] of [
      ["descendant", false, cli],
      ["own-group", true, cli],
      ["other-script", false, other],
    ])
      results.push(
        await attempt(name, async ({ port, pidFile }) => {
          const worker = await startOne(name, ["-e", workerCode(detached)], {
            STUB_PORT: String(port),
            STUB_SCRIPT: script,
            STUB_PID_FILE: pidFile,
          });
          return worker.pid;
        }),
      );
  } finally {
    for (const handle of handles) await sandbox.stopGroup(handle.pgid);
  }
  // The detached child left the owned groups: it ends by itself once its
  // parent is gone (never signalled here).
  const childrenGone = await waitFor(
    () => childPids.every((pid) => !pidAlive(pid)),
    5000,
    100,
  );
  const [separate, descendant, ownGroup, otherScript] = results;
  const refused = (result, pattern) =>
    result?.listening &&
    result.canvasPid === 0 &&
    result.recorded.length === 0 &&
    result.problem.includes(`listener ${result.listeners[0]} `) &&
    pattern.test(result.problem);
  report.check(
    "S PR 140 R1-1: a canvas-port listener is recorded only as a descendant of the service worker, in its group, running apps/server/dist/cli.js --require-canvas-database",
    refused(separate, /is not a descendant of the service worker \d+/) &&
      refused(ownGroup, /is in process group \d+, not the service worker's/) &&
      refused(
        otherScript,
        /runs ".*other\.js --require-canvas-database", not node/,
      ) &&
      descendant?.listening &&
      descendant.problem === "" &&
      descendant.canvasPid === descendant.child &&
      descendant.recorded.length === 1 &&
      descendant.recorded[0][0] === "canvas" &&
      descendant.recorded[0][1] === descendant.child &&
      typeof descendant.recorded[0][2] === "string" &&
      childrenGone,
    JSON.stringify({ results, childrenGone }),
  );
}

/**
 * The databases and the shutdown: a CREATE DATABASE held in flight when the
 * cleanup begins (the interrupt's case) is waited for and its database
 * dropped, although the ledger was still empty when the shutdown began; no
 * create starts after it; a create still running is cancelled by its backend
 * pid, and one that outlives the cancellation is reported. Slow fake clients
 * stand in for PostgreSQL.
 */
async function databaseShutdownControl(report) {
  const fakeAdmin = (issued, onCancel = () => undefined) => ({
    async query(sql, params) {
      issued.push({ sql, params });
      if (/pg_cancel_backend/u.test(sql)) onCancel(params[0]);
      return { rows: [] };
    },
    async close() {},
  });
  const recorder = recordingReporter;

  // 1. A create held for 400 ms when the cleanup begins.
  const ledger = databaseLedger({ settleMs: 3000 });
  const createSql = [];
  const held = ledger.create(
    {
      processID: 4242,
      query: (sql) => {
        createSql.push(sql);
        return sleep(400).then(() => ({ rows: [] }));
      },
    },
    "auto_canvas_it_ctl_held",
  );
  const atShutdown = [...ledger.created];
  const issued = [];
  const held1 = recorder();
  const dropping = dropDatabases({
    databases: ledger,
    admin: fakeAdmin(issued),
    report: held1.report,
  });
  let late;
  try {
    await ledger.create(
      {
        processID: 1,
        query: (sql) => {
          createSql.push(sql);
          return sleep(0);
        },
      },
      "auto_canvas_it_ctl_late",
    );
    late = "created";
  } catch (error) {
    late = error instanceof StageAborted ? "refused" : error.message;
  }
  await held;
  await dropping;
  const drops = issued
    .map((entry) => entry.sql)
    .filter((sql) => sql.startsWith("DROP DATABASE"));

  // 2. A create that only a cancellation ends, and 3. one that outlives it.
  const stuck = async (cancellable) => {
    let fail;
    const ledger2 = databaseLedger({ settleMs: 150 });
    const creating = ledger2.create(
      {
        processID: 4343,
        query: () =>
          new Promise((resolve, reject) => {
            fail = reject;
          }),
      },
      "auto_canvas_it_ctl_stuck",
    );
    creating.catch(() => undefined);
    const issued2 = [];
    const out = recorder();
    await dropDatabases({
      databases: ledger2,
      admin: fakeAdmin(issued2, () => {
        if (cancellable)
          fail(new Error("canceling statement due to user request"));
      }),
      report: out.report,
    });
    if (!cancellable) fail(new Error("ended by the control"));
    return {
      cancelled: issued2.some(
        (entry) =>
          /pg_cancel_backend/u.test(entry.sql) &&
          JSON.stringify(entry.params) === "[[4343]]",
      ),
      drops: issued2.filter((entry) => entry.sql.startsWith("DROP")).length,
      fail: out.lines.fail,
    };
  };
  const cancelled = await stuck(true);
  const outlived = await stuck(false);
  report.check(
    "S PR 140 R1-2: a CREATE DATABASE in flight when the cleanup begins is awaited and its database dropped; none starts after the shutdown began; a straggler is cancelled by backend pid, or reported",
    atShutdown.length === 0 &&
      late === "refused" &&
      createSql.length === 1 &&
      drops.length === 1 &&
      drops[0] ===
        "DROP DATABASE IF EXISTS auto_canvas_it_ctl_held WITH (FORCE)" &&
      held1.lines.fail.length === 0 &&
      held1.lines.ok.some((line) =>
        line.includes("databases are dropped (auto_canvas_it_ctl_held)"),
      ) &&
      cancelled.cancelled &&
      cancelled.drops === 0 &&
      cancelled.fail.length === 0 &&
      outlived.cancelled &&
      outlived.drops === 0 &&
      outlived.fail.length === 1 &&
      /still running after its cancellation: auto_canvas_it_ctl_stuck/u.test(
        outlived.fail[0],
      ),
    JSON.stringify({
      atShutdown,
      late,
      createSql,
      drops,
      held: held1.lines,
      cancelled,
      outlived,
    }),
  );
}

/** M-ext's verdict: a probe without an HTTP answer fails, named. */
function misroutingVerdictControl(report) {
  const answer = (rawPath, status, extra = {}) => ({
    rawPath,
    token: true,
    status,
    json: false,
    leaked: [],
    ...extra,
  });
  const clean = misroutingProblems([
    answer("/canvas", 200),
    answer("/canvas/../api/projects", 404, { token: false }),
  ]);
  const problems = misroutingProblems([
    answer("/canvas", 200),
    answer(
      "/canvas/api/projects",
      "error no complete response within 30000 ms",
    ),
    answer("/canvas/api/auth/me", "error socket hang up", { token: false }),
    answer("/canvas/%2e%2e/api/projects", 200, { json: true }),
    answer("/canvas/api/projects", 200, { leaked: ["id"], token: false }),
  ]);
  report.check(
    "S PR 140 R1-3: an M-ext probe without an HTTP answer fails the misrouting check, named",
    clean.length === 0 &&
      problems.length === 4 &&
      problems[0] ===
        "with the token GET /canvas/api/projects: no HTTP answer (error no complete response within 30000 ms)" &&
      problems[1] ===
        "without a token GET /canvas/api/auth/me: no HTTP answer (error socket hang up)" &&
      /GET \/canvas\/%2e%2e\/api\/projects: 200 with JSON/u.test(problems[2]) &&
      /without a token GET \/canvas\/api\/projects: the body shows 1/u.test(
        problems[3],
      ),
    JSON.stringify({ clean, problems }),
  );
  // PR 140 R3-1: JSON is recognised by its body as well as by any casing of
  // its media type.
  const names = ["p-seeded", "Seeded x", "Standalone y"];
  const of = (rawPath, res) =>
    misroutedAnswer({ rawPath, token: true, res, names });
  const verdicts = misroutingProblems([
    of("/canvas/api/projects", {
      status: 200,
      headers: {},
      body: ' {"projects":[]}\n',
    }),
    of("/canvas/api/auth/me", {
      status: 200,
      headers: { "content-type": "Application/JSON; charset=utf-8" },
      body: "not parsed",
    }),
    of("/canvas", {
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<!doctype html><title>x</title>",
    }),
    of("/canvas/../api/projects", {
      status: 404,
      headers: { "content-type": "application/json" },
      body: '{"error":"not-found"}',
    }),
  ]);
  report.check(
    "S PR 140 R3-1: a misrouted 200 is JSON by its body without a content type, and by an Application/JSON type",
    verdicts.length === 2 &&
      verdicts[0] ===
        "with the token GET /canvas/api/projects: 200 with JSON" &&
      verdicts[1] === "with the token GET /canvas/api/auth/me: 200 with JSON",
    JSON.stringify(verdicts),
  );
}

/**
 * M8's deadline, scaled down (limit 600 ms, polls every 100 ms): every probe
 * gets at most the time left; a 401 within the limit counts with its time; a
 * 401 that a slow probe brings back after the limit does not; nothing is
 * polled past it.
 */
async function signOutDeadlineControl(report) {
  const run = async (answer) => {
    const since = Date.now();
    const deadlines = [];
    const starts = [];
    const result = await firstRefusal({
      since,
      limitMs: 600,
      intervalMs: 100,
      probe: async (left) => {
        deadlines.push({ left, elapsed: Date.now() - since });
        starts.push(Date.now() - since);
        return answer(Date.now() - since, left);
      },
    });
    return {
      ...result,
      last: result.last?.status,
      elapsed: Date.now() - since,
      capped: deadlines.every(
        ({ left, elapsed }) => left > 0 && left <= 600 - elapsed + 5,
      ),
      starts,
    };
  };
  // 401 from 250 ms on, at once.
  const within = await run(async (at) => ({ status: at >= 250 ? 401 : 200 }));
  // The probe started near the end answers 401 only after 300 ms more.
  const late = await run(async (at) => {
    if (at < 450) return { status: 200 };
    await sleep(300);
    return { status: 401 };
  });
  // A probe that uses its whole deadline and gets no answer.
  const silent = await run(async (_at, left) => {
    await sleep(left);
    return { status: "error no complete response" };
  });
  report.check(
    "S PR 140 R1-4: the sign-out poll caps each probe at the time left and counts a 401 only within the limit",
    within.after >= 250 &&
      within.after <= 600 &&
      within.capped &&
      late.after === undefined &&
      late.late > 600 &&
      late.capped &&
      silent.after === undefined &&
      silent.capped &&
      silent.starts.length === 1 &&
      silent.elapsed < 700,
    JSON.stringify({ within, late, silent }),
  );
}

// ---- PR 140 review round 2: the stop script, pids, PostgreSQL, readiness ----

/** A sleeping Node process, this script's own child outside any owned group. */
function looseSleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], {
    detached: true,
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "" },
  });
  child.unref();
  return child.pid;
}

/** Ends a process this control started, by its pid, if it is still alive. */
function endOwn(pid) {
  if (pid > 0 && pidAlive(pid))
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone meanwhile
    }
}

/**
 * The clone's stop script is checked immediately before it runs. Throwaway
 * "clones": one whose scripts/extension_services.py is a symlink to a script
 * outside the sandbox that writes a marker when run, one whose scripts/ is a
 * symlink to the directory holding it, and one with a regular script that
 * writes a marker inside. The first goes through the stage's whole cleanup
 * (`cleanUp`): the stop is refused, named, the marker never written, and the
 * cleanup goes on (the stage's group stopped, the recorded companion ended
 * by pid, the recorded database dropped). The second is refused too; the
 * third runs (its marker appears), so a run would have been seen. Node stands
 * in for the interpreter.
 */
async function extensionStopControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "ext-stop");
  const outside = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "t164b-outside-"),
  );
  const outsideMarker = path.join(outside, "ran.txt");
  fs.writeFileSync(
    path.join(outside, "extension_services.py"),
    `require("fs").writeFileSync(${JSON.stringify(outsideMarker)}, process.argv.slice(2).join(" "));\n`,
  );
  const cloneAt = (name) => {
    const nb = path.join(base, name, "nb");
    sandbox.makeDir(nb, { recursive: true });
    return nb;
  };
  const linkedFile = cloneAt("linked-file");
  sandbox.makeDir(path.join(linkedFile, "scripts"));
  // The scenario plants the links directly (the validated writer refuses one).
  fs.symlinkSync(
    path.join(outside, "extension_services.py"),
    path.join(linkedFile, "scripts/extension_services.py"),
  );
  const linkedDir = cloneAt("linked-dir");
  fs.symlinkSync(outside, path.join(linkedDir, "scripts"));
  const real = cloneAt("real");
  const insideMarker = path.join(base, "real", "ran.txt");
  sandbox.makeDir(path.join(real, "scripts"));
  sandbox.writeFile(
    path.join(real, "scripts/extension_services.py"),
    `require("fs").writeFileSync(${JSON.stringify(insideMarker)}, process.argv.slice(2).join(" "));\n`,
  );
  const stopIn = (nb, rec, label) =>
    runExtensionStop({
      sandbox,
      report: rec.report,
      nb,
      python: process.execPath,
      label,
      timeoutMs: 10_000,
    });

  const group = sandbox.start(
    process.execPath,
    ["-e", "setInterval(() => {}, 1e9)"],
    { cwd: base, name: "ext-stop-group", env: sandbox.env() },
  );
  await group.ready;
  const loose = looseSleeper();
  let result;
  try {
    const ledger = databaseLedger({ settleMs: 100 });
    await ledger.create(
      { processID: 1, query: async () => ({ rows: [] }) },
      "auto_canvas_it_ctl_extstop",
    );
    const issued = [];
    const rec = recordingReporter();
    await waitFor(() => identityOf(loose) !== undefined, 2000, 20);
    await cleanUp({
      sandbox,
      report: rec.report,
      nb: linkedFile,
      launched: true,
      groups: [group.pgid],
      companions: new Map([
        [loose, { name: "worker", pid: loose, identity: identityOf(loose) }],
      ]),
      databases: ledger,
      admin: {
        async query(sql) {
          issued.push(sql);
          return { rows: [] };
        },
        async close() {},
      },
      extensionStop: (label) => stopIn(linkedFile, rec, label),
    });
    const dirRec = recordingReporter();
    const dirRan = await stopIn(linkedDir, dirRec, "linked-dir:");
    const realRec = recordingReporter();
    const realRan = await stopIn(real, realRec, "real:");
    const groupGone = await waitFor(
      () => {
        try {
          process.kill(-group.pgid, 0);
          return false;
        } catch (error) {
          return error.code === "ESRCH";
        }
      },
      2000,
      20,
    );
    const looseGone = await waitFor(() => !pidAlive(loose), 2000, 20);
    result = {
      fail: rec.lines.fail,
      ok: rec.lines.ok,
      outsideMarker: fs.existsSync(outsideMarker),
      groupAlive: !groupGone,
      looseAlive: !looseGone,
      drops: issued.filter((sql) => sql.startsWith("DROP DATABASE")),
      dirRan,
      dirFail: dirRec.lines.fail,
      realRan,
      realMarker: sandbox.readFile(insideMarker, "utf8"),
    };
  } finally {
    endOwn(loose);
    await sandbox.stopGroup(group.pgid);
    fs.rmSync(outside, { recursive: true, force: true });
  }
  report.check(
    "S PR 140 R2-1: a stop script that is a symlink (or under a linked scripts/) is never run, the refusal is reported and the cleanup goes on",
    result.fail.length === 1 &&
      /^cleanup: extension_services\.py stop ends the companion services: not run: refused: <sandbox>\/self-check\/ext-stop\/linked-file\/nb\/scripts\/extension_services\.py is a symlink/u.test(
        result.fail[0],
      ) &&
      !result.outsideMarker &&
      !result.groupAlive &&
      !result.looseAlive &&
      result.ok.some((line) =>
        line.includes("(1 recorded, 1 signalled by pid)"),
      ) &&
      result.drops.length === 1 &&
      result.drops[0].includes("auto_canvas_it_ctl_extstop") &&
      result.ok.some((line) => line.includes("databases are dropped")) &&
      result.dirRan === false &&
      result.dirFail.length === 1 &&
      /linked-dir\/nb\/scripts is a symlink/u.test(result.dirFail[0]) &&
      result.realRan === true &&
      result.realMarker === "stop",
    JSON.stringify(result),
  );
}

/**
 * The supervisor and the worker named in silicon-notebook's state are
 * recorded only when they are this clone's: throwaway "clones" whose
 * scripts/extension_services.py (run as `_supervise --state-dir …`) starts
 * scripts/extension_service_worker.py <its pid>. A genuine pair is recorded;
 * a supervisor pid now held by another process (and its worker with it), a
 * worker that is not the supervisor's child, a worker run from another
 * clone, and a supervisor run from another clone are not. Node stands in for
 * the interpreter.
 */
async function companionOwnershipControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "companions");
  const supervisorCode =
    'const { spawn } = require("child_process");' +
    'const worker = spawn(process.execPath, [process.env.STUB_WORKER, String(process.pid)], { stdio: "ignore" });' +
    'require("fs").writeFileSync(process.env.STUB_PID_FILE, String(worker.pid));' +
    "setInterval(() => {}, 1e9);\n";
  const clones = {};
  for (const name of ["nb", "other"]) {
    const scripts = path.join(base, name, "scripts");
    sandbox.makeDir(scripts, { recursive: true });
    sandbox.writeFile(
      path.join(scripts, "extension_services.py"),
      supervisorCode,
    );
    sandbox.writeFile(
      path.join(scripts, "extension_service_worker.py"),
      "setInterval(() => {}, 1e9);\n",
    );
    clones[name] = path.join(base, name);
  }
  const { nb, other } = clones;
  const handles = [];
  const start = async (name, args, extra = {}) => {
    const handle = sandbox.start(process.execPath, args, {
      cwd: base,
      name: `companions-${name}`,
      env: sandbox.env(extra),
    });
    handles.push(handle);
    await handle.ready;
    return handle.pid;
  };
  const supervise = async (name, clone, workerClone = clone) => {
    const pidFile = path.join(base, `${name}.pid`);
    const pid = await start(
      name,
      [
        path.join(clone, "scripts/extension_services.py"),
        "_supervise",
        "--state-dir",
        path.join(clone, ".local/run/extensions"),
      ],
      {
        STUB_WORKER: path.join(
          workerClone,
          "scripts/extension_service_worker.py",
        ),
        STUB_PID_FILE: pidFile,
      },
    );
    await waitFor(() => sandbox.readFile(pidFile, "utf8"), 5000, 20);
    const worker = Number(sandbox.readFile(pidFile, "utf8"));
    await waitFor(
      () => /extension_service_worker/u.test(identityOf(worker) ?? ""),
      5000,
      20,
    );
    return { pid, worker };
  };
  const results = {};
  try {
    const genuine = await supervise("genuine", nb);
    const foreignWorker = await supervise("foreign-worker", nb, other);
    const otherClone = await supervise("other-clone", other);
    const sleeper = await start("reused", ["-e", "setInterval(() => {}, 1e9)"]);
    const stray = await start("stray", [
      path.join(nb, "scripts/extension_service_worker.py"),
      String(genuine.pid),
    ]);
    const attempt = (supervisorPid, workerPid) => {
      const recorded = [];
      const result = managedCompanions({
        nb,
        supervisorPid,
        workerPid,
        record: (...entry) => recorded.push(entry.slice(0, 2)),
      });
      return { ...result, recorded };
    };
    Object.assign(results, {
      genuine: attempt(genuine.pid, genuine.worker),
      reused: attempt(sleeper, genuine.worker),
      notAChild: attempt(genuine.pid, stray),
      foreignWorker: attempt(foreignWorker.pid, foreignWorker.worker),
      otherClone: attempt(otherClone.pid, otherClone.worker),
      external: attempt(genuine.pid, undefined),
      pids: { genuine, sleeper, stray, foreignWorker, otherClone },
    });
  } finally {
    for (const handle of handles) await sandbox.stopGroup(handle.pgid);
  }
  const { genuine, reused, notAChild, foreignWorker, otherClone, external } =
    results;
  const p = results.pids ?? {};
  const refused = (result, pattern) =>
    result.problems.length === 1 && pattern.test(result.problems[0]);
  report.check(
    "S PR 140 R2-2: the state's supervisor and worker are recorded only when they are this clone's extension_services.py _supervise and its extension_service_worker.py child",
    genuine?.supervisorPid === p.genuine?.pid &&
      genuine.workerPid === p.genuine.worker &&
      genuine.problems.length === 0 &&
      JSON.stringify(genuine.recorded) ===
        JSON.stringify([
          ["supervisor", p.genuine.pid],
          ["worker", p.genuine.worker],
        ]) &&
      reused.recorded.length === 0 &&
      reused.problems.length === 2 &&
      /^supervisor \d+ runs ".*", not this clone's extension_services\.py _supervise: not recorded, never signalled$/u.test(
        reused.problems[0],
      ) &&
      /^worker \d+ is not checked without a verified supervisor/u.test(
        reused.problems[1],
      ) &&
      notAChild.recorded.length === 1 &&
      notAChild.workerPid === 0 &&
      refused(
        notAChild,
        /^worker \d+ is a child of \d+, not of the supervisor \d+/u,
      ) &&
      foreignWorker.recorded.length === 1 &&
      foreignWorker.workerPid === 0 &&
      refused(
        foreignWorker,
        /^worker \d+ runs ".*other\/scripts\/extension_service_worker\.py \d+", not this clone's/u,
      ) &&
      otherClone.recorded.length === 0 &&
      otherClone.problems.length === 2 &&
      /^supervisor \d+ runs ".*other\/scripts\/extension_services\.py _supervise/u.test(
        otherClone.problems[0],
      ) &&
      external.supervisorPid === p.genuine.pid &&
      external.recorded.length === 1 &&
      external.problems.length === 0,
    JSON.stringify(results),
  );
}

/**
 * The cleanup's PostgreSQL steps are bounded: against a TCP listener that
 * accepts connections and never answers (on a free port, as the admin URL),
 * with two databases recorded and a create that never settles, the database
 * cleanup ends within its budget, reports the straggler and each database by
 * name, and still reports the check of what remains. The stage's own
 * parameters are scaled down here (1.5 s per step, 4 s in all, 0.3 s
 * settling); the control gives up after 15 s, so a cleanup that waits on the
 * server fails it instead of hanging the stage.
 */
async function unresponsivePostgresControl(sandbox, report) {
  const port = await sandbox.freePort();
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  let result;
  try {
    const ledger = databaseLedger({ settleMs: 300 });
    for (const name of [
      "auto_canvas_it_ctl_slow_a",
      "auto_canvas_it_ctl_slow_b",
    ])
      await ledger.create(
        { processID: 1, query: async () => ({ rows: [] }) },
        name,
      );
    ledger
      .create(
        { processID: 4545, query: () => new Promise(() => undefined) },
        "auto_canvas_it_ctl_slow_c",
      )
      .catch(() => undefined);
    const rec = recordingReporter();
    const started = Date.now();
    const outcome = await Promise.race([
      dropDatabases({
        databases: ledger,
        admin: adminSession({
          open: openAdmin(`postgresql://check@127.0.0.1:${port}/check`),
          stepMs: 1500,
          budgetMs: 4000,
        }),
        report: rec.report,
      }).then(() => "ended"),
      sleep(15_000).then(() => "still waiting after 15 s"),
    ]);
    result = {
      outcome,
      ms: Date.now() - started,
      fail: rec.lines.fail,
      connections: sockets.size,
    };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  const failed = (pattern) => result.fail.some((line) => pattern.test(line));
  report.check(
    `S PR 140 R2-3: against a PostgreSQL that never answers, the database cleanup ends within its budget (${(result.ms / 1000).toFixed(1)} s of 4 s) and names every database it could not drop`,
    result.outcome === "ended" &&
      result.ms < 5000 &&
      result.fail.length === 4 &&
      failed(
        /still running after its cancellation: auto_canvas_it_ctl_slow_c/u,
      ) &&
      failed(
        /^cleanup: database auto_canvas_it_ctl_slow_a is dropped: the drop failed: no connection to PostgreSQL within 1\.5 s/u,
      ) &&
      failed(
        /^cleanup: database auto_canvas_it_ctl_slow_b is dropped: the drop failed/u,
      ) &&
      failed(
        /^cleanup: the stage's databases are dropped \(auto_canvas_it_ctl_slow_a, auto_canvas_it_ctl_slow_b\): still present: \(which remain could not be read/u,
      ),
    JSON.stringify(result),
  );
}

/**
 * Every recorded database's drop is attempted on its own: the first drop
 * failing does not keep the second from being sent, and the names still
 * present afterwards are read and reported.
 */
async function dropEachControl(report) {
  const ledger = databaseLedger({ settleMs: 100 });
  for (const name of ["auto_canvas_it_ctl_each_a", "auto_canvas_it_ctl_each_b"])
    await ledger.create(
      { processID: 1, query: async () => ({ rows: [] }) },
      name,
    );
  const issued = [];
  const rec = recordingReporter();
  await dropDatabases({
    databases: ledger,
    admin: {
      async query(sql) {
        issued.push(sql);
        if (sql.includes("auto_canvas_it_ctl_each_a WITH"))
          throw new Error("database is being accessed by other users");
        if (sql.startsWith("SELECT datname"))
          return { rows: [{ datname: "auto_canvas_it_ctl_each_a" }] };
        return { rows: [] };
      },
      async close() {},
    },
    report: rec.report,
  });
  const drops = issued.filter((sql) => sql.startsWith("DROP DATABASE"));
  report.check(
    "S PR 140 R2-4: a failing drop does not stop the next one, and the databases still present are reported by name",
    drops.length === 2 &&
      drops[1] ===
        "DROP DATABASE IF EXISTS auto_canvas_it_ctl_each_b WITH (FORCE)" &&
      issued.some((sql) => sql.startsWith("SELECT datname")) &&
      rec.lines.fail.length === 2 &&
      rec.lines.fail[0] ===
        "cleanup: database auto_canvas_it_ctl_each_a is dropped: the drop failed: database is being accessed by other users" &&
      /dropped \(auto_canvas_it_ctl_each_a, auto_canvas_it_ctl_each_b\): still present: auto_canvas_it_ctl_each_a$/u.test(
        rec.lines.fail[1],
      ),
    JSON.stringify({ issued, fail: rec.lines.fail }),
  );
}

/**
 * The managed readiness deadline runs from the launch, scaled down (limit
 * 300 ms, a launcher wait of 450 ms, the state read every 20 ms): a service
 * ready 100 ms after the launch counts with that time although the launcher
 * wait ends later; one ready only at 380 ms, or never, fails, and its
 * observation ends at the limit, not with the launcher wait.
 */
async function readinessFromLaunchControl(report) {
  const run = async (readyFrom) => {
    const since = Date.now();
    const launched = await observedLaunch({
      launch: () => sleep(450).then(() => ({ up: true })),
      read: () => ({ ready: Date.now() - since >= readyFrom }),
      isReady: (state) => state?.ready === true,
      since,
      limitMs: 300,
      intervalMs: 20,
    });
    const verdict = await launched.readiness;
    return {
      readyAfter: verdict.readyAfter,
      problem: verdict.problem,
      up: Boolean(launched.up),
    };
  };
  const early = await run(100);
  const late = await run(380);
  const never = await run(Infinity);
  const stopped = await (async () => {
    const launched = await observedLaunch({
      launch: async () => undefined,
      read: () => null,
      isReady: () => false,
      since: Date.now(),
      limitMs: 300,
      intervalMs: 20,
    });
    return (await launched.readiness).problem;
  })();
  report.check(
    "S PR 140 R2-5: the managed service counts as ready only when its state said so within the limit after the launch, observed from the launch on",
    early.up &&
      early.readyAfter >= 100 &&
      early.readyAfter < 300 &&
      early.problem === "" &&
      late.readyAfter === undefined &&
      /not ready within 0\.3 s of the launch/u.test(late.problem) &&
      never.readyAfter === undefined &&
      /not ready within/u.test(never.problem) &&
      /stopped before the service was ready/u.test(stopped),
    JSON.stringify({ early, late, never, stopped }),
  );
}

/**
 * A list read in M7, M8 or M-ext counts only as a valid project list: HTTP
 * 200, the JSON media type, an object with a `projects` array of entries
 * with ids. An HTML page, an error object, JSON with another media type and
 * an error status each fail, named; a valid list gives its ids.
 */
function projectListControl(report) {
  const json = { "content-type": "application/json; charset=utf-8" };
  const valid = projectList({
    status: 200,
    headers: json,
    body: '{"projects":[{"id":"p-1","name":"x"},{"id":"p-2"}],"limit":50}',
  });
  const invalid = [
    {
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<!doctype html>",
    },
    { status: 200, headers: json, body: '{"error":"nope"}' },
    { status: 200, headers: json, body: '{"projects":{}}' },
    { status: 200, headers: json, body: '{"projects":[{"name":"no id"}]}' },
    {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: '{"projects":[]}',
    },
    { status: 401, headers: json, body: '{"projects":[]}' },
    { status: "error socket hang up", headers: {}, body: "" },
  ].map((res) => {
    try {
      return projectList(res);
    } catch (error) {
      return { ids: [], problem: `threw ${error.message}` };
    }
  });
  report.check(
    "S PR 140 R2-6: a project list must be a 200 JSON object with a projects array; anything else fails, named",
    valid.problem === "" &&
      JSON.stringify(valid.ids) === '["p-1","p-2"]' &&
      invalid.every(
        (result) =>
          result.ids.length === 0 &&
          /^not a project list: /u.test(result.problem),
      ) &&
      /not the JSON media type/u.test(invalid[0].problem) &&
      /not an object with a projects array/u.test(invalid[1].problem) &&
      /not an object with a projects array/u.test(invalid[2].problem) &&
      /has no id/u.test(invalid[3].problem) &&
      /not the JSON media type/u.test(invalid[4].problem) &&
      /status 401/u.test(invalid[5].problem) &&
      /status error socket hang up/u.test(invalid[6].problem),
    JSON.stringify({ valid, invalid }),
  );
}

// ---- T165: the follow-ups of PR 140's review rounds 4 and 5 ----------------

/** The seven follow-ups, each against stand-ins (no live PostgreSQL). */
async function t165FollowUpControls(sandbox, report) {
  await brokenConnectionControl(sandbox, report);
  await cleanupDeadlineControl(sandbox, report);
  reopenedSchematicControl(report);
  listHoldsControl(report);
  await lostAnswerControl(report);
  await inheritedPipesControl(sandbox, report);
  redactBeforeCutControl(report);
}

/**
 * A stand-in PostgreSQL: answers the startup message (no SSL request, no
 * password) and each simple query with an empty result. `plan(index)` says
 * what the index-th connection does with a query: "answer", "close" (the
 * connection drops before the answer: the answer is lost), or "answer, then
 * close" (an established, idle connection breaks).
 */
async function standInPostgres(sandbox, plan) {
  const port = await sandbox.freePort();
  const sockets = new Set();
  let connections = 0;
  const message = (type, body) => {
    const head = Buffer.alloc(5);
    head.write(type, 0, "latin1");
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  };
  const int32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value);
    return buffer;
  };
  const ready = message("Z", Buffer.from("I"));
  const server = net.createServer((socket) => {
    const index = connections;
    connections += 1;
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    let started = false;
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        if (!started) {
          if (buffered.length < 4) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          buffered = buffered.subarray(length);
          started = true;
          socket.write(
            Buffer.concat([
              message("R", int32(0)),
              message("K", Buffer.concat([int32(4242), int32(1)])),
              ready,
            ]),
          );
          continue;
        }
        if (buffered.length < 5) return;
        const type = String.fromCharCode(buffered[0]);
        const length = buffered.readInt32BE(1);
        if (buffered.length < length + 1) return;
        buffered = buffered.subarray(length + 1);
        if (type === "X") return void socket.end();
        if (type !== "Q") continue;
        const what = plan(index);
        if (what === "close") return void socket.destroy();
        socket.write(
          Buffer.concat([message("C", Buffer.from("SELECT 0\0")), ready]),
        );
        if (what === "answer, then close")
          setTimeout(() => socket.destroy(), 150);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `postgresql://check@127.0.0.1:${port}/check`,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Runs `code` (an ES module) in a child Node; resolves to its result. */
function childNode(code, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

/**
 * Follow-up 1: a PostgreSQL connection that breaks after it was established
 * neither ends the process nor stalls the cleanup. In a child process (an
 * unhandled `error` event would end it): the set-up's `withClient` whose
 * query loses its connection rejects (the set-up's error path); the
 * cleanup's session, whose idle connection breaks after its first answer,
 * opens another for its second query; the child then exits 0 with both
 * results.
 */
async function brokenConnectionControl(sandbox, report) {
  const setUpServer = await standInPostgres(sandbox, () => "close");
  const cleanupServer = await standInPostgres(sandbox, (index) =>
    index === 0 ? "answer, then close" : "answer",
  );
  const module = new URL("./managed-clone.mjs", import.meta.url).href;
  const code = [
    `import { adminSession, openAdmin, withClient } from ${JSON.stringify(module)};`,
    "const out = {};",
    `out.setUp = await withClient(${JSON.stringify(setUpServer.url)}, (client) => client.query("SELECT 1"), { timeoutMs: 3000 }).then(() => "resolved", (error) => "rejected: " + error.message);`,
    `const admin = adminSession({ open: openAdmin(${JSON.stringify(cleanupServer.url)}), stepMs: 3000, budgetMs: 9000 });`,
    'out.first = await admin.query("SELECT 1").then(() => "answered", (error) => "rejected: " + error.message);',
    "await new Promise((resolve) => setTimeout(resolve, 600));",
    'out.second = await admin.query("SELECT 1").then(() => "answered", (error) => "rejected: " + error.message);',
    "await admin.close();",
    "console.log(JSON.stringify(out));",
  ].join("\n");
  let result;
  try {
    result = await childNode(code);
  } finally {
    await setUpServer.close();
    await cleanupServer.close();
  }
  let out;
  try {
    out = JSON.parse(result.stdout.trim().split("\n").at(-1));
  } catch {
    out = undefined;
  }
  report.check(
    "S T165 follow-up 1: a PostgreSQL connection that breaks after it was established rejects the set-up's query and makes the cleanup reconnect; the process does not end",
    result.status === 0 &&
      /^rejected: .*Connection terminated/u.test(out?.setUp ?? "") &&
      out.first === "answered" &&
      out.second === "answered" &&
      cleanupServer.connections() === 2,
    JSON.stringify({
      status: result.status,
      signal: result.signal,
      out,
      cleanupConnections: cleanupServer.connections(),
      stderr: tail(result.stderr, 4),
    }),
  );
}

/**
 * Follow-up 2: the cleanup keeps one deadline. Scaled down (3 s in all, 0.3 s
 * for the removal, 1 s for the databases, 0.5 s for groups and pids), with
 * an extension stop that never ends (a throwaway clone's stop script that
 * sleeps): the stop gets only what is left before the database reserve and
 * reports its time-out, the recorded database is still dropped before the
 * removal's reserve, and the cleanup ends within its 3 s. The control gives
 * up after 10 s.
 */
async function cleanupDeadlineControl(sandbox, report) {
  const nb = path.join(sandbox.root, "self-check", "deadline", "nb");
  sandbox.makeDir(path.join(nb, "scripts"), { recursive: true });
  sandbox.writeFile(
    path.join(nb, "scripts/extension_services.py"),
    "setInterval(() => {}, 1e9);\n",
  );
  const ledger = databaseLedger({ settleMs: 100 });
  await ledger.create(
    { processID: 1, query: async () => ({ rows: [] }) },
    "auto_canvas_it_ctl_deadline",
  );
  const rec = recordingReporter();
  const issued = [];
  const stops = [];
  const started = Date.now();
  const outcome = await Promise.race([
    cleanUp({
      sandbox,
      report: rec.report,
      nb,
      launched: true,
      groups: [],
      companions: new Map(),
      databases: ledger,
      cleanupBudget: {
        totalMs: 3000,
        removalMs: 300,
        databaseMs: 1000,
        processMs: 500,
      },
      admin: {
        async query(sql) {
          issued.push({ sql, at: Date.now() - started });
          return { rows: [] };
        },
        async close() {},
      },
      extensionStop: (label, timeoutMs) => {
        stops.push(timeoutMs);
        return runExtensionStop({
          sandbox,
          report: rec.report,
          nb,
          python: process.execPath,
          label,
          timeoutMs,
        });
      },
    }).then(() => "ended"),
    sleep(10_000).then(() => "still running after 10 s"),
  ]);
  const ms = Date.now() - started;
  const drop = issued.find((entry) => entry.sql.startsWith("DROP DATABASE"));
  report.check(
    `S T165 follow-up 2: the cleanup keeps one deadline: a stop that never ends gets what is left before the database reserve, the drop is still sent in time (cleanup ${(ms / 1000).toFixed(1)} s of 3 s)`,
    outcome === "ended" &&
      ms < 3000 &&
      stops.length === 1 &&
      stops[0] > 0 &&
      stops[0] <= 1200 &&
      rec.lines.fail.length === 1 &&
      /^cleanup: extension_services\.py stop ends the companion services: timed out after/u.test(
        rec.lines.fail[0],
      ) &&
      drop?.sql ===
        "DROP DATABASE IF EXISTS auto_canvas_it_ctl_deadline WITH (FORCE)" &&
      drop.at < 2700 &&
      rec.lines.ok.some((line) => line.includes("databases are dropped")),
    JSON.stringify({ outcome, ms, stops, issued, lines: rec.lines }),
  );
}

/**
 * Follow-up 3: M6's reopen counts only when the schematic is the one saved,
 * compared as canonical JSON (key order does not matter); a reopen that
 * kept the earlier schematic, or a text that is not JSON, fails.
 */
function reopenedSchematicControl(report) {
  const saved = '{"name":"x saved","documents":[{"instances":[1,2,3,4]}]}';
  const reordered = '{"documents":[{"instances":[1,2,3,4]}],"name":"x saved"}';
  const earlier = '{"name":"x saved","documents":[{"instances":[1,2,3]}]}';
  const answer = (projectText, extra = {}) => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      project: { revision: 2, name: "x saved", projectText, ...extra },
    }),
  });
  const expected = { revision: 2, name: "x saved", projectText: saved };
  const verdicts = {
    same: reopenedProblem(answer(reordered), expected),
    earlier: reopenedProblem(answer(earlier), expected),
    notJson: reopenedProblem(answer("<svg/>"), expected),
    revision: reopenedProblem(answer(saved, { revision: 1 }), expected),
  };
  report.check(
    "S T165 follow-up 3: M6 compares the reopened schematic with the saved one (canonical JSON), not only that it is text",
    verdicts.same === "" &&
      /not the one saved/u.test(verdicts.earlier) &&
      /not JSON/u.test(verdicts.notJson) &&
      /revision 1, expected 2/u.test(verdicts.revision),
    JSON.stringify(verdicts),
  );
}

/**
 * Follow-up 4: B's list after A's sign-out must hold B's project and not
 * A's: an always-empty list fails, as do a list with A's project and one
 * that is not a project list.
 */
function listHoldsControl(report) {
  const json = { "content-type": "application/json" };
  const list = (body) => projectList({ status: 200, headers: json, body });
  const want = { holds: ["p-b"], lacks: ["p-a"] };
  const verdicts = {
    right: listProblem(list('{"projects":[{"id":"p-b"}]}'), want),
    empty: listProblem(list('{"projects":[]}'), want),
    both: listProblem(list('{"projects":[{"id":"p-b"},{"id":"p-a"}]}'), want),
    notAList: listProblem(list('{"error":"x"}'), want),
  };
  report.check(
    "S T165 follow-up 4: B's list after the sign-out must hold B's project and not A's (an empty list fails)",
    verdicts.right === "" &&
      /expected project\(s\) missing/u.test(verdicts.empty) &&
      /of the other user present/u.test(verdicts.both) &&
      /^not a project list/u.test(verdicts.notAList),
    JSON.stringify(verdicts),
  );
}

/**
 * Follow-up 5: a CREATE DATABASE whose answer is lost (its connection broke)
 * is reconciled by the cleanup; one PostgreSQL refused as a duplicate is
 * never dropped, nor is one whose cancellation PostgreSQL confirmed. Round 2:
 * the backend may still be running the lost create and commit it later. The
 * stand-in shows `…_lost` running on its backend (pid 4101) for two polls of
 * `pg_stat_activity`, and its database only once it stopped: the look-up
 * must wait for that, then drop it. `…_hung` never stops running (pid 4102):
 * at the deadline it is reported unresolved, and neither looked up nor
 * dropped. Round 4, finding 4: the recorded backend's own row decides,
 * whatever its query text. `…_quiet`'s backend (4105) has `track_activities`
 * off (state `disabled`, no query text) and `…_hidden`'s (4106) shows
 * `<insufficient privilege>`: both count as still running and are reported
 * unresolved at the deadline; `…_idle`'s backend (4107) is idle, so that
 * create has ended and is looked up (it does not exist). The stand-in
 * answers a poll by backend pid, or, for a poll by query text, with the
 * non-idle rows showing one of the statements.
 */
async function lostAnswerControl(report) {
  const ledger = databaseLedger({ settleMs: 100 });
  const failing = (error, processID) => ({
    processID,
    query: () => Promise.reject(error),
  });
  const refusal = (code, text) =>
    Object.assign(new Error(text), { severity: "ERROR", code });
  const lostName = "auto_canvas_it_ctl_lost";
  const hungName = "auto_canvas_it_ctl_hung";
  const quietName = "auto_canvas_it_ctl_quiet";
  const hiddenName = "auto_canvas_it_ctl_hidden";
  const idleName = "auto_canvas_it_ctl_idle";
  const broke = () => new Error("Connection terminated unexpectedly");
  const outcomes = {};
  for (const [name, error, pid] of [
    [lostName, broke(), 4101],
    [hungName, broke(), 4102],
    [
      "auto_canvas_it_ctl_dup",
      refusal("42P04", 'database "auto_canvas_it_ctl_dup" already exists'),
      4103,
    ],
    [
      "auto_canvas_it_ctl_cancelled",
      refusal("57014", "canceling statement due to user request"),
      4104,
    ],
    [quietName, broke(), 4105],
    [hiddenName, broke(), 4106],
    [idleName, broke(), 4107],
  ])
    outcomes[name] = await ledger.create(failing(error, pid), name).then(
      () => "created",
      () => "rejected",
    );
  const issued = [];
  let activityPolls = 0;
  let lostCommitted = false;
  const rec = recordingReporter();
  const started = Date.now();
  await dropDatabases({
    databases: ledger,
    lostBy: started + 1200,
    admin: {
      async query(sql, params) {
        issued.push({ sql, params, at: Date.now() - started });
        if (sql.includes("pg_stat_activity")) {
          activityPolls += 1;
          const rows = [
            {
              pid: 4102,
              state: "active",
              query: `CREATE DATABASE ${hungName}`,
            },
            // A row of another backend with the same text is not the one.
            {
              pid: 9999,
              state: "active",
              query: `CREATE DATABASE ${lostName}`,
            },
            // track_activities off for that backend.
            { pid: 4105, state: "disabled", query: "" },
            { pid: 4106, state: null, query: "<insufficient privilege>" },
            { pid: 4107, state: "idle", query: `CREATE DATABASE ${idleName}` },
          ];
          if (activityPolls <= 2)
            rows.push({
              pid: 4101,
              state: "active",
              query: `CREATE DATABASE ${lostName}`,
            });
          else lostCommitted = true;
          return {
            rows: rows.filter((row) =>
              sql.includes("pid = ANY")
                ? params[0].includes(row.pid)
                : row.state !== "idle" && params[0].includes(row.query),
            ),
          };
        }
        // The catalog holds the lost name once its create committed, until
        // it is dropped; the hung one would commit later.
        if (sql.startsWith("SELECT datname")) {
          const dropped = issued.some((entry) =>
            entry.sql.startsWith("DROP DATABASE"),
          );
          return {
            rows: params[0]
              .filter((name) => name === lostName && lostCommitted && !dropped)
              .map((datname) => ({ datname })),
          };
        }
        return { rows: [] };
      },
      async close() {},
    },
    report: rec.report,
  });
  const drops = issued
    .map((entry) => entry.sql)
    .filter((sql) => sql.startsWith("DROP DATABASE"));
  const lookups = issued.filter((entry) =>
    entry.sql.startsWith("SELECT datname"),
  );
  report.check(
    "S T165 follow-up 5: a CREATE DATABASE whose answer was lost is waited for until its backend no longer runs it, then reconciled and dropped; one still running at the deadline is reported unresolved; a name PostgreSQL refused is never dropped; round 4: the recorded backend's own row decides (idle or gone has ended; track_activities off or an unreadable row counts as still running)",
    Object.values(outcomes).every((value) => value === "rejected") &&
      activityPolls >= 3 &&
      JSON.stringify(lookups[0]?.params) ===
        `[["${lostName}","${idleName}"]]` &&
      drops.length === 1 &&
      drops[0] === `DROP DATABASE IF EXISTS ${lostName} WITH (FORCE)` &&
      !issued.some((entry) =>
        JSON.stringify(entry.params ?? []).includes("ctl_dup"),
      ) &&
      rec.lines.fail.length === 1 &&
      rec.lines.fail[0] ===
        `cleanup: the CREATE DATABASE whose answer was lost has ended: unresolved: ${hungName} (its backend 4102 still runs it), ${quietName} (the activity of its backend 4105 cannot be read (state disabled)), ${hiddenName} (the activity of its backend 4106 cannot be read (state unknown)) when the time for it ran out (it may be left behind)` &&
      rec.lines.ok.some((line) =>
        line.includes(
          `whose answer was lost is reconciled (${lostName}, ${idleName}: ${lostName} exists`,
        ),
      ) &&
      rec.lines.ok.some((line) =>
        line.includes(`databases are dropped (${lostName})`),
      ),
    JSON.stringify({ outcomes, activityPolls, issued, lines: rec.lines }),
  );
}

/**
 * Follow-up 6: the bounded stop settles at its deadline although a
 * grandchild holds the inherited stdout and stderr: a throwaway clone's stop
 * script starts a sleeper (4 s) with inherited pipes, then exits 0 at once
 * or never exits (a 0.4 s limit). Both stops settle within 1.5 s. The
 * sleepers, started by this control, end by their recorded pids.
 */
async function inheritedPipesControl(sandbox, report) {
  const base = path.join(sandbox.root, "self-check", "pipes");
  const scriptFor = (pidFile, exits) =>
    'const { spawn } = require("child_process");' +
    'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], { stdio: "inherit" });' +
    `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));` +
    'console.log("stopping");' +
    (exits ? "process.exit(0);" : "setInterval(() => {}, 1e9);") +
    "\n";
  const results = {};
  const sleepers = [];
  try {
    for (const [name, exits, timeoutMs] of [
      ["exits", true, 10_000],
      ["hangs", false, 400],
    ]) {
      const nb = path.join(base, name, "nb");
      const pidFile = path.join(base, `${name}.pid`);
      sandbox.makeDir(path.join(nb, "scripts"), { recursive: true });
      sandbox.writeFile(
        path.join(nb, "scripts/extension_services.py"),
        scriptFor(pidFile, exits),
      );
      const rec = recordingReporter();
      const started = Date.now();
      const ran = await runExtensionStop({
        sandbox,
        report: rec.report,
        nb,
        python: process.execPath,
        label: `${name}:`,
        timeoutMs,
      });
      results[name] = { ran, ms: Date.now() - started, fail: rec.lines.fail };
      const sleeper = Number(sandbox.readFile(pidFile, "utf8") ?? 0);
      if (sleeper > 0) sleepers.push(sleeper);
    }
  } finally {
    for (const pid of sleepers) endOwn(pid);
  }
  report.check(
    "S T165 follow-up 6: the bounded stop settles although a grandchild holds its pipes (at the command's exit, and at the limit)",
    results.exits?.ran === true &&
      results.exits.ms < 1500 &&
      results.hangs?.ran === false &&
      results.hangs.ms < 1500 &&
      /timed out after 0\.4 s/u.test(results.hangs.fail[0] ?? "") &&
      sleepers.length === 2,
    JSON.stringify(results),
  );
}

/**
 * Follow-up 7: a body is redacted before it is cut for a diagnostic: a
 * secret that straddles the 80-character excerpt never shows in part.
 */
function redactBeforeCutControl(report) {
  const secret = `tok-${"s3cr3t".repeat(4)}`;
  const clean = (text) => text.split(secret).join("<redacted>");
  const { problem } = projectList(
    {
      status: 200,
      headers: { "content-type": "text/html" },
      body: `${"x".repeat(70)}${secret} after`,
    },
    clean,
  );
  report.check(
    "S T165 follow-up 7: a response body is redacted before it is cut for a diagnostic (no part of a secret on the boundary is printed)",
    !problem.includes(secret.slice(0, 6)) && problem.includes("<redacted>"),
    JSON.stringify(problem),
  );
}

// ---- T165 round 2: the browser's network and a launch under shutdown ------

/** Round 2 of PR 143's review: stage L's browser, against stand-ins. */
async function t165BrowserControls(sandbox, report) {
  await redirectHopControl(sandbox, report);
  await launchShutdownControl(sandbox, report);
}

/** A listener of this control on 127.0.0.1 (a free port of the run's own). */
async function standInServer(sandbox, handler) {
  const port = await sandbox.freePort();
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * Round 2, finding 1: every hop goes through the run's proxy. Real headless
 * Chrome, as stage L launches it, against two listeners of this control: a
 * stand-in web origin whose `/hop` redirects (302) to another port of
 * 127.0.0.1 that this control also listens on. The page's requests to the
 * web origin arrive through the proxy (it forwarded them), the token is in
 * `localStorage` there; the redirect's hop never arrives at the other port
 * (the proxy refuses it), no token is written on that origin, and stage L's
 * network verdicts fail it, the proxy's naming the port.
 */
async function redirectHopControl(sandbox, report) {
  const arrived = [];
  const other = await standInServer(sandbox, (req, res) => {
    arrived.push(req.url);
    res.end("reached\n");
  });
  const web = await standInServer(sandbox, (req, res) => {
    if (req.url === "/hop") {
      res.writeHead(302, {
        location: `http://127.0.0.1:${other.port}/landing`,
      });
      return void res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>web</title><p>web</p>\n");
  });
  const rec = recordingReporter();
  const browsers = browserSessions(
    { sandbox, report: rec.report },
    { dir: path.join(sandbox.root, "self-check", "redirect") },
  );
  const token = `tok-${sandbox.randomToken()}`;
  const seen = {};
  let session;
  try {
    session = await browsers.open("S redirect:", {
      webPort: web.port,
      held: () => true,
    });
    if (session) {
      await guardNetwork(session, { token });
      const page =
        session.context.pages()[0] ?? (await session.context.newPage());
      page.setDefaultTimeout(30_000);
      const tokenHere = () =>
        page
          .evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY)
          .then((value) => (value === token ? "the token" : String(value)))
          .catch((error) => `unreadable: ${error.message.split("\n")[0]}`);
      await page.goto(`http://127.0.0.1:${web.port}/`);
      seen.onWeb = await tokenHere();
      seen.hop = await page.goto(`http://127.0.0.1:${web.port}/hop`).then(
        (response) => `status ${response?.status()}`,
        (error) => error.message.split("\n")[0],
      );
      seen.landed = new URL(page.url()).port === String(other.port);
      seen.onOther = await tokenHere();
    }
  } finally {
    if (session) await browsers.close(session, 10_000, "S redirect:");
    await web.close();
    await other.close();
  }
  if (session) networkChecks(rec.report, session, "S redirect:");
  const failed = (text) =>
    rec.lines.fail.some(
      (line) => line.includes(text) && line.includes(`127.0.0.1:${other.port}`),
    );
  report.check(
    "S T165 round 2: a redirect from the web origin to another port of 127.0.0.1 that the run listens on goes through the run's proxy, which refuses it: the hop never arrives there, no token is written on that origin, and stage L's verdicts fail it",
    Boolean(session) &&
      seen.onWeb === "the token" &&
      seen.landed === true &&
      seen.onOther === "null" &&
      arrived.length === 0 &&
      session.proxy.forwarded > 0 &&
      failed("through the run's proxy went nowhere but") &&
      failed("the page requested nothing but") &&
      rec.lines.ok.some((line) =>
        line.includes("reached the web origin through the run's proxy"),
      ) &&
      rec.lines.ok.some((line) => line.includes("the browser is closed")),
    () =>
      JSON.stringify({
        seen,
        arrived,
        forwarded: session?.proxy?.forwarded,
        lines: rec.lines,
      }),
  );
}

/**
 * Round 2, finding 2: a shutdown during a browser's start. A stand-in launch
 * starts a process that names the profile on its command line and settles
 * 1.5 s later with a context whose close ends it. The cleanup's `closeOpen`
 * while that launch is pending waits for it and disposes what it produced
 * (the context closed, the process gone) and `open` returns no session; a
 * `closeOpen` while the proxy is still starting leaves the launch unmade;
 * once the shutdown began, `open` launches nothing. Round 4, finding 2: a
 * `closeOpen` during a normal close (a context whose close takes 1.5 s) waits
 * for that close — the same disposal, not a second one — and resolves only
 * once it has reported the browser closed.
 */
async function launchShutdownControl(sandbox, report) {
  const started = [];
  const results = {};
  const gate = { webPort: 1, held: () => false }; // never forwards
  try {
    {
      let closedContext = false;
      let exited = false;
      let settledAt;
      const launch = ({ profile }) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            "setInterval(() => {}, 1e9)",
            "--",
            `--user-data-dir=${profile}`,
          ],
          { stdio: "ignore", env: { PATH: process.env.PATH ?? "" } },
        );
        started.push(child.pid);
        child.once("exit", () => (exited = true));
        return sleep(1500).then(() => {
          settledAt = Date.now();
          return {
            pages: () => [],
            close: async () => {
              closedContext = true;
              endOwn(child.pid);
            },
          };
        });
      };
      const rec = recordingReporter();
      const browsers = browserSessions(
        { sandbox, report: rec.report },
        { launch, dir: path.join(sandbox.root, "self-check", "launching") },
      );
      const opening = browsers.open("S launching:", gate);
      await waitFor(() => started.length === 1, 10_000, 20);
      await sleep(300); // the launch is connecting
      await browsers.closeOpen(8000);
      const closedAt = Date.now();
      const opened = await opening;
      results.launching = {
        session: opened === undefined ? "none" : "returned",
        closedContext,
        waitedForTheStart: settledAt !== undefined && closedAt >= settledAt,
        // Its exit, seen by this process (a killed child stays a zombie
        // until it is reaped).
        processGone: await waitFor(() => exited, 3000, 50),
        lines: rec.lines,
      };
    }
    {
      let launches = 0;
      const launch = async () => {
        launches += 1;
        return { pages: () => [], close: async () => undefined };
      };
      const rec = recordingReporter();
      const browsers = browserSessions(
        { sandbox, report: rec.report },
        { launch, dir: path.join(sandbox.root, "self-check", "early") },
      );
      const opening = browsers.open("S early:", gate);
      await browsers.closeOpen(8000);
      const opened = await opening;
      const later = await browsers.open("S later:", gate);
      results.early = {
        session: opened === undefined ? "none" : "returned",
        later: later === undefined ? "none" : "returned",
        launches,
        lines: rec.lines,
      };
    }
    {
      let contextCloses = 0;
      let contextClosedAt;
      const launch = async ({ profile }) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            "setInterval(() => {}, 1e9)",
            "--",
            `--user-data-dir=${profile}`,
          ],
          { stdio: "ignore", env: { PATH: process.env.PATH ?? "" } },
        );
        started.push(child.pid);
        return {
          pages: () => [],
          close: async () => {
            contextCloses += 1;
            await sleep(1500);
            contextClosedAt = Date.now();
            endOwn(child.pid);
          },
        };
      };
      const rec = recordingReporter();
      const browsers = browserSessions(
        { sandbox, report: rec.report },
        { launch, dir: path.join(sandbox.root, "self-check", "closing") },
      );
      const session = await browsers.open("S closing:", gate);
      const closing = session
        ? browsers.close(session, 10_000, "S closing:")
        : undefined;
      await sleep(200); // the normal close is under way
      await browsers.closeOpen(8000);
      const cleanedAt = Date.now();
      const closedLines = rec.lines.ok.filter((line) =>
        line.includes("the browser is closed"),
      ).length;
      await closing;
      results.closing = {
        session: session ? "opened" : "none",
        waitedForTheClose:
          contextClosedAt !== undefined && cleanedAt >= contextClosedAt,
        closedReportedFirst: closedLines,
        contextCloses,
        lines: rec.lines,
      };
    }
  } finally {
    for (const pid of started) endOwn(pid);
  }
  const { launching, early, closing } = results;
  report.check(
    "S T165 round 2: a shutdown during the browser's launch waits for it and closes what it made (no session, the context closed, its process gone); one while the proxy starts, or after, launches nothing; round 4: one during a normal close waits for that close to end",
    launching?.session === "none" &&
      launching.closedContext &&
      launching.waitedForTheStart &&
      launching.processGone &&
      launching.lines.fail.length === 0 &&
      launching.lines.ok.some((line) =>
        line.includes("the browser is closed"),
      ) &&
      early?.session === "none" &&
      early.later === "none" &&
      early.launches === 0 &&
      early.lines.fail.length === 0 &&
      closing?.session === "opened" &&
      closing.waitedForTheClose &&
      closing.closedReportedFirst === 1 &&
      closing.contextCloses === 1 &&
      closing.lines.fail.length === 0,
    () => JSON.stringify(results),
  );
}

// ---- T165 round 4: the gate at the proxy, the database polls, the README ---

/** Round 4 of PR 143's review (codex round 2), each against stand-ins. */
async function t165Round4Controls(sandbox, report) {
  await gateFailureControl(sandbox, report);
  await lostPollBoundControl(report);
  removalSnippetControl(report);
}

/**
 * One raw exchange with the run's proxy on `port`: `text` is written as is,
 * and the answer's status line comes back ("no answer" after `ms`, or the
 * socket's error).
 */
function proxyExchange(port, text, ms = 3000) {
  return new Promise((resolve) => {
    let answer = "";
    let settled = false;
    const socket = net.connect(port, "127.0.0.1");
    const settle = (line) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(line);
    };
    const timer = setTimeout(() => settle("no answer"), ms);
    socket.on("connect", () => socket.write(text));
    socket.on("data", (chunk) => {
      answer += chunk.toString("latin1");
      if (answer.includes("\r\n")) settle(answer.split("\r\n")[0]);
    });
    socket.on("error", (error) =>
      settle(`error: ${error.code ?? error.message}`),
    );
    socket.on("close", () => settle(answer.split("\r\n")[0] || "closed"));
  });
}

/**
 * Round 4, finding 1: the listener gate at the run's proxy can fail. Against
 * a stand-in web origin, a proxy whose `held` throws (an lsof failure) and
 * one whose `held` never answers (a stalled lsof; bound 300 ms): a request
 * to the web origin (absolute form) and a CONNECT tunnel to it are refused
 * with 403 and recorded as "gate" with the reason, nothing reaches the web
 * origin, the process lives (no uncaught exception or unhandled rejection
 * while the control runs, and the proxy still answers the next request), and
 * stage L's verdict fails the refused requests.
 */
async function gateFailureControl(sandbox, report) {
  const arrived = [];
  const web = await standInServer(sandbox, (req, res) => {
    arrived.push(req.url);
    res.end("web\n");
  });
  const uncaught = [];
  const onError = (error) => uncaught.push(String(error?.message ?? error));
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  const results = {};
  try {
    for (const [name, held] of [
      [
        "throws",
        () => {
          throw new Error(`lsof for port ${web.port} failed (1): stand-in`);
        },
      ],
      ["silent", () => new Promise(() => undefined)],
    ]) {
      const proxy = await forwardingProxy(sandbox, {
        webPort: web.port,
        held,
        gateMs: 300,
      });
      try {
        const origin = `127.0.0.1:${web.port}`;
        const plain = await proxyExchange(
          proxy.port,
          `GET http://${origin}/page HTTP/1.1\r\nHost: ${origin}\r\nConnection: close\r\n\r\n`,
        );
        const tunnel = await proxyExchange(
          proxy.port,
          `CONNECT ${origin} HTTP/1.1\r\nHost: ${origin}\r\n\r\n`,
        );
        // The proxy still answers: another origin is refused as before.
        const next = await proxyExchange(
          proxy.port,
          "GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\nConnection: close\r\n\r\n",
        );
        const rec = recordingReporter();
        networkChecks(
          rec.report,
          { proxy, blocked: [], strays: [], lost: [] },
          `S gate ${name}:`,
        );
        results[name] = {
          plain,
          tunnel,
          next,
          refused: proxy.refused,
          forwarded: proxy.forwarded,
          fail: rec.lines.fail,
        };
      } finally {
        await proxy.close();
      }
    }
    await sleep(100); // a late rejection would be seen here
  } finally {
    process.off("uncaughtException", onError);
    process.off("unhandledRejection", onError);
    await web.close();
  }
  const refusedAtGate = (result, reason) =>
    Boolean(result) &&
    result.plain.startsWith("HTTP/1.1 403") &&
    result.tunnel.startsWith("HTTP/1.1 403") &&
    result.next.startsWith("HTTP/1.1 403") &&
    result.forwarded === 0 &&
    result.refused.filter(
      (entry) => entry.why === "gate" && reason.test(entry.detail ?? ""),
    ).length === 2 &&
    result.fail.some(
      (line) => line.includes("were the recorded ones") && reason.test(line),
    );
  report.check(
    "S T165 round 4: a listener gate that throws or never answers refuses the request at the run's proxy (403, recorded as \"gate\" with its reason, nothing forwarded), the process lives, and stage L's verdict fails it",
    uncaught.length === 0 &&
      arrived.length === 0 &&
      refusedAtGate(
        results.throws,
        /the listener check failed: lsof for port/u,
      ) &&
      refusedAtGate(results.silent, /gave no answer within 300 ms/u),
    () => JSON.stringify({ uncaught, arrived, results }),
  );
}

/**
 * Round 4, finding 3: each poll of `pg_stat_activity` for a lost create is
 * bounded by the time left until `lostBy`, and the drops after it keep their
 * own bounds. The cleanup's own `adminSession` over a stand-in client that
 * honours `query_timeout` as pg does (it rejects with "Query read timeout")
 * and never answers the poll: the poll is given at most the 400 ms to
 * `lostBy` and ends there, the lost create is reported unresolved (never
 * looked up or dropped), and the created database's drop is still sent, on
 * a new connection, with the session's full 3 s step.
 */
async function lostPollBoundControl(report) {
  const ledger = databaseLedger({ settleMs: 100 });
  const made = "auto_canvas_it_ctl_bound_made";
  const lost = "auto_canvas_it_ctl_bound_lost";
  await ledger.create(
    { processID: 1, query: async () => ({ rows: [] }) },
    made,
  );
  await ledger
    .create(
      {
        processID: 4201,
        query: () =>
          Promise.reject(new Error("Connection terminated unexpectedly")),
      },
      lost,
    )
    .catch(() => undefined);
  const asked = [];
  let opens = 0;
  const started = Date.now();
  const open = async () => {
    opens += 1;
    const connection = opens;
    return {
      async query({ text, query_timeout: timeout }) {
        asked.push({ text, timeout, connection, at: Date.now() - started });
        if (text.includes("pg_stat_activity"))
          return new Promise((resolve, reject) =>
            setTimeout(() => reject(new Error("Query read timeout")), timeout),
          );
        return { rows: [] };
      },
      async end() {},
    };
  };
  const rec = recordingReporter();
  await dropDatabases({
    databases: ledger,
    admin: adminSession({ open, stepMs: 3000, budgetMs: 9000 }),
    report: rec.report,
    lostBy: started + 400,
  });
  const ended = Date.now() - started;
  const polls = asked.filter((entry) =>
    entry.text.includes("pg_stat_activity"),
  );
  const drops = asked.filter((entry) => entry.text.startsWith("DROP DATABASE"));
  report.check(
    `S T165 round 4: a poll for a lost create is bounded by the time left until lostBy (the cleanup's database part ended after ${ended} ms), and the drop after it keeps its own bound`,
    polls.length >= 1 &&
      polls.every((entry) => entry.timeout <= 400) &&
      ended < 2000 &&
      drops.length === 1 &&
      drops[0].text === `DROP DATABASE IF EXISTS ${made} WITH (FORCE)` &&
      drops[0].timeout > 2500 &&
      drops[0].connection === 2 &&
      !asked.some(
        (entry) => entry.text.startsWith("DROP") && entry.text.includes(lost),
      ) &&
      rec.lines.fail.length === 1 &&
      rec.lines.fail[0].startsWith(
        `cleanup: the CREATE DATABASE whose answer was lost has ended: unresolved: whether a backend still runs ${lost} could not be read: no answer within 0.`,
      ),
    () => JSON.stringify({ ended, asked, lines: rec.lines }),
  );
}

/**
 * Round 4, finding 5: the README's removal snippet (the bash block that
 * takes the canvas's path out of `SILICON_NOTEBOOK_UI_PLUGINS`), run by bash
 * under `set -euo pipefail` with the canvas's path as the only entry, among
 * three, absent from three, twice, and with the variable unset: it always
 * runs to its end, keeps the other entries, and unsets the variable only
 * when none is left.
 */
function removalSnippetControl(report) {
  const readme = fs.readFileSync(path.join(integration, "README.md"), "utf8");
  const block = /```bash\n(CANVAS_UI=[^\n]*\nrest=[\s\S]*?)```/u.exec(
    readme,
  )?.[1];
  const canvas = /^CANVAS_UI=(\S+)$/mu.exec(block ?? "")?.[1] ?? "";
  const cases = [
    [canvas, "<unset>"],
    [`/a/one:${canvas}:/b/two`, "/a/one:/b/two"],
    ["/a/one:/b/two:/c/three", "/a/one:/b/two:/c/three"],
    [`${canvas}:/a/one:${canvas}`, "/a/one"],
    [undefined, "<unset>"],
  ];
  const seen = cases.map(([value, want]) => {
    const run = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail\n${block}\nprintf 'end:%s' "\${SILICON_NOTEBOOK_UI_PLUGINS-<unset>}"`,
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH ?? "",
          ...(value === undefined
            ? {}
            : { SILICON_NOTEBOOK_UI_PLUGINS: value }),
        },
      },
    );
    return {
      value: value ?? "(unset)",
      want,
      status: run.status,
      out: run.stdout,
      ok: run.status === 0 && run.stdout === `end:${want}`,
    };
  });
  report.check(
    "S T165 round 4: the README's removal snippet runs to its end under set -euo pipefail with the canvas's path as the only entry, among three, absent, twice, and with the variable unset",
    Boolean(block) && canvas !== "" && seen.every((entry) => entry.ok),
    () => JSON.stringify({ found: Boolean(block), seen }),
  );
}

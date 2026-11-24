// Stage S: self-checks of the script's own refusals, on throwaway material only
// (a throwaway local git repository cloned inside the sandbox, never the
// notebook checkout). Each negative control also proves that the file outside
// the clone is byte-identical afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
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
  cloneGuards,
  makeLocal,
  removeNext,
  sha256,
  survivingPids,
} from "./notebook-clone.mjs";
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

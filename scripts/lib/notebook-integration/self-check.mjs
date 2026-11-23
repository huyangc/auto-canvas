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
import { modulesInClone, prepareModules } from "./modules.mjs";
import { PathRefused, UsageError, lsofLines, waitFor } from "./sandbox.mjs";
import {
  dependencyManifests,
  makeLocal,
  removeNext,
  survivingPids,
} from "./stage-a.mjs";
import { removeAppNext, singleRuleControl, writeApp } from "./stage-t.mjs";
import { startStub, transportAssertions } from "./transport.mjs";
import {
  abnormalEnd,
  awaitOwnership,
  guardLoaded,
  ownershipGate,
  OwnershipLost,
  tail,
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
  dependencyManifestControl(report);
  lsofFailureControl(sandbox, report);
  ownOperationControls(sandbox, report);
  await frontendNotADirectoryControl(sandbox, report);
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
export async function stopRaceControls(sandbox, report) {
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

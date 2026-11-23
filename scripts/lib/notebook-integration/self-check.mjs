// Stage S: self-checks of the script's own refusals, on throwaway material only
// (a throwaway local git repository cloned inside the sandbox, never the
// notebook checkout). Each negative control also proves that the file outside
// the clone is byte-identical afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cloneTreeProblems } from "./clone-safety.mjs";
import { modulesInClone } from "./modules.mjs";
import { lsofLines, waitFor } from "./sandbox.mjs";
import { dependencyManifests, survivingPids } from "./stage-a.mjs";
import { startStub, transportAssertions } from "./transport.mjs";
import {
  abnormalEnd,
  awaitOwnership,
  guardLoaded,
  tail,
  writePackage,
} from "./steps.mjs";

/** Build a throwaway repository, commit it, and clone it. Returns the clone. */
async function makeClone(sandbox, name, { files = {}, links = {} }) {
  const base = path.join(sandbox.root, "self-check", name);
  const repo = path.join(base, "repo");
  const clone = path.join(base, "clone");
  fs.mkdirSync(repo, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
    fs.writeFileSync(path.join(repo, relative), content);
  }
  for (const [relative, target] of Object.entries(links)) {
    fs.mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
    fs.symlinkSync(target, path.join(repo, relative));
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
  fs.mkdirSync(outside, { recursive: true });
  const outsideFile = path.join(outside, "target.txt");
  const outsideBytes = Buffer.from("outside the clone\n");
  fs.writeFileSync(outsideFile, outsideBytes);
  fs.mkdirSync(path.join(outside, "dir"));

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
      before: (clone) => {
        fs.mkdirSync(path.join(clone, "frontend/.next"));
        fs.mkdirSync(path.join(clone, ".local"));
      },
      phase: "launch",
      refused: undefined,
    },
    {
      name: "launch-local-not-empty",
      files: { "frontend/package.json": "{}\n" },
      before: (clone) => {
        fs.mkdirSync(path.join(clone, ".local"));
        fs.writeFileSync(path.join(clone, ".local/x"), "");
      },
      phase: "launch",
      refused: ".local is not empty",
    },
    {
      name: "built-generated-file-redirected",
      files: { "frontend/next-env.d.ts": "x\n" },
      before: (clone) => {
        fs.mkdirSync(path.join(clone, "frontend/.next"));
        fs.rmSync(path.join(clone, "frontend/next-env.d.ts"));
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
  ];
  for (const scenario of scenarios) {
    const clone = await makeClone(sandbox, scenario.name, scenario);
    scenario.before?.(clone);
    const problems = cloneTreeProblems(clone, scenario.phase);
    const verdict =
      scenario.refused === undefined
        ? problems.length === 0
        : problems.some((problem) => problem.includes(scenario.refused));
    const untouched = fs.readFileSync(outsideFile).equals(outsideBytes);
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
  await movedServiceControl(sandbox, report);
  dependencyManifestControl(report);
  lsofFailureControl(sandbox, report);
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
  fs.mkdirSync(dir, { recursive: true });
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
  fs.mkdirSync(path.join(outside, "pkg"), { recursive: true });
  const outsideFile = path.join(outside, "pkg", "index.js");
  fs.writeFileSync(outsideFile, "shared\n");
  const scenarios = [
    {
      name: "replaced by a link to a shared tree",
      setup: (modules) => fs.symlinkSync(outside, modules),
      refused: "is a symlink",
    },
    {
      name: "a package linked out of the copy",
      setup: (modules) => {
        fs.mkdirSync(modules, { recursive: true });
        fs.symlinkSync(path.join(outside, "pkg"), path.join(modules, "pkg"));
      },
      refused: "resolves outside the copy",
    },
    {
      name: "internal links only",
      setup: (modules) => {
        fs.mkdirSync(path.join(modules, "real"), { recursive: true });
        fs.mkdirSync(path.join(modules, ".bin"));
        fs.symlinkSync("../real", path.join(modules, ".bin", "real"));
      },
      refused: undefined,
    },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const frontend = path.join(base, `clone-${index}`, "frontend");
    fs.mkdirSync(frontend, { recursive: true });
    const modules = path.join(frontend, "node_modules");
    scenario.setup(modules);
    const problems = modulesInClone(sandbox, modules);
    const verdict =
      scenario.refused === undefined
        ? problems.length === 0
        : problems.some((problem) => problem.includes(scenario.refused));
    report.check(
      `S node_modules after a build, ${scenario.name}: ${scenario.refused === undefined ? "accepted" : "refused"}`,
      verdict && fs.readFileSync(outsideFile, "utf8") === "shared\n",
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

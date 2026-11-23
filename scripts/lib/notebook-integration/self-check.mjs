// Stage S: self-checks of the script's own refusals, on throwaway material only
// (a throwaway local git repository cloned inside the sandbox, never the
// notebook checkout). Each negative control also proves that the file outside
// the clone is byte-identical afterwards.
import fs from "node:fs";
import path from "node:path";

import { cloneTreeProblems } from "./clone-safety.mjs";
import { awaitOwnership } from "./steps.mjs";

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
  const waiting = sandbox.start(
    process.execPath,
    ["-e", "setTimeout(()=>{},60000)"],
    { cwd: sandbox.root, name: "self-waiting-service" },
  );
  try {
    await dying.done;
    const started = Date.now();
    const result = await awaitOwnership(sandbox, {
      apiPort,
      webPort,
      backendPid: dying.child.pid,
      frontendPid: waiting.child.pid,
    });
    const seconds = (Date.now() - started) / 1000;
    report.check(
      "S a service that exits before binding ends the ownership wait at once",
      !result.ok && /exited before binding/.test(result.reason) && seconds < 10,
      `ok ${result.ok}, reason ${JSON.stringify(result.reason)}, ${seconds}s`,
    );
  } finally {
    await sandbox.stopGroup(waiting.pgid);
    await sandbox.stopGroup(dying.pgid);
  }
}

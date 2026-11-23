// Stage A: a given silicon-notebook revision, alone, in a private clone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { modulesInClone, prepareModules } from "./modules.mjs";
import { cloneTreeProblems } from "./clone-safety.mjs";
import {
  abnormalEnd,
  awaitOwnership,
  checkStopped,
  guardLoaded,
  nextCommand,
  ownershipHeld,
  startNext,
  stopServer,
  tail,
} from "./steps.mjs";
import { waitFor } from "./sandbox.mjs";
import {
  expectRewrites,
  rawRequest,
  readManifest,
  startStub,
  todaysRules,
  transportAssertions,
} from "./transport.mjs";

// Dotenv files a launch or build of the clone would read by fixed name:
// scripts/prod.sh sources <clone>/.env (ALLOW_NO_ENV_FILE only allows it to
// be absent), and Next loads these from frontend/ at build and start. Any of
// them, as a file or a symlink (lstat: a dangling one counts), would override
// the allow-listed environment, so its presence refuses the step.
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
class Refused extends Error {}

export async function stageA(context) {
  try {
    await stageABody(context);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    context.refused = true;
  }
}

async function stageABody({ sandbox, report, notebook, options }) {
  const nb = path.join(sandbox.root, "nb");
  const frontend = path.join(nb, "frontend");
  const git = (args, cwd = nb) =>
    execFileSync("git", args, {
      cwd,
      env: sandbox.env(),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });

  // Clone and resolve the two revisions to commits.
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
    return;
  const resolve = (ref) => {
    for (const name of [ref, `origin/${ref}`]) {
      try {
        return git([
          "rev-parse",
          "--verify",
          "--quiet",
          `${name}^{commit}`,
        ]).trim();
      } catch {
        // try the next spelling
      }
    }
    return undefined;
  };
  const candidate = resolve(options.ref);
  const base = resolve(options.base);
  if (
    !report.check(
      "--ref and --base resolve to commits",
      candidate && base,
      `ref ${candidate}, base ${base}`,
    )
  )
    return;
  console.log(`     candidate ${candidate} (${options.ref})`);
  console.log(`     base      ${base} (${options.base})`);
  git(["checkout", "--quiet", "--detach", candidate]);

  // The revision decides what <clone> holds: a tracked symlink at any path
  // this stage writes to, or a dotenv file, refuses the stage before any
  // copy, build or launch.
  const clonePaths = [
    nb,
    frontend,
    path.join(nb, ".local"),
    path.join(frontend, ".next"),
    path.join(frontend, "node_modules"),
  ];
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
        return error.code !== "ENOENT";
      }
    });
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
  refuseUnsafeClone(
    "the clone's paths are real directories inside the sandbox, without dotenv files",
    clonePaths,
    "start",
  );
  report.ok(
    "the clone's paths are real directories inside the sandbox, without dotenv files",
  );

  // Modules: the source checkout's installed modules must match the revision.
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
    return;
  const modules = path.join(frontend, "node_modules");
  const preflight = prepareModules(
    sandbox,
    path.join(notebook, "frontend/node_modules"),
    modules,
  );
  if (preflight.problems.length) {
    report.fail(
      "private modules preflight",
      preflight.problems.slice(0, 10).join("; "),
    );
    return;
  }
  report.ok(
    `private modules preflight (next ${preflight.version}; native SWC ${preflight.loaded.join(", ")})`,
  );

  // A1: no new dependency.
  // --no-renames: a moved file shows both its old and its new path; -z: names
  // are NUL-terminated and never quoted, so unusual bytes still match.
  const changed = git([
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    base,
    candidate,
  ])
    .split("\0")
    .filter(Boolean);
  if (base === candidate)
    report.ok("A1 (base equals candidate, nothing to compare)");
  else {
    const forbidden = changed.filter(
      (file) =>
        /(^|\/)package(-lock)?\.json$/.test(file) ||
        /^backend\/requirements[^/]*$/.test(file),
    );
    for (const file of changed) report.info(`changed: ${file}`);
    report.check(
      "A1 no new dependency",
      forbidden.length === 0,
      forbidden.join(", "),
    );
  }

  const build = async (extra, name) => {
    refuseUnsafeClone(
      `${name}: the clone is safe to build in`,
      [frontend],
      "built",
      { modules: true },
    );
    const mark = sandbox.guardMark();
    const result = await sandbox.run("npm", ["run", "build"], {
      cwd: frontend,
      env: sandbox.env(extra),
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
  const cleanNext = () =>
    fs.rmSync(path.join(frontend, ".next"), { recursive: true, force: true });

  // A2: the default build is exactly today's rules.
  const apiPort = await sandbox.freePort();
  const backend = `http://127.0.0.1:${apiPort}`;
  const today = todaysRules(backend);
  const a2 = await build({ BACKEND_PROXY_TARGET: backend }, "a2-build");
  if (
    report.check("A2 default build exits 0", a2.status === 0, () =>
      tail(a2.output),
    )
  ) {
    expectRewrites(
      report,
      "A2 default rewrites are exactly today's two",
      readManifest(frontend),
      today,
    );
    const web = await sandbox.freePort();
    const server = await startNext(sandbox, {
      dir: frontend,
      port: web,
      env: sandbox.env(),
      name: "a2-start",
    });
    try {
      if (
        report.check(
          "A2 next start owns its port and serves /",
          !server.error,
          () => server.error,
        )
      ) {
        for (const route of ["/canvas", "/canvas/editor"]) {
          const res = await rawRequest(web, route);
          report.check(
            `A2 GET ${route} -> 404 without the canvas rule`,
            res.status === 404,
            `status ${res.status}`,
          );
        }
        ownershipHeld(
          sandbox,
          report,
          "A2 next start still owns its port after the last probe",
          web,
          server.pid,
        );
      }
    } finally {
      await stopServer(sandbox, report, "A2 next start", server.handle);
    }
  }

  // A3: the enabled build adds exactly two rules.
  const stubPort = await sandbox.freePort();
  const stub = await startStub(stubPort);
  const target = `http://127.0.0.1:${stubPort}`;
  try {
    cleanNext();
    const a3 = await build(
      { BACKEND_PROXY_TARGET: backend, CANVAS_PROXY_TARGET: target },
      "a3-build",
    );
    let enabled = false;
    if (
      report.check("A3 enabled build exits 0", a3.status === 0, () =>
        tail(a3.output),
      )
    ) {
      const manifest = readManifest(frontend);
      enabled = expectRewrites(
        report,
        "A3 rewrites are today's two plus exactly two canvas rules",
        manifest,
        [
          ...today,
          { source: "/canvas", destination: `${target}/@notebook/canvas/` },
          {
            sourceMatches: (source) =>
              source.startsWith("/canvas/:path(") && source.endsWith(")*"),
            destination: `${target}/@notebook/canvas/:path*`,
          },
        ],
      );
      console.log(`     fourth source: ${manifest.afterFiles[3]?.source}`);
    }

    // A4: the real build passes the transport table and its target is frozen.
    if (enabled || a3.status === 0) {
      const web = await sandbox.freePort();
      const wrong = await sandbox.freePort();
      const server = await startNext(sandbox, {
        dir: frontend,
        port: web,
        env: sandbox.env({ CANVAS_PROXY_TARGET: `http://127.0.0.1:${wrong}` }),
        name: "a4-start",
      });
      try {
        if (
          report.check(
            "A4 next start owns its port and serves /",
            !server.error,
            () => server.error,
          )
        ) {
          await transportAssertions({
            nextPort: web,
            stub,
            report,
            prefix: "A4 ",
          });
          ownershipHeld(
            sandbox,
            report,
            "A4 next start still owns its port after the last probe",
            web,
            server.pid,
          );
        }
      } finally {
        await stopServer(sandbox, report, "A4 next start", server.handle);
      }
    } else
      report.fail(
        "A4 real build passes the transport table",
        "no enabled build to start",
      );
  } finally {
    await stub.close();
  }

  // A5: invalid values fail the build with the right diagnostic. Only a
  // build that ended by itself with a non-zero status counts as a rejection.
  for (const value of ["http://[::1]:4310", "http://example.com"]) {
    const result = await build({ CANVAS_PROXY_TARGET: value }, "a5-build");
    const name = `A5 CANVAS_PROXY_TARGET=${value} fails the build and names the variable`;
    const abnormal = abnormalEnd(result);
    if (abnormal) report.fail(name, `${abnormal}\n${tail(result.output, 8)}`);
    else
      report.check(
        name,
        result.status !== 0 && result.output.includes("CANVAS_PROXY_TARGET"),
        `exit ${result.status}\n${tail(result.output, 8)}`,
      );
  }

  await stageA6({
    sandbox,
    report,
    options,
    nb,
    frontend,
    build,
    cleanNext,
    refuseUnsafeClone,
  });
}

async function stageA6({
  sandbox,
  report,
  options,
  nb,
  frontend,
  build,
  cleanNext,
  refuseUnsafeClone,
}) {
  const apiPort = await sandbox.freePort();
  const webPort = await sandbox.freePort();
  if (!report.check("A6 distinct ports", apiPort !== webPort, "same port"))
    return;
  const backend = `http://127.0.0.1:${apiPort}`;
  cleanNext();
  const built = await build(
    { BACKEND_PROXY_TARGET: backend, CANVAS_PROXY_TARGET: "" },
    "a6-build",
  );
  if (
    !report.check(
      "A6 build with an empty CANVAS_PROXY_TARGET exits 0",
      built.status === 0,
      () => tail(built.output),
    )
  )
    return;
  expectRewrites(
    report,
    "A6 rewrites equal today's two",
    readManifest(frontend),
    todaysRules(backend),
  );

  // The launcher writes logs and the database under <clone>/.local: it must be
  // a real directory inside the sandbox, created here when the revision has
  // none, so the launcher can never be handed a symlink.
  const local = path.join(nb, ".local");
  refuseUnsafeClone(
    "A6 <clone>/.local is safe before the launch",
    [nb, local],
    "built",
  );
  try {
    fs.lstatSync(local);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(local);
  }
  refuseUnsafeClone(
    "A6 <clone>/.local is safe before the launch",
    [nb, frontend, local],
    "launch",
    { modules: true },
  );
  report.ok("A6 <clone>/.local is a real directory and no dotenv file exists");

  const launchMark = sandbox.guardMark();
  const launcher = sandbox.start("npm", ["run", "start"], {
    cwd: nb,
    name: "a6-launcher",
    env: sandbox.env({
      ALLOW_NO_ENV_FILE: "1",
      SKIP_INSTALL: "1",
      SKIP_BUILD: "1",
      PYTHON_BIN: options.python,
      PORT: String(apiPort),
      FRONTEND_PORT: String(webPort),
      BACKEND_PROXY_TARGET: backend,
      // Authentication stays on (no SILICON_NOTEBOOK_AUTH_OPTIONAL): the
      // launcher's `next start` listens on every interface, so the clone must
      // refuse anyone without a session. The seeded administrator gets a
      // random password instead of the default "admin".
      SILICON_NOTEBOOK_ADMIN_PASSWORD: sandbox.randomToken(),
      // The backend's log handler wraps at 80 columns without a terminal,
      // which splits the startup "paths:" line the database check reads.
      COLUMNS: "1000",
    }),
  });
  const logTail = () => {
    const logs = path.join(nb, ".local/logs");
    const parts = [tail(fs.readFileSync(launcher.logFile, "utf8"), 15)];
    if (fs.existsSync(logs))
      for (const entry of fs.readdirSync(logs, { withFileTypes: true }))
        if (entry.isFile())
          parts.push(
            `--- ${entry.name}\n${tail(fs.readFileSync(path.join(logs, entry.name), "utf8"), 15)}`,
          );
    return parts.join("\n");
  };
  try {
    if (!(await waitFor(() => launcher.exited, 120_000)))
      return void report.fail(
        "A6 launcher finished",
        `still running after 120 s\n${logTail()}`,
      );
    const output = fs.readFileSync(launcher.logFile, "utf8");
    const backendPid = Number(/backend\s+:.*\(PID (\d+)/.exec(output)?.[1]);
    const frontendPid = Number(/frontend\s+:.*\(PID (\d+)/.exec(output)?.[1]);
    if (
      !report.check(
        "A6 launcher printed both PIDs",
        backendPid > 0 && frontendPid > 0,
        logTail(),
      )
    )
      return;
    const groupOf = (pid) => {
      try {
        return Number(
          execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
            encoding: "utf8",
            env: { PATH: process.env.PATH ?? "" },
          }).trim(),
        );
      } catch {
        return -1;
      }
    };
    const outside = [backendPid, frontendPid].filter(
      (pid) => groupOf(pid) !== launcher.pgid,
    );
    if (outside.length) {
      for (const pid of outside) {
        let command = "";
        try {
          command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
            encoding: "utf8",
            env: { PATH: process.env.PATH ?? "" },
          }).trim();
        } catch {
          command = "(gone)";
        }
        report.info(`out-of-group pid ${pid}: ${command}`);
      }
      report.fail(
        "A6",
        `service(s) ${outside.join(", ")} are not in the launcher's process group`,
      );
      return;
    }
    report.ok("A6 both services are in the owned process group");

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
        "A6 each port is owned by the service the launcher started",
        waited.ok,
        () =>
          `${waited.reason || "timeout"}: ${describeOwnership(seen)}\n${logTail()}`,
      )
    )
      return;
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // The services are up once the anonymous readiness probe says so. Each
    // request is sent only while both ports are still owned: another pid, or
    // a port that lost its listener, fails at once.
    let dead = "";
    let lost = "";
    const ready = await waitFor(
      async () => {
        if (!alive(backendPid) || !alive(frontendPid)) {
          dead = `pid ${alive(backendPid) ? frontendPid : backendPid} died`;
          return true;
        }
        const now = ownership();
        if (!bothOwned(now)) {
          lost = `ownership lost during readiness: ${describeOwnership(now)}`;
          return true;
        }
        try {
          const res = await rawRequest(webPort, "/api/ready");
          return res.status === 200 && JSON.parse(res.body).ready === true;
        } catch {
          return false;
        }
      },
      120_000,
      1000,
    );
    if (!ready || dead || lost)
      return void report.fail(
        "A6 /api/ready reports ready through the frontend",
        `${dead || lost || "timeout"}\n${logTail()}`,
      );
    seen = ownership();
    if (!bothOwned(seen))
      return void report.fail(
        "A6 ports still owned after the readiness answer",
        describeOwnership(seen),
      );

    // The safety property comes first. The frontend listens on every
    // interface (the launcher gives `next start` no -H, and `next start`
    // reads no variable for its host), so without a session the clone must
    // answer 401, through the frontend and on the backend port. On failure
    // A6 stops here and the finally below stops the services.
    const unauthenticated = await Promise.all(
      [webPort, apiPort].map((port) =>
        rawRequest(port, "/api/health").catch((error) => ({
          status: `error ${error.message}`,
        })),
      ),
    );
    if (
      !report.check(
        "A6 the clone refuses unauthenticated API requests",
        unauthenticated.every((res) => res.status === 401),
        `GET /api/health without a session: frontend ${unauthenticated[0].status}, backend ${unauthenticated[1].status}`,
      )
    )
      return;
    report.note(
      `A6 listeners: frontend ${sandbox.listenerAddresses(webPort).join(", ")}; ` +
        `backend ${sandbox.listenerAddresses(apiPort).join(", ")}`,
    );
    report.ok("A6 /api/ready reports ready through the frontend");
    // R6-1: the frontend that answered (the pid owning the port) must have
    // loaded the guard, whatever npm or the launcher did to NODE_OPTIONS.
    guardLoaded(
      sandbox,
      report,
      `A6 the offline guard was loaded in the frontend (pid ${frontendPid})`,
      launchMark,
      (entry) => entry.pid === frontendPid,
    );

    const home = await rawRequest(webPort, "/");
    report.check(
      "A6 GET / -> 200 through the frontend",
      home.status === 200,
      `status ${home.status}`,
    );
    const canvas = await rawRequest(webPort, "/canvas");
    report.check(
      "A6 GET /canvas -> 404 without the canvas rule",
      canvas.status === 404,
      `status ${canvas.status}`,
    );

    // The database is the clone's: the backend logs the resolved database
    // path at startup, and that exact file must exist inside <clone>/.local.
    // The boundary is <root>/nb/.local spelled from the sandbox root (a real
    // path), never a re-resolved .local, so a .local swapped for a symlink
    // cannot become its own boundary.
    const backendLog = path.join(local, "logs/backend.log");
    const head = fs.existsSync(backendLog)
      ? fs.readFileSync(backendLog, "utf8").split("\n").slice(0, 40).join("\n")
      : "";
    const dbPath = /paths: database=sqlite path=(\S+) storage=/.exec(head)?.[1];
    const dbProblem = (() => {
      if (!dbPath) return "no 'paths: database=sqlite path=' line";
      if (!path.isAbsolute(dbPath)) return `${dbPath} is not absolute`;
      if (!fs.existsSync(dbPath)) return `${dbPath} does not exist`;
      const boundary = path.join(fs.realpathSync(sandbox.root), "nb", ".local");
      const real = fs.realpathSync(dbPath);
      const rel = path.relative(boundary, real);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
        return `${real} is outside ${boundary}`;
      try {
        sandbox.assertInsideSandbox(path.dirname(dbPath));
      } catch (error) {
        return error.message;
      }
      return "";
    })();
    report.check(
      `A6 the database is the clone's (${dbPath ?? "?"})`,
      !dbProblem,
      () => `${dbProblem}; backend log head:\n${head}`,
    );
    seen = ownership();
    report.check(
      "A6 both ports still owned after the last probe",
      bothOwned(seen),
      () => describeOwnership(seen),
    );
  } finally {
    const gone = await sandbox.stopGroup(launcher.pgid);
    report.check(
      "A6 the owned process group is stopped",
      gone,
      `process group ${launcher.pgid} still present`,
    );
  }
}

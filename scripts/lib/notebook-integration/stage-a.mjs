// Stage A: a given silicon-notebook revision, alone, in a private clone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { copyModules, preflightModules } from "./modules.mjs";
import { startNext, tail } from "./steps.mjs";
import { waitFor } from "./sandbox.mjs";
import {
  expectRewrites,
  rawRequest,
  readManifest,
  startStub,
  todaysRules,
  transportAssertions,
} from "./transport.mjs";

export async function stageA({ sandbox, report, notebook, options }) {
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
  copyModules(sandbox, path.join(notebook, "frontend/node_modules"), modules);
  const preflight = preflightModules(sandbox, modules);
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
  const changed = git(["diff", "--name-only", base, candidate])
    .split("\n")
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

  const build = (extra, name) =>
    sandbox.run("npm", ["run", "build"], {
      cwd: frontend,
      env: sandbox.env(extra),
      name,
    });
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
      }
    } finally {
      await sandbox.stopGroup(server.handle.pgid);
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
        )
          await transportAssertions({
            nextPort: web,
            stub,
            report,
            prefix: "A4 ",
          });
      } finally {
        await sandbox.stopGroup(server.handle.pgid);
      }
    } else
      report.fail(
        "A4 real build passes the transport table",
        "no enabled build to start",
      );
  } finally {
    await stub.close();
  }

  // A5: invalid values fail the build with the right diagnostic.
  for (const value of ["http://[::1]:4310", "http://example.com"]) {
    const result = await build({ CANVAS_PROXY_TARGET: value }, "a5-build");
    report.check(
      `A5 CANVAS_PROXY_TARGET=${value} fails the build and names the variable`,
      result.status !== 0 && result.output.includes("CANVAS_PROXY_TARGET"),
      `exit ${result.status}\n${tail(result.output, 8)}`,
    );
  }

  await stageA6({ sandbox, report, options, nb, frontend, build, cleanNext });
}

async function stageA6({
  sandbox,
  report,
  options,
  nb,
  frontend,
  build,
  cleanNext,
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
      ...A6_EXTRA_ENV,
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

    const owned = await waitFor(
      () =>
        sandbox.listenerIs(apiPort, backendPid) &&
        sandbox.listenerIs(webPort, frontendPid),
      120_000,
      500,
    );
    if (
      !report.check(
        "A6 each port is owned by the service the launcher started",
        owned,
        `api ${apiPort}: ${sandbox.listenerPids(apiPort)} (want ${backendPid}); web ${webPort}: ${sandbox.listenerPids(webPort)} (want ${frontendPid})\n${logTail()}`,
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
    let dead = "";
    const ready = await waitFor(
      async () => {
        if (!alive(backendPid) || !alive(frontendPid)) {
          dead = `pid ${alive(backendPid) ? frontendPid : backendPid} died`;
          return true;
        }
        try {
          const [health, home] = await Promise.all([
            rawRequest(webPort, "/api/health"),
            rawRequest(webPort, "/"),
          ]);
          return health.status === 200 && home.status === 200;
        } catch {
          return false;
        }
      },
      120_000,
      1000,
    );
    if (
      !report.check(
        "A6 /api/health and / answer 200 through the frontend",
        ready && !dead,
        `${dead || "timeout"}\n${logTail()}`,
      )
    )
      return;
    const canvas = await rawRequest(webPort, "/canvas");
    report.check(
      "A6 GET /canvas -> 404 without the canvas rule",
      canvas.status === 404,
      `status ${canvas.status}`,
    );

    const local = path.join(nb, ".local");
    const files = fs.existsSync(local)
      ? fs.readdirSync(local, { recursive: true }).map(String)
      : [];
    const sqlite = files.filter((file) => /\.(db|sqlite3?)$/.test(file));
    const backendLog = path.join(local, "logs/backend.log");
    const head = fs.existsSync(backendLog)
      ? fs.readFileSync(backendLog, "utf8").split("\n").slice(0, 20).join("\n")
      : "";
    report.check(
      "A6 the database and logs are the clone's",
      sqlite.length > 0 && head.includes(nb),
      `sqlite ${JSON.stringify(sqlite)}; backend log head:\n${head}`,
    );
  } finally {
    const gone = await sandbox.stopGroup(launcher.pgid);
    report.check(
      "A6 the owned process group is stopped",
      gone,
      "group still alive",
    );
  }
}

// Variables the launcher needed beyond the plan's list. Without an env file the
// backend requires a login for every request (GET /api/health answered 401);
// the notebook's .env.example allows this switch "for local tests only".
const A6_EXTRA_ENV = { SILICON_NOTEBOOK_AUTH_OPTIONAL: "true" };

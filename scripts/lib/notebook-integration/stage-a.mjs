// Stage A: a given silicon-notebook revision, alone, in a private clone. The
// clone, its refusals, the modules copy, the builds and the launch are the
// steps stage M shares (notebook-clone.mjs).
import fs from "node:fs";
import path from "node:path";

import {
  awaitLaunch,
  cloneGuards,
  cloneRevision,
  copyModules,
  makeBuild,
  makeLocal,
  Refused,
  refuseUnsafeStart,
  removeNext,
  stopLaunch,
} from "./notebook-clone.mjs";
import {
  abnormalEnd,
  guardLoaded,
  ownershipGate,
  OwnershipLost,
  ownershipHeld,
  startNext,
  stopServer,
  tail,
} from "./steps.mjs";
import { waitFor } from "./sandbox.mjs";
import {
  expectDestinations,
  expectRewrites,
  readManifest,
  startStub,
  todaysRules,
  transportAssertions,
} from "./transport.mjs";

// A1's protected files, exactly as the plan names them (R7-4): the two
// manifests at the root and in frontend/, and backend/requirements*. A
// package.json elsewhere (a test fixture) is not a dependency change.
const DEPENDENCY_MANIFESTS = new Set([
  "package.json",
  "package-lock.json",
  "frontend/package.json",
  "frontend/package-lock.json",
]);

/** The changed paths that are dependency manifests. */
export const dependencyManifests = (files) =>
  files.filter(
    (file) =>
      DEPENDENCY_MANIFESTS.has(file) ||
      /^backend\/requirements[^/]*$/.test(file),
  );

// R19-1: a port a rewrite must never send a request to is held, for as long as
// a step runs, by this small listener of the run: every request it receives is
// printed (the step's log file keeps it) and answered with a plain 200. A
// request there means a probe left the destinations this run watches, and the
// step fails for it instead of reading that answer as the stub's.
const TRIPWIRE = String.raw`"use strict";
const http = require("http");
const port = Number(process.argv[1]);
const server = http.createServer((req, res) => {
  console.log("request " + req.method + " " + req.url);
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

/**
 * Start a tripwire on a loopback port as a child of the sandbox (its own
 * owned group, recorded, stopped by the caller with `stopServer`), and wait
 * until it listens there. Returns `{ handle, bound, pid, error }`: a port held
 * by another process, a child that exited, or a listener that never appeared
 * is `bound: false` with `error` saying so — nothing of this run is signalled
 * but its own child.
 */
async function startTripwire(sandbox, port, name) {
  const handle = sandbox.start(
    process.execPath,
    ["-e", TRIPWIRE, String(port)],
    { cwd: sandbox.root, name },
  );
  await handle.ready;
  const pid = handle.pid;
  if (pid === undefined)
    return { handle, bound: false, error: "the tripwire did not spawn" };
  let foreign = [];
  const settled = await waitFor(() => {
    if (handle.exited) return true;
    const listener = sandbox.listenerState(port, pid);
    if (listener.state === "foreign") foreign = listener.pids;
    return listener.state !== "none";
  }, 15_000);
  if (foreign.length)
    return {
      handle,
      bound: false,
      error: `port ${port} is held by another process (listeners ${foreign.join(", ")})`,
    };
  if (!settled || handle.exited)
    return {
      handle,
      bound: false,
      error: handle.exited
        ? `the tripwire exited before binding port ${port}`
        : `port ${port} was not bound by the tripwire`,
    };
  return { handle, bound: true, pid };
}

/** The requests a bound tripwire recorded (its own log file, never a link). */
const tripwireRequests = (sandbox, handle) =>
  (sandbox.readFile(handle.logFile, "utf8") ?? "")
    .split("\n")
    .filter((line) => line.startsWith("request "));

export async function stageA(context) {
  try {
    await stageABody(context);
  } catch (error) {
    // A refused file operation (PathRefused) is caught by the entry script,
    // which reports it once and ends the run with exit status 2.
    if (!(error instanceof Refused)) throw error;
    context.refused = true;
  }
}

async function stageABody({ sandbox, report, notebook, options }) {
  const nb = path.join(sandbox.root, "nb");
  const frontend = path.join(nb, "frontend");

  // Clone and resolve the two revisions to commits.
  const revision = await cloneRevision({
    sandbox,
    report,
    notebook,
    nb,
    ref: options.ref,
    base: options.base,
  });
  if (!revision) return;
  const { git, candidate, base } = revision;

  // The revision decides what <clone> holds: a tracked symlink at any path
  // this stage writes to, or a dotenv file, refuses the stage before any
  // copy, build or launch.
  const { refuseUnsafeClone } = cloneGuards({ sandbox, report, nb });
  refuseUnsafeStart({ nb, refuseUnsafeClone, report });

  // Modules: the source checkout's installed modules must match the revision.
  if (!(await copyModules({ sandbox, report, notebook, nb, git, candidate })))
    return;

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
    const forbidden = dependencyManifests(changed);
    for (const file of changed) report.info(`changed: ${file}`);
    report.check(
      "A1 no new dependency",
      forbidden.length === 0,
      forbidden.join(", "),
    );
  }

  const build = makeBuild({ sandbox, report, nb, refuseUnsafeClone });
  const cleanNext = () => removeNext(sandbox, frontend);

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
    // R11-1: the server is started only from a build whose own manifest
    // sends its requests where this run watches. A revision that ignores
    // BACKEND_PROXY_TARGET keeps its default (the developer's backend on
    // 8000); `next start` reads the destinations from the build, so nothing
    // of that build is started or probed — the mismatch above is the failure.
    const a2Rules = expectRewrites(
      report,
      "A2 default rewrites are exactly today's two",
      readManifest(frontend, sandbox.readFile),
      today,
    );
    if (!a2Rules)
      report.note(
        "A2 build not started: its rewrites are not this run's backend target",
      );
    else {
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
          // Every probe goes through the ownership gate (R8-2): a port that
          // changed hands stops the loop before another request is sent.
          const get = ownershipGate(sandbox, web, server.pid);
          try {
            for (const route of ["/canvas", "/canvas/editor"]) {
              const res = await get(route);
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
          } catch (error) {
            if (!(error instanceof OwnershipLost)) throw error;
            report.fail(
              "A2 next start owned its port before every probe",
              error.message,
            );
          }
        }
      } finally {
        await stopServer(sandbox, report, "A2 next start", server.handle);
      }
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
    // A3's table is read here and kept for A4: A4 starts the build A3 made,
    // so the check of the build that will run is this build's own manifest
    // (R11-1), not A2's.
    let manifest;
    if (
      report.check("A3 enabled build exits 0", a3.status === 0, () =>
        tail(a3.output),
      )
    ) {
      manifest = readManifest(frontend, sandbox.readFile);
      expectRewrites(
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
    // Before the server is started or a probe is sent, the manifest of this
    // very build must send every rewrite to one of this run's temporary
    // ports (R11-1). The negative control runs the base revision, whose
    // manifest has the two API rules pointing at the temporary backend and
    // no canvas rules: its destinations are this run's, so the build is
    // started and the transport table fails as planned. A revision that
    // ignores either target variable keeps its own default (port 8000); its
    // server is never started and no probe is sent to it.
    const a4Destinations = manifest
      ? expectDestinations(
          report,
          "A4 every rewrite destination of the build it starts is this run's",
          manifest,
          [backend, target],
        )
      : false;
    // R19-1: the two destinations a rewrite must never use are held by
    // tripwires of this run while A4 starts and probes: the temporary backend
    // (A2's port, where the build's `/api` and `/mcp` rules point) and the
    // runtime canvas target handed to `next start` below. A port another
    // process took would otherwise receive a forwarded probe — a bad rewrite
    // would reach it while the frontend's ownership check still passed, and
    // an answer from it could stand in for the stub's. The tripwires are
    // children of the sandbox like the stub, stopped in the finally.
    if (a4Destinations) {
      const web = await sandbox.freePort();
      const wrong = await sandbox.freePort();
      const destinations = [
        ["the temporary backend", apiPort],
        ["the runtime canvas target", wrong],
      ];
      const tripwires = [];
      let probed = false;
      try {
        for (const [kind, port] of destinations)
          tripwires.push({
            kind,
            port,
            ...(await startTripwire(sandbox, port, `a4-tripwire-${port}`)),
          });
        const unbound = tripwires.filter((tripwire) => !tripwire.bound);
        if (unbound.length) {
          for (const tripwire of unbound)
            report.fail(
              `A4 the tripwire on ${tripwire.kind} is bound (port ${tripwire.port})`,
              tripwire.error,
            );
          report.fail(
            "A4 real build passes the transport table",
            "a tripwire could not be bound, so a probe could reach another process; nothing started",
          );
        } else {
          const server = await startNext(sandbox, {
            dir: frontend,
            port: web,
            env: sandbox.env({
              CANVAS_PROXY_TARGET: `http://127.0.0.1:${wrong}`,
            }),
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
              probed = true;
              await transportAssertions({
                nextPort: web,
                stub,
                report,
                prefix: "A4 ",
                owner: () => sandbox.listenerState(web, server.pid),
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
        }
      } finally {
        for (const tripwire of tripwires) {
          // A request here is a probe that left the destinations this run
          // watches; the answer it got is never read as the stub's.
          if (tripwire.bound && probed) {
            const requests = tripwireRequests(sandbox, tripwire.handle);
            report.check(
              `A4 no request reached ${tripwire.kind} (port ${tripwire.port})`,
              requests.length === 0,
              `${requests.length} request(s): ${JSON.stringify(requests.slice(0, 5))}`,
            );
          }
          await stopServer(
            sandbox,
            report,
            `A4 tripwire on ${tripwire.kind}`,
            tripwire.handle,
          );
        }
      }
    } else
      report.fail(
        "A4 real build passes the transport table",
        manifest
          ? "the build's rewrite destinations are not this run's temporary ports; nothing started"
          : "no enabled build to start",
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
  // R11-1: the launcher runs `next start` from this very build, and `next
  // start` forwards `/api/*` to the destination frozen in the manifest — not
  // the temporary backend the ownership gate below watches. A revision that
  // ignores BACKEND_PROXY_TARGET keeps its default (the developer's backend
  // on 8000); the mismatch is reported here and nothing is launched or probed
  // from that build.
  const a6Manifest = readManifest(frontend, sandbox.readFile);
  const a6Rules = expectRewrites(
    report,
    "A6 rewrites equal today's two",
    a6Manifest,
    todaysRules(backend),
  );
  const a6Destinations = expectDestinations(
    report,
    "A6 every rewrite destination is the temporary backend",
    a6Manifest,
    [backend],
  );
  if (!a6Rules || !a6Destinations) {
    report.note(
      "A6 the clone was not launched: its build does not forward to this run's backend",
    );
    return;
  }

  // The launcher writes logs and the database under <clone>/.local: it must be
  // a real directory inside the sandbox, created here when the revision has
  // none, so the launcher can never be handed a symlink.
  const local = path.join(nb, ".local");
  refuseUnsafeClone(
    "A6 <clone>/.local is safe before the launch",
    [nb, local],
    "built",
  );
  // Validated creation (an existing real directory is left as it is; the
  // launch check below requires it empty).
  makeLocal(sandbox, nb);
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
  // The services the launcher reported are kept for the check after
  // shutdown (stopLaunch).
  const launch = { launcher, services: [] };
  try {
    const up = await awaitLaunch({
      sandbox,
      report,
      label: "A6",
      nb,
      launch,
      apiPort,
      webPort,
    });
    if (!up) return;
    const {
      frontendPid,
      getWeb,
      getApi,
      getProxied,
      send,
      ownership,
      bothOwned,
      describeOwnership,
    } = up;
    let seen;

    // The safety property comes first. The frontend listens on every
    // interface (the launcher gives `next start` no -H, and `next start`
    // reads no variable for its host), so without a session the clone must
    // answer 401, through the frontend and on the backend port. The frontend
    // request is proxied to the backend, so both listeners are checked
    // immediately before it (R9-2). On failure A6 stops here and the finally
    // below stops the services.
    let unauthenticated;
    try {
      unauthenticated = [
        await send(getProxied, "/api/health"),
        await send(getApi, "/api/health"),
      ];
    } catch (error) {
      if (!(error instanceof OwnershipLost)) throw error;
      return void report.fail(
        "A6 both ports owned before every probe after readiness",
        error.message,
      );
    }
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

    let home;
    let canvas;
    try {
      home = await send(getWeb, "/");
      canvas = await send(getWeb, "/canvas");
    } catch (error) {
      if (!(error instanceof OwnershipLost)) throw error;
      return void report.fail(
        "A6 both ports owned before every probe after readiness",
        error.message,
      );
    }
    report.check(
      "A6 GET / -> 200 through the frontend",
      home.status === 200,
      `status ${home.status}`,
    );
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
    const head = (sandbox.readFile(backendLog, "utf8") ?? "")
      .split("\n")
      .slice(0, 40)
      .join("\n");
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
    await stopLaunch({ sandbox, report, label: "A6", launch });
  }
}

// Shared steps of the notebook integration check: the offline control, the
// Next build/start helpers and the source-checkout observation.
import { spawnSync } from "node:child_process";
import path from "node:path";

import { waitForWithin } from "./sandbox.mjs";
import { OwnershipLost, rawRequest } from "./transport.mjs";

export { OwnershipLost };

export const tail = (text, lines = 25) =>
  text.trimEnd().split("\n").slice(-lines).join("\n");

// The ways a Node child of this toolchain reaches the network: the
// global fetch, http.get / https.get with their default agents (which
// hand Socket.prototype.connect `path: null`) and a direct socket.connect.
// Each child exits 0 only when
// the request failed with the guard's own refusal (a timeout is exit 4).
const REFUSED =
  "const refused=(e)=>process.exit(/offline guard refused/.test(String(e&&e.cause&&e.cause.message)+String(e&&e.message))?0:4);";
const OFFLINE_PROBES = [
  [
    "fetch",
    REFUSED +
      'fetch("http://192.0.2.1:49152/",{signal:AbortSignal.timeout(3000)})' +
      ".then(()=>process.exit(3),refused)",
  ],
  ...["http", "https"].map((scheme) => [
    `${scheme}.get`,
    REFUSED +
      `const q=require("${scheme}").get("${scheme}://192.0.2.1:49152/",{timeout:3000},()=>process.exit(3));` +
      'q.on("timeout",()=>q.destroy(new Error("timeout")));q.on("error",refused)',
  ]),
  // The direct signature with a port string Node coerces (whitespace around
  // the digits): Node connects to that port, so the guard must see a port.
  [
    "socket.connect",
    REFUSED +
      'const s=new (require("net").Socket)();s.setTimeout(3000,()=>s.destroy(new Error("timeout")));' +
      's.on("error",refused);s.on("connect",()=>process.exit(3));s.connect(" 49152 ","192.0.2.1")',
  ],
];

/**
 * The offline guard must be active before anything is trusted: each
 * mechanism is refused and appears in its own private log.
 */
export async function offlineControl(sandbox, report) {
  let allOk = true;
  for (const [mechanism, code] of OFFLINE_PROBES) {
    const slug = mechanism.replace(".", "-");
    const log = path.join(sandbox.root, `control-offline-${slug}.log`);
    const result = await sandbox.run(process.execPath, ["-e", code], {
      name: `offline-control-${slug}`,
      env: sandbox.env({ NB_CHECK_OFFLINE_LOG: log }),
      timeoutMs: 30_000,
    });
    const name = `offline guard active (${mechanism})`;
    // A group that outlived its shutdown ends the stage (R9-1).
    checkStopped(report, name, result.pgid, result.gone);
    const ok = report.check(
      name,
      result.status === 0 && refusedOnly(sandbox, log),
      () =>
        `exit ${result.status}, log ${JSON.stringify(readLines(sandbox, log))}\n${tail(result.output, 5)}`,
    );
    allOk = allOk && ok;
  }
  for (const control of NPM_CONTROLS) {
    const ok = await npmLifecycleControl(sandbox, report, control);
    allOk = allOk && ok;
  }
  return allOk;
}

const readLines = (sandbox, log) => {
  const text = sandbox.readFile(log, "utf8");
  return text === undefined ? [] : text.trim().split("\n");
};

/** The log holds the probe's refused connection and nothing else. */
const refusedOnly = (sandbox, log) => {
  const lines = readLines(sandbox, log);
  return lines.length > 0 && lines.every((line) => line === "192.0.2.1 49152");
};

// The probe a lifecycle script runs: a direct connection to TEST-NET-1
// (192.0.2.1, never routed), exit 0 only for the guard's own refusal.
const LIFECYCLE_PROBE =
  REFUSED +
  'const s=new (require("net").Socket)();s.setTimeout(3000,()=>s.destroy(new Error("timeout")));' +
  's.on("error",refused);s.on("connect",()=>process.exit(3));s.connect(49152,"192.0.2.1");\n';

const packageJson = (scripts) =>
  `${JSON.stringify({ name: "nb-check-control", private: true, scripts })}\n`;

/**
 * The ways a revision's npm configuration could take the preload away from a
 * lifecycle script, each as a throwaway package (R6-1): a project .npmrc
 * node-options (npm sets NODE_OPTIONS from it), the same in a nested package
 * run by an inner npm (like frontend/.npmrc under the root's scripts), a
 * project .npmrc script-shell pointing at a wrapper that drops NODE_OPTIONS,
 * and npm exec (npx) under a project node-options.
 */
const NPM_CONTROLS = [
  {
    name: "npm run, project .npmrc node-options",
    files: {
      "package.json": packageJson({ probe: "node probe.cjs" }),
      ".npmrc": "node-options=--dns-result-order=ipv4first\n",
      "probe.cjs": LIFECYCLE_PROBE,
    },
    args: ["run", "--silent", "probe"],
  },
  {
    name: "npm run, nested package .npmrc node-options",
    files: {
      "package.json": packageJson({
        probe: "cd sub && npm run --silent probe",
      }),
      "sub/package.json": packageJson({ probe: "node probe.cjs" }),
      "sub/.npmrc": "node-options=--dns-result-order=ipv4first\n",
      "sub/probe.cjs": LIFECYCLE_PROBE,
    },
    args: ["run", "--silent", "probe"],
  },
  {
    name: "npm run, project .npmrc script-shell",
    files: {
      "package.json": packageJson({ probe: "node probe.cjs" }),
      ".npmrc": "script-shell=./drop-node-options.sh\n",
      "drop-node-options.sh":
        '#!/bin/sh\nunset NODE_OPTIONS\nexec /bin/sh "$@"\n',
      "probe.cjs": LIFECYCLE_PROBE,
    },
    args: ["run", "--silent", "probe"],
  },
  {
    name: "npm exec, project .npmrc node-options",
    files: {
      "package.json": packageJson({}),
      ".npmrc": "node-options=--dns-result-order=ipv4first\n",
      "probe.cjs": LIFECYCLE_PROBE,
    },
    args: ["exec", "--call", "node probe.cjs"],
  },
];

/** Write a throwaway package under the sandbox; returns its directory. */
export function writePackage(sandbox, slug, files) {
  const dir = path.join(sandbox.root, "controls", slug);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    // Validated creation and write (R8-1): a link planted at either path is
    // refused instead of followed.
    sandbox.makeDir(path.dirname(file), { recursive: true });
    sandbox.writeFile(file, content, relative.endsWith(".sh") ? 0o755 : 0o644);
  }
  return dir;
}

/** The probe process loaded the guard (its argv names the probe file). */
const ranScript = (file) => (entry) =>
  typeof entry.argv?.[1] === "string" && path.basename(entry.argv[1]) === file;

async function npmLifecycleControl(sandbox, report, control) {
  const slug = control.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const dir = writePackage(sandbox, slug, control.files);
  const log = path.join(sandbox.root, `control-offline-${slug}.log`);
  const mark = sandbox.guardMark();
  const result = await sandbox.run("npm", control.args, {
    cwd: dir,
    name: `offline-control-${slug}`,
    env: sandbox.env({ NB_CHECK_OFFLINE_LOG: log }),
    timeoutMs: 60_000,
  });
  const name = `offline guard survives npm (${control.name})`;
  checkStopped(report, name, result.pgid, result.gone);
  const guarded = sandbox.guardedSince(mark).some(ranScript("probe.cjs"));
  const ok = report.check(
    name,
    result.status === 0 && refusedOnly(sandbox, log) && guarded,
    () =>
      `exit ${result.status}, log ${JSON.stringify(readLines(sandbox, log))}, probe in the guard marker: ${guarded}\n${tail(result.output, 5)}`,
  );
  return ok;
}

/** A guard-marker entry for `next <subcommand>` (the bin, however reached). */
export const nextCommand = (subcommand) => (entry) =>
  Array.isArray(entry.argv) &&
  typeof entry.argv[1] === "string" &&
  path.basename(entry.argv[1]) === "next" &&
  entry.argv.slice(2).includes(subcommand);

/**
 * The positive proof that a step's real work ran guarded: a process matching
 * `match` recorded the guard in the marker log since `mark`. An absent guard
 * is a FAIL, never a silent pass of the offline verdict.
 */
export function guardLoaded(sandbox, report, name, mark, match) {
  const entries = sandbox.guardedSince(mark);
  return report.check(
    name,
    entries.some(match),
    () =>
      `no matching process in the guard marker; guarded since the step began: ${
        entries
          .map((entry) => `${entry.pid} ${entry.argv?.slice(1).join(" ")}`)
          .join(" | ") || "none"
      }`,
  );
}

export function offlineVerdict(sandbox, report) {
  const content = (sandbox.readFile(sandbox.offlineLog, "utf8") ?? "").trim();
  report.check("no outbound connection attempted", content === "", content);
}

/** Observation of the source checkout; prevention is done elsewhere. */
export function observeSource(sandbox, report, notebook) {
  // A traversal error is a non-zero exit or anything on stderr: find may warn
  // about an unreadable directory and still exit 0, and the scan is then
  // incomplete.
  const find = (args) => {
    const result = spawnSync("find", args, {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) return { error: result.error.message };
    const stderr = (result.stderr ?? "").trim();
    if (result.status !== 0 || stderr)
      return {
        error: `find exited ${result.status ?? result.signal}: ${tail(stderr, 5) || "(no stderr)"}`,
      };
    return { out: result.stdout.split("\n").filter(Boolean) };
  };
  const modules = path.join(notebook, "frontend", "node_modules");
  const inside = find([modules, "-newer", sandbox.marker]);
  if (inside.error)
    report.fail("no newer entries under the source node_modules", inside.error);
  else {
    // Test runners keep caches here (.vite, .vite-temp, .cache), and the owner
    // or another session may run them at any time; this script never does.
    // Those are notes. Anything else under node_modules is what an install or
    // a downloaded binding would write, and that fails.
    // The directory's own timestamp changes when a cache directory is created
    // in it, so by itself it says nothing either.
    const cache = (file) => {
      const relative = path.relative(modules, file);
      return (
        relative === "" || /^\.(?:vite|vite-temp|cache)(?:\/|$)/.test(relative)
      );
    };
    const packages = inside.out.filter((file) => !cache(file));
    report.check(
      "no newer entries under the source node_modules",
      packages.length === 0,
      `${packages.length} newer: ${packages.slice(0, 10).join(", ")}`,
    );
    for (const file of inside.out.filter(cache).slice(0, 5))
      report.note(`newer tool cache in the source node_modules: ${file}`);
  }
  const elsewhere = find([
    notebook,
    "-path",
    path.join(notebook, ".git"),
    "-prune",
    "-o",
    "-path",
    path.join(notebook, ".local"),
    "-prune",
    "-o",
    "-path",
    path.join(notebook, ".env"),
    "-prune",
    "-o",
    "-path",
    modules,
    "-prune",
    "-o",
    "-newer",
    sandbox.marker,
    "-print",
  ]);
  if (elsewhere.error)
    report.fail("scan of the rest of the source checkout", elsewhere.error);
  else
    for (const file of elsewhere.out.slice(0, 10))
      report.note(`newer in source checkout: ${file}`);
}

/**
 * Start `next start` as a direct child and trust it only once it owns the
 * port. Another pid on the port fails at once (it is never signalled), and
 * ownership is checked again before every readiness request and right after
 * the readiness answer.
 *
 * Both waits share one limit (`timeoutMs`, the stage's 60 s; a control passes
 * a smaller one). Each listener enumeration is bounded by the time its wait
 * has left, and the readiness request is issued only with what is left after
 * the enumeration (R19-2, the R11-3 shape): a slow `lsof` is a failure within
 * the limit, and a request never outlives it.
 */
export async function startNext(
  sandbox,
  { dir, port, env, name, marker, timeoutMs = 60_000 },
) {
  const bin = path.join(dir, "node_modules/next/dist/bin/next");
  const mark = sandbox.guardMark();
  const handle = sandbox.start(
    process.execPath,
    [bin, "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: dir,
      env,
      name,
    },
  );
  await handle.ready;
  const pid = handle.pid;
  const fail = (detail) => ({
    handle,
    error: `${detail}\n${tail(sandbox.readFile(handle.logFile, "utf8") ?? "")}`,
  });
  if (pid === undefined) return fail("next start did not spawn");
  const enumerationFailed = (error) =>
    fail(
      `the listener check for port ${port} did not finish within the ` +
        `${timeoutMs} ms its wait had: ${error.message}`,
    );
  let foreign;
  let listenerError;
  const settled = await waitForWithin((remaining) => {
    if (handle.exited) return true;
    let listener;
    try {
      listener = sandbox.listenerState(port, pid, { timeoutMs: remaining });
    } catch (error) {
      listenerError = error;
      return true;
    }
    if (listener.state === "foreign") foreign = listener.pids;
    return listener.state !== "none";
  }, timeoutMs);
  if (listenerError) return enumerationFailed(listenerError);
  if (foreign)
    return fail(
      `port ${port} is held by another process (listeners ${foreign.join(", ")}; want ${pid})`,
    );
  if (!settled || handle.exited) {
    return fail(
      handle.exited
        ? "next start exited"
        : `port ${port} is not owned by pid ${pid} (no listener)`,
    );
  }
  // Ownership is established now; each readiness request is sent only while
  // it still holds (another pid, or no listener any more, fails at once).
  // Each probe is capped at the time the loop has left and the deadline holds
  // after it (R9-3), so a stalled server cannot stretch the limit or have a
  // late success accepted. The listener enumeration takes its budget from the
  // same clock (R19-2): the time is recomputed after it, and a check that used
  // up what was left means the request is not sent at all.
  let lost;
  let exhausted;
  const home = await waitForWithin(async (remaining) => {
    const started = Date.now();
    let now;
    try {
      now = sandbox.listenerState(port, pid, { timeoutMs: remaining });
    } catch (error) {
      listenerError = error;
      return true;
    }
    if (now.state !== "owned") {
      lost = now;
      return true;
    }
    const left = remaining - (Date.now() - started);
    if (left <= 0) {
      exhausted = `the listener check used the whole ${remaining} ms the readiness wait had left`;
      return true;
    }
    try {
      const res = await rawRequest(port, "/", "GET", Math.min(left, 30_000));
      return res.status === 200 ? res : false;
    } catch {
      return false;
    }
  }, timeoutMs);
  if (listenerError) return enumerationFailed(listenerError);
  if (exhausted)
    return fail(`${exhausted} before GET / (nothing sent to port ${port})`);
  if (lost)
    return fail(
      `port ${port} changed owner during readiness (${lost.state}, listeners ${lost.pids.join(", ") || "none"}; want ${pid})`,
    );
  if (!home) return fail("GET / never answered 200");
  const after = sandbox.listenerState(port, pid);
  if (after.state !== "owned")
    return fail(
      `port ${port} changed owner after the readiness answer (${after.state}, listeners ${after.pids.join(", ") || "none"}; want ${pid})`,
    );
  if (marker && !home.body.includes(marker))
    return fail("GET / lacks the rendered marker");
  // The server that answered must be a guarded process: its own pid is in
  // the guard marker.
  if (!sandbox.guardedSince(mark).some((entry) => entry.pid === pid))
    return fail(`the offline guard was not loaded in next start (pid ${pid})`);
  return { handle, port, pid };
}

/**
 * A step left the stage in a state no later step may run from: a process group
 * survived its shutdown (R9-1), or the private modules copy failed validation
 * (R10-1). The failure is already reported; the stage stops here so no later
 * step acts beside a process of the revision that is still running (stage T
 * would remove `.next` of a live server, stage A would read build output or
 * start another build) or runs from an unvalidated copy.
 */
export class StageAborted extends Error {
  constructor(detail) {
    super(`${detail}; the stage stops`);
  }
}

/** Turns a group that outlived its shutdown into a FAIL for the step, then stops the stage. */
export function checkStopped(report, step, pgid, gone) {
  if (gone) return true;
  report.fail(step, `process group ${pgid} still present`);
  throw new StageAborted(`${step}: process group ${pgid} is still present`);
}

/**
 * Why a command's result says nothing about the command (R6-4): the sandbox
 * stopped it at its timeout, it died by a signal, or it never reported a
 * status. Empty for a command that ended by itself with an exit status.
 */
export function abnormalEnd(result) {
  if (result.timedOut)
    return "did not end by itself: the sandbox stopped it at its timeout";
  if (result.signal) return `ended by signal ${result.signal}`;
  if (!Number.isInteger(result.status) || result.status < 0)
    return `reported no exit status (${result.status})`;
  return "";
}

/** Stop a server's group; a group still present is a FAIL and ends the stage. */
export async function stopServer(sandbox, report, step, handle) {
  if (!handle || handle.pgid === undefined) return true;
  return checkStopped(
    report,
    step,
    handle.pgid,
    await sandbox.stopGroup(handle.pgid),
  );
}

/**
 * Ownership re-check after the last probe of a server: its answers are
 * trusted only if the expected pid owned the port at both ends.
 */
export function ownershipHeld(sandbox, report, name, port, pid) {
  const { state, pids } = sandbox.listenerState(port, pid);
  return report.check(
    name,
    state === "owned",
    `port ${port}: ${state} (listeners ${pids.join(", ") || "none"}; want ${pid})`,
  );
}

/**
 * The one gate every request to a port this run claims goes through (R8-2):
 * ownership is asked immediately before each request, and anything but
 * "owned" throws OwnershipLost (defined in transport.mjs) before it is sent,
 * so a caller stops at the first mismatch and a replacement listener never
 * receives a request. An optional third argument is the budget for the whole
 * call (R11-3): the lsof enumeration is bounded by what is left and the time
 * is recomputed after it, so a slow listener check cannot make the request
 * outlive its deadline. A budget it has used up throws before sending.
 */
export function ownershipGate(sandbox, port, pid) {
  return (rawPath, method, budgetMs, init) => {
    const budget = gateBudget(budgetMs, method, rawPath);
    const { state, pids } = sandbox.listenerState(port, pid, {
      timeoutMs: budget.left(),
    });
    if (state !== "owned")
      throw new OwnershipLost(
        `port ${port} is ${state} (listeners ${pids.join(", ") || "none"}; want ${pid}) before ${method ?? "GET"} ${JSON.stringify(rawPath)}`,
      );
    return rawRequest(port, rawPath, method, budget.left(), init);
  };
}

/**
 * The gate for a request to the frontend that Next forwards to the backend
 * (R9-2, the `/api/:path*` rewrite): both listeners must be owned immediately
 * before it is sent — the frontend's, because the request goes to it, and the
 * backend's, because the frontend proxies it there. Checking only the
 * frontend would let a backend that lost its port receive the request at the
 * replacement. A budget (R11-3) covers both listener enumerations and the
 * request, with the remaining time recomputed after each of them.
 */
export function proxiedGate(sandbox, { webPort, webPid, apiPort, apiPid }) {
  return (rawPath, method, budgetMs, init) => {
    const budget = gateBudget(budgetMs, method, rawPath);
    const web = sandbox.listenerState(webPort, webPid, {
      timeoutMs: budget.left(),
    });
    const api = sandbox.listenerState(apiPort, apiPid, {
      timeoutMs: budget.left(),
    });
    if (web.state !== "owned" || api.state !== "owned")
      throw new OwnershipLost(
        `before ${method ?? "GET"} ${JSON.stringify(rawPath)} (forwarded through the frontend to the backend): ` +
          `web ${webPort} is ${web.state} (listeners ${web.pids.join(", ") || "none"}; want ${webPid}); ` +
          `api ${apiPort} is ${api.state} (listeners ${api.pids.join(", ") || "none"}; want ${apiPid})`,
      );
    return rawRequest(webPort, rawPath, method, budget.left(), init);
  };
}

/**
 * The gate for a request through the frontend's `/canvas` rules (stage M):
 * Next forwards it to the canvas, and the canvas asks the notebook backend
 * who the bearer is, so all three listeners must be the recorded pids
 * immediately before it is sent. `canvasPid: null` requires the canvas port
 * to have no listener at all (a rollback whose rule still points there: a
 * process that took the port would receive the forwarded request). The
 * budget covers the three enumerations and the request, as for
 * `proxiedGate`.
 */
export function tripleGate(
  sandbox,
  { webPort, webPid, apiPort, apiPid, canvasPort, canvasPid },
) {
  return (rawPath, method, budgetMs, init) => {
    const budget = gateBudget(budgetMs, method, rawPath);
    const seen = [
      ["web", webPort, webPid],
      ["api", apiPort, apiPid],
      ["canvas", canvasPort, canvasPid],
    ].map(([name, port, pid]) => {
      const { state, pids } = sandbox.listenerState(port, pid ?? -1, {
        timeoutMs: budget.left(),
      });
      const ok = pid === null ? state === "none" : state === "owned";
      return { name, port, pid, state, pids, ok };
    });
    if (!seen.every((entry) => entry.ok))
      throw new OwnershipLost(
        `before ${method ?? "GET"} ${JSON.stringify(rawPath)} (through the frontend to the canvas and the notebook backend): ` +
          seen
            .map(
              ({ name, port, pid, state, pids }) =>
                `${name} ${port} is ${state} (listeners ${pids.join(", ") || "none"}; want ${pid === null ? "no listener" : pid})`,
            )
            .join("; "),
      );
    return rawRequest(webPort, rawPath, method, budget.left(), init);
  };
}

/**
 * The time a gated request has left. Without a budget every call is
 * unbounded, as before (R11-3 changed only the callers that set one); with
 * one, `left()` is measured from the start of the gate and throws once the
 * listener enumeration has used it up, so the HTTP request never starts
 * without time left.
 */
function gateBudget(budgetMs, method, rawPath) {
  if (budgetMs === undefined) return { left: () => undefined };
  const started = Date.now();
  return {
    left() {
      const remaining = budgetMs - (Date.now() - started);
      if (remaining <= 0)
        throw new Error(
          `the listener check used the whole ${budgetMs} ms budget before ${method ?? "GET"} ${JSON.stringify(rawPath)} (nothing sent)`,
        );
      return remaining;
    },
  };
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * Wait until each port is listened on by exactly the service the launcher
 * reported. Ends at once when another pid holds a port (never signalled) or a
 * reported service has exited, whichever happens first; otherwise at the
 * timeout. Returns `{ ok, seen, reason }`.
 *
 * The two listener enumerations of a poll take their budgets from the time the
 * wait has left, with the time recomputed between them (R19-2): a slow `lsof`
 * is a failure at the limit (`reason` says so, `ok` is false) instead of a
 * block that outlives it.
 */
export async function awaitOwnership(
  sandbox,
  { apiPort, webPort, backendPid, frontendPid, timeoutMs = 120_000 },
) {
  const state = (remaining) => {
    const started = Date.now();
    const left = () => {
      const value = remaining - (Date.now() - started);
      if (value <= 0)
        throw new Error(
          `the listener checks used the whole ${remaining} ms the ownership wait had`,
        );
      return value;
    };
    const api = sandbox.listenerState(apiPort, backendPid, {
      timeoutMs: left(),
    });
    const web = sandbox.listenerState(webPort, frontendPid, {
      timeoutMs: left(),
    });
    return { api, web };
  };
  let seen = {
    api: { state: "none", pids: [] },
    web: { state: "none", pids: [] },
  };
  let reason = "";
  let listenerError;
  await waitForWithin(
    (remaining) => {
      try {
        seen = state(remaining);
      } catch (error) {
        listenerError = error;
        return true;
      }
      if (seen.api.state === "owned" && seen.web.state === "owned") return true;
      if (seen.api.state === "foreign" || seen.web.state === "foreign") {
        reason = "another process holds a port";
        return true;
      }
      const dead = [
        ["backend", backendPid],
        ["frontend", frontendPid],
      ].filter(([, pid]) => !pidAlive(pid));
      if (dead.length) {
        reason = `${dead.map(([name, pid]) => `${name} pid ${pid}`).join(", ")} exited before binding its port`;
        return true;
      }
      return false;
    },
    timeoutMs,
    500,
  );
  if (listenerError)
    return {
      ok: false,
      seen,
      reason: `the listener checks did not finish within ${timeoutMs} ms: ${listenerError.message}`,
    };
  return {
    ok: seen.api.state === "owned" && seen.web.state === "owned",
    seen,
    reason,
  };
}

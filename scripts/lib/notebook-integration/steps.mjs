// Shared steps of the notebook integration check: the offline control, the
// Next build/start helpers and the source-checkout observation.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { waitFor } from "./sandbox.mjs";
import { rawRequest } from "./transport.mjs";

export const tail = (text, lines = 25) =>
  text.trimEnd().split("\n").slice(-lines).join("\n");

// The three ways a Node child of this toolchain reaches the network: the
// global fetch, and http.get / https.get with their default agents (which
// hand Socket.prototype.connect `path: null`). Each child exits 0 only when
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
    const stopped = checkStopped(report, name, result.pgid, result.gone);
    const lines = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n")
      : [];
    const logged =
      lines.length > 0 && lines.every((line) => line === "192.0.2.1 49152");
    const ok = report.check(
      name,
      result.status === 0 && logged,
      `exit ${result.status}, log ${JSON.stringify(lines)}\n${tail(result.output, 5)}`,
    );
    allOk = allOk && ok && stopped;
  }
  return allOk;
}

export function offlineVerdict(sandbox, report) {
  const content = fs.existsSync(sandbox.offlineLog)
    ? fs.readFileSync(sandbox.offlineLog, "utf8").trim()
    : "";
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
 * ownership is checked again right after the readiness answer.
 */
export async function startNext(sandbox, { dir, port, env, name, marker }) {
  const bin = path.join(dir, "node_modules/next/dist/bin/next");
  const handle = sandbox.start(
    process.execPath,
    [bin, "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: dir,
      env,
      name,
    },
  );
  const pid = handle.child.pid;
  const fail = (detail) => ({
    handle,
    error: `${detail}\n${tail(fs.readFileSync(handle.logFile, "utf8"))}`,
  });
  let foreign;
  const settled = await waitFor(() => {
    if (handle.exited) return true;
    const listener = sandbox.listenerState(port, pid);
    if (listener.state === "foreign") foreign = listener.pids;
    return listener.state !== "none";
  }, 60_000);
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
  const home = await waitFor(async () => {
    try {
      const res = await rawRequest(port, "/");
      return res.status === 200 ? res : false;
    } catch {
      return false;
    }
  }, 60_000);
  if (!home) return fail("GET / never answered 200");
  const after = sandbox.listenerState(port, pid);
  if (after.state !== "owned")
    return fail(
      `port ${port} changed owner after the readiness answer (${after.state}, listeners ${after.pids.join(", ") || "none"}; want ${pid})`,
    );
  if (marker && !home.body.includes(marker))
    return fail("GET / lacks the rendered marker");
  return { handle, port, pid };
}

/** Turns a group that outlived its shutdown into a FAIL for the step. */
export function checkStopped(report, step, pgid, gone) {
  if (!gone) report.fail(step, `process group ${pgid} still present`);
  return gone;
}

/** Stop a server's group and report a group that is still present. */
export async function stopServer(sandbox, report, step, handle) {
  if (!handle || handle.child.pid === undefined) return true;
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

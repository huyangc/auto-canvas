// Shared steps of the notebook integration check: the offline control, the
// Next build/start helpers and the source-checkout observation.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { waitFor } from "./sandbox.mjs";
import { rawRequest } from "./transport.mjs";

export const tail = (text, lines = 25) =>
  text.trimEnd().split("\n").slice(-lines).join("\n");

/** The offline guard must be active before anything is trusted. */
export async function offlineControl(sandbox, report) {
  const log = path.join(sandbox.root, "control-offline.log");
  const code =
    'fetch("http://192.0.2.1:49152/",{signal:AbortSignal.timeout(3000)})' +
    ".then(()=>process.exit(3),()=>process.exit(0))";
  const result = await sandbox.run(process.execPath, ["-e", code], {
    name: "offline-control",
    env: sandbox.env({ NB_CHECK_OFFLINE_LOG: log }),
    timeoutMs: 30_000,
  });
  const lines = fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").trim().split("\n")
    : [];
  const logged =
    lines.length > 0 && lines.every((line) => line === "192.0.2.1 49152");
  return report.check(
    "offline guard active",
    result.status === 0 && logged,
    `exit ${result.status}, log ${JSON.stringify(lines)}\n${tail(result.output, 5)}`,
  );
}

export function offlineVerdict(sandbox, report) {
  const content = fs.existsSync(sandbox.offlineLog)
    ? fs.readFileSync(sandbox.offlineLog, "utf8").trim()
    : "";
  report.check("no outbound connection attempted", content === "", content);
}

/** Observation of the source checkout; prevention is done elsewhere. */
export function observeSource(sandbox, report, notebook) {
  const find = (args) => {
    try {
      const out = execFileSync("find", args, {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return { out: out.split("\n").filter(Boolean) };
    } catch (error) {
      return { error: `${error.message}` };
    }
  };
  const modules = path.join(notebook, "frontend", "node_modules");
  const inside = find([modules, "-newer", sandbox.marker]);
  if (inside.error)
    report.fail("no newer entries under the source node_modules", inside.error);
  else
    report.check(
      "no newer entries under the source node_modules",
      inside.out.length === 0,
      `${inside.out.length} newer: ${inside.out.slice(0, 10).join(", ")}`,
    );
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

/** Start `next start` as a direct child and trust it only once it owns the port. */
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
  const fail = (detail) => ({
    handle,
    error: `${detail}\n${tail(fs.readFileSync(handle.logFile, "utf8"))}`,
  });
  const owned = await waitFor(
    () => !handle.exited && sandbox.listenerIs(port, handle.child.pid),
    60_000,
  );
  if (!owned) {
    return fail(
      handle.exited
        ? "next start exited"
        : `port ${port} is not owned by pid ${handle.child.pid} (listeners ${sandbox.listenerPids(port)})`,
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
  if (marker && !home.body.includes(marker))
    return fail("GET / lacks the rendered marker");
  return { handle, port };
}

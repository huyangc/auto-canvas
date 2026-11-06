// Supervises the editor dev server for scripts/dev.sh.
//
// The editor runs in its own process group (pnpm, then Vite and its workers).
// A terminal signal is forwarded to the whole group; if the group has not
// exited within STOP_TIMEOUT seconds, the supervisor sends SIGKILL to the
// group itself. The launcher's own SIGKILL can only reach this supervisor, so
// the escalation has to happen here, slightly before the launcher's deadline.
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: editor-supervisor.mjs <command> [args...]");
  process.exit(2);
}
const graceSeconds = Number(process.env.STOP_TIMEOUT ?? "10");
const graceMs = Math.max(0, graceSeconds * 1000 - 500);

const child = spawn(command, args, {
  detached: true,
  stdio: "inherit",
  env: process.env,
});
let stopping = false;
const killGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    killGroup(signal);
    if (stopping) return;
    stopping = true;
    setTimeout(() => killGroup("SIGKILL"), graceMs).unref();
  });
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  // During shutdown, members that outlived the group leader go with it.
  if (stopping) killGroup("SIGKILL");
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});

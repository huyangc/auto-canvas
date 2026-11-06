#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

launcher_config
launcher_prerequisites
launcher_port_free
launcher_traps
launcher_database
pnpm --filter @icm/server... build
# Development serves the editor through Vite, including HTTP/WebSocket proxying.
unset EDITOR_ROOT
launcher_start_server .local/logs/server-dev.log
export AUTO_CANVAS_API_URL=${AUTO_CANVAS_API_URL:-$launcher_url}
echo "auto-canvas API is ready at $launcher_url. Starting Vite; Ctrl+C stops both."
# A small supervisor preserves Vite's exit status and forwards cleanup signals
# to its whole process group, including the pnpm wrapper.
node -e '
  const { spawn } = require("node:child_process");
  const child = spawn("pnpm", ["dev:editor"], {
    detached: true, stdio: "inherit", env: process.env,
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      try { process.kill(-child.pid, signal); } catch {}
    });
  }
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
' &
launcher_editor_pid=$!
wait "$launcher_editor_pid"

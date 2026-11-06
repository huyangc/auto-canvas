#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

launcher_config
launcher_prerequisites
launcher_base_path
launcher_port_free
launcher_traps
launcher_database
pnpm --filter @icm/server... build
# Development serves the editor through Vite, including HTTP/WebSocket proxying.
unset EDITOR_ROOT
launcher_start_server .local/logs/server-dev.log
export AUTO_CANVAS_API_URL=${AUTO_CANVAS_API_URL:-$launcher_origin}
echo "auto-canvas API is ready at $launcher_url. Starting Vite; Ctrl+C stops both."
# The supervisor preserves Vite's exit status, forwards cleanup signals to its
# whole process group and escalates to SIGKILL on that group after STOP_TIMEOUT.
STOP_TIMEOUT="$STOP_TIMEOUT" node "$(dirname "${BASH_SOURCE[0]}")/lib/editor-supervisor.mjs" pnpm dev:editor &
launcher_editor_pid=$!
wait "$launcher_editor_pid"

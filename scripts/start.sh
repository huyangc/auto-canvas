#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

launcher_config
launcher_prerequisites
launcher_port_free
launcher_traps
launcher_database
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  pnpm build
fi
export EDITOR_ROOT=apps/editor/dist
launcher_start_server .local/logs/server.log
echo "auto-canvas is ready at $launcher_url"
echo 'Stop with pnpm stop (or npm run stop). Logs: .local/logs/server.log'
# Transfer ownership to the user only after readiness has been confirmed.
launcher_server_pid=

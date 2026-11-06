#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

launcher_config
launcher_listeners
if [[ -z "$launcher_listener_description" ]]; then
  echo "auto-canvas is not running on port $PORT."
  exit 0
fi
if [[ -z "$launcher_listener_pids" ]]; then
  launcher_error "Port $PORT is in use, but its process is hidden. Run lsof/ss as the process owner:
$launcher_listener_description"
  exit 1
fi
echo "Stopping listeners on port $PORT: $launcher_listener_pids"
for pid in $launcher_listener_pids; do
  launcher_terminate "$pid"
done
launcher_port_free
echo 'auto-canvas stopped.'

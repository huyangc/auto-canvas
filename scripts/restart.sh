#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

# Everything that can fail without touching the running server happens first:
# a failed prerequisite, database check or build leaves it serving.
launcher_config
launcher_prerequisites
launcher_base_path
launcher_database
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  pnpm build
fi
bash "$launcher_root/scripts/stop.sh"
# The build above is the one to serve.
SKIP_BUILD=1 exec bash "$launcher_root/scripts/start.sh"

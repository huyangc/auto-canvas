#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/launcher.sh"

# Everything that can fail happens before the running server is stopped, so
# its process and API stay up through a failed check or build. The build does
# rewrite the editor files that server reads per request: pages may fail to
# load while it runs, and stay incomplete after a failed build until the next
# successful one.
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

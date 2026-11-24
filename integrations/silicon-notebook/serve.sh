#!/usr/bin/env bash
# Starts the canvas in the foreground as a silicon-notebook companion service:
# notebook mode under /canvas on 127.0.0.1, serving only an existing canvas
# database that is not the one silicon-notebook's .env names. It takes no
# options and never initialises a database (that is init-db.sh).
# Requires Bash 3.2+ (including macOS). See README.md in this directory.
# Tracing (bash -x, or an inherited SHELLOPTS=xtrace) would print the
# database URLs below, passwords included: off before anything expands.
set +x
set -euo pipefail
# An inherited BASHOPTS can turn nocasematch on; the checks below compare
# the spelling of variable names and must stay case-sensitive.
shopt -u nocasematch

fail() {
  printf 'auto-canvas serve.sh: %s\n' "$1" >&2
  exit 2
}

# 1. Required variables, and nothing that could make silicon-notebook read
#    another database than the one its .env names.
for name in AUTO_CANVAS_DATABASE_URL AUTO_CANVAS_NOTEBOOK_API AUTO_CANVAS_NOTEBOOK_ENV_FILE; do
  [[ -n "${!name:-}" ]] || fail "$name must be set and not empty."
done
[[ "$AUTO_CANVAS_NOTEBOOK_ENV_FILE" == /* ]] ||
  fail "AUTO_CANVAS_NOTEBOOK_ENV_FILE must be an absolute path."
[[ -f "$AUTO_CANVAS_NOTEBOOK_ENV_FILE" ]] ||
  fail "AUTO_CANVAS_NOTEBOOK_ENV_FILE must name an existing regular file."
while IFS= read -r name; do
  # `[` compares strings exactly, also under nocasematch.
  if [[ "$name" == [Dd][Aa][Tt][Aa][Bb][Aa][Ss][Ee]_[Uu][Rr][Ll] ]] && [ "$name" != DATABASE_URL ]; then
    fail "A differently-cased spelling of DATABASE_URL is set in the environment; remove it."
  fi
done < <(compgen -e)
[[ -z "${SILICON_NOTEBOOK_ENV_FILE+set}" ]] ||
  fail "SILICON_NOTEBOOK_ENV_FILE is set in the environment; remove it."

# 2. The port.
port=${AUTO_CANVAS_PORT-4310}
if ! [[ "$port" =~ ^[0-9]{1,5}$ ]] || ((10#$port < 1 || 10#$port > 65535)); then
  fail "AUTO_CANVAS_PORT must be an integer from 1 to 65535."
fi
port=$((10#$port))

# 3. The Node executable.
if [[ -n "${AUTO_CANVAS_NODE+set}" ]]; then
  node=$AUTO_CANVAS_NODE
  [[ "$node" == /* && -f "$node" && -x "$node" ]] ||
    fail "AUTO_CANVAS_NODE must be the absolute path of an executable file."
else
  node=$(type -P node || true)
  [[ -n "$node" ]] || fail "node is not on PATH; set AUTO_CANVAS_NODE."
  # A relative PATH entry gives a relative result, which names a file below
  # the directory the script started in; the cd further down leaves it.
  [[ "$node" == /* ]] || node="$(pwd)/$node"
fi

# 4. The canvas root and its builds.
root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ -f "$root/apps/server/dist/cli.js" ]] ||
  fail "apps/server/dist/cli.js is missing; run pnpm build."
[[ -f "$root/apps/editor/dist-notebook/index.html" ]] ||
  fail "apps/editor/dist-notebook/index.html is missing; run pnpm build:notebook-editor."

# 5. The log file.
if [[ -n "${AUTO_CANVAS_LOG_FILE+set}" ]]; then
  log=$AUTO_CANVAS_LOG_FILE
  [[ "$log" == /* ]] || fail "AUTO_CANVAS_LOG_FILE must be an absolute path."
else
  log=$root/.local/logs/notebook-canvas.log
fi
mkdir -p -- "$(dirname -- "$log")" 2>/dev/null ||
  fail "The directory of the log file cannot be created."
if [[ -n "${AUTO_CANVAS_LOG_FILE+set}" ]]; then
  log_name=AUTO_CANVAS_LOG_FILE
else
  log_name="the default log file"
fi

# The inherited DATABASE_URL, PORT and libpq variables are silicon-notebook's.
export DATABASE_URL="$AUTO_CANVAS_DATABASE_URL"
export HOST=127.0.0.1
export PORT="$port"
export AUTO_CANVAS_BASE_PATH=/canvas
export AUTO_CANVAS_AUTH=notebook
export EDITOR_ROOT="$root/apps/editor/dist-notebook"
unset AGENT_ALLOWED_ORIGIN AGENT_SESSION AUTO_CANVAS_USER_NAME ANALOG_CANVAS_API_URL
unset PGDATABASE PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
cd -- "$root"
# The redirection of the exec below would fail with Bash's own message and
# status 1; an unusable log file is a configuration error like the others.
if ! : 2>/dev/null >>"$log"; then
  fail "$log_name cannot be opened for appending (a directory, or not writable)."
fi
exec "$node" apps/server/dist/cli.js --require-canvas-database >>"$log" 2>&1

#!/usr/bin/env bash
# Shared by the local launchers; requires Bash 3.2+ (including macOS).
set -euo pipefail

launcher_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$launcher_root"

launcher_load_env() {
  [[ -f .env ]] || return 0
  # Remember exported values before sourcing trusted, local Bash configuration.
  # Arrays preserve empty values, newlines and quotes without evaluating them.
  local launcher_env_name launcher_env_index
  local -a launcher_env_names=() launcher_env_values=()
  while IFS= read -r launcher_env_name; do
    launcher_env_names+=("$launcher_env_name")
    launcher_env_values+=("${!launcher_env_name-}")
  done < <(compgen -e)
  set -a
  source "$launcher_root/.env"
  set +a
  for ((launcher_env_index = 0; launcher_env_index < ${#launcher_env_names[@]}; launcher_env_index++)); do
    launcher_env_name=${launcher_env_names[$launcher_env_index]}
    # Avoid assigning unchanged readonly exports such as SHELLOPTS.
    if [[ ${!launcher_env_name-} != "${launcher_env_values[$launcher_env_index]}" ]]; then
      printf -v "$launcher_env_name" '%s' "${launcher_env_values[$launcher_env_index]}"
    fi
    export "$launcher_env_name"
  done
}

launcher_load_env
export PORT=${PORT:-4310}
export HOST=${HOST:-127.0.0.1}
export DATABASE_URL=${DATABASE_URL:-postgresql:///auto_canvas}
START_TIMEOUT=${START_TIMEOUT:-60}
STOP_TIMEOUT=${STOP_TIMEOUT:-10}
launcher_server_pid=
launcher_editor_pid=

launcher_error() {
  echo "auto-canvas: $*" >&2
  return 1
}

launcher_config() {
  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || ((10#$PORT < 1 || 10#$PORT > 65535)); then
    launcher_error "PORT must be an integer between 1 and 65535."
    return 1
  fi
  for timeout in "$START_TIMEOUT" "$STOP_TIMEOUT"; do
    if ! [[ "$timeout" =~ ^[0-9]+$ ]]; then
      launcher_error "START_TIMEOUT and STOP_TIMEOUT must be non-negative integer seconds."
      return 1
    fi
  done
  PORT=$((10#$PORT))
  START_TIMEOUT=$((10#$START_TIMEOUT))
  STOP_TIMEOUT=$((10#$STOP_TIMEOUT))
  local url_host=$HOST
  case "$HOST" in
    0.0.0.0) url_host=127.0.0.1 ;;
    ::) url_host='[::1]' ;;
    *:*) url_host="[$HOST]" ;;
  esac
  launcher_url="http://$url_host:$PORT"
}

launcher_require() {
  command -v "$1" >/dev/null 2>&1 || launcher_error "$1 is required on PATH. $2"
}

launcher_prerequisites() {
  [[ -d node_modules ]] || {
    launcher_error "node_modules is missing. Run pnpm install --frozen-lockfile first."
    return 1
  }
  launcher_require pnpm 'Install pnpm, then run pnpm install --frozen-lockfile.'
  launcher_require node 'Node.js 24 or newer is required.'
  launcher_require curl 'Install curl for the health check.'
}

# Capture both identities and a useful diagnostic. Never treat an unidentified
# listener as a free port (ss may hide identities belonging to another user).
launcher_listeners() {
  launcher_listener_pids=
  launcher_listener_description=
  if command -v lsof >/dev/null 2>&1; then
    local status=0
    launcher_listener_description=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>&1) || status=$?
    if ((status > 1)) || { ((status == 1)) && [[ -n "$launcher_listener_description" ]]; }; then
      launcher_error "Cannot inspect port $PORT: $launcher_listener_description"
      return 1
    fi
    launcher_listener_pids=$(printf '%s\n' "$launcher_listener_description" | awk 'NR > 1 {print $2}' | sort -u)
  elif command -v ss >/dev/null 2>&1; then
    launcher_listener_description=$(ss -H -ltnp "sport = :$PORT") || return 1
    launcher_listener_pids=$( { printf '%s\n' "$launcher_listener_description" | grep -oE 'pid=[0-9]+' || true; } | cut -d= -f2 | sort -u)
  else
    launcher_error 'Install lsof (macOS/Linux) or ss (Linux) to inspect listening ports.'
    return 1
  fi
}

launcher_port_free() {
  launcher_listeners
  if [[ -n "$launcher_listener_description" ]]; then
    launcher_error "Port $PORT is already in use:
$launcher_listener_description"
    return 1
  fi
}

launcher_database() {
  # Without the PostgreSQL CLI, the server still checks connectivity and runs
  # migrations; startup failures below always include the attempted URL.
  if ! command -v psql >/dev/null 2>&1; then
    echo 'psql is unavailable; the server will verify DATABASE_URL during startup.'
    return
  fi
  export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-5}
  if psql "$DATABASE_URL" -X -w -Atqc 'SELECT 1' >/dev/null 2>&1; then
    return
  fi
  local maintenance_url
  maintenance_url=$(node -e '
    const url = new URL(process.env.DATABASE_URL);
    if (decodeURIComponent(url.pathname) !== "/auto_canvas") process.exit(1);
    url.pathname = "/postgres";
    // libpq lets dbname in the query override the path.
    if (url.searchParams.has("dbname")) process.exit(1);
    console.log(url.href);
  ') || {
    launcher_error "Cannot connect to PostgreSQL at DATABASE_URL=$DATABASE_URL. Check PostgreSQL and create the configured database."
    return 1
  }
  local exists
  if ! exists=$(psql "$maintenance_url" -X -w -Atqc "SELECT 1 FROM pg_database WHERE datname = 'auto_canvas'"); then
    launcher_error "PostgreSQL is unreachable at DATABASE_URL=$DATABASE_URL. Start PostgreSQL and check the connection settings."
    return 1
  fi
  if [[ "$exists" != 1 ]] && command -v createdb >/dev/null 2>&1; then
    echo 'Creating database auto_canvas...'
    createdb -w --maintenance-db="$maintenance_url" auto_canvas || {
      launcher_error "Could not create database at DATABASE_URL=$DATABASE_URL."
      return 1
    }
  fi
  if ! psql "$DATABASE_URL" -X -w -Atqc 'SELECT 1' >/dev/null; then
    launcher_error "Cannot connect to PostgreSQL at DATABASE_URL=$DATABASE_URL. Create the database with createdb if necessary."
    return 1
  fi
}

# Node's detached process group works on macOS and Linux, without setsid.
# stdout only carries the PID; the child's output goes to a log or the terminal.
launcher_spawn() {
  node -e '
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const [log, command, ...args] = process.argv.slice(1);
    const output = log ? fs.openSync(log, "a") : 2;
    const child = spawn(command, args, {
      detached: true, stdio: ["ignore", output, output], env: process.env,
    });
    child.on("error", (error) => { console.error(error); process.exitCode = 1; });
    child.on("spawn", () => { console.log(child.pid); child.unref(); });
  ' "$@"
}

launcher_alive() {
  # kill -0 also succeeds for unreaped zombies on Linux.
  local state
  state=$(ps -p "$1" -o stat= 2>/dev/null) || return 1
  [[ -n "$state" && "$state" != *Z* ]]
}

launcher_terminate() {
  local pid=$1
  local group=${2:-no}
  local grace=${3:-$STOP_TIMEOUT}
  local target=$pid
  [[ "$group" != yes ]] || target="-$pid"
  kill -TERM -- "$target" 2>/dev/null || return 0
  local deadline=$((SECONDS + grace))
  while launcher_alive "$pid"; do
    if ((SECONDS >= deadline)); then
      echo "Grace period expired; sending SIGKILL to $pid."
      kill -KILL -- "$target" 2>/dev/null || true
      break
    fi
    sleep 0.2
  done
}

launcher_cleanup() {
  local status=$?
  trap - EXIT
  # Package managers can forward another signal while the terminal signal is
  # already being handled. Finish cleanup before accepting more interrupts.
  trap '' INT TERM HUP
  if [[ -n "$launcher_editor_pid" ]]; then
    # The editor supervisor SIGKILLs its own process group just before
    # STOP_TIMEOUT. SECONDS counts whole seconds, so allow two more before
    # killing the supervisor; killing it first would orphan the group.
    launcher_terminate "$launcher_editor_pid" no $((STOP_TIMEOUT + 2))
  fi
  if [[ -n "$launcher_server_pid" ]]; then
    launcher_terminate "$launcher_server_pid" yes
  fi
  exit "$status"
}

launcher_traps() {
  trap launcher_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

launcher_start_server() {
  local log=$1
  mkdir -p .local/logs
  launcher_port_free
  launcher_server_pid=$(launcher_spawn "$log" node apps/server/dist/cli.js)
  local deadline=$((SECONDS + START_TIMEOUT))
  while launcher_alive "$launcher_server_pid"; do
    if curl --noproxy '*' -fsS --connect-timeout 1 --max-time 1 "$launcher_url/api/health" >/dev/null 2>&1; then
      launcher_listeners
      if [[ " $launcher_listener_pids " == *" $launcher_server_pid "* ]]; then
        return 0
      fi
    fi
    ((SECONDS < deadline)) || break
    sleep 0.2
  done
  launcher_error "Server failed to become healthy within ${START_TIMEOUT}s at $launcher_url (DATABASE_URL=$DATABASE_URL). Log: $log" || true
  tail -n 40 "$log" >&2
  return 1
}

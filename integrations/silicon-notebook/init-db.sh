#!/usr/bin/env bash
# One-time installation step: initialises the canvas database named by
# AUTO_CANVAS_DATABASE_URL, which must be empty and must not be the database
# silicon-notebook's <dir>/.env names. This script does not read the .env; the
# server checks it without a shell.
# Usage: init-db.sh --notebook-root <dir>
# Requires Bash 3.2+ (including macOS). See README.md in this directory.
# Tracing (bash -x, or an inherited SHELLOPTS=xtrace) would print the
# database URLs below, passwords included: off before anything expands.
set +x
set -euo pipefail
# An inherited BASHOPTS can turn nocasematch on; the checks below compare
# the spelling of variable names and must stay case-sensitive.
shopt -u nocasematch

fail() {
  printf 'auto-canvas init-db.sh: %s\n' "$1" >&2
  exit 2
}

usage="Usage: init-db.sh --notebook-root <dir>"

# 1. Exactly one option.
[[ $# -eq 2 && "$1" == --notebook-root ]] || fail "$usage"
notebook_root=$2
[[ -n "$notebook_root" && -d "$notebook_root" ]] ||
  fail "--notebook-root must name an existing directory."
notebook_root=$(CDPATH='' cd -- "$notebook_root" && pwd -P)
[[ -f "$notebook_root/.env" ]] ||
  fail "--notebook-root must hold silicon-notebook's .env as a regular file."

# 2. The same checks as serve.sh.
[[ -n "${AUTO_CANVAS_DATABASE_URL:-}" ]] ||
  fail "AUTO_CANVAS_DATABASE_URL must be set and not empty."
while IFS= read -r name; do
  # `[` compares strings exactly, also under nocasematch.
  if [[ "$name" == [Dd][Aa][Tt][Aa][Bb][Aa][Ss][Ee]_[Uu][Rr][Ll] ]] && [ "$name" != DATABASE_URL ]; then
    fail "A differently-cased spelling of DATABASE_URL is set in the environment; remove it."
  fi
done < <(compgen -e)
[[ -z "${SILICON_NOTEBOOK_ENV_FILE+set}" ]] ||
  fail "SILICON_NOTEBOOK_ENV_FILE is set in the environment; remove it."

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

root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ -f "$root/apps/server/dist/cli.js" ]] ||
  fail "apps/server/dist/cli.js is missing; run pnpm build."

# 3. Initialise, in the foreground.
export DATABASE_URL="$AUTO_CANVAS_DATABASE_URL"
export AUTO_CANVAS_AUTH=local
export AUTO_CANVAS_NOTEBOOK_ENV_FILE="$notebook_root/.env"
unset PGDATABASE PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
cd -- "$root"
status=0
"$node" apps/server/dist/cli.js --init-empty-database || status=$?
if [[ $status -ne 0 ]]; then
  exit "$status"
fi
echo "auto-canvas init-db.sh: the canvas database is initialised."

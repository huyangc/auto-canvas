# T180 — The offline package check: follow-ups from T166's review

- Branch: `task/T180-package-check-follow-ups`
- Base: `main` at `7dc9821`
- Status: approved (the owner delegated T164b–T167 and their follow-ups on
  2026-11-24; these are the five non-blocking findings of codex round 2 on
  PR 139, recorded there and accepted for a follow-up)
- Plan review: self-checked against the code (no codex plan review: the
  workflow runs it only on request)
- Implementer: Codex `gpt-6.2-sol` (medium: five specified fixes in two
  scripts; the owner's routing of 2026-11-25)

## Goal

`scripts/package-notebook-canvas.mjs` (makes the canvas's offline package for
silicon-notebook sites) and `scripts/package-notebook-canvas-check.mjs`
(proves a built package in an empty directory) get the five fixes codex
review found on PR 139. With them the check also proves the packaged editor
boots in a browser, a broken archive stops the run before anything from it
runs, every wait is bounded, and the packaging script's Python preflight
refuses an interpreter that cannot build the wheel.

## Context

- `scripts/package-notebook-canvas.mjs` (main `7dc9821`): `parseArgs`
  (`:167-188`, `--python` and `--out`), `checkPython` (`:191-211`: imports
  `pip` and `setuptools`, requires setuptools ≥ `MIN_SETUPTOOLS` = 68,
  `:52`), `buildWheel` (`:223-284`: copies the plugin tree to a temporary
  directory and runs `python -m pip wheel --no-deps --no-build-isolation
  --no-index` with `cwd: scratch`, `:253`). `pnpm notebook:package` passes
  `--python "$AUTO_CANVAS_PACKAGE_PYTHON"` (`package.json:36`).
- `scripts/package-notebook-canvas-check.mjs`: `unpack` (`:243-264`: lists
  the tarball and checks "one top directory, no absolute or parent paths",
  then extracts **whatever the check said**), `checkLayout` (`:305-350`,
  returns `acceptable`; `main` (`:734`) stops when it is false), `stopGroup`
  (`:174-191`: after SIGKILL it loops `while (groupAlive(pgid))` with no
  bound), `checkEntryAssets` (`:497`, fetches the entry script and
  stylesheets only), `exerciseServer` (`:546`), the stub notebook `/api/me`
  (`startStub`, `:363`), `RESERVED_PORTS` 3000/8000/4310 (`:44`).
- The notebook editor's entry lazily imports its bootstrap, so fetching the
  entry script does not prove the editor mounts. The canvas editor marks its
  canvas with `[data-testid="schematic-canvas"]`; in notebook mode the token
  comes from `localStorage["silicon_notebook_token"]`.
- Stage L of the integration check launches Chrome safely
  (`scripts/lib/notebook-integration/stage-l.mjs`: `launchChrome`,
  `browserSessions`, `forwardingProxy`, `guardNetwork`): the system Chrome,
  headless, a fresh profile, every connection (loopback included) through a
  proxy of the run that forwards only to one origin, the WebRTC policy
  `disable_non_proxied_udp`. `@playwright/test` is a root dev dependency.
- Tests: `scripts/package-notebook-canvas.test.mjs` (unit tests of the
  packaging helpers).

## Design (decided)

1. **Browser boot.** After the server checks, the check opens the packaged
   editor in headless Chrome through the same safe launch as stage L (reuse
   its exported helpers; do not copy them): the stub token in
   `localStorage` on the canvas origin only, every connection through a
   proxy that forwards only to the canvas's port, then waits (bounded) for
   `[data-testid="schematic-canvas"]`. One check; the browser is closed in
   the cleanup too, and only its recorded process is signalled. Without
   Chrome the check fails with a clear message (no skip).
2. **One archive verdict.** `unpack` stops before extracting when its archive
   check fails (no top directory, an extra top-level entry, an absolute or
   parent path), and `main` stops on `checkLayout`'s verdict as today; the
   printed summary ("the layout is not acceptable; nothing from the package
   is run") covers both. Controls: a tarball with an extra top-level entry,
   and one without `apps/editor/dist-notebook/index.html` → exit non-zero,
   nothing extracted / nothing run.
3. **Bounded wait.** After SIGKILL, `stopGroup` waits at most 5 s; on timeout
   it reports the group (one failed check naming the pgid) and the cleanup
   goes on.
4. **Absolute `--python`.** `parseArgs` (or `main`) resolves a relative
   `--python` containing a slash against the invocation directory before any
   directory change; a bare name is looked up on `PATH` as today.
5. **Preflight.** `checkPython` also requires Python ≥ 3.13 (the plugin's
   `requires-python`) and, when setuptools < 70.1, an importable `wheel`
   (offline `pip wheel --no-build-isolation` needs it); each refusal (exit 2)
   names what is missing.

## Scope

Owned paths: `scripts/package-notebook-canvas.mjs`,
`scripts/package-notebook-canvas-check.mjs`,
`scripts/package-notebook-canvas.test.mjs`, a small export from
`scripts/lib/notebook-integration/stage-l.mjs` only if a helper the check
reuses is not exported yet (no behaviour change there),
`integrations/silicon-notebook/README.md` and `docs/testing/README.md`
(one sentence each where the check is described),
`tasks/T180-package-check-follow-ups/report.md`.

Out of scope: product code (`apps/**`, `packages/**`); stage P and the rest
of the integration check (T167 runs in parallel there); silicon-notebook's
checkout.

## Acceptance

Never look at, bind, contact or signal ports 3000, 8000, 4310; never kill by
name or pattern.

```bash
set -euo pipefail
PKG_PY=/opt/homebrew/Caskroom/miniconda/base/bin/python   # pip + setuptools >= 68, Python 3.14
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm install --frozen-lockfile --offline
pnpm exec vitest run scripts/package-notebook-canvas.test.mjs   # all pass; new unit tests for 4 and 5
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm deadcode
AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY pnpm notebook:package
AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY node scripts/package-notebook-canvas-check.mjs   # every check ok, incl. the browser boot
node scripts/package-notebook-canvas.mjs --python /opt/homebrew/bin/python3.13       # exit 2: setuptools missing (named)
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE datname LIKE 'auto_canvas_it_pkg_%'"   # 0
```

Plus a control per fix that fails with the fix reverted (the two broken
tarballs of 2, a stand-in group that survives SIGKILL for 3, a relative
`--python` run from another directory for 4, interpreters lacking each
requirement for 5, the browser check against a package whose editor build
is broken for 1).

## Notes for the implementer

- The Codex sandbox has no network and writes only inside this worktree.
  Run every acceptance command the sandbox allows; for each one it refuses
  (PostgreSQL, Chrome, the system temporary directory), report the command
  and its error verbatim and go on. Never work around the sandbox, and never
  ask for an escalation that would let a command reach ports 3000, 8000 or
  4310. The reviewer runs the refused commands and returns failures as the
  next round.
- No new dependency, no lockfile change, no LLM API call. Tokens and
  database URLs are never printed.
- Do not commit, stash, push, merge, rebase or switch branches.

# T180 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T180-package-check-follow-ups` after Codex
round 1 (`gpt-6.2-sol`, STATUS: partial — the sandbox denied PostgreSQL, so
the full check, the broken-editor control and the database count did not
run there). Opus reran every acceptance command and the controls outside the
sandbox (`agent-a9c14d97cb79051d3/tmp/t180-review.sh`, logs in its
`tmp/t180-review/r1/`).

All five follow-ups are fixed: the check opens the packaged editor in Chrome
through stage L's session, proxy and origin guard (the page's `/canvas/` is
routed to the server's `/@notebook/canvas/` mount, as silicon-notebook's
rewrite does); a failed archive listing stops before extraction and the
layout verdict stops before anything runs; the post-SIGKILL wait is bounded
at 5 s and reports the group; a `--python` with a slash is made absolute;
the preflight requires Python 3.13+, pip, setuptools 68+ and `wheel` below
setuptools 70.1, naming what is missing.

```text
vitest run scripts/package-notebook-canvas.test.mjs          → 0 (17 passed)
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
pnpm notebook:package (miniconda Python 3.14)                → 0
package-notebook-canvas-check                                → 0 (24 of 24, incl. the editor mounting in Chrome)
control: lazy editor chunk removed                           → 1 (only "the packaged editor mounts in Chrome" fails)
control: extra top-level entry                               → 1 (refused before extraction; nothing run)
control: index.html missing                                  → 1 (layout refused; nothing run)
package-notebook-canvas.mjs --python python3.13              → 2 ("cannot import setuptools")
leftover auto_canvas_it_pkg_* databases                      → 0
```

## Round 2 — accepted (reviewer's fix)

Codex PR review round 1 on PR 146 (head `26bf456`, gpt-6.2-sol): no blocking
finding; two P2s on the preflight, fixed by the reviewer (a few lines):

1. The probe ran in the caller's environment and directory, so a `wheel`
   reachable only through the caller's `PYTHONPATH` could pass it while the
   build (which drops `PYTHONPATH`) failed. The probe now runs in the wheel
   build's environment (`wheelBuildEnv`, shared with `buildWheel`) from an
   empty temporary directory.
2. Exit status 0 alone passed it (`--python /usr/bin/true`), and the output
   was then removed before the build failed. The probe prints a marker after
   every check and passes only with it.

A unit test covers both (an interpreter that exits 0 silently is refused;
one that prints the marker only without `PYTHONPATH` and outside the
invocation directory passes); it fails on the previous code.

```text
vitest run scripts/package-notebook-canvas.test.mjs          → 0 (18 passed; the new test fails on 26bf456)
--python /usr/bin/true                                       → 2 ("it did not run the Python preflight")
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
pnpm notebook:package + package-notebook-canvas-check        → 0 (24 of 24)
```

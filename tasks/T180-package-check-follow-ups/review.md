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

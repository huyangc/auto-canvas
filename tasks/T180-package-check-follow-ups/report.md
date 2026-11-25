# T180 report — round 1

## Summary

The package checker now opens the editor in system Chrome using stage L's browser session, proxy and origin guard. It rejects invalid archive listings before extraction and uses the extracted layout verdict to stop before running package code. Cleanup reports a process group still present five seconds after SIGKILL. The packager resolves slash-containing Python paths and verifies the offline wheel build requirements before assembling the package.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1. Browser boot | partial | Implemented the headless mount check and cleanup. The browser uses the packaged server's recorded port and mirrors the public `/canvas/` rewrite. PostgreSQL access was denied before Chrome could start. |
| 2. Archive and layout verdict | done | Rejects an invalid listing before extraction and rejects a missing editor index before database setup. Both refusals use the same layout message. |
| 3. Bounded wait | done | Reports one failure naming the process group after a five-second post-SIGKILL wait, then continues cleanup. |
| 4. Absolute `--python` | done | Resolves a path against the invocation directory and preserves bare `PATH` names. |
| 5. Python preflight | done | Requires Python 3.13+, importable pip and setuptools, setuptools 68+, and importable wheel for setuptools versions below 70.1. Refusals name the missing requirement and exit 2. |

## Review findings addressed

Round 1 had no prior review file.

## Acceptance results

```text
pnpm install --frozen-lockfile --offline → 0
Already up to date

pnpm exec vitest run scripts/package-notebook-canvas.test.mjs → 0
Test Files  1 passed (1)
Tests  17 passed (17)

pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm deadcode → 0
oxlint: 2187 files, 0 errors, 3853 warnings
All matched files use Prettier code style!
Validated local Markdown links in 74 files

AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY pnpm notebook:package → 0
Built output/notebook-canvas/auto-canvas-notebook-0.9.2-50079e9-dirty.tar.gz (8.0 MiB, 218 files).

AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY node scripts/package-notebook-canvas-check.mjs → 1
FAIL the check ran to the end:
package-notebook-canvas-check: 5 of 6 checks ok; failed: the check ran to the end

node scripts/package-notebook-canvas.mjs --python /opt/homebrew/bin/python3.13 → 2 (expected)
package-notebook-canvas: the interpreter /opt/homebrew/bin/python3.13: cannot import setuptools

psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE datname LIKE 'auto_canvas_it_pkg_%'" → 2
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed: Operation not permitted
	Is the server running locally and accepting connections on that socket?
```

The checker passed its five archive and layout checks, then printed an empty error detail. Repeating its initial `SELECT current_user AS name` with the same Node PostgreSQL client exposed the underlying errors verbatim.

```text
connect EPERM ::1:5432 - Local (:::0)
connect EPERM 127.0.0.1:5432 - Local (0.0.0.0:0)
```

| Control | Result |
| --- | --- |
| Browser against a broken editor build | Removed the lazy `notebook-*.js` chunk from a copy of the tarball and left its direct entry script and stylesheets present. `AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY node scripts/package-notebook-canvas-check.mjs --tarball output/t180-controls.Lu2JlA/broken-editor.tar.gz` exited 1 after the same five layout passes and `FAIL the check ran to the end:` at database setup. Loading the baseline checker produced the same result at database setup, so the browser control remains unverified. |
| Extra top-level archive entry | Exited 1 and printed `the layout is not acceptable; nothing from the package is run`. An audit hook confirmed that there was no `tar -xzf` call and no database setup. With the baseline checker loaded, the same fixture reached both. |
| Missing editor index | Exited 1, named `apps/editor/dist-notebook/index.html`, and printed the same layout refusal. The audit hook confirmed extraction and no database setup. With the baseline checker loaded, the fixture reached database setup. |
| Group survives SIGKILL | With a fake process group and clock, the current `stopGroup` returned exactly 5,000 ms after SIGKILL and reported one failure naming pgid `424242`. The baseline wait exceeded the control deadline. |
| Relative `--python` from another directory | The CLI built both the wheel and tarball with `--python ./bin/python` from a separate directory. Reverting path resolution produced exit 1 and `pip wheel failed (spawnSync ./bin/python ENOENT):`. |
| Python preflight requirements | Unit fixtures verified exit 2 for Python 3.12, missing pip, missing setuptools, setuptools 67 and missing wheel under setuptools 70.0. The positive controls accepted setuptools 68 with wheel and 70.1 without it. Reverting the new Python and wheel guards failed both corresponding tests. The CLI also refused system Python 3.9.6 with exit 2 and named the minimum Python version. |

## Investigation results

The notebook editor expects `/canvas/` in the browser while the package server accepts requests under `/@notebook/canvas/`. The browser route mirrors that rewrite on the same origin and falls through to stage L's guard and proxy. The package launcher uses `exec`, so `lsof` can verify the canvas listener against the launcher's recorded child PID.

## Deviations and open questions

The sandbox denied PostgreSQL over TCP and the local socket. The full checker, the browser regression control and the final database count need to be rerun in the review environment.

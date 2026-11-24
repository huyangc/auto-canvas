# T166 review

## Round 1 — accepted

Reviewed: the working tree on `task/T166-notebook-canvas-package` over
`bd7ad74` (2026-11-24); `scripts/lib/server-bundle.mjs` and
`scripts/package-notebook-canvas.mjs` read in full, the check script's
environment, trace and cleanup read; acceptance rerun by Opus on lane 3.

Every changed path is in the plan's owned list; no product code, dependency or
lockfile change; nothing left in the plugin tree.

| #   | Severity | Where                                                  | Finding                                                                                                                                                                                         | Expected fix                                                                                      |
| --- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | note     | `THIRD-PARTY-NOTICES.txt`                              | Three bundled packages ship no licence file (@mathjax/mathjax-newcm-font Apache-2.0, pg-types MIT, pgpass MIT); the notices say so. The editor build's third-party code is not listed.          | T167, with the paired offline instructions: decide whether the site package needs fuller notices. |
| 2   | note     | the packaged `integrations/silicon-notebook/README.md` | Its relative links to `../../docs/…` do not resolve inside the package.                                                                                                                         | T167 (the offline instructions).                                                                  |
| 3   | note     | `scripts/launcher.test.mjs`                            | One full-suite run timed out "restart leaves the running server alone when it cannot bring up a new one" while another lane ran notebook builds; the file passed twice alone. Not touched here. | None here (an existing timing-sensitive case).                                                    |

Acceptance rerun:

```text
pnpm install --frozen-lockfile --offline                → 0
pnpm notebook:package (twice)                           → 0, 0; identical sha256 for the bundle, the wheel and the tarball
node scripts/package-notebook-canvas-check.mjs          → 0   17 of 17 checks ok
vitest run scripts/package-notebook-canvas.test.mjs     → 0   9 passed
pnpm test:local                                         → 1   9121 passed, 1 failed (finding 3), 116 skipped
vitest run scripts/launcher.test.mjs (twice)            → 0   22 passed each
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
databases named auto_canvas_it_* afterwards             → 0
```

## Round 2 — accepted

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 139 at `28a8b61` (four
P2, one P3, no blocking finding) and the fixes a sonnet subagent made for four
of them; acceptance rerun by Opus.

| #   | Severity | Where                               | Finding                                                                                                                       | Outcome                                                                                                                                                                                                                                                   |
| --- | -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | fixed    | `package-notebook-canvas-check.mjs` | A tarball with `index.html` but without its scripts passed.                                                                   | `checkEntryAssets`: every module script and stylesheet of the served page is fetched through the mount (200, the right content type). Negative control: the entry script removed → 20 of 21, failing exactly there.                                       |
| 5   | fixed    | `checkLayout`, `main`               | A rejected layout still went on to create a database and run the launchers.                                                   | `checkLayout` returns whether the layout is acceptable; `main` stops before allocating anything. A tarball with `init-db.sh` as a symlink stops at the layout and creates no database.                                                                    |
| 6   | fixed    | the check's cleanup                 | Signalling `init-db.sh` alone could leave its Node child running while the database was dropped.                              | Launchers run in their own process groups; cleanup stops each group (SIGTERM, SIGKILL after 15 s) before dropping and removing. An interrupt during a slow `init-db.sh` left no process of the group.                                                     |
| 7   | fixed    | `buildWheel`                        | An interrupted packaging run could leave `build/` or `*.egg-info` in the checkout.                                            | The wheel is built from a temporary copy; the checkout's plugin tree is only checked, before and after. The wheel's content is unchanged (`diff -r` of the unzipped wheels clean); its sha256 follows the commit time it is stamped with.                 |
| 8   | rebutted | `scanBundle`                        | The guard scans text with regular expressions; a string could trip it and a comment between `import` and `(` could slip past. | Kept. The guard is a second line on the bundler's own output, which has no such comments; the authority on what the server loads is the check's module trace (only the bundle and `node:` builtins). A parser would add a dependency. Answered on the PR. |

Rerun: packaging exit 0 (bundle sha256 unchanged); the check 21 of 21; unit
tests 9; typecheck, lint, format, deadcode 0.

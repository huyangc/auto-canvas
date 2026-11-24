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

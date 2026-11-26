# T167 report — round 2

## Summary

P1 and P4 now check the packaged notebook's anonymous readiness endpoint through the frontend. Both still require the default package to serve an HTML 404 at `/canvas`. The offline guide keeps the database steps needed at installation and describes both upgrades and the switch back without database maintenance instructions.

## Reviewer rerun on the host

The reviewer reran the round 2 code on PostgreSQL lane 2. The complete
default install, paired install, upgrade and switch back passed. The
following host results supersede the sandbox failures in the round 2
implementation record below. Raw logs are in
`/private/tmp/claude-review/t167-r2/`.

| Check | Host result |
| --- | --- |
| Build, notebook build, launcher and package unit tests, typecheck, lint, format, docs and deadcode | All exited 0 |
| Canvas package and package check | Both exited 0, all 21 package checks passed |
| Integration stages S, M and L | 101, 114 and 89 checks passed, respectively |
| Stage P | 170 passed, 0 failed. The stage measured 2,100 seconds and 5,885,568 KiB before cleanup, excluding external caches |
| Full local suite | 9,184 passed, 115 skipped |
| Normal shutdown | All six recorded companions stopped, zero integration databases remained and the notebook status snapshots matched |

The owner subsequently ran the site-phase interrupt check on the host,
using the same pinned notebook revision. After the P2 managed canvas became
ready, the harness sent SIGINT to the stage process. The stage exited 130
with 68 checks passed and zero failed. Cleanup stopped all three recorded
companions, dropped the run's database and removed its temporary root.
The harness itself exited 0. Log: `/private/tmp/t167-owner-interrupt.log`.

## Verification against main `fff1e51`

The owner combined the task with main in a separate test worktree. The
final task branch carries the same implementation, tests and operator
instructions as that worktree. The package checker includes the browser
boot check delivered in PR #146.

| Check | Result |
| --- | --- |
| Frozen offline dependency install, both builds, typecheck, lint, format, docs and deadcode | Passed |
| Launcher and package unit tests | 65 passed |
| Local suite | 9,226 passed, 115 skipped |
| Real package and archive checker | 24 of 24 checks passed |
| Stages S, M, L | 101, 114 and 89 checks passed |
| Complete stage P | 170 passed, 0 failed in 908 seconds with 5,856,968 KiB in the sandbox at the end |
| Final cleanup | Six recorded companions stopped. An independent lane-2 query after the runs found zero integration databases |

The host commands and full logs use the same plan and notebook revision as
round 2. Logs for this main integration are in
`/private/tmp/t167-integration-evidence/`.

## Implementation-round steps before external verification

| Step | Status | Notes |
| --- | --- | --- |
| Offline instructions | Done | Updated the upgrade and switch-back text and retained the package configuration, install commands and upstream deployment links. |
| P0 build | Partial | Round 1's external review built all four archives and checked their rewrites. In round 2, the canvas package built. The sandbox denied port allocation before the notebook packs. |
| P1–P4 site | Partial | Checked the revised P1/P4 probe with controlled responses. Reviewed the P2–P4 commands and assertions against the plan and the pinned notebook revision. The sandbox stopped before P1. |
| Site interruption and cleanup | Partial | The interrupt harness waited for the P2 managed canvas. Stage P exited before that point and removed its temporary root. |
| T165 follow-ups | Done | All four controls passed with the fixes present. Each failed with its corresponding fix reverted in memory or with the earlier README supplied. |

## Review findings addressed

1. **Packaged readiness.** P1 and P4 share `defaultResponses`, which sends `GET /api/ready` through the web and backend ownership gate. The separate `/canvas` request still checks both status and HTML content type. With a stand-in HTTP transport, the probe accepted readiness 200 plus HTML 404. It rejected readiness 503, canvas 200 and a JSON 404.
2. **Offline database guidance.** Removed the paired backup and restore instructions, the upgrade guidance about the database URL and migrations, and the switch-back instruction about retaining the database. The switch-back now leaves the canvas directory in place. The testing guide describes the user-visible switch-back checks. Stage P retains the plan's independent SQL assertion.
3. **Resource estimate.** The testing guide records the reviewer's 1,610 seconds and 3.1 GB through the first default-package probe. Full-run measurements remain pending.

## Acceptance results

Commands used the plan's lane 2 environment and unsets. `NB`, `PY` and `PKG_PY` below are the notebook checkout, Homebrew Python 3.13 and Miniconda interpreter specified in the plan. Command logs for this round are in `/private/tmp/t167-round2.JTej8S`.

```text
REF=$(git -C "$NB" rev-parse origin/master) → 0
b5850d6f0ef4003211ebfd8abc52e6063b62d52a

pnpm install --frozen-lockfile --offline → 0
Already up to date

pnpm build → 0
apps/editor build: Done

pnpm build:notebook-editor → 0
✓ built in 403ms

pnpm exec vitest run scripts/package-notebook-canvas.test.mjs scripts/notebook-launcher.test.mjs → 0
Test Files  2 passed (2)
Tests  56 passed (56)

pnpm test:local → 1
Test Files  22 failed | 830 passed | 2 skipped (854)
Tests  60 failed | 8889 passed | 350 skipped (9299)
Error: Server tests require reachable PostgreSQL at postgresql:///auto_canvas_test_2
Error: connect EPERM ::1:5432 - Local (:::0)
Error: connect EPERM 127.0.0.1:5432 - Local (0.0.0.0:0)
Error: listen EPERM: operation not permitted 127.0.0.1
TypeError: Cannot read properties of undefined (reading 'closeAllConnections')

pnpm typecheck → 0
pnpm lint → 0
oxlint: 2189 files, 0 errors, 3853 warnings
pnpm format:check → 0
All matched files use Prettier code style!
pnpm docs:check → 0
Validated local Markdown links in 74 files
pnpm deadcode → 0
$ knip --no-progress && knip --production --no-progress

AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY pnpm notebook:package --out "$TMPDIR/t167-pkg" → 0
218 files, 23.2 MiB unpacked, 8.0 MiB archive
Archive SHA-256 e376138df534fd0e7d551e80b71fdb1dbfb6b77fe5ddc918c9a7e1e67769f9b9

AUTO_CANVAS_PACKAGE_PYTHON=$PKG_PY node scripts/package-notebook-canvas-check.mjs --tarball "$(ls "$TMPDIR"/t167-pkg/auto-canvas-notebook-*.tar.gz)" → 1
ok   the launchers are executable
FAIL the check ran to the end:
package-notebook-canvas-check: 5 of 6 checks ok; failed: the check ran to the end

node scripts/notebook-integration-check.mjs --stage S --notebook "$NB" → 1
FAIL S: unexpected error: Error: listen EPERM: operation not permitted 127.0.0.1
stage S: 29 passed, 1 failed

node scripts/notebook-integration-check.mjs --stage M --notebook "$NB" --ref "$REF" --python "$PKG_PY" → 1
FAIL M: unexpected error: Error: listen EPERM: operation not permitted 127.0.0.1
stage M: 14 passed, 1 failed

node scripts/notebook-integration-check.mjs --stage L --notebook "$NB" --ref "$REF" --python "$PKG_PY" → 1
FAIL L: unexpected error: Error: listen EPERM: operation not permitted 127.0.0.1
stage L: 14 passed, 1 failed

node scripts/notebook-integration-check.mjs --stage P --notebook "$NB" --ref "$REF" --python "$PY" --package-python "$PKG_PY" → 1
stage P took 6 s; final sandbox size 198304 KiB (external cache excluded)
FAIL P: unexpected error: Error: listen EPERM: operation not permitted 127.0.0.1
stage P: 12 passed, 1 failed

"$PY" /private/tmp/t167-r1-interrupt.py "$NB" "$REF" "$PY" "$PKG_PY" → 1
site interrupt sent=False, exit=1, root removed=True

psql "$AUTO_CANVAS_TEST_DATABASE_URL" -XAtqc "SELECT count(*) FROM pg_database WHERE left(datname, 15) = 'auto_canvas_it_'" → 2
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed: Operation not permitted
        Is the server running locally and accepting connections on that socket?
```

The package checker emitted an empty failure detail after its archive checks. Its next operation was the admin database query. This sandbox attempt could not verify browser boot or the final database count. The notebook checkout's status snapshots matched with the protected runtime paths excluded. Its ref also matched. All four integration stages and the interrupt run removed their temporary roots.

## Investigation results

- Stage P took **48.176 seconds wall time** including guard controls. Its own timer measured **6 seconds** and **198304 KiB** after the clone. The reviewer previously measured **1,610 seconds** and **3.1 GB** after P0 and the default-package startup. Both runs ended before the paired install.
- In a fresh Python 3.13 venv, the site command installed the rebuilt archive's wheel offline. Its bundle loaded with the pinned notebook backend and its manifest version matched the installed distribution. The P4 uninstall command removed the plugin. The canvas's database guard also accepted the installed settings derived from the pinned notebook's example.
- The P2 code invokes the managed-start, two-user and browser checks. P3 requires the missing-wheel refusal, applies the upgrade with the wheel, verifies the release, reopens the saved revision and clicks the entry. P4 removes the extension, uninstalls the wheel, applies the default release, signs A back in, checks the original notebook and absent entry, and verifies A's project through SQL. The host rerun above subsequently verified all three phases.
- The independent T165 control run passed all five assertions covering the four findings. With each fix reverted separately, the late-launch control detected early return, the shorter admin session lost its DROP, the network-only failure lost its diagnostics, and both README path-normalisation controls failed.

## Deviations and open questions

The sandbox denied loopback binds and PostgreSQL access. The host runs above supplied full P1–P4 acceptance, the site-phase exit 130 and the complete run's duration and disk use. The plan forbids inspecting the owner's ports, so their before/after state was unobserved.

The pinned upstream installer still writes venv diagnostics to the shared path `/tmp/sn_venv_err`. That file can outlive a package installation. Stage P leaves it under the installer's ownership.

## PR review follow-up

A Stage S regression reproduced an exhausted admin session during the
catalog lookup of a lost CREATE. Confirmed database drops now run before
that lookup. Stage S passed 102 checks, including this regression and both
existing lost-poll deadline controls. Format, lint and Markdown links passed.
The testing guide records the pinned upstream installer's shared venv log.

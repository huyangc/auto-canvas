# T067 review

## Round 1 — changes-requested

Reviewed: the round 1 report on `task/T067-short-marker-port-stubs` on
2026-11-13. Per-seat pre-checked short stubs: area −8% on dev and val, but
wire gain under 5%, bends up, two visual totals up, ltc3452 +21.8% runtime,
23 auto-layout test failures. Determinism and the large documents pass.

| #   | Severity | Where                | Finding                                                     | Expected fix                                                           |
| --- | -------- | -------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | must-fix | approach             | Pre-checks lose half the measured gain and add jogs.        | Short defaults everywhere plus post-hoc label repair (amended plan).   |
| 2   | must-fix | `corpus.test.ts:730` | Re-planning `rc-lowpass`/`rc-highpass` is no longer stable. | Restore idempotence.                                                   |
| 3   | must-fix | `corpus.test.ts:538` | Final port seats outside `portSeatCandidates`.              | Generate candidates around the new defaults.                           |
| 4   | must-fix | old-geometry tests   | Assertions pin 40/80.                                       | Rewrite as authorized in the amended plan; keep blocker-repair intent. |
| 5   | must-fix | runtime              | ltc3452 +21.8%.                                             | Within +10% of main.                                                   |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — changes-requested

Reviewed: the round 2 report on 2026-11-13. Short defaults with post-hoc
repair recover the measured gain (dev wire −8.3%, area −11.6%; val on common
drawings wire −6.4%, crossings −6.4%), fix RC idempotence and R146 candidate
membership, and are deterministic. Remaining: bends +1.8% on val, label
run-on 30 → 49 and clearance 179 → 191, ltc3452 +20.4%, six large plans
changed, four old-geometry assertions.

| #   | Severity | Where                      | Finding                                                               | Expected fix                                                                       |
| --- | -------- | -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | must-fix | large documents            | Short defaults changed plans above 40 instances.                      | Short defaults only up to 40 instances.                                            |
| 2   | must-fix | `stub-seat.ts` repair gate | Score gate rejects label repairs that add wire; label guards regress. | Accept when the targeted diagnostic disappears and no other guard rises; cap ≤ 12. |
| 3   | must-fix | runtime                    | ltc3452 +20.4%.                                                       | Within +10% of main.                                                               |
| 4   | must-fix | 3 test files               | Old-geometry pins.                                                    | Rewrite as authorized.                                                             |

Acceptance rerun: not rerun for round 2; changes requested.

## Round 3 — accepted by the user with an Opus review fix

Reviewed: round 3 report and `git diff HEAD` on 2026-11-13; acceptance and the
full evaluation rerun by Opus. Round 3: short defaults (marker 20, single-host
port 40) only up to 40 instances; post-hoc label repair accepted when the
targeted diagnostic disappears and no routed guard rises (≤ 12 trials, R10
refusals excluded); identical-trial and net-routing request reuse; authorized
old-geometry rewrites. The round 3 per-drawing analysis showed some accepted
repairs adding crossings, so Opus added a review fix in `stub-seat.ts`: a
label repair must not increase crossings or bends (`compactionRegresses`,
as in T059).

Common completed drawings, ratio to human (main `b00910b` → final):

| Split | Crossings     | Bends         | Wire          | Median area   |
| ----- | ------------- | ------------- | ------------- | ------------- |
| dev   | 1.786 → 1.792 | 1.161 → 1.127 | 1.425 → 1.307 | 1.448 → 1.284 |
| val   | 1.562 → 1.450 | 0.943 → 0.963 | 1.423 → 1.333 | 1.408 → 1.236 |

Guards: floating 10 → 6, missing 18 → 16, terminal departure 83 → 49, wire
through symbol 20 → 17; label clearance 179 → 192 and run-on 30 → 42 (61
findings over 55 drawings, 7 clearance + 1 terminal-on-foreign-route from the
newly completed `yje2n6eva2`); 628/628 completed. Timing: deadtime −12.7%,
ltc3452 +13.1% vs main. The user accepted this trade on 2026-11-13 ("接受，开 PR").

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
git diff --check → 0
pnpm test:local → 0; 787 files, 8043 tests, 117 skipped
pnpm test:slow → 0; 14 tests
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628/628
```

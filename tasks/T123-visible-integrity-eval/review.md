# T123 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus; the user asked on 2026-11-16 for
subagents instead of Codex). Reviewed: `git diff main` on
`task/T123-visible-integrity-eval`; acceptance rerun by the reviewer.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | `scripts/auto-layout-eval.mjs` exit condition | The corpus run now exits 1 on main because six results carry a planner-made open stub on a rail marker lead (`2jhdk32et5`, `6n39a2gvtc`, `7d93gjqbw8`, `c3qbntbj56`, `gbvzf4h3fj`, `j462r7dnbk`). Intended; the planner fix is a follow-up task. | none here |
| 2 | note | `compareVisibleIntegrity` | Open ends are compared by count per Net, which hides one of the two new ends in `7d93gjqbw8` and `j462r7dnbk`; both cases still fail. | follow-up if it ever hides a whole case |
| 3 | note | `sourceDefects` | Uses ERC touching-not-connected only (pin points). A one-pin stub ending on a foreign wire is missed (`pfakspv4kx` M1.D; L1.1 is reported). 32 cases flagged. | follow-up |
| 4 | note | label ownership | Reported only. 75 introduced flags in 39 cases; in a 10-label sample 8 were real (4 on another Net's wire, 4 left far from their Net), 2 borderline. Hand drawings carry 56 flags in 17 cases, so the measure needs calibration before it gates. | follow-up |
| 5 | note | test runner | The test file runs under `node --test` and under vitest (root config collects `scripts/**/*.test.mjs`). | none |

Acceptance rerun:

```text
pnpm build                                     → 0 (by the implementer)
pnpm typecheck                                 → 0
pnpm lint                                      → 0 errors
pnpm format:check                              → 0
pnpm docs:check                                → 0
node --test scripts/visible-integrity.test.mjs → 9 pass, 0 fail
pnpm test:local                                → 0 (802 files, 8269 passed, 117 skipped)
node scripts/auto-layout-eval.mjs <628 cases>  → 1 (expected, finding 1); 628 completed, 628 plan hashes equal main
```

Corpus: introduced dangling wires 6 cases (dev 4, val 2); introduced
unconnected pins 0; source defects 32 cases (dev 20, val 12); `5hjsy2g863`
VOUT label flagged; `pfakspv4kx` listed as a source defect, nothing introduced.

## Round 2 — changes requested (independent PR review of 97bb793)

The Opus PR review approved with two P2 and three P3 findings; the reviewer
accepts all of them. Fix on this branch:

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `scripts/visible-integrity.mjs` `compareVisibleIntegrity` | The per-Net count allowance hides new open ends on any Net where the source already had one (309 of 628 sources have open ends); the id tie-break never fires because the planner regenerates Route and Junction ids. | A result open end is carried only when its Route is one the planner carries over from the source (Route id prefix `auto-layout-carried-`, R158) and the source has an open end on that Net; every other result open end is introduced. Tests pin both sides: a carried stub is not introduced; a new stub on a Net where the source also had an open end is introduced. Expected on the corpus: 12 introduced ends in the same 6 cases. |
| 2 | must-fix | `scripts/visible-integrity.mjs`, `scripts/auto-layout-eval.mjs` | The result's `touchingNotConnected` findings are computed and dropped. | `introduced.touchingNotConnected` = every such finding in the result (the planner re-routes everything, so any is planner-made); include it in totals, the table column and the exit condition. Test: a result with a pin on another Net's pin or wire is reported. Corpus today: 0. |
| 3 | should-fix | `docs/testing/readability.md` | `unconnectedPins` judges netlist membership (plus NoConnects), not drawn wires. | Say so in the paragraph; describe finding 1 and 2 as implemented. |
| 4 | should-fix | `scripts/visible-integrity.mjs` `ercFindings` | `diagnoseProject` runs every domain. | Pass `{ domains: ["erc"] }` if the option exists with that meaning; confirm findings are identical on the tests. |
| 5 | note | `scripts/visible-integrity.test.mjs` | Dual `node:test` / vitest runner switch is a one-off convention. | Make it a plain vitest file like the other `scripts/*.test.mjs`; acceptance command becomes `pnpm vitest run scripts/visible-integrity.test.mjs`. |

## Round 2 result — accepted

All five findings fixed. Reviewer rerun: `pnpm typecheck` 0, `pnpm lint` 0
errors, `pnpm format:check` 0, `pnpm docs:check` 0,
`pnpm vitest run scripts/visible-integrity.test.mjs` 13 passed. Corpus (628
cases, report read by the reviewer): 628 completed, 628 plan hashes equal main;
introduced dangling wires 12 ends, 2 in each of the six cases; `qj62dz4qvm`
none; introduced touching-not-connected 0; introduced unconnected pins 0.

## Round 3 — PR review of b3cb1b2, fixed by the reviewer

The second Opus PR review approved with one P2 and two P3 findings. They are
few-line fixes, made by the reviewer:

- P2: a pin-on-pin finding the source already reports for the same unordered
  pin pair is not introduced (fixed or locked instances keep it); pin-on-wire
  findings stay introduced.
- P3: carried open ends are excused only up to the source's count on that Net.
- P3: the plan's acceptance command is now the vitest command.

Rerun: `pnpm vitest run scripts/visible-integrity.test.mjs` 15 passed,
`pnpm lint` 0 errors, `pnpm format:check` 0, `pnpm docs:check` 0. The saved
corpus report re-derived with the new comparison: 12 introduced open ends in
the same six cases, 0 introduced touching pins, 0 introduced unconnected pins.

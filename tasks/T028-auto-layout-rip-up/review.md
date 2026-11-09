# T028 review

## Round 1 — changes-requested

Reviewed: `git diff d3ed823` of the round-1 working tree on 2026-11-09; acceptance rerun by
Opus (below). Codex implemented R95 and R96 as specified, found and fixed a real defect on
the way (reconciliation renames the planner's route and junction ids, so removal must
track the materialized objects, not the authored edits), kept the per-group routing
procedure shared between the first pass and the retries, and reported `partial` because
two plan targets fail: dev crossings 271 against ≤ 258, paired time 1.44× against ≤ 1.25×.
Scope is clean (only owned paths changed; frozen files, scripts and the lockfile are
byte-identical to `078f407`); the two failing tests in `quality.test.ts` assert the
pre-R96 routing-call counts and were correctly left alone because the file was out of
scope. Both misses are plan defects, settled below with measurements Opus took on a
scratch copy of this tree (`tmp/t028/variant-*.json`, paired with a `078f407` run):

| Variant (scratch copy of round 1)          | dev / val crossings | paired time |
| ------------------------------------------ | ------------------: | ----------: |
| `078f407`                                  |           287 / 337 |       1.00× |
| Round 1 as is (both finalists, two passes) |           271 / 310 |       1.46× |
| Selected finalist only, two passes         |           271 / 310 |       1.26× |
| Selected finalist only, one pass           |           271 / 310 |       1.23× |
| Both finalists, five worst Nets per pass   |           273 / 317 |       1.32× |
| Both finalists, three worst Nets, one pass |           275 / 323 |       1.29× |

Ripping up the R44 alternative changed the outcome of one document by one bend; the second
pass accepted eight retries in 66 runs and removed no crossing (Codex's instrumentation).
Opus also tried changing the first pass's Net order on the same scratch copy, since R13's
order is the root of the dependence: routing short-extent Nets first (bounding-box
perimeter ascending) gives dev 268 / val 312 without any rip-up, and with selected-only
rip-up dev 258 / val 294, but both leave a pin floating on one dev and one val drawing
(a later long Net is boxed in); high-fanout-first gives dev 294 and also strands a dev pin.
Order changes trade crossings for connectivity on this corpus and are not pursued in T028.

| #   | Severity | Where                                                   | Finding                                                                                                                                                                                                                                                                                                                          | Expected fix                                                                                                              |
| --- | -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `auto-layout.ts` `finish`                               | R96 as planned replans both finalists with rip-up; the alternative's replan costs 0.2× of the baseline time and never wins. Plan defect.                                                                                                                                                                                         | Plan Round 2 (A): rip up the selected finalist only; the R44 alternative stays a plain replan.                            |
| 2   | must-fix | `route.ts` rip-up loop                                  | Two passes as planned; the second never removes a crossing on 33 drawings. Plan defect.                                                                                                                                                                                                                                          | Plan Round 2 (B): one pass.                                                                                               |
| 3   | must-fix | `test/quality.test.ts:404`, `:471`                      | Two call-count assertions describe the pre-R96 sequence (last routing call is the R44 alternative; `4 + candidates` routing calls). They now fail because R96 adds one finalist replan.                                                                                                                                          | Plan Round 2 (C): `quality.test.ts` enters scope for these two expectations; update them to R96's sequence, nothing else. |
| 4   | must-fix | targets                                                 | Dev crossings 271 against ≤ 258: the target came from the all-candidates prototype; finalist-only cannot reach it alone. The first-pass order cannot be changed without stranding pins (above). The honest target for finalist-only rip-up is the measured 271: −5.6%.                                                           | Plan Round 2 (D).                                                                                                         |
| 5   | note     | `route.ts` `removeGroupRouting`, `restorePinGroups` use | Removal diffs the materialized routes, junctions and labels before and after a group's routing, applies the removal through `preview` (revision stays monotonic, ids never collide), then rejoins the group's pins electrically before rerouting. Sound; covered by the replay-identity, unique-id and canonical-geometry tests. | —                                                                                                                         |
| 6   | note     | `routing-audit.ts` `crossingsByNet`                     | Shares `properCrossing` with `auditRouting`, so the per-Net attribution and the audit agree by construction.                                                                                                                                                                                                                     | —                                                                                                                         |
| 7   | note     | report                                                  | Timeline matches the report: every acceptance command ran, the superseded quick run and the interrupted search are disclosed and not used as evidence, no test was weakened.                                                                                                                                                     | —                                                                                                                         |

Acceptance rerun (lane 1, Opus, on the round-1 tree):

```text
pnpm typecheck → 0; pnpm format:check → 0; pnpm lint → 0 errors
pnpm vitest run packages/auto-layout → 1; 2 failed (the two quality.test.ts call counts), 379 passed
frozen files, scripts, lockfile vs 078f407 → no diff
quick evaluation of the round-1 tree (Opus, paired with 078f407) → dev 287 → 271, val 337 → 310, floating 0 / 1, missing 0 / 1, 1.46×
```

Plan change: `plan.md` gains "Round 2 amendment" (selected finalist only, one pass,
`quality.test.ts` call counts in scope, targets reset to the measured finalist-only
result).

## Round 2 — accepted

Reviewed: `git diff 75d7008` of the round-2 working tree on 2026-11-09; acceptance rerun by
Opus on lane 1 (below). The amendment is applied as written: `finish` rips up only the
repaired selected run (quick and search paths; zero-budget search equals quick), the
rip-up loop is one pass with candidates computed once, the two `quality.test.ts`
expectations describe R96's sequence (one `signalTrunks === false` call, then the
finalist replan with `{ ripUp: true }`; `5 + candidates` routing calls) and nothing else
in that file changed, the spec says one pass on the selected finalist and names the gap
to all-candidate rip-up. Scope is clean: owned paths only, frozen files, scripts and the
lockfile byte-identical to `078f407`, nothing from `tmp/` tracked.

| #   | Severity | Where                                                | Finding                                                                                                                                                                                                                                                                                            | Expected fix |
| --- | -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | note     | `route.ts` rip-up loop                               | Single pass, candidates sorted by crossings then R13 order, strict lexicographic acceptance, old routing restored on any failure (`try` around the whole retry). The trailing `routingScore` call is a no-op audit kept as the pass-boundary check the plan asked for.                             | —            |
| 2   | note     | `route.ts` `removeGroupRouting` + `restorePinGroups` | Removal diffs materialized routes, junctions and annotations before/after the group's routing and reconnects the group's pins electrically before rerouting, so the retry sees the same frozen membership as the first pass. Covered by the replay-identity, unique-id and canonical-object tests. | —            |
| 3   | note     | `auto-layout.ts` `finish`                            | `ripUpFinalist` skips refused or scoreless runs and keeps the replan only on a strictly lower R22 score; `selectRoutingAlternative` still decides between the ripped-up selected run and the plain alternative.                                                                                    | —            |
| 4   | note     | human drawings                                       | Quick: dev 287 → 271, val 337 → 310, bends 371 → 367 / 400 → 397, floating 0 / 1 and missing 0 / 1 unchanged, symmetry unchanged, 17 drawings improve and none worsens. Search: dev 221 → 208, val 296 → 277.                                                                                      | —            |
| 5   | note     | timing                                               | Codex (sequential, quiet machine) 1.203×; Opus (both planners simultaneously) 1.111× (289.5 s → 321.7 s; slowest document 24.3 s → 26.5 s). The five largest drawings 1.5–1.7×; accepted as a known limit, with the all-candidate gap recorded in the spec.                                        | —            |
| 6   | note     | report                                               | Timeline matches: all acceptance commands ran, the sandboxed full-suite failure was rerun with local access, the instrumentation hook lives only in ignored `tmp/`, no test was weakened, round-1 reports were archived rather than reused as evidence.                                            | —            |

Acceptance rerun (lane 1, Opus, on the round-2 tree):

```text
pnpm install --frozen-lockfile --offline → 0
pnpm format:check / docs:check / typecheck → 0; pnpm lint → 0 errors
pnpm vitest run packages/auto-layout → 0; 381 passed
pnpm test:local → 0; 7727 passed, 117 skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout|rip-up' → no output; pnpm build → 0; pnpm auto-layout:review → 0
paired quick, both planners at once with --jobs 10 (078f407 archive vs this tree):
  33/33 both; summed planning time 1.111×; result identical to Codex's result-quick.json on every document
  dev crossings 287 → 271, bends 371 → 367, floating 0 → 0; val crossings 337 → 310, bends 400 → 397, floating 1 → 1
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33/33; crossings 517 → 484 (dev 221 → 208, val 296 → 276), bends 716 → 712, floating 1 → 1, none above quick
frozen files, scripts, protected packages, lockfile vs 078f407 → no diff; git ls-files | grep tmp → empty
```

Rendered human | before | after sheets (`tmp/t028/sheets/`, chosen by measurable change, never by
id) were inspected and sent to the user.

### PR 30 CI

The first CI run failed in `scripts/launcher.test.mjs` (a process-group kill timing
assertion, 3 ms where ≥ 400 ms is expected; T028 touches nothing under `scripts/`, and
the same test passed on the preceding `main` runs). The rerun passed that test and failed
`stages.test.ts` "is deterministic for a synthetic 120-device document" at its 30 s
timeout (30.5 s on the runner). That one is T028's doing: the test plans a 121-Net chain
twice and R96's finalist rip-up makes each plan about 1.26× slower (5.9 s → 7.4 s here);
on the slow CI runner that crossed 30 s. The timeout is raised to 60 s with a comment, as
T023 did for the held-out test, by Opus (a few lines found in review).

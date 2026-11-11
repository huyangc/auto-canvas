# T040 review

## Round 1 — changes-requested

Reviewed: `git diff c529aee` on `task/T040-auto-layout-coupling-fixes` after round 1.

Coupling components, the widened dotted-pin list, rigid placement and search moves, the
canonical coupling edges and the anonymous role normalization match the plan; all 33
plan hashes and all 33 named and anonymized payloads equal `c529aee`'s, and the cached v5
samples still resolve. The only gap is the one the plan made impossible: the dotted-pin
conflict warning needs `auto-layout.ts`, which the plan left out of scope.

| #   | Severity | Where                                                          | Finding                                                                                      | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `packages/auto-layout/src/auto-layout.ts` (result diagnostics) | The R143 warning for a member whose dotted pin differs between its couplings is not emitted. | Authorized: add `auto-layout.ts` to the owned paths for this warning only. Emit one `warning` diagnostic per conflicting member, rule `R143`, code `AUTO_LAYOUT_COUPLING_DOT_CONFLICT`, naming the member and the coupling ids, on every successful plan that recognizes the conflict (quick and search; partition plans too). Add the test assertion and the spec sentence that round 1 deferred. Results without a conflict keep their exact diagnostics. |

Plan change: owned paths gain `packages/auto-layout/src/auto-layout.ts` for finding 1 only.

## Round 2 — accepted

Reviewed: `git diff c529aee` after round 2; acceptance rerun by Opus with no API key set.

`couplingDotWarnings` in `auto-layout.ts` emits one `AUTO_LAYOUT_COUPLING_DOT_CONFLICT`
warning (rule R143) per member whose dotted pin differs between its valid couplings,
naming the member and the couplings in id order and the pin kept; it is appended to
every successful plan, so quick, search and partition results carry it. Results without
a conflict keep their diagnostics.

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (32 files, 564 tests)
pnpm test:local → 0 (773 files passed, 3 skipped; 7915 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'coupl|recognize|units' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; planHash equal to c529aee on 33 of 33
pnpm auto-layout:eval tmp/human-cases --partition llm --samples 3 --split dev → 0; 18 of 18 reconciled from cached v5 samples
protected paths → empty; no tracked tmp files
```

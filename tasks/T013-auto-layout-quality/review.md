# T013 review

## Round 1 — changes-requested

Reviewed: `git status`, the report and the source summary. Opus reran
`pnpm vitest run packages/auto-layout` (2 failed, 71 passed, the failures
matching the report) and viewed `five-t-ota`, `fig-17-19b`,
`two-stage-symbolic` and `skew`. `five-t-ota` and `fig-17-19b` now read like
their originals, and the report honestly states the held-out trade-offs. Both
blockers were stopped correctly.

**plan.md was edited for round 2:** R22 (`offConvention`), R25 and R26 are new.
The user asked for general fixes and delegated these decisions. Read them again.

| #   | Severity | Where                                  | Finding                                                                                                                                                                    | Expected fix                                                                                                                                  |
| --- | -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/refine.ts`                        | `two-stage-symbolic`: R22 moves `Vout` to the left edge beside `Vin` to save 10 wire units, against left-to-right signal flow.                                             | `offConvention` in R22. Corpus: P12 (`Vout`) is right of X8. `fig-17-19b` must keep its left output, since that saves crossings. Assert both. |
| 2   | must-fix | `src/place-markers.ts`, `src/route.ts` | `fd-two-stage`: I1.- and I2.- touch ground markers in the input; the id-order host pairing separates them, and reconciliation then adds a straight Route that merges nets. | R25. `fd-two-stage` must commit. If the merge persists, record which pair is still lost and stop that case.                                   |
| 3   | must-fix | `src/route.ts`                         | `common-source-ac`: a one-pin VDD Net has no Route to take its claim.                                                                                                      | R26. `common-source-ac` must commit with the claim and label on the stub.                                                                     |
| 4   | note     | report                                 | `ltc3452` gains 3 crossings and `ota-sky130` gains 2 bends.                                                                                                                | Accepted for now, since both remove a warning or lower the score. Recheck after R22 changes; report the numbers.                              |
| 5   | note     | `skew`                                 | It commits, but a ground symbol sits between M2 and M3 and labels collide. It has 18 instances, beyond v1's scope.                                                         | No change; keep it in the visual table as a known limit.                                                                                      |

Acceptance rerun: package tests only; the full rerun follows round 2.

## Round 2 — accepted

Reviewed: `git status`, the round 2 report, and the rendered `five-t-ota`,
`fig-17-19b`, `two-stage-symbolic`, `two-inverters`, `fd-two-stage` and
`common-source-ac`. Round 1 findings 1-3 are fixed. No source keys behavior to a
corpus or held-out case; a grep for instance-like literals finds only the rule
name `"R3"`.

Acceptance rerun by Opus on lane 1 (`tmp/t013-opus/`):

```text
pnpm install --frozen-lockfile --offline     → 0
pnpm format:check                            → 0
pnpm docs:check                              → 0
pnpm typecheck                               → 0
pnpm lint                                    → 0
pnpm vitest run packages/auto-layout         → 0 (78 tests)
pnpm test:local                              → 0 (743 files; 7359 tests passed, 116 skipped)
pnpm deadcode | grep auto-layout             → no output (deadcode exits 1, as on main)
pnpm build                                   → 0
node scripts/auto-layout-review.mjs          → 0 (9 corpus + 7 held-out)
protected paths                              → unchanged
```

Crossings / bends / wire length, Opus's run:

| Case                    | T012                        | T013                      |
| ----------------------- | --------------------------- | ------------------------- |
| five-t-ota              | 0 / 2 / 1070                | 0 / 1 / 1120              |
| fig-17-19b              | 2 / 5 / 1280                | 0 / 0 / 1100              |
| two-inverters           | 1 / 2 / 1500                | 1 / 2 / 1500              |
| differential-stage      | 0 / 0 / 360                 | 0 / 0 / 360               |
| common-source           | 0 / 2 / 1000                | 0 / 2 / 1000              |
| rc-lowpass, rc-highpass | 0 / 0 / 360                 | 0 / 0 / 360               |
| rlc                     | 0 / 0 / 480                 | 0 / 0 / 480               |
| two-stage-symbolic      | 1 / 3 / 1010                | 0 / 3 / 1060              |
| fd-two-stage            | refused                     | 12 / 13 / 5930            |
| common-source-ac        | refused                     | 2 / 8 / 980               |
| skew                    | refused                     | 4 / 4 / 2130              |
| deadtime                | refused                     | 17 / 36 / 7430            |
| ota-sky130              | 6 / 5 / 2720                | 3 / 7 / 2520, one warning |
| widlar                  | 5 / 14 / 3140, 3 problems   | 5 / 13 / 3140, none       |
| ltc3452                 | 19 / 28 / 9900, one warning | 22 / 25 / 10060, none     |

Known limits. Held-out circuits commit safely, but that is not drawing quality:

- `fd-two-stage`: the stages form one long row with 12 crossings, not the
  textbook layout, and its port labels render upside down.
- `common-source-ac`: a wire runs alongside `R_S`, and drafting notes stay at
  their old positions, away from the parts they describe.
- `skew`: a ground symbol sits between M2 and M3, and labels collide.
- `ltc3452` gains 3 crossings and `ota-sky130` gains 2 bends: a trade-off the
  score accepts, not a pure improvement.
- `two-inverters`: `nbit` still overlaps `XSN`.
- Multi-stage arrangement beyond the ~5-device scope of v1 is untouched.

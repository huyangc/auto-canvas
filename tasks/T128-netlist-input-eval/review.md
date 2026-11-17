# T128 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T128-netlist-input-eval`; every acceptance command rerun by the
reviewer, including the three corpus evaluations and both conversions.

Deviations from the plan, accepted:

- A `--reference` report carries a top-level `netlistInput: { folder,
reference }`; the comparison needs it to find the meta files of cases that
  did not convert, which are not in `report.cases`.
- The reference's marker counts are a separate per-case key,
  `railMarkersReference`, so `railMarkers` keeps its shape.
- `--reference` with `--partition` or `--fixed-human` is rejected.

| #   | Severity | Where                       | Finding                                                                                                                                                                                                                                                            | Expected fix                           |
| --- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 1   | note     | conversion                  | 113 of 628 drawings do not convert (104 export-blocked, 9 import-failed), the same in both forms. They are reported by stage and code and are not worked around.                                                                                                   | none here                              |
| 2   | note     | conversion                  | The product's electrical-graph comparison calls the import different from its source in 42 (VSS form) and 64 (global form) converted cases; re-export gives identical text or the same cards in 502 and 498. The netlist-input document is the evaluation's truth. | look at the 64 before T130             |
| 3   | note     | `scripts/netlist-input.mjs` | The rail name patterns are copied from `packages/auto-layout/src/net-roles.ts`, which does not export them; they are used only for two meta counts.                                                                                                                | export them when a task owns that file |
| 4   | note     | baseline report             | `main-fb61255-report.json` has no `netKindDetail`, so the per-kind bends and rail crossings of the drawing side come from this branch's drawing-mode report.                                                                                                       | none                                   |

Acceptance rerun by the reviewer:

```text
pnpm build / typecheck / lint (0 errors) / format:check / docs:check → 0
pnpm vitest run scripts/netlist-input.test.mjs scripts/netlist-input-compare.test.mjs scripts/visible-integrity.test.mjs → 0 (24 passed)
pnpm test:local → 0 (811 files, 8341 passed, 117 skipped)
pnpm test:slow  → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6 --baseline tmp/inputs/main-fb61255-report.json → 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form vss|global --jobs 6 → 0, 0
node scripts/auto-layout-eval.mjs tmp/netlist-input/vss|global --reference tmp/inputs/le10-input --out … → 0, 0
node scripts/netlist-input-compare.mjs … → 0, 0
```

- Drawing mode: 612 completed, every one equal to the baseline (plan hash and
  stored result fields); the same 16 refused; none threw.
- Conversions: 515 converted in each form; the reviewer's output is
  byte-identical to the implementer's (checksum of all `.json` and `.sp`).
  The VSS form reproduces the baseline experiment's conversion numbers.
- Netlist evaluations: 515 completed, 515 equivalent against their input, none
  threw, no failing case; every plan hash equals the implementer's run.

Paired totals (507 cases completed on both inputs):

| Metric                     | Human | Drawing input | VSS form | Global form |
| -------------------------- | ----- | ------------- | -------- | ----------- |
| Crossings                  | 208   | 282           | 429      | 380         |
| Bends                      | 1850  | 1986          | 2476     | 2272        |
| Wire                       | 371k  | 462k          | 553k     | 549k        |
| Rail wire                  | 81k   | 82k           | 159k     | 156k        |
| Crossings involving a rail | 17    | 15            | 94       | 63          |
| Long-narrow (aspect ≥ 2)   | 44    | 80            | 69       | 93          |
| Cases with floating pins   | –     | 0             | 96       | 32          |
| Cases with a ground claim  | –     | –             | 36       | 482         |

The VSS-form totals equal the baseline experiment's.

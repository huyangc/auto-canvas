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

## Round 2 — changes requested (independent PR review of 10bbcf0)

The Opus PR review approved with one P2 and eight P3 findings. Fix on this
branch:

| #   | Severity   | Where                                                 | Finding                                                                                                                                                                                                                                                                                      | Expected fix                                                                                                                                                                                                                                                              |
| --- | ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `scripts/netlist-input-compare.mjs` paired totals     | The paired table, per-kind totals and symmetry totals include cases whose import the product's electrical-graph comparison calls a different circuit (42 VSS, 64 global) or cannot check (26), with no way to see them apart.                                                                | Print the paired table and the per-kind line a second time restricted to `electricalGraph === "equal"` (with its pair count), and add electrical-graph and re-export verdict groups to the breakdown. Store both in `compare.json`. Test on the fake reports.             |
| 2   | should-fix | `scripts/netlist-input-compare.mjs` `failingCriteria` | Omits `baselineEqual === false`, which the evaluation's exit predicate has.                                                                                                                                                                                                                  | Add it, with a test.                                                                                                                                                                                                                                                      |
| 3   | should-fix | compare, "drawing completed, netlist not"             | Counts only cases present in the netlist report; the 105 drawing-completed cases that never converted are not counted.                                                                                                                                                                       | Count every drawing-completed case without a completed netlist counterpart, split into "not converted" and "converted, not completed".                                                                                                                                    |
| 4   | should-fix | compare labels                                        | "hidden pins made explicit" is built from every pin the import nets and the drawing does not, hidden or not.                                                                                                                                                                                 | Rename to "pins netted only in the import" everywhere (meta field names stay).                                                                                                                                                                                            |
| 5   | should-fix | compare, crossings involving a rail                   | Printed as n/a for a report without `netKindDetail`, although it equals the sum of the rail entries of `netBreakdown.crossingsByKindPair`.                                                                                                                                                   | Derive it from `netBreakdown` when `netKindDetail` is absent.                                                                                                                                                                                                             |
| 6   | should-fix | `docs/testing/readability.md`                         | Does not say that the conversion omits the editor's MOS bulk materialisation on install (`materializeRazaviProjectBulkConnections`; geometry-neutral in the review's probes, both sides consistent), nor that symmetry and signal-direction totals have different denominators on each side. | Say both in the "Netlist input" section.                                                                                                                                                                                                                                  |
| 7   | should-fix | `scripts/lib/import-display-bundle.mjs`               | Two processes can rebuild the bundle into the same directory at once.                                                                                                                                                                                                                        | Build to a temporary name and rename into place.                                                                                                                                                                                                                          |
| 8   | should-fix | tests                                                 | No test covers the `--reference` wiring of `scripts/auto-layout-eval.mjs`.                                                                                                                                                                                                                   | A small fixture test (two tiny projects in a temporary folder, the script run as a child process): human metrics come from the reference, the integrity baseline from the input, no block metrics. Skip only if the script cannot run on a two-file corpus; then say why. |
| 9   | note       | `netKindDetail` cost                                  | Five more `auditRouting` passes per metrics call; not measured.                                                                                                                                                                                                                              | Report the evaluation's wall time before and after on a 60-case sub-corpus.                                                                                                                                                                                               |

Acceptance for round 2: the plan's checks; drawing mode still equal to the
baseline in every case; conversions byte-identical to round 1 (checksum);
netlist evaluations with every plan hash equal to round 1's reports
(`tmp/t128-netlist-vss-report.json`, `tmp/t128-netlist-global-report.json`).

## Round 2 result — accepted

All nine findings fixed; `scripts/auto-layout-eval.mjs` is unchanged, so no
planned result can differ.

1. The paired table and per-kind line are printed and stored a second time
   for pairs whose import has an equal electrical graph; electrical-graph and
   re-export verdict groups join the breakdown. On those pairs the netlist
   gap remains: global form, 420 pairs — crossings 147 (human) / 203 (drawing
   input) / 247 (netlist input), bends 1392 / 1432 / 1572, rail wire 64k /
   63k / 127k; VSS form, 442 pairs — crossings 185 / 229 / 297, bends 1567 /
   1639 / 1960, rail wire 64k / 64k / 134k.
2. `failingCriteria` reports `baseline-differs`.
3. "Drawing completed, netlist not" counts every drawing-completed case: 105
   not converted, 0 converted and not completed.
4. The group label reads "pins netted only in the import". The failure-class
   name "hidden supply or control pin made explicit" stays, as the plan names
   it; the doc says what it covers.
5. Crossings involving a rail fall back to `netBreakdown` for older reports.
6. The doc names the omitted MOS bulk materialisation and the differing
   denominators.
7. The bundle is built in a scratch directory and renamed into place.
8. New `scripts/auto-layout-eval-reference.test.mjs` runs the evaluation as a
   child process on a two-project folder.
9. `netKindDetail` costs about 1.3 ms per drawing.

Reviewer rerun: typecheck, lint (0 errors), format:check, docs:check 0; the
four script test files 0 (27 passed); `pnpm test:local` 0 (812 files, 8344
passed, 117 skipped); `pnpm test:slow` 0 (2 files, 8 passed); both conversions
byte-identical to round 1; both comparisons 0.

## Round 2 follow-up — second PR review

The Opus review of `557d104` approved with three P3 findings, fixed by the
reviewer: the bundle is renamed into place before its manifest; the
equal-electrical-graph subset also carries the symmetry and signal-direction
totals; the `--reference` test removes its temporary folder. Rerun after the
fix: typecheck, lint (0 errors), format:check, docs:check 0; the four script
test files 0 (27 passed); the VSS conversion byte-identical to round 1.
